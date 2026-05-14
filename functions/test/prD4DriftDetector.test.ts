/**
 * Issue #445 PR-D4 S1-3: drift-detector.ts pure function テスト.
 *
 * Phase B step 3-4: Firestore `updateTime` + GCS `generation`/`metageneration` を
 * Phase A artifact 値と比較し drift 種別を返す。pure (no Firestore/GCS access)、
 * caller が最新値を取得して渡す。
 *
 * BF9 反映: drift 種別ごとにカウンタを分けて Phase B artifact に記録する前提。
 */

import { expect } from 'chai';
import {
  detectDrift,
  type DriftDetectionInput,
} from '../../scripts/pr-d4-backfill/phase-b/driftDetector';

function baseInput(overrides: Partial<DriftDetectionInput> = {}): DriftDetectionInput {
  return {
    phaseA: {
      firestoreUpdateTime: '2026-05-14T10:00:00.000Z',
      childGeneration: '1000',
      childMetageneration: '1',
      parentGeneration: '2000',
      parentMetageneration: '1',
    },
    current: {
      firestoreUpdateTime: '2026-05-14T10:00:00.000Z',
      childGeneration: '1000',
      childMetageneration: '1',
      parentGeneration: '2000',
      parentMetageneration: '1',
    },
    ...overrides,
  };
}

describe('detectDrift (PR-D4 S1-3 drift detector)', () => {
  it('全項目一致 → kind=no-drift', () => {
    const result = detectDrift(baseInput());
    expect(result.kind).to.equal('no-drift');
  });

  it('Firestore updateTime 変化 → kind=firestoreUpdateTimeChanged (最優先で reported)', () => {
    const result = detectDrift(
      baseInput({
        current: {
          firestoreUpdateTime: '2026-05-14T11:00:00.000Z',
          childGeneration: '1000',
          childMetageneration: '1',
          parentGeneration: '2000',
          parentMetageneration: '1',
        },
      })
    );
    expect(result.kind).to.equal('firestoreUpdateTimeChanged');
  });

  it('child generation 変化 → kind=childGenerationChanged', () => {
    const result = detectDrift(
      baseInput({
        current: {
          firestoreUpdateTime: '2026-05-14T10:00:00.000Z',
          childGeneration: '1001',
          childMetageneration: '1',
          parentGeneration: '2000',
          parentMetageneration: '1',
        },
      })
    );
    expect(result.kind).to.equal('childGenerationChanged');
  });

  it('child metageneration 変化 → kind=childGenerationChanged (同 bucket categorize)', () => {
    const result = detectDrift(
      baseInput({
        current: {
          firestoreUpdateTime: '2026-05-14T10:00:00.000Z',
          childGeneration: '1000',
          childMetageneration: '2',
          parentGeneration: '2000',
          parentMetageneration: '1',
        },
      })
    );
    expect(result.kind).to.equal('childGenerationChanged');
  });

  it('parent generation 変化 → kind=parentGenerationChanged', () => {
    const result = detectDrift(
      baseInput({
        current: {
          firestoreUpdateTime: '2026-05-14T10:00:00.000Z',
          childGeneration: '1000',
          childMetageneration: '1',
          parentGeneration: '2001',
          parentMetageneration: '1',
        },
      })
    );
    expect(result.kind).to.equal('parentGenerationChanged');
  });

  it('parent metageneration 変化 → kind=parentGenerationChanged', () => {
    const result = detectDrift(
      baseInput({
        current: {
          firestoreUpdateTime: '2026-05-14T10:00:00.000Z',
          childGeneration: '1000',
          childMetageneration: '1',
          parentGeneration: '2000',
          parentMetageneration: '2',
        },
      })
    );
    expect(result.kind).to.equal('parentGenerationChanged');
  });

  it('Firestore + child + parent すべて drift → 優先順位 firestore > child > parent で kind 決定', () => {
    const result = detectDrift(
      baseInput({
        current: {
          firestoreUpdateTime: '2026-05-14T11:00:00.000Z',
          childGeneration: '1001',
          childMetageneration: '1',
          parentGeneration: '2001',
          parentMetageneration: '1',
        },
      })
    );
    expect(result.kind).to.equal('firestoreUpdateTimeChanged');
  });

  it('child + parent drift (Firestore 一致) → kind=childGenerationChanged (child 優先)', () => {
    const result = detectDrift(
      baseInput({
        current: {
          firestoreUpdateTime: '2026-05-14T10:00:00.000Z',
          childGeneration: '1001',
          childMetageneration: '1',
          parentGeneration: '2001',
          parentMetageneration: '1',
        },
      })
    );
    expect(result.kind).to.equal('childGenerationChanged');
  });

  it('phaseA.parentGeneration null + current.parentGeneration null (parent 不在) は no-drift 扱い', () => {
    const result = detectDrift({
      phaseA: {
        firestoreUpdateTime: '2026-05-14T10:00:00.000Z',
        childGeneration: '1000',
        childMetageneration: '1',
        parentGeneration: null,
        parentMetageneration: null,
      },
      current: {
        firestoreUpdateTime: '2026-05-14T10:00:00.000Z',
        childGeneration: '1000',
        childMetageneration: '1',
        parentGeneration: null,
        parentMetageneration: null,
      },
    });
    expect(result.kind).to.equal('no-drift');
  });

  it('phaseA.parentGeneration null + current.parentGeneration あり (parent 新規発見) → parentGenerationChanged', () => {
    const result = detectDrift({
      phaseA: {
        firestoreUpdateTime: '2026-05-14T10:00:00.000Z',
        childGeneration: '1000',
        childMetageneration: '1',
        parentGeneration: null,
        parentMetageneration: null,
      },
      current: {
        firestoreUpdateTime: '2026-05-14T10:00:00.000Z',
        childGeneration: '1000',
        childMetageneration: '1',
        parentGeneration: '2000',
        parentMetageneration: '1',
      },
    });
    expect(result.kind).to.equal('parentGenerationChanged');
  });

  it('phaseA.parentGeneration あり + current.parentGeneration null (parent 消失) → parentGenerationChanged', () => {
    const result = detectDrift({
      phaseA: {
        firestoreUpdateTime: '2026-05-14T10:00:00.000Z',
        childGeneration: '1000',
        childMetageneration: '1',
        parentGeneration: '2000',
        parentMetageneration: '1',
      },
      current: {
        firestoreUpdateTime: '2026-05-14T10:00:00.000Z',
        childGeneration: '1000',
        childMetageneration: '1',
        parentGeneration: null,
        parentMetageneration: null,
      },
    });
    expect(result.kind).to.equal('parentGenerationChanged');
  });

  it('phaseA.childGeneration null + current.childGeneration あり → childGenerationChanged (orphan が埋まった)', () => {
    const result = detectDrift({
      phaseA: {
        firestoreUpdateTime: '2026-05-14T10:00:00.000Z',
        childGeneration: null,
        childMetageneration: null,
        parentGeneration: '2000',
        parentMetageneration: '1',
      },
      current: {
        firestoreUpdateTime: '2026-05-14T10:00:00.000Z',
        childGeneration: '1000',
        childMetageneration: '1',
        parentGeneration: '2000',
        parentMetageneration: '1',
      },
    });
    expect(result.kind).to.equal('childGenerationChanged');
  });
});
