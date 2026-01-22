# DocSplit - 書類管理ビューアーアプリ

## アプリ情報
| 項目 | 内容 |
|------|------|
| アプリ名 | **DocSplit** |
| アイコン | `DocSplit_アプリアイコン.png`（ロボット + 書類） |
| テーマカラー | ダークブルー（#1a365d 系） |

## プロジェクト概要
AppSheetで構築された書類管理アプリをGCPでリプレイス開発するプロジェクト。
Gmailの添付ファイルを自動取得し、AI OCRでメタ情報を抽出、検索・グルーピング・閲覧が可能な**書類管理ビューアーアプリ**。

## 現在のステータス
**フェーズ**: Phase 8完了 - **グループ化ビュー（1万件対応）**

### 環境情報
| 項目 | 値 |
|------|-----|
| GCPプロジェクト | `doc-split-dev` |
| リージョン | `asia-northeast1` |
| GitHubリポジトリ | `yasushi-honda/doc-split` |
| Storageバケット | `doc-split-dev-documents` |
| Firestoreエミュレータ | ポート `8085` |
| **本番URL** | `https://doc-split-dev.web.app` |

### Phase 0 完了項目（2026-01-18）
- [x] GCPプロジェクト作成・請求アカウント設定
- [x] 必要API有効化（Functions, Firestore, Storage, Pub/Sub, Vertex AI等）
- [x] Firebase連携・Firestoreデータベース作成
- [x] Firebase Authentication（Googleプロバイダー）有効化
- [x] Cloud Storageバケット作成
- [x] エミュレータ動作確認
- [x] GitHubリポジトリ作成・初期プッシュ

### Phase 1 完了項目（2026-01-18）
- [x] Firestoreインデックス定義（複合インデックス8件）
- [x] Firestoreセキュリティルール実装・テスト（22テストパス）
- [x] Storageセキュリティルール更新（ファイルサイズ・MIME制限追加）
- [x] マスターデータインポートスクリプト（顧客・書類・事業所・ケアマネ対応）
- [x] プロジェクト初期設定スクリプト

### Phase 2 完了項目（2026-01-18）
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
  - gmailAuth.ts: Gmail認証切替
  - rateLimiter.ts: Geminiレート制限
  - similarity.ts: 類似度マッチング

### Phase 3 完了項目（2026-01-18）
- [x] shadcn/ui セットアップ（Button, Card, Input, Badge, Dialog, Select, Table, Tabs等）
- [x] Firestore連携フック（useDocuments, useDocument, useDocumentStats等）
- [x] DocumentsPage改善（統計カード、検索・フィルター、書類一覧テーブル）
- [x] DocumentDetailModal（PDFビューアー統合、メタ情報サイドバー）
- [x] 設定画面（SettingsPage）- Gmail監視設定、ユーザー管理、通知設定
- [x] エラー履歴画面（ErrorsPage）- エラー一覧、再処理機能、ステータス管理
- [x] Firebase Hostingプレビューデプロイ

### Phase 4 完了項目（2026-01-18）
- [x] PDF分割バックエンド（Cloud Functions: detectSplitPoints, splitPdf, rotatePdfPages）
- [x] PDF分割フロントエンド（PdfSplitModal: 分割候補表示、手動追加、セグメント編集）
- [x] DocumentDetailModalに分割ボタン追加
- [x] マスターデータ編集画面（MastersPage: 顧客・書類種別・事業所・ケアマネCRUD）

### Phase 5 完了項目（2026-01-18）
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

### Phase 6 完了項目（2026-01-18）- ビジネスロジック移行
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

### CI/CD パイプライン追加（2026-01-19）
- [x] GitHub Actions CI（`.github/workflows/ci.yml`）
  - PR時: lint → build → test（Firestoreルールテスト含む）
  - Node.js 20、Java 21（エミュレータ用）
- [x] GitHub Actions CD（`.github/workflows/deploy.yml`）
  - mainマージ時: 自動デプロイ（Firebase Hosting + Functions）
- [x] ESLint v9 flat config移行（frontend/functions）
- [x] GitHub Secrets設定（Firebase環境変数 + FIREBASE_TOKEN）

### 本番環境動作確認・改善（2026-01-19）
- [x] 認証初期化バグ修正（AuthInitializerコンポーネント追加）
- [x] UI改善
  - アプリアイコン画像適用（ログイン画面、ヘッダー）
  - ファビコン設定
  - ヘッダーレイアウト調整（レスポンシブ対応）
  - モバイル表示最適化
