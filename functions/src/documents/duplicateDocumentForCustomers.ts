/**
 * 複数名FAXの手動複製 Cloud Function (ADR-0032)
 *
 * 詳細画面の「他の利用者用に複製」ボタンから呼ばれる。担当者が押したときだけ、元の書類を
 * 指定した利用者の人数分だけ複製する(自動複製 `faxDuplication` は戻さない)。
 *
 * クライアントから `documents` は作れない(`firestore.rules`)ため、サーバー側で作る。
 * 複製の中身(許可リスト)と重複防止・人数上限の判定は `manualDuplicationBuilder.ts`(純粋関数)。
 * 本ファイルは、認可・メンテナンスゲート・トランザクション・Storage(OCR全文)の副作用を担う。
 *
 * リクエスト: { documentId: string, customerIds: string[] }  // 1回に最大4名
 * レスポンス: {
 *   created: { customerId, documentId }[],
 *   skipped: { customerId, reason: 'already-exists' | 'already-in-group' }[]
 * }
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { isCustomerUnconfirmed } from '../drive/customerAmbiguityGate';
import { copyOcrResultForDistributionMember } from '../ocr/ocrProcessor';
import { isGroupAggregationGateOpen } from '../utils/maintenanceGate';
import { MASTER_PATHS } from '../utils/masterPaths';
import { withRetry, RETRY_CONFIGS } from '../utils/retry';
import type { Document, DuplicateDocumentResponse } from '../../../shared/types';
import {
  buildManualDuplicateDocData,
  buildManualDuplicateDocId,
  planManualDuplication,
} from './manualDuplicationBuilder';

const db = admin.firestore();

/** Storage(OCR全文)の副作用。テストでは偽物に差し替える */
export interface ManualDuplicationDeps {
  /** OCR全文を複製専用のパス(`ocr-results/{destinationKey}/{ocrRunId}.txt`)へコピーし、そのURLを返す */
  copyOcrResult(sourceUrl: string, destinationKey: string, ocrRunId: string): Promise<string>;
  /** コピーしたOCR全文を削除する(Firestoreの書き込み失敗時の補償) */
  deleteOcrResult(url: string): Promise<void>;
}

const defaultDeps: ManualDuplicationDeps = {
  copyOcrResult: copyOcrResultForDistributionMember,
  deleteOcrResult: async (url) => {
    const bucket = admin.storage().bucket();
    const objectPath = url.replace(`gs://${bucket.name}/`, '');
    await withRetry(() => bucket.file(objectPath).delete({ ignoreNotFound: true }), RETRY_CONFIGS.storage);
  },
};

/** レスポンスの型はFEと共有（shared/types.ts） */
export type ManualDuplicationResult = DuplicateDocumentResponse;

/** `gs://bucket/ocr-results/{docId}/{ocrRunId}.txt` から ocrRunId を取り出す */
function ocrRunIdFromUrl(url: string): string {
  const match = /([^/]+?)(?:\.txt)?$/.exec(url);
  if (!match) {
    throw new HttpsError('failed-precondition', 'OCR全文の保存先を解釈できません');
  }
  return match[1];
}

/** Phase E 以前の旧形式(本体に ocrResult/pageResults がある書類)の読み替え。無ければ null */
function legacyDetailFromBody(source: Record<string, unknown>): Record<string, unknown> | null {
  const detail: Record<string, unknown> = {};
  if (source.ocrResult !== undefined) detail.ocrResult = source.ocrResult;
  if (source.pageResults !== undefined) detail.pageResults = source.pageResults;
  return Object.keys(detail).length > 0 ? detail : null;
}

/**
 * トランザクションが失敗したとき、複製のためにコピーしたOCR全文を削除する。
 *
 * 最終transactionのthrowは「未commitの確証」にならない(ローカルにはエラーが返っても実際には
 * サーバー側でcommit済みの場合がある)。複製docが存在し `ocrResultUrl` が今回のコピーと一致する
 * なら、実際には採用されていたので削除しない(削除すると複製docの全文取得が not-found になる)。
 * 補償自体が失敗しても元のエラーを優先して握りつぶさず、ログに残す。
 */
