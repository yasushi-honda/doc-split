/**
 * 検索バーコンポーネント
 *
 * 機能:
 * - 検索入力
 * - debounce対応
 * - 検索結果ドロップダウン表示
 * - 結果クリックで詳細モーダル表示
 */

import { useState, useRef, useEffect } from 'react';
import { Search, X, Loader2, FileText } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useDebouncedSearch, type SearchResultDocument } from '@/hooks/useSearch';

interface SearchBarProps {
  onResultClick?: (documentId: string) => void;
}

export function SearchBar({ onResultClick }: SearchBarProps) {
  const {
    query,
    setQuery,
    results,
    total,
    hasMore,
    isLoading,
    isError,
    loadMore,
    reset,
  } = useDebouncedSearch(300);

  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // クリック外で閉じる
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 検索入力変更
  const handleInputChange = (value: string) => {
    setQuery(value);
    setIsOpen(value.length >= 2);
  };

  // 結果クリック
  const handleResultClick = (doc: SearchResultDocument) => {
    onResultClick?.(doc.id);
    setIsOpen(false);
  };

  // クリアボタン
  const handleClear = () => {
    reset();
    setIsOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div className="relative w-full">
      {/* 検索入力 */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          type="text"
          placeholder="顧客名、事業所名、書類種別で検索..."
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => query.length >= 2 && setIsOpen(true)}
          className="pl-9 pr-9"
        />
        {query && (
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 p-0"
            onClick={handleClear}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* 検索結果ドロップダウン */}
      {isOpen && (
        <Card
          ref={dropdownRef}
          className="absolute z-50 mt-1 w-full max-h-96 overflow-y-auto shadow-lg"
        >
          <CardContent className="p-2">
            {/* ローディング */}
            {isLoading && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">検索中...</span>
              </div>
            )}

            {/* エラー */}
            {isError && (
              <div className="py-4 text-center text-sm text-destructive">
                検索中にエラーが発生しました
              </div>
            )}

            {/* 結果なし */}
            {!isLoading && !isError && results.length === 0 && query.length >= 2 && (
              <div className="py-4 text-center text-sm text-muted-foreground">
                該当する書類が見つかりません
              </div>
            )}

            {/* 結果リスト */}
            {!isLoading && results.length > 0 && (
              <>
                <div className="mb-2 px-2 text-xs text-muted-foreground">
                  {total}件の結果
                </div>
                <div className="space-y-1">
                  {results.map((doc) => (
                    <SearchResultItem
                      key={doc.id}
                      document={doc}
                      onClick={() => handleResultClick(doc)}
                    />
                  ))}
                </div>
                {hasMore && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 w-full"
                    onClick={loadMore}
                  >
                    もっと見る
                  </Button>
                )}
              </>
            )}

            {/* 入力促進 */}
            {query.length < 2 && (
              <div className="py-4 text-center text-sm text-muted-foreground">
                2文字以上入力してください
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** 検索結果アイテム */
function SearchResultItem({
  document,
  onClick,
}: {
  document: SearchResultDocument;
  onClick: () => void;
}) {
  return (
    <button
      className="w-full rounded-md p-2 text-left hover:bg-muted transition-colors"
      onClick={onClick}
    >
      <div className="flex items-start gap-2">
        <FileText className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">
              {document.customerName || '不明顧客'}
            </span>
            <Badge variant="outline" className="text-xs shrink-0">
              {document.documentType || '不明'}
            </Badge>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate">{document.officeName || '不明事業所'}</span>
            {document.fileDate && (
              <>
                <span>•</span>
                <span>{document.fileDate}</span>
              </>
            )}
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {document.fileName}
          </div>
        </div>
      </div>
    </button>
  );
}
