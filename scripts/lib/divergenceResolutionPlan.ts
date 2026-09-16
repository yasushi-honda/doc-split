/**
 * Issue #871 恒久対応: 「承認付き再同期ワークフロー」の Plan/Operation/Approval 型定義
 * + 純関数ゲート(schemaVersion v1)。
 *
 * `scripts/lib/folderMergePlanTypes.ts`(Issue #811 Phase B、実装済み)の設計
 * (schemaVersion literal reject・2-phase preflight前提・operation単位の承認)を踏襲するが、
 * 意味論が異なるため型は独立させる:
 *  - merge版の`RecommendedAction`(move-to-canonical/manual-review)とprovenance不変条件
 *    (PDF/ファイル内容のsha256照合)は「複数の重複ファイルをどれか1つへ統合する」ための
 *    もので、再同期(1つのclaimをDrive実体または論理的所属のどちらかへ合わせる)には合わない。
 *  - `accept-actual`(Drive実体を正としてclaimを書き換える)は意図的に提供しない。
 *    実体が正しいならマスターデータ修正→`release-claim`の二段階を踏む(ADR-0022参照)。
 *
 * resolutionMode は `divergentReason` ではなく、classify時に取得した実体
 * (`DriveEntitySnapshot`)と期待値(claimの`name`/`parentId`)の**フィールドごとの差分**から
 * 決める(`determineResolution`)。`divergentReason`はトリアージ用ラベルに過ぎない
 * ——同一reasonでも移動のみ・改名のみ・両方、と直し方が異なりうるため
 * (例: `name-mismatch`は「親は同じ」を保証しない。手動操作で移動と改名を両方行った
 * 場合もreasonはverifyFolderClaimの判定順序によりname-mismatchになる)。
 */

/** 現在のplan schema version。execute側はliteral比較でこれ以外をrejectする。 */
export const DIVERGENCE_PLAN_SCHEMA_VERSION = 'divergence-resolution-plan-v1' as const;
export type DivergencePlanSchemaVersion = typeof DIVERGENCE_PLAN_SCHEMA_VERSION;

/**
 * `divergentReason`のうち、一意な直し方が無く本ワークフローの対象外とするもの。
 * `ambiguous-full-scan`/`full-scan-mismatch`: 同名フォルダが複数存在する。既存の
 *   `execute-drive-folder-merge`(重複統合ワークフロー)へ回す。
 * `reconcile-name-mismatch`: claimに`folderId`が入らないまま divergent化する
 *   (`reconcileAttempt()`内で発生、`markDivergent()`の`existing`が`creating`状態のため)。
 *   resolved復帰にはfolderIdが必須のため、v1では手動調査対象とする。
 */
export const OUT_OF_SCOPE_DIVERGENT_REASONS: ReadonlySet<string> = new Set([
  'ambiguous-full-scan',
  'full-scan-mismatch',
  'reconcile-name-mismatch',
]);

export type ResolutionMode = 'restore-expected' | 'release-claim' | 'finalize-resolved';

export type BlockedReason =
  | 'out-of-scope-reason'
  | 'missing-folder-id'
  | 'actual-folder-unreachable'
  | 'expected-parent-unreachable'
  | 'missing-capability'
  | 'duplicate-name-at-target'
  | 'claim-graph-conflict'
  | 'trashed'
  | 'stranded-unacknowledged'
  | 'claim-drift'
  | 'drive-drift';

/** Drive folder/fileの健全性確認に必要な最小スナップショット。 */
export interface DriveEntitySnapshot {
  id: string;
  name: string;
  parents: string[];
  trashed: boolean;
  modifiedTime: string;
}

/** claimグラフ掃引で見つかった、同じ物理フォルダを指す別claim。 */
export interface ClaimGraphConflict {
  otherParentId: string;
  otherName: string;
  otherState: 'resolved' | 'divergent';
}

/**
 * `determineResolution`への入力。classify時にDrive実体とclaimを突合した後の
 * フィールドごとの差分のみを渡す(divergentReasonは判定に使わないが、
 * out-of-scope判定にのみ使う)。
 */
export interface ResolutionInput {
  divergentReason: string;
  /** claimにfolderIdが無い場合(reconcile-name-mismatch等)はnull。 */
  claimFolderId: string | null;
  /** claim.folderIdがDrive上で見つからない(404)場合はtrue。 */
  actualUnreachable: boolean;
  nameDiffers: boolean;
  parentsDiffer: boolean;
}

export interface ResolutionResult {
  /** nullは「本ワークフローでは自動解決できない」ことを示す(operationはblocked)。 */
  mode: ResolutionMode | null;
  blockedReasons: BlockedReason[];
}

/**
 * 実体との差分から推奨resolutionModeを機械的に決める(§2の要、divergentReason単独では
 * 決めない)。`release-claim`はここでは推奨されない——誤配置フォルダの中身が孤立する
 * split-brainリスクがあるため、常にoperatorの明示選択(Approval側でmodeを上書き)を要求する。
 */
export function determineResolution(input: ResolutionInput): ResolutionResult {
  if (OUT_OF_SCOPE_DIVERGENT_REASONS.has(input.divergentReason)) {
    return { mode: null, blockedReasons: ['out-of-scope-reason'] };
  }
  if (input.claimFolderId === null) {
    return { mode: null, blockedReasons: ['missing-folder-id'] };
  }
  if (input.actualUnreachable) {
    return { mode: null, blockedReasons: ['actual-folder-unreachable'] };
  }
  if (!input.nameDiffers && !input.parentsDiffer) {
    // Drive実体は既に期待通りなのにclaimだけdivergent
    // (Drive成功・Firestore書込み失敗からの再実行収束、§5参照)。
    return { mode: 'finalize-resolved', blockedReasons: [] };
  }
  return { mode: 'restore-expected', blockedReasons: [] };
}

