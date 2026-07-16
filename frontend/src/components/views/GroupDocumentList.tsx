/**
 * グループ内ドキュメント一覧コンポーネント
 *
 * 特定のグループに属するドキュメントを表示
 * 無限スクロール対応
 */

import { useMemo, useState } from 'react';
import { FileText, Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { LoadMoreIndicator } from '@/components/LoadMoreIndicator';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { useReprocessDocument } from '@/hooks/useDocuments';
import { useDocumentTypes } from '@/hooks/useMasters';
import {
  useGroupDocuments,
  type GroupType,
} from '@/hooks/useDocumentGroups';
import { isCustomerConfirmed } from '@/hooks/useProcessingHistory';
import { CustomerSubGroup } from './CustomerSubGroup';
import { getStatusConfig, formatTimestamp } from '@/lib/documentUtils';
import { getDisplayFileName } from '@/utils/getDisplayFileName';
import type { Document } from '@shared/types';
import type { DateRange } from '@/components/DateRangeFilter';

// ============================================
// 型定義
// ============================================

interface GroupDocumentListProps {
  groupType: GroupType;
  groupKey: string;
  furiganaMap?: Map<string, string>;
  dateFilter?: DateRange;
  onDocumentSelect?: (documentId: string) => void;
}


// ============================================
// ドキュメント行コンポーネント
// ============================================

interface DocumentRowProps {
  document: Document;
  groupType: GroupType;
  onClick: () => void;
  /** error 書類の「再試行」(#524)。未指定時はボタン非表示 */
  onRetry?: (document: Document) => void;
}

function DocumentRow({ document, groupType, onClick, onRetry }: DocumentRowProps) {
  const statusConfig = getStatusConfig(document.status);

  // 選択待ち判定（顧客・事業所）
  const needsCustomerConfirmation = !isCustomerConfirmed(document);
  const needsOfficeConfirmation =
    document.officeConfirmed === false &&
    document.officeCandidates &&
    document.officeCandidates.length > 0;
  const needsReview = needsCustomerConfirmation || needsOfficeConfirmation;

  // OCR未確認
  const isUnverified = !document.verified;

  // グループタイプに応じて表示するサブ情報を変更
  const getSubInfo = () => {
    switch (groupType) {
      case 'customer':
        return document.documentType || '未判定';
      case 'office':
        return document.customerName || '未判定';
      case 'documentType':
        return document.customerName || '未判定';
      case 'careManager':
        return document.customerName || '未判定';
      default:
        return document.documentType || '未判定';
    }
  };

  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors hover:bg-gray-100"
      onClick={onClick}
    >
      <FileText className="h-4 w-4 flex-shrink-0 text-gray-400" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">
          {getDisplayFileName(document)}
        </p>
        <p className="text-xs text-gray-500 truncate">{getSubInfo()}</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* ページ数 (#525): 0 (旧形式 doc) は非表示 */}
        {document.totalPages > 0 && (
          <span className="text-xs text-gray-400 hidden sm:inline">
            {document.totalPages}ページ
          </span>
        )}
        <span className="text-xs text-gray-500 hidden sm:inline">
          {formatTimestamp(document.fileDate)}
        </span>
        {needsReview ? (
          <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-300 text-xs">
            選択待ち
          </Badge>
        ) : (
          <Badge variant={statusConfig.variant} className="text-xs">
            {statusConfig.label}
          </Badge>
        )}
        {isUnverified && (
          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300 text-xs">
            未確認
          </Badge>
        )}
        {document.status === 'error' && onRetry && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-xs text-blue-600 border-blue-300 hover:bg-blue-50"
            onClick={(e) => {
              e.stopPropagation();
              onRetry(document);
            }}
          >
            <RefreshCw className="h-3 w-3 sm:mr-1" />
            <span className="hidden sm:inline">再試行</span>
          </Button>
        )}
      </div>
    </div>
  );
}

// ============================================
// メインコンポーネント
// ============================================

