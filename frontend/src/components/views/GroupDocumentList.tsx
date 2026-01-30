/**
 * グループ内ドキュメント一覧コンポーネント
 *
 * 特定のグループに属するドキュメントを表示
 * 無限スクロール対応
 */

import { useRef, useEffect, useCallback } from 'react';
import { FileText, Loader2, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  useGroupDocuments,
  type GroupType,
} from '@/hooks/useDocumentGroups';
import { isCustomerConfirmed } from '@/hooks/useProcessingHistory';
import { CustomerSubGroup } from './CustomerSubGroup';
import { getStatusConfig, formatTimestamp } from '@/lib/documentUtils';
import type { Document } from '@shared/types';

// ============================================
// 型定義
// ============================================

interface GroupDocumentListProps {
  groupType: GroupType;
  groupKey: string;
  onDocumentSelect?: (documentId: string) => void;
}


// ============================================
// ドキュメント行コンポーネント
// ============================================

interface DocumentRowProps {
  document: Document;
  groupType: GroupType;
  onClick: () => void;
}

function DocumentRow({ document, groupType, onClick }: DocumentRowProps) {
  const statusConfig = getStatusConfig(document.status);

  // 要確認判定（顧客・事業所）
  const needsCustomerConfirmation = !isCustomerConfirmed(document);
  const needsOfficeConfirmation =
    document.officeConfirmed === false &&
    document.officeCandidates &&
    document.officeCandidates.length > 0;
  const needsReview = needsCustomerConfirmation || needsOfficeConfirmation;

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
          {document.fileName}
        </p>
        <p className="text-xs text-gray-500 truncate">{getSubInfo()}</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-xs text-gray-500 hidden sm:inline">
          {formatTimestamp(document.fileDate)}
        </span>
        {needsReview ? (
          <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-300 text-xs">
            要確認
          </Badge>
        ) : (
          <Badge variant={statusConfig.variant} className="text-xs">
            {statusConfig.label}
          </Badge>
        )}
      </div>
    </div>
  );
}

// ============================================
// メインコンポーネント
// ============================================

export function GroupDocumentList({
  groupType,
  groupKey,
  onDocumentSelect,
}: GroupDocumentListProps) {
  const loadMoreRef = useRef<HTMLDivElement>(null);

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
    pageSize: 20,
  });

  // 無限スクロール用のIntersectionObserver
  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          handleLoadMore();
        }
      },
      { threshold: 0.1 }
    );

    const current = loadMoreRef.current;
    if (current) {
      observer.observe(current);
    }

    return () => {
      if (current) {
        observer.unobserve(current);
      }
    };
  }, [handleLoadMore]);

  // 全ページのドキュメントを結合
  const allDocuments = data?.pages.flatMap((page) => page.documents) ?? [];

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

  // 担当CM別の場合は顧客サブグループで表示
  if (groupType === 'careManager') {
    return (
      <div className="max-h-[500px] overflow-y-auto">
        <CustomerSubGroup
          documents={allDocuments}
          onDocumentSelect={onDocumentSelect}
        />

        {/* さらに読み込む */}
        {hasNextPage && (
          <div
            ref={loadMoreRef}
            className="flex items-center justify-center py-4 border-t border-gray-100"
          >
            {isFetchingNextPage ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                <span className="ml-2 text-xs text-gray-500">読み込み中...</span>
              </>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLoadMore}
                className="text-xs text-gray-500"
              >
                <ChevronDown className="h-4 w-4 mr-1" />
                さらに表示
              </Button>
            )}
          </div>
        )}
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
          />
        ))}
      </div>

      {/* さらに読み込む */}
      {hasNextPage && (
        <div
          ref={loadMoreRef}
          className="flex items-center justify-center py-4"
        >
          {isFetchingNextPage ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
              <span className="ml-2 text-xs text-gray-500">読み込み中...</span>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLoadMore}
              className="text-xs text-gray-500"
            >
              <ChevronDown className="h-4 w-4 mr-1" />
              さらに表示
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