- [x] Firestoreインデックス追加（status + processedAt ASC）
- [x] 管理者ユーザー登録（hy.unimail.11@gmail.com）
- [x] マスターデータ投入（顧客10件、書類種別15件、事業所10件、ケアマネ3件）

### テナント初期設定自動化（2026-01-19）
- [x] `scripts/setup-tenant.sh` - 包括的初期設定スクリプト
  - GCP API有効化（9個）
  - Firebase設定・環境変数生成
  - 管理者ユーザー登録
  - ルール・インデックス・Functions・Hostingデプロイ
- [x] `scripts/setup-gmail-auth.sh` - Gmail OAuth認証設定
  - OAuth認証フロー
  - Secret Manager保存
  - Cloud Functions権限付与

### GitHub Pagesドキュメント（2026-01-19）
- [x] Docsifyベースのドキュメントサイト作成
- [x] URL: `https://yasushi-honda.github.io/doc-split/`
- [x] ページ構成:
  - プロジェクト概要、アーキテクチャ図
  - 納品フロー（Mermaid図付き）
  - セットアップ手順、運用ガイド
  - データモデル、API/Functions、セキュリティ

### Phase 7 完了項目（2026-01-20）
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

### Phase 8 完了項目（2026-01-22）- グループ化ビュー（1万件対応）
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
- [x] dev環境・kanameone環境デプロイ完了
- [x] **事業所同名対応実装（2026-01-22）**
  - `extractOfficeCandidates`: 事業所候補抽出（複数候補対応）
  - `processOCR`: officeConfirmed/officeCandidates新スキーマ
  - `OfficeSameNameResolveModal.tsx`: 事業所解決UI
  - `useOfficeResolution.ts`: 事業所解決フック
  - `officeResolutionLogs`: 監査ログコレクション
  - Firestoreルール: 事業所解決フィールド更新許可

## 次のタスク
- [x] 事業所同名対応実装（顧客パターン流用）**完了 2026-01-22**
- [x] 本番デプロイ（dev/kanameone環境）**完了 2026-01-22**
- [ ] 実書類でのOCR精度確認（クライアント環境）

## 未実装（将来対応）
- [ ] 検索機能（n-gram反転インデックス + Cloud Functions検索API）
- [ ] 精度改善（フィードバック後）

## 追加完了項目（2026-01-20）
- [x] Google Workspace向けGmail認証セットアップスクリプト追加
  - scripts/setup-gmail-service-account.sh: Service Account + Domain-wide Delegation方式
  - docs/operation/gmail-auth-guide.md: 認証方式選択ガイド
  - 無料Gmail / Google Workspace 両パターン対応完了

## クライアント環境（2026-01-22）
### kanameone（検証用）
| 項目 | 値 |
|------|-----|
| GCPプロジェクト | `docsplit-kanameone` |
| Firebase Alias | `kanameone` |
| 本番URL | `https://docsplit-kanameone.web.app` |
| 管理者 | `systemkaname@kanameone.com` |
| Gmail認証 | OAuth 2.0 |
| 設定ファイル | `frontend/.env.kanameone` |

## 完了したインフラ設定（2026-01-19）
- [x] コスト監視・予算アラート設定（月額3,000円、50%/80%/100%閾値）
- [x] Cloud Monitoring エラー通知設定（Cloud Functions/Vertex AI）
- [x] メール通知チャネル設定（hy.unimail.11@gmail.com）
- [x] Gmail連携テスト完了（OAuth 2.0方式）
  - Secret Manager設定修正（gmail-oauth-client-secret, gmail-oauth-refresh-token）
  - gmailAuth.ts: Cloud Functions 2nd gen環境変数対応（GOOGLE_CLOUD_PROJECT）
  - E2E動作確認（checkGmailAttachments正常実行）

## ドキュメント構成（AI向け）

### 役割別ディレクトリ
| ディレクトリ | 用途 | 対象 |
|-------------|------|------|
| `docs/context/` | **開発用詳細ドキュメント（マスター）** | AI/開発者 |
| `docs/adr/` | アーキテクチャ決定記録 | AI/開発者 |
| `docs/operation/` | 運用ドキュメント詳細 | 納品先管理者 |
| `docs/直下` | GitHub Pages公開用（簡略版） | 外部向け |
| `docs/reference/` | 旧システム参照資料（アーカイブ） | 必要時のみ |

