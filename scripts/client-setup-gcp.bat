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
    echo [WARN] gcloud CLIがインストールされていません
    echo.
    echo gcloud CLIのインストールが必要です。
    echo.
    echo 以下のURLからインストーラーをダウンロードして実行してください:
    echo   https://cloud.google.com/sdk/docs/install-sdk#windows
    echo.
    echo インストール完了後、このスクリプトを再度実行してください。
    echo.
    set /p OPEN_URL="インストールページを開きますか？ (y/n): "
    if /i "!OPEN_URL!"=="y" (
        start https://cloud.google.com/sdk/docs/install-sdk#windows
    )
    pause
    exit /b 1
)
echo [OK] gcloud CLI: インストール済み

REM 認証済みか確認
for /f "delims=" %%i in ('gcloud auth list --filter=status:ACTIVE --format="value(account)" 2^>nul') do set CURRENT_ACCOUNT=%%i
if "!CURRENT_ACCOUNT!"=="" (
    echo [WARN] Google Cloudに認証していません
    echo.
    echo [INFO] ブラウザが開きますので、Googleアカウントでログインしてください...
    echo.

    REM 認証を実行
    gcloud auth login
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] 認証に失敗しました
        pause
        exit /b 1
    )

    REM 認証後のアカウントを取得
    for /f "delims=" %%i in ('gcloud auth list --filter=status:ACTIVE --format="value(account)" 2^>nul') do set CURRENT_ACCOUNT=%%i
    echo [OK] 認証が完了しました
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

REM 外部ドメインへの権限付与を試行
gcloud projects add-iam-policy-binding "!PROJECT_ID!" --member="user:!DEVELOPER_EMAIL!" --role="roles/owner" --condition=None 2>"%TEMP%\iam-error.txt"

