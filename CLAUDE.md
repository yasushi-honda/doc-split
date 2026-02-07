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

**追加実装（01-22〜02-07）**: CI/CD、テナント自動化、エイリアス学習（書類種別・顧客・事業所）、ドメイン許可リスト自動ログイン、本番運用開始、PWA対応

> 詳細は [docs/context/phase-history.md](docs/context/phase-history.md) を参照

## 今後の予定
- [ ] 精度改善（フィードバック後）

## クライアント環境

クライアント環境は `.firebaserc` にエイリアスとして登録されています。

### セットアップ手順
```bash
# 一括セットアップ（Gmail OAuth込み）※推奨
./scripts/setup-tenant.sh <project-id> <admin-email> --with-gmail

# Claude Code / CI用（非対話モード）
./scripts/setup-tenant.sh <project-id> <admin-email> --yes
./scripts/setup-tenant.sh <project-id> <admin-email> --with-gmail --client-id=X --client-secret=Y --auth-code=Z --yes

# 段階的セットアップ
./scripts/setup-tenant.sh <project-id> <admin-email>
./scripts/setup-gmail-auth.sh <project-id>
./scripts/setup-gmail-auth.sh <project-id> --client-id=X --client-secret=Y --auth-code=Z

# セットアップ検証
./scripts/verify-setup.sh <project-id>

# 追加デプロイ
./scripts/deploy-to-project.sh <alias>
```

詳細は `docs/context/delivery-and-update-guide.md` 参照。

### 環境ファイル構成
- `.firebaserc`: プロジェクトエイリアス定義
- `frontend/.env.<alias>`: 各環境のFirebase設定

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
1. [移行スコープ](docs/context/gcp-migration-scope.md) ★最重要
2. [機能要件](docs/context/functional-requirements.md)
3. [実装計画](docs/context/implementation-plan.md)（各Phase完了条件付き）
4. [データモデル](docs/context/data-model.md)（Firestoreスキーマ）
5. [納品・アップデート運用](docs/context/delivery-and-update-guide.md) ★運用時必読
6. [エラーハンドリング](docs/context/error-handling-policy.md)
7. [Geminiレート制限](docs/context/gemini-rate-limiting.md)
8. [ビジネスロジック](docs/context/business-logic.md)
9. [アーキテクチャ決定記録](docs/adr/)

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
# マルチ環境デプロイ（推奨）
./scripts/deploy-to-project.sh dev           # Hostingのみ
./scripts/deploy-to-project.sh <alias>       # Hostingのみ
./scripts/deploy-to-project.sh <alias> --rules  # Hosting + ルール（★スキーマ変更時必須）
./scripts/deploy-to-project.sh <alias> --full   # 全コンポーネント

# Functionsのみ（環境変数に依存しないため直接実行OK）
firebase deploy --only functions -P dev
firebase deploy --only functions -P <alias>

# ルールのみ（同上）
firebase deploy --only firestore:rules,storage -P dev
firebase deploy --only firestore:rules,storage -P <alias>
```

**⚠️ デプロイ対象の判断（AI向け必読）**:
| 変更内容 | コマンド |
|---------|---------|
| フロントエンドのみ | `./scripts/deploy-to-project.sh <alias>` |
| **Firestoreスキーマ変更** | `./scripts/deploy-to-project.sh <alias> --rules` |
| Functions変更 | `./scripts/deploy-to-project.sh <alias> --full` |

**スキーマ変更の例**: 新フィールド追加（verified等）、フィールド権限変更、新コレクション追加

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
# マスターデータインポート（個別）
FIREBASE_PROJECT_ID=<project-id> node scripts/import-masters.js --customers scripts/samples/customers.csv
FIREBASE_PROJECT_ID=<project-id> node scripts/import-masters.js --documents scripts/samples/documents.csv
FIREBASE_PROJECT_ID=<project-id> node scripts/import-masters.js --offices scripts/samples/offices.csv

# 一括インポート（ディレクトリ内のCSVを自動検出）
FIREBASE_PROJECT_ID=<project-id> node scripts/import-masters.js --all scripts/samples/
```

