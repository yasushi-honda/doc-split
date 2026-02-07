# ADR-0007: 無限スクロール戦略

## Status
Accepted

## Date
2026-01-27

## Context
Phase 8のグループ化ビュー実装に伴い、1万件規模のドキュメントリストを効率的に表示する方法が必要になった。従来はFirestoreから全件取得してフロントエンドで表示していたが、データ量の増加によりパフォーマンスが問題になった。

## Decision
**Firestoreカーソルベースのページネーション + IntersectionObserverによる無限スクロール**を採用。

- Firestoreの`startAfter`カーソルで100件ずつ取得
- TanStack Queryの`useInfiniteQuery`でページ管理
- `IntersectionObserver`でリスト末尾到達を検知し自動読み込み
- `hasMore`フラグは`pageSize + 1`件取得して判定

## Consequences

### Pros
- 初期表示が高速（最初の100件のみ取得）
- Firestoreの読み取り回数を最小化（コスト最適化）
- スクロール体験がシームレス（手動ページ送り不要）
- カーソルベースのためFirestoreインデックスと親和性が高い

### Cons
- 「全N件中M件表示」のような総件数表示ができない（Firestoreにcount機能はあるが追加コスト）
- ページ内ジャンプ（例: 500件目に直接移動）は非対応
- ブラウザメモリに読み込み済みデータが蓄積される

## Alternatives Considered

### クライアントサイド全件取得 + 仮想スクロール
Firestoreから全件取得し、`react-window`等で仮想スクロール表示。全件取得のコストとレイテンシが問題。1万件のFirestore読み取りは月間無料枠（50,000回/日）を圧迫する。

### オフセットベースのページネーション
Firestoreはオフセットベースのクエリを非推奨としており、内部的にスキップされたドキュメントも課金対象になるため不採用。

## References
- 実装: `frontend/src/hooks/useDocuments.ts`（`useDocumentsInfinite`）
- 実装: `frontend/src/hooks/useInfiniteScroll.ts`
- 実装: `frontend/src/components/LoadMoreIndicator.tsx`
