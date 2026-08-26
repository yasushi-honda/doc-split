/**
 * テキスト正規化ユーティリティ（フロントエンド用）
 *
 * - 外字・機種依存文字の変換
 * - Unicode正規化（NFKC）
 * - 全角/半角統一
 */

// 外字・機種依存文字マッピング(GAIJI_MAP)はIssue #812でBE側マッチング
// (functions/src/utils/textNormalizer.ts の normalizeCustomerNameForMatching)
// と共有するため shared/gaijiMap.ts へ移設した(内容は変更していない)。
// re-export ではなく import + export で local scope からも呼べるようにする
// (normalizeText 内で使用するため)。
import { normalizeGaiji } from '@shared/gaijiMap'
export { normalizeGaiji }

/**
 * Unicode NFKC正規化
 * - 全角英数字 → 半角
 * - 半角カタカナ → 全角
 * - 合成文字の分解・再合成
 */
export function normalizeUnicode(text: string): string {
  if (!text) return ''
  return text.normalize('NFKC')
}

/**
 * 全角スペース → 半角スペース
 */
export function normalizeSpaces(text: string): string {
  if (!text) return ''
  return text.replace(/\u3000/g, ' ')
}

/**
 * 連続する空白を1つに
 */
export function collapseSpaces(text: string): string {
  if (!text) return ''
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * 総合的なテキスト正規化
 *
 * @param text 入力テキスト
 * @param options オプション
 * @returns 正規化されたテキスト
 */
export function normalizeText(
  text: string,
  options: {
    gaiji?: boolean      // 外字変換（デフォルト: true）
    unicode?: boolean    // Unicode正規化（デフォルト: true）
    spaces?: boolean     // スペース正規化（デフォルト: true）
    collapse?: boolean   // 連続空白削除（デフォルト: false）
  } = {}
): string {
  const {
    gaiji = true,
    unicode = true,
    spaces = true,
    collapse = false,
  } = options

  let result = text || ''

  if (unicode) {
    result = normalizeUnicode(result)
  }

  if (gaiji) {
    result = normalizeGaiji(result)
  }

  if (spaces) {
    result = normalizeSpaces(result)
  }

  if (collapse) {
    result = collapseSpaces(result)
  }

  return result
}

/**
 * 名前用の正規化（顧客名・事業所名向け）
 * - 外字変換
 * - スペース正規化
 * - 前後の空白除去
 */
export function normalizeName(name: string): string {
  return normalizeText(name, {
    gaiji: true,
    unicode: true,
    spaces: true,
    collapse: true,
  })
}
