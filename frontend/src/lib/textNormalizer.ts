/**
 * テキスト正規化ユーティリティ（フロントエンド用）
 *
 * - 外字・機種依存文字の変換
 * - Unicode正規化（NFKC）
 * - 全角/半角統一
 */

/**
 * 外字・機種依存文字マッピング
 * JIS第3・第4水準や機種依存文字を標準的な文字に変換
 */
const GAIJI_MAP: Record<string, string> = {
  // 旧字体 → 新字体
  '髙': '高',
  '﨑': '崎',
  '濵': '浜',
  '邊': '辺',
  '邉': '辺',
  '齋': '斎',
  '齊': '斉',
  '萬': '万',
  '廣': '広',
  '國': '国',
  '圀': '国',
  '德': '徳',
  '惠': '恵',
  '繪': '絵',
  '榮': '栄',
  '櫻': '桜',
  '龍': '竜',
  '澤': '沢',
  '橫': '横',
  '實': '実',
  '寬': '寛',
  '靜': '静',
  '學': '学',
  '藝': '芸',
  '豐': '豊',
  '禮': '礼',
  '會': '会',
  '傳': '伝',
  '圖': '図',
  '鷗': '鴎',
  '黑': '黒',
  '曾': '曽',
  '增': '増',

  // 囲み文字 → 括弧付き
  '㈱': '(株)',
  '㈲': '(有)',
  '㈳': '(社)',
  '㈴': '(名)',
  '㈵': '(特)',
  '㈶': '(財)',
  '㈷': '(祝)',
  '㈸': '(労)',
  '㈹': '(代)',
  '㈺': '(呼)',
  '㈻': '(学)',
  '㈼': '(監)',
  '㈽': '(企)',
  '㈾': '(資)',
  '㈿': '(協)',
  '㉀': '(祭)',
  '㉁': '(休)',
  '㉂': '(自)',
  '㉃': '(至)',

  // 丸囲み数字 → 数字
  '①': '1',
  '②': '2',
  '③': '3',
  '④': '4',
  '⑤': '5',
  '⑥': '6',
  '⑦': '7',
  '⑧': '8',
  '⑨': '9',
  '⑩': '10',
  '⑪': '11',
  '⑫': '12',
  '⑬': '13',
  '⑭': '14',
  '⑮': '15',
  '⑯': '16',
  '⑰': '17',
  '⑱': '18',
  '⑲': '19',
  '⑳': '20',

  // ローマ数字
  'Ⅰ': 'I',
  'Ⅱ': 'II',
  'Ⅲ': 'III',
  'Ⅳ': 'IV',
  'Ⅴ': 'V',
  'Ⅵ': 'VI',
  'Ⅶ': 'VII',
  'Ⅷ': 'VIII',
  'Ⅸ': 'IX',
  'Ⅹ': 'X',
  'ⅰ': 'i',
  'ⅱ': 'ii',
  'ⅲ': 'iii',
  'ⅳ': 'iv',
  'ⅴ': 'v',

  // その他の記号
  '〜': '～',
  '―': '-',
  '‐': '-',
  '－': '-',
  '—': '-',
  '〇': '0',
}

/**
 * 外字・機種依存文字を標準文字に変換
 */
export function normalizeGaiji(text: string): string {
  if (!text) return ''

  let result = text
  for (const [gaiji, standard] of Object.entries(GAIJI_MAP)) {
    result = result.replaceAll(gaiji, standard)
  }
  return result
}

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
