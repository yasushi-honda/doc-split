/**
 * 顧客サブグループコンポーネント
 *
 * 担当CM別ビューで、ケアマネ配下のドキュメントを顧客ごとにグループ化して表示
 */

import { useState, useMemo } from 'react';
import {
  ChevronRight,
  ChevronDown,
  FileText,
  Users,
  RefreshCw,
} from 'lucide-react';
import { Timestamp } from 'firebase/firestore';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { isCustomerConfirmed } from '@/hooks/useProcessingHistory';
import { getStatusConfig, formatTimestamp } from '@/lib/documentUtils';
import type { Document } from '@shared/types';

// ============================================
// 型定義
// ============================================

interface CustomerSubGroupProps {
  documents: Document[];
  furiganaMap?: Map<string, string>;
  onDocumentSelect?: (documentId: string) => void;
  /** error 書類の「再試行」(#524)。未指定時はボタン非表示 */
  onRetry?: (document: Document) => void;
}

interface CustomerGroup {
  customerKey: string;
  customerName: string;
  documents: Document[];
  latestAt: Timestamp | null;
}


function groupByCustomer(
  documents: Document[],
  furiganaMap?: Map<string, string>
): CustomerGroup[] {
  const groupMap = new Map<string, CustomerGroup>();

  for (const doc of documents) {
    const key = doc.customerKey || doc.customerName || '未判定';
    const name = doc.customerName || '未判定';

    if (!groupMap.has(key)) {
      groupMap.set(key, {
        customerKey: key,
        customerName: name,
        documents: [],
        latestAt: null,
      });
    }

    const group = groupMap.get(key)!;
    group.documents.push(doc);

    // 最新日時を更新
    if (doc.processedAt) {
      if (!group.latestAt || doc.processedAt.toMillis() > group.latestAt.toMillis()) {
        group.latestAt = doc.processedAt;
      }
    }
  }

  const groups = Array.from(groupMap.values());

  // ふりがなマップがある場合はあいうえお順、なければ件数順
  if (furiganaMap && furiganaMap.size > 0) {
    return groups.sort((a, b) => {
      const readingA = furiganaMap.get(a.customerName) ?? '';
      const readingB = furiganaMap.get(b.customerName) ?? '';
      if (readingA && !readingB) return -1;
      if (!readingA && readingB) return 1;
      if (!readingA && !readingB) return a.customerName.localeCompare(b.customerName, 'ja');
      return readingA.localeCompare(readingB, 'ja');
    });
  }
  return groups.sort((a, b) => b.documents.length - a.documents.length);
}

// ============================================
// ドキュメント行コンポーネント
// ============================================

interface DocumentRowProps {
  document: Document;
  onClick: () => void;
  onRetry?: (document: Document) => void;
}

function DocumentRow({ document, onClick, onRetry }: DocumentRowProps) {
  const statusConfig = getStatusConfig(document.status);

  // 選択待ち判定
  const needsCustomerConfirmation = !isCustomerConfirmed(document);
  const needsOfficeConfirmation =
    document.officeConfirmed === false &&
    document.officeCandidates &&
    document.officeCandidates.length > 0;
  const needsReview = needsCustomerConfirmation || needsOfficeConfirmation;

  // OCR未確認
  const isUnverified = !document.verified;

  return (
    <div
      className="flex items-center gap-3 px-4 py-2 cursor-pointer transition-colors hover:bg-gray-100"
      onClick={onClick}
    >
      <FileText className="h-4 w-4 flex-shrink-0 text-gray-400" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">
          {document.fileName}
        </p>
        <p className="text-xs text-gray-500 truncate">
          {document.documentType || '未判定'}
        </p>
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
// 顧客グループアイテムコンポーネント
// ============================================

interface CustomerGroupItemProps {
  group: CustomerGroup;
  isExpanded: boolean;
  onToggle: () => void;
  onDocumentSelect?: (documentId: string) => void;
  onRetry?: (document: Document) => void;
}

function CustomerGroupItem({
  group,
  isExpanded,
  onToggle,
  onDocumentSelect,
  onRetry,
}: CustomerGroupItemProps) {
  return (
    <div className="border-b border-gray-100 last:border-0">
      {/* 顧客グループヘッダー */}
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-gray-100"
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 flex-shrink-0 text-gray-400" />
        ) : (
          <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-400" />
        )}
        <Users className="h-4 w-4 flex-shrink-0 text-blue-500" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-800 truncate">
              {group.customerName}
            </span>
            <Badge variant="outline" className="text-xs">
              {group.documents.length}件
            </Badge>
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            最終更新: {formatTimestamp(group.latestAt)}
          </div>
        </div>
      </button>

      {/* 顧客グループ内ドキュメント（展開時） */}
      {isExpanded && (
        <div className="bg-white border-t border-gray-50 ml-6">
          {group.documents.map((doc) => (
            <DocumentRow
              key={doc.id}
              document={doc}
              onClick={() => onDocumentSelect?.(doc.id)}
              onRetry={onRetry}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================
// メインコンポーネント
// ============================================

export function CustomerSubGroup({
  documents,
  furiganaMap,
  onDocumentSelect,
  onRetry,
}: CustomerSubGroupProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // ドキュメントを顧客ごとにグループ化（ふりがなマップがあればあいうえお順）
  const customerGroups = useMemo(
    () => groupByCustomer(documents, furiganaMap),
    [documents, furiganaMap]
  );

  const toggleGroup = (customerKey: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(customerKey)) {
        next.delete(customerKey);
      } else {
        next.add(customerKey);
      }
      return next;
    });
  };

  if (customerGroups.length === 0) {
    return (
      <div className="py-4 text-center text-sm text-gray-500">
        このグループには書類がありません
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100">
      {customerGroups.map((group) => (
        <CustomerGroupItem
          key={group.customerKey}
          group={group}
          isExpanded={expandedGroups.has(group.customerKey)}
          onToggle={() => toggleGroup(group.customerKey)}
          onDocumentSelect={onDocumentSelect}
          onRetry={onRetry}
        />
      ))}
    </div>
  );
}
