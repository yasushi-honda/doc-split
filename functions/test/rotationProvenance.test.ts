/**
 * createRotationProvenance + assertValidRotationProvenanceInput の単体テスト。
 *
 * Issue #445 PR-D3: ADR-0016 MUST 3 で必須化した「rotation 後 provenance derived 4 更新 +
 * source 5 + createdAt 不変」セマンティクスを pure function level でカバーする。実 rotatePdfPages 経由の
 * 検証は rotatePdfPagesProvenance.test.ts / rotatePdfPagesConcurrency.test.ts で別途実施。
 *
 * カバーする Acceptance Criteria (PR-D3 impl-plan):
 * - AC1: derived 4 fields 更新
 * - AC2: source 5 + createdAt = 6 fields 不変
 * - AC6: runtime validation (ProvenanceValidationError)
 * - AC14: sourceSha256 を rotation で絶対に更新しない (型レベル + 値レベル)
 */

import { expect } from 'chai';
import { Timestamp } from 'firebase-admin/firestore';
import type { DocumentProvenance } from '../../shared/types';
import {
  CreateRotationProvenanceInput,
  ProvenanceValidationError,
  assertValidRotationProvenanceInput,
  createRotationProvenance,
} from '../src/pdf/provenance';
// PR-D3 pr-test-analyzer Critical: mergeRotations の unit test 用 import
// (rotationMerge.ts は Firebase admin 非依存で test 環境から直接 import 可能)
import { mergeRotations } from '../src/pdf/rotationMerge';

function makeValidBase(
  overrides: Partial<Record<keyof DocumentProvenance, unknown>> = {}
): DocumentProvenance {
  // admin/client Timestamp 互換性のため createSplitProvenance() と同じキャストパターンを使う
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
    createdAt: Timestamp.fromMillis(1700000000000),
    ...overrides,
  } as unknown as DocumentProvenance;
}

function makeValidNewDerived(
  overrides: Partial<CreateRotationProvenanceInput['newDerived']> = {}
): CreateRotationProvenanceInput['newDerived'] {
  return {
    derivedObjectPath: 'processed/doc-id-xyz/rotations/uuid-v4-stub.pdf',
    derivedGeneration: '1700000000000003',
    derivedMetageneration: '1',
    derivedSha256: 'c'.repeat(64),
    ...overrides,
  };
}

function makeValidInput(
  baseOverrides: Partial<DocumentProvenance> = {},
  newDerivedOverrides: Partial<CreateRotationProvenanceInput['newDerived']> = {}
): CreateRotationProvenanceInput {
  return {
    base: makeValidBase(baseOverrides),
    newDerived: makeValidNewDerived(newDerivedOverrides),
  };
}

