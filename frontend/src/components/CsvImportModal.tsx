/**
 * CSVインポートモーダル
 *
 * 顧客・事業所・ケアマネ・書類種別マスターの一括インポートUI
 * 顧客・事業所は同名も許可（警告表示あり）
 */

import { useState, useRef, useEffect } from 'react'
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
  checkCustomerDuplicatesInBulk,
  checkOfficeDuplicatesInBulk,
} from '@/hooks/useMasters'

type ImportType = 'customer' | 'office' | 'caremanager' | 'documenttype'

interface ImportResult {
  imported: number
  skipped: number
  duplicateImported?: number
}

interface CsvImportModalProps {
  type: ImportType
  isOpen: boolean
  onClose: () => void
  onImport: (data: CustomerCSVRow[] | OfficeCSVRow[] | CareManagerCSVRow[] | DocumentTypeCSVRow[]) => Promise<ImportResult>
}

// 同名チェック結果付きのプレビューデータ
interface PreviewRowWithDuplicate {
  data: CustomerCSVRow | OfficeCSVRow | CareManagerCSVRow | DocumentTypeCSVRow
  isDuplicateInDb: boolean
}

// プレビュー行のセルをレンダリング
function renderPreviewCells(
  type: ImportType,
  row: PreviewRowWithDuplicate
): React.ReactNode {
  const duplicateBadge = row.isDuplicateInDb && (
    <span className="text-yellow-600 text-xs font-medium">同名あり</span>
  )

  switch (type) {
    case 'customer': {
      const data = row.data as CustomerCSVRow
      return (
        <>
          <TableCell>{data.name}</TableCell>
          <TableCell>{data.furigana || '-'}</TableCell>
          <TableCell>{duplicateBadge}</TableCell>
        </>
      )
    }
    case 'office': {
      const data = row.data as OfficeCSVRow
      return (
        <>
          <TableCell>{data.name}</TableCell>
          <TableCell>{data.shortName || '-'}</TableCell>
          <TableCell>{duplicateBadge}</TableCell>
        </>
      )
    }
    case 'caremanager': {
      const data = row.data as CareManagerCSVRow
      return <TableCell>{data.name}</TableCell>
    }
    case 'documenttype': {
      const data = row.data as DocumentTypeCSVRow
      return (
        <>
          <TableCell>{data.name}</TableCell>
          <TableCell>{data.dateMarker || '-'}</TableCell>
          <TableCell>{data.category || '-'}</TableCell>
          <TableCell className="max-w-[150px] truncate">
            {data.keywords || '-'}
          </TableCell>
        </>
      )
    }
  }
}

