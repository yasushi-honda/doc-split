/**
 * CSVインポートモーダル
 *
 * 顧客・事業所マスターの一括インポートUI
 */

import { useState, useRef } from 'react'
import { Upload, FileText, AlertCircle, CheckCircle2, Download } from 'lucide-react'
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

type ImportType = 'customer' | 'office' | 'caremanager' | 'documenttype'

interface CsvImportModalProps {
  type: ImportType
  isOpen: boolean
  onClose: () => void
  onImport: (data: CustomerCSVRow[] | OfficeCSVRow[] | CareManagerCSVRow[] | DocumentTypeCSVRow[]) => Promise<{ imported: number; skipped: number }>
}

export function CsvImportModal({ type, isOpen, onClose, onImport }: CsvImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [previewData, setPreviewData] = useState<CustomerCSVRow[] | OfficeCSVRow[] | CareManagerCSVRow[] | DocumentTypeCSVRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null)

  const typeLabels = {
    customer: { name: '顧客', fields: ['顧客名', 'フリガナ', '同姓同名'] },
    office: { name: '事業所', fields: ['事業所名', '略称'] },
    caremanager: { name: 'ケアマネ', fields: ['ケアマネ名'] },
    documenttype: { name: '書類種別', fields: ['書類名', '日付マーカー', 'カテゴリ', 'キーワード'] },
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

      setPreviewData(mapped)
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
      const result = await onImport(previewData)
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

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{typeLabels[type].name}マスター CSVインポート</DialogTitle>
          <DialogDescription>
            CSVファイルから{typeLabels[type].name}データを一括インポートします。
            既存データと同名のものはスキップされます。
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
              disabled={importing}
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
                {result.imported}件追加、{result.skipped}件スキップ（既存または無効）
              </AlertDescription>
            </Alert>
          )}

          {/* プレビュー */}
          {previewData.length > 0 && !result && (
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
                      <TableRow key={index}>
                        {type === 'customer' ? (
                          <>
                            <TableCell>{(row as CustomerCSVRow).name}</TableCell>
                            <TableCell>{(row as CustomerCSVRow).furigana || '-'}</TableCell>
                            <TableCell>{(row as CustomerCSVRow).isDuplicate ? 'はい' : '-'}</TableCell>
                          </>
                        ) : type === 'office' ? (
                          <>
                            <TableCell>{(row as OfficeCSVRow).name}</TableCell>
                            <TableCell>{(row as OfficeCSVRow).shortName || '-'}</TableCell>
                          </>
                        ) : type === 'caremanager' ? (
                          <>
                            <TableCell>{(row as CareManagerCSVRow).name}</TableCell>
                          </>
                        ) : (
                          <>
                            <TableCell>{(row as DocumentTypeCSVRow).name}</TableCell>
                            <TableCell>{(row as DocumentTypeCSVRow).dateMarker || '-'}</TableCell>
                            <TableCell>{(row as DocumentTypeCSVRow).category || '-'}</TableCell>
                            <TableCell className="max-w-[150px] truncate">{(row as DocumentTypeCSVRow).keywords || '-'}</TableCell>
                          </>
                        )}
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
                  <li>同姓同名: <code>isDuplicate</code>, <code>同姓同名</code>, <code>重複</code> (true/false)</li>
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
              disabled={previewData.length === 0 || importing}
            >
              {importing ? 'インポート中...' : `${previewData.length}件をインポート`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