### 読込優先順序
1. `docs/context/gcp-migration-scope.md` - 移行スコープ ★最重要
2. `docs/context/functional-requirements.md` - 機能要件
3. `docs/context/implementation-plan.md` - 実装計画（各Phase完了条件付き）
4. `docs/context/data-model.md` - データモデル（Firestoreスキーマ）
5. `docs/context/delivery-and-update-guide.md` - 納品・アップデート運用 ★運用時必読
6. `docs/context/error-handling-policy.md` - エラーハンドリング
7. `docs/context/gemini-rate-limiting.md` - Geminiレート制限
8. `docs/context/business-logic.md` - ビジネスロジック
9. `docs/adr/` - アーキテクチャ決定記録

**注意**: `docs/直下`のファイル（data-model.md等）はGitHub Pages用の簡略版。AI開発時は`docs/context/`を参照すること。

## 開発コマンド

### ローカル開発
```bash
# フロントエンド開発サーバー
cd frontend && npm run dev

# Firebaseエミュレータ起動
firebase emulators:start

# 全体ビルド確認
npm run build
```

### テスト
```bash
# Functions単体テスト
cd functions && npm test

# Firestoreルールテスト
cd functions && npm run test:rules

# フロントエンドテスト
cd frontend && npm test
```

### デプロイ

**重要**: マルチ環境デプロイ時は必ずスクリプトを使用すること。
手動で`firebase deploy`を実行すると、`.env.local`の設定が使われて誤った環境にデプロイされる危険がある。

```bash
# マルチ環境Hostingデプロイ（推奨）
./scripts/deploy-to-project.sh dev        # 開発環境
./scripts/deploy-to-project.sh kanameone  # クライアント環境

# Functionsのみ（環境変数に依存しないため直接実行OK）
firebase deploy --only functions -P dev
firebase deploy --only functions -P kanameone

# ルールのみ（同上）
firebase deploy --only firestore:rules,storage -P dev
firebase deploy --only firestore:rules,storage -P kanameone
```

### 環境変数ファイル構成

```
frontend/
├── .env.dev          # dev環境設定（固定）
├── .env.kanameone    # kanameone環境設定（固定）
├── .env.local        # ローカル開発用（通常dev設定）
└── .env.example      # テンプレート
```

**注意**: Viteは`.env.local`を最優先で読み込む。デプロイスクリプトは自動で正しい設定に切り替える。

### マスターデータ
```bash
# マスターデータインポート
node scripts/import-masters.js --file scripts/samples/customers.csv --type customers
```

## 確定事項
| カテゴリ | 選定 |
|---------|------|
| OCRエンジン | Vertex AI Gemini 2.5 Flash (asia-northeast1) |
| サービス間認証 | Workload Identity |
| コンピュート | Cloud Functions (2nd gen) |
| ユーザー認証 | Firebase Authentication (Google Login) |
| Gmail連携 | Service Account + Domain-wide Delegation |
| フロントエンド | Firebase Hosting + React + Vite + TypeScript |
| UIライブラリ | shadcn/ui + Tailwind CSS |
| PDFビューアー | react-pdf (pdf.js) |
| 状態管理 | Zustand + TanStack Query |
| 納品形態 | セットアップスクリプト方式（雛形なし） |

**Artifact Registryは不要**（Firebase Hosting + Cloud Functionsソースデプロイのため）

## マルチクライアント運用

### アーキテクチャ方針

```
[doc-split-dev]          [client-a]          [client-b]
  開発・検証        →      本番A        →      本番B
  (SEEDあり)             (SEEDなし)          (SEEDなし)
```

### .firebaserc構成

```json
{
  "projects": {
    "dev": "doc-split-dev",
    "client-a": "<client-a-project-id>",
    "client-b": "<client-b-project-id>"
  }
}
```

### 運用フロー

| フロー | 手順 |
|--------|------|
| 初期納品 | クライアントGCP作成 → setup-tenant.sh → マスターデータ投入 |
| アップデート | dev で検証 → `firebase deploy -P client-a` → `-P client-b` |
| 新規追加 | setup-tenant.sh → .firebasercに追加 |

**詳細**: `docs/context/delivery-and-update-guide.md` 参照

### ⚠️ クライアントデプロイ時の重要注意点

