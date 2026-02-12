# GCPコンソール手動セットアップガイド

## この手順書を使用する場面

以下のいずれかに該当する場合は、この手動手順を実施してください。

- 自動セットアップスクリプトが動作しない
- 企業ポリシーでスクリプト実行が禁止されている
- コマンドライン操作に不慣れで、GUIでの作業を希望する

すべての手順はGCPコンソール（Webブラウザ）で完結します。コマンド入力は不要です。

---

## Step 1: GCPコンソールアクセス + プロジェクト作成

<div class="step-card">

### 1-1. プロジェクト作成画面を開く

以下のURLをブラウザで開いてください。

```
https://console.cloud.google.com/projectcreate
```

Googleアカウントでログインしていない場合は、ログイン画面が表示されます。

### 1-2. プロジェクト情報を入力

| 項目 | 入力内容 |
|------|----------|
| **プロジェクト名** | `DocSplit` |
| **プロジェクトID** | 「編集」をクリックして手入力<br>例: `docsplit-abc-kaigo` |
| **組織** | 表示されている場合はそのまま（変更不要） |

**プロジェクトIDの命名規則**:
- 小文字・数字・ハイフン（`-`）のみ使用可能
- 6-30文字
- 推奨形式: `docsplit-{会社名略称}-{事業所名}`
- 例: `docsplit-yamada-honbu`、`docsplit-suzuki-kaigo`

<div class="warning-box">

**重要**: プロジェクトIDは作成後に変更できません。慎重に決定してください。

</div>

### 1-3. プロジェクトを作成

「作成」ボタンをクリックします。1-2分で作成が完了します。

</div>

---

## Step 2: 課金の有効化

<div class="step-card">

### 2-1. 課金設定画面を開く

以下のURLを開いてください（`PROJECT_ID`を実際のプロジェクトIDに置き換える）。

```
https://console.cloud.google.com/billing/linkedaccount?project=PROJECT_ID
```

例: プロジェクトIDが`docsplit-abc-kaigo`の場合
```
https://console.cloud.google.com/billing/linkedaccount?project=docsplit-abc-kaigo
```

### 2-2-A. 課金アカウントが既にある場合

1. ドロップダウンから既存の課金アカウントを選択
2. 「アカウントを設定」ボタンをクリック

### 2-2-B. 課金アカウントが無い場合（初めてGCPを利用）

1. 以下のURLで課金アカウントを作成:
   ```
   https://console.cloud.google.com/billing/create
   ```

2. クレジットカード情報を入力
   - 国/地域: 日本
   - カード番号、有効期限、セキュリティコード
   - 請求先住所

3. 「開始」ボタンをクリック

4. 作成完了後、Step 2-1の画面に戻り、新しい課金アカウントを選択

<div class="info-box">

**無料トライアル**: 初めてGCPを利用する場合、$300分の無料クレジットが付与されます（90日間有効）。

</div>

</div>

---

## Step 3: 開発者への権限付与

<div class="step-card">

### 3-1. IAM画面を開く

以下のURLを開いてください（`PROJECT_ID`を実際のプロジェクトIDに置き換える）。

```
https://console.cloud.google.com/iam-admin/iam?project=PROJECT_ID
```

### 3-2. 開発者にオーナー権限を付与

1. 画面上部の「**アクセスを許可**」ボタンをクリック

2. 以下の情報を入力:
   - **新しいプリンシパル**: 開発者のメールアドレス（`@example.com`形式）
   - **ロールを選択**: 「基本」→「**オーナー**」を選択

3. 「**保存**」ボタンをクリック

### 3-3. エラーが発生した場合

以下のようなエラーが表示された場合は、**Step 4に進んでください**。

```
組織のポリシーにより、外部ドメインのユーザーを追加できません
```

エラーが出なかった場合は、**Step 4をスキップ**して「完了確認」に進んでください。

</div>

---

## Step 4: 組織ポリシー対応（エラーが出た場合のみ）

<div class="warning-box">

