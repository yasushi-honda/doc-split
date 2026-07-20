/**
 * Google Drive エクスポート・オーケストレータ(ADR-0022 Phase 1)
 *
 * doc読込 → フォルダパス解決(folderPath.ts) → find-or-createで降りる
 * (findOrCreateFolder.ts) → StorageからPDF取得 → find-or-upload(appProperties経由の
 * 冪等性チェック付き) → driveFileId等を書戻し、の一連を実行する。
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
 * `parentId`直下から`appProperties.docSplitDocId===docId`のファイルを検索し、
 * 見つかればそのidを再利用(アップロードをスキップ)、0件なら新規アップロードする。
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

  const driveFileId = await findOrUploadFile(drive, parentId, docId, doc, deps);

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
