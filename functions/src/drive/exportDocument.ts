/**
 * Google Drive エクスポート・オーケストレータ(ADR-0022 Phase 1)
 *
 * doc読込 → フォルダパス解決(folderPath.ts) → find-or-createで降りる
 * (findOrCreateFolder.ts) → StorageからPDF取得 → Driveファイルの解決
 * (resolveDriveFile、下記) → driveFileId等を書戻し、の一連を実行する。
 *
 * Driveファイルの解決は2段階(code-review xhigh指摘対応、2026-07-21。trashed
 * チェック・404判定・重複検知の再確認は/code-review high指摘対応、同日):
 * 1. `doc.driveFileId`が既にある場合(過去にエクスポート済みで、reprocessでも
 *    クリアされずに保持されている参照。`frontend/src/hooks/useDocuments.ts`の
 *    `getReprocessClearFields()`参照)は、そのファイルが生きていて(404でない)
 *    ゴミ箱移動もされていない(`trashed`でない)ことを確認したうえで、同じ
 *    `appProperties`を持つ他ファイルが無いか再確認(過去のTOCTOU競合による
 *    孤児ファイル検知)してから、`files.update()`で移動(フォルダパスが変わった
 *    場合)・リネーム・内容更新を直接行う。これにより、再処理でフォルダパスが
 *    変わっても旧フォルダに孤児ファイルが残らず、フォルダパスが変わらない訂正でも
 *    内容が最新化される。
 * 2. `driveFileId`が無い(初回エクスポート)、ユーザーがDrive上で手動削除した(404)、
 *    またはゴミ箱移動した(trashed)場合は、`findOrUploadFile()`(appProperties経由の
 *    冪等性チェック付きfind-or-create)にフォールバックする。
 *
 * `driveExportStatus`のexporting遷移とerror時の書込みは呼び出し元
 * (`executeDriveExport.ts`)の責務。本関数はFuriganaMissingError /
 * AmbiguousFolderError / AmbiguousFileError / DriveSettingsIncompleteErrorを
 * そのままthrowし、呼び出し元がdriveExportStatus:'error'への遷移に使う
 * (fail-visible、Drive書き込みは発生しない)。
 *
 * `runId`は呼び出し元が発行した所有権トークン。成功時の最終書戻しは、書戻し直前に
 * 再読込した`driveExportRunId`が`runId`と一致する場合のみ行う(並行実行時に
 * 古い実行が新しい実行の状態を上書きしないためのガード、`executeDriveExport.ts`参照)。
 */

import * as admin from 'firebase-admin';
import { Readable } from 'node:stream';
import { drive_v3 } from 'googleapis';
import { withRetry, RETRY_CONFIGS } from '../utils/retry';
import { getDriveClient, getDriveSettings } from '../utils/driveAuth';
import { SUPPORTS_ALL_DRIVES, escapeQueryValue } from './driveApiConstants';
import { resolveFolderSegments, FolderPathDocInput } from './folderPath';
import { findOrCreateFolder } from './findOrCreateFolder';
import { MASTER_PATHS } from '../utils/masterPaths';
import type { Document, CustomerMaster, DriveFolderTemplate } from '../../../shared/types';

const db = admin.firestore();
const storage = admin.storage();

/** テスト時に外部依存(Drive API / Storage)を差し替えるための注入ポイント。 */
export interface ExportDocumentDeps {
  drive: drive_v3.Drive;
  downloadFile: (fileUrl: string) => Promise<Buffer>;
}

async function defaultDownloadFile(fileUrl: string): Promise<Buffer> {
  const bucket = storage.bucket();
  const filePath = fileUrl.replace(`gs://${bucket.name}/`, '');
  const file = bucket.file(filePath);
  const [buffer] = await withRetry(() => file.download(), RETRY_CONFIGS.storage);
  return buffer;
}

/**
 * `settings/drive`が未接続/未設定の状態で呼ばれた場合にthrow。
 * 呼び出し元（トリガー）はこれを捕捉し `driveExportStatus: 'error'` に遷移させる。
 */
export class DriveSettingsIncompleteError extends Error {
  constructor(missingField: string) {
    super(`Google Drive連携の設定が未完了です(${missingField}が未設定)`);
    this.name = 'DriveSettingsIncompleteError';
  }
}

/**
 * 同一docId(`appProperties.docSplitDocId`)のファイルが親フォルダ内に2件以上見つかった
 * 場合にthrow。フォルダの`AmbiguousFolderError`と同じくfail-visibleを優先する。
 */
export class AmbiguousFileError extends Error {
  constructor(docId: string, parentId: string, count: number) {
    super(
      `過去にアップロード済みのファイルが重複しているため解決できません(${count}件): docId=${docId}（親フォルダ: ${parentId}）`
    );
    this.name = 'AmbiguousFileError';
  }
}

