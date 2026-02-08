/**
 * CSVパーサーユーティリティ
 *
 * - Shift_JIS / UTF-8 対応
 * - ヘッダー自動検出
 * - 日本語カラム名対応
 */

/**
 * CSVをパースして行オブジェクトの配列を返す
 */
export function parseCSV(content: string): Record<string, string>[] {
  const lines = content.trim().split(/\r?\n/)
  if (lines.length < 2) return []

  // ヘッダー行を取得
  const headers = parseCSVLine(lines[0])
  const rows: Record<string, string>[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const values = parseCSVLine(line)
    const row: Record<string, string> = {}

    headers.forEach((header, index) => {
      row[header] = values[index]?.trim() || ''
    })

    rows.push(row)
  }

  return rows
}

/**
 * CSV行をパース（ダブルクォート対応）
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const nextChar = line[i + 1]

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        // エスケープされたダブルクォート
        current += '"'
        i++
      } else if (char === '"') {
        // クォート終了
        inQuotes = false
      } else {
        current += char
      }
    } else {
      if (char === '"') {
        // クォート開始
        inQuotes = true
      } else if (char === ',') {
        // フィールド区切り
        result.push(current)
        current = ''
      } else {
        current += char
      }
    }
  }

  result.push(current)
  return result
}

/**
 * ファイルからCSVを読み込む（Shift_JIS/UTF-8自動判定）
 */
export async function readCSVFile(file: File): Promise<string> {
  // まずUTF-8で読み込み
  let content = await file.text()

  // 文字化けチェック（日本語が含まれるはずなのに含まれない、または異常な文字がある）
  const hasGarbledText = /[\ufffd]/.test(content) ||
    (!/[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]/.test(content) && file.name.endsWith('.csv'))

  if (hasGarbledText) {
    // Shift_JISで再読み込み
    const decoder = new TextDecoder('shift_jis')
    const buffer = await file.arrayBuffer()
    content = decoder.decode(buffer)
  }

  return content
}

/**
 * 顧客マスター用のCSVマッピング
 */
export interface CustomerCSVRow {
  name: string
  furigana: string
  isDuplicate: boolean
  careManagerName?: string
  notes?: string
  aliases?: string
}

export function mapCustomerCSV(rows: Record<string, string>[]): CustomerCSVRow[] {
  return rows.map(row => ({
    name: row['name'] || row['顧客名'] || row['氏名'] || row['利用者名'] || '',
    furigana: row['furigana'] || row['フリガナ'] || row['ふりがな'] || '',
    isDuplicate: row['isDuplicate'] === 'true' || row['同姓同名'] === 'true' || row['重複'] === 'true',
    careManagerName: row['careManagerName'] || row['担当ケアマネ名'] || row['担当ケアマネ'] || row['担当CM'] || '',
    notes: row['notes'] || row['備考'] || '',
    aliases: row['aliases'] || row['別表記'] || '',
  })).filter(c => c.name) // 名前がない行は除外
}

/**
 * 事業所マスター用のCSVマッピング
 */
export interface OfficeCSVRow {
  name: string
  shortName?: string  // 後方互換（将来廃止予定）
  notes?: string
  aliases?: string
}

export function mapOfficeCSV(rows: Record<string, string>[]): OfficeCSVRow[] {
  return rows.map(row => ({
    name: row['name'] || row['事業所名'] || row['名称'] || '',
    shortName: row['shortName'] || row['略称'] || row['短縮名'] || '',  // 後方互換
    notes: row['notes'] || row['備考'] || row['メモ'] || '',
    aliases: row['aliases'] || row['別表記'] || '',
  })).filter(o => o.name) // 名前がない行は除外
}

/**
 * CSVテンプレートを生成
 */
export function generateCustomerCSVTemplate(): string {
  return `name,furigana,careManagerName,notes
山田太郎,ヤマダタロウ,佐藤花子,
田中花子,タナカハナコ,田中次郎,北区在住
`
}

export function generateOfficeCSVTemplate(): string {
  return `name,notes
○○介護サービス,
△△デイサービス,東部地区担当
`
}

/**
 * 書類種別マスター用のCSVマッピング
 */
export interface DocumentTypeCSVRow {
  name: string
  dateMarker: string
  category: string
  keywords: string
  aliases?: string
}

export function mapDocumentTypeCSV(rows: Record<string, string>[]): DocumentTypeCSVRow[] {
  return rows.map(row => ({
    name: row['name'] || row['書類名'] || row['書類種別'] || row['名称'] || '',
    dateMarker: row['dateMarker'] || row['日付マーカー'] || row['日付'] || '',
    category: row['category'] || row['カテゴリ'] || row['分類'] || '',
    keywords: row['keywords'] || row['キーワード'] || row['照合キーワード'] || '',
    aliases: row['aliases'] || row['別表記'] || '',
  })).filter(d => d.name) // 名前がない行は除外
}

export function generateDocumentTypeCSVTemplate(): string {
  return `name,dateMarker,category,keywords
介護保険被保険者証,有効期限,保険証,被保険者証;介護保険;要介護
訪問介護計画書,作成日,サービス計画,訪問介護;サービス内容
`
}

/**
 * ケアマネマスター用のCSVマッピング
 */
export interface CareManagerCSVRow {
  name: string
  email?: string
}

export function mapCareManagerCSV(rows: Record<string, string>[]): CareManagerCSVRow[] {
  return rows.map(row => ({
    name: row['name'] || row['ケアマネ名'] || row['氏名'] || row['名前'] || '',
    email: row['email'] || row['メールアドレス'] || row['メール'] || '',
  })).filter(c => c.name) // 名前がない行は除外
}

export function generateCareManagerCSVTemplate(): string {
  return `name,email
佐藤花子,sato@example.com
田中次郎,tanaka@example.com
`
}
