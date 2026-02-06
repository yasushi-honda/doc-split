/**
 * グループ一覧コンポーネント
 *
 * ドキュメントグループをアコーディオン形式で表示
 * 展開時にグループ内ドキュメントを取得・表示
 * 顧客別: あいうえお順ソート + あかさたなフィルター
 * 担当CM別: 顧客サブグループをあいうえお順
 * 他タブ: 件数順（従来通り）
 */

import { useState, useCallback, useMemo } from 'react';
import {
  ChevronRight,
  ChevronDown,
  FileText,
  Users,
  Building2,
  FolderOpen,
  UserCheck,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Timestamp } from 'firebase/firestore';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  useDocumentGroups,
  useGroupStats,
  type GroupType,
  type DocumentGroup,
} from '@/hooks/useDocumentGroups';
import { useCustomers } from '@/hooks/useMasters';
import { KanaFilterBar } from '@/components/KanaFilterBar';
import {
  buildFuriganaMap,
  sortGroupsByFurigana,
  filterGroupsByKanaRow,
  type KanaRow,
} from '@/lib/kanaUtils';
import { GroupDocumentList } from './GroupDocumentList';
import type { DateRange } from '@/components/DateRangeFilter';

// ============================================
// 型定義
// ============================================

interface GroupListProps {
  groupType: GroupType;
  dateFilter?: DateRange;
  onDocumentSelect?: (documentId: string) => void;
}

// ============================================
// グループタイプ設定
// ============================================

const GROUP_TYPE_CONFIG: Record<
  GroupType,
  { label: string; icon: React.ComponentType<{ className?: string }>; emptyMessage: string }
> = {
  customer: {
    label: '顧客別',
    icon: Users,
    emptyMessage: '顧客データがありません',
  },
  office: {
    label: '事業所別',
    icon: Building2,
    emptyMessage: '事業所データがありません',
  },
  documentType: {
    label: '書類種別',
    icon: FolderOpen,
    emptyMessage: '書類種別データがありません',
  },
  careManager: {
    label: '担当CM別',
    icon: UserCheck,
    emptyMessage: 'ケアマネジャーデータがありません',
  },
};

// ============================================
// Timestampフォーマット
// ============================================

function formatTimestamp(timestamp: Timestamp | undefined): string {
  if (!timestamp) return '-';
  try {
    return format(timestamp.toDate(), 'yyyy/MM/dd', { locale: ja });
  } catch {
    return '-';
  }
}

// ============================================
// グループアイテムコンポーネント
// ============================================

interface GroupItemProps {
  group: DocumentGroup;
  isExpanded: boolean;
  furiganaMap?: Map<string, string>;
  dateFilter?: DateRange;
  onToggle: () => void;
  onDocumentSelect?: (documentId: string) => void;
}

function GroupItem({ group, isExpanded, furiganaMap, dateFilter, onToggle, onDocumentSelect }: GroupItemProps) {
  const config = GROUP_TYPE_CONFIG[group.groupType];
  const Icon = config.icon;

  return (
    <div className="border-b border-gray-100 last:border-0">
      {/* グループヘッダー */}
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50"
      >
        {isExpanded ? (
          <ChevronDown className="h-5 w-5 flex-shrink-0 text-gray-400" />
        ) : (
          <ChevronRight className="h-5 w-5 flex-shrink-0 text-gray-400" />
        )}
        <Icon className="h-5 w-5 flex-shrink-0 text-gray-400" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900 truncate">
              {group.displayName || '未判定'}
            </span>
            <Badge variant="secondary" className="text-xs">
              {group.count}件
            </Badge>
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            最終更新: {formatTimestamp(group.latestAt)}
          </div>
        </div>
      </button>

      {/* グループ内ドキュメント（展開時） */}
      {isExpanded && (
        <div className="border-t border-gray-100 bg-gray-50/50">
          <GroupDocumentList
            groupType={group.groupType}
            groupKey={group.groupKey}
            furiganaMap={furiganaMap}
            dateFilter={dateFilter}
            onDocumentSelect={onDocumentSelect}
          />
        </div>
      )}
    </div>
  );
}

// ============================================
// メインコンポーネント
// ============================================

