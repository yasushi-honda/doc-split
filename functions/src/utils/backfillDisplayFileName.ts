/**
 * displayFileName バックフィル用ヘルパー
 *
 * Firestore ドキュメントから displayFileName を生成する backfill 固有ロジック。
 * Timestamp → string 変換は utils/timestampHelpers に抽出済み (本番 pdfOperations 共用)。
 */

import { generateDisplayFileName } from '../../../shared/generateDisplayFileName';
import {
  type TimestampLike,
  timestampToDateString,
} from './timestampHelpers';

interface DocData {
  documentType?: string;
  customerName?: string;
  officeName?: string;
  fileDate?: TimestampLike | null;
}

/**
 * Firestore ドキュメントデータから displayFileName を生成
 */
export function buildDisplayFileNameFromDoc(doc: DocData): string | null {
  return generateDisplayFileName({
    documentType: doc.documentType || undefined,
    customerName: doc.customerName || undefined,
    officeName: doc.officeName || undefined,
    fileDate: timestampToDateString(doc.fileDate),
  });
}

// #358: 純粋関数は shared/ に配置 (scripts / functions 両方から直接 import するため)。
// functions/ 側からはこの re-export 経由でも利用可能。
export {
  detectDisplayFileNameChange,
  type DisplayFileNameChange,
} from '../../../shared/detectDisplayFileNameChange';
