/**
 * provenance.ts (createSplitProvenance + assertValidProvenanceInput) の単体テスト。
 *
 * Issue #445 PR-D2: ADR-0016 MUST 2 / MUST 5 で必須化した 10 fields の runtime 検証を
 * pure function level でカバーする。実 splitPdf 経由の検証は
 * splitPdfProvenance.integration.test.ts で別途実施。
 */

import { expect } from 'chai';
import { Timestamp } from 'firebase-admin/firestore';
import {
  CreateBackfillProvenanceInput,
  CreateSplitProvenanceInput,
  ProvenanceValidationError,
  assertValidProvenanceInput,
  createBackfillProvenance,
  createSplitProvenance,
} from '../src/pdf/provenance';

function makeValidInput(
  overrides: Partial<CreateSplitProvenanceInput> = {}
): CreateSplitProvenanceInput {
  return {
    sourceGeneration: '1700000000000001',
    sourceMetageneration: '1',
    sourceSha256: 'a'.repeat(64),
    sourcePath: 'attachments/abc/file.pdf',
    sourceBucket: 'doc-split-dev.appspot.com',
    derivedObjectPath: 'processed/doc-id-xyz/output.pdf',
    derivedGeneration: '1700000000000002',
    derivedMetageneration: '1',
    derivedSha256: 'b'.repeat(64),
    ...overrides,
  };
}

describe('createSplitProvenance (ADR-0016 MUST 2 factory)', () => {
  it('正常な 10 fields 入力で provenance を構築する', () => {
    const input = makeValidInput();
    const result = createSplitProvenance(input);
    expect(result.sourceGeneration).to.equal('1700000000000001');
    expect(result.sourceMetageneration).to.equal('1');
    expect(result.sourceSha256).to.equal('a'.repeat(64));
    expect(result.sourcePath).to.equal('attachments/abc/file.pdf');
    expect(result.sourceBucket).to.equal('doc-split-dev.appspot.com');
    expect(result.derivedObjectPath).to.equal('processed/doc-id-xyz/output.pdf');
    expect(result.derivedGeneration).to.equal('1700000000000002');
    expect(result.derivedMetageneration).to.equal('1');
    expect(result.derivedSha256).to.equal('b'.repeat(64));
    expect(result.createdAt).to.exist;
  });

  it('createdAt 省略時は Timestamp.now() を採用する', () => {
    const before = Timestamp.now();
    const result = createSplitProvenance(makeValidInput());
    const after = Timestamp.now();
    const resultMs = (result.createdAt as unknown as Timestamp).toMillis();
    expect(resultMs).to.be.at.least(before.toMillis());
    expect(resultMs).to.be.at.most(after.toMillis());
  });

  it('createdAt 明示指定時はそれを採用する', () => {
    const fixed = Timestamp.fromMillis(1700000000000);
    const result = createSplitProvenance(makeValidInput({ createdAt: fixed }));
    expect((result.createdAt as unknown as Timestamp).toMillis()).to.equal(1700000000000);
  });

  it('sha256 hex を大文字で渡しても lowercase に正規化する', () => {
    const result = createSplitProvenance(
      makeValidInput({
        sourceSha256: 'A'.repeat(64),
        derivedSha256: 'BCDEF' + 'a'.repeat(59),
      })
    );
    expect(result.sourceSha256).to.equal('a'.repeat(64));
    expect(result.derivedSha256).to.equal('bcdef' + 'a'.repeat(59));
  });
});

