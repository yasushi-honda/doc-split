/**
 * 複数名FAXの手動複製ボタン: 純粋ロジック(ADR-0032)
 *
 * `duplicateDocumentForCustomers`(onCall)から副作用(Firestore/Storage)を切り離した純粋関数群。
 * `faxDuplication.ts` / `splitDocumentBuilder.ts` と同じ規約で、`serverTimestamp()` 等の
 * FieldValue は自前で呼ばず、呼出元から受け取る。
 *
 * - `buildManualDuplicateDocId`: 複製docの決定的ID(重複防止の要。「作成の履歴」として扱う)
 * - `buildManualDuplicateDocData`: 複製docの中身。**許可リスト方式**(元の書類から写す項目を明示し、
 *   それ以外は写さない)。以前の自動複製(`ocrProcessor.ts` の `...merged` スプレッド)は拒否リスト寄りで、
 *   Drive出力系・確認状態などが紛れ込む余地があったため、手動複製では採らない。
 * - `planManualDuplication`: 依頼された利用者のうち、作る分・作成済みで飛ばす分・拒否の判定と、
 *   グループ合計の上限(5名)の強制。
 */

import type { FieldValue } from 'firebase-admin/firestore';
import { generateDisplayFileName } from '../../../shared/generateDisplayFileName';
import type { TimestampLike } from '../../../shared/timestampHelpers';
import { buildFaxDuplicationMemberOverride } from '../ocr/faxDuplication';
import {
  MANUAL_DUPLICATION_MAX_GROUP_SIZE,
  type ManualDuplicationSkipReason,
} from '../../../shared/types';

// 上限の値はFEと共有する(shared/types.ts)。既存の import 元を変えないよう再export する
export { MANUAL_DUPLICATION_MAX_GROUP_SIZE };
export type { ManualDuplicationSkipReason };


/** 複製doc IDの区切り。`{元docId}_dup_{customerId}` */
const DUPLICATE_ID_INFIX = '_dup_';

/** 複製docの決定的ID。同じ(元doc, 利用者)の組は常に同じIDになり、二重実行で増えない */
export function buildManualDuplicateDocId(sourceDocId: string, customerId: string): string {
  return `${sourceDocId}${DUPLICATE_ID_INFIX}${customerId}`;
}

/**
 * 元の書類から複製へ写す項目(許可リスト)。
 *
 * 引き継ぐ理由:
 * - fileId/fileName/mimeType/fileUrl: PDFの実体は共有する(既存の自動複製と同じ)
 * - targetPageNumber/sourceType/messageId/totalPages/ocrExcerpt: 書類としての必須・表示項目
 * - documentType系・category・office系・suggestedNewOffice・fileDate系: 同じFAXなので共通
 * - ocrExtraction/extractionScores/extractionDetails/pass2Promotion: OCRの抽出結果(同じ実行結果)
 *
 * 写さない(意図的に含めない): 利用者系(上書きする)、`verified*`(未確認で初期化)、Drive出力系、
 * 分割系、`provenance*`、`multiCustomer*`、`customerCandidates`/`allCustomerCandidates`、
 * `summary*`(元の利用者名を含みうる。必要なら手動で再生成)、集計キー(`customerKey`等はトリガーが付ける)、
 * `ocrRunId`/`retryCount` などの処理状態、`ocrResult`/`pageResults`(`detail/main` 側)。
 */
const CARRIED_FIELDS = [
  'fileId',
  'fileName',
  'mimeType',
  'fileUrl',
  'targetPageNumber',
  'sourceType',
  'messageId',
  'totalPages',
  'ocrExcerpt',
  'documentType',
  'documentTypeConfirmed',
  'category',
  'officeName',
  'officeId',
  'officeConfirmed',
  'officeConfirmedBy',
  'officeConfirmedAt',
  'officeCandidates',
  'suggestedNewOffice',
  'fileDate',
  'fileDateFormatted',
  'ocrExtraction',
  'extractionScores',
  'extractionDetails',
  'pass2Promotion',
] as const;

