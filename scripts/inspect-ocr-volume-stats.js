#!/usr/bin/env node
/**
 * OCRパイプラインのボリューム統計スクリプト (read-only)
 *
 * `documents` コレクションから直近N日分の文書数・ページ数分布を集計する。
 * PaddleOCR移行(ADR-0025)のコスト試算(Cloud Run CPU秒課金の見積もり)に必要な
 * 実データを取得する目的で追加した。plan-crossreview(grip+codex)で
 * 「コスト試算が計画に一切ない」ことが指摘されたことへの対応。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=<project-id> node scripts/inspect-ocr-volume-stats.js [--days N] [--sample-limit N]
 *
 * オプション:
 *   --days N          集計対象期間 (processedAt >= N日前、default: 30)
 *   --sample-limit N  totalPages分布のサンプル取得上限件数 (default: 2000、Firestore read課金に注意)
 *
 * 出力: 文書数(count()集計、courtesy無料枠内)、totalPagesのsum/avg/max、
 *       ページ数帯ごとの分布(1/2-20/21-50/51-100/101+)。
 * 全てread-only。書き込みは一切行わない。
 */

const admin = require('firebase-admin');

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID 環境変数を設定してください');
  process.exit(1);
}

const args = process.argv.slice(2);
let days = 30;
let sampleLimit = 2000;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--days' && args[i + 1]) {
    const n = parseInt(args[i + 1], 10);
    if (!Number.isInteger(n) || n <= 0) {
      console.error(`--days は正整数を指定してください (got: ${args[i + 1]})`);
      process.exit(1);
    }
    days = n;
    i++;
  } else if (args[i] === '--sample-limit' && args[i + 1]) {
    const n = parseInt(args[i + 1], 10);
    if (!Number.isInteger(n) || n <= 0) {
      console.error(`--sample-limit は正整数を指定してください (got: ${args[i + 1]})`);
      process.exit(1);
    }
    sampleLimit = n;
    i++;
  }
}

admin.initializeApp({ projectId });
const db = admin.firestore();

function bucketFor(pages) {
  if (pages <= 1) return '1ページ';
  if (pages <= 20) return '2-20ページ';
  if (pages <= 50) return '21-50ページ';
  if (pages <= 100) return '51-100ページ';
  return '101ページ以上';
}

async function main() {
  const since = admin.firestore.Timestamp.fromMillis(Date.now() - days * 24 * 3600 * 1000);
  const col = db.collection('documents');

  console.log(`=== OCRボリューム統計 (project=${projectId}, 直近${days}日) ===\n`);

  const countSnap = await col.where('processedAt', '>=', since).count().get();
  const totalCount = countSnap.data().count;
  console.log(`対象期間内 documents件数: ${totalCount}`);

  if (totalCount === 0) {
    console.log('対象期間内に文書が存在しないため、ページ数分布の集計をスキップします。');
    return;
  }

  // totalPagesの分布はcount()集計だけでは取得できないため、フィールド限定read(select)で
  // サンプル取得する。全件走査ではなくsampleLimitで上限を切り、read課金を抑える。
  const snap = await col.where('processedAt', '>=', since).select('totalPages').limit(sampleLimit).get();
  const pages = snap.docs.map((d) => d.get('totalPages')).filter((p) => typeof p === 'number' && p > 0);

  console.log(`ページ数サンプル取得件数: ${pages.length} (上限${sampleLimit}件、totalCountの${((pages.length / totalCount) * 100).toFixed(1)}%相当)`);

  if (pages.length === 0) {
    console.log('totalPagesを持つ文書が見つかりませんでした。');
    return;
  }

  const sum = pages.reduce((a, b) => a + b, 0);
  const max = Math.max(...pages);
  const avg = sum / pages.length;

  console.log(`合計ページ数(サンプル内): ${sum}`);
  console.log(`平均ページ数/文書: ${avg.toFixed(2)}`);
  console.log(`最大ページ数: ${max}`);

  const buckets = {};
  for (const p of pages) {
    const b = bucketFor(p);
    buckets[b] = (buckets[b] || 0) + 1;
  }
  console.log('\nページ数帯分布:');
  for (const [b, c] of Object.entries(buckets)) {
    console.log(`  ${b}: ${c}件 (${((c / pages.length) * 100).toFixed(1)}%)`);
  }

  // Cloud Run CPU秒の粗い見積もり材料: サンプル内の合計ページ数 × ローカル実測レイテンシ幅(6-8秒/ページ)
  // を全期間の推定文書数(totalCount)にスケールして概算する。あくまで粗い見積もりであり、
  // 実際のCloud Run実機レイテンシ(コールドスタート込み)はADR-0025本文で別途負荷試験により確定する。
  const estimatedTotalPages = totalCount * avg;
  console.log(`\n[参考] 全期間推定合計ページ数(サンプル平均×全体件数): ${estimatedTotalPages.toFixed(0)}`);
  console.log(`[参考] ローカル実測6-8秒/ページで換算した場合の推定CPU秒: ${(estimatedTotalPages * 6).toFixed(0)}〜${(estimatedTotalPages * 8).toFixed(0)}秒/${days}日`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
