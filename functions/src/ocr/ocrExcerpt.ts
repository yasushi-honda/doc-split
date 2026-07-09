/**
 * ADR-0018 (Issue #547): 一覧系UI用の軽量OCR抜粋 `ocrExcerpt` の算出ロジック。
 *
 * Phase B で ocrProcessor.ts のメインtransaction内にインライン実装されていたものを、
 * Phase C (backfill) が既存docの親フィールドから同一の値を再現できるよう共有ヘルパー化した。
 * 本番書込パス (ocrProcessor) と backfill (scripts/backfill-detail-subcollection.ts) と
 * 検証 (--verify の再計算照合) の3者が必ず同一実装を通ることで、算出式の乖離による
 * 偽の parity 不一致を構造的に防ぐ。
 *
 * Storage offload済み (ocrResultUrl セット時) は既存の placeholder 文言をそのまま格納する。
 *
 * 解消済み (review B2指摘、Phase D PR-D3で対応): frontend/src/hooks/useProcessingHistory.ts
 * の getOcrExcerpt() は同 placeholder 文言を独自ハードコードしていたが、Phase D で
 * `doc.ocrExcerpt`(本ヘルパーが書込済みの値)をそのまま返すだけに置換し、結合を解消した。
 * OCR_EXCERPT_OFFLOADED_PLACEHOLDER の文言を変更する場合、書込側は本ファイルのみで完結する。
 */

export const OCR_EXCERPT_MAX_LENGTH = 200;

export const OCR_EXCERPT_OFFLOADED_PLACEHOLDER =
  '（OCR結果はCloud Storageに保存されています）';

export function buildOcrExcerpt(
  ocrResult: string,
  ocrResultUrl: string | null | undefined
): string {
  return ocrResultUrl
    ? OCR_EXCERPT_OFFLOADED_PLACEHOLDER
    : ocrResult.slice(0, OCR_EXCERPT_MAX_LENGTH);
}