export function CsvImportModal({ type, isOpen, onClose, onImport }: CsvImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [previewData, setPreviewData] = useState<PreviewRowWithDuplicate[]>([])
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [checkingDuplicates, setCheckingDuplicates] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  const typeLabels = {
    customer: { name: '顧客', fields: ['顧客名', 'フリガナ', '既存同名'] },
    office: { name: '事業所', fields: ['事業所名', '略称', '既存同名'] },
    caremanager: { name: 'ケアマネ', fields: ['ケアマネ名'] },
    documenttype: { name: '書類種別', fields: ['書類名', '日付マーカー', 'カテゴリ', 'キーワード'] },
  }

  // 顧客・事業所は同名許可（警告付き）、ケアマネ・書類は同名スキップ
  const allowsDuplicates = type === 'customer' || type === 'office'
  const duplicateCount = previewData.filter(row => row.isDuplicateInDb).length

  // 説明文をtypeに応じて変更
  const getDescription = () => {
    if (allowsDuplicates) {
      return `CSVファイルから${typeLabels[type].name}データを一括インポートします。同名データは警告表示されますが、確認の上インポートできます。`
    }
    return `CSVファイルから${typeLabels[type].name}データを一括インポートします。既存データと同名のものはスキップされます。`
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

      let mapped: CustomerCSVRow[] | OfficeCSVRow[] | CareManagerCSVRow[] | DocumentTypeCSVRow[]
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

      // 顧客・事業所の場合は同名チェックを実行
      if (type === 'customer') {
        setCheckingDuplicates(true)
        try {
          const checked = await checkCustomerDuplicatesInBulk(mapped as CustomerCSVRow[])
          setPreviewData(mapped.map((data, i) => ({
            data,
            isDuplicateInDb: checked[i].isDuplicate,
          })))
        } finally {
          setCheckingDuplicates(false)
        }
      } else if (type === 'office') {
        setCheckingDuplicates(true)
        try {
          const checked = await checkOfficeDuplicatesInBulk(mapped as OfficeCSVRow[])
          setPreviewData(mapped.map((data, i) => ({
            data,
            isDuplicateInDb: checked[i].isDuplicate,
          })))
        } finally {
          setCheckingDuplicates(false)
        }
      } else {
        // ケアマネ・書類は同名チェックなし
        setPreviewData(mapped.map(data => ({
          data,
          isDuplicateInDb: false,
        })))
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
      const dataToImport = previewData.map(row => row.data)
      const result = await onImport(dataToImport as CustomerCSVRow[] | OfficeCSVRow[] | CareManagerCSVRow[] | DocumentTypeCSVRow[])
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

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{typeLabels[type].name}マスター CSVインポート</DialogTitle>
          <DialogDescription>
            {getDescription()}
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

          {/* 同名警告（顧客・事業所のみ） */}
          {allowsDuplicates && duplicateCount > 0 && !result && (
            <Alert className="border-yellow-300 bg-yellow-50">
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
              <AlertTitle className="text-yellow-800">同名データあり</AlertTitle>
              <AlertDescription className="text-yellow-700">
                {duplicateCount}件の同名データが既に登録されています。
                OCR照合で区別が必要になります。確認の上インポートしてください。
              </AlertDescription>
            </Alert>
          )}

          {/* 成功メッセージ */}
          {result && (
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertTitle className="text-green-800">インポート完了</AlertTitle>
              <AlertDescription className="text-green-700">
                {result.imported}件追加
                {result.skipped > 0 && `、${result.skipped}件スキップ（無効データ）`}
                {result.duplicateImported && result.duplicateImported > 0 && (
                  <span className="text-yellow-700">（うち{result.duplicateImported}件は同名追加）</span>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* プレビュー */}
          {previewData.length > 0 && !result && !checkingDuplicates && (
            <div>
              <p className="text-sm text-gray-500 mb-2">
                プレビュー（{previewData.length}件）
              </p>
              <div className="border rounded-md max-h-60 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {typeLabels[type].fields.map((field) => (
                        <TableHead key={field}>{field}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewData.slice(0, 10).map((row, index) => (
                      <TableRow
                        key={index}
                        className={row.isDuplicateInDb ? 'bg-yellow-50' : ''}
                      >
                        {renderPreviewCells(type, row)}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {previewData.length > 10 && (
                <p className="text-xs text-gray-400 mt-1">
                  他 {previewData.length - 10}件...
                </p>
              )}
            </div>
          )}

          {/* カラム説明 */}
          {!fileName && (
            <div className="text-sm text-gray-500 space-y-1">
              <p className="font-medium">対応カラム名:</p>
              {type === 'customer' ? (
                <ul className="list-disc list-inside text-xs space-y-1">
                  <li>顧客名: <code>name</code>, <code>顧客名</code>, <code>氏名</code>, <code>利用者名</code></li>
                  <li>フリガナ: <code>furigana</code>, <code>フリガナ</code>, <code>ふりがな</code></li>
                </ul>
              ) : type === 'office' ? (
                <ul className="list-disc list-inside text-xs space-y-1">
                  <li>事業所名: <code>name</code>, <code>事業所名</code>, <code>名称</code></li>
                  <li>略称: <code>shortName</code>, <code>略称</code>, <code>短縮名</code></li>
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
              {importing ? 'インポート中...' : `${previewData.length}件をインポート`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
