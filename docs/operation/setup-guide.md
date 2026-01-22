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

### クライアント移行時の重要ポイント

クライアント環境へのデプロイ時に発生しやすい問題と対策:

#### 根本原因パターン（共通）

以下の問題は共通して「仕様の唯一の参照元がない」「環境差分のガード不足」「実装と運用手順の乖離」が原因:

| 原因カテゴリ | 説明 |
|-------------|------|
| **暗黙知依存** | 手順が明文化されておらず、推測・手作業で実行 |
| **命名不一致** | コレクションパス等が複数表記で統一されていない |
| **環境差分の見える化不足** | 本番/検証の区別がガードされていない |
| **実装仕様との乖離** | 運用手順が実際のコード仕様と一致していない |

#### 1. `.env.local` の優先順位問題

**症状**: 別環境用に `.env` を更新してもビルドに反映されない

**原因**: Vite は `.env.local` を `.env` より優先して読み込む

**解決策**:
```bash
# デプロイ対象の環境設定を .env.local にコピー
cp frontend/.env.<環境名> frontend/.env.local

# ビルド
cd frontend && rm -rf dist && npm run build

# デプロイ後、開発用設定を復元
cp frontend/.env.dev frontend/.env.local
```

**ベストプラクティス**: 環境ごとに `.env.<環境名>` ファイルを管理し、デプロイ時に `.env.local` を切り替える

#### 2. 管理者ユーザー登録のコレクション・ID問題

**症状**: `User not whitelisted` エラーでログインできない

**原因**: ユーザー登録先が間違っている
- 誤: `allowedUsers` コレクションに `email` をドキュメントIDとして登録
- 正: `users` コレクションに `Firebase Auth UID` をドキュメントIDとして登録

**解決策**:
```bash
# Firebase Auth からUIDを取得して正しく登録
npx ts-node -e "
const admin = require('firebase-admin');
admin.initializeApp({ projectId: '<project-id>' });

(async () => {
  const email = '<admin-email>';
  const userRecord = await admin.auth().getUserByEmail(email);
  console.log('UID:', userRecord.uid);

  const db = admin.firestore();
  await db.collection('users').doc(userRecord.uid).set({
    email: email,
    displayName: userRecord.displayName || email.split('@')[0],
    role: 'admin',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  console.log('Registered successfully');
  process.exit(0);
})();
"
```

**注意**: ユーザーが一度Googleログインを試行した後でないと Firebase Auth にユーザーレコードが作成されない

#### 3. auth/unauthorized-domain エラー

**症状**: Googleログイン時に `auth/unauthorized-domain` エラー

**確認ポイント**:
1. Firebase Console → Authentication → Settings → Authorized domains に `<project-id>.web.app` が追加されているか
2. GCP Console → APIs & Services → Credentials → OAuth 2.0 Client IDs → "Web client (auto created by Google Service)" に以下が設定されているか:
   - Authorized JavaScript origins: `https://<project-id>.web.app`
   - Authorized redirect URIs: `https://<project-id>.web.app/__/auth/handler`

**CLIでの確認**:
```bash
ACCESS_TOKEN=$(gcloud auth print-access-token)
curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "X-Goog-User-Project: <project-id>" \
  "https://identitytoolkit.googleapis.com/admin/v2/projects/<project-id>/config" \
  | jq '.authorizedDomains'
```

#### 4. OAuth 2.0 の `urn:ietf:wg:oauth:2.0:oob` 非推奨化

**症状**: OAuth認証コード取得時に `redirect_uri_mismatch` エラー

**原因**: 2022年以降に作成されたOAuthクライアントでは `oob` リダイレクトURIが使用不可

**解決策**: ローカルサーバーを使用してコールバックを受け取る
```bash
# http://localhost:8080 をリダイレクトURIとして設定
# ローカルサーバーで認証コードを受け取る
```

#### 5. 本番環境へのサンプルデータ投入

**症状**: クライアント本番環境にテスト用のサンプルデータが入ってしまう

**原因**: セットアップ時に「サンプルデータでテスト」を選択

**予防策**:
- 本番環境セットアップ時は「マスターデータなし」を選択
- クライアントから実際のマスターデータCSVを受領してから投入
- 開発/検証環境のみサンプルデータを使用

**確認方法**:
```bash
# Firestoreのマスターデータコレクションを確認
# 注意: マスターデータは masters/{type}/items サブコレクションに保存
cd functions && GCLOUD_PROJECT="<project-id>" npx ts-node -e "
const admin = require('firebase-admin');
admin.initializeApp({ projectId: '<project-id>' });
const db = admin.firestore();
(async () => {
  const paths = [
    'masters/customers/items',
    'masters/documents/items',      // 書類種別
    'masters/offices/items',
    'masters/caremanagers/items'    // 小文字
  ];
  for (const path of paths) {
    const snap = await db.collection(path).get();
    console.log(path + ': ' + snap.size + '件');
  }
  process.exit(0);
})();
"
```

**削除方法**:
```bash
# 各サブコレクションを削除（バッチ削除）
cd functions && GCLOUD_PROJECT="<project-id>" npx ts-node -e "
const admin = require('firebase-admin');
admin.initializeApp({ projectId: '<project-id>' });
const db = admin.firestore();
async function deleteSubcollection(path: string) {
  const snap = await db.collection(path).get();
  if (snap.empty) { console.log(path + ': 0件'); return; }
  const batch = db.batch();
  snap.docs.forEach((doc: any) => batch.delete(doc.ref));
  await batch.commit();
  console.log(path + ': ' + snap.size + '件削除');
}
(async () => {
  await deleteSubcollection('masters/customers/items');
  await deleteSubcollection('masters/documents/items');      // 書類種別
  await deleteSubcollection('masters/offices/items');
  await deleteSubcollection('masters/caremanagers/items');   // 小文字
  process.exit(0);
})();
"
```

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

## クライアント移行チェックリスト

移行作業の前後で必ず確認すること:

### 移行前

- [ ] 本番環境では「サンプルデータ投入」を**禁止**（検証環境のみ許可）
- [ ] `.env.local` の有無と内容を確認
- [ ] デプロイ対象の環境変数が正しいか確認
- [ ] マスターパス一覧を確認:
  - `masters/customers/items`
  - `masters/documents/items`（documentTypesではない）
  - `masters/offices/items`
  - `masters/caremanagers/items`（小文字）

### 移行後

- [ ] マスターデータ件数を確認（本番は0件のはず）
- [ ] 管理者ユーザーが `users` コレクションにUID登録されているか
- [ ] ログインできるか確認
- [ ] 各画面が正常に表示されるか確認

### マスター正規パス一覧

| マスター種別 | Firestoreパス | 注意点 |
|-------------|---------------|--------|
| 顧客 | `masters/customers/items` | - |
| 書類種別 | `masters/documents/items` | `documentTypes`ではない |
| 事業所 | `masters/offices/items` | - |
| ケアマネ | `masters/caremanagers/items` | 小文字（`careManagers`ではない） |

## 関連ドキュメント

- [ユーザーガイド](./user-guide.md)
- [管理者ガイド](./admin-guide.md)
- [データモデル](../context/data-model.md)
- [エラーハンドリングポリシー](../context/error-handling-policy.md)
