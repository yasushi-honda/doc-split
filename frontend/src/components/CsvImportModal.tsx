/**
 * CSVインポートモーダル
 *
 * 顧客・事業所・ケアマネ・書類種別マスターの一括インポートUI
 * - 同名データは差分表示し、上書き/スキップを選択可能
 */

import { useState, useRef, useEffect, useMemo, Fragment } from 'react'
import { Upload, FileText, AlertCircle, CheckCircle2, Download, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Checkbox } from '@/components/ui/checkbox'
import {
  parseCSV,
  readCSVFile,
  mapCustomerCSV,
  mapOfficeCSV,
  mapCareManagerCSV,
  mapDocumentTypeCSV,
  generateCustomerCSVTemplate,
  generateOfficeCSVTemplate,
  generateCareManagerCSVTemplate,
  generateDocumentTypeCSVTemplate,
  type CustomerCSVRow,
  type OfficeCSVRow,
  type CareManagerCSVRow,
  type DocumentTypeCSVRow,
} from '@/lib/csvParser'
import {
  checkCustomerDuplicatesWithDetails,
  checkOfficeDuplicatesWithDetails,
  checkCareManagerDuplicatesWithDetails,
  checkDocumentTypeDuplicatesWithDetails,
  type ImportAction,
  type DuplicateCheckResultWithDetails,
  type BulkImportResultDetailed,
} from '@/hooks/useMasters'
import { matchRowsById, type CsvRowWithId, type ExistingRecordWithId } from '@/lib/csvImportMatching'

type ImportType = 'customer' | 'office' | 'caremanager' | 'documenttype'

// 汎用データ型
type AnyCSVData = CustomerCSVRow | OfficeCSVRow | CareManagerCSVRow | DocumentTypeCSVRow

// プレビュー行データ
interface PreviewRow {
  csvData: AnyCSVData
  existingData: AnyCSVData | null
  isDuplicate: boolean
  isExactMatch: boolean  // 完全一致かどうか
  action: ImportAction
  existingId?: string
  /** 'id'の場合、ID列による一致行(顧客・事業所のみ。Issue #1036) */
  matchedBy?: 'id'
}

interface CsvImportModalProps {
  type: ImportType
  isOpen: boolean
  onClose: () => void
  onImport: (items: { data: AnyCSVData; existingId?: string; action: ImportAction }[]) => Promise<BulkImportResultDetailed>
  /**
   * ID列による厳密突合の対象となる既存レコード一覧(顧客・事業所のみ渡す、Issue #1036)。
   * CustomerMaster[]/OfficeMaster[]等、id・name以外に備考・別表記等のフィールドを
   * 持つ配列をそのまま渡してよい(ID一致行の差分プレビューに使う。取得はgetCellValueで
   * Record<string, unknown>へキャストして行う)。
   */
  existingRecords?: ExistingRecordWithId[]
}

// 完全一致判定（全カラムが同じかどうか）
// CSVが空欄のセルは比較対象から除外する(空欄=変更しない、のため差分として扱わない。Issue #1036)
function isExactMatchData(
  type: ImportType,
  csvData: AnyCSVData,
  existingData: AnyCSVData | null
): boolean {
  if (!existingData) return false

  const config = TYPE_CONFIG[type]
  return config.columns.every(col => {
    const csvValue = (csvData as unknown as Record<string, unknown>)[col.key] ?? ''
    const csvValueStr = String(csvValue).trim()
    if (csvValueStr === '') return true
    const existingValue = (existingData as unknown as Record<string, unknown>)[col.key] ?? ''
    return csvValueStr === String(existingValue).trim()
  })
}

