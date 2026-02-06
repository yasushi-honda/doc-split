/**
 * 処理履歴ビューページ（Phase 7）
 *
 * 機能:
 * - 処理済みドキュメントの履歴表示
 * - 期間・ステータス・顧客確定状態フィルター
 * - 日付グルーピング表示
 * - 選択待ちバッジ表示
 */

import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  useProcessingHistory,
  groupDocumentsByDate,
  isCustomerConfirmed,
  getOcrExcerpt,
  type PeriodFilter,
  type StatusFilter,
  type ConfirmedFilter,
  type SortOrder,
  type ProcessingHistoryFilters,
} from '@/hooks/useProcessingHistory';
import { DocumentDetailModal } from '@/components/DocumentDetailModal';
import { LoadMoreIndicator } from '@/components/LoadMoreIndicator';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import type { Document as DocType, DocumentStatus } from '@shared/types';
import { Loader2, RefreshCw, ChevronDown, ChevronUp, AlertCircle, ArrowUpDown } from 'lucide-react';

// ============================================
// ステータスバッジコンポーネント
// ============================================

const statusConfig: Record<DocumentStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  processed: { label: '完了', variant: 'default' },
  processing: { label: '処理中', variant: 'secondary' },
  pending: { label: '待機中', variant: 'outline' },
  error: { label: 'エラー', variant: 'destructive' },
  split: { label: '分割済み', variant: 'secondary' },
};

function StatusBadge({ status }: { status: DocumentStatus }) {
  const config = statusConfig[status] || { label: status, variant: 'outline' as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

// ============================================
// 選択待ちバッジコンポーネント
// ============================================

function UnconfirmedBadge({ doc }: { doc: DocType }) {
  if (isCustomerConfirmed(doc)) return null;
  return (
    <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-300">
      選択待ち
    </Badge>
  );
}

// ============================================
// メインページコンポーネント
// ============================================

export function ProcessingHistoryPage() {
  // フィルター状態
  const [filters, setFilters] = useState<ProcessingHistoryFilters>({
    period: '7days',
    status: 'all',
    confirmed: 'all',
    sortOrder: 'desc',
  });

  // 選択中のドキュメントID（詳細モーダル用）
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);

  // データ取得
  const {
    documents,
    hasMore,
    isLoading,
    isFetchingMore,
    error,
    fetchNextPage,
    refetch,
  } = useProcessingHistory(filters);
  const { loadMoreRef } = useInfiniteScroll({ hasNextPage: hasMore, isFetchingNextPage: isFetchingMore, fetchNextPage });

  // 日付グルーピング
  const groupedDocs = groupDocumentsByDate(documents);

  // フィルター変更ハンドラー
  const handlePeriodChange = useCallback((value: string) => {
    setFilters(prev => ({ ...prev, period: value as PeriodFilter }));
  }, []);

  const handleStatusChange = useCallback((value: string) => {
    setFilters(prev => ({ ...prev, status: value as StatusFilter }));
  }, []);

  const handleConfirmedChange = useCallback((value: string) => {
    setFilters(prev => ({ ...prev, confirmed: value as ConfirmedFilter }));
  }, []);

  // ソート切り替えハンドラー
  const handleSortToggle = useCallback(() => {
    setFilters(prev => ({
      ...prev,
      sortOrder: prev.sortOrder === 'desc' ? 'asc' : 'desc',
    }));
  }, []);

  // 行クリックハンドラー
  const handleRowClick = useCallback((doc: DocType) => {
    setSelectedDocumentId(doc.id);
  }, []);

  return (
      <div className="space-y-6">
        {/* ヘッダー */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">処理履歴</h1>
          <Button variant="outline" size="sm" onClick={refetch} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            更新
          </Button>
        </div>

        {/* フィルター */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">フィルター</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              {/* 期間フィルター */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">期間:</span>
                <Select value={filters.period} onValueChange={handlePeriodChange}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7days">7日間</SelectItem>
                    <SelectItem value="30days">30日間</SelectItem>
                    <SelectItem value="all">全期間</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* ステータスフィルター */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">ステータス:</span>
                <Select value={filters.status} onValueChange={handleStatusChange}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全て</SelectItem>
                    <SelectItem value="processed">完了</SelectItem>
                    <SelectItem value="processing">処理中</SelectItem>
                    <SelectItem value="pending">待機中</SelectItem>
                    <SelectItem value="error">エラー</SelectItem>
                    <SelectItem value="split">分割済み</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* 顧客確定状態フィルター */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">顧客確定:</span>
                <Select value={filters.confirmed} onValueChange={handleConfirmedChange}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全て</SelectItem>
                    <SelectItem value="confirmed">確定済み</SelectItem>
                    <SelectItem value="unconfirmed">選択待ち</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* エラー表示 */}
        {error && (
          <Card className="border-destructive">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-5 w-5" />
                <span>データ取得エラー: {error.message}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ローディング */}
        {isLoading && (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* 履歴テーブル（日付グルーピング） */}
        {!isLoading && groupedDocs.length > 0 && (
          <div className="space-y-6">
            {groupedDocs.map((group) => (
              <Card key={group.date}>
                <CardHeader className="py-3 sticky top-0 bg-background z-10 border-b">
                  <CardTitle className="text-base font-medium">{group.date}</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead
                          className="w-[180px] cursor-pointer hover:bg-muted/50 select-none"
                          onClick={handleSortToggle}
                        >
                          <div className="flex items-center gap-1">
                            <span>処理日時</span>
                            {filters.sortOrder === 'asc' ? (
                              <ChevronUp className="h-4 w-4 text-blue-600" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-blue-600" />
                            )}
                          </div>
                        </TableHead>
                        <TableHead>ファイル名</TableHead>
                        <TableHead className="w-[150px]">顧客名</TableHead>
                        <TableHead className="w-[120px]">書類種別</TableHead>
                        <TableHead className="w-[100px]">ステータス</TableHead>
                        <TableHead className="w-[250px]">OCR抜粋</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.documents.map((doc) => (
                        <TableRow
                          key={doc.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => handleRowClick(doc)}
                        >
                          <TableCell className="text-sm text-muted-foreground">
                            {doc.processedAt.toDate().toLocaleString('ja-JP')}
                          </TableCell>
                          <TableCell className="font-medium max-w-[200px] truncate">
                            {doc.fileName}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="truncate max-w-[100px]">{doc.customerName}</span>
                              <UnconfirmedBadge doc={doc} />
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">{doc.documentType}</TableCell>
                          <TableCell>
                            <StatusBadge status={doc.status} />
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground truncate max-w-[250px]">
                            {getOcrExcerpt(doc)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ))}

            {/* 無限スクロール読み込みインジケーター */}
            <LoadMoreIndicator
              ref={loadMoreRef}
              hasNextPage={hasMore}
              isFetchingNextPage={isFetchingMore}
            />
          </div>
        )}

        {/* データなし */}
        {!isLoading && groupedDocs.length === 0 && !error && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              該当するドキュメントがありません
            </CardContent>
          </Card>
        )}

        {/* 詳細モーダル */}
        <DocumentDetailModal
          documentId={selectedDocumentId}
          open={!!selectedDocumentId}
          onOpenChange={(open) => !open && setSelectedDocumentId(null)}
        />
      </div>
  );
}
