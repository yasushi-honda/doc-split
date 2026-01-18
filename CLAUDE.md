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
**フェーズ**: Phase 5完了 - **本番デプロイ完了**

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
- [x] Firestoreルールテスト（22テストパス）
- [x] Cloud Functions単体テスト（27テストパス - similarity utilities）
- [x] 本番デプロイ
  - Firebase Hosting: `https://doc-split-dev.web.app`
  - Cloud Functions: 5関数デプロイ完了
  - Firestoreルール: デプロイ完了
- [x] 運用手順書作成
  - docs/operation/user-guide.md: ユーザーガイド
  - docs/operation/admin-guide.md: 管理者ガイド
  - docs/operation/setup-guide.md: セットアップ手順書

## ドキュメント読込順序（AI向け）
1. `docs/context/gcp-migration-scope.md` - 移行スコープ ★最重要
2. `docs/context/functional-requirements.md` - 機能要件
3. `docs/context/implementation-plan.md` - 実装計画（各Phase完了条件付き）
4. `docs/context/data-model.md` - データモデル（Firestoreスキーマ）
5. `docs/context/error-handling-policy.md` - エラーハンドリング ★NEW
6. `docs/context/gemini-rate-limiting.md` - Geminiレート制限 ★NEW
7. `docs/context/business-logic.md` - ビジネスロジック
8. `docs/adr/` - アーキテクチャ決定記録

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
| 納品形態 | GCPプロジェクト移譲 |

**Artifact Registryは不要**（Firebase Hosting + Cloud Functionsソースデプロイのため）

## 確定した相談事項
| 項目 | 決定内容 |
|------|----------|
| フロントエンドUI | Firebase Hosting + React SPA |
| コスト上限 | 月額3,000円以下 |
| Gmail連携 | 開発: OAuth 2.0、本番: Service Account + Delegation |
| 監視対象メール | 設定画面で指定可能（開発用: `hy.unimail.11@gmail.com`） |
| ログイン許可ユーザー | ホワイトリスト方式（設定画面で管理、管理アカウントあり） |
| 納品形態 | マスタープロジェクトをコピー→初期設定→移譲（サポート対応） |

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
│   │   └── utils/               # 共通ユーティリティ ★Phase 2
│   │       ├── retry.ts         # リトライ機能
│   │       ├── errorLogger.ts   # エラーログ
│   │       ├── gmailAuth.ts     # Gmail認証切替
│   │       ├── rateLimiter.ts   # Geminiレート制限
│   │       └── similarity.ts    # 類似度マッチング
│   ├── test/                    # テスト
│   │   ├── firestore.rules.test.ts  # セキュリティルールテスト
│   │   └── utils.test.ts        # ユーティリティテスト ★Phase 5
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
