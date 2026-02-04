#!/bin/bash
#
# DocSplit 納品検証スクリプト
#
# 使用方法:
#   ./verify-setup.sh <project-id>
#
# 説明:
#   プロジェクトのセットアップ状態を検証し、不足項目を報告する。
#   納品チェックリストの自動化版。
#
# 出力:
#   全て合格の場合: exit 0
#   警告のみの場合: exit 0
#   1つでも失敗の場合: exit 1
#

set -e

# カラー定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 結果カウンター
PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0

# チェック結果記録
check_pass() {
    echo -e "[${GREEN}✓${NC}] $1"
    PASS_COUNT=$((PASS_COUNT + 1))
}

check_warn() {
    echo -e "[${YELLOW}⚠${NC}] $1"
    WARN_COUNT=$((WARN_COUNT + 1))
}

check_fail() {
    echo -e "[${RED}✗${NC}] $1"
    FAIL_COUNT=$((FAIL_COUNT + 1))
}

# 使用方法
usage() {
    echo "Usage: $0 <project-id>"
    echo ""
    echo "Arguments:"
    echo "  project-id    検証対象のGCP/Firebaseプロジェクト"
    echo ""
    echo "Example:"
    echo "  $0 doc-split-dev"
    echo "  $0 docsplit-kanameone"
    exit 1
}

