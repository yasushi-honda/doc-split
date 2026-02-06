# ハンドオフメモ

**更新日**: 2026-02-07
**ブランチ**: main（クリーン）
**フェーズ**: Phase 8完了 + 追加実装

## 直近の変更（02-06〜07）

| PR/コミット | 内容 |
|----|------|
| 7ea4e65 | **Claude Code自動納品プロンプトジェネレーターページ追加**（GitHub Pages） |
| 59a027f | **deploy-all-clients.shに非対話モード(--yes)追加**＋Node.js v24互換修正 |
| #65 | **setup-tenant.sh/setup-gmail-auth.shに非対話モード追加**（`--yes`, `--client-id/secret/auth-code`） |
| #64 | **納品フロードキュメントのコマンド記載を実スクリプト引数に修正**（5ファイル） |
| e554641 | ヘルプページに期間指定フィルター・あかさたなフィルターの説明追加 |
| d7b8bd9 | ドキュメント監査に基づく整合性・品質改善（CLAUDE.md/data-model.md等） |
| #63 | フィルターパネル全タブ共通化＋期間指定フィルター追加 |
| #62 | あかさたなフィルターの顧客マスター未ロード時の空結果バグ修正＋E2Eテスト追加 |
| #61 | 顧客別あいうえお順ソート＋あかさたなフィルター対応 |
| #57-60 | 一覧系画面の初期表示100件化＋無限スクロール対応＋テスト |

### 技術的なポイント（納品フロー自動化 #64, #65, 59a027f, 7ea4e65）

- **7ea4e65 GitHub Pages自動納品ページ**: `docs/claude-code-delivery.md` + `docs/index.html` にJS追加
  - フォーム入力→プロンプト自動生成→コピーボタンでClaude Codeに貼付け
  - 最小版/フル版の2パターン、OAuth認証URL自動生成機能付き
  - Docsifyの制約でJSは `index.html` にグローバル配置（markdown内`<script>`は実行タイミング問題）
  - DRY: `_buildMinimal(fmt)` / `_buildFull(fmt)` でフォーマッター関数切替（raw/html）
- **59a027f deploy-all-clients.sh**: `--yes`/`-y`非対話モード追加 + Node.js v24で`require('.json')`不可の互換修正
- **#65**: setup-tenant.sh/setup-gmail-auth.sh非対話モード
- **#64**: ドキュメント5ファイルのコマンド記載を実スクリプト引数仕様に修正
- **Claude Code納品フロー**: 人間はOAuth認証コード取得のみ、他は全自動

### 技術的なポイント（#63 フィルターパネル＋期間指定）

- **バグ修正**: フィルターパネルを `<TabsContent value="list">` 外に移動し全タブで展開可能に
- **DateRangeFilter.tsx (NEW)**: 期間指定フィルターコンポーネント
  - プリセット: 今月/今年/過去3ヶ月/カスタム
  - 日付種別切替: 書類日付(fileDate) / 登録日(processedAt)
  - 同じプリセット再クリックでクリア、クリアボタンあり
- **書類一覧タブ**: Firestoreクエリでサーバーサイドフィルター（`useDocuments.ts` の `dateField` 動的切替対応）
- **グループビュー**: クライアントサイドで日付フィルター（`GroupDocumentList.tsx` の `filterByDate` 関数）
- **DateRange型を共通型として統一**: GroupList/GroupDocumentList は DateRangeFilter.tsx から import
- **テスト**: DateRangeFilter 10件追加（全71テスト通過）
- **レビュー修正**: 型安全性（明示的フィールドアクセス）、try-catch、useMemo依存配列の.getTime()安定化

### 変更ファイル（#63）

- `frontend/src/components/DateRangeFilter.tsx` (NEW) - 期間指定フィルターコンポーネント
- `frontend/src/components/__tests__/DateRangeFilter.test.tsx` (NEW) - 10テスト
- `frontend/src/pages/DocumentsPage.tsx` - フィルターパネル共通化＋DateRangeFilter統合
- `frontend/src/hooks/useDocuments.ts` - dateField動的切替対応
- `frontend/src/components/views/GroupList.tsx` - dateFilter props追加
- `frontend/src/components/views/GroupDocumentList.tsx` - クライアントサイド日付フィルタリング

### Firestore インデックス注意（#63 関連）

`processedAt`での日付範囲フィルター使用時、status等との複合クエリでインデックスが必要になる可能性あり。エラーが出た場合はFirestoreコンソールのリンクからインデックスを作成すること。

## デプロイ状況

| 環境 | 状態 |
|------|------|
| dev | デプロイ済み（02-06、e554641反映）※#64,#65,59a027f,7ea4e65はスクリプト/ドキュメントのみ、再デプロイ不要 |
| kanameone | デプロイ済み（02-06、e554641反映） |

## 未解決の既知バグ

なし（#63でフィルターパネルのバグは修正済み）

## 次のアクション候補（優先度順）

1. 精度改善（フィードバック後）
2. Playwright E2Eテスト拡充（認証フロー含むEmulator環境テスト基盤は構築済み）
3. ドキュメント監査残課題（優先度中以下）: phase7-requirements.mdのreference/移動、setup-guide.md重複解消 → docs/audit/2026-02-06-document-audit.md 参照
