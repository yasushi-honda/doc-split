# 納品・アップデート運用ガイド

## 概要

本ドキュメントは、DocSplitの納品フローとアップデート運用について定義する。
AI駆動開発において、このドキュメントを参照することで一貫した運用が可能となる。

## アーキテクチャ方針

### 採用方式: マルチプロジェクト独立デプロイ

```
[doc-split-dev]          [client-a]          [client-b]
  開発・検証        →      本番A        →      本番B
  (SEEDあり)             (SEEDなし)          (SEEDなし)
```

### 方針決定の背景

| 検討項目 | 決定 | 理由 |
|---------|------|------|
| 雛形プロジェクト | 不要 | セットアップスクリプトで代替可能 |
| マルチテナントSaaS | 不採用 | クライアント2社では過剰 |
| CI/CD自動デプロイ | 開発環境のみ | 本番は手動（2社なら十分） |
| 課金 | 各クライアント独立 | 責任分離のため |

### 不採用とした方式

1. **雛形プロジェクト方式**: 管理対象が増え、メリットが薄い
2. **単一プロジェクトマルチテナント**: クライアント独立性が損なわれる
3. **Terraform/IaC**: 規模に対して過剰

---

## プロジェクト構成

### .firebaserc

```json
{
  "projects": {
    "dev": "doc-split-dev",
    "client-a": "<client-a-project-id>",
    "client-b": "<client-b-project-id>"
  }
}
```

### 役割分担

| プロジェクト | 用途 | SEEDデータ | 課金 |
|-------------|------|-----------|------|
| doc-split-dev | 開発・検証 | あり | 開発者 |
| client-a | クライアントA本番 | なし | クライアントA |
| client-b | クライアントB本番 | なし | クライアントB |

---

## 初期納品フロー

### 前提条件

- クライアントがGCPアカウントを持っている
- クライアントが課金アカウントを設定できる
- クライアントのGmail（監視対象）にアクセス可能

### 手順

```bash
# ========================================
# Step 1: クライアント側作業
# ========================================
# クライアントがGCPプロジェクト作成
# クライアントが課金アカウント紐付け
# クライアントが開発者をプロジェクトオーナーに追加

# ========================================
# Step 2: 開発者側作業 - 初期セットアップ
# ========================================

# 2-1. クライアントのGCPプロジェクトに切替
gcloud config set project <client-project-id>

# 2-2. セットアップスクリプト実行
./scripts/setup-tenant.sh <client-project-id> <admin-email>

# 2-3. Gmail OAuth設定
./scripts/setup-gmail-auth.sh

# 2-4. .firebasercにクライアント追加
# "client-x": "<client-project-id>" を追加

# ========================================
# Step 3: クライアント側作業 - データ準備
# ========================================
# クライアントがマスターデータCSV準備
# - 顧客一覧
# - 書類種別
# - 事業所
# - ケアマネ（任意）

# ========================================
# Step 4: 開発者側作業 - データ投入
# ========================================
node scripts/import-masters.js --file <customers.csv> --type customers -P client-x
node scripts/import-masters.js --file <documents.csv> --type documents -P client-x
node scripts/import-masters.js --file <offices.csv> --type offices -P client-x

# ========================================
# Step 5: 動作確認
# ========================================
# クライアントと共に本番環境で動作確認
# 問題なければ運用開始
```

### 納品チェックリスト

- [ ] GCPプロジェクト作成完了
- [ ] 課金アカウント紐付け完了
- [ ] setup-tenant.sh 実行完了
- [ ] Firebase Authentication 設定完了
- [ ] Gmail OAuth 設定完了
- [ ] Firestore ルール デプロイ完了
- [ ] Cloud Functions デプロイ完了
- [ ] Firebase Hosting デプロイ完了
- [ ] 管理者ユーザー登録完了
- [ ] マスターデータ投入完了
- [ ] 動作確認完了

---

## アップデートフロー

### 通常のアップデート（バグフィックス・機能追加）

