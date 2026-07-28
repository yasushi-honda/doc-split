#!/usr/bin/env node
/**
 * Drive連携済みdocumentの姓名スペース表記ゆれ監査スクリプト（read-only）
 *
 * PR #752(functions/src/drive/folderPath.ts)で、customerName/careManagerNameの
 * 内部スペース(全角/半角)を除去してフォルダ名解決するよう修正した。この修正前に
 * 既にdriveFileIdが書き込まれているdocumentの中に、正規化後は同一人物になるが
 * 異なる表記(customerName/careManagerName)でフォルダが作成/参照されている組が
 * 残っていないかを確認する。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=<project-id> node scripts/audit-drive-folder-space-variants.js
 */

const admin = require('firebase-admin');

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID を設定してください');
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

function stripInternalSpaces(name) {
  return (name || '').replace(/[\s　]+/g, '');
}

function reportVariants(label, snap, field) {
  const byNormalized = new Map();
  snap.forEach((doc) => {
    const value = doc.data()[field];
    if (!value) return;
    const normalized = stripInternalSpaces(value);
    if (!normalized) return;
    if (!byNormalized.has(normalized)) byNormalized.set(normalized, new Set());
    byNormalized.get(normalized).add(value);
  });

  let foundAny = false;
  for (const [normalized, variants] of byNormalized.entries()) {
    if (variants.size > 1) {
      foundAny = true;
      console.log(
        `[${label}] 表記ゆれ検出: 正規化後="${normalized}" 実際の表記=${JSON.stringify([...variants])}`
      );
    }
  }
  if (!foundAny) {
    console.log(`[${label}] OK: driveFileId設定済みdocument間で表記ゆれの重複は検出されませんでした`);
  }
}

async function main() {
  const snap = await db.collection('documents').get();
  const exported = snap.docs.filter((doc) => !!doc.data().driveFileId);
  console.log(`documents全件: ${snap.size} / driveFileId設定済み: ${exported.length}`);

  reportVariants('customerName', exported, 'customerName');
  reportVariants('careManagerName', exported, 'careManagerName');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
