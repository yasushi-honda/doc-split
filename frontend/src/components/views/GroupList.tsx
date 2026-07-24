/**
 * グループ一覧コンポーネント
 *
 * ドキュメントグループをアコーディオン形式で表示
 * 展開時にグループ内ドキュメントを取得・表示
 * 顧客別: あいうえお順ソート + あかさたなフィルター
 * 担当CM別: 顧客サブグループをあいうえお順
 * 他タブ: 件数順（従来通り）
 */

import { useState, useCallback, useMemo, type ReactNode } from 'react';
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
  Search,
  X,
} from 'lucide-react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Timestamp } from 'firebase/firestore';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  useDocumentGroups,
  useGroupStats,
  type GroupType,
  type DocumentGroup,
} from '@/hooks/useDocumentGroups';
import { useCustomers, useDocumentTypes } from '@/hooks/useMasters';
import { KanaFilterBar } from '@/components/KanaFilterBar';
import {
  buildFuriganaMap,
  sortGroupsByFurigana,
  filterGroupsByKanaRow,
  type KanaRow,
} from '@/lib/kanaUtils';
import {
  buildDocumentTypeCategoryGroups,
  isAllUncategorized,
  summarizeCategoryGroups,
  type CategoryHierarchy,
} from '@/lib/buildDocumentTypeCategoryGroups';
import { filterGroupsByName, filterCategoryHierarchyByName } from '@/lib/filterGroupsByName';
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

interface CategoryItemProps {
  category: CategoryHierarchy;
  isExpanded: boolean;
  onToggleCategory: () => void;
  children: ReactNode;
}

