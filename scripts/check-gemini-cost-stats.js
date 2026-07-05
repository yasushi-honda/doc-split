#!/usr/bin/env node
/**
 * Geminiコスト計測基盤の検証スクリプト（read-only）
 *
 * Issue #546 (SDK移行 + thinking制御) のdev環境検証用。
 * stats/gemini/daily/{date} の集計値（bySource内訳含む）と、
 * 直近処理済みドキュメントのメタ情報をJSONで出力する。書き込みは一切行わない。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=doc-split-dev node scripts/check-gemini-cost-stats.js
 *   FIREBASE_PROJECT_ID=doc-split-dev node scripts/check-gemini-cost-stats.js --days 3 --doc-limit 20
 */

const admin = require('firebase-admin');

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID を設定してください');
  process.exit(1);
}

function getOpt(name, fallback) {
  const i = process.argv.indexOf(name);
  const v = i >= 0 && i + 1 < process.argv.length ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const days = getOpt('--days', 5);
const docLimit = getOpt('--doc-limit', 15);

admin.initializeApp({ projectId });
const db = admin.firestore();

async function main() {
  console.log(`=== stats/gemini/daily (project: ${projectId}, last ${days} days) ===`);
  const dailySnap = await db.collection('stats/gemini/daily').orderBy('date', 'desc').limit(days).get();
  if (dailySnap.empty) {
    console.log('(no daily stats docs found)');
  } else {
    dailySnap.forEach((doc) => {
      console.log(`--- ${doc.id} ---`);
      console.log(JSON.stringify(doc.data(), null, 2));
    });
  }

  console.log(`\n=== recent documents (by processedAt desc, limit ${docLimit}) ===`);
  const docsSnap = await db.collection('documents').orderBy('processedAt', 'desc').limit(docLimit).get();
  if (docsSnap.empty) {
    console.log('(no documents found)');
  } else {
    docsSnap.forEach((doc) => {
      const d = doc.data();
      console.log(JSON.stringify({
        id: doc.id,
        status: d.status,
        processedAt: d.processedAt?.toDate?.().toISOString() ?? null,
        fileName: d.fileName,
        customerName: d.customerName,
        officeName: d.officeName,
        documentType: d.documentType,
        fileDate: d.fileDate,
      }));
    });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('ERROR:', err);
    process.exit(1);
  });