// 日付フィルタリング関数
function filterByDate(docs: Document[], dateFilter?: DateRange): Document[] {
  if (!dateFilter?.dateFrom && !dateFilter?.dateTo) return docs;

  return docs.filter((doc) => {
    try {
      const ts = dateFilter.dateField === 'processedAt'
        ? doc.processedAt
        : doc.fileDate;
      if (!ts) return false;
      const date = ts.toDate();
      if (dateFilter.dateFrom && date < dateFilter.dateFrom) return false;
      if (dateFilter.dateTo && date > dateFilter.dateTo) return false;
      return true;
    } catch {
      return false;
    }
  });
}

export function GroupDocumentList({
  groupType,
  groupKey,
  furiganaMap,
  dateFilter,
  onDocumentSelect,
}: GroupDocumentListProps) {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
  } = useGroupDocuments({
    groupType,
    groupKey,
    pageSize: 100,
  });
  const { loadMoreRef } = useInfiniteScroll({ hasNextPage: !!hasNextPage, isFetchingNextPage, fetchNextPage });

  // カテゴリフォルダ表示用の書類マスター（書類種別タブと同一 queryKey でキャッシュ共有）。
  // 取得失敗時は undefined のまま渡し、CustomerSubGroup 側が書類種別表示にフォールバックする
  const { data: documentMasters } = useDocumentTypes();

  // error 書類の「再試行」(#524): 行ボタン → 確認ダイアログ → 再処理
  const { reprocess, reprocessingId } = useReprocessDocument();
  const [retryTarget, setRetryTarget] = useState<Document | null>(null);
  const handleRetryConfirm = async () => {
    if (!retryTarget) return;
    const ok = await reprocess(retryTarget.id);
    if (ok) setRetryTarget(null);
  };

  // 全ページのドキュメントを結合 + 日付フィルター適用
  const allDocuments = useMemo(
    () => filterByDate(data?.pages.flatMap((page) => page.documents) ?? [], dateFilter),
    [data?.pages, dateFilter]
  );

  // ローディング（初回）
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        <span className="ml-2 text-sm text-gray-500">読み込み中...</span>
      </div>
    );
  }

  // エラー
  if (isError) {
    return (
      <div className="py-8 text-center text-sm text-red-500">
        データの読み込みに失敗しました
      </div>
    );
  }

  // 空状態
  if (allDocuments.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-gray-500">
        このグループには書類がありません
      </div>
    );
  }

  // error 書類の再試行確認ダイアログ (#524)
  const retryDialog = (
    <AlertDialog open={retryTarget !== null} onOpenChange={(open) => !open && setRetryTarget(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>再処理を実行しますか？</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p className="break-all">対象: {retryTarget ? getDisplayFileName(retryTarget) : ''}</p>
              <p>
                エラー状態の書類のOCR処理を再実行します。抽出済みのメタ情報・確認状態はリセットされ、
                AIが再抽出します。再処理中はグループ分けから一時的に外れます。
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={reprocessingId !== null}>キャンセル</AlertDialogCancel>
          <Button
            onClick={handleRetryConfirm}
            disabled={reprocessingId !== null}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {reprocessingId !== null ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-4 w-4" />
            )}
            {reprocessingId !== null ? '処理中...' : '再処理を実行'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  // 担当CM別の場合は顧客サブグループで表示
  if (groupType === 'careManager') {
    return (
      <div className="max-h-[500px] overflow-y-auto">
        <CustomerSubGroup
          documents={allDocuments}
          furiganaMap={furiganaMap}
          documentMasters={documentMasters}
          onDocumentSelect={onDocumentSelect}
          onRetry={setRetryTarget}
        />

        <LoadMoreIndicator
          ref={loadMoreRef}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          className="border-t border-gray-100"
        />
        {retryDialog}
      </div>
    );
  }

  // その他のグループタイプは従来のフラット表示
  return (
    <div className="max-h-96 overflow-y-auto">
      {/* ドキュメント一覧 */}
      <div className="divide-y divide-gray-100">
        {allDocuments.map((doc) => (
          <DocumentRow
            key={doc.id}
            document={doc}
            groupType={groupType}
            onClick={() => onDocumentSelect?.(doc.id)}
            onRetry={setRetryTarget}
          />
        ))}
      </div>

      <LoadMoreIndicator
        ref={loadMoreRef}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
      />
      {retryDialog}
    </div>
  );
}
