/**
 * マスターデータのCSVエクスポート（Issue #1036）
 *
 * 既存データをCSVとして書き出し、編集して再インポートする一括修正機能の起点。
 * CSV_TEMPLATES（csvTemplates.ts）と同じ列順・区切り文字（別表記=|、キーワード=;）で
 * 書き出す。日本語見出し（headerLabels）は使わず、常に英語名の`headers`を使う
 * ——既存パーサー（csvParser.ts）が探す見出しキー（例:「別表記」）と
 * headerLabels（例:「別表記（|区切り）」）は文字列が一致しないため、再インポート時に
 * 該当列が失われてしまう（/plan-crossreview codex pass1/2で確認済み）。
 */

import type { CustomerMaster, OfficeMaster, DocumentMaster, CareManagerMaster } from '@shared/types'
import { CSV_TEMPLATES, downloadCsvContent } from './csvTemplates'

const ALIAS_SEPARATOR = '|'
const KEYWORD_SEPARATOR = ';'

/**
 * RFC4180準拠のCSVフィールドエスケープ
 * カンマ・ダブルクォート・改行(\r/\n)を含む場合はダブルクォートで囲み、
 * 内部のダブルクォートは二重化する。
 */
function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function buildCsvRow(fields: string[]): string {
  return fields.map(escapeCsvField).join(',')
}

function todayYYYYMMDD(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

/**
 * 顧客マスターをCSV文字列にエクスポート（先頭にID列付き）
 */
export function exportCustomersToCsv(customers: CustomerMaster[]): string {
  const headers = ['id', ...CSV_TEMPLATES.customers.headers]
  const lines = [buildCsvRow(headers)]
  for (const c of customers) {
    lines.push(buildCsvRow([
      c.id,
      c.name,
      c.furigana ?? '',
      c.careManagerName ?? '',
      c.notes ?? '',
      (c.aliases ?? []).join(ALIAS_SEPARATOR),
    ]))
  }
  return lines.join('\n')
}

/**
 * 事業所マスターをCSV文字列にエクスポート（先頭にID列付き）
 */
export function exportOfficesToCsv(offices: OfficeMaster[]): string {
  const headers = ['id', ...CSV_TEMPLATES.offices.headers]
  const lines = [buildCsvRow(headers)]
  for (const o of offices) {
    lines.push(buildCsvRow([
      o.id,
      o.name,
      o.notes ?? '',
      (o.aliases ?? []).join(ALIAS_SEPARATOR),
    ]))
  }
  return lines.join('\n')
}

/**
 * 書類種別マスターをCSV文字列にエクスポート（ID列なし。doc ID=nameのため）
 */
export function exportDocumentTypesToCsv(documentTypes: DocumentMaster[]): string {
  const headers = [...CSV_TEMPLATES.documents.headers]
  const lines = [buildCsvRow(headers)]
  for (const d of documentTypes) {
    lines.push(buildCsvRow([
      d.name,
      d.dateMarker ?? '',
      d.category ?? '',
      (d.keywords ?? []).join(KEYWORD_SEPARATOR),
      (d.aliases ?? []).join(ALIAS_SEPARATOR),
    ]))
  }
  return lines.join('\n')
}

/**
 * ケアマネマスターをCSV文字列にエクスポート（ID列なし。名前ベース突合を継続）
 */
export function exportCareManagersToCsv(careManagers: CareManagerMaster[]): string {
  const headers = [...CSV_TEMPLATES.caremanagers.headers]
  const lines = [buildCsvRow(headers)]
  for (const cm of careManagers) {
    lines.push(buildCsvRow([
      cm.name,
      cm.email ?? '',
    ]))
  }
  return lines.join('\n')
}

export function downloadCustomersCsv(customers: CustomerMaster[]): void {
  downloadCsvContent(exportCustomersToCsv(customers), `customers_export_${todayYYYYMMDD()}.csv`)
}

export function downloadOfficesCsv(offices: OfficeMaster[]): void {
  downloadCsvContent(exportOfficesToCsv(offices), `offices_export_${todayYYYYMMDD()}.csv`)
}

export function downloadDocumentTypesCsv(documentTypes: DocumentMaster[]): void {
  downloadCsvContent(exportDocumentTypesToCsv(documentTypes), `documenttypes_export_${todayYYYYMMDD()}.csv`)
}

export function downloadCareManagersCsv(careManagers: CareManagerMaster[]): void {
  downloadCsvContent(exportCareManagersToCsv(careManagers), `caremanagers_export_${todayYYYYMMDD()}.csv`)
}
