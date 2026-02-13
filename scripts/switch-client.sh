#!/bin/bash
#
# DocSplit クライアント環境切り替えスクリプト
#
# 使用方法:
#   ./switch-client.sh <client-alias>
#   ./switch-client.sh --list
#
# 説明:
#   gcloud構成を切り替え、正しいアカウント・プロジェクトで操作できるようにする。
#   scripts/clients/*.env の定義に基づいて認証情報を検証する。
#

set -e

# カラー定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLIENTS_DIR="$SCRIPT_DIR/clients"

# 使用方法
usage() {
    echo "Usage: $0 <client-alias>"
    echo "       $0 --list"
    echo ""
    echo "Options:"
    echo "  --list    利用可能なクライアント一覧を表示"
    echo ""
    echo "Examples:"
    echo "  $0 dev        # 開発環境に切り替え"
    echo "  $0 cocoro     # cocoro環境に切り替え"
    echo "  $0 kanameone  # kanameone環境に切り替え"
    exit 1
}

# クライアント一覧表示
list_clients() {
    echo ""
    echo -e "${BLUE}利用可能なクライアント:${NC}"
    echo ""
    printf "  %-12s %-25s %-15s %s\n" "ALIAS" "PROJECT_ID" "AUTH_TYPE" "GCLOUD_CONFIG"
    printf "  %-12s %-25s %-15s %s\n" "-----" "----------" "---------" "-------------"
    for env_file in "$CLIENTS_DIR"/*.env; do
        [ -f "$env_file" ] || continue
        source "$env_file"
        printf "  %-12s %-25s %-15s %s\n" "$CLIENT_NAME" "$PROJECT_ID" "$AUTH_TYPE" "$GCLOUD_CONFIG"
    done
    echo ""
}

# 引数チェック
if [ $# -lt 1 ]; then
    usage
fi

if [ "$1" = "--list" ]; then
    list_clients
    exit 0
fi

CLIENT_ALIAS=$1
CLIENT_ENV="$CLIENTS_DIR/${CLIENT_ALIAS}.env"

if [ ! -f "$CLIENT_ENV" ]; then
    echo -e "${RED}エラー: クライアント定義が見つかりません: ${CLIENT_ALIAS}${NC}"
    echo ""
    echo "利用可能なクライアント:"
    ls "$CLIENTS_DIR"/*.env 2>/dev/null | xargs -I{} basename {} .env | sed 's/^/  /'
    exit 1
fi

# クライアント定義読み込み
source "$CLIENT_ENV"

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   DocSplit 環境切り替え                     ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo ""
echo "クライアント:   $CLIENT_NAME"
echo "プロジェクト:   $PROJECT_ID"
echo "認証タイプ:     $AUTH_TYPE"
echo "gcloud構成:     $GCLOUD_CONFIG"
echo ""

# gcloud構成の存在確認
EXISTING_CONFIGS=$(gcloud config configurations list --format="value(name)" 2>/dev/null)
if ! echo "$EXISTING_CONFIGS" | grep -q "^${GCLOUD_CONFIG}$"; then
    echo -e "${RED}エラー: gcloud構成 '${GCLOUD_CONFIG}' が存在しません${NC}"
    echo ""
    echo "利用可能な構成:"
    gcloud config configurations list --format="table(name,properties.core.account,properties.core.project,is_active)" 2>/dev/null
    echo ""
    echo "構成を作成する場合:"
    if [ "$AUTH_TYPE" = "service_account" ]; then
        echo "  gcloud config configurations create $GCLOUD_CONFIG"
        echo "  gcloud config set account $EXPECTED_ACCOUNT --configuration=$GCLOUD_CONFIG"
        echo "  gcloud config set project $PROJECT_ID --configuration=$GCLOUD_CONFIG"
    else
        echo "  gcloud config configurations create $GCLOUD_CONFIG"
        echo "  gcloud auth login --configuration=$GCLOUD_CONFIG"
        echo "  gcloud config set project $PROJECT_ID --configuration=$GCLOUD_CONFIG"
    fi
    exit 1
fi

# .envrc.client を更新（direnvの環境変数を切り替え）
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENVRC_CLIENT="$PROJECT_ROOT/.envrc.client"

cat > "$ENVRC_CLIENT" <<EOF
# switch-client.sh により自動生成 ($(date '+%Y-%m-%d %H:%M:%S'))
# クライアント: $CLIENT_NAME
export CLOUDSDK_ACTIVE_CONFIG_NAME="$GCLOUD_CONFIG"
export GCLOUD_PROJECT="$PROJECT_ID"
export FIREBASE_PROJECT="$PROJECT_ID"
export _expected_gcp_account="$EXPECTED_ACCOUNT"
EOF

# direnvに再読み込みを許可
if command -v direnv &>/dev/null; then
    direnv allow "$PROJECT_ROOT" 2>/dev/null
fi

# gcloud構成を切り替え（現シェルにも即時反映）
export CLOUDSDK_ACTIVE_CONFIG_NAME="$GCLOUD_CONFIG"
gcloud config configurations activate "$GCLOUD_CONFIG" 2>/dev/null

# 認証アカウント確認
CURRENT_ACCOUNT=$(gcloud --configuration="$GCLOUD_CONFIG" config get-value account 2>/dev/null)
CURRENT_PROJECT=$(gcloud --configuration="$GCLOUD_CONFIG" config get-value project 2>/dev/null)

echo -e "${BLUE}認証状態:${NC}"
echo "  アカウント: $CURRENT_ACCOUNT"
echo "  プロジェクト: $CURRENT_PROJECT"
echo ""

# アカウント一致確認
if [ "$CURRENT_ACCOUNT" != "$EXPECTED_ACCOUNT" ]; then
    echo -e "${RED}⚠ 警告: アカウントが期待値と異なります${NC}"
    echo "  期待: $EXPECTED_ACCOUNT"
    echo "  実際: $CURRENT_ACCOUNT"
    echo ""
    echo "修正方法:"
    echo "  gcloud config set account $EXPECTED_ACCOUNT"
    exit 1
fi

# プロジェクト設定（一致しない場合のみ）
if [ "$CURRENT_PROJECT" != "$PROJECT_ID" ]; then
    echo -e "${YELLOW}プロジェクトを設定中...${NC}"
    gcloud config set project "$PROJECT_ID" 2>/dev/null
fi

echo -e "${GREEN}✓ 環境切り替え完了: ${CLIENT_NAME} (${PROJECT_ID})${NC}"
echo ""
echo "次のステップ:"
echo "  ./scripts/deploy-to-project.sh $CLIENT_ALIAS          # Hostingデプロイ"
echo "  ./scripts/deploy-to-project.sh $CLIENT_ALIAS --full   # フルデプロイ"
echo "  ./scripts/verify-setup.sh $PROJECT_ID                  # セットアップ検証"
echo ""
