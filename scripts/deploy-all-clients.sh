#!/bin/bash

# ============================================
# 全クライアント一括デプロイスクリプト
# ============================================
#
# 使用方法:
#   ./scripts/deploy-all-clients.sh [--rules] [--full] [--dry-run]
#
# オプション:
#   --rules    Hosting + Firestoreルール
#   --full     全コンポーネント（Hosting + Rules + Functions）
#   --dry-run  実行せずに対象を表示
#
# 注意:
#   - devは除外（開発環境のため）
#   - 各クライアントに順次デプロイ
#

set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# 色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 引数解析
DEPLOY_MODE=""
DRY_RUN=false

for arg in "$@"; do
    case $arg in
        --rules)
            DEPLOY_MODE="--rules"
            ;;
        --full)
            DEPLOY_MODE="--full"
            ;;
        --dry-run)
            DRY_RUN=true
            ;;
        *)
            ;;
    esac
done

# .firebasercからクライアント一覧を取得（dev, default除外）
get_clients() {
    node -e "
        const rc = require('./.firebaserc');
        const clients = Object.keys(rc.projects)
            .filter(k => k !== 'dev' && k !== 'default');
        console.log(clients.join('\n'));
    "
}

CLIENTS=$(get_clients)

if [ -z "$CLIENTS" ]; then
    log_warn "デプロイ対象のクライアントがありません"
    exit 0
fi

echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   全クライアント一括デプロイ               ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo ""

log_info "対象クライアント:"
echo "$CLIENTS" | while read client; do
    echo "  - $client"
done
echo ""

if [ -n "$DEPLOY_MODE" ]; then
    log_info "デプロイモード: $DEPLOY_MODE"
else
    log_info "デプロイモード: Hostingのみ"
fi
echo ""

if [ "$DRY_RUN" = true ]; then
    log_warn "Dry-run モード: 実際のデプロイは行いません"
    echo ""
    echo "実行されるコマンド:"
    echo "$CLIENTS" | while read client; do
        echo "  ./scripts/deploy-to-project.sh $client $DEPLOY_MODE"
    done
    exit 0
fi

# 確認プロンプト
echo -n "全クライアントにデプロイしますか？ (y/N): "
read -r confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    log_info "キャンセルしました"
    exit 0
fi

echo ""

# 各クライアントにデプロイ
SUCCESS_COUNT=0
FAIL_COUNT=0
FAILED_CLIENTS=""

echo "$CLIENTS" | while read client; do
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log_info "デプロイ中: $client"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if ./scripts/deploy-to-project.sh "$client" $DEPLOY_MODE; then
        log_success "$client へのデプロイ完了"
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    else
        log_error "$client へのデプロイ失敗"
        FAIL_COUNT=$((FAIL_COUNT + 1))
        FAILED_CLIENTS="$FAILED_CLIENTS $client"
    fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   デプロイ完了                             ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo ""

# 結果は各デプロイで表示されるため、ここでは簡潔に
log_info "全クライアントへのデプロイが完了しました"