export function GroupList({ groupType, dateFilter, onDocumentSelect }: GroupListProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedKanaRow, setSelectedKanaRow] = useState<KanaRow | null>(null);

  const isCustomerView = groupType === 'customer';
  const needsFurigana = groupType === 'customer' || groupType === 'careManager';

  const {
    data: groups,
    isLoading,
    isError,
    error,
  } = useDocumentGroups({
    groupType,
    // 顧客別: クライアントソートのためorderBy/limitなし
    sortBy: isCustomerView ? 'none' : 'count',
    limitCount: isCustomerView ? undefined : 100,
  });

  const { data: stats } = useGroupStats(groupType);

  // 顧客マスター（顧客別・担当CM別のみ取得）
  const { data: customers } = useCustomers();
  const isFuriganaReady = needsFurigana ? !!customers : true;
  const furiganaMap = useMemo(
    () => (needsFurigana && customers ? buildFuriganaMap(customers) : new Map<string, string>()),
    [needsFurigana, customers]
  );

  // 顧客別: あいうえお順ソート + フィルター
  // furiganaMap未準備時はソート・フィルターをスキップ（空結果防止）
  const displayGroups = useMemo(() => {
    if (!groups) return [];
    if (!isCustomerView) return groups;
    if (!isFuriganaReady) return groups;
    const sorted = sortGroupsByFurigana(groups, furiganaMap);
    return filterGroupsByKanaRow(sorted, selectedKanaRow, furiganaMap);
  }, [groups, isCustomerView, isFuriganaReady, furiganaMap, selectedKanaRow]);

  const config = GROUP_TYPE_CONFIG[groupType];

  const toggleGroup = useCallback((groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  // ローディング
  if (isLoading) {
    return (
      <Card>
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          <span className="ml-2 text-gray-500">読み込み中...</span>
        </div>
      </Card>
    );
  }

  // エラー
  if (isError) {
    return (
      <Card>
        <div className="flex flex-col items-center justify-center py-16 text-red-500">
          <AlertCircle className="mb-2 h-8 w-8" />
          <p>データの読み込みに失敗しました</p>
          <p className="text-sm text-gray-500">{error?.message}</p>
        </div>
      </Card>
    );
  }

  // 空状態
  if (!groups || groups.length === 0) {
    return (
      <Card>
        <div className="flex flex-col items-center justify-center py-16 text-gray-500">
          <FileText className="mb-4 h-12 w-12 text-gray-300" />
          <p className="text-lg font-medium">{config.emptyMessage}</p>
          <p className="mt-1 text-sm">
            書類が取得されると、ここにグループ表示されます
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* 統計情報 */}
      {stats && (
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span>
            <span className="font-medium text-gray-900">{stats.totalGroups}</span>
            &nbsp;グループ
          </span>
          <span>•</span>
          <span>
            <span className="font-medium text-gray-900">{stats.totalDocuments}</span>
            &nbsp;件
          </span>
        </div>
      )}

      {/* あかさたなフィルター（顧客別のみ） */}
      {isCustomerView && (
        <KanaFilterBar
          selected={selectedKanaRow}
          onSelect={setSelectedKanaRow}
          disabled={!isFuriganaReady}
        />
      )}

      {/* グループ一覧 */}
      <Card>
        {/* フィルター適用時の件数表示 */}
        {isCustomerView && selectedKanaRow && (
          <div className="px-4 py-2 text-xs text-gray-500 border-b border-gray-100">
            {displayGroups.length}件 / {groups.length}件
          </div>
        )}
        <div className="divide-y divide-gray-100">
          {displayGroups.map((group) => (
            <GroupItem
              key={group.id}
              group={group}
              isExpanded={expandedGroups.has(group.id)}
              furiganaMap={needsFurigana ? furiganaMap : undefined}
              dateFilter={dateFilter}
              onToggle={() => toggleGroup(group.id)}
              onDocumentSelect={onDocumentSelect}
            />
          ))}
        </div>
        {/* フィルターで結果0件の場合 */}
        {isCustomerView && selectedKanaRow && displayGroups.length === 0 && (
          <div className="py-8 text-center text-sm text-gray-500">
            「{selectedKanaRow}」行の顧客はいません
          </div>
        )}
      </Card>
    </div>
  );
}
