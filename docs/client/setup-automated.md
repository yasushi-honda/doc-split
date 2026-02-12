# 自動セットアップガイド（導入作業者向け）

このドキュメントは、スクリプトを使った自動セットアップ手順を説明します。

<div class="info-box">

**対象読者**: クライアント側の導入作業者（IT担当者・システム管理者）

**所要時間**: 約10分（gcloud CLIのインストール済みの場合は5分）

</div>

---

## 前提条件

- Googleアカウント（GCPの管理権限あり）
- インターネット接続
- ターミナル（Mac/Linux）またはPowerShell（Windows）の基本操作

---

## Step 1: gcloud CLIのインストール

スクリプト実行にはGoogle Cloud CLIが必要です。既にインストール済みの場合はStep 2へ。

### Mac

<div class="step-card">

**ARM64 Mac（M1/M2/M3）の場合**

```bash
# ダウンロード
curl -o /tmp/google-cloud-cli.tar.gz https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-darwin-arm.tar.gz

# 展開＆インストール
tar -xzf /tmp/google-cloud-cli.tar.gz -C $HOME
$HOME/google-cloud-sdk/install.sh --quiet --path-update true

# ターミナルを再起動後、確認
gcloud --version
```

**Intel Macの場合（上記でエラーが出た場合）**

```bash
# ダウンロード
curl -o /tmp/google-cloud-cli.tar.gz https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-darwin-x86_64.tar.gz

# 展開＆インストール
tar -xzf /tmp/google-cloud-cli.tar.gz -C $HOME
$HOME/google-cloud-sdk/install.sh --quiet --path-update true

# ターミナルを再起動後、確認
gcloud --version
```

</div>

<div class="warning-box">

**Homebrewでのインストールは非推奨**: バージョン管理の問題が発生する可能性があります。上記の公式インストーラーを使用してください。

</div>

### Windows

<div class="step-card">

**PowerShellで実行（管理者権限不要）**

```powershell
# インストーラーをダウンロード＆実行
(New-Object Net.WebClient).DownloadFile("https://dl.google.com/dl/cloudsdk/channels/rapid/GoogleCloudSDKInstaller.exe", "$env:TEMP\GoogleCloudSDKInstaller.exe")
& "$env:TEMP\GoogleCloudSDKInstaller.exe"
```

または、公式サイトからインストーラーをダウンロード:
https://cloud.google.com/sdk/docs/install-sdk#windows

インストール後、PowerShellを再起動して確認:

```powershell
gcloud --version
```

</div>

### Linux

<div class="step-card">

```bash
# インストール
curl https://sdk.cloud.google.com | bash

# シェルを再起動
exec -l $SHELL

# 確認
gcloud --version
```

</div>

---

## Step 2: セットアップスクリプトのダウンロードと実行

### Mac（推奨: 3行コピペ方式）

<div class="step-card">

ターミナルで以下を実行:

```bash
curl -O https://raw.githubusercontent.com/yasushi-honda/doc-split/main/scripts/client-setup-gcp.sh
chmod +x client-setup-gcp.sh
./client-setup-gcp.sh
```

</div>

### Mac（ダブルクリック方式）

<div class="step-card">

ターミナルで以下を実行してダウンロード:

```bash
curl -O https://raw.githubusercontent.com/yasushi-honda/doc-split/main/scripts/client-setup-gcp.command
curl -O https://raw.githubusercontent.com/yasushi-honda/doc-split/main/scripts/client-setup-gcp.sh
chmod +x client-setup-gcp.command client-setup-gcp.sh
```

Finderで `client-setup-gcp.command` をダブルクリックして実行。

</div>

<div class="warning-box">

