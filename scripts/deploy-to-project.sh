#!/bin/bash
#
# DocSplit マルチ環境デプロイスクリプト
#
# 使用方法:
#   ./deploy-to-project.sh <project-alias> [OPTIONS]
#
# オプション:
#   --full          Hosting + Functions + Rules を全てデプロイ
#   --rules         Hosting + Firestore/Storage ルール をデプロイ
#                   ★ Firestoreスキーマ変更時（新フィールド追加等）は必須
#   (デフォルト)    Hosting のみデプロイ
#
# 例:
#   ./deploy-to-project.sh dev              # Hostingのみデプロイ
#   ./deploy-to-project.sh kanameone --rules # Hosting + ルール（スキーマ変更時）
#   ./deploy-to-project.sh kanameone --full # 全コンポーネントをデプロイ
#
# ⚠️ 重要: Firestoreに新フィールドを追加した場合は --rules または --full を使用すること
#    （ルールをデプロイしないとパーミッションエラーになる）
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
    echo "Usage: $0 <project-alias> [OPTIONS]"
    echo ""
    echo "Arguments:"
    echo "  project-alias   デプロイ先プロジェクト (dev, kanameone, etc.)"
    echo ""
    echo "Options:"
    echo "  --full          Hosting + Functions + Rules を全てデプロイ"
    echo "  --rules         Hosting + Firestore/Storage ルール をデプロイ"
    echo "                  ★ Firestoreスキーマ変更時は必須"
    echo "  (デフォルト)    Hosting のみデプロイ"
    echo ""
    echo "Example:"
    echo "  $0 dev                  # Hostingのみデプロイ"
    echo "  $0 kanameone --rules    # Hosting + ルール（スキーマ変更時）"
    echo "  $0 kanameone --full     # 全コンポーネントをデプロイ"
    echo ""
    echo "⚠️  Firestoreに新フィールドを追加した場合は --rules または --full を使用"
    exit 1
}

# 引数チェック
if [ $# -lt 1 ]; then
    usage
fi

PROJECT_ALIAS=$1
FULL_DEPLOY=false
RULES_DEPLOY=false

# オプション解析
for arg in "$@"; do
    case $arg in
        --full)
            FULL_DEPLOY=true
            ;;
        --rules)
            RULES_DEPLOY=true
            ;;
    esac
done
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
FRONTEND_DIR="$ROOT_DIR/frontend"

# .firebasercからプロジェクトIDを取得
if [ ! -f "$ROOT_DIR/.firebaserc" ]; then
    log_error ".firebasercが見つかりません"
    exit 1
fi

PROJECT_ID=$(node "$SCRIPT_DIR/helpers/firebaserc-helper.js" get-project "$PROJECT_ALIAS" 2>/dev/null)

if [ -z "$PROJECT_ID" ]; then
    log_error "プロジェクト '$PROJECT_ALIAS' が .firebaserc に見つかりません"
    echo ""
    echo "利用可能なプロジェクト:"
    node "$SCRIPT_DIR/helpers/firebaserc-helper.js" list-aliases 2>/dev/null | sed 's/^/  /'
    exit 1
fi

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   DocSplit デプロイ                        ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo ""
echo "Target: $PROJECT_ALIAS ($PROJECT_ID)"
if [ "$FULL_DEPLOY" = true ]; then
    echo "Mode:   Full (Hosting + Functions + Rules)"
elif [ "$RULES_DEPLOY" = true ]; then
    echo "Mode:   Hosting + Rules (スキーマ変更対応)"
else
    echo "Mode:   Hosting only"
fi
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
cd "$ROOT_DIR"

# --full オプション時は Functions + Rules もデプロイ
if [ "$FULL_DEPLOY" = true ]; then
    echo ""
    log_info "Cloud Functions ビルド中..."
    cd "$ROOT_DIR/functions"
    npm run build
    log_success "Functions ビルド完了"

    echo ""
    log_info "Cloud Functions デプロイ中..."
    cd "$ROOT_DIR"
    firebase deploy --only functions -P "$PROJECT_ALIAS"
    log_success "Functions デプロイ完了"

    echo ""
    log_info "Firestore/Storage ルール デプロイ中..."
    firebase deploy --only firestore:rules,storage -P "$PROJECT_ALIAS"
    log_success "ルール デプロイ完了"
fi

# --rules オプション時はルールのみデプロイ（Functionsなし）
if [ "$RULES_DEPLOY" = true ] && [ "$FULL_DEPLOY" = false ]; then
    echo ""
    log_info "Firestore/Storage ルール デプロイ中..."
    cd "$ROOT_DIR"
    firebase deploy --only firestore:rules,storage -P "$PROJECT_ALIAS"
    log_success "ルール デプロイ完了"
fi

echo ""
log_info "Firebase Hosting デプロイ中..."
firebase deploy --only hosting -P "$PROJECT_ALIAS"

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   デプロイ完了！                           ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo ""
echo "URL: https://${PROJECT_ID}.web.app"
if [ "$FULL_DEPLOY" = true ]; then
    echo ""
    echo -e "${YELLOW}注意: 検索機能の新規追加・更新時は、既存ドキュメントにマイグレーションが必要です:${NC}"
    echo "  node scripts/migrate-search-index.js --project $PROJECT_ID"
fi
echo ""
