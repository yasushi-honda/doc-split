/**
 * Issue #445 PR-D4 S1-5: rotate gate helper unit test (BF12/BF13/BF17 構造的 lock-in).
 *
 * `shouldRejectRotateForBackfill(raw: unknown)` の fail-closed 挙動を検証する。
 *
 * ADR-0016 MUST 3 拡張 (Codex 7th Critical 6 反映):
 * - `provenanceBackfill` field absent (PR-D2/D3 verified split-time origin) → allow (null 返却)
 * - `provenanceBackfill.confidence === 'derived-bytes-verified'` + evidence 整合 → allow
 * - `provenanceBackfill === null` (malformed) → fail-closed reject
 * - `provenanceBackfill.confidence !== 'derived-bytes-verified'` → reject
 * - method !== 'legacy-observed' / evidence 欠落 / 不正型 → reject
 *
 * Codex MCP 2nd review Important 1 反映: helper は Phase D Stage 1 と同じ最小 invariant を共有。
 * `confidence: 'derived-bytes-verified'` 単独で allow せず、derived 経路の場合は evidence 3 field
 * (parentExists / parentSha256MatchedAtBackfill / childSha256ComputedAtBackfill) を all true 検証。
 *
 * Codex MCP 2nd review Important 2 反映: `parentSha256MatchedAtBackfill` 型は `boolean | null`。
 * derived-bytes-verified の場合は true 必須、child-snapshot-only/metadata-only の場合は null 許容。
 */

import { expect } from 'chai';
import { shouldRejectRotateForBackfill } from '../src/pdf/rotateGate';

