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
#   5. Firestore/Storageルールデプロイ + CORS設定
#   6. Cloud Functionsデプロイ
#   7. Hostingデプロイ
#
# ※ CORS設定: ブラウザからPDFを閲覧するために必須
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

# ===========================================
# 認証アカウント確認
# ===========================================
CURRENT_ACCOUNT=$(gcloud config get-value account 2>/dev/null)
echo -e "${YELLOW}現在のgcloud認証アカウント: ${CURRENT_ACCOUNT}${NC}"
echo ""
echo "このアカウントがプロジェクト '$PROJECT_ID' のオーナーまたは編集者である必要があります。"
echo ""

read -p "この設定で続行しますか？ (y/n): " CONFIRM
if [ "$CONFIRM" != "y" ]; then
    echo ""
    echo -e "${YELLOW}別アカウントで認証する場合:${NC}"
    echo "  gcloud auth login"
    echo "  gcloud config set account <owner-email>"
    echo ""
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
# Step 1.5: Cloud Functions SA に Vertex AI 権限付与
# ===========================================
echo ""
log_info "Step 1.5: Vertex AI 権限設定..."

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)" 2>/dev/null)
FUNCTIONS_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

log_info "Cloud Functions SA: $FUNCTIONS_SA"

# Vertex AI User ロール付与
if gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$FUNCTIONS_SA" \
    --role="roles/aiplatform.user" \
    --condition=None 2>/dev/null; then
    log_success "Vertex AI User 権限を付与しました"
else
    log_warn "Vertex AI 権限付与に失敗しました（既に設定済み、または権限不足）"
    echo ""
    echo -e "${YELLOW}権限不足の場合、プロジェクトオーナーで以下を実行してください:${NC}"
    echo "  gcloud projects add-iam-policy-binding $PROJECT_ID \\"
    echo "    --member=\"serviceAccount:$FUNCTIONS_SA\" \\"
    echo "    --role=\"roles/aiplatform.user\""
    echo ""
    read -p "続行しますか？ (y/n): " CONTINUE_IAM
    if [ "$CONTINUE_IAM" != "y" ]; then
        echo "キャンセルしました"
        exit 1
    fi
fi

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

# .firebasercにエイリアス追加（deploy-to-project.sh用）
ALIAS_NAME=$(echo "$PROJECT_ID" | sed 's/docsplit-//' | sed 's/-docsplit//')
if [ -f "$ROOT_DIR/.firebaserc" ]; then
    if ! grep -q "\"$ALIAS_NAME\"" "$ROOT_DIR/.firebaserc"; then
        log_info ".firebasercにエイリアス '$ALIAS_NAME' を追加中..."
        # jqがあれば使用、なければ手動追加の案内
        if command -v jq &> /dev/null; then
            jq ".projects.\"$ALIAS_NAME\" = \"$PROJECT_ID\"" "$ROOT_DIR/.firebaserc" > "$ROOT_DIR/.firebaserc.tmp" && \
                mv "$ROOT_DIR/.firebaserc.tmp" "$ROOT_DIR/.firebaserc"
            log_success "エイリアス追加完了: $ALIAS_NAME → $PROJECT_ID"
        else
            log_warn ".firebasercに手動でエイリアスを追加してください:"
            echo "  \"$ALIAS_NAME\": \"$PROJECT_ID\""
        fi
    else
        log_success "エイリアス '$ALIAS_NAME' は既に存在します"
    fi
fi

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
    # プロジェクト別の.envファイルを作成
    cat > "$ROOT_DIR/frontend/.env.$PROJECT_ID" << EOF
VITE_FIREBASE_API_KEY=$API_KEY
VITE_FIREBASE_AUTH_DOMAIN=$AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID=$PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET=$STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID=$MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID=$APP_ID
EOF
    # ローカル開発用にもコピー
    cp "$ROOT_DIR/frontend/.env.$PROJECT_ID" "$ROOT_DIR/frontend/.env.local"
    log_success "frontend/.env.$PROJECT_ID を生成しました"
