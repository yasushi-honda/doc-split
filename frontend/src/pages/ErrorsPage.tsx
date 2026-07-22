/**
 * エラー履歴画面
 * OCRエラー一覧と再処理機能
 */

import { useState } from 'react'
import {
  AlertCircle,
  RefreshCw,
  FileText,
  CheckCircle2,
  Clock,
  XCircle,
  ExternalLink,
  Filter,
  HardDrive,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  useErrors,
  useErrorStats,
  useUpdateErrorStatus,
  useReprocessError,
  type ErrorFilters,
} from '@/hooks/useErrors'
import {
  useDriveExportErrors,
  useRetryDriveExport,
  type DriveExportErrorRow,
} from '@/hooks/useDriveExportErrors'
import { toast } from 'sonner'
import { getCallableErrorMessage } from '@/lib/callFunction'
import { useAuthStore } from '@/stores/authStore'
import type { ErrorRecord, ErrorStatus, ErrorType } from '@shared/types'

export function ErrorsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">エラー履歴</h1>
        <p className="mt-1 text-sm text-gray-500">
          処理エラーを確認し、再処理を実行できます
        </p>
      </div>

      <Tabs defaultValue="ocr" className="space-y-4">
        <TabsList>
          <TabsTrigger value="ocr" className="gap-2">
            <FileText className="h-4 w-4" />
            OCRエラー
          </TabsTrigger>
          <TabsTrigger value="drive" className="gap-2">
            <HardDrive className="h-4 w-4" />
            Driveエクスポートエラー
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ocr">
          <OcrErrorsTab />
        </TabsContent>

        <TabsContent value="drive">
          <DriveExportErrorsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ============================================
// OCRエラータブ
// ============================================

