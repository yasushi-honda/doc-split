# DocSplit

書類管理ビューアーアプリ - Gmailの添付ファイルを自動取得し、AI OCRでメタ情報を抽出、検索・グルーピング・閲覧が可能なWebアプリケーション。

## 概要

AppSheetで構築された書類管理アプリをGCP/Firebaseでリプレイス開発するプロジェクトです。

### 主な機能

- **Gmail添付ファイル自動取得**: 指定ラベルのメールから添付ファイルを自動収集
- **AI OCR処理**: 自前ホスティングのPaddleOCR(Cloud Run、東京リージョン)によるOCR。書類の内容を外部の生成AIサービスへは送信しない
- **AI要約**: OCR結果から書類内容を要約(手動依頼のみ、自前ホスティングのSarashina(Cloud Run)で非同期に生成)
- **書類情報自動抽出**: 書類名・顧客名・事業所名・日付を自動判定
- **書類検索・閲覧**: フィルタリング、グルーピング、PDFビューアー
- **Google Driveエクスポート**: 確認済みの書類をGoogle Driveへ自動保存(環境ごとにfeature flagと許可リストで有効化)
- **PDF分割機能**: 複数書類が含まれるPDFを自動検出・分割
- **エイリアス学習**: 書類種別・顧客・事業所の表記揺れを学習
- **モバイル対応**: スマートフォン・タブレットでの操作に最適化

## 技術スタック

| カテゴリ | 技術 |
|---------|------|
| フロントエンド | React + Vite + TypeScript |
| バックエンド | Cloud Functions (2nd gen) |
| データベース | Firestore |
| ストレージ | Cloud Storage |
| 認証 | Firebase Authentication (Google Login) |
| OCR | PaddleOCR(自前ホスティング、Cloud Run asia-northeast1) |
| 要約 | Sarashina(自前ホスティング、Cloud Run asia-northeast1、手動依頼) |
| ホスティング | Firebase Hosting |

## プロジェクト構成

```
doc-split/
├── frontend/                # Reactフロントエンド
│   └── src/
├── functions/               # Cloud Functions
│   ├── src/
│   │   ├── gmail/          # Gmail添付取得
│   │   ├── ocr/            # OCR処理・AI要約
│   │   ├── pdf/            # PDF操作
│   │   ├── drive/          # Google Driveエクスポート
│   │   ├── search/         # 検索インデックス・全文検索
│   │   ├── documents/      # 書類の削除など
│   │   ├── upload/         # ローカルPDFアップロード
│   │   ├── triggers/       # Firestoreトリガー
│   │   ├── admin/          # 管理系
│   │   ├── storage/        # Storage操作
│   │   └── utils/          # 共通ユーティリティ
│   └── test/               # テスト
├── services/                # 自前ホスティングのAI(PaddleOCR・Sarashina、Cloud Run)
├── scripts/                 # 運用・納品スクリプト(約130本。多くはGitHub Actionsのrun-ops-script.yml経由で実行)
│   ├── clients/            # クライアント環境ごとの設定(dev・kanameone・cocoro)
│   ├── setup-tenant.sh     # 新規テナントのセットアップ(PaddleOCR・Sarashina基盤は含まない)
│   ├── deploy-to-project.sh # 環境別デプロイ
│   ├── import-masters.js   # マスターデータ投入
│   └── samples/            # CSVサンプル
├── shared/                  # 共通型定義
├── docs/                    # ドキュメント
│   ├── context/            # 設計ドキュメント
│   └── adr/                # アーキテクチャ決定記録
├── firestore.rules          # Firestoreセキュリティルール
├── storage.rules            # Storageセキュリティルール
└── firebase.json            # Firebase設定
```

## セットアップ

### 前提条件

- Node.js >= 20
- Firebase CLI
- Google Cloud CLI

### 開発環境

```bash
# 依存パッケージのインストール
npm install

# Firebaseエミュレータ起動
firebase emulators:start

# フロントエンド開発サーバー
cd frontend && npm run dev
```

### テスト実行

```bash
# Firestoreセキュリティルールのテスト
cd functions
npm run test:rules
```

## ドキュメント

- [移行スコープ](docs/context/gcp-migration-scope.md)
- [機能要件](docs/context/functional-requirements.md)
- [実装計画](docs/context/implementation-plan.md)
- [データモデル](docs/context/data-model.md)

## 開発ステータス

| フェーズ | 状態 | 内容 |
|---------|------|------|
| Phase 0 | ✅ 完了 | GCP環境構築 |
| Phase 1 | ✅ 完了 | Firestoreスキーマ・セキュリティルール |
| Phase 2 | ✅ 完了 | Gmail連携・OCR処理 |
| Phase 3 | ✅ 完了 | フロントエンド |
| Phase 4 | ✅ 完了 | 管理機能・PDF分割 |
| Phase 5 | ✅ 完了 | テスト・本番デプロイ |
| Phase 6 | ✅ 完了 | ビジネスロジック移行 |
| Phase 7 | ✅ 完了 | 処理履歴・同姓同名解決 |
| Phase 8 | ✅ 完了 | グループ化ビュー・検索機能 |
| 追加実装 | ✅ 完了 | AI要約・モバイルUI・エイリアス学習・Google Driveエクスポート |
| AI基盤の自前化 | ✅ 完了 | OCRをPaddleOCR、要約をSarashinaへ移行し、Gemini(Vertex AI)を廃止(ADR-0025・0027・0029) |

**開発環境URL(dev)**: https://doc-split-dev.web.app (クライアントごとの本番環境は別のURL)

## ライセンス

Private - All rights reserved