else
    log_warn "frontend/.env.<project-id> の手動設定が必要です"
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
    // 許可ドメインを管理者メールアドレスから抽出
    const adminDomain = '$ADMIN_EMAIL'.split('@')[1];

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

    // 認証設定（許可ドメインリスト）
    await db.doc('settings/auth').set({
        allowedDomains: [adminDomain],
        createdAt: new Date(),
        updatedAt: new Date()
    });
    console.log('✓ settings/auth を作成 (許可ドメイン: ' + adminDomain + ')');

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

    // 書類種別シードデータを投入
    const documentTypeSeeds = [
        { name: 'フェースシート', dateMarker: '作成日', category: '基本情報', keywords: ['フェイスシート', '基本情報', '利用者情報'] },
        { name: '介護保険被保険者証', dateMarker: '有効期限', category: '保険証', keywords: ['被保険者証', '介護保険', '要介護'] },
        { name: '負担割合証', dateMarker: '適用期間', category: '保険証', keywords: ['負担割合', '利用者負担'] },
        { name: '居宅サービス計画書（1）', dateMarker: '作成年月日', category: 'ケアプラン', keywords: ['居宅サービス計画', '援助の方針'] },
        { name: '居宅サービス計画書（2）', dateMarker: '作成年月日', category: 'ケアプラン', keywords: ['週間サービス計画表'] },
        { name: 'サービス担当者会議の要点', dateMarker: '開催日', category: '会議録', keywords: ['サービス担当者会議', '会議の要点'] },
        { name: '訪問介護計画書', dateMarker: '作成日', category: 'サービス計画', keywords: ['訪問介護', 'サービス内容'] },
        { name: '訪問看護計画書', dateMarker: '作成日', category: 'サービス計画', keywords: ['訪問看護', '看護計画'] },
        { name: '通所介護計画書', dateMarker: '作成日', category: 'サービス計画', keywords: ['通所介護', 'デイサービス'] },
        { name: '福祉用具貸与計画書', dateMarker: '作成日', category: 'サービス計画', keywords: ['福祉用具', '貸与'] },
        { name: '住宅改修理由書', dateMarker: '作成日', category: '申請書類', keywords: ['住宅改修', '理由書'] },
        { name: '主治医意見書', dateMarker: '記載日', category: '医療', keywords: ['主治医', '意見書', '要介護認定'] },
        { name: '診断書', dateMarker: '発行日', category: '医療', keywords: ['診断書', '診断名'] },
        { name: '情報提供書', dateMarker: '発行日', category: '医療', keywords: ['情報提供', '病状'] },
        { name: '同意書', dateMarker: '同意日', category: '契約', keywords: ['同意書', '重要事項説明'] },
        { name: '契約書', dateMarker: '契約日', category: '契約', keywords: ['契約書', '利用契約'] },
    ];

    let imported = 0;
    for (const seed of documentTypeSeeds) {
        const docRef = db.doc('masters/documents/items/' + seed.name);
        const existing = await docRef.get();
        if (!existing.exists) {
            await docRef.set(seed);
            imported++;
        }
    }
    console.log('✓ 書類種別マスター: ' + imported + '件追加 (シード ' + documentTypeSeeds.length + '件中)');
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

# インデックスビルド待機
log_info "インデックスのビルドを待機中..."
MAX_WAIT=180  # 最大3分待機
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
    CREATING=$(gcloud firestore indexes composite list --project="$PROJECT_ID" --filter="state=CREATING" --format="value(name)" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$CREATING" -eq 0 ]; then
        log_success "全インデックスがREADY状態です"
        break
    fi
    echo "  ビルド中のインデックス: ${CREATING}件 (${WAITED}秒経過)"
    sleep 10
    WAITED=$((WAITED + 10))
done

if [ $WAITED -ge $MAX_WAIT ]; then
    log_warn "インデックスのビルドに時間がかかっています。バックグラウンドで継続中です。"
fi

# Storage CORS設定
log_info "Storage CORS設定中..."
STORAGE_BUCKET="${PROJECT_ID}.firebasestorage.app"
CORS_FILE="$ROOT_DIR/cors-${PROJECT_ID}.json"

cat > "$CORS_FILE" << EOF
[
  {
    "origin": ["https://${PROJECT_ID}.web.app", "http://localhost:5173", "http://localhost:4173"],
    "method": ["GET", "HEAD"],
    "maxAgeSeconds": 3600,
    "responseHeader": ["Content-Type", "Content-Length", "Content-Disposition"]
  }
]
EOF

if gsutil cors set "$CORS_FILE" "gs://${STORAGE_BUCKET}" 2>/dev/null; then
    log_success "Storage CORS設定完了（ブラウザからPDF閲覧可能）"
else
    log_warn "CORS設定に失敗しました。手動で設定してください:"
    log_warn "  gsutil cors set $CORS_FILE gs://${STORAGE_BUCKET}"
fi

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
echo "  2. Gmail監視ラベル設定（重要）"
echo "     → アプリにログイン後、設定画面で監視対象ラベルを追加"
echo "     → 例: AI_OCR, 書類管理 など"
echo ""
echo "  3. マスターデータ投入（任意）"
echo "     → node scripts/import-masters.js --all scripts/samples/"
echo "     → または管理画面からCSVインポート"
echo ""
echo "  4. 管理者が初回ログイン"
echo "     → $ADMIN_EMAIL でGoogleログイン"
echo ""