if %ERRORLEVEL% equ 0 (
    REM 従来フロー: 成功
    echo [OK] 権限付与完了
    set USE_SERVICE_ACCOUNT=false
) else (
    REM エラー内容を確認
    findstr /C:"constraints/iam.allowedPolicyMemberDomains" "%TEMP%\iam-error.txt" >nul
    if %ERRORLEVEL% equ 0 (
        echo [WARN] 組織ポリシーにより外部ドメインへの権限付与が制限されています
        echo.
        echo [INFO] サービスアカウント方式に自動切替します...
        echo.

        set USE_SERVICE_ACCOUNT=true

        REM ==========================================
        REM Step 4a: 組織ポリシー緩和
        REM ==========================================

        echo [INFO] Step 4a: 組織ポリシーを緩和中...
        echo.

        REM 組織ポリシーYAMLを一時ファイルに作成
        (
        echo name: projects/!PROJECT_ID!/policies/iam.allowedPolicyMemberDomains
        echo spec:
        echo   rules:
        echo   - allowAll: true
        ) > "%TEMP%\allow-all-domains.yaml"

        (
        echo name: projects/!PROJECT_ID!/policies/iam.disableServiceAccountKeyCreation
        echo spec:
        echo   rules:
        echo   - enforce: false
        ) > "%TEMP%\disable-key-creation-off.yaml"

        REM ポリシー適用
        gcloud org-policies set-policy "%TEMP%\allow-all-domains.yaml" --project="!PROJECT_ID!" 2>nul
        if %ERRORLEVEL% neq 0 (
            echo [ERROR] 組織ポリシーの緩和に失敗しました
            echo.
            echo 手動で設定する場合、ADR-0011の手順を参照してください:
            echo   docs/adr/0011-service-account-delivery-for-org-accounts.md
            del "%TEMP%\allow-all-domains.yaml" "%TEMP%\disable-key-creation-off.yaml" 2>nul
            pause
            exit /b 1
        )

        gcloud org-policies set-policy "%TEMP%\disable-key-creation-off.yaml" --project="!PROJECT_ID!" 2>nul
        if %ERRORLEVEL% neq 0 (
            echo [ERROR] 組織ポリシーの緩和に失敗しました
            echo.
            echo 手動で設定する場合、ADR-0011の手順を参照してください:
            echo   docs/adr/0011-service-account-delivery-for-org-accounts.md
            del "%TEMP%\allow-all-domains.yaml" "%TEMP%\disable-key-creation-off.yaml" 2>nul
            pause
            exit /b 1
        )

        echo [OK] 組織ポリシー緩和完了
        echo.

        REM クリーンアップ
        del "%TEMP%\allow-all-domains.yaml" "%TEMP%\disable-key-creation-off.yaml" 2>nul

        REM ==========================================
        REM Step 4b: サービスアカウント作成
        REM ==========================================

        echo [INFO] Step 4b: サービスアカウント作成中...
        echo.

        set SA_EMAIL=docsplit-deployer@!PROJECT_ID!.iam.gserviceaccount.com

        gcloud iam service-accounts create docsplit-deployer --display-name="DocSplit Deployer" --description="DocSplit deployment and maintenance" --project="!PROJECT_ID!" 2>nul
        if %ERRORLEVEL% neq 0 (
            echo [ERROR] サービスアカウント作成に失敗しました
            pause
            exit /b 1
        )

        echo [OK] サービスアカウント作成完了: !SA_EMAIL!
        echo.

        REM ==========================================
        REM Step 4c: Ownerロール付与
        REM ==========================================

        echo [INFO] Step 4c: サービスアカウントにOwnerロールを付与中...
        echo.

        gcloud projects add-iam-policy-binding "!PROJECT_ID!" --member="serviceAccount:!SA_EMAIL!" --role="roles/owner" --condition=None 2>nul
        if %ERRORLEVEL% neq 0 (
            echo [ERROR] Ownerロール付与に失敗しました
            pause
            exit /b 1
        )

        echo [OK] Ownerロール付与完了
        echo.

        REM ==========================================
        REM Step 4d: JSONキー生成
        REM ==========================================

        echo [INFO] Step 4d: JSONキー生成中...
        echo.

        set KEY_FILE=%USERPROFILE%\docsplit-deployer-!PROJECT_ID!.json

        gcloud iam service-accounts keys create "!KEY_FILE!" --iam-account="!SA_EMAIL!" --project="!PROJECT_ID!" 2>nul
        if %ERRORLEVEL% neq 0 (
            echo [ERROR] JSONキー生成に失敗しました
            pause
            exit /b 1
        )

        echo [OK] JSONキー生成完了: !KEY_FILE!
        echo.
    ) else (
        REM 組織ポリシー以外のエラー
        echo [ERROR] 権限付与に失敗しました
        echo.
        echo エラー詳細:
        type "%TEMP%\iam-error.txt"
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
)
echo.

REM クリーンアップ
del "%TEMP%\iam-error.txt" 2>nul

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

if "!USE_SERVICE_ACCOUNT!"=="true" (
    REM サービスアカウント方式の場合
    echo 次のステップ:
    echo   1. 以下のファイルを開発者に安全に送付してください:
    echo      - プロジェクトID: !PROJECT_ID!
    echo      - JSONキー: !KEY_FILE!
    echo.
    echo   2. 開発者が以下のコマンドで環境設定します:
    echo      set GOOGLE_APPLICATION_CREDENTIALS=!KEY_FILE!
    echo.
    echo   3. 開発者が setup-tenant.sh スクリプトを実行します
    echo.
    echo セキュリティ推奨事項:
    echo   - JSONキーは暗号化して送信してください（例: 1Password, パスワード付きZIP）
    echo   - 初回デプロイ後、Ownerロールを最小権限に縮小することを推奨します
    echo     詳細: docs/adr/0011-service-account-delivery-for-org-accounts.md
    echo.
) else (
    REM 従来フロー（外部ドメイン直接付与成功）
    echo 次のステップ:
    echo   1. 開発者にプロジェクトID「!PROJECT_ID!」を連絡してください
    echo   2. 開発者が setup-tenant.sh スクリプトを実行します
    echo.
)

pause