**根本原因パターン（2026-01-22 kanameone移行時の教訓）**:
- 仕様の「唯一の参照元」がなく手作業で推測
- 環境差分（本番/検証）のガード不足
- 実装仕様と運用手順の乖離

1. **`.env.local` の優先順位問題**
   - Viteは `.env.local` を `.env` より優先
   - クライアント環境へデプロイ時は必ず `.env.local` を切り替える
   ```bash
   cp frontend/.env.<環境名> frontend/.env.local
   rm -rf frontend/dist && npm run build
   firebase deploy -P <環境名> --only hosting
   cp frontend/.env.dev frontend/.env.local  # 復元
   ```

2. **管理者ユーザー登録**
   - 登録先: `users` コレクション（`allowedUsers` ではない）
   - ドキュメントID: Firebase Auth UID（emailではない）
   - ユーザーが一度ログイン試行後に登録可能（Auth UIDが必要なため）

3. **auth/unauthorized-domain 対応**
   - Firebase Console → Authentication → Authorized domains
   - GCP Console → OAuth 2.0 Client → JavaScript origins + Redirect URIs

4. **本番環境へのサンプルデータ投入禁止**
   - 本番セットアップ時は「マスターデータなし」を選択
   - クライアントから実際のCSVを受領してから投入
   - 開発/検証環境のみサンプルデータ使用可
   - **注意**: マスターデータは `masters/{type}/items` サブコレクションに保存
     - `masters/customers/items` - 顧客
     - `masters/documents/items` - 書類種別（documentTypesではない）
     - `masters/offices/items` - 事業所
     - `masters/caremanagers/items` - ケアマネ（小文字）

**トラブルシュート詳細**: `docs/operation/setup-guide.md` 参照

## 確定した相談事項
| 項目 | 決定内容 |
|------|----------|
| フロントエンドUI | Firebase Hosting + React SPA |
| コスト上限 | 月額3,000円以下 |
| Gmail連携 | 開発: OAuth 2.0、本番: Service Account + Delegation |
| 監視対象メール | 設定画面で指定可能（開発用: `hy.unimail.11@gmail.com`） |
| ログイン許可ユーザー | ホワイトリスト方式（設定画面で管理、管理アカウントあり） |
| 納品形態 | クライアントGCP作成 → セットアップスクリプト実行（雛形なし方式） |

## 技術選定（全確定）
| 項目 | 選定 | 理由 |
|------|------|------|
| データベース | **Firestore** | 無料枠で十分、Firebase統合 |
| ストレージ | **Cloud Storage** | Cloud Functions連携がメイン |
| VPC Service Controls | **不要** | コスト制約、アプリ層で担保 |

## 本番環境情報
| 項目 | URL/情報 |
|------|----------|
| アプリURL | `https://doc-split-dev.web.app` |
| **ドキュメント** | `https://yasushi-honda.github.io/doc-split/` |
| Firebase Console | `https://console.firebase.google.com/project/doc-split-dev` |
| GCP Console | `https://console.cloud.google.com/home/dashboard?project=doc-split-dev` |
| Functions Logs | `https://console.firebase.google.com/project/doc-split-dev/functions/logs` |

### デプロイ済みCloud Functions
| 関数名 | トリガー | 説明 |
|--------|----------|------|
| checkGmailAttachments | Scheduled | Gmail添付ファイル取得 |
| processOCR | Scheduled | AI OCR処理 |
| detectSplitPoints | Callable | PDF分割候補検出 |
| splitPdf | Callable | PDF分割実行 |
| rotatePdfPages | Callable | PDFページ回転 |

## 設計完了済み
- [x] 移行スコープ定義
- [x] 機能要件定義（P0/P1/P2）
- [x] データモデル（Firestoreスキーマ）
- [x] 認証設計（Firebase Auth + ホワイトリスト + Gmail環境切替）
- [x] フロントエンド設計（React + shadcn/ui）
- [x] 実装計画（5フェーズ + 完了チェックリスト）
- [x] 元システム知見の反映
- [x] 納品準備設計（スクリプト・ドキュメント構成）
- [x] エラーハンドリングポリシー
- [x] Geminiレート制限設計
- [x] マスターデータCSVサンプル

