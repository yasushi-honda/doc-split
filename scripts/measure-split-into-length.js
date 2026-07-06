#!/usr/bin/env node
/**
 * splitInto 配列長分布計測スクリプト（read-only）
 *
 * ADR-0018 (Issue #547 Phase B) 着手前の事前計測。`pdfOperations.ts` splitPdf の
 * 子ドキュメント数上限を 499→249 に変更する前に (2N+1≤500、detail/main dual-write
 * 導入で1子あたりの書込が2件になるため上限が半減する)、既存データで実際に
 * splitInto 配列がどこまで伸びているかを確認する。書き込みは一切行わない。
 *
 * `isSplitSource: true` (splitPdf 実行時に親docへ立てるフラグ、pdfOperations.ts
 * 参照) を持つ全docを対象に splitInto.length の分布を集計する。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone node scripts/measure-split-into-length.js
 */

const admin = require('firebase-admin');

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID を設定してください');
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

function median(nums) {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function main() {
  console.log(`=== splitInto length distribution (project: ${projectId}) ===`);

  const snap = await db.collection('documents').where('isSplitSource', '==', true).get();
  console.log(`isSplitSource:true documents: ${snap.size}`);

  if (snap.empty) {
    console.log('(no split-source documents found)');
    await admin.app().delete();
    return;
  }

  const lengths = [];
  const overThreshold = [];

  snap.forEach((doc) => {
    const d = doc.data();
    const splitInto = Array.isArray(d.splitInto) ? d.splitInto : [];
    lengths.push(splitInto.length);
    if (splitInto.length > 249) {
      overThreshold.push({ id: doc.id, length: splitInto.length });
    }
  });

  console.log('\n=== splitInto.length 分布 ===');
  console.log(`avg: ${(lengths.reduce((a, b) => a + b, 0) / lengths.length).toFixed(2)}`);
  console.log(`median: ${median(lengths)}`);
  console.log(`max: ${Math.max(...lengths)}`);
  console.log(`min: ${Math.min(...lengths)}`);

  console.log('\n=== 249件超のドキュメント (ADR-0018 Phase B 新上限を超過するケース) ===');
  if (overThreshold.length === 0) {
    console.log('該当なし。新上限249での運用に問題なし。');
  } else {
    console.log(`${overThreshold.length}件が249件を超過:`);
    overThreshold.forEach((o) => console.log(`  ${o.id}: ${o.length}`));
  }

  await admin.app().delete();
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
