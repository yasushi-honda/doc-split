#!/bin/bash
#
# DocSplit Gmail認証設定スクリプト
#
# 使用方法:
#   ./setup-gmail-auth.sh <project-id> [OPTIONS]
#
# オプション:
#   --client-id=X      OAuth Client ID（省略時は対話入力）
#   --client-secret=X  OAuth Client Secret（省略時は対話入力）
#   --auth-code=X      OAuth 認証コード（省略時は対話入力）
#
# 3つすべて指定すると非対話モードで実行（CI/Claude Code用）
#
# 事前準備:
#   GCP Console で OAuth 2.0 クライアントIDを作成済みであること
#

set -e

# カラー定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

usage() {
    echo "Usage: $0 <project-id> [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --client-id=X      OAuth Client ID（省略時は対話入力）"
    echo "  --client-secret=X  OAuth Client Secret（省略時は対話入力）"
    echo "  --auth-code=X      OAuth 認証コード（省略時は対話入力）"
    echo ""
    echo "3つすべて指定すると非対話モードで実行（CI/Claude Code用）"
    echo ""
    echo "Examples:"
    echo "  $0 my-project"
    echo "  $0 my-project --client-id=XXX --client-secret=YYY --auth-code=ZZZ"
    exit 1
}

if [ $# -lt 1 ]; then
    usage
fi

PROJECT_ID=$1

# オプション解析
CLIENT_ID=""
CLIENT_SECRET=""
AUTH_CODE=""

shift
for arg in "$@"; do
    case $arg in
        --client-id=*)
            CLIENT_ID="${arg#*=}"
            ;;
        --client-secret=*)
            CLIENT_SECRET="${arg#*=}"
            ;;
        --auth-code=*)
            AUTH_CODE="${arg#*=}"
            ;;
        *)
            log_warn "不明なオプション: $arg"
            ;;
    esac
done

# 非対話モード判定
NON_INTERACTIVE=false
if [ -n "$CLIENT_ID" ] && [ -n "$CLIENT_SECRET" ] && [ -n "$AUTH_CODE" ]; then
    NON_INTERACTIVE=true
fi

echo ""
echo -e "${GREEN}=== DocSplit Gmail認証設定 ===${NC}"
echo ""
echo "Project ID: $PROJECT_ID"
echo ""

# ===========================================
# OAuth クライアント情報の入力
# ===========================================
if [ "$NON_INTERACTIVE" = true ]; then
    log_info "非対話モード: 引数からOAuth情報を使用します"
else
    echo -e "${YELLOW}GCP Console で OAuth 2.0 クライアントIDを作成してください:${NC}"
    echo "  1. https://console.cloud.google.com/apis/credentials?project=$PROJECT_ID"
    echo "  2. 「認証情報を作成」→「OAuth クライアント ID」"
    echo "  3. アプリケーションの種類: 「デスクトップアプリ」"
    echo "  4. 作成後、クライアントIDとシークレットをコピー"
    echo ""

    read -p "OAuth Client ID: " CLIENT_ID
    read -p "OAuth Client Secret: " CLIENT_SECRET
fi

if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ]; then
    log_error "Client ID と Client Secret は必須です"
    exit 1
fi

# ===========================================
# リフレッシュトークンの取得
# ===========================================
echo ""
log_info "リフレッシュトークンを取得します..."

if [ "$NON_INTERACTIVE" = true ]; then
    log_info "非対話モード: 引数から認証コードを使用します"
else
    echo ""
    echo -e "${YELLOW}以下のURLをブラウザで開いてください:${NC}"
    echo ""

    AUTH_URL="https://accounts.google.com/o/oauth2/auth?client_id=${CLIENT_ID}&redirect_uri=urn:ietf:wg:oauth:2.0:oob&scope=https://www.googleapis.com/auth/gmail.readonly&response_type=code&access_type=offline&prompt=consent"

    echo "$AUTH_URL"
    echo ""
    echo "Googleアカウントでログインし、アクセスを許可してください。"
    echo "表示された認証コードをコピーしてください。"
    echo ""

    read -p "認証コード: " AUTH_CODE
fi

if [ -z "$AUTH_CODE" ]; then
    log_error "認証コードは必須です"
    exit 1
fi

# トークン取得
log_info "リフレッシュトークンを取得中..."

TOKEN_RESPONSE=$(curl -s -X POST "https://oauth2.googleapis.com/token" \
    -d "client_id=$CLIENT_ID" \
    -d "client_secret=$CLIENT_SECRET" \
    -d "code=$AUTH_CODE" \
    -d "grant_type=authorization_code" \
    -d "redirect_uri=urn:ietf:wg:oauth:2.0:oob")

REFRESH_TOKEN=$(echo "$TOKEN_RESPONSE" | grep -o '"refresh_token": "[^"]*"' | cut -d'"' -f4)

if [ -z "$REFRESH_TOKEN" ]; then
    log_error "リフレッシュトークンの取得に失敗しました"
    echo "Response: $TOKEN_RESPONSE"
    exit 1
fi

log_success "リフレッシュトークンを取得しました"

# ===========================================
# Secret Managerに保存
# ===========================================
echo ""
log_info "Secret Managerに認証情報を保存中..."

# Client ID
echo -n "$CLIENT_ID" | gcloud secrets create gmail-oauth-client-id \
    --data-file=- --project="$PROJECT_ID" 2>/dev/null || \
echo -n "$CLIENT_ID" | gcloud secrets versions add gmail-oauth-client-id \
    --data-file=- --project="$PROJECT_ID" 2>/dev/null
log_success "gmail-oauth-client-id"

# Client Secret
echo -n "$CLIENT_SECRET" | gcloud secrets create gmail-oauth-client-secret \
    --data-file=- --project="$PROJECT_ID" 2>/dev/null || \
echo -n "$CLIENT_SECRET" | gcloud secrets versions add gmail-oauth-client-secret \
    --data-file=- --project="$PROJECT_ID" 2>/dev/null
log_success "gmail-oauth-client-secret"

# Refresh Token
echo -n "$REFRESH_TOKEN" | gcloud secrets create gmail-oauth-refresh-token \
    --data-file=- --project="$PROJECT_ID" 2>/dev/null || \
echo -n "$REFRESH_TOKEN" | gcloud secrets versions add gmail-oauth-refresh-token \
    --data-file=- --project="$PROJECT_ID" 2>/dev/null
log_success "gmail-oauth-refresh-token"

# ===========================================
# Cloud Functionsに権限付与
# ===========================================
echo ""
log_info "Cloud Functionsサービスアカウントに権限付与..."

# プロジェクト番号取得
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)" 2>/dev/null)
FUNCTIONS_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# Secret Accessorロール付与
for SECRET in gmail-oauth-client-id gmail-oauth-client-secret gmail-oauth-refresh-token; do
    gcloud secrets add-iam-policy-binding "$SECRET" \
        --member="serviceAccount:$FUNCTIONS_SA" \
        --role="roles/secretmanager.secretAccessor" \
        --project="$PROJECT_ID" 2>/dev/null || true
done
log_success "権限付与完了"

# ===========================================
# 完了
# ===========================================
echo ""
echo -e "${GREEN}=== Gmail認証設定完了 ===${NC}"
echo ""
echo "Cloud Functionsを再デプロイしてください:"
echo "  firebase deploy --only functions --project $PROJECT_ID"
echo ""
echo "設定後、checkGmailAttachments関数がGmailにアクセスできるようになります。"
echo ""
