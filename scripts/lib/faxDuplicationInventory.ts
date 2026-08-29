/**
 * audit-fax-duplication-inventory.ts の純粋ロジック部(I/O非依存、unit test対象)。
 *
 * 複数人記載FAX複製廃止(PR-D、docs/adr/0024-multi-customer-detection.md Stage3)向けの
 * read-only棚卸し集計。`distributionId`で紐付いた既存の複製グループの構造・確定/確認状態・
 * Drive出力状態・新旧突合(`multiCustomerDetected`との比較)を集計する。
 *
 * Firestore I/Oに依存しない判定・集計のみをここに分離する
 * (scripts/lib/driveExportBackfillHelpers.ts と同じ分離パターン)。
 *
 * グループ判定基準は `scripts/lib/faxDuplicationCleanupHelpers.js` の `hasDistributionId` と
 * 同一基準(空文字列は対象外)。元doc判定は `shared/types.ts` の `distributionId` JSDoc記載の
 * 通り `doc.id === doc.distributionId` で行う(faxDuplication.ts:177の設計コメントと同一)。
 */

/** 棚卸し集計に必要な最小限のドキュメントフィールド(Firestore Timestampはミリ秒に変換済みで受け取る)。 */
export interface InventoryDoc {
  id: string;
  distributionId?: string | null;
  customerConfirmed?: boolean;
  verified?: boolean;
  driveExportStatus?: string | null;
  multiCustomerDetected?: boolean;
  multiCustomerCount?: number | null;
  /** OCR完了時刻(`processedAt`)。複製書込みはOCR完了トランザクション内で行われるため、複製グループの発生時刻として使う。 */
  processedAtMs?: number | null;
}

/**
 * distributionIdを持つドキュメントかどうかを判定する。
 * `faxDuplicationCleanupHelpers.js` の `hasDistributionId(data)` と同一基準
 * (文字列型かつ非空文字列のみ対象。空文字列・null・undefinedは対象外)。
 */
export function hasDistributionId(doc: Pick<InventoryDoc, 'distributionId'>): boolean {
  return typeof doc.distributionId === 'string' && doc.distributionId.length > 0;
}

/**
 * ドキュメント配列を `distributionId` でグルーピングする。
 * `distributionId` を持たないドキュメントは無視する(呼出元が事前にフィルタ済みでなくてもよい)。
 */
export function groupByDistributionId(docs: readonly InventoryDoc[]): Map<string, InventoryDoc[]> {
  const groups = new Map<string, InventoryDoc[]>();
  for (const doc of docs) {
    if (!hasDistributionId(doc)) continue;
    const key = doc.distributionId as string;
    const existing = groups.get(key);
    if (existing) {
      existing.push(doc);
    } else {
      groups.set(key, [doc]);
    }
  }
  return groups;
}

export interface GroupSummary {
  distributionId: string;
  size: number;
  /** `doc.id === distributionId` のメンバー(元doc)が存在するか。falseは想定外の複合事象(データ異常)。 */
  hasOriginal: boolean;
  memberIds: string[];
  confirmedCount: number;
  verifiedCount: number;
  driveExportedCount: number;
  /** `multiCustomerDetected: true` を持つメンバー数(新旧突合用。Stage1併走以前は常に0)。 */
  multiCustomerDetectedCount: number;
  oldestProcessedAtMs: number | null;
  newestProcessedAtMs: number | null;
}

/** 1グループ分のメンバー配列を集計する。 */
export function summarizeGroup(distributionId: string, members: readonly InventoryDoc[]): GroupSummary {
  let hasOriginal = false;
  let confirmedCount = 0;
  let verifiedCount = 0;
  let driveExportedCount = 0;
  let multiCustomerDetectedCount = 0;
  let oldestProcessedAtMs: number | null = null;
  let newestProcessedAtMs: number | null = null;

  for (const m of members) {
    if (m.id === distributionId) hasOriginal = true;
    if (m.customerConfirmed === true) confirmedCount++;
    if (m.verified === true) verifiedCount++;
    if (m.driveExportStatus === 'exported') driveExportedCount++;
    if (m.multiCustomerDetected === true) multiCustomerDetectedCount++;
    if (typeof m.processedAtMs === 'number') {
      if (oldestProcessedAtMs === null || m.processedAtMs < oldestProcessedAtMs) {
        oldestProcessedAtMs = m.processedAtMs;
      }
      if (newestProcessedAtMs === null || m.processedAtMs > newestProcessedAtMs) {
        newestProcessedAtMs = m.processedAtMs;
      }
    }
  }

  return {
    distributionId,
    size: members.length,
    hasOriginal,
    memberIds: members.map((m) => m.id),
    confirmedCount,
    verifiedCount,
    driveExportedCount,
    multiCustomerDetectedCount,
    oldestProcessedAtMs,
    newestProcessedAtMs,
  };
}

/** ドキュメント配列全体をグルーピングし、グループごとに集計する。 */
export function summarizeAllGroups(docs: readonly InventoryDoc[]): GroupSummary[] {
  const groups = groupByDistributionId(docs);
  return Array.from(groups.entries()).map(([distributionId, members]) =>
    summarizeGroup(distributionId, members)
  );
}

