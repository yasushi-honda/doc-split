#!/bin/bash
#
# DocSplit プロジェクト初期設定スクリプト（サポート用）
#
# 使用方法:
#   ./init-project.sh
#
# 設定する項目:
#   - 監視対象Gmailラベル
#   - 管理者メールアドレス
#   - 監視対象Gmailアカウント
#   - 初期管理者ユーザー
#

set -e

# カラー定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== DocSplit プロジェクト初期設定 ===${NC}"
echo ""

# Firebase CLI確認
if ! command -v firebase &> /dev/null; then
    echo -e "${RED}Error: Firebase CLI がインストールされていません${NC}"
    echo "インストール: npm install -g firebase-tools"
    exit 1
fi

# プロジェクト確認
echo -e "${YELLOW}現在のFirebaseプロジェクト:${NC}"
firebase projects:list

echo ""
read -p "設定対象のプロジェクトID: " PROJECT_ID

if [ -z "$PROJECT_ID" ]; then
    echo -e "${RED}Error: プロジェクトIDを入力してください${NC}"
    exit 1
fi

# プロジェクト切り替え
firebase use "$PROJECT_ID"

echo ""
echo -e "${GREEN}=== Gmail設定 ===${NC}"
read -p "監視対象Gmailアカウント (例: support@company.com): " GMAIL_ACCOUNT
read -p "監視対象ラベル (カンマ区切り、例: 請求書,領収書): " LABELS_INPUT
read -p "管理者メールアドレス: " ADMIN_EMAIL

# ラベルを配列に変換
IFS=',' read -ra LABELS <<< "$LABELS_INPUT"
LABELS_JSON=$(printf '%s\n' "${LABELS[@]}" | jq -R . | jq -s .)

echo ""
echo -e "${GREEN}=== Firestore初期データ投入 ===${NC}"

# 設定データを作成
cat << EOF > /tmp/docsplit-settings.json
{
  "targetLabels": $LABELS_JSON,
  "labelSearchOperator": "OR",
  "errorNotificationEmails": ["$ADMIN_EMAIL"],
  "gmailAccount": "$GMAIL_ACCOUNT"
}
EOF

echo "設定内容:"
cat /tmp/docsplit-settings.json

echo ""
read -p "この設定でFirestoreに投入しますか？ (y/n): " CONFIRM

if [ "$CONFIRM" != "y" ]; then
    echo "キャンセルしました"
    exit 0
fi

# Firestoreに投入（firebase-admin使用）
echo ""
echo -e "${YELLOW}Firestoreにデータを投入中...${NC}"

# Node.jsスクリプトで投入
node << 'NODEJS_SCRIPT'
const admin = require('firebase-admin');
const fs = require('fs');

admin.initializeApp({
  projectId: process.env.PROJECT_ID
});

const db = admin.firestore();
const settings = JSON.parse(fs.readFileSync('/tmp/docsplit-settings.json', 'utf8'));

async function main() {
  // 設定を投入
  await db.doc('settings/app').set(settings);
  console.log('✓ settings/app を作成しました');

  // 管理者ユーザーを作成（UIDは後で更新）
  const adminEmail = process.env.ADMIN_EMAIL;
  const userRef = db.collection('users').doc('admin-placeholder');
  await userRef.set({
    email: adminEmail,
    role: 'admin',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    lastLoginAt: null
  });
  console.log(`✓ 管理者ユーザー (${adminEmail}) を作成しました`);
  console.log('  ※ 初回ログイン後にUIDが更新されます');
}

main().then(() => {
  console.log('\n初期設定が完了しました！');
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
NODEJS_SCRIPT

echo ""
echo -e "${GREEN}=== 初期設定完了 ===${NC}"
echo ""
echo "次のステップ:"
echo "  1. Firebase Console で Authentication を確認"
echo "  2. 管理者が初回ログイン後、users コレクションのUIDを更新"
echo "  3. マスターデータをインポート: node scripts/import-masters.js"
echo ""