**このステップが必要なケース**: Step 3で「組織のポリシー」エラーが表示された場合のみ実施してください。

</div>

### Step 4a: 組織ポリシーの緩和

<div class="step-card">

#### 4a-1. ドメイン制限を緩和

1. 以下のURLを開く（`PROJECT_ID`を置き換える）:
   ```
   https://console.cloud.google.com/iam-admin/orgpolicies/iam-allowedPolicyMemberDomains?project=PROJECT_ID
   ```

2. 「**ポリシーを管理**」ボタンをクリック

3. 「**ルール**」セクションで「**ルールを追加**」をクリック

4. 「**すべて許可**」を選択

5. 「**ポリシーを設定**」ボタンをクリック

#### 4a-2. サービスアカウントキー作成を許可

1. 以下のURLを開く（`PROJECT_ID`を置き換える）:
   ```
   https://console.cloud.google.com/iam-admin/orgpolicies/iam-disableServiceAccountKeyCreation?project=PROJECT_ID
   ```

2. 「**ポリシーを管理**」→「**ルールを追加**」

3. 「**オフ**」を選択

4. 「**ポリシーを設定**」ボタンをクリック

<div class="info-box">

ポリシー反映には1-2分かかることがあります。次のステップに進む前に少しお待ちください。

</div>

</div>

### Step 4b: サービスアカウントの作成

<div class="step-card">

#### 4b-1. サービスアカウント作成画面を開く

```
https://console.cloud.google.com/iam-admin/serviceaccounts?project=PROJECT_ID
```

#### 4b-2. サービスアカウントを作成

1. 「**サービスアカウントを作成**」ボタンをクリック

2. サービスアカウント情報を入力:
   - **サービスアカウント名**: `docsplit-deployer`
   - **説明**: `DocSplit deployment and maintenance`

3. 「**作成して続行**」ボタンをクリック

4. ロールを選択:
   - 「**基本**」→「**オーナー**」を選択

5. 「**完了**」ボタンをクリック

</div>

### Step 4c: JSONキーの生成

<div class="step-card">

#### 4c-1. キー作成画面を開く

1. サービスアカウント一覧で `docsplit-deployer@PROJECT_ID.iam.gserviceaccount.com` をクリック

2. 「**キー**」タブをクリック

3. 「**鍵を追加**」→「**新しい鍵を作成**」を選択

#### 4c-2. JSONキーをダウンロード

1. キーのタイプ: **JSON**を選択

2. 「**作成**」ボタンをクリック

3. JSONファイルが自動的にダウンロードされます

<div class="warning-box">

**セキュリティ重要事項**:
- ダウンロードしたJSONファイルは安全な場所に保管してください
- このファイルがあれば誰でもプロジェクトに完全なアクセスが可能になります
- 開発者への送付時は、パスワード付きZIPや暗号化メール等で保護してください

</div>

#### 4c-3. 情報を開発者に送付

以下の情報を開発者に連絡してください:

- **プロジェクトID**: `docsplit-xxx-xxx`（Step 1で作成したID）
- **サービスアカウントキー**: ダウンロードしたJSONファイル（暗号化必須）

</div>

---

## 完了確認

以下のURLで正常に画面が表示されれば、セットアップ完了です。

### ダッシュボードが表示されるか確認

```
https://console.cloud.google.com/home/dashboard?project=PROJECT_ID
```

### 課金が有効になっているか確認

```
https://console.cloud.google.com/billing/linkedaccount?project=PROJECT_ID
```

「請求先アカウント」に課金アカウント名が表示されていればOKです。

---

## トラブルシューティング

問題が発生した場合は、[トラブルシューティングガイド](troubleshooting.md)を参照してください。

---

## 次のステップ

セットアップ完了後、開発者が以下の作業を実施します:

1. Firebase/Cloud Storageなど必要なサービスの有効化
2. アプリケーションのデプロイ
3. 初期管理者アカウントの作成

所要時間: 約10-15分

完了後、アクセス用のURLとログイン情報が送付されます。

---

[← 概要に戻る](client-setup.md)
