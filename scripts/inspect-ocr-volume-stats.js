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
 * 出力: status=='processed'の文書数(count()集計、courtesy無料枠内)、totalPagesのsum/avg/max、
 *       ページ数帯ごとの分布(1/2-20/21-50/51-100/101+)。
 * 全てread-only。書き込みは一切行わない。
 *
 * 既知の限界(codex review指摘、対応方針):
 * - status=='processed'でのフィルタが必須(codex P1同種指摘)。processedAtはpending作成時にも
 *   付与される(functions/src/gmail/checkGmailAttachments.ts等)ため、フィルタ無しではpending/
 *   error文書(totalPages:0)が母集団に混入し、統計が歪む
 * - --sample-limitで打ち切られたサンプルは、`processedAt`への不等号フィルタによりFirestoreが
 *   暗黙に`processedAt`昇順でソートするため、「期間内で最も古い側」に偏ったサンプルになる
 *   (ランダムサンプリングではない、codex P2指摘・2回目の指摘で順序の実態を訂正)。時期によって
 *   文書量・ページ数分布に傾向がある場合、系統的な偏りを生みうる。このため「全期間推定合計
 *   ページ数」の外挿は、サンプルが母集団を完全にカバーしている場合(pages.length >= totalCount)
 *   のみ行う。打ち切られた場合はサンプル内統計のみを表示し、外挿はしない(不正確な確信を
 *   持った数値を出さない)。母集団全体の傾向を正確に知りたい場合は--sample-limitを
 *   totalCount以上に設定して完全カバーさせること
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

  console.log(`=== OCRボリューム統計 (project=${projectId}, 直近${days}日, status=processed) ===\n`);

  // status=='processed'限定(pending/error文書のtotalPages:0混入を排除、codex review指摘対応)
  const baseQuery = col.where('processedAt', '>=', since).where('status', '==', 'processed');

  const countSnap = await baseQuery.count().get();
  const totalCount = countSnap.data().count;
  console.log(`対象期間内 processed文書件数: ${totalCount}`);

  if (totalCount === 0) {
    console.log('対象期間内にprocessed文書が存在しないため、ページ数分布の集計をスキップします。');
    return;
  }

  // totalPagesの分布はcount()集計だけでは取得できないため、フィールド限定read(select)で
  // サンプル取得する。全件走査ではなくsampleLimitで上限を切り、read課金を抑える。
  // 注意: orderByを明示していないが、processedAtへの不等号フィルタによりFirestoreは
  // 暗黙にprocessedAt昇順でソートする。つまり打ち切られた場合は「期間内で最も古い側」の
  // サンプルになり、ランダムサンプリングではない(下記の外挿判定を参照)。
  const snap = await baseQuery.select('totalPages').limit(sampleLimit).get();
  const isFullPopulation = snap.size >= totalCount;
  const pages = snap.docs.map((d) => d.get('totalPages')).filter((p) => typeof p === 'number' && p > 0);

  console.log(`ページ数サンプル取得件数: ${pages.length} (上限${sampleLimit}件、totalCountの${((pages.length / totalCount) * 100).toFixed(1)}%相当${isFullPopulation ? '、母集団を完全カバー' : '、processedAt昇順(期間内最古側)の打ち切りサンプルのため外挿は行わない'})`);

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

  // Cloud Run CPU秒の粗い見積もり材料。母集団を完全カバーしている場合のみ外挿する
  // (打ち切りサンプルはprocessedAt昇順=期間内最古側に偏っておりランダムでないため、
  // 外挿すると系統的な偏りを持ちうる。codex review指摘対応)。
  // 実際のCloud Run実機レイテンシ(コールドスタート込み)はADR-0025本文で別途負荷試験により確定する。
  if (isFullPopulation) {
    const estimatedTotalPages = sum; // サンプル=母集団なのでそのまま合計値を使う
    console.log(`\n[参考] 全期間合計ページ数(母集団完全カバー): ${estimatedTotalPages}`);
    console.log(`[参考] ローカル実測6-8秒/ページで換算した場合の推定CPU秒: ${(estimatedTotalPages * 6).toFixed(0)}〜${(estimatedTotalPages * 8).toFixed(0)}秒/${days}日`);
  } else {
    console.log(`\n[注意] サンプルが打ち切られており(${pages.length}/${totalCount}件)、期間内最古側に偏ったサンプルで母集団を代表する保証がないため、全期間への外挿は行いません。`);
    console.log(`       桁感が必要な場合は --sample-limit ${totalCount} 以上を指定して母集団を完全カバーしたうえで再実行してください。`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
