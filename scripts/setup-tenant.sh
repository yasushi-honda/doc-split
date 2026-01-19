#!/bin/bash
#
# DocSplit テナント初期設定スクリプト
#
# 使用方法:
#   ./setup-tenant.sh <project-id> <admin-email> [gmail-account]
#
# 実行内容:
#   1. GCP API有効化
#   2. Firebase設定
#   3. 環境変数生成
#   4. 管理者ユーザー登録
#   5. Firestore/Storageルールデプロイ
#   6. Cloud Functionsデプロイ
#   7. Hostingデプロイ
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
    echo "Usage: $0 <project-id> <admin-email> [gmail-account]"
    echo ""
    echo "Arguments:"
    echo "  project-id    GCP/Firebase プロジェクトID"
    echo "  admin-email   初期管理者のメールアドレス"
    echo "  gmail-account 監視対象Gmailアカウント（省略可）"
    echo ""
    echo "Example:"
    echo "  $0 client-docsplit admin@client.com support@client.com"
    exit 1
}

# 引数チェック
if [ $# -lt 2 ]; then
    usage
fi

PROJECT_ID=$1
ADMIN_EMAIL=$2
GMAIL_ACCOUNT=${3:-$ADMIN_EMAIL}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   DocSplit テナント初期設定                ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo ""
echo "Project ID:    $PROJECT_ID"
echo "Admin Email:   $ADMIN_EMAIL"
echo "Gmail Account: $GMAIL_ACCOUNT"
echo ""

# 確認
read -p "この設定で続行しますか？ (y/n): " CONFIRM
if [ "$CONFIRM" != "y" ]; then
    echo "キャンセルしました"
    exit 0
fi

# ===========================================
# Step 1: GCP API有効化
# ===========================================
echo ""
log_info "Step 1/7: GCP API有効化..."

gcloud config set project "$PROJECT_ID" 2>/dev/null

APIS=(
    "cloudfunctions.googleapis.com"
    "firestore.googleapis.com"
    "storage.googleapis.com"
    "pubsub.googleapis.com"
    "aiplatform.googleapis.com"
    "secretmanager.googleapis.com"
    "gmail.googleapis.com"
    "cloudscheduler.googleapis.com"
    "cloudbuild.googleapis.com"
)

for api in "${APIS[@]}"; do
    gcloud services enable "$api" --project="$PROJECT_ID" 2>/dev/null && \
        log_success "  $api" || log_warn "  $api (既に有効または権限なし)"
done

# ===========================================
# Step 2: Firebase設定
# ===========================================
echo ""
log_info "Step 2/7: Firebase設定..."

firebase use "$PROJECT_ID" 2>/dev/null || {
    log_warn "Firebaseプロジェクトが見つかりません。追加します..."
    firebase projects:addfirebase "$PROJECT_ID" 2>/dev/null || true
    firebase use "$PROJECT_ID"
}
log_success "Firebaseプロジェクト: $PROJECT_ID"

# ===========================================
# Step 3: 環境変数生成
# ===========================================
echo ""
log_info "Step 3/7: フロントエンド環境変数生成..."

# Firebase設定を取得
FIREBASE_CONFIG=$(firebase apps:sdkconfig web --project "$PROJECT_ID" 2>/dev/null || echo "")

if [ -n "$FIREBASE_CONFIG" ]; then
    # 既存のWebアプリがある場合
    API_KEY=$(echo "$FIREBASE_CONFIG" | grep -o '"apiKey": "[^"]*"' | cut -d'"' -f4)
    AUTH_DOMAIN=$(echo "$FIREBASE_CONFIG" | grep -o '"authDomain": "[^"]*"' | cut -d'"' -f4)
    STORAGE_BUCKET=$(echo "$FIREBASE_CONFIG" | grep -o '"storageBucket": "[^"]*"' | cut -d'"' -f4)
    MESSAGING_SENDER_ID=$(echo "$FIREBASE_CONFIG" | grep -o '"messagingSenderId": "[^"]*"' | cut -d'"' -f4)
    APP_ID=$(echo "$FIREBASE_CONFIG" | grep -o '"appId": "[^"]*"' | cut -d'"' -f4)
else
    log_warn "Webアプリが見つかりません。Firebase Consoleで作成後、手動で.envを設定してください"
    API_KEY=""
fi

if [ -n "$API_KEY" ]; then
    cat > "$ROOT_DIR/frontend/.env" << EOF
VITE_FIREBASE_API_KEY=$API_KEY
VITE_FIREBASE_AUTH_DOMAIN=$AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID=$PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET=$STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID=$MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID=$APP_ID
EOF
    log_success "frontend/.env を生成しました"
else
    log_warn "frontend/.env の手動設定が必要です"
fi

# ===========================================
# Step 4: サービスアカウントキー作成 & 管理者登録
# ===========================================
echo ""
log_info "Step 4/7: 管理者ユーザー登録..."

# サービスアカウント確認
SA_EMAIL="firebase-adminsdk-fbsvc@${PROJECT_ID}.iam.gserviceaccount.com"
SA_EXISTS=$(gcloud iam service-accounts list --project="$PROJECT_ID" --filter="email:$SA_EMAIL" --format="value(email)" 2>/dev/null || echo "")

if [ -z "$SA_EXISTS" ]; then
    # 別の形式を試す
    SA_EMAIL=$(gcloud iam service-accounts list --project="$PROJECT_ID" --filter="displayName:firebase-adminsdk" --format="value(email)" 2>/dev/null | head -1)
fi

if [ -z "$SA_EMAIL" ]; then
    log_error "Firebase Admin SDKサービスアカウントが見つかりません"
    log_warn "管理者ユーザーは手動で追加してください"
else
    # 一時キー作成
    TMP_KEY="/tmp/firebase-admin-key-$PROJECT_ID.json"
    gcloud iam service-accounts keys create "$TMP_KEY" \
        --iam-account="$SA_EMAIL" \
        --project="$PROJECT_ID" 2>/dev/null

    # 管理者ユーザー登録
    GOOGLE_APPLICATION_CREDENTIALS="$TMP_KEY" node << NODEJS_SCRIPT
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const serviceAccount = require('$TMP_KEY');
initializeApp({ credential: cert(serviceAccount), projectId: '$PROJECT_ID' });

const db = getFirestore();
const auth = getAuth();

async function main() {
    // アプリ設定を投入（ラベルは空で初期化、管理者が設定画面で追加）
    await db.doc('settings/app').set({
        targetLabels: [],
        labelSearchOperator: 'OR',
        errorNotificationEmails: ['$ADMIN_EMAIL'],
        gmailAccount: '$GMAIL_ACCOUNT',
        createdAt: new Date(),
        updatedAt: new Date()
    });
    console.log('✓ settings/app を作成');

    // Gmail認証設定（Service Account方式 - Google Workspace向け）
    await db.doc('settings/gmail').set({
        authMode: 'service_account',
        delegatedUserEmail: '$GMAIL_ACCOUNT',
        // OAuth方式を使う場合は authMode: 'oauth' に変更
        createdAt: new Date(),
        updatedAt: new Date()
    });
    console.log('✓ settings/gmail を作成 (Service Account方式)');

    // 管理者ユーザー（Firebase Authにユーザーがいれば取得）
    let uid = 'pending_admin';
    try {
        const user = await auth.getUserByEmail('$ADMIN_EMAIL');
        uid = user.uid;
        console.log('✓ 既存ユーザーを発見: ' + uid);
    } catch (e) {
        console.log('✓ ユーザーは初回ログイン時に作成されます');
    }

    await db.collection('users').doc(uid).set({
        email: '$ADMIN_EMAIL',
        name: '$ADMIN_EMAIL'.split('@')[0],
        role: 'admin',
        createdAt: new Date(),
        updatedAt: new Date()
    }, { merge: true });
    console.log('✓ 管理者ユーザーを登録: $ADMIN_EMAIL');
}

main().catch(console.error);
NODEJS_SCRIPT

    # 一時キー削除
    rm -f "$TMP_KEY"
    log_success "管理者ユーザー登録完了"
fi

# ===========================================
# Step 5: Firestore/Storageルールデプロイ
# ===========================================
echo ""
log_info "Step 5/7: セキュリティルール & インデックスデプロイ..."

cd "$ROOT_DIR"
firebase deploy --only firestore:rules,firestore:indexes,storage --project "$PROJECT_ID" 2>&1 | \
    grep -E "(✔|Error|Warning)" || true
log_success "ルール & インデックス デプロイ完了"

# ===========================================
# Step 6: Cloud Functionsデプロイ
# ===========================================
echo ""
log_info "Step 6/7: Cloud Functionsデプロイ..."

cd "$ROOT_DIR/functions"
npm run build 2>/dev/null || npm run build

cd "$ROOT_DIR"
firebase deploy --only functions --project "$PROJECT_ID" 2>&1 | \
    grep -E "(✔|Error|Warning|functions\[)" || true
log_success "Cloud Functions デプロイ完了"

# ===========================================
# Step 7: Hostingデプロイ
# ===========================================
echo ""
log_info "Step 7/7: フロントエンドビルド & デプロイ..."

cd "$ROOT_DIR"
npm run build 2>/dev/null || (cd frontend && npm run build)

firebase deploy --only hosting --project "$PROJECT_ID" 2>&1 | \
    grep -E "(✔|Error|Hosting URL)" || true
log_success "Hosting デプロイ完了"

# ===========================================
# 完了
# ===========================================
echo ""
echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   セットアップ完了！                       ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo ""
echo "アプリURL: https://${PROJECT_ID}.web.app"
echo ""
echo -e "${YELLOW}残りの手順:${NC}"
echo "  1. Gmail API認証設定（OAuth or Service Account）"
echo "     → scripts/setup-gmail-auth.sh $PROJECT_ID"
echo ""
echo "  2. マスターデータ投入（任意）"
echo "     → node scripts/import-masters.js --all scripts/samples/"
echo ""
echo "  3. 管理者が初回ログイン"
echo "     → $ADMIN_EMAIL でGoogleログイン"
echo ""
