# ハンドオフメモ

**更新日**: 2026-02-11
**ブランチ**: main（クリーン）
**フェーズ**: Phase 8完了 + 追加実装

## 直近の変更（02-06〜11）

| PR/コミット | 内容 |
|----|------|
| ea4195a | **クライアント向けセットアップをワンライナー実行に変更**（Mac隔離属性問題の解決：ダウンロード不要のワンライナー実行に変更。Mac: `curl -sSL ... | bash`、Windows: `irm ... | iex`。ダウンロード・実行権限設定・隔離属性削除が不要に、1行コピペで完結） |
| f008a68 | **クライアント向けセットアップガイドのダウンロード方法を改善**（右クリック保存を明記、ターミナルコマンド追加） |
| 788e7c6 | **クライアント側スクリプトにgcloud CLI自動インストール機能を追加**（client-setup-gcp.sh: Mac/Linux対応・アーキテクチャ判定・自動インストール、client-setup-gcp.bat: Windows対応・インストールページ自動オープン、認証も自動化、docs/client/client-setup.md更新：事前準備不要に） |
| bb298cc | **ハンドオフメモ更新**（納品フロードキュメント全面更新反映） |
| 747bf71 | **納品フロー関連ドキュメントを全面更新**（claude-code-delivery.mdに納品シナリオ1/2の説明追加、事前準備セクション再構成、全5ファイル更新でドキュメント間整合性確保、GitHub Pages/CLAUDE.md/context配下すべてに最新フロー反映） |
| a3614ef | **ハンドオフメモ更新**（クライアント向けガイド改善反映） |
| 3c1413e | **クライアント向けセットアップガイドのOS別記載を明確化**（"Mac / Linux 向け:"という混乱を招く表現をOS別に分離。Mac: .command（ダブルクリック推奨）、Linux: .sh（ターミナル）、Windows: .bat（ダブルクリック）に明確化。各OS向けに補足説明追加） |
| 06bec9b | **クライアント向けドキュメントを独立サイトに分離**（docs/client/に完全独立Docsifyサイト作成。開発者向けドキュメント（ADR等）非表示。クライアント→開発者へのリンク無し、セキュリティ改善） |
| 2decaa1 | **ハンドオフメモ更新**（クライアント向けセットアップスクリプト対応） |
| 0b06e61 | **クライアント向けGCPプロジェクトセットアップスクリプト追加**（完全対話型スクリプト: `client-setup-gcp.sh`（Mac/Linux）, `client-setup-gcp.command`（Mac ダブルクリック）, `client-setup-gcp.bat`（Windows）。GitHub Pages専用ページ`client-setup.md`を追加。納品フローを修正: クライアント側でGCPプロジェクト作成 → 開発者がClaude Codeで自動納品。プロンプトからGCPプロジェクト作成ステップを削除） |
| 8c90360 | **GitHub Pages納品フォームのバリデーションを緩和**（必須フィールドをプロジェクトID・管理者メールのみに変更。OAuth認証情報・CSVは任意に。空欄の場合はプレースホルダー表示。段階的な入力が可能に） |
| 91563b4 | **GitHub Pages納品プロンプトにGCPプロジェクト作成ステップを追加**（初版）|
| **#103** | **processOCRに必要なFirestore複合インデックス追加**（PR #100で`rescueStuckProcessingDocs()`追加時に`firestore.indexes.json`への`status+updatedAt`定義が漏れていた。processOCRが毎分Fatal errorで全停止→PDFが永久pending。dev/kanameone両環境にデプロイ済み） |
| **#102** | **セレクションモードで行全体タップ可能に**（モバイルUX改善、チェックボックスだけでなく行クリック/タップで選択トグル） |
| **#101** | **納品フロー成功率改善**（jq依存除去→Node.jsヘルパー、CSV解析RFC 4180準拠、Gmail OAuth事前チェック、フォームバリデーション追加。scripts/helpers/新設、import-masters.js --dry-run対応） |
| **#100** | **OCR処理ポーリング一本化+transientエラー自動リトライ（ADR-0010）**（processOCROnCreate廃止、429等は自動リトライ(上限3回)、processingスタック10分救済、fix-stuck-documents.js `--include-errors`追加、Firestoreインデックス`status+updatedAt`作成） |
| e31a718 | **ドキュメント監査対応**（architecture.md Node.js版修正+Functions追加、gemini-rate-limiting.md料金表更新、context/配下6ファイルのフロントメタ統一、監査レポート追加） |
| **#99** | **import-masters.jsの環境変数優先順位修正**（`FIREBASE_PROJECT_ID`を`GCLOUD_PROJECT`より優先に変更。.envrcのGCLOUD_PROJECTが常に優先され納品時にマスターデータがdev環境に投入されるバグを修正） |
| **#98** | **TypeScript strict型エラー63件を全修正 + CIに型チェック追加**（26ファイル、tsconfig lib ES2023化、shared/types.ts型補完、strict null修正、テスト型修正、CI `tsc --noEmit` ガード追加） |
| **#97** | **メタ情報編集時の楽観的UI更新**（編集保存→一覧即反映、エラー時ロールバック、`updateDocumentInListCache`共通ユーティリティでDRY化） |
| **#96** | **エイリアス機能ドキュメント整備**（GitHub Pages専用ページ新設、HelpPageビジュアルフロー図追加、admin-guide/user-guide/features.md更新） |
| **#95** | **OCRマスター照合エイリアス読み込みバグ修正**（ocrProcessor.tsでaliasesフィールド未読み込み→3マスター全てに追加） |
| **#94** | **未判定時エイリアス登録ヒント表示**（DocumentDetailModal、顧客/書類/事業所の3箇所） |
| **#93** | **エイリアスUI整備**（MastersPage: 顧客/書類/事業所にエイリアスUI追加、ケアマネから除外、CSV/インポート対応、useMasterAlias拡張） |
| 7b69fbc | **ドキュメントのエイリアス例修正**（正規化で吸収される例→漢字↔ひらがな・法人格有無等に統一） |
| **#92** | **httpsCallable共通ヘルパー導入**（`callFunction.ts`新設、全8箇所にタイムアウト+自動リトライ適用、DRY違反解消） |
| **#91** | **モバイルバックグラウンド復帰時`internal`エラー対策**（リトライ条件に`internal`追加） |
| **#90** | **モバイルバックグラウンド復帰時`deadline-exceeded`対策**（uploadPdfに120sタイムアウト+リトライ追加） |
| **#89** | **一括操作完了トースト通知追加**（sonnerライブラリ導入、削除/確認/再処理の完了件数表示） |
| **#88** | **モバイルバックグラウンド復帰時の認証エラー対策+Pull-to-Refresh**（visibilitychangeトークンリフレッシュ、unauthenticatedリトライ、Pull-to-Refresh UI） |
| 15c9cd3 | **setup-tenant.shで--with-gmail時にauthModeをoauthに設定**（新規クライアントGmail取得失敗バグ修正） |
| a49219e | **API仕様に認証・権限一覧追加、納品ガイドのinitTenant記述修正** |
| **#87** | **全Callable関数の認証・権限チェック統一**（PDF系3関数に認証+WL追加、OCR/検索系にWL追加、マスター操作にadmin確認追加、initTenantに初回限定ガード追加） |
| **#86** | **一括操作の操作手順をヘルプ・管理者ガイドに追加**（HelpPage セクション6新設、admin-guide更新） |
| **#85** | **一括操作ボタンのDRY違反解消**（BulkActionButton共通コンポーネント抽出） |
| **#84** | **デスクトップの件数テキスト・×ボタンを左側に移動**（レイアウト安定化） |
| **#83** | **デスクトップで件数テキスト＋×ボタン表示**（モバイルはバッジのみ、レスポンシブ対応） |
| **#82** | **未選択時に別の操作ボタンへ直接切替可能に** |
| **#81** | **一括操作ボタンの選択/実行状態を視覚的に区別**（0件=アウトライン/トグル、1件+=ソリッド/実行） |
| **#80** | **バッジ切れ防止・×ボタン削除・横スクロール解消** |
| **#79** | **TabsListのflex-wrap削除＋shrink-0対応** |
| **#78** | **外側コンテナのflex-wrap削除** |
| **#77** | **フローティングバッジ化**（absolute positioning、レイアウト非影響） |
| **#76** | **モバイル選択件数バッジ追加** |
| **#75** | **モバイル一括操作ボタンのアイコン化** |
| **#74** | **一括操作ボタン常時表示＋セレクションモード導入**（目的先行UI：操作選択→対象チェック） |
| **#73** | **invalidateQueries queryKeyミスマッチ全箇所修正**（アップロード/編集/分割/エラー再処理の4箇所） |
| **#72** | **一括確認・再処理のqueryKey修正**（2箇所） |
| **#71** | **ネットワーク状態バナー＋一括削除の楽観的UI更新＋queryKeyバグ修正** |
| **#70** | **E2Eテスト「詳細モーダルを閉じる」CI失敗修正** + `.gitignore`に`.serena/`・`*.png`追加 |
| 09856eb | **CLAUDE.md最適化**（395行→87行、公式ベストプラクティス準拠） |
| c36d58e | **OCRバグ修正：processingスタック対応**（errorLogger undefinedフィルタ、handleProcessingError status優先更新、fix-stuck-documents.js追加）|
| 33a271a | **PWAメタタグ非推奨警告修正**（`apple-mobile-web-app-capable` → `mobile-web-app-capable`） |
| 47d63ad | **PWA記載の残漏れ対応**（CLAUDE.md開発完了サマリー+ファイル構成+GitHub Pages 3ファイル） |
| 39f098c | **アプリ内ヘルプにPWAホーム画面追加手順を追記**（iOS/Android/PC対応） |
| 71fbf89 | **PWA対応のドキュメント反映**（6ファイル更新+ユーザーガイドにホーム画面追加手順） |
| **#69** | **PWA最小構成の追加**（ホーム画面設置+スタンドアロン表示、キャッシュなしSW） |
| b7dd31f | **ドキュメント監査残課題の完了**（ファイル構成更新+ADR-0007作成、全アクションアイテム✅） |
| **#68** | E2Eテスト共通ヘルパー抽出（`loginWithTestUser`等、-150行の重複除去） |
| b6709ff | **CI E2Eテスト全パス達成**（39/39）- 6コミットで段階修正 |
| **#67** | Playwright E2Eテスト拡充+CI統合（8ファイル、+540行） |
| 7723d1a | ドキュメント監査残課題の一括対応（data-model.md等） |
| 1b67b2f | 納品ページ改善+ADR-0009 - Feature Flags方針ADR |
| #66 | OAuth OOB→loopback方式移行+納品ページ改善 |
| #65 | setup-tenant.sh/setup-gmail-auth.shに非対話モード追加 |
| #63 | フィルターパネル全タブ共通化＋期間指定フィルター追加 |

