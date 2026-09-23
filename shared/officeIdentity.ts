/**
 * 事業所の有効性判定（FE/BE/スクリプト共通）。
 *
 * `isValidCustomerSelection` が `shared/customerIdentity.ts` へ移設済みなのと同じ理由で、
 * `functions/src/ocr` や `scripts/` からも参照できるよう shared 化する
 * （`frontend/src/lib/documentUtils.ts` は re-export のみに変更、既存importerは無修正で動く）。
 */

export const OFFICE_INVALID_SENTINELS: ReadonlySet<string> = new Set(['未判定', '不明事業所']);

/**
 * 事業所名が「確定可能な有効値」かを判定する。
 * 空文字・null・undefined・空白のみ・sentinel 値（'未判定'/'不明事業所'）は false を返す。
 */
export function isValidOfficeSelection(name: string | null | undefined): boolean {
  if (name == null) return false;
  const trimmed = name.trim();
  if (trimmed === '') return false;
  return !OFFICE_INVALID_SENTINELS.has(trimmed);
}