/**
 * `resolveDriveFile()`のフォールバック経路。`parentId`直下から
 * `appProperties.docSplitDocId===docId`のファイルを検索し、見つかればそのidを
 * 再利用(アップロードをスキップ)、0件なら新規アップロードする。
 *
 * 過去の実行がDriveへのアップロードに成功したがFirestoreへの書戻し前にクラッシュ/
 * 失敗した場合、`driveFileId`はFirestore側に記録されないため通常は再アップロードの
 * 判断材料がない。`appProperties`にdocId自身を刻んでおくことで、そのdocの過去の
 * 孤児アップロードのみを安全に再利用できる(ファイル名は同一顧客・同一書類種別・
 * 同一年月で複数docが衝突しうる生成値のため、名前ベースの検索は別docのファイルを
 * 誤って採用するリスクがあり採用しない)。
 */
async function findOrUploadFile(
  drive: drive_v3.Drive,
  parentId: string,
  docId: string,
  doc: Document,
  deps: Partial<ExportDocumentDeps>
): Promise<string> {
  const q =
    `'${parentId}' in parents and appProperties has ` +
    `{ key='docSplitDocId' and value='${escapeQueryValue(docId)}' } and trashed=false`;

  const listResponse = await drive.files.list({
    q,
    fields: 'files(id, name)',
    includeItemsFromAllDrives: true,
    ...SUPPORTS_ALL_DRIVES,
  });

  const files = listResponse.data.files ?? [];

  if (files.length > 1) {
    throw new AmbiguousFileError(docId, parentId, files.length);
  }

  if (files.length === 1) {
    const existingId = files[0].id;
    if (!existingId) {
      throw new Error(`既存ファイルのidが取得できません: docId=${docId}`);
    }
    return existingId;
  }

  const downloadFile = deps.downloadFile ?? defaultDownloadFile;
  const buffer = await downloadFile(doc.fileUrl);

  const createResponse = await drive.files.create({
    requestBody: {
      name: doc.displayFileName || doc.fileName,
      parents: [parentId],
      appProperties: { docSplitDocId: docId },
    },
    media: {
      mimeType: doc.mimeType,
      body: Readable.from(buffer),
    },
    fields: 'id',
    ...SUPPORTS_ALL_DRIVES,
  });

  const driveFileId = createResponse.data.id;
  if (!driveFileId) {
    throw new Error(`Drive上のファイル作成に失敗しました(idが返却されませんでした): ${docId}`);
  }
  return driveFileId;
}

/**
 * Drive APIの`files.get()`がファイル参照切れ(404)を返したかどうかを判定する。
 *
 * googleapis/gaxiosのエラーオブジェクトは、HTTPステータスを`error.status`
 * (まれに`error.response.status`)に設定し、`error.code`はnetwork層エラー
 * (例:'ECONNRESET')専用でHTTPステータスには使われない(実機のgaxios実装で確認済み)。
 * `error.code`のみを見る単純な数値比較では本番で常にfalseになり、意図した
 * フォールバックが機能しない(`is429Error`/`functions/src/utils/retry.ts`と同じ懸念)。
 */
function isDriveFileNotFoundError(error: unknown): boolean {
  const err = error as { code?: number | string; status?: number; response?: { status?: number } };
  return err?.status === 404 || err?.code === 404 || err?.response?.status === 404;
}

/**
 * `parentId`直下に`docId`の`appProperties.docSplitDocId`と一致する`knownFileId`
 * 以外のファイルが存在する場合、`AmbiguousFileError`をthrowする。
 *
 * `driveFileId`優先パス(`resolveDriveFile()`)は、`findOrUploadFile()`が持つ
 * appPropertiesベースの重複検知を経由しないため、driveFileId確定後の全ての
 * エクスポートで重複検知が恒久的にスキップされてしまう(過去のTOCTOU競合等で
 * 生成された孤児ファイルが未検知のまま放置される)。ADRのfail-visible方針
 * (「以後AmbiguousFileErrorで恒久停止」)を毎回再確認する。
 */
async function assertNoDuplicateFile(
  drive: drive_v3.Drive,
  parentId: string,
  docId: string,
  knownFileId: string
): Promise<void> {
  const q =
    `'${parentId}' in parents and appProperties has ` +
    `{ key='docSplitDocId' and value='${escapeQueryValue(docId)}' } and trashed=false`;

  const listResponse = await drive.files.list({
    q,
    fields: 'files(id, name)',
    includeItemsFromAllDrives: true,
    ...SUPPORTS_ALL_DRIVES,
  });

  const files = listResponse.data.files ?? [];
  const others = files.filter((file) => file.id !== knownFileId);
  if (others.length > 0) {
    throw new AmbiguousFileError(docId, parentId, files.length);
  }
}