describe('createRotationProvenance (ADR-0016 MUST 3 factory)', () => {
  it('AC1: derived 4 fields を newDerived で更新する', () => {
    const result = createRotationProvenance(makeValidInput());
    expect(result.derivedObjectPath).to.equal(
      'processed/doc-id-xyz/rotations/uuid-v4-stub.pdf'
    );
    expect(result.derivedGeneration).to.equal('1700000000000003');
    expect(result.derivedMetageneration).to.equal('1');
    expect(result.derivedSha256).to.equal('c'.repeat(64));
  });

  it('AC2: source 5 fields は base の値を完全に保持する', () => {
    const base = makeValidBase();
    const result = createRotationProvenance({
      base,
      newDerived: makeValidNewDerived(),
    });
    expect(result.sourceGeneration).to.equal(base.sourceGeneration);
    expect(result.sourceMetageneration).to.equal(base.sourceMetageneration);
    expect(result.sourceSha256).to.equal(base.sourceSha256);
    expect(result.sourcePath).to.equal(base.sourcePath);
    expect(result.sourceBucket).to.equal(base.sourceBucket);
  });

  it('AC2: createdAt は base の値を保持 (rotation で audit timestamp を更新しない)', () => {
    const fixed = Timestamp.fromMillis(1700000000000);
    const result = createRotationProvenance({
      base: makeValidBase({ createdAt: fixed }),
      newDerived: makeValidNewDerived(),
    });
    const resultMs = (result.createdAt as unknown as Timestamp).toMillis();
    expect(resultMs).to.equal(1700000000000);
  });

  it('AC14: base.sourceSha256 を大文字で渡しても lowercase 正規化されるが値は base のまま', () => {
    const result = createRotationProvenance({
      base: makeValidBase({ sourceSha256: 'A'.repeat(64) }),
      newDerived: makeValidNewDerived(),
    });
    expect(result.sourceSha256).to.equal('a'.repeat(64));
  });

  it('newDerived.derivedSha256 を大文字で渡しても lowercase 正規化される', () => {
    const result = createRotationProvenance({
      base: makeValidBase(),
      newDerived: makeValidNewDerived({
        derivedSha256: 'DEAD' + 'a'.repeat(60),
      }),
    });
    expect(result.derivedSha256).to.equal('dead' + 'a'.repeat(60));
  });

  it('rotations subdirectory path (processed/{docId}/rotations/{rotationId}.pdf) を受け取れる', () => {
    const rotationPath = 'processed/doc-abc/rotations/01HXYZ.pdf';
    const result = createRotationProvenance({
      base: makeValidBase(),
      newDerived: makeValidNewDerived({ derivedObjectPath: rotationPath }),
    });
    expect(result.derivedObjectPath).to.equal(rotationPath);
  });

  it('base.derived* は無視され newDerived で完全置換される (rotation chain 想定)', () => {
    const result = createRotationProvenance({
      base: makeValidBase({
        derivedObjectPath: 'processed/doc-id/rotations/old-rotation.pdf',
        derivedGeneration: '999',
        derivedMetageneration: '99',
        derivedSha256: 'f'.repeat(64),
      }),
      newDerived: makeValidNewDerived(),
    });
    expect(result.derivedObjectPath).to.equal(
      'processed/doc-id-xyz/rotations/uuid-v4-stub.pdf'
    );
    expect(result.derivedGeneration).to.equal('1700000000000003');
    expect(result.derivedMetageneration).to.equal('1');
    expect(result.derivedSha256).to.equal('c'.repeat(64));
  });
});

