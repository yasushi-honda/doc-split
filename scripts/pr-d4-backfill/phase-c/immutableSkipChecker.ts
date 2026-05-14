/**
 * Issue #445 PR-D4 S1-4: Phase C immutable skip checker (pure function, BF14).
 *
 * impl-plan §4.3 step 5 + ADR-0016 MUST 7 + Codex 3rd I3 反映:
 *   batch 直前の再読込で `provenance` field exists && `provenanceBackfill` field is undefined
 *   を検出 → skip (本 PR-D4 が既 verified provenance を上書きしないガード)。
 *
 * 設計判断:
 * - **field existence で判定** (Codex 3rd I3): `null` sentinel は使わない。
 *   Firestore で `undefined` (field absent) と `null` (明示書込) は別意味。
 *   PR-D2/D3 で書込まれた verified provenance は `provenanceBackfill` field 自体が存在しない
 *   (= absent / undefined) であり、`null` ではない。
 * - caller (orchestrator) が再読込した Firestore data を渡し、本 pure function が判定のみ行う
 *   (Firestore SDK に依存しない、test しやすい)
 */

export interface FirestoreDocSnapshotForSkipCheck {
  /** Firestore doc.data() の結果 (undefined = doc 不在は caller でガード) */
  provenance: unknown;
  provenanceBackfill: unknown;
}

export type ImmutableSkipReason =
  | 'provenance exists, provenanceBackfill absent'
  | 'already backfilled (provenanceBackfill present)';

export type ImmutableSkipDecision =
  | { skip: false }
  | { skip: true; reason: ImmutableSkipReason };

/**
 * BF14 + Codex 6th Important: 2 種類の skip 判定で既存 doc の上書きを防止する。
 *
 * 1. `provenance exists, provenanceBackfill absent` (BF14 verified existing):
 *    PR-D2/D3 で書込まれた split-time provenance を PR-D4 backfill が上書きしないガード
 * 2. `already backfilled (provenanceBackfill present)`:
 *    別 Phase C run / 同 run の retry で既 backfilled doc を再 backfill しないガード
 *    (Phase A → C 間で別 run が backfill した場合の idempotency 保護)
 *
 * - `provenance` 不在 + `provenanceBackfill` 不在 → skip しない (新規 backfill 対象)
 * - `provenance` 存在 + `provenanceBackfill` 不在 → skip='provenance exists, provenanceBackfill absent'
 * - `provenanceBackfill` 存在 (== !== undefined、ただし `null` は **除外**) → skip='already backfilled'
 *   (Codex 3rd I3、null は明示書込で別意味のため "present" 扱いしない)
 * - `provenance` 存在 + `provenanceBackfill` object/string/値 (null 以外) → skip='already backfilled'
 */
export function checkImmutableSkip(
  snapshot: FirestoreDocSnapshotForSkipCheck
): ImmutableSkipDecision {
  const provenanceExists = snapshot.provenance !== undefined;
  const provenanceBackfillAbsent = snapshot.provenanceBackfill === undefined;
  // null は明示書込で別意味 (Codex 3rd I3) → "present" 扱いしない
  const provenanceBackfillPresent =
    snapshot.provenanceBackfill !== undefined && snapshot.provenanceBackfill !== null;

  if (provenanceBackfillPresent) {
    return { skip: true, reason: 'already backfilled (provenanceBackfill present)' };
  }
  if (provenanceExists && provenanceBackfillAbsent) {
    return { skip: true, reason: 'provenance exists, provenanceBackfill absent' };
  }
  return { skip: false };
}
