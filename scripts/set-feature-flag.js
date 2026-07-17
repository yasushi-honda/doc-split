#!/usr/bin/env node
/**
 * settings/features フラグ設定スクリプト(GOAL.md task 8-1: 複数顧客FAX複製機能のflag制御)
 *
 * functions/src/utils/featureFlags.ts が読む settings/features ドキュメントにフラグを
 * merge書込みする。dev実機検証時のflag ON、kanameone本番展開時のflag ON化など、
 * 環境別feature flag切替の全用途で再利用する想定。本番Firestoreへ直接・不可逆に書込む
 * ため、KNOWN_FLAGSでのtypo検知・--dry-run・scripts/clients/*.envとの環境名照合による
 * 確認手段を用意している(/review-pr silent-failure-hunter指摘対応)。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=doc-split-dev node scripts/set-feature-flag.js --flag faxDuplication --value true
 *   FIREBASE_PROJECT_ID=doc-split-dev node scripts/set-feature-flag.js --flag faxDuplication --value true --dry-run
 *
 * オプション:
 *   --flag <name>   フラグ名(必須。KNOWN_FLAGSに存在するもののみ許可)
 *   --value <bool>  true または false(必須)
 *   --dry-run       書込みを行わず、対象(project/flag/現在値→新値)を表示して終了
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

/** functions/src/utils/featureFlags.ts が読むフラグ名と同期させること */
const KNOWN_FLAGS = ['faxDuplication'];

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
const dryRun = process.argv.includes('--dry-run');

if (!flag || (rawValue !== 'true' && rawValue !== 'false')) {
  console.error('--flag <name> --value <true|false> を指定してください');
  process.exit(1);
}

if (!KNOWN_FLAGS.includes(flag)) {
  console.error(`ERROR: 未知のフラグ名です: "${flag}"。既知のフラグ: ${KNOWN_FLAGS.join(', ')}`);
  console.error('functions/src/utils/featureFlags.ts の定義と一致するか確認してください(typoの可能性)。');
  process.exit(1);
}

const value = rawValue === 'true';

/**
 * scripts/clients/*.env の PROJECT_ID と照合し、対象がどのクライアント環境かを解決する。
 * 一致しない場合は未登録プロジェクトへの誤操作の可能性があるため中断する。
 */
function resolveClientName(targetProjectId) {
  const clientsDir = path.join(__dirname, 'clients');
  const envFiles = fs.readdirSync(clientsDir).filter((f) => f.endsWith('.env'));
  for (const file of envFiles) {
    const content = fs.readFileSync(path.join(clientsDir, file), 'utf8');
    const m = content.match(/^PROJECT_ID=["']?([^"'\r\n]+)["']?/m);
    if (m && m[1] === targetProjectId) {
      return file.replace(/\.env$/, '');
    }
  }
  return null;
}

const clientName = resolveClientName(projectId);
if (!clientName) {
  console.error(
    `ERROR: FIREBASE_PROJECT_ID="${projectId}" は scripts/clients/*.env のどのPROJECT_IDとも一致しません。`
  );
  console.error('誤ったプロジェクトへの書込みを防ぐため中断します。');
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

async function main() {
  const ref = db.doc('settings/features');
  const before = await ref.get();
  const currentValue = before.data()?.[flag];

  console.log(`環境: ${clientName} (project: ${projectId})`);
  console.log(`対象: settings/features.${flag}  現在値: ${JSON.stringify(currentValue)} → 新値: ${value}`);

  if (dryRun) {
    console.log('✅ DRY RUN 完了(書込みなし)。実行するには --dry-run を外してください。');
    return;
  }

  await ref.set({ [flag]: value }, { merge: true });
  const after = await ref.get();
  console.log(`✅ settings/features.${flag} = ${value} (project: ${projectId})`);
  console.log('現在の settings/features:', JSON.stringify(after.data()));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('ERROR:', err);
    process.exit(1);
  });