# 引数チェック
if [ $# -lt 1 ]; then
    usage
fi

PROJECT_ID=$1
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   DocSplit 納品検証                        ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo ""
echo "Project: $PROJECT_ID"
echo ""

# ===========================================
# 1. GCPプロジェクト存在確認
# ===========================================
if gcloud projects describe "$PROJECT_ID" &>/dev/null; then
    check_pass "GCPプロジェクト存在"
else
    check_fail "GCPプロジェクトが存在しません: $PROJECT_ID"
    echo ""
    echo -e "${RED}プロジェクトが見つかりません。終了します。${NC}"
    exit 1
fi

# ===========================================
# 2. 課金アカウント確認
# ===========================================
BILLING_INFO=$(gcloud beta billing projects describe "$PROJECT_ID" --format="value(billingAccountName)" 2>/dev/null || echo "")
if [ -n "$BILLING_INFO" ]; then
    check_pass "課金アカウント紐付け"
else
    check_fail "課金アカウントが紐付けられていません"
fi

# ===========================================
# 3. Firebase Authentication / Authorized Domains
# ===========================================
ACCESS_TOKEN=$(gcloud auth print-access-token 2>/dev/null || echo "")
if [ -n "$ACCESS_TOKEN" ]; then
    AUTH_CONFIG=$(curl -s \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "X-Goog-User-Project: $PROJECT_ID" \
        "https://identitytoolkit.googleapis.com/admin/v2/projects/$PROJECT_ID/config" 2>/dev/null)

    if echo "$AUTH_CONFIG" | grep -q "authorizedDomains"; then
        DOMAIN_COUNT=$(echo "$AUTH_CONFIG" | grep -o '"authorizedDomains"' | wc -l | tr -d ' ')
        DOMAINS=$(echo "$AUTH_CONFIG" | grep -o '"[^"]*\.web\.app"' | tr -d '"' | head -1)
        if [ -n "$DOMAINS" ]; then
            check_pass "Firebase Authentication有効化"
            # Authorized Domainsの詳細確認
            if echo "$AUTH_CONFIG" | grep -q "${PROJECT_ID}.web.app"; then
                check_pass "Authorized Domains設定 (${PROJECT_ID}.web.app)"
            else
                check_warn "Authorized Domainsに ${PROJECT_ID}.web.app がありません"
            fi
        else
            check_warn "Firebase Authentication設定を確認してください"
        fi
    else
        check_fail "Firebase Authenticationが未設定"
    fi
else
    check_warn "gcloud認証トークン取得失敗（Authorized Domains確認スキップ）"
fi

# ===========================================
# 4. Gmail OAuth Secret確認
# ===========================================
GMAIL_SECRETS_OK=true
for SECRET in gmail-oauth-client-id gmail-oauth-client-secret gmail-oauth-refresh-token; do
    if gcloud secrets describe "$SECRET" --project="$PROJECT_ID" &>/dev/null; then
        :
    else
        GMAIL_SECRETS_OK=false
        break
    fi
done

if [ "$GMAIL_SECRETS_OK" = true ]; then
    check_pass "Gmail OAuth Secret設定 (3件)"
else
    # Service Account方式かもしれないのでワーニングにする
    check_warn "Gmail OAuth Secretが未設定（Service Account方式なら正常）"
fi

# ===========================================
# 5. Cloud Functions確認
# ===========================================
# gcloud functions listを使用（firebaseより高速）
FUNC_COUNT=$(gcloud functions list --project="$PROJECT_ID" --format="value(name)" 2>/dev/null | wc -l | tr -d ' ')
if [ "$FUNC_COUNT" -gt 5 ]; then
    check_pass "Cloud Functions デプロイ済み (${FUNC_COUNT}関数)"
elif [ "$FUNC_COUNT" -gt 0 ]; then
    check_warn "Cloud Functions数が少ない可能性 (${FUNC_COUNT}関数)"
else
    check_fail "Cloud Functionsがデプロイされていません"
fi

# ===========================================
# 6. Firebase Hosting確認
# ===========================================
HOSTING_URL="https://${PROJECT_ID}.web.app"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$HOSTING_URL" 2>/dev/null || echo "000")
if [ "$HTTP_STATUS" = "200" ]; then
    check_pass "Firebase Hosting (${HOSTING_URL})"
elif [ "$HTTP_STATUS" = "401" ] || [ "$HTTP_STATUS" = "403" ]; then
    # 認証が必要なページはOK
    check_pass "Firebase Hosting (認証必要)"
else
    check_fail "Firebase Hostingにアクセスできません (HTTP $HTTP_STATUS)"
fi

# ===========================================
# 7-11. Firestore設定確認（サービスアカウントキーが必要）
# ===========================================
echo ""
echo -e "${BLUE}Firestore設定を確認中...${NC}"

# firebase-adminsdk サービスアカウントを探す
SA_EMAIL=$(gcloud iam service-accounts list --project="$PROJECT_ID" --filter="displayName:firebase-adminsdk" --format="value(email)" 2>/dev/null | head -1)

if [ -z "$SA_EMAIL" ]; then
    SA_EMAIL="firebase-adminsdk-fbsvc@${PROJECT_ID}.iam.gserviceaccount.com"
fi

# 一時キー作成（存在確認用）
TMP_KEY="/tmp/verify-setup-key-$$.json"
KEY_CREATED=false

if gcloud iam service-accounts keys create "$TMP_KEY" --iam-account="$SA_EMAIL" --project="$PROJECT_ID" 2>/dev/null; then
    KEY_CREATED=true
fi

if [ "$KEY_CREATED" = true ]; then
    # Node.jsでFirestore確認
    FIRESTORE_CHECK=$(GOOGLE_APPLICATION_CREDENTIALS="$TMP_KEY" node << 'NODEJS_SCRIPT' 2>/dev/null
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

async function main() {
    const result = {
        settingsApp: false,
        settingsAuth: false,
        settingsGmail: false,
        adminUser: false,
        masterCustomers: 0,
        masterDocuments: 0,
        masterOffices: 0,
        masterCaremanagers: 0
    };

    try {
        const serviceAccount = require(process.env.GOOGLE_APPLICATION_CREDENTIALS);
        initializeApp({ credential: cert(serviceAccount) });
        const db = getFirestore();

        // settings確認
        const appDoc = await db.doc('settings/app').get();
        result.settingsApp = appDoc.exists;

        const authDoc = await db.doc('settings/auth').get();
        result.settingsAuth = authDoc.exists;

        const gmailDoc = await db.doc('settings/gmail').get();
        result.settingsGmail = gmailDoc.exists;

        // 管理者ユーザー確認
        const users = await db.collection('users').where('role', '==', 'admin').limit(1).get();
        result.adminUser = !users.empty;

        // マスターデータ件数
        const customers = await db.collection('masters/customers/items').count().get();
        result.masterCustomers = customers.data().count;

        const documents = await db.collection('masters/documents/items').count().get();
        result.masterDocuments = documents.data().count;

        const offices = await db.collection('masters/offices/items').count().get();
        result.masterOffices = offices.data().count;

        const caremanagers = await db.collection('masters/caremanagers/items').count().get();
        result.masterCaremanagers = caremanagers.data().count;

    } catch (e) {
        // エラーは無視
    }

    console.log(JSON.stringify(result));
}

main();
NODEJS_SCRIPT
)

    # 一時キー削除
    rm -f "$TMP_KEY"

    if [ -n "$FIRESTORE_CHECK" ]; then
        # 結果をパース
        SETTINGS_APP=$(echo "$FIRESTORE_CHECK" | grep -o '"settingsApp":true' || echo "")
        SETTINGS_AUTH=$(echo "$FIRESTORE_CHECK" | grep -o '"settingsAuth":true' || echo "")
        SETTINGS_GMAIL=$(echo "$FIRESTORE_CHECK" | grep -o '"settingsGmail":true' || echo "")
        ADMIN_USER=$(echo "$FIRESTORE_CHECK" | grep -o '"adminUser":true' || echo "")

        # settings/app
        if [ -n "$SETTINGS_APP" ]; then
            check_pass "settings/app 設定済み"
        else
            check_fail "settings/app が未設定"
        fi

        # settings/auth
        if [ -n "$SETTINGS_AUTH" ]; then
            check_pass "settings/auth 設定済み"
        else
            check_fail "settings/auth が未設定"
        fi

        # settings/gmail
        if [ -n "$SETTINGS_GMAIL" ]; then
            check_pass "settings/gmail 設定済み"
        else
            check_warn "settings/gmail が未設定（Gmail連携未設定）"
        fi

        # 管理者ユーザー
        if [ -n "$ADMIN_USER" ]; then
            check_pass "管理者ユーザー登録済み"
        else
            check_fail "管理者ユーザーが未登録"
        fi

        # マスターデータ
        CUSTOMERS=$(echo "$FIRESTORE_CHECK" | grep -o '"masterCustomers":[0-9]*' | cut -d: -f2)
        DOCUMENTS=$(echo "$FIRESTORE_CHECK" | grep -o '"masterDocuments":[0-9]*' | cut -d: -f2)
        OFFICES=$(echo "$FIRESTORE_CHECK" | grep -o '"masterOffices":[0-9]*' | cut -d: -f2)
        CAREMANAGERS=$(echo "$FIRESTORE_CHECK" | grep -o '"masterCaremanagers":[0-9]*' | cut -d: -f2)

        CUSTOMERS=${CUSTOMERS:-0}
        DOCUMENTS=${DOCUMENTS:-0}
        OFFICES=${OFFICES:-0}
        CAREMANAGERS=${CAREMANAGERS:-0}

        if [ "$CUSTOMERS" -gt 0 ] || [ "$DOCUMENTS" -gt 0 ]; then
            check_pass "マスターデータ (顧客: ${CUSTOMERS}, 書類種別: ${DOCUMENTS}, 事業所: ${OFFICES}, ケアマネ: ${CAREMANAGERS})"
        else
            check_warn "マスターデータが未投入（本番環境なら正常）"
        fi
    else
        check_warn "Firestore確認に失敗しました"
    fi
else
    rm -f "$TMP_KEY" 2>/dev/null
    check_warn "サービスアカウントキー作成失敗（Firestore確認スキップ）"
fi

# ===========================================
# 12. Storage CORS確認
# ===========================================
STORAGE_BUCKET="${PROJECT_ID}.firebasestorage.app"
CORS_CONFIG=$(gsutil cors get "gs://${STORAGE_BUCKET}" 2>/dev/null || echo "")
if echo "$CORS_CONFIG" | grep -q "web.app"; then
    check_pass "Storage CORS設定済み"
elif [ -n "$CORS_CONFIG" ] && [ "$CORS_CONFIG" != "[]" ]; then
    check_warn "Storage CORS設定を確認してください"
else
    check_fail "Storage CORS未設定（ブラウザからPDF閲覧不可）"
fi

# ===========================================
# サマリー出力
# ===========================================
echo ""
echo "══════════════════════════════════════════════"
TOTAL=$((PASS_COUNT + WARN_COUNT + FAIL_COUNT))
echo -e "結果: ${GREEN}${PASS_COUNT}${NC}/${TOTAL} チェック合格"

if [ "$WARN_COUNT" -gt 0 ]; then
    echo -e "      ${YELLOW}${WARN_COUNT}${NC} 件の警告"
fi

if [ "$FAIL_COUNT" -gt 0 ]; then
    echo -e "      ${RED}${FAIL_COUNT}${NC} 件の失敗"
fi

# 失敗がある場合の対処法
if [ "$FAIL_COUNT" -gt 0 ]; then
    echo ""
    echo -e "${RED}失敗項目があります。以下を確認してください:${NC}"
    echo ""
    echo "  課金アカウント未設定:"
    echo "    → GCP Console で課金アカウントを紐付け"
    echo ""
    echo "  Cloud Functions未デプロイ:"
    echo "    → firebase deploy --only functions -P $PROJECT_ID"
    echo ""
    echo "  Firestore設定未完了:"
    echo "    → ./scripts/setup-tenant.sh $PROJECT_ID <admin-email>"
    echo ""
    echo "  Storage CORS未設定:"
    echo "    → gsutil cors set cors-${PROJECT_ID}.json gs://${STORAGE_BUCKET}"
fi

# 警告のみの場合のアドバイス
if [ "$FAIL_COUNT" -eq 0 ] && [ "$WARN_COUNT" -gt 0 ]; then
    echo ""
    echo -e "${YELLOW}警告項目について:${NC}"
    echo "  - Gmail OAuth未設定 → Gmail連携が不要なら問題なし"
    echo "  - マスターデータ未投入 → 本番環境なら正常（クライアントから受領後に投入）"
fi

# 全て成功の場合
if [ "$FAIL_COUNT" -eq 0 ] && [ "$WARN_COUNT" -eq 0 ]; then
    echo ""
    echo -e "${GREEN}全てのチェックに合格しました！${NC}"
fi

echo ""

# 終了コード
if [ "$FAIL_COUNT" -gt 0 ]; then
    exit 1
else
    exit 0
fi