/**
 * `doc.driveFileId`(過去にエクスポート済みの実体への参照。reprocessでもクリアされない)
 * があれば、そのファイルへ移動(フォルダパスが変わった場合)・リネーム・内容更新を
 * 1回の`files.update()`で行い、同じidを返す(code-review xhigh指摘対応、2026-07-21)。
 * ファイルがDrive上で見つからない(手動削除、404)場合や、ゴミ箱移動済み(`trashed`)
 * の場合は`findOrUploadFile()`(appProperties経由のfind-or-create)にフォールバック
 * する(`drive.file`スコープでは完全削除不可・ゴミ箱移動のみ許可のため、ADR-0022
 * Decision2、trashedを見逃すとゴミ箱内ファイルへ不可視のまま上書きし続けるsilent
 * failureになる)。404以外のエラーはfail-visible方針のためそのままthrowする
 * (呼び出し元がdriveExportStatus:'error'に遷移させる)。
 */
async function resolveDriveFile(
  drive: drive_v3.Drive,
  parentId: string,
  docId: string,
  doc: Document,
  deps: Partial<ExportDocumentDeps>
): Promise<string> {
  if (doc.driveFileId) {
    let currentParents: string[] | undefined;
    try {
      const getResponse = await drive.files.get({
        fileId: doc.driveFileId,
        fields: 'parents, trashed',
        supportsAllDrives: true,
      });
      if (!getResponse.data.trashed) {
        currentParents = getResponse.data.parents ?? [];
      }
      // trashed: currentParentsをundefinedのまま残し、下のfindOrUploadFile()へフォールバックする
    } catch (error) {
      if (!isDriveFileNotFoundError(error)) {
        throw error;
      }
      // 404: ユーザーがDrive上で手動削除した等 → 新規アップロードにフォールバックする
    }

    if (currentParents) {
      await assertNoDuplicateFile(drive, parentId, docId, doc.driveFileId);
      const removeParents = currentParents.filter((parent) => parent !== parentId);
      const downloadFile = deps.downloadFile ?? defaultDownloadFile;
      const buffer = await downloadFile(doc.fileUrl);
      await drive.files.update({
        fileId: doc.driveFileId,
        addParents: parentId,
        ...(removeParents.length > 0 ? { removeParents: removeParents.join(',') } : {}),
        requestBody: { name: doc.displayFileName || doc.fileName },
        media: {
          mimeType: doc.mimeType,
          body: Readable.from(buffer),
        },
        fields: 'id',
        ...SUPPORTS_ALL_DRIVES,
      });
      return doc.driveFileId;
    }
  }

  return findOrUploadFile(drive, parentId, docId, doc, deps);
}

/**
 * 1件のdocumentをGoogle Driveへエクスポートする。
 */
export async function exportDocument(
  docId: string,
  runId: string,
  deps: Partial<ExportDocumentDeps> = {}
): Promise<void> {
  const docRef = db.doc(`documents/${docId}`);
  const docSnap = await docRef.get();
  if (!docSnap.exists) {
    throw new Error(`document not found: ${docId}`);
  }
  const doc = docSnap.data() as Document;

  const settings = await getDriveSettings();
  const { rootFolderId } = settings;
  if (!rootFolderId) {
    throw new DriveSettingsIncompleteError('rootFolderId');
  }
  const template: DriveFolderTemplate | undefined = settings.template;
  if (!template || template.length === 0) {
    throw new DriveSettingsIncompleteError('template');
  }

  let customerFurigana: string | undefined;
  if (doc.customerId) {
    const customerSnap = await db.doc(`${MASTER_PATHS.customers}/${doc.customerId}`).get();
    customerFurigana = (customerSnap.data() as CustomerMaster | undefined)?.furigana;
  }

  const docInput: FolderPathDocInput = {
    careManagerName: doc.careManager ?? '',
    customerName: doc.customerName,
    customerFurigana,
    documentCategory: doc.documentType,
    fileDate: doc.fileDate.toDate(),
  };

  const segments = resolveFolderSegments(docInput, template, {
    furiganaFallback: settings.furiganaFallback,
  });

  const drive = deps.drive ?? (await getDriveClient());
  let parentId = rootFolderId;
  for (const segmentName of segments) {
    parentId = await findOrCreateFolder(drive, parentId, segmentName);
  }

  const driveFileId = await resolveDriveFile(drive, parentId, docId, doc, deps);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists || snap.data()?.driveExportRunId !== runId) {
      return; // 他の実行に引き継がれている(superseded) → 新しい状態を上書きしない
    }
    tx.update(docRef, {
      driveFileId,
      driveExportedAt: admin.firestore.FieldValue.serverTimestamp(),
      driveExportStatus: 'exported',
    });
  });
}