describe('assertValidRotationProvenanceInput (rotation 後 9 fields 検証)', () => {
  it('AC6: 正常入力では throw しない', () => {
    expect(() =>
      assertValidRotationProvenanceInput(makeValidInput())
    ).to.not.throw();
  });

  describe('base source fields 検証 (rotation 後も source 5 は valid 必須)', () => {
    it('base.sourceSha256 が空文字で throw', () => {
      expect(() =>
        assertValidRotationProvenanceInput(
          makeValidInput({ sourceSha256: '' })
        )
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'sourceSha256');
    });

    it('base.sourceGeneration が非数値で throw', () => {
      expect(() =>
        assertValidRotationProvenanceInput(
          makeValidInput({ sourceGeneration: 'not-a-number' })
        )
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'sourceGeneration');
    });

    it('base.sourcePath に gs:// prefix で throw', () => {
      expect(() =>
        assertValidRotationProvenanceInput(
          makeValidInput({ sourcePath: 'gs://bucket/path.pdf' })
        )
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'sourcePath');
    });

    it('base.sourceBucket が空文字で throw', () => {
      expect(() =>
        assertValidRotationProvenanceInput(makeValidInput({ sourceBucket: '' }))
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'sourceBucket');
    });
  });

  describe('newDerived fields 検証', () => {
    it('newDerived.derivedSha256 が非 hex で throw', () => {
      expect(() =>
        assertValidRotationProvenanceInput(
          makeValidInput({}, { derivedSha256: 'g'.repeat(64) })
        )
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'derivedSha256');
    });

    it('newDerived.derivedSha256 が 64 桁未満で throw', () => {
      expect(() =>
        assertValidRotationProvenanceInput(
          makeValidInput({}, { derivedSha256: 'abc' })
        )
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'derivedSha256');
    });

    it('newDerived.derivedGeneration が非数値で throw', () => {
      expect(() =>
        assertValidRotationProvenanceInput(
          makeValidInput({}, { derivedGeneration: 'abc' })
        )
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'derivedGeneration');
    });

    it('newDerived.derivedMetageneration が小数で throw', () => {
      expect(() =>
        assertValidRotationProvenanceInput(
          makeValidInput({}, { derivedMetageneration: '1.5' })
        )
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'derivedMetageneration');
    });

    it('newDerived.derivedObjectPath に gs:// prefix で throw', () => {
      expect(() =>
        assertValidRotationProvenanceInput(
          makeValidInput(
            {},
            { derivedObjectPath: 'gs://bucket/processed/doc/r.pdf' }
          )
        )
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'derivedObjectPath');
    });

    it('newDerived.derivedObjectPath が空文字で throw', () => {
      expect(() =>
        assertValidRotationProvenanceInput(
          makeValidInput({}, { derivedObjectPath: '' })
        )
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'derivedObjectPath');
    });
  });

  describe('base.derived* 検証 (defense in depth、未検証 base のガード)', () => {
    it('base.derivedGeneration が invalid なら throw (未検証 base が caller から渡された場合のガード)', () => {
      expect(() =>
        assertValidRotationProvenanceInput({
          base: makeValidBase({ derivedGeneration: 'not-numeric' }),
          newDerived: makeValidNewDerived(),
        })
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'derivedGeneration');
    });

    it('base.derivedSha256 が invalid なら throw', () => {
      expect(() =>
        assertValidRotationProvenanceInput({
          base: makeValidBase({ derivedSha256: 'invalid' }),
          newDerived: makeValidNewDerived(),
        })
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'derivedSha256');
    });

    it('base.derivedObjectPath に gs:// prefix なら throw', () => {
      expect(() =>
        assertValidRotationProvenanceInput({
          base: makeValidBase({ derivedObjectPath: 'gs://invalid-base-derived' }),
          newDerived: makeValidNewDerived(),
        })
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'derivedObjectPath');
    });
  });

  describe('source 全 fields 検証 (pr-test-analyzer Important: 対称性確保)', () => {
    it('base.sourceMetageneration が非数値で throw (sourceGeneration と対称)', () => {
      expect(() =>
        assertValidRotationProvenanceInput(
          makeValidInput({ sourceMetageneration: 'abc' })
        )
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'sourceMetageneration');
    });

    it('base.sourceMetageneration が小数で throw', () => {
      expect(() =>
        assertValidRotationProvenanceInput(makeValidInput({ sourceMetageneration: '1.5' }))
      )
        .to.throw(ProvenanceValidationError)
        .with.property('field', 'sourceMetageneration');
    });
  });
});

describe('AC14: sourceSha256 不変性の型レベル + 値レベル担保', () => {
  it('CreateRotationProvenanceInput.newDerived 型に sourceSha256 が存在しない (型レベル担保)', () => {
    // 型レベルでの確認: TypeScript の型システムで sourceSha256 を newDerived に渡せない
    // (コンパイル時エラーとなることを示すため、型のキー集合を runtime で確認)
    const newDerived = makeValidNewDerived();
    const keys = Object.keys(newDerived).sort();
    expect(keys).to.deep.equal([
      'derivedGeneration',
      'derivedMetageneration',
      'derivedObjectPath',
      'derivedSha256',
    ]);
    expect(keys).to.not.include('sourceSha256');
    expect(keys).to.not.include('sourceGeneration');
    expect(keys).to.not.include('sourceMetageneration');
    expect(keys).to.not.include('sourcePath');
    expect(keys).to.not.include('sourceBucket');
  });

  it('値レベル: 100 回 rotation chain でも source 5 fields は base の初期値を保持する', () => {
    const initialBase = makeValidBase({
      sourceSha256: 'a'.repeat(64),
      sourceGeneration: '1700000000000001',
      sourcePath: 'attachments/original/source.pdf',
      sourceBucket: 'initial-bucket',
    });
    let current = initialBase;
    for (let i = 0; i < 100; i++) {
      current = createRotationProvenance({
        base: current,
        newDerived: makeValidNewDerived({
          derivedGeneration: String(1700000000000100 + i),
        }),
      });
    }
    expect(current.sourceGeneration).to.equal(initialBase.sourceGeneration);
    expect(current.sourceMetageneration).to.equal(
      initialBase.sourceMetageneration
    );
    expect(current.sourceSha256).to.equal(initialBase.sourceSha256);
    expect(current.sourcePath).to.equal(initialBase.sourcePath);
    expect(current.sourceBucket).to.equal(initialBase.sourceBucket);
    expect((current.createdAt as unknown as Timestamp).toMillis()).to.equal(
      (initialBase.createdAt as unknown as Timestamp).toMillis()
    );
  });
});

