/**
 * `scripts/execute-drive-export-repair.ts` の純粋ロジック部(I/O非依存、unit test対象)。
 * Issue #811/#823 remediation(Phase 2b、kanameoneの破損documentを実際に修復するexecute
 * フェーズ)向け。`scripts/lib/driveExportDriftClassifier.ts`と同じ分離パターン。
 *
 * plan-crossreview(grip自白+codex 2巡、2026-08-28)で判明した設計修正を反映済み:
 * - D3対象抽出は`storageObjectExists===true`のみ許可(false/nullいずれも除外、fail-closed)
 * - `expectedPathStatus`が`'unresolved-ambiguous'`/`'unresolved-api-error'`の対象は除外
 * - 重複docId検知(targets/blockedの両方に同一docIdが出現しないことをassert)
 */

import type { DriftPlan, TargetEntry, BlockedEntry } from '../classify-drive-export-drift';

export const DRIFT_PLAN_SCHEMA_VERSION = 'drive-export-drift-plan-v1';

/**
 * D3: healthy以外のtargets全件(trashed+misplaced) + blocked[target-path-not-created]のみを
 * execute対象の候補として抽出する。以下は候補から除外する:
 * - expectedPathStatusが'resolved'/'not-created'以外(ambiguous-path/api-errorで期待パス自体が
 *   未解決 = 実行しても高確率で失敗するのが事前に分かっている、plan-crossreview H1)
 * - storageObjectExistsがtrue以外(false=実体無しは確実に失敗、null=不明はfail-closedで除外、
 *   plan-crossreview H2+codex High#5)
 */
export function extractCandidateIds(plan: Pick<DriftPlan, 'targets' | 'blocked'>): string[] {
  const fromTargets = plan.targets
    .filter((t) => t.category !== 'healthy')
    .filter((t) => t.expectedPathStatus === 'resolved' || t.expectedPathStatus === 'not-created')
    .filter((t) => t.storageObjectExists === true)
    .map((t) => t.docId);
  const fromBlocked = plan.blocked.filter((b) => b.reason === 'target-path-not-created').map((b) => b.docId);

  const combined = [...fromTargets, ...fromBlocked];
  const seen = new Set<string>();
  for (const docId of combined) {
    if (seen.has(docId)) {
      throw new Error(
        `extractCandidateIds: docId "${docId}" がtargetsとblockedの両方(または同一配列内で複数回)出現しています。` +
          `classify plan JSONの生成ロジックに矛盾がある可能性があります(plan-crossreview H4)。`
      );
    }
    seen.add(docId);
  }
  return combined;
}

export interface ExclusionSummary {
  healthy: number;
  unresolvedPath: number;
  storageNotConfirmed: number;
  otherBlockedReasons: number;
}

/** dry-run/execute起動時に「候補抽出でどれだけ除外されたか」を可視化するための集計
 *  (plan-crossreview L1)。extractCandidateIds()と同じ判定基準を使う。 */
export function summarizeExclusions(plan: Pick<DriftPlan, 'targets' | 'blocked'>): ExclusionSummary {
  const summary: ExclusionSummary = { healthy: 0, unresolvedPath: 0, storageNotConfirmed: 0, otherBlockedReasons: 0 };
  for (const t of plan.targets) {
    if (t.category === 'healthy') {
      summary.healthy++;
      continue;
    }
    if (t.expectedPathStatus !== 'resolved' && t.expectedPathStatus !== 'not-created') {
      summary.unresolvedPath++;
      continue;
    }
    if (t.storageObjectExists !== true) {
      summary.storageNotConfirmed++;
    }
  }
  for (const b of plan.blocked) {
    if (b.reason !== 'target-path-not-created') {
      summary.otherBlockedReasons++;
    }
  }
  return summary;
}

/** `--limit`適用前の母数に対する検証(H5: 誤ったplanファイル・スコープ違いの取り違えを検知)。 */
export class ExpectedTotalMismatchError extends Error {
  constructor(
    public readonly actual: number,
    public readonly expected: number
  ) {
    super(`--expected-total ${expected} を指定しましたが、limit適用前の候補件数は ${actual} 件でした`);
    this.name = 'ExpectedTotalMismatchError';
  }
}

export function assertExpectedTotal(actualCount: number, expectedTotal: number | undefined): void {
  if (expectedTotal === undefined) return;
  if (actualCount !== expectedTotal) {
    throw new ExpectedTotalMismatchError(actualCount, expectedTotal);
  }
}

/** D10: planの鮮度ゲート。`generatedAt`から`maxAgeHours`を超えていれば古いと判定する。 */
export function isPlanStale(generatedAtIso: string, nowMs: number, maxAgeHours: number): boolean {
  const generatedAtMs = new Date(generatedAtIso).getTime();
  if (Number.isNaN(generatedAtMs)) {
    // 不正な日時文字列は「古い」扱い(fail-closed)にし、原因不明のままexecuteへ進ませない。
    return true;
  }
  const ageMs = nowMs - generatedAtMs;
  return ageMs > maxAgeHours * 60 * 60 * 1000;
}

