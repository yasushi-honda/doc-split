/**
 * cleanup-duplicates.js の複数顧客FAX複製機能対応ロジック(kanameone現場要件、GOAL.md D4/AC-d)
 *
 * distributionId保持docは複製配信によって意図的に生成された「同一fileNameの複数doc」であり、
 * 通常の重複(誤取込等)とは区別して削除対象から除外する(v1中間案)。同一fileNameグループに
 * 複数のdistributionId(=複数の複製グループ)が混在する場合は想定外の複合事象のため、
 * 自動削除はせずWARNで人間にエスカレーションする。Firestore/Storage副作用を持たない
 * 純粋関数のみをここに抽出し、cleanup-duplicates.js から require する。
 */

/**
 * distributionIdを持つドキュメントかどうかを判定する。
 * @param {{ distributionId?: unknown }} data
 * @returns {boolean}
 */
function hasDistributionId(data) {
  return typeof data.distributionId === 'string' && data.distributionId.length > 0;
}

/**
 * 同一fileNameグループのdoc配列を、複製配信docと非配信(通常重複)docに分類し、
 * エスカレーション(複数distributionId混在)が必要かどうかを判定する。
 *
 * @param {Array<{ id: string, data: Record<string, unknown> }>} docs
 * @returns {{
 *   escalate: boolean,
 *   distributionIds: string[],
 *   distributedDocs: Array<{ id: string, data: Record<string, unknown> }>,
 *   plainDocs: Array<{ id: string, data: Record<string, unknown> }>,
 * }}
 */
function planGroupCleanup(docs) {
  const distributedDocs = docs.filter((d) => hasDistributionId(d.data));
  const plainDocs = docs.filter((d) => !hasDistributionId(d.data));
  const distributionIds = Array.from(
    new Set(distributedDocs.map((d) => d.data.distributionId))
  );

  return {
    escalate: distributionIds.length > 1,
    distributionIds,
    distributedDocs,
    plainDocs,
  };
}

module.exports = { hasDistributionId, planGroupCleanup };