function OcrErrorsTab() {
  const [filters, setFilters] = useState<ErrorFilters>({})
  const { data: errors, isLoading, refetch } = useErrors({ filters })
  const { data: stats } = useErrorStats()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          更新
        </Button>
      </div>

      {/* 統計カード */}
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          title="全エラー"
          value={stats?.total ?? 0}
          icon={AlertCircle}
          color="gray"
        />
        <StatCard
          title="未対応"
          value={stats?.unhandled ?? 0}
          icon={XCircle}
          color="red"
        />
        <StatCard
          title="対応中"
          value={stats?.inProgress ?? 0}
          icon={Clock}
          color="yellow"
        />
        <StatCard
          title="完了"
          value={stats?.completed ?? 0}
          icon={CheckCircle2}
          color="green"
        />
      </div>

      {/* フィルター */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4" />
            <CardTitle className="text-base">フィルター</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            <div className="w-48">
              <Select
                value={filters.status || 'all'}
                onValueChange={(value) =>
                  setFilters({
                    ...filters,
                    status: value === 'all' ? undefined : (value as ErrorStatus),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="ステータス" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全てのステータス</SelectItem>
                  <SelectItem value="未対応">未対応</SelectItem>
                  <SelectItem value="対応中">対応中</SelectItem>
                  <SelectItem value="完了">完了</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-48">
              <Select
                value={filters.errorType || 'all'}
                onValueChange={(value) =>
                  setFilters({
                    ...filters,
                    errorType: value === 'all' ? undefined : (value as ErrorType),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="エラー種別" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全ての種別</SelectItem>
                  <SelectItem value="OCR完全失敗">OCR完全失敗</SelectItem>
                  <SelectItem value="OCR部分失敗">OCR部分失敗</SelectItem>
                  <SelectItem value="情報抽出エラー">情報抽出エラー</SelectItem>
                  <SelectItem value="ファイル処理エラー">ファイル処理エラー</SelectItem>
                  <SelectItem value="システムエラー">システムエラー</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* エラー一覧 */}
      <Card>
        <CardHeader>
          <CardTitle>エラー一覧</CardTitle>
          <CardDescription>
            {errors?.length ?? 0}件のエラーが見つかりました
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">読み込み中...</div>
          ) : errors?.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              エラーはありません
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>発生日時</TableHead>
                  <TableHead>種別</TableHead>
                  <TableHead>ファイル名</TableHead>
                  <TableHead>ページ</TableHead>
                  <TableHead>ステータス</TableHead>
                  <TableHead className="w-[150px]">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {errors?.map((error) => (
                  <ErrorRow key={error.errorId} error={error} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ============================================
// 統計カード
// ============================================

interface StatCardProps {
  title: string
  value: number
  icon: React.ElementType
  color: 'gray' | 'red' | 'yellow' | 'green'
}

function StatCard({ title, value, icon: Icon, color }: StatCardProps) {
  const colorClasses = {
    gray: 'bg-gray-100 text-gray-600',
    red: 'bg-red-100 text-red-600',
    yellow: 'bg-yellow-100 text-yellow-600',
    green: 'bg-green-100 text-green-600',
  }

  return (
    <Card>
      <CardContent className="flex items-center gap-4 pt-6">
        <div className={`rounded-full p-3 ${colorClasses[color]}`}>
          <Icon className="h-6 w-6" />
        </div>
        <div>
          <p className="text-sm text-gray-500">{title}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}

// ============================================
// エラー行
// ============================================

interface ErrorRowProps {
  error: ErrorRecord
}

function ErrorRow({ error }: ErrorRowProps) {
  const updateStatus = useUpdateErrorStatus()
  const reprocess = useReprocessError()
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [isReprocessConfirmOpen, setIsReprocessConfirmOpen] = useState(false)

  const statusBadgeVariant = {
    未対応: 'destructive' as const,
    対応中: 'default' as const,
    完了: 'secondary' as const,
  }

  const handleReprocess = async () => {
    await reprocess.mutateAsync({
      errorId: error.errorId,
      fileId: error.fileId,
      documentId: error.documentId,
    })
    setIsReprocessConfirmOpen(false)
  }

  const handleMarkComplete = async () => {
    await updateStatus.mutateAsync({
      errorId: error.errorId,
      status: '完了',
    })
  }

  return (
    <>
      <TableRow>
        <TableCell className="whitespace-nowrap">
          {error.errorDate?.toDate().toLocaleString('ja-JP')}
        </TableCell>
        <TableCell>
          <Badge variant="outline">{error.errorType}</Badge>
        </TableCell>
        <TableCell className="max-w-[200px] truncate" title={error.fileName}>
          {error.fileName}
        </TableCell>
        <TableCell>
          {error.failedPages > 0 ? (
            <span className="text-red-600">
              {error.successPages}/{error.totalPages} 成功
            </span>
          ) : (
            <span className="text-gray-500">-</span>
          )}
        </TableCell>
        <TableCell>
          <Badge variant={statusBadgeVariant[error.status]}>
            {error.status}
          </Badge>
        </TableCell>
        <TableCell>
          <TooltipProvider delayDuration={300}>
            <div className="flex gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsDetailOpen(true)}
                  >
                    <FileText className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>詳細を表示</p>
                </TooltipContent>
              </Tooltip>
              {error.status !== '完了' && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setIsReprocessConfirmOpen(true)}
                        disabled={reprocess.isPending}
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>再処理</p>
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleMarkComplete}
                        disabled={updateStatus.isPending}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>対応完了にする</p>
                    </TooltipContent>
                  </Tooltip>
                </>
              )}
            </div>
          </TooltipProvider>
        </TableCell>
      </TableRow>

      {/* 詳細ダイアログ */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>エラー詳細</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500">エラーID</p>
                <p className="font-mono text-sm">{error.errorId}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">発生日時</p>
                <p>{error.errorDate?.toDate().toLocaleString('ja-JP')}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">種別</p>
                <Badge variant="outline">{error.errorType}</Badge>
              </div>
              <div>
                <p className="text-sm text-gray-500">ステータス</p>
                <Badge variant={statusBadgeVariant[error.status]}>
                  {error.status}
                </Badge>
              </div>
            </div>

            <div>
              <p className="text-sm text-gray-500">ファイル名</p>
              <p className="font-medium">{error.fileName}</p>
            </div>

            {error.totalPages > 0 && (
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-gray-500">総ページ数</p>
                  <p className="font-medium">{error.totalPages}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">成功ページ</p>
                  <p className="font-medium text-green-600">
                    {error.successPages}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">失敗ページ</p>
                  <p className="font-medium text-red-600">{error.failedPages}</p>
                </div>
              </div>
            )}

            {error.failedPageNumbers?.length > 0 && (
              <div>
                <p className="text-sm text-gray-500">失敗ページ番号</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {error.failedPageNumbers.map((page) => (
                    <Badge key={page} variant="destructive">
                      {page}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="text-sm text-gray-500">エラー詳細</p>
              <pre className="mt-1 p-3 bg-gray-100 rounded-md text-sm overflow-auto max-h-48 whitespace-pre-wrap break-all">
                {error.errorDetails}
              </pre>
            </div>

            {error.fileUrl && (
              <div>
                <a
                  href={error.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                >
                  <ExternalLink className="h-4 w-4" />
                  ファイルを開く
                </a>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDetailOpen(false)}>
              閉じる
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 再処理確認ダイアログ */}
      <Dialog
        open={isReprocessConfirmOpen}
        onOpenChange={setIsReprocessConfirmOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>再処理の確認</DialogTitle>
            <DialogDescription>
              このファイルのOCR処理を再実行します。よろしいですか？
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm">
              <span className="text-gray-500">ファイル名:</span>{' '}
              {error.fileName}
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsReprocessConfirmOpen(false)}
            >
              キャンセル
            </Button>
            <Button onClick={handleReprocess} disabled={reprocess.isPending}>
              <RefreshCw className="h-4 w-4 mr-2" />
              {reprocess.isPending ? '処理中...' : '再処理を実行'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ============================================
// Driveエクスポートエラータブ(ADR-0022 Phase1 Task13)
// ============================================

function DriveExportErrorsTab() {
  const { data: rows, isLoading, refetch } = useDriveExportErrors()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          更新
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Driveエクスポートエラー一覧</CardTitle>
          <CardDescription>
            {rows?.length ?? 0}件のエラーが見つかりました。1時間毎の自動リトライでも解消されなかった場合、手動でリトライできます
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">読み込み中...</div>
          ) : rows?.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              エラーはありません
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>更新日時</TableHead>
                  <TableHead>ファイル名</TableHead>
                  <TableHead>利用者名</TableHead>
                  <TableHead>書類種別</TableHead>
                  <TableHead>エラー内容</TableHead>
                  <TableHead className="w-[100px]">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows?.map((row) => (
                  <DriveExportErrorRow key={row.id} row={row} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

interface DriveExportErrorRowProps {
  row: DriveExportErrorRow
}

function DriveExportErrorRow({ row }: DriveExportErrorRowProps) {
  const isAdmin = useAuthStore((s) => s.isAdmin)
  const retry = useRetryDriveExport()
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [isRetryConfirmOpen, setIsRetryConfirmOpen] = useState(false)

  const handleRetry = async () => {
    setIsRetryConfirmOpen(false)
    try {
      const result = await retry.mutateAsync(row.id)
      // retryDriveExportは「呼び出し成功だが再エクスポートも失敗」をthrowではなく
      // success:falseのresolveで返すtri-state契約(functions/src/drive/retryDriveExport.ts)。
      // ここで分岐しないとこの再失敗が握り潰される。
      //
      // code-review指摘#63対応(2026-07-22): 以前はrow-local stateでバナー表示していたが、
      // 成功時はuseRetryDriveExportのonSuccessによる一覧再取得でこの行自体が
      // (driveExportStatus:'exported'へ遷移し一覧から外れて)アンマウントされ、
      // メッセージが表示直後に消えていた。sonnerのtoastはRowのライフサイクルから独立した
      // ポータルへ描画されるため、この問題を回避できる。
      if (result.success) {
        toast.success('エクスポートに成功しました')
      } else {
        toast.error(result.error || '再エクスポートに失敗しました')
      }
    } catch (err) {
      toast.error(getCallableErrorMessage(err, 'リトライに失敗しました'))
    }
  }

  return (
    <>
      <TableRow>
        <TableCell className="whitespace-nowrap">
          {row.updatedAt?.toLocaleString('ja-JP') ?? '-'}
        </TableCell>
        <TableCell className="max-w-[200px] truncate" title={row.fileName}>
          {row.fileName}
        </TableCell>
        <TableCell>{row.customerName}</TableCell>
        <TableCell>{row.documentType}</TableCell>
        <TableCell className="max-w-[240px] truncate" title={row.driveExportError}>
          {row.driveExportError}
        </TableCell>
        <TableCell>
          <TooltipProvider delayDuration={300}>
            <div className="flex gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="詳細を表示"
                    onClick={() => setIsDetailOpen(true)}
                  >
                    <FileText className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>詳細を表示</p>
                </TooltipContent>
              </Tooltip>
              {isAdmin && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="リトライ"
                      onClick={() => setIsRetryConfirmOpen(true)}
                      disabled={retry.isPending}
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>リトライ</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </TooltipProvider>
        </TableCell>
      </TableRow>

      {/* 詳細ダイアログ */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Driveエクスポートエラー詳細</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500">更新日時</p>
                <p>{row.updatedAt?.toLocaleString('ja-JP') ?? '-'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">ファイル名</p>
                <p>{row.fileName}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">利用者名</p>
                <p>{row.customerName}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">事業所</p>
                <p>{row.officeName}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">ケアマネ</p>
                <p>{row.careManager}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">書類種別</p>
                <p>{row.documentType}</p>
              </div>
            </div>
            <div>
              <p className="text-sm text-gray-500">エラー詳細</p>
              <pre className="mt-1 p-3 bg-gray-100 rounded-md text-sm overflow-auto max-h-48 whitespace-pre-wrap break-all">
                {row.driveExportError}
              </pre>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDetailOpen(false)}>
              閉じる
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* リトライ確認ダイアログ */}
      <Dialog open={isRetryConfirmOpen} onOpenChange={setIsRetryConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>リトライの確認</DialogTitle>
            <DialogDescription>
              このドキュメントのGoogle Driveエクスポートを再試行します。よろしいですか？
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm">
              <span className="text-gray-500">ファイル名:</span> {row.fileName}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRetryConfirmOpen(false)}>
              キャンセル
            </Button>
            <Button onClick={handleRetry} disabled={retry.isPending}>
              <RefreshCw className="h-4 w-4 mr-2" />
              {retry.isPending ? '処理中...' : 'リトライを実行'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
