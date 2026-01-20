#!/bin/bash
#
# DocSplit Gmail Service Account設定スクリプト
#
# Google Workspace向け - Service Account + Domain-wide Delegation方式
#
# 使用方法:
#   ./setup-gmail-service-account.sh <project-id> <delegated-email>
#
# 事前準備:
#   - Google Workspace管理者権限が必要
#   - Admin Console へのアクセス権限が必要
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

if [ $# -lt 2 ]; then
    echo "Usage: $0 <project-id> <delegated-email>"
    echo ""
    echo "Arguments:"
    echo "  project-id       GCPプロジェクトID"
    echo "  delegated-email  Gmail監視対象のメールアドレス（Workspace内）"
    echo ""
    echo "Example:"
    echo "  $0 my-project-prod admin@company.com"
    exit 1
fi

PROJECT_ID=$1
DELEGATED_EMAIL=$2
SA_NAME="gmail-reader"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo ""
echo -e "${GREEN}=== DocSplit Gmail Service Account設定 ===${NC}"
echo ""
echo "Project ID: $PROJECT_ID"
echo "Delegated Email: $DELEGATED_EMAIL"
echo "Service Account: $SA_EMAIL"
echo ""

# ===========================================
# Service Account作成
# ===========================================
log_info "Service Accountを作成中..."

if gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT_ID" &>/dev/null; then
    log_warn "Service Account already exists: $SA_EMAIL"
else
    gcloud iam service-accounts create "$SA_NAME" \
        --display-name="Gmail Reader for DocSplit" \
        --description="Gmail添付ファイル取得用（Domain-wide Delegation）" \
        --project="$PROJECT_ID"
    log_success "Service Account created: $SA_EMAIL"
fi

# ===========================================
# Domain-wide Delegation有効化
# ===========================================
log_info "Domain-wide Delegationを有効化中..."

# Service AccountのuniqueName取得
SA_UNIQUE_ID=$(gcloud iam service-accounts describe "$SA_EMAIL" \
    --project="$PROJECT_ID" \
    --format="value(uniqueId)")

echo ""
echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}  Admin Console で手動設定が必要です  ${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""
echo "以下の手順でGoogle Workspace Admin Consoleで設定してください:"
echo ""
echo "1. Admin Consoleを開く:"
echo "   https://admin.google.com"
echo ""
echo "2. 「セキュリティ」→「アクセスとデータ管理」→「APIの制御」→「ドメイン全体の委任」"
echo ""
echo "3. 「新しく追加」をクリック"
echo ""
echo "4. 以下の値を入力:"
echo -e "   ${GREEN}クライアントID:${NC} $SA_UNIQUE_ID"
echo -e "   ${GREEN}OAuthスコープ:${NC} https://www.googleapis.com/auth/gmail.readonly"
echo ""
echo "5. 「承認」をクリック"
echo ""
echo -e "${YELLOW}設定完了後、Enterを押して続行してください...${NC}"
read -p ""

# ===========================================
# Firestoreに設定保存
# ===========================================
log_info "Firestoreに設定を保存中..."

# 一時ファイルで設定
TEMP_SETTINGS=$(mktemp)
cat > "$TEMP_SETTINGS" << EOF
{
  "authMode": "service_account",
  "delegatedUserEmail": "$DELEGATED_EMAIL",
  "serviceAccountEmail": "$SA_EMAIL"
}
EOF

# Firebase CLIでFirestoreに書き込み
# Note: Firebase CLIでは直接書き込みできないため、Node.jsスクリプトを使用
TEMP_SCRIPT=$(mktemp).js
cat > "$TEMP_SCRIPT" << 'SCRIPT_EOF'
const admin = require('firebase-admin');
const fs = require('fs');

const projectId = process.argv[2];
const delegatedEmail = process.argv[3];
const serviceAccountEmail = process.argv[4];

process.env.GCLOUD_PROJECT = projectId;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId });

admin.initializeApp({
  projectId: projectId
});

const db = admin.firestore();

async function updateSettings() {
  try {
    await db.doc('settings/gmail').set({
      authMode: 'service_account',
      delegatedUserEmail: delegatedEmail,
      serviceAccountEmail: serviceAccountEmail,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    console.log('Firestore settings updated successfully');
  } catch (error) {
    console.error('Failed to update Firestore:', error.message);
    process.exit(1);
  }
}

updateSettings().then(() => process.exit(0));
SCRIPT_EOF

# Node.jsスクリプト実行
cd "$(dirname "$0")/.."
if [ -f "functions/node_modules/firebase-admin/package.json" ]; then
    node -e "
const admin = require('./functions/node_modules/firebase-admin');
process.env.GCLOUD_PROJECT = '$PROJECT_ID';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: '$PROJECT_ID' });
admin.initializeApp({ projectId: '$PROJECT_ID' });
const db = admin.firestore();
db.doc('settings/gmail').set({
  authMode: 'service_account',
  delegatedUserEmail: '$DELEGATED_EMAIL',
  serviceAccountEmail: '$SA_EMAIL',
  updatedAt: admin.firestore.FieldValue.serverTimestamp()
}, { merge: true })
.then(() => { console.log('Firestore updated'); process.exit(0); })
.catch(e => { console.error(e); process.exit(1); });
"
    log_success "Firestore settings updated"
else
    log_warn "firebase-admin not found. Please update Firestore manually:"
    echo ""
    echo "Collection: settings"
    echo "Document: gmail"
    echo "Fields:"
    echo "  authMode: 'service_account'"
    echo "  delegatedUserEmail: '$DELEGATED_EMAIL'"
    echo "  serviceAccountEmail: '$SA_EMAIL'"
fi

rm -f "$TEMP_SETTINGS" "$TEMP_SCRIPT" 2>/dev/null || true

# ===========================================
# Cloud Functionsサービスアカウントに権限付与
# ===========================================
log_info "IAM権限を設定中..."

# Cloud Functions実行用サービスアカウント
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)" 2>/dev/null)
FUNCTIONS_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# Gmail ReaderのService Accountをimpersonateできるようにする
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
    --member="serviceAccount:$FUNCTIONS_SA" \
    --role="roles/iam.serviceAccountTokenCreator" \
    --project="$PROJECT_ID" 2>/dev/null || true

log_success "IAM権限設定完了"

# ===========================================
# 完了
# ===========================================
echo ""
echo -e "${GREEN}=== Gmail Service Account設定完了 ===${NC}"
echo ""
echo "設定内容:"
echo "  認証方式: Service Account + Domain-wide Delegation"
echo "  監視対象: $DELEGATED_EMAIL"
echo "  Service Account: $SA_EMAIL"
echo ""
echo "Cloud Functionsを再デプロイしてください:"
echo "  firebase deploy --only functions --project $PROJECT_ID"
echo ""
echo "デプロイ後、checkGmailAttachments関数がGmailにアクセスできるようになります。"
echo ""
