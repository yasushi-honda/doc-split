# ハンドオフメモ

**更新日**: 2026-02-15（verify-setup.sh Storageバケット名バグ修正）
**ブランチ**: main
**フェーズ**: Phase 8完了 + マルチクライアント安全運用機構 + 再処理バグ修正 + UI/UX改善（PR #129-135）

## 直近の変更（02-21）

| PR | コミット | 内容 |
|----|------|------|
| - | **a0ef38d** | **fix: deploy-functions.yml の push トリガーを削除し workflow_dispatch のみに変更** push 時に inputs.environment が空になり dev にフォールバック → cocoro SA が actAs 権限なしで失敗していた問題を修正（Issue #143 対応） |
| - | **9cbd17c** | **fix: PDF分割エラーハンドリング追加・StorageBucket明示初期化** PdfSplitModal に try-catch 追加・成功/失敗 toast 通知。functions/index.ts の initializeApp() に storageBucket 明示指定（Issues #141 #137 対応） |

## 直近の変更（02-15）

| 項目 | 内容 |
|------|------|
| **verify-setup.shバグ修正** | Storage CORS確認でバケット名が`.firebasestorage.app`固定だった問題を修正。`.appspot.com`へのフォールバック追加。cocoro環境のCORS判定が正常化（8/14→14/16相当） |
| **ドキュメント監査** | docs/audit/2026-02-15-document-audit.md 作成。総合評価 A- (90%)。軽微改善を CLAUDE.md に反映 |
| **CLAUDE.md改善** | switch-client.sh 追記、環境情報に「開発環境参照値」と注釈追加、マルチクライアント運用対応 |

## 直近の変更（02-14後半）

| PR | コミット | 内容 |
|----|------|------|
| **#135** | **73de6a9** | **fix: ヘッダーナビのテキスト改行防止・タブレット最適化** タブレット(iPad Air 820px)でナビテキストが2行折り返しされていた問題を修正。whitespace-nowrap追加、md(768-1024px)でtext-xs/px-1.5に省スペース化、lg(1024px+)でtext-sm/px-2.5に拡大、DocSplitロゴをlg以上でのみ表示 |
| **#134** | **f688a82** | **fix: ヘッダーナビのレスポンシブ対応をタブレット向けに改善** ナビ項目テキスト表示breakpointをsm→md、ログアウトテキストをsm→md、メールアドレス表示をsm→lgに修正。タブレット(768px)で正確に適用されるように調整 |
| **#133** | **037436a** | **fix: タブレット/スマホ横向きで右サイドバーがスクロールできない問題を修正** DocumentDetailModalの右サイドバー(OCR結果等)がタブレット横向き(1024x600)でスクロール不可だった問題を解決。md:overflow-y-autoを追加、collapsed状態でも対応。E2Eテスト3件追加（tablet-landscape-sidebar.spec.ts）

## 実運用テスト結果（8 Phase 全完了・02-13）

| Phase | 内容 | 結果 |
|-------|------|------|
| 1 | ベースライン記録 | ✅ 完了 |
| 2 | switch-client.sh全3環境切替 | ✅ 通過（dev↔kanameone↔cocoro） |
| 3 | deploy-to-project.sh認証チェック | ✅ 通過（正常系3件、異常系ブロック） |
| 4 | verify-setup.sh環境検証 | ✅ 通過（dev 9/10, kanameone 16/16, cocoro 14/16 ※旧値8/14はStorageバケット名バグ起因） |
| 5 | PITR確認 | ✅ 通過（dev:DISABLED, kanameone/cocoro:ENABLED） |
| 6 | GitHub Pages納品フォーム | ✅ 通過（表示・生成OK）|
| 7 | client-setup-gcp.sh構造確認 | ✅ 通過（Step 0-4確認）|
| 8 | 環境復元・ベースライン確認 | ✅ 通過（一致） |

## 安全運用機構の判定

**✅ 本番運用可能** - 複数クライアント環境での誤操作防止が正常動作

### 実装完了内容

1. **クライアント定義ファイル** (`scripts/clients/*.env`)
   - dev/kanameone: 個人アカウント（gmail.com）
   - cocoro: ハイブリッド（SA owner + 開発者 editor）

2. **環境切替スクリプト** (`switch-client.sh`)
   - gcloud構成・アカウント自動切替
   - `.envrc.client` 生成 + direnv allow実行

