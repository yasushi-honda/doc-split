#!/bin/bash
#
# DocSplit マルチ環境デプロイスクリプト
#
# 使用方法:
#   ./deploy-to-project.sh <project-alias>
#
# 例:
#   ./deploy-to-project.sh dev         # 開発環境へデプロイ
#   ./deploy-to-project.sh kanameone   # kanameone環境へデプロイ
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

# 使用方法
usage() {
    echo "Usage: $0 <project-alias>"
    echo ""
    echo "Arguments:"
    echo "  project-alias   デプロイ先プロジェクト (dev, kanameone, etc.)"
    echo ""
    echo "Example:"
    echo "  $0 dev         # 開発環境へデプロイ"
    echo "  $0 kanameone   # kanameone環境へデプロイ"
    exit 1
}

# 引数チェック
if [ $# -lt 1 ]; then
    usage
fi

PROJECT_ALIAS=$1
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
FRONTEND_DIR="$ROOT_DIR/frontend"

# .firebasercからプロジェクトIDを取得
if [ ! -f "$ROOT_DIR/.firebaserc" ]; then
    log_error ".firebasercが見つかりません"
    exit 1
fi

# jqがなければgrep/sedで代用
if command -v jq &> /dev/null; then
    PROJECT_ID=$(jq -r ".projects.\"$PROJECT_ALIAS\"" "$ROOT_DIR/.firebaserc")
else
    PROJECT_ID=$(grep -A 20 '"projects"' "$ROOT_DIR/.firebaserc" | grep "\"$PROJECT_ALIAS\"" | sed 's/.*: *"\([^"]*\)".*/\1/')
fi

if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "null" ]; then
    log_error "プロジェクト '$PROJECT_ALIAS' が .firebaserc に見つかりません"
    echo ""
    echo "利用可能なプロジェクト:"
    if command -v jq &> /dev/null; then
        jq -r '.projects | keys[]' "$ROOT_DIR/.firebaserc"
    else
        grep -E '^\s+"[a-z]' "$ROOT_DIR/.firebaserc" | sed 's/.*"\([^"]*\)".*/  \1/'
    fi
    exit 1
fi

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   DocSplit デプロイ                        ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo ""
echo "Target: $PROJECT_ALIAS ($PROJECT_ID)"
echo ""

# 環境変数ファイルの存在確認
ENV_FILE="$FRONTEND_DIR/.env.$PROJECT_ALIAS"
if [ ! -f "$ENV_FILE" ]; then
    # devの場合は.env.local.devを試す
    if [ "$PROJECT_ALIAS" = "dev" ] && [ -f "$FRONTEND_DIR/.env.local.dev" ]; then
        ENV_FILE="$FRONTEND_DIR/.env.local.dev"
    else
        log_error "環境変数ファイルが見つかりません: .env.$PROJECT_ALIAS"
        echo "必要なファイル: $FRONTEND_DIR/.env.$PROJECT_ALIAS"
        exit 1
    fi
fi

log_info "環境変数ファイル: $(basename $ENV_FILE)"

# 現在の.env.localをバックアップ
BACKUP_FILE=""
if [ -f "$FRONTEND_DIR/.env.local" ]; then
    BACKUP_FILE="$FRONTEND_DIR/.env.local.backup.$$"
    cp "$FRONTEND_DIR/.env.local" "$BACKUP_FILE"
    log_info ".env.local をバックアップ: $(basename $BACKUP_FILE)"
fi

# クリーンアップ関数
cleanup() {
    if [ -n "$BACKUP_FILE" ] && [ -f "$BACKUP_FILE" ]; then
        mv "$BACKUP_FILE" "$FRONTEND_DIR/.env.local"
        log_info ".env.local を復元しました"
    fi
}

# エラー時もクリーンアップ
trap cleanup EXIT

# 対象環境の.envを.env.localとしてコピー
cp "$ENV_FILE" "$FRONTEND_DIR/.env.local"
log_success ".env.local を $PROJECT_ALIAS 用に設定"

# 設定内容を確認表示
echo ""
log_info "ビルド設定:"
grep "VITE_FIREBASE_PROJECT_ID" "$FRONTEND_DIR/.env.local" | sed 's/^/  /'
echo ""

# ビルド
log_info "フロントエンドをビルド中..."
cd "$FRONTEND_DIR"
npm run build
log_success "ビルド完了"

# デプロイ
echo ""
log_info "Firebase Hostingへデプロイ中..."
cd "$ROOT_DIR"
firebase deploy --only hosting -P "$PROJECT_ALIAS"

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   デプロイ完了！                           ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo ""
echo "URL: https://${PROJECT_ID}.web.app"
echo ""
