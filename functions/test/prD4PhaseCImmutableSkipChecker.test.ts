/**
 * Issue #445 PR-D4 S1-4: immutableSkipChecker (Phase C BF14) テスト.
 *
 * field existence で判定するロジックを deterministic に検証。
 * Codex 3rd I3 (null sentinel 禁止) の lock-in。
 */

import { expect } from 'chai';
import { checkImmutableSkip } from '../../scripts/pr-d4-backfill/phase-c/immutableSkipChecker';

describe('checkImmutableSkip (PR-D4 S1-4 Phase C BF14)', () => {
  it('両 field 不在 → skip=false (新規 backfill 対象)', () => {
    const result = checkImmutableSkip({
      provenance: undefined,
      provenanceBackfill: undefined,
    });
    expect(result).to.deep.equal({ skip: false });
  });

  it('provenance 存在 + provenanceBackfill 不在 → skip=true (verified existing、immutable)', () => {
    const result = checkImmutableSkip({
      provenance: { sourceSha256: 'abc', sourcePath: 'original/x.pdf' },
      provenanceBackfill: undefined,
    });
    expect(result).to.deep.equal({
      skip: true,
      reason: 'provenance exists, provenanceBackfill absent',
    });
  });

  it('provenance 不在 + provenanceBackfill 存在 → skip=false (異常状態、caller で対応)', () => {
    // 通常は provenance + provenanceBackfill が atomic に書込まれるため発生しないが、
    // 本 pure function は判定責務のみ。実害は caller (orchestrator) で別途検出する。
    const result = checkImmutableSkip({
      provenance: undefined,
      provenanceBackfill: { method: 'legacy-observed' },
    });
    expect(result).to.deep.equal({ skip: false });
  });

  it('両 field 存在 → skip=false (既 backfilled、Phase A で除外済の前提)', () => {
    const result = checkImmutableSkip({
      provenance: { sourceSha256: 'abc' },
      provenanceBackfill: { method: 'legacy-observed', confidence: 'derived-bytes-verified' },
    });
    expect(result).to.deep.equal({ skip: false });
  });

  it('provenanceBackfill が null → skip=false (Codex 3rd I3: null sentinel 禁止、明示書込で別意味)', () => {
    const result = checkImmutableSkip({
      provenance: { sourceSha256: 'abc' },
      provenanceBackfill: null,
    });
    expect(result).to.deep.equal({ skip: false });
  });

  it('provenance が null + provenanceBackfill 不在 → skip=true (null も "exists" 扱い)', () => {
    // Firestore SDK 上 null は field 存在 (data() で key 取得可)。
    // 通常 PR-D2/D3 では null を書込まないが、外部介入で発生する可能性は排除しない。
    const result = checkImmutableSkip({
      provenance: null,
      provenanceBackfill: undefined,
    });
    expect(result).to.deep.equal({
      skip: true,
      reason: 'provenance exists, provenanceBackfill absent',
    });
  });
});
