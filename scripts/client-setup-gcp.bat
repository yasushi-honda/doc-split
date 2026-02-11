@echo off
chcp 65001 > nul
setlocal EnableDelayedExpansion

REM DocSplit クライアント向けGCPプロジェクトセットアップスクリプト (Windows)

echo.
echo ╔════════════════════════════════════════════╗
echo ║   DocSplit GCPプロジェクトセットアップ     ║
echo ╚════════════════════════════════════════════╝
echo.
echo このスクリプトは以下を実行します:
echo   1. GCPプロジェクトの作成
echo   2. 課金アカウントの紐付け
echo   3. 開発者への権限付与
echo.

REM ==========================================
REM Step 0: 事前確認
REM ==========================================

echo [INFO] Step 0/4: 環境確認中...
echo.

REM gcloud CLIがインストールされているか確認
where gcloud > nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] gcloud CLIがインストールされていません
    echo.
    echo 以下のURLからインストールしてください:
    echo   https://cloud.google.com/sdk/docs/install
    echo.
    echo インストール後、以下のコマンドで認証してください:
    echo   gcloud auth login
    pause
    exit /b 1
)
echo [OK] gcloud CLI: インストール済み

REM 認証済みか確認
for /f "delims=" %%i in ('gcloud auth list --filter=status:ACTIVE --format="value(account)" 2^>nul') do set CURRENT_ACCOUNT=%%i
if "!CURRENT_ACCOUNT!"=="" (
    echo [ERROR] Google Cloudに認証していません
    echo.
    echo 以下のコマンドを実行してから、再度このスクリプトを実行してください:
    echo   gcloud auth login
    pause
    exit /b 1
)
echo [OK] 認証済みアカウント: !CURRENT_ACCOUNT!
echo.

REM ==========================================
REM Step 1: プロジェクト情報入力
REM ==========================================

echo [INFO] Step 1/4: プロジェクト情報の入力
echo.

:input_project_id
set /p PROJECT_ID="プロジェクトID (例: docsplit-abc-kaigo): "
if "!PROJECT_ID!"=="" (
    echo [WARN] プロジェクトIDを入力してください
    goto input_project_id
)

:input_developer_email
set /p DEVELOPER_EMAIL="開発者のメールアドレス: "
if "!DEVELOPER_EMAIL!"=="" (
    echo [WARN] メールアドレスを入力してください
    goto input_developer_email
)

echo.
echo 以下の内容でセットアップを開始します:
echo   プロジェクトID: !PROJECT_ID!
echo   開発者メール: !DEVELOPER_EMAIL!
echo.
set /p CONFIRM="よろしいですか？ (y/n): "
if /i not "!CONFIRM!"=="y" (
    echo キャンセルしました
    pause
    exit /b 0
)
echo.

REM ==========================================
REM Step 2: GCPプロジェクト作成
REM ==========================================

echo [INFO] Step 2/4: GCPプロジェクト作成中...
echo.

gcloud projects create "!PROJECT_ID!" --name="DocSplit" 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] プロジェクト作成に失敗しました
    echo.
    echo 考えられる原因:
    echo   - プロジェクトIDが既に使用されている
    echo   - プロジェクト作成権限がない
    echo.
    echo 以下のURLで既存プロジェクトを確認してください:
    echo   https://console.cloud.google.com/projectselector2
    pause
    exit /b 1
)
echo [OK] プロジェクト作成完了: !PROJECT_ID!
echo.

gcloud config set project "!PROJECT_ID!" 2>nul

REM ==========================================
REM Step 3: 課金アカウント紐付け
REM ==========================================

echo [INFO] Step 3/4: 課金アカウント紐付け
echo.

echo [INFO] 利用可能な課金アカウント:
gcloud billing accounts list 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] 課金アカウントの取得に失敗しました
    echo.
    echo 以下のURLで課金アカウントを確認してください:
    echo   https://console.cloud.google.com/billing
    pause
    exit /b 1
)
echo.

:input_billing_account
set /p BILLING_ACCOUNT_ID="課金アカウントID (0X0X0X-0X0X0X-0X0X0X形式): "
if "!BILLING_ACCOUNT_ID!"=="" (
    echo [WARN] 課金アカウントIDを入力してください
    goto input_billing_account
)
echo.

gcloud billing projects link "!PROJECT_ID!" --billing-account="!BILLING_ACCOUNT_ID!" 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] 課金アカウント紐付けに失敗しました
    echo.
    echo 考えられる原因:
    echo   - 課金アカウントIDが正しくない
    echo   - 課金アカウントの権限がない
    echo.
    echo 手動で設定する場合、以下のURLにアクセスしてください:
    echo   https://console.cloud.google.com/billing/linkedaccount?project=!PROJECT_ID!
    pause
    exit /b 1
)
echo [OK] 課金アカウント紐付け完了
echo.

REM ==========================================
REM Step 4: 開発者に権限付与
REM ==========================================

echo [INFO] Step 4/4: 開発者にオーナー権限を付与中...
echo.

gcloud projects add-iam-policy-binding "!PROJECT_ID!" --member="user:!DEVELOPER_EMAIL!" --role="roles/owner" --condition=None 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] 権限付与に失敗しました
    echo.
    echo 手動で設定する場合、以下の手順で実行してください:
    echo   1. https://console.cloud.google.com/iam-admin/iam?project=!PROJECT_ID!
    echo   2. 「アクセスを許可」ボタンをクリック
    echo   3. 新しいプリンシパル: !DEVELOPER_EMAIL!
    echo   4. ロール: オーナー
    echo   5. 保存
    pause
    exit /b 1
)
echo [OK] 権限付与完了
echo.

REM ==========================================
REM 完了
REM ==========================================

echo.
echo ╔════════════════════════════════════════════╗
echo ║   セットアップ完了！                       ║
echo ╚════════════════════════════════════════════╝
echo.
echo プロジェクト情報:
echo   プロジェクトID: !PROJECT_ID!
echo   コンソールURL: https://console.cloud.google.com/home/dashboard?project=!PROJECT_ID!
echo.
echo 次のステップ:
echo   1. 開発者にプロジェクトID「!PROJECT_ID!」を連絡してください
echo   2. 開発者が setup-tenant.sh スクリプトを実行します
echo.
pause
