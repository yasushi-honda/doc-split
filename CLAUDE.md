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

### 開発完了サマリー

| Phase | 完了日 | 内容 |
|-------|--------|------|
| 0 | 01-18 | GCP環境構築、Firebase連携 |
| 1 | 01-18 | Firestoreスキーマ、セキュリティルール |
| 2 | 01-18 | Gmail連携、OCR処理（Gemini 2.5 Flash） |
| 3 | 01-18 | フロントエンド（React + shadcn/ui） |
| 4 | 01-18 | PDF分割、マスターデータ編集 |
| 5 | 01-18 | テスト、本番デプロイ、運用手順書 |
| 6 | 01-18 | ビジネスロジック移行（132テストパス） |
| 7 | 01-20 | 処理履歴、同姓同名解決 |
| 8 | 01-22 | グループ化ビュー、検索機能 |

**追加実装（01-22〜27）**: CI/CD、テナント自動化、エイリアス学習、本番運用開始

> 詳細は [docs/context/phase-history.md](docs/context/phase-history.md) を参照

## 今後の予定
- [ ] 精度改善（フィードバック後）

## Phase 8以降の追加実装（2026-01-22〜27）

<details>
<summary>クリックして展開（18項目完了）</summary>

| 日付 | 実装内容 |
|------|----------|
| 01-22 | 事業所同名対応、本番デプロイ |
| 01-24 | CSVインポート同名確認、Gmail監視UX改善、Secret Manager一元管理 |
| 01-25 | クライアント環境セットアップ、OCR精度確認、担当ケアマネ追加、CORS設定、巻取りスクリプト、OCR編集機能、マスター登録提案UI、マスター新規追加機能、エイリアス学習機能 |
| 01-26 | エイリアス学習UI拡張、検索機能実装 |
| 01-27 | 本番運用開始（checkGmailAttachments定期実行） |

</details>

## クライアント環境

クライアント環境は `.firebaserc` にエイリアスとして登録されています。

### セットアップ手順
1. `scripts/setup-tenant.sh <project-id> <admin-email>` でテナント初期設定
2. `scripts/setup-gmail-auth.sh <project-id>` でGmail認証設定
3. `scripts/deploy-to-project.sh <alias>` でデプロイ

詳細は `docs/context/delivery-and-update-guide.md` 参照。

### 環境ファイル構成
- `.firebaserc`: プロジェクトエイリアス定義
- `frontend/.env.<alias>`: 各環境のFirebase設定

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
./scripts/deploy-to-project.sh dev         # 開発環境
./scripts/deploy-to-project.sh <alias>     # クライアント環境（.firebasercのエイリアス）

# Functionsのみ（環境変数に依存しないため直接実行OK）
firebase deploy --only functions -P dev
firebase deploy --only functions -P <alias>

# ルールのみ（同上）
firebase deploy --only firestore:rules,storage -P dev
firebase deploy --only firestore:rules,storage -P <alias>
```

### 環境変数ファイル構成

```
frontend/
├── .env.dev          # dev環境設定（固定）
├── .env.<alias>      # クライアント環境設定（エイリアスごとに作成）
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

**根本原因パターン（クライアント移行時の教訓）**:
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