// マスター別設定
const TYPE_CONFIG = {
  customer: {
    name: '顧客',
    columns: [
      { key: 'name', label: '顧客名' },
      { key: 'furigana', label: 'フリガナ' },
      { key: 'careManagerName', label: '担当ケアマネ' },
      { key: 'notes', label: '備考' },
      { key: 'aliases', label: '別表記' },
    ],
    defaultAction: 'add' as ImportAction,
    description: '同名は別人として追加されます。上書きを選択すると既存データを更新します。空欄のセルは既存の値を変更しません(値を削除したい場合は編集ダイアログを使ってください)。別表記は書類のOCR自動振り分けに使われるため、変更内容をよく確認してください。',
  },
  office: {
    name: '事業所',
    columns: [
      { key: 'name', label: '事業所名' },
      { key: 'shortName', label: '略称' },
      { key: 'notes', label: '備考' },
      { key: 'aliases', label: '別表記' },
    ],
    defaultAction: 'add' as ImportAction,
    description: '同名は別事業所として追加されます。上書きを選択すると既存データを更新します。空欄のセルは既存の値を変更しません(値を削除したい場合は編集ダイアログを使ってください)。別表記は書類のOCR自動振り分けに使われるため、変更内容をよく確認してください。',
  },
  caremanager: {
    name: 'ケアマネ',
    columns: [
      { key: 'name', label: 'ケアマネ名' },
      { key: 'email', label: 'メールアドレス' },
    ],
    defaultAction: 'skip' as ImportAction,
    description: '同名はスキップされます。上書きを選択すると既存データを更新します。空欄のセルは既存の値を変更しません。',
  },
  documenttype: {
    name: '書類種別',
    columns: [
      { key: 'name', label: '書類名' },
      { key: 'dateMarker', label: '日付マーカー' },
      { key: 'category', label: 'カテゴリ' },
      { key: 'keywords', label: 'キーワード' },
      { key: 'aliases', label: '別表記' },
    ],
    defaultAction: 'skip' as ImportAction,
    description: '同名はスキップされます。上書きを選択すると既存データを更新します。空欄のセルは既存の値を変更しません。別表記は書類のOCR自動振り分けに使われるため、変更内容をよく確認してください。',
  },
}

