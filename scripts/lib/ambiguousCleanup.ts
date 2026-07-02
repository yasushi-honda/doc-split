/**
 * Issue #492: Ambiguous collision docs cleanup の純ロジック
 *
 * 同名・同 Storage path を共有する重複 Firestore docs (Issue #432 復旧で
 * manual-review 除外された Ambiguous 群) を「winner 1 件残し・loser 削除」で
 * 整理するための plan 検証 + preconditions 評価。
 *
 * 設計方針:
 *   - all-or-nothing: precondition 違反が 1 件でもあれば削除対象ゼロ
 *   - 削除は Firestore doc のみ。Storage 実体は winner が参照継続するため不可侵
 *     (このモジュールは削除自体を行わない。CLI 側も Storage delete API を呼ばない)
 *   - loser は「ユーザーが一度も触っていない doc」のみ許可
 *     (verified=true / editedAt あり / rotatedAt あり はすべて reject)
 */

export const AMBIGUOUS_CLEANUP_SCHEMA_VERSION = 'ambiguous-cleanup-v1';

export interface CleanupGroup {
  /** 共有されている fileName (例: 20260413_未判定_未判定_p1-4.pdf) */
  fileName: string;
  /** グループ全 docs が持つべき親 doc ID */
  parentDocumentId: string;
  /** 残す doc (クライアント編集/確認済み doc 優先、なければ docId 辞書順先頭) */
  winnerDocId: string;
  /** 削除する docs */
  loserDocIds: string[];
}

export interface CleanupPlan {
  schemaVersion: string;
  issue: number;
  projectId: string;
  description?: string;
  groups: CleanupGroup[];
  /** 全グループ loser 合計の期待値。実対象数と 1 件でもずれたら abort */
  expectedLoserCount: number;
}

/** Firestore doc snapshot の抽象 (テスト容易性のため admin SDK 非依存) */
export interface DocState {
  exists: boolean;
  data?: Record<string, unknown>;
}

export interface PlannedDeletion {
  docId: string;
  fileName: string;
  winnerDocId: string;
}

export interface PreconditionResult {
  violations: string[];
  /** violations が空のときのみ非空 (all-or-nothing) */
  deletions: PlannedDeletion[];
}

/**
 * plan 構造の静的検証 (Firestore 参照前)。
 * エラー配列が空 = 妥当。
 */
export function validatePlanStructure(plan: CleanupPlan): string[] {
  const errors: string[] = [];

  if (plan.schemaVersion !== AMBIGUOUS_CLEANUP_SCHEMA_VERSION) {
    errors.push(
      `schemaVersion 不一致: expected=${AMBIGUOUS_CLEANUP_SCHEMA_VERSION} actual=${plan.schemaVersion}`
    );
  }
  if (!plan.projectId) {
    errors.push('projectId が未設定');
  }
  if (!Array.isArray(plan.groups) || plan.groups.length === 0) {
    errors.push('groups が空');
    return errors;
  }

  const seen = new Set<string>();
  let loserTotal = 0;
  for (const g of plan.groups) {
    if (!g.fileName) errors.push(`fileName 未設定の group あり`);
    if (!g.parentDocumentId) errors.push(`${g.fileName}: parentDocumentId 未設定`);
    if (!g.winnerDocId) errors.push(`${g.fileName}: winnerDocId 未設定`);
    if (!Array.isArray(g.loserDocIds) || g.loserDocIds.length === 0) {
      errors.push(`${g.fileName}: loserDocIds が空`);
      continue;
    }
    if (g.loserDocIds.includes(g.winnerDocId)) {
      errors.push(`${g.fileName}: winner ${g.winnerDocId} が loserDocIds に含まれる`);
    }
    for (const id of [g.winnerDocId, ...g.loserDocIds]) {
      if (seen.has(id)) errors.push(`docId 重複: ${id}`);
      seen.add(id);
    }
    loserTotal += g.loserDocIds.length;
  }

  if (loserTotal !== plan.expectedLoserCount) {
    errors.push(
      `loser 合計不一致: plan.expectedLoserCount=${plan.expectedLoserCount} actual=${loserTotal}`
    );
  }

  return errors;
}

function str(data: Record<string, unknown>, key: string): string | undefined {
  const v = data[key];
  return typeof v === 'string' ? v : undefined;
}

