#!/bin/bash
#
# DocSplit Gmail認証設定スクリプト
#
# 使用方法:
#   ./setup-gmail-auth.sh <project-id> [OPTIONS]
#   ./setup-gmail-auth.sh --get-code --client-id=X   # 認証コード取得のみ
#
# オプション:
#   --client-id=X      OAuth Client ID（省略時は対話入力）
#   --client-secret=X  OAuth Client Secret（省略時は対話入力）
#   --auth-code=X      OAuth 認証コード（省略時はloopbackで自動取得）
#   --get-code         認証コードの取得のみ行う（Secret Manager保存なし）
#
# 3つすべて指定すると非対話モードで実行（CI/Claude Code用）
#
# 事前準備:
#   GCP Console で OAuth 2.0 クライアントIDを作成済みであること
#   （種類: デスクトップアプリ）
#
# 注意: Google OAuth OOBフローは2023年に廃止済み。
#       本スクリプトはloopback方式（http://localhost）を使用します。
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

# OAuth loopback設定
LOOPBACK_PORT=18234
REDIRECT_URI="http://localhost:${LOOPBACK_PORT}"

usage() {
    echo "Usage: $0 <project-id> [OPTIONS]"
    echo "       $0 --get-code --client-id=X"
    echo ""
    echo "Options:"
    echo "  --client-id=X      OAuth Client ID（省略時は対話入力）"
    echo "  --client-secret=X  OAuth Client Secret（省略時は対話入力）"
    echo "  --auth-code=X      OAuth 認証コード（省略時はloopbackで自動取得）"
    echo "  --get-code         認証コードの取得のみ（Secret Manager保存なし）"
    echo ""
    echo "3つすべて指定すると非対話モードで実行（CI/Claude Code用）"
    echo ""
    echo "Examples:"
    echo "  $0 my-project"
    echo "  $0 my-project --client-id=XXX --client-secret=YYY --auth-code=ZZZ"
    echo "  $0 --get-code --client-id=XXX"
    exit 1
}

# ===========================================
# Loopback認証コード取得関数
# ===========================================
get_auth_code_via_loopback() {
    local client_id="$1"

    # Python3チェック
    if ! command -v python3 &> /dev/null; then
        log_error "python3 が見つかりません。Python 3をインストールしてください。"
        exit 1
    fi

    # ポート使用チェック
    if lsof -i ":${LOOPBACK_PORT}" &> /dev/null; then
        log_error "ポート ${LOOPBACK_PORT} が使用中です。使用中のプロセスを終了してから再実行してください。"
        exit 1
    fi

    local auth_url="https://accounts.google.com/o/oauth2/v2/auth?client_id=${client_id}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=https://www.googleapis.com/auth/gmail.readonly&access_type=offline&prompt=consent"

    echo ""
    log_info "ブラウザで Google 認証画面を開きます..."
    echo ""

    # ブラウザを開く
    if command -v open &> /dev/null; then
        open "$auth_url"
    elif command -v xdg-open &> /dev/null; then
        xdg-open "$auth_url"
    else
        echo -e "${YELLOW}以下のURLをブラウザで開いてください:${NC}"
        echo "$auth_url"
    fi

    echo "認証が完了するまで待機中... (ブラウザで Google アカウントを認証してください)"
    echo ""

    # Python loopback サーバーで認証コードを受け取る
    AUTH_CODE=$(python3 << PYEOF
import http.server
import urllib.parse
import sys

LISTEN_PORT = ${LOOPBACK_PORT}

class OAuthHandler(http.server.BaseHTTPRequestHandler):
    auth_code = None

    def do_GET(self):
        query = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(query)
        if 'code' in params:
            OAuthHandler.auth_code = params['code'][0]
            self.send_response(200)
            self.send_header('Content-type', 'text/html; charset=utf-8')
            self.end_headers()
            html = '''<!DOCTYPE html><html><head><meta charset="utf-8">
            <style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f0fdf4;}
            .card{text-align:center;padding:40px;background:white;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,0.1);}
            h1{color:#065f46;}</style></head>
            <body><div class="card"><h1>認証成功</h1><p>このタブを閉じてターミナルに戻ってください。</p></div></body></html>'''
            self.wfile.write(html.encode())
        elif 'error' in params:
            error = params.get('error', ['unknown'])[0]
            self.send_response(400)
            self.send_header('Content-type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write('<html><body><h1>認証エラー</h1><p>{}</p></body></html>'.format(error).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass

try:
    server = http.server.HTTPServer(('localhost', LISTEN_PORT), OAuthHandler)
    server.timeout = 300
    server.handle_request()
    if OAuthHandler.auth_code:
        print(OAuthHandler.auth_code)
        sys.exit(0)
    else:
        sys.exit(1)
except Exception as e:
    sys.stderr.write("Error: {}\n".format(e))
    sys.exit(1)
PYEOF
)

    if [ -z "$AUTH_CODE" ]; then
        log_error "認証コードの取得に失敗しました（タイムアウトまたはエラー）"
        exit 1
    fi

    log_success "認証コードを取得しました"
}

# ===========================================
# オプション解析
# ===========================================
CLIENT_ID=""
CLIENT_SECRET=""
AUTH_CODE=""
GET_CODE_ONLY=false
PROJECT_ID=""

# 第1引数がオプションでなければ project-id
if [ $# -ge 1 ] && [[ "$1" != --* ]]; then
    PROJECT_ID=$1
    shift
fi

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
        --get-code)
            GET_CODE_ONLY=true
            ;;
        *)
            log_warn "不明なオプション: $arg"
            ;;
    esac
done

# ===========================================
# --get-code モード: 認証コード取得のみ
# ===========================================
if [ "$GET_CODE_ONLY" = true ]; then
    if [ -z "$CLIENT_ID" ]; then
        echo -e "${YELLOW}OAuth Client IDを入力してください:${NC}"
        read -p "Client ID: " CLIENT_ID
    fi
    if [ -z "$CLIENT_ID" ]; then
        log_error "Client ID は必須です"
        exit 1
    fi

    get_auth_code_via_loopback "$CLIENT_ID"
    echo ""
    echo -e "${GREEN}=== 認証コード ===${NC}"
    echo "$AUTH_CODE"
    echo ""
    echo "この認証コードを GitHub Pages のフォームまたは --auth-code= オプションに使用してください。"
    exit 0
fi

# ===========================================
# 通常モード: project-id 必須チェック
# ===========================================
if [ -z "$PROJECT_ID" ]; then
    usage
fi

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

    if [ -z "$CLIENT_ID" ]; then
        read -p "OAuth Client ID: " CLIENT_ID
    fi
    if [ -z "$CLIENT_SECRET" ]; then
        read -p "OAuth Client Secret: " CLIENT_SECRET
    fi
fi

if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ]; then
    log_error "Client ID と Client Secret は必須です"
    exit 1
fi

# ===========================================
# 認証コードの取得
# ===========================================
echo ""
log_info "リフレッシュトークンを取得します..."

if [ "$NON_INTERACTIVE" = true ]; then
    log_info "非対話モード: 引数から認証コードを使用します"
elif [ -z "$AUTH_CODE" ]; then
    get_auth_code_via_loopback "$CLIENT_ID"
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
    -d "redirect_uri=$REDIRECT_URI")

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