/** Firestore Timestamp(またはduck-type)を日本時間の YYYY-MM-DD にする。解釈できなければ undefined */
const JST_DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function formatFileDateJst(ts: TimestampLike | null | undefined): string | undefined {
  if (!ts || typeof ts.seconds !== 'number' || !Number.isFinite(ts.seconds)) return undefined;
  const date = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts.seconds * 1000);
  return JST_DATE_FORMAT.format(date);
}

/**
 * `gs://bucket/ocr-results/{docId}/{ocrRunId}.txt` から ocrRunId を取り出す。
 * 末尾が区切りの場合・空文字は解釈できないため null。
 */
export function parseOcrRunId(url: string): string | null {
  const match = /([^/]+?)(?:\.txt)?$/.exec(url);
  return match ? match[1]! : null;
}

export interface ManualDuplicateTarget {
  customerId: string;
  customerName: string;
  careManagerName: string | null;
}

export interface BuildManualDuplicateInput {
  /** 元の書類のFirestoreデータ(`documents/{id}` の `data()`) */
  source: Record<string, unknown>;
  newDocId: string;
  target: ManualDuplicateTarget;
  /** 配信グループの印。元の書類に `distributionId` があればそれ、なければ元の書類のID */
  distributionId: string;
  /** 複製を実行した職員のuid(`confirmedBy` に入れる) */
  confirmedByUid: string;
  /** 複製専用のOCR全文のURL。OCR全文を持たない書類(インライン保持)では undefined */
  ocrResultUrl: string | undefined;
  /** `FieldValue.serverTimestamp()`(`processedAt`/`updatedAt`/`confirmedAt` に使う) */
  serverTimestamp: FieldValue;
}

/** 複製doc(`documents/{newDocId}`)に書くデータを作る。`detail/main` は別(元からそのまま写す) */
export function buildManualDuplicateDocData(input: BuildManualDuplicateInput): Record<string, unknown> {
  const { source, newDocId, target, distributionId, confirmedByUid, ocrResultUrl, serverTimestamp } = input;

  const carried: Record<string, unknown> = {};
  for (const key of CARRIED_FIELDS) {
    // Firestoreは undefined を拒否するため、元の書類に無い項目はキー自体を作らない
    if (source[key] !== undefined) {
      carried[key] = source[key];
    }
  }

  // 利用者・担当CMは確定済み、verified* は未確認で初期化(自動複製と同じ上書き)。
  // 自動複製の confirmedBy/confirmedAt は null(システム確定)だが、手動複製は誰が押したかを残す。
  const memberOverride = {
    ...buildFaxDuplicationMemberOverride(
      {
        customerId: target.customerId,
        customerName: target.customerName,
        careManagerName: target.careManagerName,
      },
      distributionId
    ),
    confirmedBy: confirmedByUid,
    confirmedAt: serverTimestamp,
  };

  // displayFileName は選んだ利用者名で作り直す(元の利用者名を引き継がない)。
  // 日付は fileDate(Timestamp)を優先する。職員が手で日付を直すと fileDate だけが更新され、
  // 保存済みの fileDateFormatted は古いOCR日付のまま残るため、それを優先するとDriveに古い日付の
  // ファイル名が出る(splitPdf は fileDateFormatted を優先する既存の規約だが、複製は
  // 「OCRの誤りを直してから複製する」流れで起きやすい)。日本時間で整形する(サーバーはUTC)。
  const fileDateForName =
    formatFileDateJst(source.fileDate as TimestampLike | null | undefined) ??
    (typeof source.fileDateFormatted === 'string' ? source.fileDateFormatted : undefined);
  const displayFileName = generateDisplayFileName({
    documentType: source.documentType as string | undefined,
    customerName: target.customerName,
    officeName: source.officeName as string | undefined,
    fileDate: fileDateForName,
  });

  return {
    ...carried,
    ...memberOverride,
    ...(ocrResultUrl !== undefined ? { ocrResultUrl } : {}),
    ...(displayFileName ? { displayFileName } : {}),
    id: newDocId,
    status: 'processed',
    // 未設定だと一覧(processedAt 降順の取得)から消える
    processedAt: serverTimestamp,
    updatedAt: serverTimestamp,
  };
}