describe('shouldRejectRotateForBackfill (rotate gate helper)', () => {
  describe('allow ケース', () => {
    it('absent (undefined) → null 返却 = allow (PR-D2/D3 verified split-time origin)', () => {
      expect(shouldRejectRotateForBackfill(undefined)).to.be.null;
    });

    it('derived-bytes-verified + 完全な evidence + method legacy-observed → null 返却 = allow', () => {
      const raw = {
        method: 'legacy-observed',
        confidence: 'derived-bytes-verified',
        backfilledAt: { _seconds: 1700000000, _nanoseconds: 0 },
        evidence: {
          parentExists: true,
          parentSha256MatchedAtBackfill: true,
          childSha256ComputedAtBackfill: true,
          backfillScriptVersion: 'pr-d4-v1.0',
          classifierCategory: 'MatchedByHash',
        },
      };
      expect(shouldRejectRotateForBackfill(raw)).to.be.null;
    });
  });

  describe('reject ケース (malformed)', () => {
    it('null → reject (malformed、Codex Important 1 fail-closed)', () => {
      const result = shouldRejectRotateForBackfill(null);
      expect(result).to.match(/malformed/i);
      expect(result).to.match(/null/i);
    });

    it('string 型 → reject (object 期待)', () => {
      const result = shouldRejectRotateForBackfill('legacy');
      expect(result).to.match(/unexpected type/i);
    });

    it('number 型 → reject (object 期待)', () => {
      const result = shouldRejectRotateForBackfill(42);
      expect(result).to.match(/unexpected type/i);
    });

    it('array → reject (plain object 期待)', () => {
      const result = shouldRejectRotateForBackfill(['legacy-observed']);
      expect(result).to.match(/malformed|unexpected/i);
    });
  });

  describe('reject ケース (confidence 違反)', () => {
    const baseEvidence = {
      parentExists: true,
      parentSha256MatchedAtBackfill: true,
      childSha256ComputedAtBackfill: true,
      backfillScriptVersion: 'pr-d4-v1.0',
      classifierCategory: 'MatchedByHash',
    };

    it('confidence === "child-snapshot-only" → reject (BF13)', () => {
      const raw = {
        method: 'legacy-observed',
        confidence: 'child-snapshot-only',
        backfilledAt: { _seconds: 1700000000, _nanoseconds: 0 },
        evidence: { ...baseEvidence, parentSha256MatchedAtBackfill: null },
      };
      const result = shouldRejectRotateForBackfill(raw);
      expect(result).to.match(/derived-bytes-verified/);
      expect(result).to.include('child-snapshot-only');
    });

    it('confidence === "metadata-only" → reject', () => {
      const raw = {
        method: 'legacy-observed',
        confidence: 'metadata-only',
        backfilledAt: { _seconds: 1700000000, _nanoseconds: 0 },
        evidence: { ...baseEvidence, childSha256ComputedAtBackfill: false },
      };
      const result = shouldRejectRotateForBackfill(raw);
      expect(result).to.match(/metadata-only/);
    });

    it('confidence が unknown 文字列 → reject (fail-closed)', () => {
      const raw = {
        method: 'legacy-observed',
        confidence: 'mystery-confidence',
        backfilledAt: { _seconds: 1700000000, _nanoseconds: 0 },
        evidence: baseEvidence,
      };
      const result = shouldRejectRotateForBackfill(raw);
      expect(result).to.match(/mystery-confidence|malformed|unexpected/i);
    });

    it('confidence が number 型 → reject (fail-closed)', () => {
      const raw = {
        method: 'legacy-observed',
        confidence: 1,
        backfilledAt: { _seconds: 1700000000, _nanoseconds: 0 },
        evidence: baseEvidence,
      };
      const result = shouldRejectRotateForBackfill(raw);
      expect(result).to.match(/unexpected type/i);
    });

    it('confidence missing → reject (fail-closed)', () => {
      const raw = {
        method: 'legacy-observed',
        backfilledAt: { _seconds: 1700000000, _nanoseconds: 0 },
        evidence: baseEvidence,
      };
      const result = shouldRejectRotateForBackfill(raw);
      expect(result).to.match(/confidence/i);
    });
  });

  describe('reject ケース (method / evidence 違反、Codex Important 1 反映)', () => {
    const baseRaw = {
      confidence: 'derived-bytes-verified' as const,
      backfilledAt: { _seconds: 1700000000, _nanoseconds: 0 },
      evidence: {
        parentExists: true,
        parentSha256MatchedAtBackfill: true,
        childSha256ComputedAtBackfill: true,
        backfillScriptVersion: 'pr-d4-v1.0',
        classifierCategory: 'MatchedByHash',
      },
    };

    it('method !== "legacy-observed" → reject (固定値違反)', () => {
      const raw = { ...baseRaw, method: 'future-method' };
      const result = shouldRejectRotateForBackfill(raw);
      expect(result).to.match(/method/i);
    });

    it('method missing → reject', () => {
      const raw = { confidence: 'derived-bytes-verified', backfilledAt: baseRaw.backfilledAt, evidence: baseRaw.evidence };
      const result = shouldRejectRotateForBackfill(raw);
      expect(result).to.match(/method/i);
    });

    it('evidence missing → reject (derived-bytes-verified では evidence 必須)', () => {
      const raw = { method: 'legacy-observed', confidence: 'derived-bytes-verified', backfilledAt: baseRaw.backfilledAt };
      const result = shouldRejectRotateForBackfill(raw);
      expect(result).to.match(/evidence/i);
    });

    it('evidence が object でない → reject', () => {
      const raw = { ...baseRaw, method: 'legacy-observed', evidence: 'not-object' };
      const result = shouldRejectRotateForBackfill(raw);
      expect(result).to.match(/evidence/i);
    });

    it('derived-bytes-verified で parentExists !== true → reject (Codex Important 1)', () => {
      const raw = {
        ...baseRaw,
        method: 'legacy-observed',
        evidence: { ...baseRaw.evidence, parentExists: false },
      };
      const result = shouldRejectRotateForBackfill(raw);
      expect(result).to.match(/parentExists/i);
    });

    it('derived-bytes-verified で parentSha256MatchedAtBackfill !== true → reject', () => {
      const raw = {
        ...baseRaw,
        method: 'legacy-observed',
        evidence: { ...baseRaw.evidence, parentSha256MatchedAtBackfill: false },
      };
      const result = shouldRejectRotateForBackfill(raw);
      expect(result).to.match(/parentSha256MatchedAtBackfill/i);
    });

    it('derived-bytes-verified で parentSha256MatchedAtBackfill === null → reject (null は未検証扱い)', () => {
      const raw = {
        ...baseRaw,
        method: 'legacy-observed',
        evidence: { ...baseRaw.evidence, parentSha256MatchedAtBackfill: null },
      };
      const result = shouldRejectRotateForBackfill(raw);
      expect(result).to.match(/parentSha256MatchedAtBackfill/i);
    });

    it('derived-bytes-verified で childSha256ComputedAtBackfill !== true → reject', () => {
      const raw = {
        ...baseRaw,
        method: 'legacy-observed',
        evidence: { ...baseRaw.evidence, childSha256ComputedAtBackfill: false },
      };
      const result = shouldRejectRotateForBackfill(raw);
      expect(result).to.match(/childSha256ComputedAtBackfill/i);
    });

    it('evidence.parentExists が boolean でない → reject (型違反)', () => {
      const raw = {
        ...baseRaw,
        method: 'legacy-observed',
        evidence: { ...baseRaw.evidence, parentExists: 'yes' },
      };
      const result = shouldRejectRotateForBackfill(raw);
      expect(result).to.match(/parentExists|type/i);
    });
  });
});
