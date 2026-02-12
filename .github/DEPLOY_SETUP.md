# GitHub Actions デプロイセットアップ手順

## 概要

このリポジトリはGitHub Actionsを使用してCloud Functionsを自動デプロイします。
組織ポリシー制約に対応するため、カスタムCloud Buildサービスアカウントを使用します。

## 前提条件

- GCPプロジェクトにカスタムCloud Buildサービスアカウントが作成済み
- 必要な権限が付与済み

## GitHub Secrets セットアップ

### 1. サービスアカウントキーの登録

1. GitHub リポジトリの Settings → Secrets and variables → Actions に移動
2. "New repository secret" をクリック
3. 以下のSecretを作成：

#### GCP_SA_KEY

```
Name: GCP_SA_KEY
Value: （サービスアカウントキーのBase64エンコード文字列）
```

**キーの取得方法**:
```bash
# サービスアカウントキーを生成
gcloud iam service-accounts keys create sa-key.json \
  --iam-account=docsplit-cloud-build@PROJECT_ID.iam.gserviceaccount.com

# Base64エンコード
base64 -i sa-key.json | tr -d '\n'

# 出力された文字列をGCP_SA_KEYに設定
```

**セキュリティ注意**:
- ローカルのsa-key.jsonは設定後すぐに削除すること
- Base64文字列も安全に管理すること

### 2. Firebase Tokenの登録（オプション）

```
Name: FIREBASE_TOKEN
Value: （gcloud auth print-access-token の出力）
```

**注意**: FIREBASE_TOKENは短命なので、GCP_SA_KEYのみでの認証を推奨

## デプロイ方法

### 自動デプロイ（mainブランチへのpush）

`functions/**` 配下のファイルを変更してmainブランチにpushすると自動デプロイされます。

```bash
git add functions/
git commit -m "feat: 新しいFunctionを追加"
git push origin main
```

### 手動デプロイ

GitHub リポジトリの Actions タブから手動実行できます：

1. Actions → "Deploy Cloud Functions" を選択
2. "Run workflow" をクリック
3. デプロイ先環境を選択（dev/kanameone/cocoro）
4. "Run workflow" を実行

## トラブルシューティング

### デプロイが失敗する場合

1. **権限不足エラー**
   - サービスアカウントに必要な権限が付与されているか確認
   ```bash
   gcloud projects get-iam-policy PROJECT_ID \
     --flatten="bindings[].members" \
     --filter="bindings.members:docsplit-cloud-build@PROJECT_ID.iam.gserviceaccount.com"
   ```

2. **認証エラー**
   - GitHub SecretsのGCP_SA_KEYが正しく設定されているか確認
   - Base64エンコードに改行が含まれていないか確認

3. **ビルドエラー**
   - functions/package.jsonの依存関係を確認
   - ローカルで `npm run build` が成功するか確認

## 環境別デプロイ

`.firebaserc` で定義された環境にデプロイできます：

- `dev`: doc-split-dev（開発環境）
- `kanameone`: docsplit-kanameone
- `cocoro`: docsplit-cocoro

## セキュリティベストプラクティス

1. ✅ カスタムサービスアカウント使用
2. ✅ 最小権限の原則
3. ✅ サービスアカウントキーの安全な管理
4. ✅ CI/CD環境での自動デプロイ
5. ❌ デフォルトサービスアカウントは使用しない

## 参考資料

- [Deploy to Firebase | Cloud Build](https://docs.cloud.google.com/build/docs/deploying-builds/deploy-firebase)
- [GitHub Actions for Google Cloud](https://github.com/google-github-actions)