## 確定事項
| カテゴリ | 選定 |
|---------|------|
| データベース | Firestore（無料枠、Firebase統合） |
| ストレージ | Cloud Storage（Functions連携） |
| OCRエンジン | Vertex AI Gemini 2.5 Flash (asia-northeast1) |
| コンピュート | Cloud Functions (2nd gen) |
| ユーザー認証 | Firebase Authentication (Google Login) |
| Gmail連携 | 開発: OAuth 2.0 / 本番: Service Account + Delegation |
| フロントエンド | Firebase Hosting + React + Vite + TypeScript + PWA |
| UIライブラリ | shadcn/ui + Tailwind CSS |
| PDFビューアー | react-pdf (pdf.js) |
| 状態管理 | Zustand + TanStack Query |
| 納品形態 | セットアップスクリプト方式（雛形なし） |
| コスト上限 | 月額3,000円以下（予算アラート設定済み） |

## マルチクライアント運用

### アーキテクチャ方針

doc-split-dev（開発・検証、SEEDあり） → 各クライアント本番（SEEDなし）。`.firebaserc` にエイリアスとして全環境を定義。

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

5. **ドメイン許可リストによる自動ログイン**
   - `settings/auth.allowedDomains` に許可ドメインを設定
   - `setup-tenant.sh` は管理者メールのドメインのみ自動設定
   - 追加ドメインが必要な場合:
     ```bash
     node scripts/check-allowed-domains.js <project-id> --add <domain>
     # 例: node scripts/check-allowed-domains.js docsplit-kanameone --add kanameone.com
     ```
   - **2026-01-30修正**: Firestoreルールのバグで新規ドメインユーザーがログインできない問題を修正済み

6. **🚨 Firestoreデータ削除の絶対禁止事項（ADR-0008）**
   - **絶対に実行してはいけないコマンド**:
     ```bash
     # 本番環境で以下は絶対禁止
     firebase firestore:delete --all-collections
     firebase firestore:delete / --recursive
     ```
   - **許可される削除操作**（特定コレクションのみ）:
     ```bash
     firebase firestore:delete documents --recursive -P <alias>
     ```
   - **削除前の必須確認**:
     - [ ] 削除対象コレクション名を3回確認
     - [ ] `--all-collections` は絶対に使わない
     - [ ] 本番環境であることを認識
   - **2026-01-30教訓**: 本番環境で `--all-collections` を誤実行し、マスターデータを含む全データを喪失。バックアップ・PITR未設定のため復元不可能となった。

**トラブルシュート詳細**: `docs/operation/setup-guide.md` 参照

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
| checkGmailAttachments | Scheduled (5分間隔) | Gmail添付ファイル取得 |
| processOCR | Scheduled (1分間隔) | AI OCR処理（バックアップ） |
| processOCROnCreate | Firestore Trigger | AI OCR処理（即時実行） |
| getOcrText | Callable | OCR全文取得 |
| detectSplitPoints | Callable | PDF分割候補検出 |
| splitPdf | Callable | PDF分割実行 |
| rotatePdfPages | Callable | PDFページ回転（永続保存） |
| uploadPdf | Callable | ローカルPDFアップロード |
| deleteDocument | Callable | ドキュメント削除（管理者のみ） |
| regenerateSummary | Callable | AI要約再生成 |
| searchDocuments | Callable | 全文検索（日付パース対応） |
| onDocumentWriteSearchIndex | Firestore Trigger | 検索インデックス自動更新 |
| onDocumentWrite | Firestore Trigger | グループキー設定・集計更新 |

### アップロード重複チェック仕様
- **チェック方式**: ファイル名ベース（同名ファイルが存在するか）
- **重複検出時**: ダイアログで別名保存を提案（例: `file.pdf` → `file_2.pdf`）
- **分割元の扱い**: `isSplitSource=true` のファイルは重複チェックから除外
- **Gmail取り込み**: MD5ハッシュで重複チェック（自動処理のため）

### 検索機能仕様
- **検索方式**: 反転インデックス + TF-IDF スコアリング
- **検索対象フィールド**（FIELD_WEIGHTS）:
  - customerName（顧客名）: 重み3
  - officeName（事業所名）: 重み2
  - documentType（書類種別）: 重み2
  - careManager（ケアマネ）: 重み1
  - fileName（ファイル名）: 重み1
- **検索対象外**: processedAt（登録日）、fileDate（書類日付）、ocrResult（OCR結果）
- **日付検索**: 「2024/1」「R6.1」などの日付パースで fileDate を検索可能
- **トークナイズ**: bi-gram + キーワード抽出