### CI E2E修正の詳細（02-07）

6コミット（`2abad2c`〜`b6709ff`）で以下を修正:

| 問題 | 修正 |
|------|------|
| Playwright実行ディレクトリ誤り | `cd frontend &&` 追加 |
| `page.evaluate()`内のベアモジュール解決不可 | `firebase.ts`に`signInWithEmailAndPassword`再エクスポート |
| strict modeロケータ違反 | `.first()` 追加 |
| functionsエミュレータ未起動でトリガー不発火 | `--only auth,firestore,functions` |
| `devices['iPhone 14']`がWebKit依存 | viewport直指定に変更 |
| モバイルで`hidden sm:inline`テキスト非表示 | `h1`ヘッダーで判定 |
| 存在しない「確認待ち」タブ参照 | 事業所別タブテストに書き換え |
| ESC→OCR確認ダイアログでモーダル閉じない | 確認ダイアログ対応追加 |

**プロダクションコード変更**: `firebase.ts`に1行追加のみ（再エクスポート）。アプリ動作への影響なし。

### Claude Code納品フロー（完成版 02-11）

**推奨フロー**: クライアントがGCPプロジェクト作成 → 開発者がClaude Codeで自動納品

#### クライアント側（約5分）
- `client-setup-gcp` スクリプト実行（Mac/Windows/Linux対応）
  - `scripts/client-setup-gcp.sh` (Mac/Linux)
  - `scripts/client-setup-gcp.command` (Mac ダブルクリック)
  - `scripts/client-setup-gcp.bat` (Windows)