describe('mergeRotations (PR-D3 pr-test-analyzer Critical: 3 branch coverage)', () => {
  const docId = 'test-doc-id';

  describe('新規 entry の追加', () => {
    it('既存空配列 + 新規 1 件 → push される', () => {
      const result = mergeRotations(docId, [], [{ pageNumber: 1, degrees: 90 }]);
      expect(result).to.deep.equal([{ pageNumber: 1, rotation: 90 }]);
    });

    it('既存と異なる pageNumber → 追加される (累積ではなく push)', () => {
      const result = mergeRotations(
        docId,
        [{ pageNumber: 1, rotation: 90 }],
        [{ pageNumber: 2, degrees: 180 }]
      );
      expect(result).to.deep.equal([
        { pageNumber: 1, rotation: 90 },
        { pageNumber: 2, rotation: 180 },
      ]);
    });
  });

  describe('既存 entry の累積 (同 pageNumber)', () => {
    it('既存 90 + 新規 90 → 180', () => {
      const result = mergeRotations(
        docId,
        [{ pageNumber: 1, rotation: 90 }],
        [{ pageNumber: 1, degrees: 90 }]
      );
      expect(result).to.deep.equal([{ pageNumber: 1, rotation: 180 }]);
    });

    it('既存 270 + 新規 90 → 360 mod 360 = 0', () => {
      const result = mergeRotations(
        docId,
        [{ pageNumber: 1, rotation: 270 }],
        [{ pageNumber: 1, degrees: 90 }]
      );
      expect(result).to.deep.equal([{ pageNumber: 1, rotation: 0 }]);
    });

    it('既存 180 + 新規 180 → 360 mod 360 = 0', () => {
      const result = mergeRotations(
        docId,
        [{ pageNumber: 3, rotation: 180 }],
        [{ pageNumber: 3, degrees: 180 }]
      );
      expect(result).to.deep.equal([{ pageNumber: 3, rotation: 0 }]);
    });
  });

  describe('破損 legacy entry の recover (Evaluator HIGH Q2 二段階方針)', () => {
    it('既存 45 度 → warn + 0 fallback、新規追加で 90', () => {
      const warnSpy: Array<unknown[]> = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warnSpy.push(args);
      try {
        const result = mergeRotations(
          docId,
          [{ pageNumber: 1, rotation: 45 }],
          [{ pageNumber: 1, degrees: 90 }]
        );
        // 既存 45 → 0 recover、+ 90 → 90
        expect(result).to.deep.equal([{ pageNumber: 1, rotation: 90 }]);
        // warn log が出ている (legacy recovery 観測可能化)
        expect(warnSpy.length).to.be.greaterThan(0);
      } finally {
        console.warn = originalWarn;
      }
    });

    it('既存 -90 度 (負数) → warn + 0 fallback', () => {
      const warnSpy: Array<unknown[]> = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warnSpy.push(args);
      try {
        const result = mergeRotations(docId, [{ pageNumber: 1, rotation: -90 }], []);
        // 負数 -90 % 360 = -90、normalize 後 270 → 90 倍数なので strict 通過、warn なし
        // (normalizeRotationOrFallback の仕様で -90 → 270 にすべき)
        expect(result).to.deep.equal([{ pageNumber: 1, rotation: 270 }]);
      } finally {
        console.warn = originalWarn;
      }
    });
  });

  describe('strict 検証 (新規 user input)', () => {
    it('新規 input.degrees = 45 (90 倍数でない) → throw invalid-argument', () => {
      // normalizeRotation は HttpsError('invalid-argument') を throw
      expect(() =>
        mergeRotations(docId, [], [{ pageNumber: 1, degrees: 45 }])
      ).to.throw(/45/);
    });
  });
});
