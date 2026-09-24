/**
 * CSVパーサーユーティリティ
 *
 * - Shift_JIS / UTF-8 対応
 * - ヘッダー自動検出
 * - 日本語カラム名対応
 */

/**
 * CSVをパースして行オブジェクトの配列を返す
 *
 * ダブルクォートで囲んだフィールド内の改行(\r\n/\n/\r)はレコード区切りとして
 * 扱わない(RFC4180準拠)。改行で先に行分割してからフィールドを読む実装だと、
 * 備考等クォート内改行を含む値でレコードが分断される不具合があったため、
 * 文字単位でクォート状態を追跡しながらレコード境界を判定する(Issue #1036)。
 */
export function parseCSV(content: string): Record<string, string>[] {
  const records = parseCSVRecords(content.trim())
  if (records.length < 2) return []

  const headers = records[0]!
  const rows: Record<string, string>[] = []

  for (let i = 1; i < records.length; i++) {
    const values = records[i]!
    // 完全に空の行(1フィールドのみで空文字)はスキップ(空行を無視する既存動作を踏襲)
    if (values.length === 1 && values[0] === '') continue

    const row: Record<string, string> = {}
    headers.forEach((header, index) => {
      row[header] = values[index]?.trim() || ''
    })

    rows.push(row)
  }

  return rows
}

/**
 * CSV全体をレコード(フィールド配列)の配列にパース（ダブルクォート対応・クォート内改行対応）
 */
function parseCSVRecords(content: string): string[][] {
  const records: string[][] = []
  let currentRecord: string[] = []
  let current = ''
  let inQuotes = false
  let i = 0
  const len = content.length

  while (i < len) {
    const char = content[i]
    const nextChar = content[i + 1]

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        // エスケープされたダブルクォート
        current += '"'
        i += 2
      } else if (char === '"') {
        // クォート終了
        inQuotes = false
        i++
      } else {
        // クォート内の改行・カンマもフィールドの一部としてそのまま取り込む
        current += char
        i++
      }
    } else if (char === '"') {
      // クォート開始
      inQuotes = true
      i++
    } else if (char === ',') {
      // フィールド区切り
      currentRecord.push(current)
      current = ''
      i++
    } else if (char === '\r' || char === '\n') {
      // レコード区切り(\r\n は1つとして扱う)
      currentRecord.push(current)
      current = ''
      records.push(currentRecord)
      currentRecord = []
      i += char === '\r' && nextChar === '\n' ? 2 : 1
    } else {
      current += char
      i++
    }
  }

  // ダブルクォートが閉じられないまま終端に達した場合、以降の内容が全て1フィールドに
  // 吸収されレコードがサイレントに消失する(silent-failure-hunter指摘)。検知してエラーにする
  if (inQuotes) {
    throw new Error('CSVの形式が不正です(ダブルクォートが閉じられていません)')
  }

  // 末尾に改行が無いまま終わった最後のフィールド/レコードを確定する
  if (current !== '' || currentRecord.length > 0) {
    currentRecord.push(current)
    records.push(currentRecord)
  }

  return records
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
  id?: string // エクスポートしたCSVのID列（再インポート時のID一致判定に使用。Issue #1036）
}

export function mapCustomerCSV(rows: Record<string, string>[]): CustomerCSVRow[] {
  return rows.map(row => ({
    name: row['name'] || row['顧客名'] || row['氏名'] || row['利用者名'] || '',
    furigana: row['furigana'] || row['フリガナ'] || row['ふりがな'] || '',
    isDuplicate: row['isDuplicate'] === 'true' || row['同姓同名'] === 'true' || row['重複'] === 'true',
    careManagerName: row['careManagerName'] || row['担当ケアマネ名'] || row['担当ケアマネ'] || row['担当CM'] || '',
    notes: row['notes'] || row['備考'] || '',
    aliases: row['aliases'] || row['別表記'] || '',
    id: row['id'] || row['ID'] || undefined,
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
  id?: string // エクスポートしたCSVのID列（再インポート時のID一致判定に使用。Issue #1036）
}

export function mapOfficeCSV(rows: Record<string, string>[]): OfficeCSVRow[] {
  return rows.map(row => ({
    name: row['name'] || row['事業所名'] || row['名称'] || '',
    shortName: row['shortName'] || row['略称'] || row['短縮名'] || '',  // 後方互換
    notes: row['notes'] || row['備考'] || row['メモ'] || '',
    aliases: row['aliases'] || row['別表記'] || '',
    id: row['id'] || row['ID'] || undefined,
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