describe('assertValidProvenanceInput (10 fields 検証)', () => {
  it('正常入力では throw しない', () => {
    expect(() => assertValidProvenanceInput(makeValidInput())).to.not.throw();
  });

  describe('sha256 検証', () => {
    it('sourceSha256 が 64 桁未満で throw', () => {
      expect(() =>
        assertValidProvenanceInput(makeValidInput({ sourceSha256: 'abc' }))
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'sourceSha256');
    });

    it('derivedSha256 に非 hex 文字が混入すると throw', () => {
      expect(() =>
        assertValidProvenanceInput(
          makeValidInput({ derivedSha256: 'g'.repeat(64) })
        )
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'derivedSha256');
    });

    it('sourceSha256 が空文字で throw', () => {
      expect(() =>
        assertValidProvenanceInput(makeValidInput({ sourceSha256: '' }))
      ).to.throw(ProvenanceValidationError);
    });
  });

  describe('generation 検証', () => {
    it('sourceGeneration が非数値で throw', () => {
      expect(() =>
        assertValidProvenanceInput(
          makeValidInput({ sourceGeneration: 'not-a-number' })
        )
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'sourceGeneration');
    });

    it('derivedMetageneration が小数で throw', () => {
      expect(() =>
        assertValidProvenanceInput(
          makeValidInput({ derivedMetageneration: '1.5' })
        )
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'derivedMetageneration');
    });

    it('sourceMetageneration が空文字で throw', () => {
      expect(() =>
        assertValidProvenanceInput(makeValidInput({ sourceMetageneration: '' }))
      ).to.throw(ProvenanceValidationError);
    });
  });

  describe('path / bucket 検証', () => {
    it('sourcePath が空文字で throw', () => {
      expect(() =>
        assertValidProvenanceInput(makeValidInput({ sourcePath: '' }))
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'sourcePath');
    });

    it('sourcePath に gs:// prefix が含まれていると throw (object name のみ受け取る)', () => {
      expect(() =>
        assertValidProvenanceInput(
          makeValidInput({ sourcePath: 'gs://bucket/path.pdf' })
        )
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'sourcePath');
    });

    it('derivedObjectPath に gs:// prefix が含まれていると throw', () => {
      expect(() =>
        assertValidProvenanceInput(
          makeValidInput({
            derivedObjectPath: 'gs://bucket/processed/doc/x.pdf',
          })
        )
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'derivedObjectPath');
    });

    it('sourceBucket が空文字で throw', () => {
      expect(() =>
        assertValidProvenanceInput(makeValidInput({ sourceBucket: '' }))
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'sourceBucket');
    });
  });

  describe('type 検証 (TS bypass のための明示テスト)', () => {
    it('sourceGeneration が undefined で throw', () => {
      const bad = makeValidInput() as unknown as Record<string, unknown>;
      delete bad.sourceGeneration;
      expect(() =>
        assertValidProvenanceInput(bad as unknown as CreateSplitProvenanceInput)
      ).to.throw(ProvenanceValidationError);
    });

    it('sourceSha256 が number で throw', () => {
      const bad = makeValidInput() as unknown as Record<string, unknown>;
      bad.sourceSha256 = 12345;
      expect(() =>
        assertValidProvenanceInput(bad as unknown as CreateSplitProvenanceInput)
      ).to.throw(ProvenanceValidationError);
    });
  });
});

describe('ProvenanceValidationError', () => {
  it('field と reason プロパティを保持する', () => {
    try {
      assertValidProvenanceInput(makeValidInput({ sourceSha256: 'xx' }));
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(ProvenanceValidationError);
      expect((err as ProvenanceValidationError).field).to.equal('sourceSha256');
      expect((err as ProvenanceValidationError).reason).to.match(/64-char hex/);
      expect((err as Error).name).to.equal('ProvenanceValidationError');
    }
  });
});

// ============================================================
// createBackfillProvenance (ADR-0016 MUST 6 / Issue #445 PR-D4)
// ============================================================

// helper: provenanceFields の createdAt 必須化を満たす (Codex 4th High 1 反映)
function makeBackfillFields(
  overrides: Partial<CreateSplitProvenanceInput> = {}
): CreateBackfillProvenanceInput['provenanceFields'] {
  return {
    ...makeValidInput(overrides),
    // ADR Critical 2 / Codex 4th High 1: backfill では split 完了時刻を必須渡し
    createdAt: overrides.createdAt ?? Timestamp.fromMillis(1690000000000),
  };
}

function makeBackfillInput(
  overrides: Partial<CreateBackfillProvenanceInput> = {}
): CreateBackfillProvenanceInput {
  return {
    provenanceFields: makeBackfillFields(),
    confidence: 'derived-bytes-verified',
    classifierCategory: 'MatchedByHash',
    evidence: {
      parentExists: true,
      parentSha256MatchedAtBackfill: true,
      childSha256ComputedAtBackfill: true,
    },
    backfillScriptVersion: 'pr-d4-v1.0',
    ...overrides,
  };
}