```bash
# ========================================
# Step 1: 開発環境で修正・テスト
# ========================================
# 開発ブランチで作業
git checkout -b feature/xxx

# 開発環境にデプロイしてテスト
firebase deploy -P dev

# テスト完了後、mainにマージ
git checkout main
git merge feature/xxx
git push origin main

# ========================================
# Step 2: 各クライアントにデプロイ
# ========================================
# クライアントAにデプロイ
firebase deploy -P client-a

# クライアントBにデプロイ
firebase deploy -P client-b

# ========================================
# Step 3: 動作確認
# ========================================
# 各クライアント環境で動作確認
```

### 部分デプロイ（Functionsのみ等）

```bash
# Functionsのみ
firebase deploy --only functions -P client-a

# Hostingのみ
firebase deploy --only hosting -P client-a

# ルールのみ
firebase deploy --only firestore:rules,storage -P client-a
```

### 緊急修正（Hotfix）

```bash
# 1. mainから直接修正
git checkout main

# 2. 修正実施

# 3. 開発環境で最低限の確認
firebase deploy -P dev

# 4. 即座に本番デプロイ
firebase deploy -P client-a
firebase deploy -P client-b

# 5. コミット・プッシュ
git add .
git commit -m "fix: 緊急修正の内容"
git push origin main
```

---

## 新規クライアント追加フロー

```bash
# 1. クライアントがGCPプロジェクト作成・課金設定

# 2. セットアップ実行
./scripts/setup-tenant.sh <new-client-project-id> <admin-email>
./scripts/setup-gmail-auth.sh

# 3. .firebasercに追加
# エディタで .firebaserc を編集し、新クライアントを追加

# 4. マスターデータ投入
node scripts/import-masters.js --file <data.csv> --type <type> -P new-client

# 5. 動作確認
```

---

## 責任分担

### 開発者の責任

| 項目 | 内容 |
|------|------|
| 初期セットアップ | setup-tenant.sh実行、Gmail設定支援 |
| バグフィックス | 修正・テスト・デプロイ |
| 機能追加 | 開発・テスト・デプロイ |
| アップデート | 各クライアントへのデプロイ |
| ドキュメント | 運用手順書の更新 |

### クライアントの責任

| 項目 | 内容 |
|------|------|
| GCPプロジェクト | 作成・課金管理 |
| マスターデータ | 準備・更新 |
| ユーザー管理 | 許可ユーザーの追加・削除 |
| 日常運用 | 書類処理・エラー対応 |
| Gmail | 監視対象アカウントの管理 |

---

## トラブルシューティング

### デプロイ失敗時

```bash
# ログ確認
firebase functions:log -P client-a

# 再デプロイ
firebase deploy -P client-a
```

### クライアント環境のみで発生する問題

```bash
# 1. クライアント環境のログを確認
firebase functions:log -P client-a

# 2. Firestore データを確認
# Firebase Console > Firestore

# 3. 開発環境で再現テスト
# 必要に応じてSEEDデータを調整
```

---

## 関連ドキュメント

| ドキュメント | 用途 |
|-------------|------|
| docs/operation/setup-guide.md | セットアップ詳細手順 |
| docs/operation/admin-guide.md | 管理者向けガイド |
| docs/operation/user-guide.md | エンドユーザー向けガイド |
| scripts/setup-tenant.sh | セットアップスクリプト |
| scripts/setup-gmail-auth.sh | Gmail認証設定スクリプト |

---

## 過去受信分の巻取り対応

### 概要

クライアント納品時に、Gmail連携開始前の過去受信分を一括インポートする場合がある。
**正式な巻取りスクリプト（`import-historical-gmail.js`）を使用すること。**

### 巻取りスクリプト（推奨）

```bash
# 使用方法
node scripts/import-historical-gmail.js <project-id> --after YYYY-MM-DD --before YYYY-MM-DD [--dry-run]

# 例: 2026年1月のメールを取得（dry-runで確認）
node scripts/import-historical-gmail.js docsplit-kanameone --after 2026-01-01 --before 2026-01-31 --dry-run

# 実行
node scripts/import-historical-gmail.js docsplit-kanameone --after 2026-01-01 --before 2026-01-31
```

**前提条件**:
- `setup-gmail-auth.sh` が完了していること
- アプリ設定画面でGmailアカウントとラベルが設定済みであること