export type ManualDuplicationErrorReason =
  | 'empty-request'
  | 'invalid-customer-id'
  | 'same-as-source'
  | 'too-many-requested'
  | 'group-limit-exceeded';

export interface PlanManualDuplicationInput {
  sourceDocId: string;
  sourceCustomerId: string | null | undefined;
  /** クライアントからの入力(信用しない) */
  requestedCustomerIds: unknown;
  /** 同じ `distributionId` を持つ既存の書類(元の書類を含んでいてもよい) */
  existingGroupMembers: ReadonlyArray<{ docId: string; customerId: string | null | undefined }>;
  /** 依頼した利用者のうち、決定的IDのdocが既に存在するものを引くための集合(doc ID) */
  existingDeterministicIds: ReadonlySet<string>;
}

export type PlanManualDuplicationResult =
  | {
      ok: true;
      /** 実際に作る利用者(依頼順、重複除去済み) */
      toCreate: string[];
      skipped: Array<{ customerId: string; reason: ManualDuplicationSkipReason }>;
    }
  | {
      ok: false;
      code: 'invalid-argument' | 'failed-precondition';
      reason: ManualDuplicationErrorReason;
      message: string;
    };

function fail(
  code: 'invalid-argument' | 'failed-precondition',
  reason: ManualDuplicationErrorReason,
  message: string
): PlanManualDuplicationResult {
  return { ok: false, code, reason, message };
}

/** 依頼内容の検証、作成済みの判定、グループ合計の上限の強制(純粋関数) */
export function planManualDuplication(input: PlanManualDuplicationInput): PlanManualDuplicationResult {
  const { sourceDocId, sourceCustomerId, requestedCustomerIds, existingGroupMembers, existingDeterministicIds } = input;

  if (!Array.isArray(requestedCustomerIds) || requestedCustomerIds.length === 0) {
    return fail('invalid-argument', 'empty-request', '複製先の利用者を1名以上指定してください');
  }
  for (const id of requestedCustomerIds) {
    // '/' を含むIDは Firestore のドキュメントパス(masters/customers/items/{id})を壊す
    if (typeof id !== 'string' || id.trim() === '' || id.includes('/')) {
      return fail('invalid-argument', 'invalid-customer-id', '利用者IDが不正です');
    }
  }

  // 依頼内の重複は1件にまとめる(順序は依頼順を保つ)
  const requested = [...new Set(requestedCustomerIds as string[])];

  if (sourceCustomerId && requested.includes(sourceCustomerId)) {
    return fail('invalid-argument', 'same-as-source', '元の書類と同じ利用者は指定できません');
  }
  // 元の書類の分を除いた人数が、1回の依頼で選べる上限
  if (requested.length > MANUAL_DUPLICATION_MAX_GROUP_SIZE - 1) {
    return fail(
      'invalid-argument',
      'too-many-requested',
      `一度に複製できるのは${MANUAL_DUPLICATION_MAX_GROUP_SIZE - 1}名までです`
    );
  }

  const toCreate: string[] = [];
  const skipped: Array<{ customerId: string; reason: ManualDuplicationSkipReason }> = [];
  for (const customerId of requested) {
    if (existingDeterministicIds.has(buildManualDuplicateDocId(sourceDocId, customerId))) {
      skipped.push({ customerId, reason: 'already-exists' });
    } else if (existingGroupMembers.some((m) => m.customerId === customerId)) {
      skipped.push({ customerId, reason: 'already-in-group' });
    } else {
      toCreate.push(customerId);
    }
  }

  // グループ合計 = 既存メンバー(元の書類を必ず含める)+ 今回作る分。作成済みで飛ばす分は数えない。
  const memberDocIds = new Set(existingGroupMembers.map((m) => m.docId));
  memberDocIds.add(sourceDocId);
  const total = memberDocIds.size + toCreate.length;
  if (total > MANUAL_DUPLICATION_MAX_GROUP_SIZE) {
    return fail(
      'failed-precondition',
      'group-limit-exceeded',
      `同じFAXから作る書類は合計${MANUAL_DUPLICATION_MAX_GROUP_SIZE}名までです(現在${memberDocIds.size}名、追加${toCreate.length}名)`
    );
  }

  return { ok: true, toCreate, skipped };
}
