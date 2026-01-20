# DocSplit セットアップガイド

このドキュメントは、新しい環境に DocSplit をセットアップする手順を説明します。

## 前提条件

- GCP プロジェクト（請求アカウント設定済み）
- Firebase プロジェクト（GCP プロジェクトに連携）
- Node.js 22.x
- npm または pnpm
- Firebase CLI (`npm install -g firebase-tools`)

## 1. リポジトリのクローン

```bash
git clone https://github.com/yasushi-honda/doc-split.git
cd doc-split
```

## 2. 依存関係のインストール

```bash
npm install
```

## 3. Firebase プロジェクトの初期化

### 3.1 Firebase ログイン

```bash
firebase login
```

### 3.2 プロジェクトの選択

```bash
firebase use <your-project-id>
```

### 3.3 必要なサービスの有効化

Firebase Console で以下を有効化:

- Authentication（Google プロバイダー）
- Firestore Database
- Storage
- Hosting
- Functions

GCP Console で以下の API を有効化:

```bash
gcloud services enable \
  cloudfunctions.googleapis.com \
  firestore.googleapis.com \
  storage.googleapis.com \
  pubsub.googleapis.com \
  aiplatform.googleapis.com \
  secretmanager.googleapis.com \
  gmail.googleapis.com
```

## 4. 環境設定

### 4.1 フロントエンド環境変数

`frontend/.env.local` を作成:

```env
VITE_FIREBASE_API_KEY=<your-api-key>
VITE_FIREBASE_AUTH_DOMAIN=<your-project-id>.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=<your-project-id>
VITE_FIREBASE_STORAGE_BUCKET=<your-project-id>.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=<your-sender-id>
VITE_FIREBASE_APP_ID=<your-app-id>
```

Firebase Console > プロジェクト設定 > アプリ > Firebase SDK snippet から取得。

### 4.2 Gmail 認証設定

クライアント環境に応じて適切な認証方式を選択してください。
詳細は [Gmail認証設定ガイド](./gmail-auth-guide.md) を参照。

| クライアント環境 | 認証方式 | セットアップスクリプト |
|----------------|---------|---------------------|
| 無料Gmail / 個人アカウント | OAuth 2.0 | `setup-gmail-auth.sh` |
| Google Workspace | Service Account + Delegation | `setup-gmail-service-account.sh` |

**方式1: OAuth 2.0（無料Gmail向け）**

```bash
./scripts/setup-gmail-auth.sh <project-id>
```

**方式2: Service Account（Google Workspace向け）【本番推奨】**

```bash
./scripts/setup-gmail-service-account.sh <project-id> <監視対象メール>
```

> **注意**: Google Workspaceの場合は Admin Console での Domain-wide Delegation 設定が必要です。

## 5. Firestore セットアップ

### 5.1 セキュリティルールのデプロイ

```bash
firebase deploy --only firestore:rules
```

### 5.2 インデックスのデプロイ

```bash
firebase deploy --only firestore:indexes
```

### 5.3 マスターデータのインポート

CSVファイルを `scripts/samples/` に配置:

- `customers.csv`: 顧客マスター
- `documents.csv`: 書類マスター
- `offices.csv`: 事業所マスター
- `caremanagers.csv`: ケアマネマスター

```bash
node scripts/import-masters.js
```

## 6. Storage セットアップ

### 6.1 Firebase Storage の初期化

Firebase Console > Storage > Get Started

### 6.2 セキュリティルールのデプロイ

```bash
firebase deploy --only storage
```

## 7. デプロイ

### 7.1 フロントエンドのビルド

```bash
cd frontend
npm run build
cd ..
```

### 7.2 全体デプロイ

```bash
firebase deploy
```

個別デプロイ:

```bash
# Hosting のみ
firebase deploy --only hosting

# Functions のみ
firebase deploy --only functions

# Firestore ルールのみ
firebase deploy --only firestore:rules
```

## 8. 初期設定

### 8.1 管理者ユーザーの追加

Firestore Console で `/users` コレクションに追加:

```json
{
  "email": "admin@example.com",
  "role": "admin",
  "createdAt": "<timestamp>"
}
```

### 8.2 Gmail 設定

管理者でログイン後、設定画面から:

1. 監視ラベルを設定
2. 監視アカウントを設定

## 9. 動作確認

### 9.1 ログイン確認

1. `https://<your-project-id>.web.app` にアクセス
2. 管理者アカウントでログイン

### 9.2 書類一覧確認

1. 書類一覧画面が表示される
2. 統計カードが表示される

### 9.3 Functions 動作確認

Firebase Console > Functions > Logs で確認

## トラブルシューティング

### デプロイエラー: Functions

```
Error: functions/lib/index.js does not exist
```

**解決:**
```bash
cd functions
npm run build
cd ..
firebase deploy --only functions
```

### 認証エラー

```
Error: Permission denied
```

**解決:**
1. Firestore ルールを確認
2. ユーザーがホワイトリストに登録されているか確認

### Gmail API エラー

```
Error: Gmail API not enabled
```

**解決:**
```bash
gcloud services enable gmail.googleapis.com
```

## 関連ドキュメント

- [ユーザーガイド](./user-guide.md)
- [管理者ガイド](./admin-guide.md)
- [データモデル](../context/data-model.md)
- [エラーハンドリングポリシー](../context/error-handling-policy.md)
