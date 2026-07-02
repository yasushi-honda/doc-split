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
 *     (このモジュールは削除自体を行わない。CLI 側も cleanup 本経路 (dry-run / --execute)
 *      では Storage delete API を呼ばない。dev 専用 --seed-dev-fixture / --cleanup-fixture
 *      のみ例外で fixture 実体の作成・削除を行う)
 *   - loser は「ユーザーが一度も触っていない doc」のみ許可
 *     (verified=true / editedAt あり / rotatedAt あり はすべて reject)
 */

export const AMBIGUOUS_CLEANUP_SCHEMA_VERSION = 'ambiguous-cleanup-v1' as const;
export type AmbiguousCleanupSchemaVersion = typeof AMBIGUOUS_CLEANUP_SCHEMA_VERSION;

export interface CleanupGroup {
  /** 共有されている fileName (例: 20260413_未判定_未判定_p1-4.pdf) */
  fileName: string;
  /**
   * グループ全 docs が持つべき親 doc ID (同一親グループ用)。
   * expectedParents と排他 — どちらか一方のみ指定する。
   */
  parentDocumentId?: string;
  /**
   * doc ごとの期待親 doc ID (別親グループ用。Gmail 重複受信由来など、
   * 同一内容が別親から split されたケース)。winner + 全 loser を network せず
   * 検証できるよう、グループ内の全 docId をキーに持つこと。
   */
  expectedParents?: Record<string, string>;
  /**
   * doc ごとの期待 fileUrl (expectedParents 指定時は必須)。
   * 別親グループは #432 復旧で各 doc が専用 Storage path に移行済みのことがあり
   * 「fileUrl 共有」による同一性証明が使えないため、plan 作成時に実測した
   * fileUrl を pin して「検証した doc と同一の doc を消す」ことを保証する。
   */
  expectedFileUrls?: Record<string, string>;
  /**
   * 残す doc。plan 作成時の選定ポリシーは「クライアント編集/確認済み doc 優先、
   * なければ docId 辞書順先頭」(本モジュールはこのポリシー自体を検証しない)
   */
  winnerDocId: string;
  /** 削除する docs */
  loserDocIds: string[];
}

export interface CleanupPlan {
  schemaVersion: AmbiguousCleanupSchemaVersion;
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
  /** loser の現 fileUrl (preconditions 通過時点の検証済み値) */
  fileUrl: string;
  /**
   * true = loser が winner と別の Storage object を専有しており、doc 削除後に
   * 孤児化する (CLI は storageGuard 確認の上でこの object も削除してよい)。
   * false = winner と共有 (object は不可侵)。
   */
  ownsStorageObject: boolean;
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
    // 親の期待値は uniform (parentDocumentId) XOR per-doc (expectedParents)
    if (!g.parentDocumentId && !g.expectedParents) {
      errors.push(`${g.fileName}: parentDocumentId / expectedParents のいずれかが必要`);
    }
    if (g.parentDocumentId && g.expectedParents) {
      errors.push(`${g.fileName}: parentDocumentId と expectedParents は排他 (両方指定不可)`);
    }
    if (g.expectedParents) {
      // expectedParents 使用時は fileUrl 共有による同一性証明が使えないため
      // expectedFileUrls の pin が必須
      if (!g.expectedFileUrls) {
        errors.push(`${g.fileName}: expectedParents 指定時は expectedFileUrls が必須`);
      }
      const members = new Set([g.winnerDocId, ...(g.loserDocIds ?? [])]);
      for (const [label, map] of [
        ['expectedParents', g.expectedParents],
        ['expectedFileUrls', g.expectedFileUrls],
      ] as const) {
        if (!map) continue;
        for (const id of members) {
          if (id && !map[id]) {
            errors.push(`${g.fileName}: ${label} に ${id} のエントリがない`);
          }
        }
        for (const key of Object.keys(map)) {
          if (!members.has(key)) {
            errors.push(`${g.fileName}: ${label} に group 外の docId ${key} が含まれる`);
          }
        }
      }
    } else if (g.expectedFileUrls) {
      errors.push(
        `${g.fileName}: expectedFileUrls は expectedParents 指定時のみ使用可 (同一親グループは fileUrl 共有で同一性を証明する)`
      );
    }
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
 *   - loser.parentDocumentId === 期待親 (group.parentDocumentId、または
 *     group.expectedParents[docId] — 別親グループ用)
 *   - loser.status === 'processed'
 *   - fileUrl 同一性証明 (グループ形式で分岐):
 *     - 同一親 (parentDocumentId): loser.fileUrl が非空かつ winner.fileUrl と同一
 *       (Storage path 共有の証明)
 *     - 別親 (expectedParents): loser/winner とも fileUrl が plan の
 *       expectedFileUrls の pin と完全一致 (検証した doc と同一であることの証明)
 *   - loser.verified !== true (確認済み doc は削除禁止)
 *   - loser.editedAt が存在しない (クライアント編集済み doc は削除禁止)
 *   - loser.rotatedAt が存在しない (回転操作済み doc は削除禁止)
 * winner 条件:
 *   - winner doc が存在する
 *   - winner.fileName === plan.fileName
 *   - winner.parentDocumentId === plan.parentDocumentId
 *   - winner.fileUrl が非空
 *
 * validatePlanStructure 通過済み plan を前提とするが、winner が loserDocIds に
 * 混入した plan は本関数単独でも reject する (defense-in-depth。混入時は loser の
 * fileUrl 照合が「winner 自身との比較」になり全 precondition を素通りするため)。
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
    if (g.loserDocIds.includes(g.winnerDocId)) {
      violations.push(
        `${g.fileName}: winner ${g.winnerDocId} が loserDocIds に含まれる (defense-in-depth)`
      );
      continue;
    }
    const winner = docs.get(g.winnerDocId);
    if (!winner || !winner.exists || !winner.data) {
      violations.push(`${g.fileName}: winner ${g.winnerDocId} が存在しない`);
      continue;
    }
    const expectedParentOf = (docId: string): string | undefined =>
      g.expectedParents ? g.expectedParents[docId] : g.parentDocumentId;