/**
 * D9(plan-crossreview codex High#1由来): Drive側ファイルのmodifiedTimeが、Firestoreの
 * driveExportedAtより有意に新しい場合、Drive上で(doc-split経由でない)独自の更新があった
 * 可能性があるとみなし、execute対象から除外する。misplaced修復パスはStorageの内容を無条件に
 * 正としてDrive側ファイルを上書きするため、Drive側にのみ存在する変更を無言で破壊しうる
 * (decision-maker確認: kanameone/cocoroスタッフはDrive上で直接手編集しない運用のはずだが、
 * 断定はできないための防御的チェック)。
 */
/**
 * codex review(execute-drive-export-repair実装後の4回目レビュー)P1指摘: pre-flightで
 * Drive側の現在のparents/trashedを取得していても、それをclassify時点の期待状態と
 * 比較せずにexecuteDriveExport()へ進んでいた。classify〜execute間(最大`--max-plan-age-hours`
 * 時間)に、対象documentが別経路(通常のdocument編集による再export等)で既に正しい状態へ
 * 修復されていた場合、無駄にStorage再アップロード・親フォルダ再設定を行ってしまう
 * (実害は無いが、不要な書き込み・Drive上のmodifiedTime変化を避けるべき)。
 * `expectedLeafFolderId`が既知(targets由来のtrashed/misplaced)の場合のみ判定可能。
 * blocked[target-path-not-created]由来(expectedLeafFolderId不明)は常にfalseを返し、
 * 従来通りexecuteDriveExport()を試みる(判定材料が無いため)。
 */
export function isNowHealthy(
  oldFileTrashed: boolean | undefined,
  oldParents: string[] | undefined,
  expectedLeafFolderId: string | undefined
): boolean {
  if (!expectedLeafFolderId) return false;
  if (oldFileTrashed !== false) return false;
  return !!oldParents && oldParents.length === 1 && oldParents[0] === expectedLeafFolderId;
}

export function shouldSkipForPossibleManualEdit(
  driveExportedAtMs: number | undefined,
  modifiedTimeMs: number | undefined,
  thresholdMs: number
): boolean {
  if (driveExportedAtMs === undefined || modifiedTimeMs === undefined) {
    // どちらかが取得できない場合は判定不能。fail-closedにせずスルーする
    // (driveExportedAt欠損は「まだ一度もexportされていない」等の別カテゴリの問題であり、
    // このチェックの対象外)。
    return false;
  }
  return modifiedTimeMs - driveExportedAtMs > thresholdMs;
}

export type SkipReason =
  | 'drift-status-changed'
  | 'possible-manual-edit'
  | 'reclaim-failed'
  | 'storage-not-confirmed';

export interface RepairManifestEntry {
  docId: string;
  category: TargetEntry['category'] | 'blocked-target-path-not-created';
  phase: 'intent' | 'result';
  oldDriveFileId?: string;
  oldParents?: string[];
  oldFileTrashed?: boolean;
  oldModifiedTime?: string;
  newDriveFileId?: string;
  finalStatus?: 'repaired' | 'failed' | 'skipped';
  skipReason?: SkipReason;
  error?: string;
  durationMs?: number;
}

export interface RepairManifestSummary {
  attempted: number;
  repaired: number;
  failed: number;
  skippedDrift: number;
  skippedPossibleManualEdit: number;
  skippedStorageNotConfirmed: number;
  abortedByCircuitBreaker: boolean;
}

export interface RepairManifest {
  schemaVersion: string;
  runId: string;
  planId: string;
  projectId: string;
  mode: 'execute' | 'dry-run';
  generatedAt: string;
  summary: RepairManifestSummary;
  entries: RepairManifestEntry[];
}

export function emptyManifestSummary(): RepairManifestSummary {
  return {
    attempted: 0,
    repaired: 0,
    failed: 0,
    skippedDrift: 0,
    skippedPossibleManualEdit: 0,
    skippedStorageNotConfirmed: 0,
    abortedByCircuitBreaker: false,
  };
}

/** サーキットブレーカー判定(連続失敗・累計失敗のいずれかが閾値到達で中断)。 */
export function shouldTripCircuitBreaker(
  consecutiveFailures: number,
  totalFailures: number,
  maxConsecutiveFailures: number,
  maxTotalFailures: number
): boolean {
  return consecutiveFailures >= maxConsecutiveFailures || totalFailures >= maxTotalFailures;
}

/** 失敗時にFirestoreへ書き込むdriveExportErrorへ、repair実行由来と分かるprefixを付与する
 *  (codex High#3: 本番スイープが後日拾って自動再試行する際、repair由来の失敗かどうかを
 *  `drive-export-status-report`等で区別できるようにする)。 */
export function tagRepairError(runId: string, originalMessage: string): string {
  return `[repair-run:${runId}] ${originalMessage}`;
}