3. **デプロイ前認証チェック** (`deploy-to-project.sh`)
   - gcloud構成・アカウント一致を自動検証
   - 不一致時は即座に中止 + 修正案提示

4. **PITR自動有効化** (`setup-tenant.sh` Step 9)
   - Firestore 7日間ポイントインタイムリカバリ自動有効化
   - 本番環境(kanameone/cocoro): ENABLED
   - 開発環境(dev): DISABLED

### cocoro 納品状態（2026-02-13 確認完了）

| 項目 | 状態 | 詳細 |
|------|------|------|
| Google Sign-in | ✅ **動作確認済み** | Web Application OAuth Client作成、ログイン成功確認 |
| 運用体制 | ✅ **ハイブリッド確立** | SA (owner) + 開発者 hy.unimail.11@gmail.com (editor) |
| Firestore settings | ✅ **設定済み** | app/auth/gmail全て投入済み（02-11） |
| マスターデータ | ✅ **投入済み** | 顧客5, 書類種別5, 事業所5, ケアマネ2 |
| Cloud Functions | ✅ **ACTIVE** | 19関数全て稼働 |
| Storage CORS | ✅ **設定済み** | https://docsplit-cocoro.web.app でアクセス可能 |
| Gmail API | ✅ **ENABLED** | Secret Manager に client-id/secret 保存済み（v2: Web Client統一） |
| PITR | ✅ **ENABLED** | 7日間ポイントインタイムリカバリ有効 |
| 管理者ユーザー | ✅ **登録済み** | a.itagaki@cocoro-mgnt.com (admin) |
| **Gmail OAuth認証** | ⏳ **先方操作待ち** | OAuthポップアップ認証 → ラベル設定 → 運用開始 |

**開発者側作業: 100%完了。先方はブラウザUI操作のみ（3ステップ）**

**技術メモ**: 標準OAuth 2.0 Web Application ClientはGCPコンソールUIからのみ作成可能（パブリックAPI非対応）。IAP/WIF APIでは代替不可。

## E2Eテスト

| 項目 | 値 |
|------|-----|
| 総テスト数 | **104件**（10ファイル）※PR #133-135で3件追加（tablet-landscape-sidebar.spec.ts）→ PR #136での検証でさらに3件追加 |
| CI結果 | **全パス** - chromiumプロジェクトのみ実行（Lint/Build/Rules/Unit/E2E全て成功） |
| 最新修正 | PR #136 で verify-setup.sh Storageバケット名フォールバック追加・cocoro検証完了 |

## デプロイ環境（全3環境完全同期）

| 環境 | Hosting | Rules | Functions | 状態 |
|------|---------|-------|-----------|------|
| dev | ✅ | ✅ | ✅ (20) | **完全最新** |
| kanameone | ✅ | ✅ | ✅ (20) | **完全最新** |
| cocoro | ✅ | ✅ | ✅ (19)* | **完全最新** |
| GitHub Pages | ✅ | - | - | PR #110-111反映済み |

*cocoro は Functions 19個。exchangeGmailAuthCode新規追加による。

## 次のアクション

1. **cocoro Gmail OAuth認証（先方操作待ち）**
   - 設定画面 → Gmail連携ボタン → OAuthポップアップ認証 → ラベル設定 → 運用開始
   - docs/clients/cocoro.md の「運用開始に必要な先方操作」を参照

2. **実クライアント納品テスト**（Phase 2）
   - Mac/Windows/Linux各OSでのclient-setup-gcp実行
   - Claude Code納品プロンプト検証

3. **SAキーファイル管理**
   - cocoro SAキーの安全管理確認

4. **クライアント別オプション機能**（要望確定後）

## 参考リンク

- [クライアント管理ドキュメント](docs/clients/)
  - [dev](docs/clients/dev.md) - 開発環境（verify 9/10）
  - [kanameone](docs/clients/kanameone.md) - カナメワン（verify 16/16、運用中）
  - [cocoro](docs/clients/cocoro.md) - ココロ（ハイブリッド運用、ログイン確認済み・Gmail認証待ち）

## Git状態

- ブランチ: main（PR #129-135 マージ済み + 直接コミット `9cbd17c`）
- 未コミット変更: `.serena/project.yml`（Serena設定、無害）
- 未プッシュ: なし（プッシュ済み）
- CI: 最新CI成功（main, 2026-02-14）※ `9cbd17c` は直接mainへコミット
- 最新コミット: `a0ef38d` (fix: deploy-functions.yml pushトリガー削除・workflow_dispatchのみに変更)