- 対話型で入力: プロジェクトID、管理者メール、課金アカウント
- スクリプトが自動実行: GCPプロジェクト作成 → 課金設定 → 開発者に権限付与
- GitHub Pages: `https://yasushi-honda.github.io/doc-split/#/client-setup`

#### 開発者側（Claude Code完全自動化）
- `gcloud auth login` で認証
- GitHub Pages: `https://yasushi-honda.github.io/doc-split/#/claude-code-delivery`
  - プロジェクトID（クライアントから受領）を入力
  - プロンプト自動生成 → コピー
- Claude Codeに貼り付け → `setup-tenant.sh` が自動実行
  - GCPプロジェクト作成ステップは削除済み（クライアント側で実行済み前提）

#### フォーム改善
- バリデーション緩和: 必須フィールド = プロジェクトID・管理者メール
- OAuth認証情報・CSV: 任意（空欄の場合はプレースホルダー表示）
- 段階的な入力が可能に

### ドキュメント監査（02-08）

- 3回目の監査実施。全カテゴリA評価達成（前回B→A）
- architecture.md: Node.js 22→20修正、Cloud Functions 6関数追加
- gemini-rate-limiting.md: 料金表を2026年2月時点に更新（入力$0.30、出力$2.50）
- docs/context/配下6ファイル: フロントメタ統一（status: completed）
- 次回監査推奨日: 2026-02-22