async function compensateOcrCopies(
  database: admin.firestore.Firestore,
  copied: ReadonlyMap<string, string>,
  deps: ManualDuplicationDeps
): Promise<void> {
  for (const [duplicateDocId, url] of copied) {
    try {
      const snap = await database.doc(`documents/${duplicateDocId}`).get();
      if (snap.exists && snap.get('ocrResultUrl') === url) continue;
      await deps.deleteOcrResult(url);
    } catch (cleanupErr) {
      console.error('[duplicateDocumentForCustomers] コピーしたOCR全文の補償削除に失敗しました', {
        operation: 'duplicateDocumentForCustomers',
        event: 'compensateOcrCopyFailed',
        duplicateDocumentId: duplicateDocId,
        error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
      });
    }
  }
}

export async function executeManualDuplication(params: {
  db: admin.firestore.Firestore;
  uid: string;
  documentId: string;
  customerIds: unknown;
  deps: ManualDuplicationDeps;
}): Promise<ManualDuplicationResult> {
  const { db: database, uid, documentId, customerIds, deps } = params;
  const sourceRef = database.doc(`documents/${documentId}`);
  /** 今回の実行でコピーしたOCR全文(複製docのID → コピー先URL)。失敗時の補償削除に使う */
  const copiedOcrUrls = new Map<string, string>();

  try {
    return await database.runTransaction(async (tx) => {
      // ---- 読み取り(書き込みより前に全て済ませる) ----
      const [sourceSnap, detailSnap] = await tx.getAll(sourceRef, sourceRef.collection('detail').doc('main'));
      if (!sourceSnap.exists) {
        throw new HttpsError('not-found', '元の書類が見つかりません');
      }
      const source = sourceSnap.data() as Record<string, unknown>;

      if (source.status !== 'processed') {
        throw new HttpsError('failed-precondition', '処理が完了した書類だけ複製できます');
      }
      if (source.isSplitSource === true) {
        throw new HttpsError('failed-precondition', '分割元の書類は複製できません');
      }

      const sourceCustomerId =
        typeof source.customerId === 'string' && source.customerId !== '' ? source.customerId : null;

      // 依頼内容の形式を先に検証する(マスター等の読み取りに進む前に弾く)。
      // 既存メンバー・作成済みを空にした計画なので、ここで返るエラーは入力検証(空・不正ID・
      // 元の書類と同じ利用者・一度に4名超)だけで、成功時の toCreate は重複除去済みの依頼一覧になる。
      const preflight = planManualDuplication({
        sourceDocId: documentId,
        sourceCustomerId,
        requestedCustomerIds: customerIds,
        existingGroupMembers: [],
        existingDeterministicIds: new Set(),
      });
      if (!preflight.ok) {
        throw new HttpsError(preflight.code, preflight.message);
      }
      const requested = preflight.toCreate;

      // 元の書類の利用者が確定済みであること(Drive出力のゲートと同じ判定。verified は条件に含めない)
      let sourceMasterName: string | null = null;
      if (sourceCustomerId) {
        const sourceMasterSnap = await tx.get(database.doc(`${MASTER_PATHS.customers}/${sourceCustomerId}`));
        if (!sourceMasterSnap.exists) {
          throw new HttpsError('failed-precondition', '元の書類の利用者が確定していません。先に利用者を決めてください');
        }
        sourceMasterName = (sourceMasterSnap.data()?.name as string | undefined) ?? '';
      }
      if (await isCustomerUnconfirmed(source as unknown as Document, { firestore: database, customerMasterName: sourceMasterName })) {
        throw new HttpsError('failed-precondition', '元の書類の利用者が確定していません。先に利用者を決めてください');
      }

      // 同じ配信グループの既存メンバー(元の書類・以前の自動複製・今回以前の手動複製)。
      // 判定と作成を1回のcommitにするため、トランザクション内で読む。
      const groupId =
        typeof source.distributionId === 'string' && source.distributionId !== ''
          ? source.distributionId
          : documentId;
      const groupSnap = await tx.get(database.collection('documents').where('distributionId', '==', groupId));
      const members = groupSnap.docs.map((d) => ({
        docId: d.id,
        customerId: d.get('customerId') as string | null | undefined,
      }));

      // 複製先の利用者マスターと、決定的IDの複製docの有無
      const masterRefs = requested.map((id) => database.doc(`${MASTER_PATHS.customers}/${id}`));
      const duplicateRefs = requested.map((id) =>
        database.doc(`documents/${buildManualDuplicateDocId(documentId, id)}`)
      );
      const snaps = await tx.getAll(...masterRefs, ...duplicateRefs);
      const masterSnaps = snaps.slice(0, requested.length);
      const duplicateSnaps = snaps.slice(requested.length);

      const missing = requested.filter((_, i) => !masterSnaps[i].exists);
      if (missing.length > 0) {
        throw new HttpsError('not-found', '選んだ利用者がマスターに見つかりません');
      }

      const plan = planManualDuplication({
        sourceDocId: documentId,
        sourceCustomerId,
        requestedCustomerIds: customerIds,
        existingGroupMembers: members,
        existingDeterministicIds: new Set(duplicateSnaps.filter((s) => s.exists).map((s) => s.id)),
      });
      if (!plan.ok) {
        throw new HttpsError(plan.code, plan.message);
      }
      if (plan.toCreate.length === 0) {
        return { created: [], skipped: plan.skipped };
      }

      // ---- 書き込み ----
      const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();
      const detailData = detailSnap.exists
        ? (detailSnap.data() as Record<string, unknown>)
        : legacyDetailFromBody(source);
      const sourceOcrUrl =
        typeof source.ocrResultUrl === 'string' && source.ocrResultUrl !== '' ? source.ocrResultUrl : null;

      const created: ManualDuplicationResult['created'] = [];
      for (const customerId of plan.toCreate) {
        const master = masterSnaps[requested.indexOf(customerId)].data() as {
          name: string;
          careManagerName?: string;
        };
        const newDocId = buildManualDuplicateDocId(documentId, customerId);

        // OCR全文は複製専用のパスへコピーする(再OCR時の掃除が ocr-results/{実docId}/ のみを対象にするため)。
        // 保存先が決定的なので、transactionの自動リトライで再実行されても同じパスへ上書きされるだけ。
        let ocrResultUrl: string | undefined;
        if (sourceOcrUrl) {
          ocrResultUrl = await deps.copyOcrResult(sourceOcrUrl, newDocId, ocrRunIdFromUrl(sourceOcrUrl));
          copiedOcrUrls.set(newDocId, ocrResultUrl);
        }

        const newRef = database.doc(`documents/${newDocId}`);
        tx.set(
          newRef,
          buildManualDuplicateDocData({
            source,
            newDocId,
            target: {
              customerId,
              customerName: master.name,
              careManagerName: master.careManagerName ?? null,
            },
            distributionId: groupId,
            confirmedByUid: uid,
            ocrResultUrl,
            serverTimestamp,
          })
        );
        if (detailData) {
          tx.set(newRef.collection('detail').doc('main'), detailData);
        }
        created.push({ customerId, documentId: newDocId });
      }

      // 元の書類にグループの印を付ける(既にあれば触らない)。利用者・確認・Drive出力の状態は変えない。
      if (source.distributionId !== groupId) {
        tx.update(sourceRef, { distributionId: groupId });
      }

      return { created, skipped: plan.skipped };
    });
  } catch (err) {
    await compensateOcrCopies(database, copiedOcrUrls, deps);
    throw err;
  }
}