export interface DetectionOnlyStats {
  /** multiCustomerDetected:true の総件数(distributionId有無を問わない)。 */
  totalDetectedCount: number;
  /**
   * multiCustomerDetected:true かつ distributionId無し(検出はされたが複製は発火していない)の件数。
   * Stage1併走検証(検出集合と複製発火集合の一致率を実測する)の核心シグナル。
   * `summarizeAllGroups`/`aggregateGroups`はdistributionId無しdocを丸ごと無視するため、
   * この件数は別途本関数で算出する必要がある(codex review P1指摘対応、2026-08-30)。
   */
  detectionOnlyCount: number;
}

/**
 * 新旧突合(Stage1併走検証)向けの検出統計を算出する。
 * 呼出元は「multiCustomerDetected有無を問わず全docを含む配列」を渡すこと
 * (distributionId保持docのみにフィルタ済みの配列を渡すと detectionOnlyCount は常に0になり、
 * 検出のみでdistributionId無しのdocを見落とす)。
 */
export function computeDetectionOnlyStats(docs: readonly InventoryDoc[]): DetectionOnlyStats {
  let totalDetectedCount = 0;
  let detectionOnlyCount = 0;
  for (const doc of docs) {
    if (doc.multiCustomerDetected === true) {
      totalDetectedCount++;
      if (!hasDistributionId(doc)) {
        detectionOnlyCount++;
      }
    }
  }
  return { totalDetectedCount, detectionOnlyCount };
}

export interface InventoryAggregate {
  groupCount: number;
  totalDocCount: number;
  /** グループサイズ(メンバー数) → 該当グループ数。 */
  sizeDistribution: Record<number, number>;
  /** 元doc(`doc.id === distributionId`)が欠落しているグループのdistributionId一覧(データ異常の可能性)。 */
  missingOriginalGroupIds: string[];
  fullyConfirmedGroupCount: number;
  partiallyConfirmedGroupCount: number;
  totalConfirmedMemberCount: number;
  fullyVerifiedGroupCount: number;
  partiallyVerifiedGroupCount: number;
  totalVerifiedMemberCount: number;
  /** Drive出力済みメンバーを1件以上含むグループ数(将来の統合方針検討の入力、PLAN PR-D参照)。 */
  groupsWithDriveExportedMemberCount: number;
  totalDriveExportedMemberCount: number;
  /** 新旧突合: `multiCustomerDetected:true` のメンバーを1件以上含む複製グループ数。 */
  groupsWithMultiCustomerDetectedMemberCount: number;
  oldestGroupProcessedAtMs: number | null;
  newestGroupProcessedAtMs: number | null;
}

/** グループ集計配列から全体集計を算出する。 */
export function aggregateGroups(groups: readonly GroupSummary[]): InventoryAggregate {
  const sizeDistribution: Record<number, number> = {};
  const missingOriginalGroupIds: string[] = [];
  let totalDocCount = 0;
  let fullyConfirmedGroupCount = 0;
  let partiallyConfirmedGroupCount = 0;
  let totalConfirmedMemberCount = 0;
  let fullyVerifiedGroupCount = 0;
  let partiallyVerifiedGroupCount = 0;
  let totalVerifiedMemberCount = 0;
  let groupsWithDriveExportedMemberCount = 0;
  let totalDriveExportedMemberCount = 0;
  let groupsWithMultiCustomerDetectedMemberCount = 0;
  let oldestGroupProcessedAtMs: number | null = null;
  let newestGroupProcessedAtMs: number | null = null;

  for (const g of groups) {
    totalDocCount += g.size;
    sizeDistribution[g.size] = (sizeDistribution[g.size] ?? 0) + 1;
    if (!g.hasOriginal) missingOriginalGroupIds.push(g.distributionId);

    if (g.confirmedCount === g.size) fullyConfirmedGroupCount++;
    else if (g.confirmedCount > 0) partiallyConfirmedGroupCount++;
    totalConfirmedMemberCount += g.confirmedCount;

    if (g.verifiedCount === g.size) fullyVerifiedGroupCount++;
    else if (g.verifiedCount > 0) partiallyVerifiedGroupCount++;
    totalVerifiedMemberCount += g.verifiedCount;

    if (g.driveExportedCount > 0) {
      groupsWithDriveExportedMemberCount++;
      totalDriveExportedMemberCount += g.driveExportedCount;
    }
    if (g.multiCustomerDetectedCount > 0) groupsWithMultiCustomerDetectedMemberCount++;

    if (g.oldestProcessedAtMs !== null) {
      if (oldestGroupProcessedAtMs === null || g.oldestProcessedAtMs < oldestGroupProcessedAtMs) {
        oldestGroupProcessedAtMs = g.oldestProcessedAtMs;
      }
    }
    if (g.newestProcessedAtMs !== null) {
      if (newestGroupProcessedAtMs === null || g.newestProcessedAtMs > newestGroupProcessedAtMs) {
        newestGroupProcessedAtMs = g.newestProcessedAtMs;
      }
    }
  }

  return {
    groupCount: groups.length,
    totalDocCount,
    sizeDistribution,
    missingOriginalGroupIds,
    fullyConfirmedGroupCount,
    partiallyConfirmedGroupCount,
    totalConfirmedMemberCount,
    fullyVerifiedGroupCount,
    partiallyVerifiedGroupCount,
    totalVerifiedMemberCount,
    groupsWithDriveExportedMemberCount,
    totalDriveExportedMemberCount,
    groupsWithMultiCustomerDetectedMemberCount,
    oldestGroupProcessedAtMs,
    newestGroupProcessedAtMs,
  };
}