describe('createBackfillProvenance (ADR-0016 MUST 6 factory)', () => {
  describe('正常系: confidence ごとの構築', () => {
    it('derived-bytes-verified で provenance 10 fields + backfill metadata を構築する', () => {
      const result = createBackfillProvenance(makeBackfillInput());
      // provenance side (10 fields の値を継承)
      expect(result.provenance.sourceGeneration).to.equal('1700000000000001');
      expect(result.provenance.sourceSha256).to.equal('a'.repeat(64));
      expect(result.provenance.derivedObjectPath).to.equal('processed/doc-id-xyz/output.pdf');
      expect(result.provenance.derivedSha256).to.equal('b'.repeat(64));
      // backfill metadata side
      expect(result.provenanceBackfill.method).to.equal('legacy-observed');
      expect(result.provenanceBackfill.confidence).to.equal('derived-bytes-verified');
      expect(result.provenanceBackfill.backfilledAt).to.exist;
      expect(result.provenanceBackfill.evidence.parentExists).to.equal(true);
      expect(result.provenanceBackfill.evidence.parentSha256MatchedAtBackfill).to.equal(true);
      expect(result.provenanceBackfill.evidence.childSha256ComputedAtBackfill).to.equal(true);
      expect(result.provenanceBackfill.evidence.backfillScriptVersion).to.equal('pr-d4-v1.0');
      expect(result.provenanceBackfill.evidence.classifierCategory).to.equal('MatchedByHash');
    });

    it('child-snapshot-only で構築する (parent 不在 + child sha256 実計算済)', () => {
      const result = createBackfillProvenance(
        makeBackfillInput({
          confidence: 'child-snapshot-only',
          classifierCategory: 'Ambiguous',
          evidence: {
            parentExists: false,
            parentSha256MatchedAtBackfill: null,
            childSha256ComputedAtBackfill: true,
          },
        })
      );
      expect(result.provenanceBackfill.confidence).to.equal('child-snapshot-only');
      expect(result.provenanceBackfill.evidence.parentExists).to.equal(false);
      expect(result.provenanceBackfill.evidence.parentSha256MatchedAtBackfill).to.be.null;
      expect(result.provenanceBackfill.evidence.classifierCategory).to.equal('Ambiguous');
    });

    it('metadata-only で構築する (childSha256ComputedAtBackfill=false 許容)', () => {
      const result = createBackfillProvenance(
        makeBackfillInput({
          confidence: 'metadata-only',
          classifierCategory: 'Ambiguous',
          evidence: {
            parentExists: false,
            parentSha256MatchedAtBackfill: null,
            childSha256ComputedAtBackfill: false,
          },
        })
      );
      expect(result.provenanceBackfill.confidence).to.equal('metadata-only');
      expect(result.provenanceBackfill.evidence.childSha256ComputedAtBackfill).to.equal(false);
    });
  });

  describe('時刻フィールド', () => {
    it('backfilledAt 省略時は Timestamp.now() を採用する', () => {
      const before = Timestamp.now();
      const result = createBackfillProvenance(makeBackfillInput());
      const after = Timestamp.now();
      const ms = (result.provenanceBackfill.backfilledAt as unknown as Timestamp).toMillis();
      expect(ms).to.be.at.least(before.toMillis());
      expect(ms).to.be.at.most(after.toMillis());
    });

    it('backfilledAt 明示指定時はそれを採用する', () => {
      const fixed = Timestamp.fromMillis(1700000000000);
      const result = createBackfillProvenance(makeBackfillInput({ backfilledAt: fixed }));
      expect((result.provenanceBackfill.backfilledAt as unknown as Timestamp).toMillis()).to.equal(
        1700000000000
      );
    });

    it('provenance.createdAt は input.provenanceFields.createdAt を継承する (split 完了時刻)', () => {
      const splitCompletedAt = Timestamp.fromMillis(1690000000000);
      const result = createBackfillProvenance(
        makeBackfillInput({
          provenanceFields: makeBackfillFields({ createdAt: splitCompletedAt }),
          backfilledAt: Timestamp.fromMillis(1700000000000),
        })
      );
      expect((result.provenance.createdAt as unknown as Timestamp).toMillis()).to.equal(
        1690000000000
      );
      expect(
        (result.provenanceBackfill.backfilledAt as unknown as Timestamp).toMillis()
      ).to.equal(1700000000000);
    });
  });

  describe('sha256 lowercase 正規化', () => {
    it('provenance fields の sha256 を lowercase 化する', () => {
      const result = createBackfillProvenance(
        makeBackfillInput({
          provenanceFields: makeBackfillFields({
            sourceSha256: 'A'.repeat(64),
            derivedSha256: 'B'.repeat(64),
          }),
        })
      );
      expect(result.provenance.sourceSha256).to.equal('a'.repeat(64));
      expect(result.provenance.derivedSha256).to.equal('b'.repeat(64));
    });
  });

  describe('validation: provenance fields の 10 fields 検証 (assertValidProvenanceInput 流用)', () => {
    it('sourceSha256 短すぎで ProvenanceValidationError', () => {
      expect(() =>
        createBackfillProvenance(
          makeBackfillInput({
            provenanceFields: makeBackfillFields({ sourceSha256: 'abc' }),
          })
        )
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'sourceSha256');
    });

    it('derivedObjectPath に gs:// prefix で throw', () => {
      expect(() =>
        createBackfillProvenance(
          makeBackfillInput({
            provenanceFields: makeBackfillFields({
              derivedObjectPath: 'gs://bucket/x.pdf',
            }),
          })
        )
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'derivedObjectPath');
    });
  });

  describe('validation: backfillScriptVersion', () => {
    it('空文字で ProvenanceValidationError', () => {
      expect(() =>
        createBackfillProvenance(makeBackfillInput({ backfillScriptVersion: '' }))
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'backfillScriptVersion');
    });
  });

  describe('validation: confidence-evidence 整合性 (ADR Critical 6 反映)', () => {
    it('derived-bytes-verified で parentExists=false なら throw (verified には parent 現存必須)', () => {
      expect(() =>
        createBackfillProvenance(
          makeBackfillInput({
            confidence: 'derived-bytes-verified',
            evidence: {
              parentExists: false,
              parentSha256MatchedAtBackfill: true,
              childSha256ComputedAtBackfill: true,
            },
          })
        )
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'evidence.parentExists');
    });

    it('derived-bytes-verified で parentSha256MatchedAtBackfill !== true なら throw', () => {
      expect(() =>
        createBackfillProvenance(
          makeBackfillInput({
            confidence: 'derived-bytes-verified',
            evidence: {
              parentExists: true,
              parentSha256MatchedAtBackfill: null,
              childSha256ComputedAtBackfill: true,
            },
          })
        )
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'evidence.parentSha256MatchedAtBackfill');
    });

    it('derived-bytes-verified で childSha256ComputedAtBackfill=false なら throw', () => {
      expect(() =>
        createBackfillProvenance(
          makeBackfillInput({
            confidence: 'derived-bytes-verified',
            evidence: {
              parentExists: true,
              parentSha256MatchedAtBackfill: true,
              childSha256ComputedAtBackfill: false,
            },
          })
        )
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'evidence.childSha256ComputedAtBackfill');
    });

    it('child-snapshot-only で childSha256ComputedAtBackfill=false なら throw (現 child sha256 実計算必須)', () => {
      expect(() =>
        createBackfillProvenance(
          makeBackfillInput({
            confidence: 'child-snapshot-only',
            evidence: {
              parentExists: false,
              parentSha256MatchedAtBackfill: null,
              childSha256ComputedAtBackfill: false,
            },
          })
        )
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'evidence.childSha256ComputedAtBackfill');
    });

    it('metadata-only で childSha256ComputedAtBackfill=true なら throw (metadata-only は実計算スキップが定義)', () => {
      expect(() =>
        createBackfillProvenance(
          makeBackfillInput({
            confidence: 'metadata-only',
            evidence: {
              parentExists: true,
              parentSha256MatchedAtBackfill: null,
              childSha256ComputedAtBackfill: true,
            },
          })
        )
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'evidence.childSha256ComputedAtBackfill');
    });
  });

  describe('validation: defense in depth (Codex 4th review 反映)', () => {
    it('provenanceFields.createdAt 省略 (TS bypass) で ProvenanceValidationError (ADR Critical 2 enforcement)', () => {
      // TS 型レベルでは createdAt 必須だが、`as unknown as` で省略を強制した場合に
      // factory の runtime guard が backfill 実行時刻を split 完了時刻に混入させない
      const bad = makeBackfillInput() as unknown as Record<string, unknown>;
      const provenanceFields = { ...(bad.provenanceFields as Record<string, unknown>) };
      delete provenanceFields.createdAt;
      bad.provenanceFields = provenanceFields;
      expect(() =>
        createBackfillProvenance(bad as unknown as CreateBackfillProvenanceInput)
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'provenanceFields.createdAt');
    });

    it('derived-bytes-verified で parentExists=1 (truthy non-boolean) なら throw (strict boolean check)', () => {
      const bad = makeBackfillInput() as unknown as Record<string, unknown>;
      bad.evidence = {
        parentExists: 1,
        parentSha256MatchedAtBackfill: true,
        childSha256ComputedAtBackfill: true,
      };
      expect(() =>
        createBackfillProvenance(bad as unknown as CreateBackfillProvenanceInput)
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'evidence.parentExists');
    });

    it('derived-bytes-verified で childSha256ComputedAtBackfill="yes" (truthy string) なら throw', () => {
      const bad = makeBackfillInput() as unknown as Record<string, unknown>;
      bad.evidence = {
        parentExists: true,
        parentSha256MatchedAtBackfill: true,
        childSha256ComputedAtBackfill: 'yes',
      };
      expect(() =>
        createBackfillProvenance(bad as unknown as CreateBackfillProvenanceInput)
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'evidence.childSha256ComputedAtBackfill');
    });

    it('metadata-only で childSha256ComputedAtBackfill=1 (truthy non-boolean) なら throw (=== false 必須)', () => {
      const bad = makeBackfillInput({ confidence: 'metadata-only' }) as unknown as Record<
        string,
        unknown
      >;
      bad.evidence = {
        parentExists: true,
        parentSha256MatchedAtBackfill: null,
        childSha256ComputedAtBackfill: 1,
      };
      expect(() =>
        createBackfillProvenance(bad as unknown as CreateBackfillProvenanceInput)
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'evidence.childSha256ComputedAtBackfill');
    });
  });
});
