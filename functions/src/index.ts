/**
 * DocSplit Cloud Functions
 *
 * エントリーポイント: 全てのCloud Functionsをエクスポート
 */

import * as admin from 'firebase-admin';

// Firebase Admin初期化
admin.initializeApp();

// Gmail添付ファイル取得（Cloud Scheduler: 5分間隔）
export { checkGmailAttachments } from './gmail/checkGmailAttachments';

// OCR処理（定期実行）
export { processOCR } from './ocr/processOCR';

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
