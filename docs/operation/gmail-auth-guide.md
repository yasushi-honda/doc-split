# DocSplit Gmail認証設定ガイド

DocSplitはGmailの添付ファイルを自動取得するため、Gmail API認証の設定が必要です。
クライアント環境に応じて適切な認証方式を選択してください。

## 認証方式の選択

```
┌─────────────────────────────────────────────────┐
│ クライアントはGoogle Workspaceを使用していますか？ │
└─────────────────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
       YES                      NO
        │                       │
        ▼                       ▼
┌───────────────────┐   ┌───────────────────┐
│ Service Account   │   │ OAuth 2.0方式     │
│ + Domain-wide     │   │                   │
│ Delegation方式    │   │ 無料Gmailアカウント│
│                   │   │ 向け              │
│ 【推奨】          │   │                   │
└───────────────────┘   └───────────────────┘
```

### 比較表

| 項目 | OAuth 2.0 | Service Account |
|------|-----------|-----------------|
| 対象 | 無料Gmail、個人アカウント | Google Workspace |
| セキュリティ | 個人の認証情報に依存 | 組織管理下で安全 |
| トークン更新 | 定期的に必要な場合あり | 不要（自動） |
| 管理者設定 | 不要 | Admin Console設定が必要 |
| **推奨度** | 開発・検証環境向け | **本番環境推奨** |

---

## 方式1: OAuth 2.0（無料Gmailアカウント向け）

### 概要
個人のGmailアカウントを使用する場合の認証方式です。
OAuth 2.0フローでリフレッシュトークンを取得し、Secret Managerに保存します。

### セットアップ手順

#### 1. OAuth同意画面の設定

1. [GCP Console](https://console.cloud.google.com) > APIs & Services > OAuth consent screen
2. User Type: 「外部」を選択
3. アプリ情報を入力:
   - アプリ名: DocSplit
   - ユーザーサポートメール: 管理者メールアドレス
4. スコープを追加: `https://www.googleapis.com/auth/gmail.readonly`
5. テストユーザーに監視対象のGmailアドレスを追加

#### 2. OAuth クライアントIDの作成

1. GCP Console > APIs & Services > Credentials
2. 「認証情報を作成」→「OAuth クライアント ID」
3. アプリケーションの種類: 「デスクトップアプリ」
4. 作成後、クライアントIDとシークレットをメモ

#### 3. セットアップスクリプトの実行

```bash
./scripts/setup-gmail-auth.sh <project-id>
```

スクリプトが以下を実行します:
- OAuth認証フロー（ブラウザで認証）
- リフレッシュトークンの取得
- Secret Managerへの保存
- Cloud Functionsへの権限付与

#### 4. Firestore設定の更新

アプリの設定画面、または Firebase Console で設定:

**Collection**: `settings`
**Document**: `gmail`

```json
{
  "authMode": "oauth",
  "oauthClientId": "<your-client-id>"
}
```

**Collection**: `settings`
**Document**: `app`

```json
{
  "gmailAccount": "<your-gmail@gmail.com>"
}
```

### 注意事項

- リフレッシュトークンは長期間有効ですが、以下の場合に無効化されます:
  - ユーザーがアクセス権を取り消した場合
  - 6ヶ月間使用されなかった場合
  - パスワード変更時
- トークンが無効になった場合は、再度セットアップスクリプトを実行してください

---

## 方式2: Service Account + Domain-wide Delegation（Google Workspace向け）

### 概要
Google Workspaceの管理下にあるGmailアカウントを監視する場合の認証方式です。
Service Accountに対してドメイン全体の委任（Domain-wide Delegation）を設定します。

**本番環境では推奨される方式です。**

### セットアップ手順

#### 1. Google Workspace要件の確認

- Google Workspace管理者権限が必要
- Admin Console（admin.google.com）へのアクセス権限

#### 2. セットアップスクリプトの実行

```bash
./scripts/setup-gmail-service-account.sh <project-id> <delegated-email>
```

例:
```bash
./scripts/setup-gmail-service-account.sh my-project-prod admin@company.com
```

#### 3. Admin Consoleでの設定

スクリプト実行中に表示される手順に従い、Admin Consoleで設定:

1. https://admin.google.com にアクセス
2. 「セキュリティ」→「アクセスとデータ管理」→「APIの制御」→「ドメイン全体の委任」
3. 「新しく追加」をクリック
4. 以下を入力:
   - **クライアントID**: スクリプトが表示するService AccountのユニークID
   - **OAuthスコープ**: `https://www.googleapis.com/auth/gmail.readonly`
5. 「承認」をクリック

#### 4. Firestore設定の確認

スクリプトが自動で設定しますが、以下を確認:

**Collection**: `settings`
**Document**: `gmail`

```json
{
  "authMode": "service_account",
  "delegatedUserEmail": "<監視対象メール>",
  "serviceAccountEmail": "gmail-reader@<project-id>.iam.gserviceaccount.com"
}
```

### セキュリティ上の利点

- 個人の認証情報に依存しない
- トークンの手動更新が不要
- 組織の管理下で権限を制御可能
- 退職者のアカウント影響を受けない

---

## デプロイと動作確認

### Cloud Functionsの再デプロイ

設定完了後、Cloud Functionsを再デプロイ:

```bash
firebase deploy --only functions --project <project-id>
```

### 動作確認

1. Firebase Console > Functions > checkGmailAttachments > Logs を確認
2. 以下のログが表示されれば成功:
   - OAuth方式: `Using OAuth 2.0 authentication (development mode)`
   - Service Account方式: `Using Service Account + Delegation (production mode)`

### 手動実行

Cloud Schedulerから手動実行:

1. GCP Console > Cloud Scheduler
2. `firebase-schedule-checkGmailAttachments-...` を選択
3. 「今すぐ実行」

---

## トラブルシューティング

### OAuth方式: 認証エラー

**エラー**: `Error: invalid_grant`

**原因**: リフレッシュトークンが無効

**解決**:
```bash
./scripts/setup-gmail-auth.sh <project-id>
```

### Service Account方式: 403 Forbidden

**エラー**: `Error: Delegation denied for <email>`

**原因**: Domain-wide Delegationが正しく設定されていない

**解決**:
1. Admin Consoleで設定を確認
2. クライアントIDが正しいか確認
3. スコープが正確に入力されているか確認
4. 設定後、数分待ってから再試行

### 共通: Gmail API not enabled

**エラー**: `Error: Gmail API has not been used in project...`

**解決**:
```bash
gcloud services enable gmail.googleapis.com --project=<project-id>
```

---

## 関連ドキュメント

- [セットアップガイド](./setup-guide.md)
- [管理者ガイド](./admin-guide.md)
- [ADR-0003: 認証設計](../adr/0003-authentication-design.md)
