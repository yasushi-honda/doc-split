/**
 * グループ内ドキュメント一覧コンポーネント
 *
 * 特定のグループに属するドキュメントを表示
 * 無限スクロール対応
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FileText, Loader2, RefreshCw, Users } from 'lucide-react';
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
import { DocumentListUpdateBanner } from '@/components/DocumentListUpdateBanner';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { useReprocessDocument } from '@/hooks/useDocuments';
import { useDocumentTypes, useCustomerIdentityLookup, type CustomerIdentityLookup } from '@/hooks/useMasters';
import {
  useGroupDocuments,
  groupDocumentsQueryKey,
  resetGroupDocumentsToFirstPage,
  clearGroupDocumentsVariantDirty,
  type GroupType,
} from '@/hooks/useDocumentGroups';
import { useGroupDocumentListRefresh } from '@/hooks/useGroupDocumentListRefresh';
import { isCustomerConfirmed } from '@/hooks/useProcessingHistory';
import { CustomerSubGroup } from './CustomerSubGroup';
import { MultiCustomerBadge } from '@/components/MultiCustomerBadge';
import { getStatusConfig, formatTimestamp } from '@/lib/documentUtils';
import { getDisplayFileName } from '@/utils/getDisplayFileName';
import { resolveCustomerUnconfirmedReason } from '@shared/customerIdentity';
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
  identityLookup?: CustomerIdentityLookup;
}

function DocumentRow({ document, groupType, onClick, onRetry, identityLookup }: DocumentRowProps) {
  const statusConfig = getStatusConfig(document.status);

  // 選択待ち判定（顧客・事業所）
  const needsCustomerConfirmation = !isCustomerConfirmed(document);
  const needsOfficeConfirmation =
    document.officeConfirmed === false &&
    document.officeCandidates &&
    document.officeCandidates.length > 0;

  // 同姓同名判定(2026-07-26追加)
  const unconfirmedReason = identityLookup
    ? resolveCustomerUnconfirmedReason(document, {
        customerMasterName: document.customerId
          ? (identityLookup.customerMasterNameById.get(document.customerId) ?? null)
          : null,
        sameNameCollisionNames: identityLookup.sameNameCollisionNames,
      })
    : null;
  const isSameNameCollision = unconfirmedReason === 'same-name-collision';
  const needsReview = needsCustomerConfirmation || needsOfficeConfirmation || isSameNameCollision;

  // バッジ文言優先順位: 同姓同名 > 選択待ち。title は該当する全理由を列挙し、needsReview合成
  // による「事業所要対応が同姓同名バッジの裏で隠れる」ことを防ぐ(Codex plan review指摘)。
  const reviewReasons: string[] = [];
  if (isSameNameCollision) {
    reviewReasons.push('同姓同名の顧客マスターが複数あります。書類詳細で正しい顧客を選び直してください');
  } else if (needsCustomerConfirmation) {
    // Issue #1034: 顧客だけが未確定(同姓同名以外の理由)の場合、以前は理由が一切表示されず
    // 「なぜ選択待ちが消えないか」が伝わらなかった。
    reviewReasons.push('顧客が未確定です。書類詳細で候補を選択するか、確認済みにすると表示中の候補で確定します');
  }
  if (needsOfficeConfirmation) {
    reviewReasons.push('事業所が未選択です');
  }
  const reviewTitle = reviewReasons.length > 0 ? reviewReasons.join('。') : undefined;

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
        <MultiCustomerBadge document={document} />
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
          <Badge
            variant="outline"
            className="bg-orange-100 text-orange-800 border-orange-300 text-xs"
            title={reviewTitle}
          >
            {isSameNameCollision && <Users className="mr-1 h-3 w-3 inline" />}
            {isSameNameCollision ? '同姓同名' : '選択待ち'}
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
  const PAGE_SIZE = 100;
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    isLoading,
    isError,
    isRefetching,
    refetch,
  } = useGroupDocuments({
    groupType,
    groupKey,
    pageSize: PAGE_SIZE,
  });

  const queryClient = useQueryClient();
  const activeQueryKey = groupDocumentsQueryKey(groupType, groupKey, PAGE_SIZE);
  const { hasUpdates, message, resetBaseline } = useGroupDocumentListRefresh({
    groupType,
    groupKey,
    pageSize: PAGE_SIZE,
  });
  const [isRefreshingGroup, setIsRefreshingGroup] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  /**
   * 「更新があります」バナー押下時のハンドラ(2026-09-15、Issue #891修正)。
   * `useInfiniteScroll`はスクロールコンテナ末尾のsentinelを常時監視しているため、
   * pagesを1件に切り詰めた直後もsentinelが表示領域に残っていると`fetchNextPage`が
   * 即座に再発火し、「1ページのみ再取得」の意図が崩れる(plan-crossreview codex
   * pass1指摘)。`isRefreshingGroup`を`useInfiniteScroll`の`disabled`に渡してこれを防ぎ、
   * あわせてスクロール位置を先頭へ戻す(`DocumentsPage.tsx`の`refreshDocumentList`と
   * 同じ対策パターン)。
   */
  const handleRefresh = async () => {
    setIsRefreshingGroup(true);
    try {
      scrollContainerRef.current?.scrollTo({ top: 0 });
      await resetGroupDocumentsToFirstPage(queryClient, activeQueryKey);
      // groupStatsの再取得も明示的にawaitしてからresetBaselineを呼ぶ(codex review指摘、
      // 2026-09-15)。invalidateGroupQueries由来の`groupStats`再取得がまだ進行中の状態で
      // resetBaselineを呼ぶと、その時点のキャッシュ(=古い値)をbaselineとして確定してしまい、
      // 直後に進行中の再取得が新しい値で解決した瞬間、シグネチャ差分でバナーが即座に
      // 再表示されてしまう(`DocumentsPage.tsx`の`refreshDocumentList`と同じ対策)。
      const [result] = await Promise.all([
        refetch(),
        queryClient.refetchQueries({ queryKey: ['groupStats', groupType] }),
      ]);
      if (result.isSuccess) {
        clearGroupDocumentsVariantDirty(activeQueryKey);
        // pr-review-toolkit:pr-test-analyzer指摘(2026-09-15): queryClient.refetchQueries()は
        // 失敗してもエラーを握りつぶす(TanStack Query仕様、Promiseはresolveする)ため、
        // 上のPromise.allが成功したように見えても実はgroupStats再取得が失敗していることがある。
        // `DocumentsPage.tsx`の`refreshDocumentList`と同じく、失敗時は可視化だけしておく
        // (自己修復は既存の30秒ポーリング(useGroupStatsのrefetchInterval)に委ねる)。
        const statsState = queryClient.getQueryState(['groupStats', groupType]);
        if (statsState?.status === 'error') {
          console.error(
            '[GroupDocumentList] groupStats refetch failed; baseline may use stale stats',
            statsState.error
          );
        }
        resetBaseline();
      }
    } finally {
      setIsRefreshingGroup(false);
    }
  };

  const { loadMoreRef } = useInfiniteScroll({
    hasNextPage: !!hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    disabled: isRefreshingGroup,
  });

  /**
   * 担当CM別(#1032): 利用者別・フォルダ別の件数はページ読み込み済み分のクライアント集計
   * (下記 allDocuments)のため、スクロール末尾のsentinel到達を待つ従来の無限スクロールでは
   * 全件読み込み完了まで件数が不正確なまま表示されてしまう。CM展開時は自動で残り全ページを
   * 読み込み切り、完了する(hasNextPage===false)までは下部のcareManager分岐で件数を出さず
   * ローディング表示に留める。他のgroupTypeは従来通りスクロール駆動のまま(Firestore読み取り
   * 抑制、Issue #891)。
   *
   * isFetchNextPageErrorで停止する(codex review P1指摘、2026-09-24): ページ取得が失敗すると
   * hasNextPageはtrueのまま・isFetchingNextPageはfalseに戻るため、このガードがないと
   * 失敗するたびに即座にfetchNextPageを呼び直す無限リトライループになる(Firestore読み取りが
   * 際限なく発生し、Issue #891で塞いだはずの過大読み取りを再発させる)。失敗後の再試行は
   * 下部のエラー表示からユーザーの明示操作に委ねる。
   */
  useEffect(() => {
    if (
      groupType === 'careManager' &&
      hasNextPage &&
      !isFetchingNextPage &&
      !isFetchNextPageError &&
      !isRefreshingGroup
    ) {
      fetchNextPage();
    }
  }, [
    groupType,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    isRefreshingGroup,
    fetchNextPage,
  ]);

  const updateBanner = (
    <DocumentListUpdateBanner
      hasUpdates={hasUpdates}
      message={message}
      isRefreshing={isRefreshingGroup}
      onRefresh={() => void handleRefresh()}
    />
  );

  // カテゴリフォルダ表示用の書類マスター（書類種別タブと同一 queryKey でキャッシュ共有）。
  // 取得失敗時は undefined のまま渡し、CustomerSubGroup 側が書類種別表示にフォールバックする
  const {
    data: documentMasters,
    isError: isMasterError,
    error: masterError,
  } = useDocumentTypes();

  // 同姓同名バッジ判定用(2026-07-26追加)。useCustomers()のキャッシュ共有により追加フェッチなし
  const identityLookup = useCustomerIdentityLookup();
  if (groupType === 'careManager' && isMasterError) {
    // 書類種別タブ (GroupList) と同じ診断ログ。サイレントに種別表示へ縮退させない
    console.warn(
      '[GroupDocumentList] 書類マスター取得失敗 → フォルダをカテゴリでなく書類種別で表示',
      masterError
    );
  }

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
  // 2026-09-15 Issue #891修正(codex review P1指摘): useGroupDocumentsが自動再取得
  // (refetchOnWindowFocus/refetchOnMount/refetchOnReconnect)を全て無効化したため、
  // 従来は再フォーカス・再マウントで自然に自己修復していたエラー状態が、明示的な
  // 再試行手段を用意しないとページリロードまで抜け出せなくなる。単純な再試行
  // ボタンを用意する(dirtyフラグに依存するupdateBannerとは別、hasUpdatesの真偽に
  // 関わらず常時表示する)。
  if (isError) {
    return (
      <div className="py-8 text-center text-sm text-red-500 space-y-2">
        <p>データの読み込みに失敗しました</p>
        <Button
          variant="outline"
          size="sm"
          disabled={isRefetching}
          onClick={() => void refetch()}
        >
          {isRefetching ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-1 h-4 w-4" />
          )}
          再試行
        </Button>
      </div>
    );
  }

  // 空状態
  // 2026-09-15 Issue #891修正: バナーは空状態の早期returnより前段(この分岐内)にも
  // 配置する。キャッシュ上は空だったグループに書類が新規追加された場合でも、
  // dirty化されていればバナー経由で更新できるようにするため(plan-crossreview
  // codex pass1指摘)。
  if (allDocuments.length === 0) {
    return (
      <>
        {updateBanner}
        <div className="py-8 text-center text-sm text-gray-500">
          このグループには書類がありません
        </div>
      </>
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
    // 全ページ読み込み完了(hasNextPage===false)まで、利用者別・フォルダ別の件数は
    // 不正確になりうるため表示せずローディングに留める(Issue #1032)
    const isFullyLoaded = !hasNextPage;
    return (
      <>
        {updateBanner}
        <div ref={scrollContainerRef} className="max-h-[500px] overflow-y-auto">
          {isFullyLoaded ? (
            <CustomerSubGroup
              documents={allDocuments}
              furiganaMap={furiganaMap}
              documentMasters={documentMasters}
              onDocumentSelect={onDocumentSelect}
              onRetry={setRetryTarget}
              identityLookup={identityLookup}
            />
          ) : (
            // isFetchNextPageError:true(追加ページ取得失敗)の場合、react-queryの型上
            // isErrorも同時にtrueになり本コンポーネント冒頭の isError 早期return(汎用エラー
            // 画面+再試行ボタン、他groupTypeと共通)が先に発火するため、ここに到達するのは
            // 正常に読み込み中の場合のみ
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-sm text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
              <span>件数を集計中...({allDocuments.length}件読み込み済み)</span>
            </div>
          )}

          <LoadMoreIndicator
            ref={loadMoreRef}
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            className="border-t border-gray-100"
          />
          {retryDialog}
        </div>
      </>
    );
  }

  // その他のグループタイプは従来のフラット表示
  return (
    <>
      {updateBanner}
      <div ref={scrollContainerRef} className="max-h-96 overflow-y-auto">
        {/* ドキュメント一覧 */}
        <div className="divide-y divide-gray-100">
          {allDocuments.map((doc) => (
            <DocumentRow
              key={doc.id}
              document={doc}
              groupType={groupType}
              onClick={() => onDocumentSelect?.(doc.id)}
              onRetry={setRetryTarget}
              identityLookup={identityLookup}
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
    </>
  );
}