**Gatekeeperの警告が出る場合**: 右クリック → 「開く」を選択、または[トラブルシューティング](troubleshooting.md#macでスクリプトが実行できない)を参照。

</div>

### Windows

<div class="step-card">

PowerShellで以下を実行:

```powershell
# ダウンロード
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/yasushi-honda/doc-split/main/scripts/client-setup-gcp.bat" -OutFile "client-setup-gcp.bat"

# 実行
.\client-setup-gcp.bat
```

</div>

### Linux

<div class="step-card">

```bash
curl -O https://raw.githubusercontent.com/yasushi-honda/doc-split/main/scripts/client-setup-gcp.sh
chmod +x client-setup-gcp.sh
./client-setup-gcp.sh
```

</div>

---

## Step 3: スクリプト実行中の操作

スクリプトは以下のステップを自動実行します。各ステップで必要な操作を行ってください。

### Step 0: 環境確認・認証

<div class="step-card">

**何が起こるか**:
- gcloud CLIの存在チェック（未インストールなら自動インストール試行）
- 未認証の場合、ブラウザが自動で開く

**あなたがすること**:
1. ブラウザでGoogleアカウントにログイン
2. 「許可」をクリック
3. ターミナルに戻る（自動で次のステップへ）

</div>

### Step 1: プロジェクト情報入力

<div class="step-card">

**プロジェクトID**を入力:

```
例: docsplit-abc-kaigo
例: docsplit-yamada-home
```

<div class="info-box">

**命名規則の推奨**:
- 形式: `docsplit-{会社名略称}-{事業所名}`
- 制約: 小文字・数字・ハイフン、6-30文字
- グローバルで一意である必要があります（既存のものと重複不可）

</div>

**開発者メールアドレス**を入力:
- 開発者から事前に受領したメールアドレス（例: `developer@example.com`）

確認画面で `y` を入力。

</div>

### Step 2: プロジェクト作成

<div class="step-card">

**自動実行内容**:
- `gcloud projects create` が実行される
- 30秒程度待機（進行状況が表示されます）

**あなたがすること**: 何もありません（自動で完了）

</div>

### Step 3: 課金アカウント紐付け

<div class="step-card">

**課金アカウントの選択**:

スクリプトが利用可能な課金アカウント一覧を表示します。

```
利用可能な課金アカウント:
  0A0B0C-1D2E3F-4G5H6I  会社名 - 請求先アカウント
  9X8Y7Z-6W5V4U-3T2S1R  別の請求先アカウント
```

課金アカウントID（`0A0B0C-1D2E3F-4G5H6I`形式）をコピーして入力。

</div>

<div class="warning-box">

**課金アカウントが無い場合**:

GCPコンソールで先に課金アカウントを作成してください:
https://console.cloud.google.com/billing/create

作成後、スクリプトを再実行してください。

</div>

### Step 4: 開発者に権限付与

<div class="step-card">

スクリプトは自動で以下を実行します:

**通常パス（組織ポリシーなし）**:
- 開発者アカウントに `Owner` ロールを付与
- 完了（次のステップへ）

**組織パス（組織ポリシー検出時）**:

スクリプトが自動で以下を実行します:

- **Step 4a**: 組織ポリシーの緩和
  - `iam.allowedPolicyMemberDomains`: 外部ドメインからのOwner付与を許可
  - `iam.disableServiceAccountKeyCreation`: サービスアカウントキー作成を許可
- **Step 4b**: デプロイ用サービスアカウント作成
  - 名前: `docsplit-deployer@PROJECT_ID.iam.gserviceaccount.com`
- **Step 4c**: サービスアカウントに `Owner` ロール付与
- **Step 4d**: JSONキー生成
  - 保存先: `~/docsplit-deployer-PROJECT_ID.json`

</div>

<div class="info-box">

**組織パスとは？**:

Google Cloudの組織設定で外部ドメインへの権限付与が制限されている場合に、サービスアカウント経由でアクセスを提供する方式です。スクリプトが自動で判定・実行します。

</div>

---

## Step 4: 完了後の対応

### 通常パスの場合

<div class="success-box">

✓ セットアップ完了！

**開発者に以下を連絡してください**:

- **プロジェクトID**: `your-project-id`

**連絡手段**: メール、Slack等

</div>

### 組織パスの場合

<div class="success-box">

✓ セットアップ完了！

**開発者に以下を送付してください**:

1. **プロジェクトID**: `your-project-id`
2. **JSONキーファイル**: `~/docsplit-deployer-PROJECT_ID.json`

</div>

<div class="error-box">

**セキュリティ重要事項**:

JSONキーファイルは強力な権限を持つため、必ず以下のいずれかの方法で安全に送付してください:

- **1Password**、**Bitwarden** 等のパスワード管理ツールで共有
- パスワード付きZIP（パスワードは別経路で連絡）
- 企業のセキュアファイル転送サービス

**平文メール添付は絶対に行わないでください。**

JSONキーファイルは送付後、クライアントPCから削除することを推奨します:

```bash
rm ~/docsplit-deployer-PROJECT_ID.json
```

</div>

---

## トラブルシューティング

エラーが発生した場合は、[トラブルシューティングガイド](troubleshooting.md)を参照してください。

よくあるエラー:
- [gcloudコマンドが見つからない](troubleshooting.md#gcloudコマンドが見つからない)
- [プロジェクトIDが既に使用されている](troubleshooting.md#プロジェクトidが既に使用されている)
- [課金アカウントの紐付けに失敗](troubleshooting.md#課金アカウントの紐付けに失敗)
- [権限エラー](troubleshooting.md#権限エラー)

---

## 次のステップ

セットアップ完了後:

1. 開発者がシステムをデプロイ（自動、約10分）
2. デプロイ完了後、開発者からアクセスURLが送られます
3. マスターデータの登録は開発者が対応します

---

## 関連ドキュメント

- [概要に戻る](client-setup.md)
- [手動セットアップガイド](setup-manual.md)（スクリプトが使えない場合）
- [トラブルシューティング](troubleshooting.md)
