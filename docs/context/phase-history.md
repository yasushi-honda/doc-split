# Phase完了履歴（詳細）

> このファイルはCLAUDE.mdから分離された詳細な完了履歴です。
> 各Phaseの実装詳細を確認する際に参照してください。
>
> **注記**: UI表記「確認待ち」は後に「**選択待ち**」に変更され、専用タブは削除されました。

## Phase 0 完了項目（2026-01-18）
- [x] GCPプロジェクト作成・請求アカウント設定
- [x] 必要API有効化（Functions, Firestore, Storage, Pub/Sub, Vertex AI等）
- [x] Firebase連携・Firestoreデータベース作成
- [x] Firebase Authentication（Googleプロバイダー）有効化
- [x] Cloud Storageバケット作成
- [x] エミュレータ動作確認
- [x] GitHubリポジトリ作成・初期プッシュ

## Phase 1 完了項目（2026-01-18）
- [x] Firestoreインデックス定義（複合インデックス8件）
- [x] Firestoreセキュリティルール実装・テスト（22テストパス）
- [x] Storageセキュリティルール更新（ファイルサイズ・MIME制限追加）
- [x] マスターデータインポートスクリプト（顧客・書類・事業所・ケアマネ対応）
- [x] プロジェクト初期設定スクリプト

## Phase 2 完了項目（2026-01-18）
- [x] Gmail連携 Cloud Function (`checkGmailAttachments`)
  - OAuth 2.0 / Service Account認証切替対応
  - Exponential Backoffリトライ機能
  - エラーログ記録（Firestore /errors）
  - マルチパートメール対応
- [x] OCR処理 Cloud Function (`processOCR`)
  - Gemini 2.5 Flash連携
  - レート制限（トークンバケットアルゴリズム）
  - コスト追跡（/stats/gemini/daily）
  - 類似度マッチング（レーベンシュタイン距離、閾値70%）
  - ページ単位PDF分割処理
  - 令和/平成日付パターン対応
- [x] 共通ユーティリティ（functions/src/utils/）
  - retry.ts: リトライ機能
  - errorLogger.ts: エラー分類・記録
  - gmailAuth.ts: Gmail認証切替（OAuth認証情報はSecret Manager一元管理）
  - rateLimiter.ts: Geminiレート制限
  - similarity.ts: 類似度マッチング

## Phase 3 完了項目（2026-01-18）
- [x] shadcn/ui セットアップ（Button, Card, Input, Badge, Dialog, Select, Table, Tabs等）
- [x] Firestore連携フック（useDocuments, useDocument, useDocumentStats等）
- [x] DocumentsPage改善（統計カード、検索・フィルター、書類一覧テーブル）
- [x] DocumentDetailModal（PDFビューアー統合、メタ情報サイドバー）
- [x] 設定画面（SettingsPage）- Gmail監視設定、ユーザー管理、通知設定
- [x] エラー履歴画面（ErrorsPage）- エラー一覧、再処理機能、ステータス管理
- [x] Firebase Hostingプレビューデプロイ

## Phase 4 完了項目（2026-01-18）
- [x] PDF分割バックエンド（Cloud Functions: detectSplitPoints, splitPdf, rotatePdfPages）
- [x] PDF分割フロントエンド（PdfSplitModal: 分割候補表示、手動追加、セグメント編集）
- [x] DocumentDetailModalに分割ボタン追加
- [x] マスターデータ編集画面（MastersPage: 顧客・書類種別・事業所・ケアマネCRUD）

## Phase 5 完了項目（2026-01-18）
- [x] Firestoreルールテスト（35テストパス）
- [x] Cloud Functions単体テスト（27テストパス - similarity utilities）
- [x] 本番デプロイ
  - Firebase Hosting: `https://doc-split-dev.web.app`
  - Cloud Functions: 5関数デプロイ完了
  - Firestoreルール: デプロイ完了
- [x] 運用手順書作成
  - docs/operation/user-guide.md: ユーザーガイド
  - docs/operation/admin-guide.md: 管理者ガイド
  - docs/operation/setup-guide.md: セットアップ手順書

## Phase 6 完了項目（2026-01-18）- ビジネスロジック移行
- [x] Phase 6A: 基盤強化
  - textNormalizer.ts: テキスト正規化（全角半角変換、和暦変換）
  - 日付候補抽出・最適日付選択ロジック
  - 27テストパス
- [x] Phase 6B: 情報抽出精度向上
  - extractors.ts: 強化版抽出ユーティリティ
  - 書類タイプ抽出（キーワードマッチング対応）
  - 顧客候補抽出（複数候補、最大10件）
  - 事業所抽出（短縮名対応）
  - 日付抽出（dateMarker対応）
  - 26テストパス
- [x] Phase 6C: ファイル名生成ロジック
  - fileNaming.ts: GAS命名規則準拠
  - 顧客属性分析（事業所・ケアマネ一致判定）
  - 最適ファイル名生成（分割推奨判定付き）
  - ファイル名パース機能
  - 34テストパス
- [x] Phase 6D: PDF分割強化
  - pdfAnalyzer.ts: ページ単位分析・セグメント生成
  - ページ間変化検出（顧客・書類・事業所）
  - 分割候補生成（信頼度スコア付き）
  - detectSplitPoints強化（pdfAnalyzer統合）
  - 17テストパス
- [x] 統合作業
  - processOCR.ts: 新extractors使用に更新
  - pdfOperations.ts: pdfAnalyzer統合（後方互換性維持）
- [x] テスト総数: 132テストパス

## CI/CD パイプライン追加（2026-01-19）
- [x] GitHub Actions CI（`.github/workflows/ci.yml`）
  - PR時: lint → build → test（Firestoreルールテスト含む）
  - Node.js 20、Java 21（エミュレータ用）
