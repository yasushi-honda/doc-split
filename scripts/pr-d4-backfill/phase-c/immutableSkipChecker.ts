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

export type ImmutableSkipDecision =
  | { skip: false }
  | { skip: true; reason: 'provenance exists, provenanceBackfill absent' };

/**
 * BF14: `provenance` field exists && `provenanceBackfill` field absent (undefined) で skip。
 *
 * - `provenance` undefined → skip しない (新規 backfill 対象)
 * - `provenance` 存在 + `provenanceBackfill` undefined → **skip** (verified existing、immutable)
 * - `provenance` 存在 + `provenanceBackfill` null → skip しない (null は明示書込で別意味、I3)
 * - `provenance` 存在 + `provenanceBackfill` object/string/任意の値 → skip しない (既 backfilled、
 *   既存 backfill 上書きは別途 ADR で議論。本 PR-D4 では候補から除外済の前提)
 */
export function checkImmutableSkip(
  snapshot: FirestoreDocSnapshotForSkipCheck
): ImmutableSkipDecision {
  const provenanceExists = snapshot.provenance !== undefined;
  const provenanceBackfillAbsent = snapshot.provenanceBackfill === undefined;
  if (provenanceExists && provenanceBackfillAbsent) {
    return { skip: true, reason: 'provenance exists, provenanceBackfill absent' };
  }
  return { skip: false };
}
