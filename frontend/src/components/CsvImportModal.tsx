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
  generateCustomerCSVTemplate,
  generateOfficeCSVTemplate,
  type CustomerCSVRow,
  type OfficeCSVRow,
} from '@/lib/csvParser'

type ImportType = 'customer' | 'office'

interface CsvImportModalProps {
  type: ImportType
  isOpen: boolean
  onClose: () => void
  onImport: (data: CustomerCSVRow[] | OfficeCSVRow[]) => Promise<{ imported: number; skipped: number }>
}

export function CsvImportModal({ type, isOpen, onClose, onImport }: CsvImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [previewData, setPreviewData] = useState<CustomerCSVRow[] | OfficeCSVRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null)

  const typeLabels = {
    customer: { name: '顧客', fields: ['顧客名', 'フリガナ', '同姓同名'] },
    office: { name: '事業所', fields: ['事業所名', '略称'] },
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

      let mapped: CustomerCSVRow[] | OfficeCSVRow[]
      if (type === 'customer') {
        mapped = mapCustomerCSV(rows)
      } else {
        mapped = mapOfficeCSV(rows)
      }

      if (mapped.length === 0) {
        setError('有効なデータが見つかりません。カラム名を確認してください')
        setPreviewData([])
        return
      }

      setPreviewData(mapped)
    } catch (err) {
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
    } catch (err) {
      setError('インポートに失敗しました')
    } finally {
      setImporting(false)
    }
  }

  const handleDownloadTemplate = () => {
    const template = type === 'customer'
      ? generateCustomerCSVTemplate()
      : generateOfficeCSVTemplate()

    const blob = new Blob([template], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = type === 'customer' ? 'customers_template.csv' : 'offices_template.csv'
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
                        ) : (
                          <>
                            <TableCell>{(row as OfficeCSVRow).name}</TableCell>
                            <TableCell>{(row as OfficeCSVRow).shortName || '-'}</TableCell>
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
              ) : (
                <ul className="list-disc list-inside text-xs space-y-1">
                  <li>事業所名: <code>name</code>, <code>事業所名</code>, <code>名称</code></li>
                  <li>略称: <code>shortName</code>, <code>略称</code>, <code>短縮名</code></li>
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