/**
 * `evaluatePreflight`への入力。classify時点で取得済みのデータのみを渡す
 * (Drive API呼び出しは呼び出し元の責務、ここは純粋な判定ロジック)。execute側は
 * 書込み直前に同じ関数へ再取得データを渡して再評価する(TOCTOU再確認)。
 */
export interface PreflightInput {
  approvedMode: ResolutionMode | null;
  actual: DriveEntitySnapshot | null;
  /** parentsDiffer(restore-expected)の場合のみ意味を持つ。期待親の到達性。 */
  expectedParent: { found: boolean; canAddChildren: boolean } | null;
  /** parentsDiffer(restore-expected)の場合のみ意味を持つ。移動元の権限。 */
  canMoveItemWithinDrive: boolean | null;
  /** nameDiffers(restore-expected)の場合のみ意味を持つ。改名元の権限。 */
  canRename: boolean | null;
  /** 移動先に同名フォルダが既に存在するか(trashed込み全走査)。 */
  duplicateNameAtTarget: boolean;
  claimGraphConflicts: ClaimGraphConflict[];
  /** release-claimの場合のみ意味を持つ。対象フォルダの直接の子entry数(全ページ走査後)。 */
  directChildCount: number | null;
  /** release-claimかつdirectChildCount>0の場合のみ意味を持つ。operatorが承認した件数。 */
  acknowledgedStrandedCount: number | null;
}

export interface PreflightResult {
  blocked: boolean;
  reasons: BlockedReason[];
}

/**
 * fail-closedプリフライト(§5)。1つでも条件を満たさなければblockedとし、execute側は
 * `files.update`を一切呼ばない。classify(dry-run相当)とexecute(書込み直前の再確認)の
 * 両方から同じ関数を呼ぶことで判定基準を単一化する。
 */
export function evaluatePreflight(input: PreflightInput): PreflightResult {
  const reasons: BlockedReason[] = [];

  if (input.approvedMode === null) {
    reasons.push('out-of-scope-reason');
    return { blocked: true, reasons };
  }

  if (input.actual === null) {
    reasons.push('actual-folder-unreachable');
    return { blocked: true, reasons };
  }

  if (input.actual.trashed) {
    reasons.push('trashed');
  }

  if (input.claimGraphConflicts.length > 0) {
    reasons.push('claim-graph-conflict');
  }

  if (input.approvedMode === 'restore-expected') {
    if (input.duplicateNameAtTarget) {
      reasons.push('duplicate-name-at-target');
    }
    if (input.expectedParent !== null) {
      if (!input.expectedParent.found) {
        reasons.push('expected-parent-unreachable');
      } else if (!input.expectedParent.canAddChildren) {
        reasons.push('missing-capability');
      }
    }
    if (input.canMoveItemWithinDrive === false) {
      reasons.push('missing-capability');
    }
    if (input.canRename === false) {
      reasons.push('missing-capability');
    }
  }

  if (input.approvedMode === 'release-claim') {
    if (input.directChildCount !== null && input.directChildCount > 0) {
      if (input.acknowledgedStrandedCount !== input.directChildCount) {
        reasons.push('stranded-unacknowledged');
      }
    }
  }

  return { blocked: reasons.length > 0, reasons };
}

export interface DivergenceOperation {
  operationId: string;
  parentId: string;
  name: string;
  divergentReason: string;
  /** 移行前(backfill前)の過去分等、記録されていない場合はnull。 */
  divergentAtMs: number | null;
  claimFolderId: string | null;
  /** classify時点でのclaimドキュメントの`updateTime`(execute側のfence用)。 */
  claimUpdateTimeMs: number;

  actual: DriveEntitySnapshot | null;
  expectedName: string;
  expectedParentId: string;
  nameDiffers: boolean;
  parentsDiffer: boolean;

  recommendedMode: ResolutionMode | null;
  blockedReasons: BlockedReason[];

  /** 直接の子entry数(全ページ走査後)。claimFolderId不在等で計算不能な場合null。 */
  directChildCount: number | null;
  affectedDocIds: string[];
  claimGraphConflicts: ClaimGraphConflict[];
}

export interface DivergencePlanSummary {
  totalDivergent: number;
  autoResolvable: number;
  blocked: number;
}

export interface DivergencePlan {
  schemaVersion: DivergencePlanSchemaVersion;
  planId: string;
  createdAt: string;
  environment: string;
  projectId: string;
  summary: DivergencePlanSummary;
  operations: DivergenceOperation[];
}

/**
 * Operator承認(`exec_args_json`経由)。operationIdごとにmodeを明示指定させることで、
 * 「推奨(restore-expected)と異なるmode(release-claim)を選んだ」という判断を承認記録
 * そのものに残す(plan推奨modeをそのまま実行したと誤認しないため)。
 */
export interface DivergenceApprovalEntry {
  mode: ResolutionMode;
  /** release-claimでdirectChildCount>0の場合のみ必須。実件数と一致しなければblocked。 */
  acknowledgedStrandedFiles?: number;
}

export interface DivergenceApproval {
  planId: string;
  approvedOperations: Record<string, DivergenceApprovalEntry>;
}