- [x] GitHub Actions CD（`.github/workflows/deploy.yml`）
  - mainマージ時: 自動デプロイ（Firebase Hosting + Functions）
- [x] ESLint v9 flat config移行（frontend/functions）
- [x] GitHub Secrets設定（Firebase環境変数 + FIREBASE_TOKEN）

## 本番環境動作確認・改善（2026-01-19）
- [x] 認証初期化バグ修正（AuthInitializerコンポーネント追加）
- [x] UI改善
  - アプリアイコン画像適用（ログイン画面、ヘッダー）
  - ファビコン設定
  - ヘッダーレイアウト調整（レスポンシブ対応）
  - モバイル表示最適化
- [x] Firestoreインデックス追加（status + processedAt ASC）
- [x] 管理者ユーザー登録（hy.unimail.11@gmail.com）
- [x] マスターデータ投入（顧客10件、書類種別15件、事業所10件、ケアマネ3件）

## テナント初期設定自動化（2026-01-19）
- [x] `scripts/setup-tenant.sh` - 包括的初期設定スクリプト
  - GCP API有効化（9個）
  - Firebase設定・環境変数生成
  - 管理者ユーザー登録
  - ルール・インデックス・Functions・Hostingデプロイ
- [x] `scripts/setup-gmail-auth.sh` - Gmail OAuth認証設定
  - OAuth認証フロー
  - Secret Manager保存
  - Cloud Functions権限付与

## GitHub Pagesドキュメント（2026-01-19）
- [x] Docsifyベースのドキュメントサイト作成
- [x] URL: `https://yasushi-honda.github.io/doc-split/`
- [x] ページ構成:
  - プロジェクト概要、アーキテクチャ図
  - 納品フロー（Mermaid図付き）
  - セットアップ手順、運用ガイド
  - データモデル、API/Functions、セキュリティ

## Phase 7 完了項目（2026-01-20）
- [x] 処理履歴ビュー（`/history`）
  - 日付グルーピング表示
  - 期間/ステータス/顧客確定フィルター
  - バッファリングページネーション（FETCH_SIZE=50, PAGE_SIZE=20）
- [x] 同姓同名解決モーダル（`SameNameResolveModal.tsx`）
  - 顧客候補選択UI
  - 「該当なし」オプション
  - 監査ログ記録（`customerResolutionLogs`コレクション）
- [x] バックエンド更新
  - `processOCR`: customerConfirmed/customerCandidates新スキーマ
  - `getOcrText`: 大容量OCR結果取得Callable Function
  - Firestoreルール: 顧客解決フィールド更新許可
- [x] テスト: 24テスト（Firestoreルール）+ 108テスト（ユニット）= 132テストパス

## Phase 8 完了項目（2026-01-22）- グループ化ビュー（1万件対応）
- [x] データモデル拡張
  - `documentGroups`コレクション: グループ別集計キャッシュ
  - `Document`型: グループキーフィールド追加（customerKey, officeKey等）
  - Firestoreインデックス追加（グループ化クエリ用）
- [x] Cloud Functions
  - `onDocumentWrite`: ドキュメント変更時の自動グループ集計更新
  - `groupAggregation.ts`: 集計ユーティリティ
- [x] マイグレーションスクリプト
  - `scripts/migrate-document-groups.js`: 既存データへのグループキー付与・初期集計
- [x] フロントエンド
  - `useDocumentGroups.ts`: グループ一覧/グループ内ドキュメント取得フック（無限スクロール対応）
  - `GroupList.tsx`: アコーディオン形式グループ表示
  - `GroupDocumentList.tsx`: グループ内ドキュメント一覧
- [x] UI拡張
  - `DocumentsPage.tsx`: 6タブ切替（書類一覧、顧客別、事業所別、書類種別、担当CM別、確認待ち）
- [x] Firestoreセキュリティルール更新
- [x] 全154テストパス（Firestoreルール35件 + フロントエンド11件 + Functions108件）
- [x] **UX改善: 確認待ち通知バナー・専用タブ**
  - `PendingConfirmationBanner.tsx`: 確認待ち件数通知バナー
  - `PendingConfirmationList.tsx`: 確認待ちドキュメント一覧
  - `usePendingConfirmations.ts`: 確認待ち件数/一覧取得フック
- [x] 同名/同姓同名対応設計ドキュメント作成（Codexアーキテクトレビュー済み）
  - `docs/context/duplicate-name-handling.md`
  - GitHub Pages公開済み
- [x] dev環境・クライアント環境デプロイ完了
- [x] **事業所同名対応実装（2026-01-22）**
  - `extractOfficeCandidates`: 事業所候補抽出（複数候補対応）
  - `processOCR`: officeConfirmed/officeCandidates新スキーマ
  - `OfficeSameNameResolveModal.tsx`: 事業所解決UI
  - `useOfficeResolution.ts`: 事業所解決フック
  - `officeResolutionLogs`: 監査ログコレクション
  - Firestoreルール: 事業所解決フィールド更新許可

## Phase 8以降の追加実装（2026-01-22〜27）

| 日付 | 実装内容 |
|------|----------|
| 01-20 | Google Workspace向けGmail認証セットアップスクリプト追加 |
| 01-22 | 事業所同名対応、本番デプロイ |
| 01-24 | CSVインポート同名確認、Gmail監視UX改善、Secret Manager一元管理 |
| 01-25 | クライアント環境セットアップ、OCR精度確認、担当ケアマネ追加、CORS設定、巻取りスクリプト、OCR編集機能、マスター登録提案UI、マスター新規追加機能、エイリアス学習機能 |
| 01-26 | エイリアス学習UI拡張、検索機能実装 |
| 01-27 | 本番運用開始（checkGmailAttachments定期実行） |