function CategoryItem({
  category,
  isExpanded,
  onToggleCategory,
  children,
}: CategoryItemProps) {
  const { totalDocs, latestAt } = summarizeCategoryGroups(category.groups);

  return (
    <div className="border-b border-gray-100 last:border-0">
      <button
        onClick={onToggleCategory}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50"
      >
        {isExpanded ? (
          <ChevronDown className="h-5 w-5 flex-shrink-0 text-gray-400" />
        ) : (
          <ChevronRight className="h-5 w-5 flex-shrink-0 text-gray-400" />
        )}
        <FolderOpen className="h-5 w-5 flex-shrink-0 text-blue-500" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900 truncate">
              {category.categoryName}
            </span>
            <Badge variant="secondary" className="text-xs">
              {category.groups.length}種別 / {totalDocs}件
            </Badge>
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            最終更新: {formatTimestamp(latestAt)}
          </div>
        </div>
      </button>
      {isExpanded && (
        <div className="border-t border-gray-100 bg-gray-50/30 pl-6 divide-y divide-gray-100">
          {children}
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
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [selectedKanaRow, setSelectedKanaRow] = useState<KanaRow | null>(null);
  const [nameFilter, setNameFilter] = useState('');

  const isCustomerView = groupType === 'customer';
  const isDocumentTypeView = groupType === 'documentType';
  const needsFurigana = groupType === 'customer' || groupType === 'careManager';

  const {
    data: groups,
    isLoading,
    isError,
    error,
  } = useDocumentGroups({
    // サーバー側 count 降順 + 上位100件キャップだと、書類数の少ない事業所/担当CMが
    // 恒久的に非表示になる（バグ②）。全グループタイプで全件取得し、必要なソート・
    // 上限は displayGroups 側でクライアント処理する。
    groupType,
    sortBy: 'none',
    limitCount: undefined,
  });

  const { data: stats } = useGroupStats(groupType);

  // 顧客マスター（顧客別・担当CM別のみ取得）
  const { data: customers } = useCustomers();
  const isFuriganaReady = needsFurigana ? !!customers : true;
  const furiganaMap = useMemo(
    () => (needsFurigana && customers ? buildFuriganaMap(customers) : new Map<string, string>()),
    [needsFurigana, customers]
  );

  const {
    data: documentMasters,
    isError: isMasterError,
    error: masterError,
  } = useDocumentTypes();

  if (isDocumentTypeView && isMasterError) {
    console.warn('[GroupList] 書類マスター取得失敗 → カテゴリ階層を出さずフラット表示にフォールバック', masterError);
  }

  const categoryHierarchy = useMemo(
    () =>
      isDocumentTypeView
        ? buildDocumentTypeCategoryGroups(groups ?? [], documentMasters)
        : [],
    [isDocumentTypeView, groups, documentMasters],
  );
  // カテゴリ未運用テナントでは未分類 1 件にまとまるため、階層 UI を出さず従来のフラット表示に戻す
  const useCategoryHierarchy =
    isDocumentTypeView && categoryHierarchy.length > 0 && !isAllUncategorized(categoryHierarchy);

  // カテゴリ階層表示時のフリーテキスト絞り込み: カテゴリ内のグループをそれぞれ絞り込み、
  // 一致するグループが0件になったカテゴリは表示から除外する
  // (/codex review-diff指摘: kanameone 126/126・cocoro 27/27件でcategory運用済みのため
  //  「カテゴリ階層表示時は検索欄非表示」のままだと両クライアントで検索機能が実質使えなかった)
  const filteredCategoryHierarchy = useMemo(() => {
    if (!useCategoryHierarchy) return categoryHierarchy;
    return filterCategoryHierarchyByName(categoryHierarchy, nameFilter);
  }, [categoryHierarchy, useCategoryHierarchy, nameFilter]);

  // 顧客別: あいうえお順ソート + フィルター
  // furiganaMap未準備時はソート・フィルターをスキップ（空結果防止）
  // 書類種別タブ・階層省略時: 全件取得しているので件数降順 + 上位 100 件で従来表示と同等にする
  const displayGroups = useMemo(() => {
    if (!groups) return [];
    // カテゴリ階層表示は filteredCategoryHierarchy 側で絞り込むため、ここでは元のgroupsをそのまま返す
    if (isDocumentTypeView && useCategoryHierarchy) return groups;

    // フリーテキスト絞り込みは、書類種別フラット表示の上位100件キャップより先に適用する。
    // 先に上位100件へ切り詰めてしまうと、101件目以降にしか存在しない書類種別を検索しても
    // 常に0件になる不具合が起きるため（/code-review指摘）。
    const nameFiltered = filterGroupsByName(groups, nameFilter);

    if (isCustomerView) {
      if (!isFuriganaReady) return nameFiltered;
      const sorted = sortGroupsByFurigana(nameFiltered, furiganaMap);
      return filterGroupsByKanaRow(sorted, selectedKanaRow, furiganaMap);
    }
    if (isDocumentTypeView) {
      // 書類種別タブ・階層省略時: 件数降順 + 上位100件で従来表示と同等にする
      return [...nameFiltered].sort((a, b) => b.count - a.count).slice(0, 100);
    }
    // 事業所別・担当CM別: サーバー側の上位100件キャップを廃止したため、
    // 従来の表示順（件数降順）をクライアント側で維持する（全件表示、上限なし）
    return [...nameFiltered].sort((a, b) => b.count - a.count);
  }, [groups, isCustomerView, isDocumentTypeView, useCategoryHierarchy, isFuriganaReady, furiganaMap, selectedKanaRow, nameFilter]);

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

  const toggleCategory = useCallback((categoryName: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryName)) {
        next.delete(categoryName);
      } else {
        next.add(categoryName);
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

  // カテゴリ階層表示・フラット表示のどちらでも同じ基準で「絞り込み後の件数」「絞り込み結果0件」を扱う
  const matchedGroupCount = useCategoryHierarchy
    ? filteredCategoryHierarchy.reduce((sum, category) => sum + category.groups.length, 0)
    : displayGroups.length;
  const isNameFilterActive = nameFilter.trim().length > 0;
  const isNameFilterEmptyResult = isNameFilterActive && matchedGroupCount === 0;

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

      {/* グループ名フリーテキスト絞り込み（書類種別のカテゴリ階層表示時も対象） */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder={`${config.label}の名前で絞り込み...`}
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
          className="pl-9 pr-9"
        />
        {nameFilter && (
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 p-0"
            onClick={() => setNameFilter('')}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* あかさたなフィルター（顧客別のみ） */}
      {isCustomerView && (
        <KanaFilterBar
          selected={selectedKanaRow}
          onSelect={setSelectedKanaRow}
          disabled={!isFuriganaReady}
        />
      )}

      {isDocumentTypeView && isMasterError && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          書類マスターの取得に失敗したため、カテゴリ階層表示を一時的に無効化しています。再読込で改善する可能性があります。
        </div>
      )}

      {/* グループ一覧 */}
      <Card>
        {/* フィルター適用時の件数表示 */}
        {((isCustomerView && selectedKanaRow) || isNameFilterActive) && (
          <div className="px-4 py-2 text-xs text-gray-500 border-b border-gray-100">
            {matchedGroupCount}件 / {groups.length}件
          </div>
        )}
        {isNameFilterEmptyResult ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-500">
            <Search className="mb-4 h-12 w-12 text-gray-300" />
            <p className="text-lg font-medium">該当する{config.label}が見つかりません</p>
            <p className="mt-1 text-sm">絞り込みキーワードを変更してお試しください</p>
          </div>
        ) : (
        <div className="divide-y divide-gray-100">
          {useCategoryHierarchy
            ? filteredCategoryHierarchy.map((category) => (
                <CategoryItem
                  key={category.categoryName}
                  category={category}
                  isExpanded={expandedCategories.has(category.categoryName)}
                  onToggleCategory={() => toggleCategory(category.categoryName)}
                >
                  {category.groups.map((group) => (
                    <GroupItem
                      key={group.id}
                      group={group}
                      isExpanded={expandedGroups.has(group.id)}
                      dateFilter={dateFilter}
                      onToggle={() => toggleGroup(group.id)}
                      onDocumentSelect={onDocumentSelect}
                    />
                  ))}
                </CategoryItem>
              ))
            : displayGroups.map((group) => (
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
        )}
        {/* あかさたなフィルターで結果0件の場合（名前絞り込みが0件表示を出している間は重複表示しない） */}
        {isCustomerView && selectedKanaRow && displayGroups.length === 0 && !isNameFilterActive && (
          <div className="py-8 text-center text-sm text-gray-500">
            「{selectedKanaRow}」行の顧客はいません
          </div>
        )}
      </Card>
    </div>
  );
}
