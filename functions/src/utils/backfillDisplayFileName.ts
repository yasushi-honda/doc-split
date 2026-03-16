/**
 * displayFileName バックフィル用ヘルパー
 *
 * 既存ドキュメントの Firestore Timestamp を文字列に変換し、
 * generateDisplayFileName に渡すための変換ロジック。
 */

import { generateDisplayFileName } from './displayFileNameGenerator';

interface TimestampLike {
  seconds: number;
  nanoseconds: number;
  toDate?: () => Date;
}

/**
 * Firestore Timestamp（またはプレーンオブジェクト）を YYYY/MM/DD 文字列に変換
 */
export function timestampToDateString(
  ts: TimestampLike | null | undefined
): string | undefined {
  if (!ts || !ts.seconds) return undefined;

  const date = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

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