## E2Eテスト状況

| 項目 | 値 |
|------|-----|
| 総テスト数（@emulator） | **45件**（8ファイル、共通ヘルパー含む） |
| CI結果 | **全パス** |
| テスト時間（CI） | 約1.3分 |

## デプロイ状況

| 環境 | 状態 |
|------|------|
| dev | デプロイ済み（02-09、Hosting: PR #102反映、Firestoreインデックス: PR #103反映） |
| kanameone | デプロイ済み（02-09、Hosting: PR #102反映、Firestoreインデックス: PR #103反映） |
| GitHub Pages | デプロイ済み（02-11、クライアント向けセットアップページ追加 + 開発者向けプロンプト修正） |
| client-setup スクリプト | 新規作成完了（02-11）：Mac/Windows/Linux対応、対話型 |
| setup-tenant.sh | PR #101でjq依存除去+Gmail OAuth事前チェック追加 |
| deploy-to-project.sh | PR #101でjq依存除去 |
| import-masters.js | PR #101でCSV解析RFC 4180準拠+--dry-run追加 |

## 未解決の既知バグ

なし（02-09時点）

## 見送り事項（納品後に検討）

| 項目 | 理由 |
|------|------|
| 手動PDFアップロードのOCR即時実行（ポーリング待ち最大60秒の短縮） | 納品直前のリスク回避。手動アップロードは利用頻度低い。実装する場合はuploadPdf成功後にFEからfire-and-forgetで新callable呼び出し |

## 次のアクション候補（優先度順）

1. **納品フローの実運用テスト**（実クライアントで検証）
   - ✅ Phase 1完了（02-11）: コード・ドキュメント検証（シンタックス、ロジック、整合性チェック）
   - ⏳ Phase 2: 実環境テスト（Mac/Windows/Linux各OSでのスクリプト実行、GitHub Pagesフォーム動作確認、Claude Code実行テスト）
   - フィードバック反映後のドキュメント改善
2. **クライアント別オプション機能の実装**（最初の具体的要望確定時）→ ADR-0009参照
3. 精度改善（フィードバック後）
4. 手動PDFアップロードのOCR即時実行（クライアントから要望があれば）