/**
 * ライブ Firestore 状態に対する preconditions 評価。
 *
 * loser 削除可能条件 (全て AND):
 *   - loser doc が存在する
 *   - loser.fileName === plan.fileName
 *   - loser.parentDocumentId === plan.parentDocumentId
 *   - loser.status === 'processed'
 *   - loser.fileUrl が非空かつ winner.fileUrl と同一 (Storage path 共有の証明)
 *   - loser.verified !== true (確認済み doc は削除禁止)
 *   - loser.editedAt が存在しない (クライアント編集済み doc は削除禁止)
 *   - loser.rotatedAt が存在しない (回転操作済み doc は削除禁止)
 * winner 条件:
 *   - winner doc が存在する
 *   - winner.fileName === plan.fileName
 *   - winner.parentDocumentId === plan.parentDocumentId
 *
 * 違反が 1 件でもあれば deletions は空 (all-or-nothing)。
 */
export function evaluatePreconditions(
  plan: CleanupPlan,
  docs: Map<string, DocState>
): PreconditionResult {
  const violations: string[] = [];
  const deletions: PlannedDeletion[] = [];

  for (const g of plan.groups) {
    const winner = docs.get(g.winnerDocId);
    if (!winner || !winner.exists || !winner.data) {
      violations.push(`${g.fileName}: winner ${g.winnerDocId} が存在しない`);
      continue;
    }
    const winnerData = winner.data;
    if (str(winnerData, 'fileName') !== g.fileName) {
      violations.push(
        `${g.fileName}: winner ${g.winnerDocId} の fileName 不一致 (actual=${str(winnerData, 'fileName')})`
      );
    }
    if (str(winnerData, 'parentDocumentId') !== g.parentDocumentId) {
      violations.push(
        `${g.fileName}: winner ${g.winnerDocId} の parentDocumentId 不一致 (actual=${str(winnerData, 'parentDocumentId')})`
      );
    }
    const winnerFileUrl = str(winnerData, 'fileUrl');
    if (!winnerFileUrl) {
      violations.push(`${g.fileName}: winner ${g.winnerDocId} の fileUrl が空`);
    }

    for (const loserId of g.loserDocIds) {
      const loser = docs.get(loserId);
      if (!loser || !loser.exists || !loser.data) {
        violations.push(`${g.fileName}: loser ${loserId} が存在しない`);
        continue;
      }
      const d = loser.data;
      if (str(d, 'fileName') !== g.fileName) {
        violations.push(
          `${g.fileName}: loser ${loserId} の fileName 不一致 (actual=${str(d, 'fileName')})`
        );
      }
      if (str(d, 'parentDocumentId') !== g.parentDocumentId) {
        violations.push(
          `${g.fileName}: loser ${loserId} の parentDocumentId 不一致 (actual=${str(d, 'parentDocumentId')})`
        );
      }
      if (str(d, 'status') !== 'processed') {
        violations.push(
          `${g.fileName}: loser ${loserId} の status が processed でない (actual=${str(d, 'status')})`
        );
      }
      const loserFileUrl = str(d, 'fileUrl');
      if (!loserFileUrl || loserFileUrl !== winnerFileUrl) {
        violations.push(
          `${g.fileName}: loser ${loserId} の fileUrl が winner と不一致 (Storage path 共有が証明できない)`
        );
      }
      if (d.verified === true) {
        violations.push(
          `${g.fileName}: loser ${loserId} は verified=true (ユーザー確認済み doc は削除禁止)`
        );
      }
      if (d.editedAt !== undefined && d.editedAt !== null) {
        violations.push(
          `${g.fileName}: loser ${loserId} に editedAt あり (ユーザー編集済み doc は削除禁止)`
        );
      }
      if (d.rotatedAt !== undefined && d.rotatedAt !== null) {
        violations.push(
          `${g.fileName}: loser ${loserId} に rotatedAt あり (回転操作済み doc は削除禁止)`
        );
      }
      deletions.push({ docId: loserId, fileName: g.fileName, winnerDocId: g.winnerDocId });
    }
  }

  if (deletions.length !== plan.expectedLoserCount) {
    violations.push(
      `削除対象件数不一致: expectedLoserCount=${plan.expectedLoserCount} actual=${deletions.length}`
    );
  }

  // all-or-nothing: 違反 1 件でも deletions を返さない
  if (violations.length > 0) {
    return { violations, deletions: [] };
  }
  return { violations: [], deletions };
}
