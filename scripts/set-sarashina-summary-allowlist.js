#!/usr/bin/env node
/**
 * settings/features.sarashinaSummaryAllowlist 設定スクリプト(ADR-0027 PR5、Sarashina要約canary展開用)
 *
 * `functions/src/utils/featureFlags.ts`の`getSarashinaSummaryGate()`が読む
 * `settings/features.sarashinaSummaryAllowlist`にmerge書込みする。`settings/features.sarashinaSummary`
 * (L2フラグ本体)をONにしたうえで、対象docIdだけをSarashinaへ切替えるcanary展開に使う。
 *
 * `scripts/set-paddle-ocr-allowlist.js`(ADR-0025)を複製元とする(意図的に共通化しない、
 * ADR-0027の既存方針を踏襲)。差分点: dry-run出力に変更前後の差分件数を追加表示する
 * (PR5 plan-crossreview Medium指摘反映、誤操作の早期発見)。
 *
 * 3操作を明確に区別する:
 *   --set d1,d2,...  sarashinaSummaryAllowlist: [ids] をセット(canary展開用)
 *   --clear-empty    sarashinaSummaryAllowlist: [] をセット(全docId拒否、staging状態)
 *   --remove         sarashinaSummaryAllowlistフィールド自体を削除(全展開、制限なし)
 *                    ※ []にする(--clear-empty)と「全展開」ではなく「全拒否」になる点に注意。
 *                      全展開時は必ず --remove を使うこと。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=doc-split-dev node scripts/set-sarashina-summary-allowlist.js --set doc-id-1,doc-id-2
 *   FIREBASE_PROJECT_ID=doc-split-dev node scripts/set-sarashina-summary-allowlist.js --clear-empty
 *   FIREBASE_PROJECT_ID=doc-split-dev node scripts/set-sarashina-summary-allowlist.js --remove
 *   (いずれも --dry-run 併用可)
 */

const fs = require('fs');
const path = require('path');
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

const dryRun = process.argv.includes('--dry-run');
const setRaw = getArg('--set');
const clearEmpty = process.argv.includes('--clear-empty');
const remove = process.argv.includes('--remove');

const modeCount = [setRaw !== undefined, clearEmpty, remove].filter(Boolean).length;
if (modeCount !== 1) {
  console.error('--set <docId,...> / --clear-empty / --remove のいずれか1つを指定してください');
  process.exit(1);
}

let allowlist = null; // --remove時は使わない
if (setRaw !== undefined) {
  allowlist = setRaw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (allowlist.length === 0) {
    console.error('ERROR: --set には少なくとも1件のdocIdをカンマ区切りで指定してください(空にする場合は --clear-empty を使用)');
    process.exit(1);
  }
} else if (clearEmpty) {
  allowlist = [];
}

/**
 * scripts/clients/*.env の PROJECT_ID と照合し、対象がどのクライアント環境かを解決する。
 * 一致しない場合は未登録プロジェクトへの誤操作の可能性があるため中断する。
 * (set-feature-flag.js / set-paddle-ocr-allowlist.js resolveClientName() と同一ロジック)
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

/** 差分件数を人間に読める形で表示する(PR5 plan-crossreview Medium指摘反映)。 */
function describeDiff(before, after) {
  const beforeArr = Array.isArray(before) ? before : [];
  const afterArr = Array.isArray(after) ? after : [];
  const beforeSet = new Set(beforeArr);
  const afterSet = new Set(afterArr);
  const added = afterArr.filter((id) => !beforeSet.has(id));
  const removedIds = beforeArr.filter((id) => !afterSet.has(id));
  return `差分: 追加${added.length}件・削除${removedIds.length}件(変更前${beforeArr.length}件→変更後${afterArr.length}件)`;
}

admin.initializeApp({ projectId });
const db = admin.firestore();

async function main() {
  const ref = db.doc('settings/features');
  const before = await ref.get();
  const currentValue = before.data()?.sarashinaSummaryAllowlist;

  console.log(`環境: ${clientName} (project: ${projectId})`);
  if (remove) {
    console.log(
      `対象: settings/features.sarashinaSummaryAllowlist  現在値: ${JSON.stringify(currentValue)} → フィールド削除(制限なし=全展開)`
    );
    console.log(describeDiff(currentValue, []));
  } else {
    console.log(
      `対象: settings/features.sarashinaSummaryAllowlist  現在値: ${JSON.stringify(currentValue)} → 新値: ${JSON.stringify(allowlist)}` +
        (allowlist.length === 0 ? '  ※空配列=全docId拒否(staging用)であり全展開ではありません' : '')
    );
    console.log(describeDiff(currentValue, allowlist));
  }

  if (dryRun) {
    console.log('✅ DRY RUN 完了(書込みなし)。実行するには --dry-run を外してください。');
    return;
  }

  if (remove) {
    await ref.set({ sarashinaSummaryAllowlist: admin.firestore.FieldValue.delete() }, { merge: true });
  } else {
    await ref.set({ sarashinaSummaryAllowlist: allowlist }, { merge: true });
  }
  const after = await ref.get();
  console.log(`✅ settings/features.sarashinaSummaryAllowlist を更新しました (project: ${projectId})`);
  console.log('現在の settings/features:', JSON.stringify(after.data()));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('ERROR:', err);
    process.exit(1);
  });