## ファイル構成
```
doc-split/
├── CLAUDE.md                    # このファイル
├── package.json                 # モノレポルート
├── firebase.json                # Firebase設定
├── firestore.rules / storage.rules  # セキュリティルール
├── .github/workflows/           # CI/CD（ci.yml, deploy.yml）
├── frontend/                    # Reactフロントエンド
│   ├── src/
│   │   ├── components/          # UIコンポーネント（19ファイル）
│   │   │   ├── ui/              # shadcn/ui（21コンポーネント）
│   │   │   ├── views/           # ビュー系（GroupList, GroupDocumentList, CustomerSubGroup）
│   │   │   ├── DocumentDetailModal / PdfViewer / PdfSplitModal  # 詳細・PDF系
│   │   │   ├── PdfPageThumbnail / PdfSplitPreview / PdfUploadModal  # PDF操作系
│   │   │   ├── CsvImportModal / MasterSelectField / RegisterNewMasterModal  # マスター系
│   │   │   ├── SearchBar / DateRangeFilter / KanaFilterBar  # 検索・フィルター系
│   │   │   ├── Layout / LoadMoreIndicator / AliasLearningHistoryModal  # 共通UI
│   │   │   └── __tests__/       # コンポーネントテスト
│   │   ├── hooks/               # カスタムフック（13ファイル）
│   │   │   ├── useDocuments / useDocumentGroups / useDocumentEdit  # 書類系
│   │   │   ├── useDocumentVerification / useInfiniteScroll  # 確認・スクロール
│   │   │   ├── useSearch / useMasters / useMasterAlias / useAliasLearningHistory  # 検索・マスター系
│   │   │   ├── useErrors / useProcessingHistory / useSettings  # 管理・設定系
│   │   │   └── __tests__/       # フックテスト
│   │   ├── pages/               # 各画面（8ファイル）
│   │   │   └── DocumentsPage / MastersPage / AdminPage / LoginPage 等
│   │   ├── stores/              # Zustand（authStore.ts）
│   │   ├── lib/                 # ユーティリティ
│   │   │   ├── firebase.ts / csvParser.ts / csvTemplates.ts
│   │   │   └── documentUtils.ts / kanaUtils.ts / textNormalizer.ts / utils.ts
│   │   └── utils/               # 表示ヘルパー（displayName.ts）
│   ├── public/                  # 静的ファイル（PWAアイコン、favicon等）
│   └── package.json
├── functions/                   # Cloud Functions
│   ├── src/
│   │   ├── index.ts             # エントリポイント（全関数エクスポート）
│   │   ├── gmail/ ocr/ pdf/ search/ upload/  # 各機能モジュール
│   │   ├── documents/ admin/    # ドキュメント操作・管理者向け
│   │   ├── triggers/            # onDocumentWrite, onDocumentWriteSearchIndex
│   │   └── utils/               # 共通ユーティリティ
│   ├── test/                    # テスト
│   └── package.json
├── scripts/                     # 運用・セットアップスクリプト（19ファイル）
│   ├── setup-tenant.sh          # テナント初期設定（推奨: --with-gmail --yes）
│   ├── setup-gmail-auth.sh / setup-gmail-service-account.sh  # Gmail認証設定
│   ├── init-project.sh          # プロジェクト初期化
│   ├── deploy-to-project.sh / deploy-all-clients.sh  # デプロイ
│   ├── import-masters.js        # マスターデータ投入（CLI）
│   ├── add-admin-user.js        # 管理者ユーザー追加
│   ├── seed-e2e-data.js         # E2Eテストデータ投入
│   ├── gmail-oauth-cli.py       # Gmail OAuth CLIツール
│   ├── check-allowed-domains.js / verify-setup.sh  # 検証・管理
│   ├── run-e2e-tests.sh         # E2Eテスト実行
│   ├── reprocess-master-matching.js  # マスター再マッチング
│   ├── migrate-*.js             # マイグレーションスクリプト群
│   └── samples/                 # CSVサンプル
├── shared/                      # 共通型定義（types.ts）
└── docs/
    ├── context/                 # 開発用詳細（マスター）
    ├── operation/               # 運用ドキュメント
    ├── adr/                     # ADR（0001〜0009）
    ├── audit/ handoff/ reference/  # 監査・ハンドオフ・旧システム参照
```