export const duplicateDocumentForCustomers = onCall(
  {
    region: 'asia-northeast1',
    memory: '256MiB',
    timeoutSeconds: 120,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const uid = request.auth.uid;
    const userDoc = await db.doc(`users/${uid}`).get();
    if (!userDoc.exists) {
      throw new HttpsError('permission-denied', 'User not in whitelist');
    }

    const { documentId, customerIds } = (request.data ?? {}) as {
      documentId?: unknown;
      customerIds?: unknown;
    };
    if (typeof documentId !== 'string' || documentId === '' || documentId.includes('/')) {
      throw new HttpsError('invalid-argument', 'documentId is required');
    }

    // 集計所属を変えうる書込み経路(分割・OCR完了と同じ)。バックフィル中は止める。
    if (!(await isGroupAggregationGateOpen(db))) {
      throw new HttpsError('unavailable', 'システムメンテナンス中のため、しばらくしてから再度お試しください');
    }

    const result = await executeManualDuplication({ db, uid, documentId, customerIds, deps: defaultDeps });

    // 氏名等の個人情報は出さない(IDと件数のみ)
    console.log(`[duplicateDocumentForCustomers] ${documentId}: created=${result.created.length} skipped=${result.skipped.length}`, {
      operation: 'duplicateDocumentForCustomers',
      event: 'manualDuplication',
      documentId,
      createdCount: result.created.length,
      skippedCount: result.skipped.length,
    });
    return result;
  }
);
