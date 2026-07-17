#!/usr/bin/env node
/**
 * settings/features フラグ設定スクリプト(GOAL.md task 8: 複数顧客FAX複製機能のflag制御)
 *
 * functions/src/utils/featureFlags.ts が読む settings/features ドキュメントに
 * 任意のフラグをmerge書込みする。dev実機検証時のflag ON、kanameone本番展開時の
 * flag ON、cocoroのflag OFF維持確認など、環境別feature flag切替の全用途で再利用する。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=doc-split-dev node scripts/set-feature-flag.js --flag faxDuplication --value true
 *
 * オプション:
 *   --flag <name>   フラグ名(必須。例: faxDuplication)
 *   --value <bool>  true または false(必須)
 */

const admin = require('firebase-admin');

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID を設定してください');
  process.exit(1);
}

function getArg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const flag = getArg('--flag');
const rawValue = getArg('--value');

if (!flag || (rawValue !== 'true' && rawValue !== 'false')) {
  console.error('--flag <name> --value <true|false> を指定してください');
  process.exit(1);
}

const value = rawValue === 'true';

admin.initializeApp({ projectId });
const db = admin.firestore();

async function main() {
  const ref = db.doc('settings/features');
  await ref.set({ [flag]: value }, { merge: true });
  const snap = await ref.get();
  console.log(`✅ settings/features.${flag} = ${value} (project: ${projectId})`);
  console.log('現在の settings/features:', JSON.stringify(snap.data()));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('ERROR:', err);
    process.exit(1);
  });
