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
  CreateSplitProvenanceInput,
  ProvenanceValidationError,
  assertValidProvenanceInput,
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
