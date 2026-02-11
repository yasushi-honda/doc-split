#!/bin/bash
#
# DocSplit クライアント向けGCPプロジェクトセットアップスクリプト
#
# このスクリプトは、クライアントが自分のGCPアカウントで新規プロジェクトを作成し、
# 開発者に権限を付与するための対話型スクリプトです。
#

set -e

# カラー定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ログ関数
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ヘッダー
clear
echo ""
echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   DocSplit GCPプロジェクトセットアップ     ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo ""
echo "このスクリプトは以下を実行します:"
echo "  1. GCPプロジェクトの作成"
echo "  2. 課金アカウントの紐付け"
echo "  3. 開発者への権限付与"
echo ""

# ===========================================
# Step 0: 事前確認
# ===========================================

log_info "Step 0/4: 環境確認中..."
echo ""

# gcloud CLIがインストールされているか確認
if ! command -v gcloud &> /dev/null; then
    log_warn "gcloud CLIがインストールされていません"
    echo ""
    echo "gcloud CLIを自動インストールします。"
    echo ""
    read -p "続行しますか？ (y/n): " INSTALL_CONFIRM
    if [ "$INSTALL_CONFIRM" != "y" ]; then
        echo ""
        echo "手動でインストールする場合は以下のURLからダウンロードしてください:"
        echo "  https://cloud.google.com/sdk/docs/install"
        exit 0
    fi

    log_info "gcloud CLIをインストール中..."
    echo ""

    # OS判定してインストール
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # Mac
        log_info "Mac環境を検出しました"

        # アーキテクチャ判定
        if [[ $(uname -m) == "arm64" ]]; then
            GCLOUD_URL="https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-darwin-arm.tar.gz"
            GCLOUD_FILE="google-cloud-cli-darwin-arm.tar.gz"
        else
            GCLOUD_URL="https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-darwin-x86_64.tar.gz"
            GCLOUD_FILE="google-cloud-cli-darwin-x86_64.tar.gz"
        fi

        # ダウンロード
        curl -o "/tmp/$GCLOUD_FILE" "$GCLOUD_URL"

        # 展開
        tar -xzf "/tmp/$GCLOUD_FILE" -C "$HOME"

        # インストール
        "$HOME/google-cloud-sdk/install.sh" --quiet --path-update true

        # PATHを更新（即座に反映）
        export PATH="$HOME/google-cloud-sdk/bin:$PATH"

        # クリーンアップ
        rm "/tmp/$GCLOUD_FILE"

        log_success "gcloud CLIのインストールが完了しました"
        echo ""
        log_info "セットアップを続行します..."
        echo ""
        # exit 0 を削除 → そのまま続行
    else
        # Linux
        log_info "Linux環境を検出しました"

        # 公式インストールスクリプトを使用
        curl https://sdk.cloud.google.com | bash

        # PATHを更新（即座に反映）
        export PATH="$HOME/google-cloud-sdk/bin:$PATH"

        log_success "gcloud CLIのインストールが完了しました"
        echo ""
        log_info "セットアップを続行します..."
        echo ""
        # exit 0 を削除 → そのまま続行
    fi
fi
log_success "gcloud CLI: インストール済み"

# 認証済みか確認
CURRENT_ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null || echo "")
if [ -z "$CURRENT_ACCOUNT" ]; then
    log_warn "Google Cloudに認証していません"
    echo ""
    log_info "ブラウザが開きますので、Googleアカウントでログインしてください..."
    echo ""

    # 認証を実行
    if gcloud auth login; then
        CURRENT_ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null || echo "")
        log_success "認証が完了しました"
    else
        log_error "認証に失敗しました"
        exit 1
    fi
fi
log_success "認証済みアカウント: $CURRENT_ACCOUNT"
echo ""

# ===========================================
# Step 1: プロジェクト情報入力
# ===========================================

log_info "Step 1/4: プロジェクト情報の入力"
echo ""

# プロジェクトID入力
while true; do
    read -p "プロジェクトID (例: docsplit-abc-kaigo): " PROJECT_ID
    if [ -z "$PROJECT_ID" ]; then
        log_warn "プロジェクトIDを入力してください"
        continue
    fi
    # プロジェクトIDの形式チェック（小文字・数字・ハイフンのみ、6-30文字）
    if ! echo "$PROJECT_ID" | grep -qE '^[a-z][a-z0-9-]{5,29}$'; then
        log_warn "プロジェクトIDは小文字・数字・ハイフンのみで、6-30文字で入力してください"
        continue
    fi
    break
done