export function CsvImportModal({ type, isOpen, onClose, onImport, existingRecords }: CsvImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [previewData, setPreviewData] = useState<PreviewRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [checkingDuplicates, setCheckingDuplicates] = useState(false)
  const [result, setResult] = useState<BulkImportResultDetailed | null>(null)

  const config = TYPE_CONFIG[type]

  // ID一致行(顧客・事業所のみ。既存の3分類からは除外する)
  const idMatchRows = useMemo(() =>
    previewData.filter(row => row.matchedBy === 'id'),
    [previewData]
  )

  // 重複データを部分一致と完全一致に分類(ID一致行は含めない)
  const partialMatchRows = useMemo(() =>
    previewData.filter(row => row.matchedBy !== 'id' && row.isDuplicate && !row.isExactMatch),
    [previewData]
  )

  const exactMatchRows = useMemo(() =>
    previewData.filter(row => row.matchedBy !== 'id' && row.isDuplicate && row.isExactMatch),
    [previewData]
  )

  // 新規データのみ抽出(ID一致行は含めない)
  const newRows = useMemo(() =>
    previewData.filter(row => row.matchedBy !== 'id' && !row.isDuplicate),
    [previewData]
  )

  // 上書き選択数（部分一致のみカウント）
  const overwriteCount = useMemo(() =>
    partialMatchRows.filter(row => row.action === 'overwrite').length,
    [partialMatchRows]
  )

  // ID一致行の上書き選択数(既定でON)
  const idMatchOverwriteCount = useMemo(() =>
    idMatchRows.filter(row => row.action === 'overwrite').length,
    [idMatchRows]
  )

  // 完全一致から追加選択数（顧客・事業所のみ）
  const exactMatchAddCount = useMemo(() =>
    exactMatchRows.filter(row => row.action === 'add').length,
    [exactMatchRows]
  )

  // 完全一致アコーディオン開閉状態
  const [exactMatchExpanded, setExactMatchExpanded] = useState(false)

  // 全選択/全解除（部分一致のみ対象）
  const handleSelectAll = (checked: boolean) => {
    setPreviewData(prev => prev.map(row => ({
      ...row,
      // 部分一致のみ変更、完全一致・ID一致はそのまま
      action: (row.matchedBy !== 'id' && row.isDuplicate && !row.isExactMatch)
        ? (checked ? 'overwrite' : config.defaultAction)
        : row.action,
    })))
  }

  // 個別選択(部分一致・完全一致行用)
  const handleSelectRow = (index: number, checked: boolean) => {
    setPreviewData(prev => prev.map((row, i) => {
      if (i !== index) return row
      return {
        ...row,
        action: checked ? 'overwrite' : config.defaultAction,
      }
    }))
  }

  // ID一致行の個別選択。チェックを外した場合は既存レコードの更新自体を行わない
  // 'skip'にする('add'にすると同一レコードが新規追加されてしまうため、
  // config.defaultActionにフォールバックするhandleSelectRowとは分けている)
  const handleSelectIdMatchRow = (index: number, checked: boolean) => {
    setPreviewData(prev => prev.map((row, i) => {
      if (i !== index) return row
      return {
        ...row,
        action: checked ? 'overwrite' : 'skip',
      }
    }))
  }

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setError(null)
    setResult(null)
    setFileName(file.name)

    try {
      const content = await readCSVFile(file)
      const rows = parseCSV(content)

      if (rows.length === 0) {
        setError('CSVにデータがありません')
        setPreviewData([])
        return
      }

      // マスター別マッピング
      let mapped: AnyCSVData[]
      if (type === 'customer') {
        mapped = mapCustomerCSV(rows)
      } else if (type === 'office') {
        mapped = mapOfficeCSV(rows)
      } else if (type === 'caremanager') {
        mapped = mapCareManagerCSV(rows)
      } else {
        mapped = mapDocumentTypeCSV(rows)
      }

      if (mapped.length === 0) {
        setError('有効なデータが見つかりません。カラム名を確認してください')
        setPreviewData([])
        return
      }

      // ID照合(顧客・事業所のみexistingRecordsが渡される)。名前ベース照合より前段で行う。
      // 優先順位が逆だと、名前を書き換えた行が名前照合で「新規」判定され重複追加されるため
      const idMatch = matchRowsById(mapped as unknown as CsvRowWithId[], existingRecords)

      if (idMatch.duplicateIds.length > 0) {
        setError(`CSV内でID列が重複しています(該当ID: ${idMatch.duplicateIds.join(', ')})。IDを修正してから再度お試しください`)
        setPreviewData([])
        return
      }

      const idMatchedRows: PreviewRow[] = idMatch.idMatchRows.map(m => ({
        csvData: m.resolvedData as unknown as AnyCSVData,
        existingData: m.existing as unknown as AnyCSVData,
        isDuplicate: true,
        isExactMatch: false,
        action: 'overwrite', // ID一致は既定で上書きON
        existingId: m.existing.id,
        matchedBy: 'id',
      }))

      const remaining = idMatch.remainingRows as AnyCSVData[]

      // 重複チェック（詳細付き）。ID一致しなかった残りの行のみ対象
      setCheckingDuplicates(true)
      try {
        let checked: DuplicateCheckResultWithDetails<AnyCSVData>[]

        if (type === 'customer') {
          const result = await checkCustomerDuplicatesWithDetails(
            remaining.map(m => ({
              name: (m as CustomerCSVRow).name,
              furigana: (m as CustomerCSVRow).furigana,
              careManagerName: (m as CustomerCSVRow).careManagerName,
              notes: (m as CustomerCSVRow).notes,
              aliases: (m as CustomerCSVRow).aliases,
            }))
          )
          checked = result as DuplicateCheckResultWithDetails<AnyCSVData>[]
        } else if (type === 'office') {
          const result = await checkOfficeDuplicatesWithDetails(
            remaining.map(m => ({
              name: (m as OfficeCSVRow).name,
              shortName: (m as OfficeCSVRow).shortName ?? '',
              notes: (m as OfficeCSVRow).notes,
              aliases: (m as OfficeCSVRow).aliases,
            }))
          )
          checked = result as DuplicateCheckResultWithDetails<AnyCSVData>[]
        } else if (type === 'caremanager') {
          const result = await checkCareManagerDuplicatesWithDetails(
            remaining.map(m => ({ name: (m as CareManagerCSVRow).name, email: (m as CareManagerCSVRow).email }))
          )
          checked = result as DuplicateCheckResultWithDetails<AnyCSVData>[]
        } else {
          const result = await checkDocumentTypeDuplicatesWithDetails(
            remaining.map(m => ({
              name: (m as DocumentTypeCSVRow).name,
              dateMarker: (m as DocumentTypeCSVRow).dateMarker,
              category: (m as DocumentTypeCSVRow).category,
              keywords: (m as DocumentTypeCSVRow).keywords,
              aliases: (m as DocumentTypeCSVRow).aliases,
            }))
          )
          checked = result as DuplicateCheckResultWithDetails<AnyCSVData>[]
        }

        const nameMatchedRows: PreviewRow[] = checked.map(item => {
          const exactMatch = item.isDuplicate && isExactMatchData(type, item.csvData, item.existingData)
          return {
            csvData: item.csvData,
            existingData: item.existingData,
            isDuplicate: item.isDuplicate,
            isExactMatch: exactMatch,
            // 完全一致はデフォルトでスキップ、部分一致はマスター別のデフォルト動作
            action: exactMatch ? 'skip' : (item.isDuplicate ? config.defaultAction : 'add'),
            existingId: (item.existingData as { id?: string } | null)?.id,
          }
        })

        setPreviewData([...idMatchedRows, ...nameMatchedRows])
      } finally {
        setCheckingDuplicates(false)
      }
    } catch {
      setError('ファイルの読み込みに失敗しました')
      setPreviewData([])
    }
  }

  const handleImport = async () => {
    if (previewData.length === 0) return

    setImporting(true)
    setError(null)

    try {
      const items = previewData.map(row => {
        // csvDataにid列が含まれる場合(顧客・事業所のCSVにID列がある場合)、
        // Firestoreの書込みデータに混入しないよう除く
        const dataWithoutId = { ...row.csvData } as AnyCSVData & { id?: string }
        delete dataWithoutId.id
        return {
          data: dataWithoutId as AnyCSVData,
          existingId: row.existingId,
          action: row.action,
        }
      })
      const result = await onImport(items)
      setResult(result)
    } catch {
      setError('インポートに失敗しました')
    } finally {
      setImporting(false)
    }
  }

  const handleDownloadTemplate = () => {
    let template: string
    let filename: string
    if (type === 'customer') {
      template = generateCustomerCSVTemplate()
      filename = 'customers_template.csv'
    } else if (type === 'office') {
      template = generateOfficeCSVTemplate()
      filename = 'offices_template.csv'
    } else if (type === 'caremanager') {
      template = generateCareManagerCSVTemplate()
      filename = 'caremanagers_template.csv'
    } else {
      template = generateDocumentTypeCSVTemplate()
      filename = 'documenttypes_template.csv'
    }

    const blob = new Blob([template], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleClose = () => {
    setFileName(null)
    setPreviewData([])
    setError(null)
    setResult(null)
    onClose()
  }

  // モーダルを閉じた時にファイル入力をリセット
  useEffect(() => {
    if (!isOpen && fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [isOpen])

  // セル値を取得するヘルパー(既存データ側は配列(aliases等)で保持されている場合があるため、
  // 表示時にCSVと同じ区切り文字(|)で連結する。Issue #1036)
  const getCellValue = (data: AnyCSVData | Record<string, unknown> | null, key: string): string => {
    if (!data) return '-'
    const value = (data as unknown as Record<string, unknown>)[key]
    if (value === undefined || value === null || value === '') return '-'
    if (Array.isArray(value)) return value.length > 0 ? value.join('|') : '-'
    return String(value)
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{config.name}マスター CSVインポート</DialogTitle>
          <DialogDescription>
            CSVファイルから{config.name}データを一括インポートします。{config.description}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto space-y-4 py-4">
          {/* ファイル選択 */}
          <div className="flex items-center gap-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileSelect}
              className="hidden"
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing || checkingDuplicates}
            >
              <Upload className="h-4 w-4 mr-2" />
              CSVファイルを選択
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDownloadTemplate}
            >
              <Download className="h-4 w-4 mr-2" />
              テンプレート
            </Button>
            {fileName && (
              <span className="text-sm text-gray-600 flex items-center gap-1">
                <FileText className="h-4 w-4" />
                {fileName}
              </span>
            )}
          </div>

          {/* チェック中表示 */}
          {checkingDuplicates && (
            <div className="text-sm text-gray-500">
              同名データをチェック中...
            </div>
          )}

          {/* エラー表示 */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>エラー</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* 成功メッセージ */}
          {result && (
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertTitle className="text-green-800">インポート完了</AlertTitle>
              <AlertDescription className="text-green-700">
                {result.added}件追加
                {result.overwritten > 0 && `、${result.overwritten}件上書き`}
                {result.skipped > 0 && `、${result.skipped}件スキップ`}
                {result.skippedNames.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-gray-500">
                      スキップされた項目を表示
                    </summary>
                    <ul className="mt-1 text-xs text-gray-600 list-disc list-inside">
                      {result.skippedNames.map((name, i) => (
                        <li key={i}>{name}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* 書込み失敗の警告(成功アラートとは別に必ず表示し、見逃しを防ぐ) */}
          {result && result.failedNames.length > 0 && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{result.failedNames.length}件の書込みに失敗しました</AlertTitle>
              <AlertDescription>
                以下の項目はデータベースへの反映に失敗しました。内容を確認し、再度インポートし直してください。
                <ul className="mt-1 text-xs list-disc list-inside">
                  {result.failedNames.map((name, i) => (
                    <li key={i}>{name}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* プレビュー（結果表示後は非表示） */}
          {previewData.length > 0 && !result && !checkingDuplicates && (
            <>
              {/* サマリー */}
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <span className="text-gray-700">
                  新規追加: <strong>{newRows.length}件</strong>
                </span>
                {idMatchRows.length > 0 && (
                  <span className="text-blue-700 flex items-center gap-1">
                    ID一致: <strong>{idMatchRows.length}件</strong>
                    {idMatchOverwriteCount > 0 && (
                      <span className="text-blue-600">（{idMatchOverwriteCount}件上書き選択）</span>
                    )}
                  </span>
                )}
                {partialMatchRows.length > 0 && (
                  <span className="text-yellow-700 flex items-center gap-1">
                    <AlertTriangle className="h-4 w-4" />
                    部分一致: <strong>{partialMatchRows.length}件</strong>
                    {overwriteCount > 0 && (
                      <span className="text-blue-600">（{overwriteCount}件上書き選択）</span>
                    )}
                  </span>
                )}
                {exactMatchRows.length > 0 && (
                  <span className="text-gray-500">
                    完全一致: <strong>{exactMatchRows.length}件</strong>
                    {(type === 'customer' || type === 'office') ? (
                      exactMatchAddCount > 0
                        ? <span className="text-blue-600">（{exactMatchAddCount}件同名追加）</span>
                        : '（選択待ち）'
                    ) : (
                      '（スキップ）'
                    )}
                  </span>
                )}
              </div>

              {/* ID一致データ(顧客・事業所のみ。既定で上書きON) */}
              {idMatchRows.length > 0 && (
                <div className="border rounded-md p-3 bg-blue-50">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium text-blue-800">
                      IDが一致（既存データを更新）
                    </h4>
                    <span className="text-xs text-gray-600">
                      名前は変更されません（CSVで書き換えても既存の名前のまま更新されます）
                    </span>
                  </div>
                  <div className="max-h-60 overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">上書き</TableHead>
                          <TableHead className="w-16">状態</TableHead>
                          {config.columns.map(col => (
                            <TableHead key={col.key}>{col.label}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {idMatchRows.map((row, idx) => {
                          const originalIndex = previewData.findIndex(r => r === row)
                          return (
                            <Fragment key={idx}>
                              {/* CSVデータ行(名前列のみ既存値を表示し、CSVでの改名は反映されないことを示す) */}
                              <TableRow className="bg-blue-50">
                                <TableCell rowSpan={2} className="align-middle">
                                  <Checkbox
                                    checked={row.action === 'overwrite'}
                                    onCheckedChange={(checked) => handleSelectIdMatchRow(originalIndex, !!checked)}
                                  />
                                </TableCell>
                                <TableCell className="text-xs text-blue-600 font-medium">CSV</TableCell>
                                {config.columns.map(col => (
                                  <TableCell key={col.key} className="text-sm">
                                    {col.key === 'name' ? getCellValue(row.existingData, 'name') : getCellValue(row.csvData, col.key)}
                                  </TableCell>
                                ))}
                              </TableRow>
                              {/* 既存データ行 */}
                              <TableRow className="bg-gray-50 border-b-2">
                                <TableCell className="text-xs text-gray-500">既存</TableCell>
                                {config.columns.map(col => (
                                  <TableCell key={col.key} className="text-sm text-gray-500">
                                    {getCellValue(row.existingData, col.key)}
                                  </TableCell>
                                ))}
                              </TableRow>
                            </Fragment>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {/* 部分一致データ（上書き選択UI） */}
              {partialMatchRows.length > 0 && (
                <div className="border rounded-md p-3 bg-yellow-50">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium text-yellow-800">
                      部分一致（差分あり・上書き候補）
                    </h4>
                    <label className="flex items-center gap-2 text-xs text-gray-600">
                      <Checkbox
                        checked={overwriteCount === partialMatchRows.length && partialMatchRows.length > 0}
                        onCheckedChange={(checked) => handleSelectAll(!!checked)}
                      />
                      全て上書き
                    </label>
                  </div>
                  <div className="max-h-60 overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">上書き</TableHead>
                          <TableHead className="w-16">状態</TableHead>
                          {config.columns.map(col => (
                            <TableHead key={col.key}>{col.label}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {partialMatchRows.map((row, idx) => {
                          const originalIndex = previewData.findIndex(r => r === row)
                          return (
                            <Fragment key={idx}>
                              {/* CSVデータ行 */}
                              <TableRow className="bg-blue-50">
                                <TableCell rowSpan={2} className="align-middle">
                                  <Checkbox
                                    checked={row.action === 'overwrite'}
                                    onCheckedChange={(checked) => handleSelectRow(originalIndex, !!checked)}
                                  />
                                </TableCell>
                                <TableCell className="text-xs text-blue-600 font-medium">CSV</TableCell>
                                {config.columns.map(col => (
                                  <TableCell key={col.key} className="text-sm">
                                    {getCellValue(row.csvData, col.key)}
                                  </TableCell>
                                ))}
                              </TableRow>
                              {/* 既存データ行 */}
                              <TableRow className="bg-gray-50 border-b-2">
                                <TableCell className="text-xs text-gray-500">既存</TableCell>
                                {config.columns.map(col => (
                                  <TableCell key={col.key} className="text-sm text-gray-500">
                                    {getCellValue(row.existingData, col.key)}
                                  </TableCell>
                                ))}
                              </TableRow>
                            </Fragment>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {/* 完全一致データ */}
              {exactMatchRows.length > 0 && (
                <div className="border rounded-md bg-gray-50">
                  <button
                    type="button"
                    className="w-full p-3 flex items-center justify-between text-sm text-gray-600 hover:bg-gray-100 transition-colors"
                    onClick={() => setExactMatchExpanded(!exactMatchExpanded)}
                  >
                    <span>
                      完全一致: {exactMatchRows.length}件
                      {(type === 'customer' || type === 'office')
                        ? '（同名追加を確認）'
                        : '（差分なし・スキップ）'}
                    </span>
                    <span className="text-xs">
                      {exactMatchExpanded ? '▼ 閉じる' : '▶ 表示する'}
                    </span>
                  </button>
                  {exactMatchExpanded && (
                    <div className="border-t p-3 space-y-3">
                      {/* 顧客・事業所は同名追加の選択UI */}
                      {(type === 'customer' || type === 'office') ? (
                        <>
                          <div className="max-h-40 overflow-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="w-12">追加</TableHead>
                                  {config.columns.map(col => (
                                    <TableHead key={col.key}>{col.label}</TableHead>
                                  ))}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {exactMatchRows.map((row, idx) => {
                                  const originalIndex = previewData.findIndex(r => r === row)
                                  return (
                                    <TableRow key={idx}>
                                      <TableCell>
                                        <Checkbox
                                          checked={row.action === 'add'}
                                          onCheckedChange={(checked) => {
                                            setPreviewData(prev => prev.map((r, i) =>
                                              i === originalIndex
                                                ? { ...r, action: checked ? 'add' : 'skip' }
                                                : r
                                            ))
                                          }}
                                        />
                                      </TableCell>
                                      {config.columns.map(col => (
                                        <TableCell key={col.key} className="text-sm">
                                          {getCellValue(row.csvData, col.key)}
                                        </TableCell>
                                      ))}
                                    </TableRow>
                                  )
                                })}
                              </TableBody>
                            </Table>
                          </div>
                          <div className="text-xs text-blue-600 bg-blue-50 p-2 rounded">
                            💡 同姓同名として追加する場合、マスター編集画面のnotesに
                            「同姓同名」と記載しておくと後から区別しやすくなります
                          </div>
                        </>
                      ) : (
                        /* ケアマネ・書類は名前リストのみ */
                        <ul className="text-xs text-gray-500 space-y-1 max-h-40 overflow-auto">
                          {exactMatchRows.map((row, idx) => (
                            <li key={idx}>
                              {getCellValue(row.csvData, 'name')}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 新規データ（プレビュー） */}
              {newRows.length > 0 && (
                <div>
                  <p className="text-sm text-gray-500 mb-2">
                    新規追加プレビュー（{Math.min(newRows.length, 10)}件表示）
                  </p>
                  <div className="border rounded-md max-h-40 overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {config.columns.map(col => (
                            <TableHead key={col.key}>{col.label}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {newRows.slice(0, 10).map((row, index) => (
                          <TableRow key={index}>
                            {config.columns.map(col => (
                              <TableCell key={col.key}>
                                {getCellValue(row.csvData, col.key)}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {newRows.length > 10 && (
                    <p className="text-xs text-gray-400 mt-1">
                      他 {newRows.length - 10}件...
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {/* カラム説明 */}
          {!fileName && (
            <div className="text-sm text-gray-500 space-y-1">
              <p className="font-medium">対応カラム名:</p>
              {type === 'customer' ? (
                <ul className="list-disc list-inside text-xs space-y-1">
                  <li>顧客名: <code>name</code>, <code>顧客名</code>, <code>氏名</code>, <code>利用者名</code></li>
                  <li>フリガナ: <code>furigana</code>, <code>フリガナ</code>, <code>ふりがな</code></li>
                  <li>ID: <code>id</code>, <code>ID</code>（エクスポートしたCSVのみ。この列の値がある行は名前を変更しても同じ人として更新されます。他の行にコピーしないでください）</li>
                </ul>
              ) : type === 'office' ? (
                <ul className="list-disc list-inside text-xs space-y-1">
                  <li>事業所名: <code>name</code>, <code>事業所名</code>, <code>名称</code></li>
                  <li>略称: <code>shortName</code>, <code>略称</code>, <code>短縮名</code></li>
                  <li>ID: <code>id</code>, <code>ID</code>（エクスポートしたCSVのみ。この列の値がある行は名前を変更しても同じ事業所として更新されます。他の行にコピーしないでください）</li>
                </ul>
              ) : type === 'caremanager' ? (
                <ul className="list-disc list-inside text-xs space-y-1">
                  <li>ケアマネ名: <code>name</code>, <code>ケアマネ名</code>, <code>氏名</code>, <code>名前</code></li>
                </ul>
              ) : (
                <ul className="list-disc list-inside text-xs space-y-1">
                  <li>書類名: <code>name</code>, <code>書類名</code>, <code>書類種別</code>, <code>名称</code></li>
                  <li>日付マーカー: <code>dateMarker</code>, <code>日付マーカー</code>, <code>日付</code></li>
                  <li>カテゴリ: <code>category</code>, <code>カテゴリ</code>, <code>分類</code></li>
                  <li>キーワード: <code>keywords</code>, <code>キーワード</code>, <code>照合キーワード</code> (セミコロン区切り)</li>
                </ul>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {result ? '閉じる' : 'キャンセル'}
          </Button>
          {!result && (
            <Button
              onClick={handleImport}
              disabled={previewData.length === 0 || importing || checkingDuplicates}
            >
              {importing ? 'インポート中...' : (
                <>
                  {newRows.length + exactMatchAddCount}件追加
                  {(overwriteCount + idMatchOverwriteCount) > 0 && ` + ${overwriteCount + idMatchOverwriteCount}件上書き`}
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
