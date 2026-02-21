/**
 * DocSplit Cloud Functions
 *
 * エントリーポイント: 全てのCloud Functionsをエクスポート
 */

import * as admin from 'firebase-admin';

// Firebase Admin初期化
admin.initializeApp({
  storageBucket: process.env.STORAGE_BUCKET,
});

// Gmail添付ファイル取得（Cloud Scheduler: 5分間隔）
export { checkGmailAttachments } from './gmail/checkGmailAttachments';

// Gmail OAuth認証コード交換（Callable Function）
export { exchangeGmailAuthCode } from './gmail/exchangeGmailAuthCode';

// OCR処理（定期実行 - メイン処理パス）
export { processOCR } from './ocr/processOCR';

// processOCROnCreate は廃止（ADR-0010）。ポーリング（processOCR）に一本化。
// ファイルはロールバック用に保持: './ocr/processOCROnCreate'

// OCR全文取得（Callable Function - Phase 7）
export { getOcrText } from './ocr/getOcrText';

// AI要約再生成（Callable Function）
export { regenerateSummary } from './ocr/regenerateSummary';

// PDF編集操作（Callable Functions）
export {
  detectSplitPoints,
  splitPdf,
  rotatePdfPages,
} from './pdf/pdfOperations';

// 管理用関数（マスターデータシード等）
export {
  seedDocumentMasters,
  seedAllMasters,
} from './admin/seedMasters';

// マスターデータ操作（エイリアス追加・削除）
export {
  addMasterAlias,
  removeMasterAlias,
} from './admin/masterOperations';

// Phase 8: ドキュメントグループ集計トリガー
export { onDocumentWrite } from './triggers/updateDocumentGroups';

// 検索機能
export { searchDocuments } from './search/searchDocuments';
export { onDocumentWriteSearchIndex } from './search/searchIndexer';

// PDFアップロード
export { uploadPdf } from './upload/uploadPdf';

// ドキュメント削除
export { deleteDocument } from './documents/deleteDocument';

// テナント初期化（一時的）
export { initTenantSettings, registerAdminUser } from './admin/initTenant';
