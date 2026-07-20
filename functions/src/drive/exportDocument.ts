/**
 * Google Drive エクスポート・オーケストレータ(ADR-0022 Phase 1)
 *
 * doc読込 → フォルダパス解決(folderPath.ts) → find-or-createで降りる
 * (findOrCreateFolder.ts) → StorageからPDF取得 → files.create →
 * driveFileId等を書戻し、の一連を実行する。
 *
 * `driveExportStatus`のpending/exporting遷移とerror時の書込みは呼び出し元
 * (`driveExportTrigger.ts`)の責務。本関数はFuriganaMissingError /
 * AmbiguousFolderError / DriveSettingsIncompleteErrorをそのままthrowし、
 * 呼び出し元がdriveExportStatus:'error'への遷移に使う(fail-visible、
 * Drive書き込みは発生しない)。
 */

import * as admin from 'firebase-admin';
import { Readable } from 'node:stream';
import { drive_v3 } from 'googleapis';
import { withRetry, RETRY_CONFIGS } from '../utils/retry';
import { getDriveClient, getDriveSettings } from '../utils/driveAuth';
import { SUPPORTS_ALL_DRIVES } from './driveApiConstants';
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
 * 1件のdocumentをGoogle Driveへエクスポートする。
 */
export async function exportDocument(
  docId: string,
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

  const downloadFile = deps.downloadFile ?? defaultDownloadFile;
  const buffer = await downloadFile(doc.fileUrl);

  const createResponse = await drive.files.create({
    requestBody: {
      name: doc.displayFileName || doc.fileName,
      parents: [parentId],
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

  await docRef.update({
    driveFileId,
    driveExportedAt: admin.firestore.FieldValue.serverTimestamp(),
    driveExportStatus: 'exported',
  });
}