**処理内容**:
1. 指定期間・ラベルのGmailを検索
2. 添付PDFをCloud Storageに保存
3. 正規スキーマでFirestoreにドキュメント作成（`status: pending`）
4. 次回の`processOCR`実行時にOCR処理される

**トラブルシューティング: Storage書き込みエラー**

Application Default Credentials使用時に `billing account disabled` エラーが発生する場合、サービスアカウントキーを使用する：

```bash
# 1. firebase-adminsdkサービスアカウントのキーを作成
gcloud iam service-accounts keys create /tmp/sa-key.json \
  --iam-account=firebase-adminsdk-fbsvc@<project-id>.iam.gserviceaccount.com \
  --project=<project-id>

# 2. Secret Managerアクセス権を付与（初回のみ）
for secret in gmail-oauth-client-id gmail-oauth-client-secret gmail-oauth-refresh-token; do
  gcloud secrets add-iam-policy-binding $secret \
    --project=<project-id> \
    --member="serviceAccount:firebase-adminsdk-fbsvc@<project-id>.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor" --quiet
done

# 3. キーを使用して実行
GOOGLE_APPLICATION_CREDENTIALS=/tmp/sa-key.json node scripts/import-historical-gmail.js <project-id> ...

# 4. 終了後、キーを削除（セキュリティのため）
rm /tmp/sa-key.json
```

### 必須設定: Storage CORS

**重要**: Storage バケットに CORS 設定がないと、ブラウザから PDF を閲覧できない。

```bash
# CORS設定ファイル作成（プロジェクトルートに cors-<alias>.json）
cat > cors-<alias>.json << 'EOF'
[
  {
    "origin": ["https://<project-id>.web.app", "http://localhost:5173", "http://localhost:4173"],
    "method": ["GET", "HEAD"],
    "maxAgeSeconds": 3600,
    "responseHeader": ["Content-Type", "Content-Length", "Content-Disposition"]
  }
]
EOF

# CORS設定を適用
gsutil cors set cors-<alias>.json gs://<project-id>.firebasestorage.app
```

### ドキュメントスキーマの注意点

Firestoreの `documents` コレクションには、以下のフィールドが必須：

| フィールド | 説明 | 例 |
|-----------|------|-----|
| `fileUrl` | Storage URL（gs://形式） | `gs://bucket/path/file.pdf` |
| `fileName` | 表示用ファイル名 | `書類名.pdf` |
| `totalPages` | 総ページ数 | `1` |
| `mimeType` | MIMEタイプ | `application/pdf` |
| `status` | 処理ステータス | `pending`, `completed` |

**よくある問題**: 巻取りスクリプトで以下の別名フィールドを使用すると、フロントエンドで表示できない。

| 誤ったフィールド名 | 正しいフィールド名 |
|-------------------|-------------------|
| `storagePath` | `fileUrl`（gs://形式で保存） |
| `originalFileName` | `fileName` |
| `pageCount` | `totalPages` |

### マイグレーションスクリプト

既存データのフィールド名を修正する場合：

```bash
# dry-run で確認
node scripts/migrate-document-fields.js <project-id> --dry-run

# 実行
node scripts/migrate-document-fields.js <project-id>
```

### Storage パス

ファイルの保存先パスによって、Storage ルールでの許可が必要：

| パス | 用途 | ルールで許可 |
|------|------|-------------|
| `original/` | Gmail取得時の原本 | ✅ |
| `processed/` | OCR処理後 | ✅ |
| `documents/` | 巻取り対応用 | ✅（2026-01-25追加） |

### 巻取り対応チェックリスト

- [ ] Storage CORS 設定完了
- [ ] ドキュメントスキーマ確認（fileUrl, fileName, totalPages）
- [ ] Storage ルールでパス許可確認
- [ ] ブラウザでPDF閲覧テスト

---

## 変更履歴

| 日付 | 内容 |
|------|------|
| 2026-01-25 | 過去受信分の巻取り対応セクション追加 |
| 2026-01-20 | 初版作成 - 納品・アップデートフロー確定 |
