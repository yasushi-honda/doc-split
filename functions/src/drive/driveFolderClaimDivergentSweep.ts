/**
 * Issue #871 恒久対応: divergent claim の滞留バックログを日次で観測する
 *
 * PR #925 の `event: claimDivergent` ログ + `drive_folder_divergent` メトリクスは
 * 「新規発生」のみを検知でき、既に発生済みで未解決のまま残っている divergent は
 * 検知できない(2026-09-01発生の2件が2週間後の手動棚卸しで初めて発覚した実績)。
 * 「人手解決するまで必ず残す」という方針(divergentはTTL対象外)を担保するには、
 * 発生だけでなく放置そのものを継続的に観測する仕組みが要る。
 *
 * `driveFolderLocks` を `state=='divergent'` で日次走査し、件数・最古の滞留時間を
 * 構造化ログ `event: claimDivergentBacklog` として常に出力する。滞留が
 * `STALE_THRESHOLD_MS`(3日)を超えているものが1件でもあれば、`severity: WARNING`かつ
 * `[driveFolderClaim] divergent backlog stale`を含むログを追加出力し、
 * `claim_divergent_backlog_stale`メトリクス(`scripts/setup-log-based-metrics.sh`)が
 * これを拾ってアラートを発火させる。
 *
 * `divergentAtMs`はPR-B(本対応)以降の新規発生のみが持つ(既存の過去分は
 * `backfill-drive-folder-claim-ttl.ts`でexpireAtのみ移行しており、divergentAtMsは
 * 追加していない)。`divergentAtMs`を持たない claim は「滞留日数不明」として
 * `unknownAgeCount`に別集計し、存在する場合はそれ自体もstale扱いにする
 * (滞留日数が分からない=いつからか分からないまま放置されている可能性を無視しない)。
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';

const db = admin.firestore();

/** これを超えて未解決のまま残っているdivergentを「放置」とみなす。 */
export const STALE_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;

export interface DivergentBacklogSummary {
  count: number;
  /** `divergentAtMs`を持つclaimのうち最古の滞留時間(ms)。該当なしはundefined。 */
  oldestAgeMs: number | undefined;
  /** `divergentAtMs`を持たない(移行前の過去分等)claimの件数。 */
  unknownAgeCount: number;
  /** `oldestAgeMs > STALE_THRESHOLD_MS`、または`unknownAgeCount > 0`の場合true。 */
  stale: boolean;
}

export async function computeDivergentBacklogSummary(
  firestore: admin.firestore.Firestore,
  nowMs: number = Date.now()
): Promise<DivergentBacklogSummary> {
  const snapshot = await firestore.collection('driveFolderLocks').where('state', '==', 'divergent').get();

  let oldestAgeMs: number | undefined;
  let unknownAgeCount = 0;
  for (const doc of snapshot.docs) {
    const divergentAtMs = doc.data().divergentAtMs as number | undefined;
    if (divergentAtMs === undefined) {
      unknownAgeCount++;
      continue;
    }
    const ageMs = nowMs - divergentAtMs;
    if (oldestAgeMs === undefined || ageMs > oldestAgeMs) {
      oldestAgeMs = ageMs;
    }
  }

  const stale = (oldestAgeMs !== undefined && oldestAgeMs > STALE_THRESHOLD_MS) || unknownAgeCount > 0;

  return { count: snapshot.size, oldestAgeMs, unknownAgeCount, stale };
}

export function logDivergentBacklogSummary(summary: DivergentBacklogSummary): void {
  const payload = {
    operation: 'driveFolderClaim',
    event: 'claimDivergentBacklog',
    count: summary.count,
    oldestAgeMs: summary.oldestAgeMs,
    unknownAgeCount: summary.unknownAgeCount,
  };
  console.log(
    `[driveFolderClaim] claim divergent backlog: count=${summary.count} oldestAgeMs=${summary.oldestAgeMs ?? 'n/a'} unknownAgeCount=${summary.unknownAgeCount}`,
    payload
  );
  if (summary.count > 0 && summary.stale) {
    // `claim_divergent_backlog_stale`メトリクス(severity=WARNING必須)が拾う。
    console.warn(
      `[driveFolderClaim] divergent backlog stale: count=${summary.count} oldestAgeMs=${summary.oldestAgeMs ?? 'n/a'} unknownAgeCount=${summary.unknownAgeCount}`,
      payload
    );
  }
}

export const driveFolderClaimDivergentSweep = onSchedule(
  {
    schedule: 'every 24 hours',
    region: 'asia-northeast1',
    timeoutSeconds: 60,
    maxInstances: 1,
  },
  async () => {
    try {
      const summary = await computeDivergentBacklogSummary(db);
      logDivergentBacklogSummary(summary);
    } catch (error) {
      // silent-failure-hunterレビュー指摘対応: この関数自体の存在意義は「発生ではなく
      // 放置」を継続観測するバックストップであり、その関数のFirestoreクエリ自体が
      // 失敗した場合(権限regression・indexドロップ・quota等)に無言で終了すると、
      // 観測不能ギャップを埋めるはずの仕組みに新たな観測不能ギャップができてしまう。
      // ログを残したうえで再throwし、Cloud Functions自体のエラー集計にも乗せる。
      console.error('[driveFolderClaim] divergent backlog sweep failed', error);
      throw error;
    }
  }
);