# 開発者メールアドレス入力
while true; do
    read -p "開発者のメールアドレス: " DEVELOPER_EMAIL
    if [ -z "$DEVELOPER_EMAIL" ]; then
        log_warn "メールアドレスを入力してください"
        continue
    fi
    # メールアドレスの簡易チェック
    if ! echo "$DEVELOPER_EMAIL" | grep -qE '^[^@]+@[^@]+\.[^@]+$'; then
        log_warn "正しいメールアドレス形式で入力してください"
        continue
    fi
    break
done

# 確認
echo ""
echo "以下の内容でセットアップを開始します:"
echo "  プロジェクトID: $PROJECT_ID"
echo "  開発者メール: $DEVELOPER_EMAIL"
echo ""
read -p "よろしいですか？ (y/n): " CONFIRM
if [ "$CONFIRM" != "y" ]; then
    echo "キャンセルしました"
    exit 0
fi
echo ""

# ===========================================
# Step 2: GCPプロジェクト作成
# ===========================================

log_info "Step 2/4: GCPプロジェクト作成中..."
echo ""

if gcloud projects create "$PROJECT_ID" --name="DocSplit" 2>/dev/null; then
    log_success "プロジェクト作成完了: $PROJECT_ID"
else
    log_error "プロジェクト作成に失敗しました"
    echo ""
    echo "考えられる原因:"
    echo "  - プロジェクトIDが既に使用されている"
    echo "  - プロジェクト作成権限がない"
    echo ""
    echo "以下のURLで既存プロジェクトを確認してください:"
    echo "  https://console.cloud.google.com/projectselector2"
    exit 1
fi
echo ""

# プロジェクトを選択
gcloud config set project "$PROJECT_ID" 2>/dev/null

# ===========================================
# Step 3: 課金アカウント紐付け
# ===========================================

log_info "Step 3/4: 課金アカウント紐付け"
echo ""

# 課金アカウント一覧を取得
log_info "利用可能な課金アカウント:"
gcloud billing accounts list 2>/dev/null || {
    log_error "課金アカウントの取得に失敗しました"
    echo ""
    echo "以下のURLで課金アカウントを確認してください:"
    echo "  https://console.cloud.google.com/billing"
    exit 1
}
echo ""

# 課金アカウントID入力
while true; do
    read -p "課金アカウントID (0X0X0X-0X0X0X-0X0X0X形式): " BILLING_ACCOUNT_ID
    if [ -z "$BILLING_ACCOUNT_ID" ]; then
        log_warn "課金アカウントIDを入力してください"
        continue
    fi
    # 形式チェック
    if ! echo "$BILLING_ACCOUNT_ID" | grep -qE '^[A-Z0-9]{6}-[A-Z0-9]{6}-[A-Z0-9]{6}$'; then
        log_warn "課金アカウントIDの形式が正しくありません（0X0X0X-0X0X0X-0X0X0X形式で入力）"
        continue
    fi
    break
done
echo ""

if gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT_ID" 2>/dev/null; then
    log_success "課金アカウント紐付け完了"
else
    log_error "課金アカウント紐付けに失敗しました"
    echo ""
    echo "考えられる原因:"
    echo "  - 課金アカウントIDが正しくない"
    echo "  - 課金アカウントの権限がない"
    echo ""
    echo "手動で設定する場合、以下のURLにアクセスしてください:"
    echo "  https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT_ID"
    exit 1
fi
echo ""

# ===========================================
# Step 4: 開発者に権限付与
# ===========================================

log_info "Step 4/4: 開発者にオーナー権限を付与中..."
echo ""

if gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="user:$DEVELOPER_EMAIL" \
    --role="roles/owner" \
    --condition=None 2>/dev/null; then
    log_success "権限付与完了"
else
    log_error "権限付与に失敗しました"
    echo ""
    echo "手動で設定する場合、以下の手順で実行してください:"
    echo "  1. https://console.cloud.google.com/iam-admin/iam?project=$PROJECT_ID"
    echo "  2. 「アクセスを許可」ボタンをクリック"
    echo "  3. 新しいプリンシパル: $DEVELOPER_EMAIL"
    echo "  4. ロール: オーナー"
    echo "  5. 保存"
    exit 1
fi
echo ""

# ===========================================
# 完了
# ===========================================

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   セットアップ完了！                       ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo ""
echo "プロジェクト情報:"
echo "  プロジェクトID: $PROJECT_ID"
echo "  コンソールURL: https://console.cloud.google.com/home/dashboard?project=$PROJECT_ID"
echo ""
echo -e "${YELLOW}次のステップ:${NC}"
echo "  1. 開発者にプロジェクトID「$PROJECT_ID」を連絡してください"
echo "  2. 開発者が setup-tenant.sh スクリプトを実行します"
echo ""
