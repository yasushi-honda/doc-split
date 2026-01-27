# セットアップ手順

> **Note**: これはGitHub Pages用の簡略版です。詳細は [docs/operation/setup-guide.md](operation/setup-guide.md) を参照してください。

## 前提条件

- GCPアカウント（請求アカウント設定済み）
- Node.js 22.x
- Firebase CLI (`npm install -g firebase-tools`)
- gcloud CLI

## クイックスタート（自動セットアップ）

### Step 1: リポジトリクローン

```bash
git clone https://github.com/yasushi-honda/doc-split.git
cd doc-split
npm install
```

### Step 2: GCPプロジェクト作成

```bash
# プロジェクト作成
gcloud projects create <project-id> --name="<Project Name>"

# 請求アカウント紐付け
gcloud billing projects link <project-id> --billing-account=<billing-account-id>

# Firebaseプロジェクト追加
firebase projects:addfirebase <project-id>
```

### Step 3: テナントセットアップ実行

```bash
./scripts/setup-tenant.sh <project-id> <admin-email> [gmail-account]
```

**例:**
```bash
./scripts/setup-tenant.sh my-docsplit admin@example.com docs@example.com
```

### Step 4: Gmail認証設定

```bash
./scripts/setup-gmail-auth.sh <project-id>
```

### Step 5: マスターデータ投入（任意）

```bash
node scripts/import-masters.js --all scripts/samples/
```

## 手動セットアップ

自動スクリプトを使わない場合の手順です。

### 1. API有効化

```bash
gcloud services enable \
  cloudfunctions.googleapis.com \
  firestore.googleapis.com \
  storage.googleapis.com \
  pubsub.googleapis.com \
  aiplatform.googleapis.com \
  secretmanager.googleapis.com \
  gmail.googleapis.com \
  cloudscheduler.googleapis.com \
  cloudbuild.googleapis.com \
  --project=<project-id>
```

### 2. Firebase設定

```bash
firebase use <project-id>
```

Firebase Consoleで以下を有効化:
- Authentication（Googleプロバイダー）
- Firestore Database（asia-northeast1）
- Storage

### 3. 環境変数設定

`frontend/.env` を作成:

```env
VITE_FIREBASE_API_KEY=<api-key>
VITE_FIREBASE_AUTH_DOMAIN=<project-id>.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=<project-id>
VITE_FIREBASE_STORAGE_BUCKET=<project-id>.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=<sender-id>
VITE_FIREBASE_APP_ID=<app-id>
```

Firebase Consoleのプロジェクト設定から取得。

### 4. セキュリティルールデプロイ

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage
```

### 5. Cloud Functionsデプロイ

```bash
cd functions
npm run build
cd ..
firebase deploy --only functions
```

### 6. Hostingデプロイ

```bash
npm run build
firebase deploy --only hosting
```

### 7. 管理者ユーザー登録

```bash
node scripts/add-admin-user.js <admin-email>
```

## Gmail認証設定（詳細）

### OAuth 2.0 クライアントID作成

1. [GCP Console - 認証情報](https://console.cloud.google.com/apis/credentials) にアクセス
2. 「認証情報を作成」→「OAuth クライアント ID」
3. アプリケーションの種類: 「デスクトップアプリ」
4. 名前: 「DocSplit Gmail」
5. 作成後、Client IDとClient Secretをメモ

### OAuth同意画面設定

1. [OAuth同意画面](https://console.cloud.google.com/apis/credentials/consent) にアクセス
2. User Type: 「内部」または「外部」
3. アプリ名、サポートメールを入力
4. スコープ追加: `https://www.googleapis.com/auth/gmail.readonly`

### リフレッシュトークン取得

`setup-gmail-auth.sh` を実行するか、手動で:

1. 認証URL生成
2. ブラウザでアクセス、Googleログイン
3. 認証コード取得
4. トークンエンドポイントでリフレッシュトークン取得

### Secret Manager保存

```bash
# Client ID
echo -n "<client-id>" | gcloud secrets create gmail-oauth-client-id --data-file=-

# Client Secret
echo -n "<client-secret>" | gcloud secrets create gmail-oauth-client-secret --data-file=-

# Refresh Token
echo -n "<refresh-token>" | gcloud secrets create gmail-oauth-refresh-token --data-file=-
```

## 確認事項

| 項目 | 確認方法 |
|------|----------|
| アプリアクセス | `https://<project-id>.web.app` |
| Googleログイン | 管理者メールでログイン |
| Firestore | Firebase Console |
| Functions | `firebase functions:log` |
| Gmail連携 | 設定ページのステータス |
