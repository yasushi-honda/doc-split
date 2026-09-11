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
 *   ページ数」の外挿は、取得したドキュメントが母集団を完全にカバーしている場合のみ行う
 * - status=='processed'でも`totalPages:0`や欠損値を持つレガシー文書が存在しうる
 *   (`scripts/seed-e2e-data.js`のシードデータ等、codex P2指摘3回目)。これらはページ数分布の
 *   集計対象から除外するため、"全期間合計ページ数の完全カバー"を名乗るのは「取得件数の全てが
 *   有効なtotalPagesを持つ場合」に限定する。無効値が1件でも混入していれば、除外分だけ合計が
 *   過小評価されるため、完全カバーの表示はせず「有効ページ数を持つ文書のみの合計」として
 *   カバレッジ(除外件数)を明示する
 * - 複数顧客FAX複製機能(`faxDuplication`、ADR-0024)が有効な場合、1回のOCR実行の結果が
 *   `distributionId`を共有する複数の`documents`エントリ(元doc+顧客ごとの複製)に同一の
 *   totalPagesでコピーされる。単純に文書単位で合計するとOCR実行1回分を複製メンバー数だけ
 *   多重計上し、PaddleOCRのCPU見積もりを実態より過大評価する(codex P2指摘4回目)。
 *   このため`distributionId`(無ければdoc.id)でグルーピングし、実際のOCR実行回数(=ユニーク
 *   グループ数)を基準にページ数を集計する
 * - `processedAt`はOCR完了時刻ではなく文書取込(pending作成)時刻であり、通常のOCR完了処理
 *   では更新されない(codex P2指摘4回目)。このため--daysで指定する期間は厳密には「OCR完了
 *   期間」ではなく「取込期間」の近似値である。リトライ/再処理で古い文書のtotalPagesが
 *   更新された場合、その文書は取込時刻ベースでは対象期間外として扱われる可能性がある。
 *   月次コスト概算という用途では取込期間を近似として許容するが、この限界を明示しておく
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
  const snap = await baseQuery.select('totalPages', 'distributionId').limit(sampleLimit).get();
  const fetchedCount = snap.size;
  const isFullPopulation = fetchedCount >= totalCount;

  // 複数顧客FAX複製(faxDuplication、ADR-0024)対策: distributionIdを共有する複製メンバーは
  // 同一OCR実行の結果を複製しただけなので、グループごとに1件だけ数える(codex review指摘対応)。
  // distributionId未設定の文書は複製されていない単独文書なのでdoc.idをキーにしてそのまま扱う。
  const groupMap = new Map();
  for (const d of snap.docs) {
    const key = d.get('distributionId') || d.id;
    if (!groupMap.has(key)) {
      groupMap.set(key, d.get('totalPages'));
    }
  }
  const dedupedCount = groupMap.size;
  const duplicateMemberCount = fetchedCount - dedupedCount;

  const rawValues = Array.from(groupMap.values());
  const pages = rawValues.filter((p) => typeof p === 'number' && p > 0);
  const invalidCount = dedupedCount - pages.length;
  // 取得した全件が有効なtotalPagesを持つ場合のみ「完全カバー」を名乗る(codex P2指摘3回目対応)。
  // 1件でもtotalPages:0/欠損があれば、その分だけ合計が過小評価されるため区別する。
  const isCompleteCoverage = isFullPopulation && invalidCount === 0;

  console.log(`ページ数サンプル取得件数: ${fetchedCount} (FAX複製排除後の実OCR実行数: ${dedupedCount}件、複製メンバー除外: ${duplicateMemberCount}件、うち有効totalPages: ${pages.length}件、無効/0: ${invalidCount}件、上限${sampleLimit}件、totalCountの${((fetchedCount / totalCount) * 100).toFixed(1)}%相当${isFullPopulation ? '' : '、processedAt昇順(期間内最古側)の打ち切りサンプル'})`);
  if (duplicateMemberCount > 0) {
    console.log(`[注意] ${duplicateMemberCount}件がfaxDuplicationによる複製メンバーのため、OCR実行回数の重複計上を避けて除外しています。`);
  }
  if (invalidCount > 0) {
    console.log(`[注意] ${invalidCount}件がtotalPages:0または欠損のため、以下の合計・平均から除外しています(過小評価の要因になりうる)。`);
  }

  if (pages.length === 0) {
    console.log('有効なtotalPagesを持つ文書が見つかりませんでした。');
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

  // Cloud Run CPU秒の粗い見積もり材料。「取得件数が母集団と一致」かつ「無効値0件」の
  // 場合のみ完全カバーとして外挿する(打ち切りサンプルはprocessedAt昇順=期間内最古側に
  // 偏っておりランダムでない、かつtotalPages:0混入があれば過小評価になるため。
  // codex review指摘2件対応)。実際のCloud Run実機レイテンシ(コールドスタート込み)は
  // ADR-0025本文で別途負荷試験により確定する。
  if (isCompleteCoverage) {
    const estimatedTotalPages = sum; // 取得件数=母集団かつ全件有効なのでそのまま合計値を使う
    console.log(`\n[参考] 全期間合計ページ数(母集団完全カバー・無効値なし): ${estimatedTotalPages}`);
    console.log(`[参考] ローカル実測6-8秒/ページで換算した場合の推定CPU秒: ${(estimatedTotalPages * 6).toFixed(0)}〜${(estimatedTotalPages * 8).toFixed(0)}秒/${days}日`);
  } else {
    const reason = !isFullPopulation
      ? `サンプルが打ち切られており(${fetchedCount}/${totalCount}件)、期間内最古側に偏ったサンプルで母集団を代表する保証がない`
      : `取得件数は母集団と一致するが、${invalidCount}件がtotalPages:0/欠損のため合計が過小評価される`;
    console.log(`\n[注意] ${reason}ため、全期間への外挿は行いません。`);
    console.log(`       参考値としては「有効ページ数を持つ${pages.length}件の合計${sum}」のみ(全期間の完全な合計ではない)。`);
    if (!isFullPopulation) {
      console.log(`       桁感が必要な場合は --sample-limit ${totalCount} 以上を指定して母集団を完全カバーしたうえで再実行してください。`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
