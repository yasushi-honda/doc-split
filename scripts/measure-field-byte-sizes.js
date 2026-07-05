#!/usr/bin/env node
/**
 * フィールド別バイトサイズ分布計測スクリプト（read-only）
 *
 * Issue #547 着手前の事前計測。documents コレクションをサンプリングし、
 * サブコレクション分離候補の重フィールド（ocrResult / pageResults /
 * customerCandidates / officeCandidates / ocrExtraction / extractionScores /
 * extractionDetails / splitSuggestions / splitSegments）のバイトサイズ分布を
 * 集計し、一覧表示から重フィールドを除外した場合の削減見込みを算出する。
 * 書き込みは一切行わない。
 *
 * バイトサイズは JSON.stringify 後の UTF-8 バイト数で近似する
 * （実際の Firestore wire format は Protobuf のため厳密な転送量とは異なるが、
 * フィールド間の相対比率の把握には十分）。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone node scripts/measure-field-byte-sizes.js
 *   FIREBASE_PROJECT_ID=docsplit-kanameone node scripts/measure-field-byte-sizes.js --limit 300
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

const limit = getOpt('--limit', 200);

// Issue #547 の分離候補フィールド
const HEAVY_FIELDS = [
  'ocrResult',
  'pageResults',
  'customerCandidates',
  'officeCandidates',
  'ocrExtraction',
  'extractionScores',
  'extractionDetails',
  'splitSuggestions',
  'splitSegments',
];

admin.initializeApp({ projectId });
const db = admin.firestore();

function byteSize(value) {
  if (value === undefined || value === null) return 0;
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function median(nums) {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function avg(nums) {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

async function main() {
  console.log(`=== Field byte-size sampling (project: ${projectId}, limit: ${limit}) ===`);

  // Firestore auto-ID はランダム英数字のため、__name__ 順ソートは疑似ランダムサンプルとして機能する
  const snap = await db.collection('documents').orderBy('__name__').limit(limit).get();
  console.log(`Sampled documents: ${snap.size}`);

  if (snap.empty) {
    console.log('(no documents found)');
    await admin.app().delete();
    return;
  }

  const perDoc = [];
  const statusCounts = {};
  let ocrOffloadedCount = 0;

  snap.forEach((doc) => {
    const d = doc.data();
    statusCounts[d.status || 'unknown'] = (statusCounts[d.status || 'unknown'] || 0) + 1;
    if (d.ocrResultUrl) ocrOffloadedCount += 1;

    const fieldBytes = {};
    let heavyTotal = 0;
    for (const field of HEAVY_FIELDS) {
      const b = byteSize(d[field]);
      fieldBytes[field] = b;
      heavyTotal += b;
    }
    const totalBytes = byteSize(d);
    perDoc.push({
      id: doc.id,
      status: d.status,
      totalBytes,
      heavyTotal,
      fieldBytes,
    });
  });

  const totalBytesArr = perDoc.map((d) => d.totalBytes);
  const heavyTotalArr = perDoc.map((d) => d.heavyTotal);
  const avgTotal = avg(totalBytesArr);
  const avgHeavy = avg(heavyTotalArr);

  console.log('\n=== Status breakdown ===');
  console.log(JSON.stringify(statusCounts, null, 2));
  console.log(`\nocrResultUrl (Storage offload 済み、OCR_RESULT_MAX_LENGTH=100000超): ${ocrOffloadedCount} / ${perDoc.length}`);

  console.log('\n=== Total document size (bytes, JSON.stringify近似) ===');
  console.log(`avg: ${Math.round(avgTotal)}`);
  console.log(`median: ${median(totalBytesArr)}`);
  console.log(`max: ${Math.max(...totalBytesArr)}`);
  console.log(`min: ${Math.min(...totalBytesArr)}`);

  console.log('\n=== Heavy fields total (bytes) ===');
  console.log(`avg: ${Math.round(avgHeavy)}`);
  console.log(`median: ${median(heavyTotalArr)}`);
  console.log(`heavy fields / total ratio (avg): ${((avgHeavy / avgTotal) * 100).toFixed(1)}%`);

  console.log('\n=== Per-field breakdown (avg bytes, % of total doc, 出現率) ===');
  for (const field of HEAVY_FIELDS) {
    const arr = perDoc.map((d) => d.fieldBytes[field]);
    const fieldAvg = avg(arr);
    const presentCount = arr.filter((b) => b > 0).length;
    console.log(
      `${field.padEnd(20)} avg=${Math.round(fieldAvg).toString().padStart(7)}B  median=${median(arr).toString().padStart(7)}B  ` +
        `%ofTotalDoc=${((fieldAvg / avgTotal) * 100).toFixed(1).padStart(5)}%  present=${presentCount}/${perDoc.length}`
    );
  }

  console.log('\n=== Projected egress reduction (heavy fields を一覧配信から除外した場合) ===');
  console.log(`現状: 一覧表示は documents 全件配信 → 平均 ${Math.round(avgTotal)}B/doc`);
  console.log(
    `分離後想定: 一覧表示は軽量フィールドのみ → 平均 ${Math.round(avgTotal - avgHeavy)}B/doc ` +
      `(削減率 ${((avgHeavy / avgTotal) * 100).toFixed(1)}%)`
  );

  await admin.app().delete();
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
