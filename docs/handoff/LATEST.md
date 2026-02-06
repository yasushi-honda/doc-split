# ハンドオフメモ

**更新日**: 2026-02-07
**ブランチ**: main（クリーン）
**フェーズ**: Phase 8完了 + 追加実装

## 直近の変更（02-06〜07）

| PR/コミット | 内容 |
|----|------|
| **#67** | **Playwright E2Eテスト拡充+CI統合**（8ファイル、+540行） |
| 7723d1a | ドキュメント監査残課題の一括対応 |
| 1b67b2f | **納品ページ改善+ADR-0009** - Feature Flags方針ADR |
| 907b2be | 納品ページの前提条件・事前準備手順を補完 |
| bd66bfe | 納品ページの前提条件にOS要件追加 |
| #66 | OAuth OOB→loopback方式移行+納品ページ改善 |
| #65 | setup-tenant.sh/setup-gmail-auth.shに非対話モード追加 |
| #63 | フィルターパネル全タブ共通化＋期間指定フィルター追加 |
| #61-62 | あかさたなフィルター＋バグ修正 |
| #57-60 | 一覧系画面の初期表示100件化＋無限スクロール対応 |

### 技術的なポイント（本セッション: PR #67）

- **E2Eテスト拡充**: 48テスト / 8ファイルに拡大
  - 新規: `auth-and-documents.spec.ts`（11テスト）, `search.spec.ts`（4テスト）, `document-detail.spec.ts`（5テスト）, `pdf-upload.spec.ts`（4テスト）
  - 修正: `mobile-pdf-view.spec.ts`（`test.use()`をファイルレベルに移動）, `office-resolution.spec.ts`（冗長な`test.skip`削除）
  - シードデータ拡張: `seedMainFlowTestDocuments()`追加（5ドキュメント）
- **CI統合**: `.github/workflows/ci.yml` にPlaywright E2Eステップ追加
  - `firebase emulators:exec --only auth,firestore` + Vite devサーバーで実行
  - Playwright report をartifactとしてアップロード（7日保持）
- **重要な技術判断**: CIでは`vite preview`（ビルド済み配信）ではなく`vite`（devサーバー）を使用
  - 理由: `loginWithTestUser`が`page.evaluate()`内で`import('/src/lib/firebase.ts')`を使用しており、ソースファイルへの直接アクセスが必要

### Claude Code納品フロー（完成状態）

- GitHub Pages: `https://yasushi-honda.github.io/doc-split/#/claude-code-delivery`
- フォーム入力→プロンプト自動生成→コピー→Claude Codeに貼付けで全自動納品
- 検証済み: スクリプト引数・前提条件・禁止事項すべて正確に記載

## デプロイ状況

| 環境 | 状態 |
|------|------|
| dev | デプロイ済み（02-06、e554641反映）※以降はドキュメント/テスト/スクリプト変更のみ |
| kanameone | デプロイ済み（02-06、e554641反映） |

## 未解決の既知バグ

なし

## 次のアクション候補（優先度順）

1. **CI E2E実行の検証** - PR #67のCI結果を確認し、必要に応じて修正
2. **E2Eテストのリファクタリング** - `loginWithTestUser`を共通ヘルパーに抽出（6ファイルで重複）
3. **クライアント別オプション機能の実装**（最初の具体的要望確定時）→ ADR-0009参照
4. 精度改善（フィードバック後）
5. ドキュメント監査残課題（優先度中以下）→ docs/audit/2026-02-06-document-audit.md 参照