## ファイル構成
```
doc-split/
├── CLAUDE.md                    # このファイル
├── package.json                 # モノレポルート
├── firebase.json                # Firebase設定
├── firestore.rules              # Firestoreセキュリティルール
├── storage.rules                # Storageセキュリティルール
├── frontend/                    # Reactフロントエンド
│   ├── src/
│   │   ├── components/          # UIコンポーネント
│   │   │   ├── ui/              # shadcn/ui
│   │   │   ├── PdfViewer.tsx    # PDFビューアー
│   │   │   ├── DocumentDetailModal.tsx  # 詳細モーダル
│   │   │   ├── PdfSplitModal.tsx    # PDF分割モーダル ★Phase 4
│   │   │   └── Layout.tsx       # レイアウト
│   │   ├── hooks/               # カスタムフック
│   │   │   ├── useDocuments.ts  # Firestore書類連携
│   │   │   ├── useSettings.ts   # 設定・ユーザー管理
│   │   │   ├── useErrors.ts     # エラー履歴連携
│   │   │   ├── usePdfSplit.ts   # PDF分割連携
│   │   │   └── useMasters.ts    # マスターデータCRUD ★Phase 4
│   │   ├── pages/               # 各画面
│   │   │   ├── DocumentsPage.tsx    # 書類一覧
│   │   │   ├── SettingsPage.tsx     # 設定画面
│   │   │   ├── ErrorsPage.tsx       # エラー履歴
│   │   │   ├── MastersPage.tsx      # マスターデータ編集 ★Phase 4
│   │   │   └── LoginPage.tsx        # ログイン
│   │   ├── stores/              # Zustand
│   │   └── lib/                 # Firebase SDK等
│   ├── components.json          # shadcn/ui設定 ★Phase 3
│   └── package.json
├── functions/                   # Cloud Functions
│   ├── src/
│   │   ├── gmail/               # checkGmailAttachments
│   │   ├── ocr/                 # processOCR
│   │   ├── pdf/                 # pdfOperations（分割・回転）
│   │   └── utils/               # 共通ユーティリティ
│   │       ├── retry.ts         # リトライ機能
│   │       ├── errorLogger.ts   # エラーログ
│   │       ├── gmailAuth.ts     # Gmail認証切替
│   │       ├── rateLimiter.ts   # Geminiレート制限
│   │       ├── similarity.ts    # 類似度マッチング
│   │       ├── textNormalizer.ts    # テキスト正規化 ★Phase 6A
│   │       ├── extractors.ts        # 情報抽出 ★Phase 6B
│   │       ├── fileNaming.ts        # ファイル名生成 ★Phase 6C
│   │       └── pdfAnalyzer.ts       # PDF分析 ★Phase 6D
│   ├── test/                    # テスト
│   │   ├── firestore.rules.test.ts  # セキュリティルールテスト
│   │   ├── similarity.test.ts       # 類似度テスト
│   │   ├── textNormalizer.test.ts   # テキスト正規化テスト ★Phase 6A
│   │   ├── extractors.test.ts       # 情報抽出テスト ★Phase 6B
│   │   ├── fileNaming.test.ts       # ファイル名生成テスト ★Phase 6C
│   │   └── pdfAnalyzer.test.ts      # PDF分析テスト ★Phase 6D
│   └── package.json
├── scripts/                     # サポート用スクリプト
│   ├── init-project.sh          # 顧客固有設定の変更
│   ├── import-masters.js        # マスターデータ投入（CLI）
│   └── samples/                 # CSVサンプル ★NEW
│       ├── customers.csv
│       ├── documents.csv
│       ├── offices.csv
│       └── caremanagers.csv
├── shared/                      # 共通型定義
│   └── types.ts
└── docs/
    ├── context/
    │   ├── gcp-migration-scope.md
    │   ├── functional-requirements.md
    │   ├── implementation-plan.md      # 完了チェックリスト付き
    │   ├── data-model.md
    │   ├── delivery-and-update-guide.md  # 納品・アップデート運用 ★NEW
    │   ├── business-logic.md
    │   ├── error-handling-policy.md
    │   └── gemini-rate-limiting.md
    ├── operation/                      # 運用ドキュメント ★Phase 5
    │   ├── user-guide.md               # ユーザーガイド
    │   ├── admin-guide.md              # 管理者ガイド
    │   └── setup-guide.md              # セットアップ手順書
    ├── adr/
    │   ├── 0001-tech-stack-selection.md
    │   ├── 0002-security-design.md
    │   ├── 0003-authentication-design.md
    │   └── 0004-frontend-architecture.md
    └── reference/
        ├── gas-source/                 # GASソースコード（要クローン）
        └── *.md                        # 技術ドキュメント
```
