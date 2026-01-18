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
**フェーズ**: Phase 2完了 → Phase 3開始可能

### 環境情報
| 項目 | 値 |
|------|-----|
| GCPプロジェクト | `doc-split-dev` |
| リージョン | `asia-northeast1` |
| GitHubリポジトリ | `yasushi-honda/doc-split` |
| Storageバケット | `doc-split-dev-documents` |
| Firestoreエミュレータ | ポート `8085` |

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

## 次のステップ（Phase 3: フロントエンド）
1. **基盤構築**: React + Vite + TypeScript + Tailwind CSS + shadcn/ui
2. **認証・ルーティング**: Firebase Authentication統合、ホワイトリストチェック
3. **書類一覧画面**: Firestoreリアルタイム同期、検索・フィルター・グルーピング
4. **PDFビューアー**: react-pdf (pdf.js)、ページナビゲーション、メタ情報表示

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
│   │   ├── components/          # PdfViewer等
│   │   ├── pages/               # 各画面
│   │   ├── stores/              # Zustand
│   │   └── lib/                 # Firebase SDK等
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
│   │   └── firestore.rules.test.ts  # セキュリティルールテスト
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
    │   ├── error-handling-policy.md    # ★NEW
    │   └── gemini-rate-limiting.md     # ★NEW
    ├── adr/
    │   ├── 0001-tech-stack-selection.md
    │   ├── 0002-security-design.md
    │   ├── 0003-authentication-design.md  # 環境切替追加
    │   └── 0004-frontend-architecture.md
    └── reference/
        ├── gas-source/                 # GASソースコード（要クローン）
        └── *.md                        # 技術ドキュメント
```
