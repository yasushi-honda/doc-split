/**
 * 検索結果ソート関数
 *
 * 並び順:
 *   1. fileDate desc（NULLS LAST: 日付不明は末尾）
 *   2. score desc（同日内は関連度順）
 *   3. processedAt desc（OCR 処理完了日時、タイブレーク）
 *   4. docId asc（最終安定タイブレーク、ページ境界での順序ブレ防止）
 */

/** ソート対象のドキュメント情報 */
export interface SortableSearchDoc {
  docId: string;
  score: number;
  /** fileDate のミリ秒（null = 日付不明 → NULLS LAST） */
  fileDateMs: number | null;
  /** processedAt のミリ秒（タイブレーク用、未設定は 0） */
  processedAtMs: number;
  data: FirebaseFirestore.DocumentData;
}

/**
 * Firestore Timestamp を ms に安全変換する。
 *
 * 旧データ・手動投入・マイグレーション中間状態で `fileDate` 等が
 * Timestamp 以外（string/Date/plain object 等）になっている場合、
 * 直接 `.toMillis()` を呼ぶと TypeError で検索全体が 500 落ちする。
 * 例外を握りつぶして null を返し、warn ログのみ残す。
 */
export function safeToMillis(value: unknown, docId: string, field: string): number | null {
  if (value == null) return null;
  const candidate = value as { toMillis?: () => number };
  if (typeof candidate.toMillis !== 'function') {
    console.warn(`[searchDocuments] ${field} is not a Timestamp`, {
      docId,
      type: typeof value,
    });
    return null;
  }
  try {
    return candidate.toMillis();
  } catch (e) {
    console.warn(`[searchDocuments] toMillis() failed for ${field}`, {
      docId,
      error: String(e),
    });
    return null;
  }
}

/**
 * 検索結果のソート比較関数
 */
export function compareSearchResults(a: SortableSearchDoc, b: SortableSearchDoc): number {
  // 1. fileDate desc nulls last
  if (a.fileDateMs !== b.fileDateMs) {
    if (a.fileDateMs === null) return 1;
    if (b.fileDateMs === null) return -1;
    return b.fileDateMs - a.fileDateMs;
  }
  // 2. score desc
  if (a.score !== b.score) return b.score - a.score;
  // 3. processedAt desc
  if (a.processedAtMs !== b.processedAtMs) return b.processedAtMs - a.processedAtMs;
  // 4. docId asc
  return a.docId.localeCompare(b.docId);
}
