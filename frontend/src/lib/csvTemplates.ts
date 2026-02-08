/**
 * CSVテンプレート生成・ダウンロードユーティリティ
 */

// テンプレート定義
export const CSV_TEMPLATES = {
  customers: {
    headers: ['name', 'furigana', 'careManagerName', 'notes', 'aliases'],
    headerLabels: ['顧客名', 'フリガナ', '担当ケアマネ名', '備考', '別表記（|区切り）'],
    example: ['山田太郎', 'ヤマダタロウ', '佐藤花子', '北区在住', 'やまだ太郎|山田 太郎'],
    filename: 'customers_template.csv',
  },
  documents: {
    headers: ['name', 'dateMarker', 'category', 'keywords', 'aliases'],
    headerLabels: ['書類種別名', '日付マーカー', 'カテゴリ', 'キーワード（;区切り）', '別表記（|区切り）'],
    example: ['介護保険被保険者証', '有効期限', '保険証', '被保険者証;介護保険;要介護', '被保険者証|介護保険証'],
    filename: 'documents_template.csv',
  },
  offices: {
    headers: ['name', 'notes', 'aliases'],
    headerLabels: ['事業所名', '備考', '別表記（|区切り）'],
    example: ['〇〇訪問介護ステーション', '東部地区担当', '〇〇訪問介護|○○訪問介護'],
    filename: 'offices_template.csv',
  },
  caremanagers: {
    headers: ['name', 'email'],
    headerLabels: ['ケアマネ名', 'メールアドレス'],
    example: ['佐藤花子', 'sato@example.com'],
    filename: 'caremanagers_template.csv',
  },
} as const

export type TemplateType = keyof typeof CSV_TEMPLATES

/**
 * CSVテンプレート文字列を生成
 * @param type テンプレート種別
 * @param includeExample サンプル行を含めるか
 */
export function generateCsvTemplate(type: TemplateType, includeExample = true): string {
  const template = CSV_TEMPLATES[type]
  const lines = [template.headers.join(',')]

  if (includeExample) {
    lines.push(template.example.join(','))
  }

  return lines.join('\n')
}

/**
 * CSVテンプレートをダウンロード
 * @param type テンプレート種別
 * @param includeExample サンプル行を含めるか
 */
export function downloadCsvTemplate(type: TemplateType, includeExample = true): void {
  const template = CSV_TEMPLATES[type]
  const content = generateCsvTemplate(type, includeExample)

  // BOM付きUTF-8でダウンロード（Excel対応）
  const bom = new Uint8Array([0xef, 0xbb, 0xbf])
  const blob = new Blob([bom, content], { type: 'text/csv;charset=utf-8' })

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = template.filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