    const winnerData = winner.data;
    if (str(winnerData, 'fileName') !== g.fileName) {
      violations.push(
        `${g.fileName}: winner ${g.winnerDocId} の fileName 不一致 (actual=${str(winnerData, 'fileName')})`
      );
    }
    if (str(winnerData, 'parentDocumentId') !== expectedParentOf(g.winnerDocId)) {
      violations.push(
        `${g.fileName}: winner ${g.winnerDocId} の parentDocumentId 不一致 (actual=${str(winnerData, 'parentDocumentId')})`
      );
    }
    const winnerFileUrl = str(winnerData, 'fileUrl');
    if (!winnerFileUrl) {
      violations.push(`${g.fileName}: winner ${g.winnerDocId} の fileUrl が空`);
    }
    if (g.expectedFileUrls && winnerFileUrl !== g.expectedFileUrls[g.winnerDocId]) {
      violations.push(
        `${g.fileName}: winner ${g.winnerDocId} の fileUrl が plan の pin と不一致 (actual=${winnerFileUrl})`
      );
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
      if (str(d, 'parentDocumentId') !== expectedParentOf(loserId)) {
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
      if (g.expectedFileUrls) {
        // 別親グループ: plan 作成時に実測した fileUrl との完全一致で同一性を証明
        if (!loserFileUrl || loserFileUrl !== g.expectedFileUrls[loserId]) {
          violations.push(
            `${g.fileName}: loser ${loserId} の fileUrl が plan の pin と不一致 (actual=${loserFileUrl})`
          );
        }
      } else {
        // 同一親グループ: winner との fileUrl 共有で同一性を証明
        if (!loserFileUrl || loserFileUrl !== winnerFileUrl) {
          violations.push(
            `${g.fileName}: loser ${loserId} の fileUrl が winner と不一致 (Storage path 共有が証明できない)`
          );
        }
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
      deletions.push({
        docId: loserId,
        fileName: g.fileName,
        winnerDocId: g.winnerDocId,
        fileUrl: loserFileUrl ?? '',
        // 別親グループで winner と異なる object を持つ loser のみ「専有」。
        // 同一親 (共有) グループは常に false = object 不可侵
        ownsStorageObject:
          !!g.expectedFileUrls && !!loserFileUrl && loserFileUrl !== winnerFileUrl,
      });
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
