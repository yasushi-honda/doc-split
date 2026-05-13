/**
 * Issue #432 PR-C3c AC15-3 強化: scripts/lib/sourceManifestDrift.ts の pure function 単体テスト。
 *
 * Codex MCP NO-GO (session `019e1e7b-...`) 指摘:「sourceManifestHash 自己整合性は通すが、
 * 現在 GCS 状態との再計算照合が未実装」を解消する pure function 部分のカバレッジ。
 *
 * I/O 部分 (listing + getMetadata 並列 8) は classify-collision-docs.ts 側で実施し、
 * dev リハーサル Stage 3 (classify run) で integration test。
 */

import { expect } from 'chai';
import {
  CurrentGcsState,
  ManifestDriftResult,
  compareSurveyManifestToCurrentGcs,
  formatDriftError,
  hasManifestDrift,
  SURVEY_OR_PRECONDITION_DRIFT_RUNBOOK,
} from '../../scripts/lib/sourceManifestDrift';
import type { SourceManifestEntry } from '../../scripts/lib/collisionPlanTypes';

function makeEntry(
  objectName: string,
  generation: string,
  metageneration: string,
  bucket = 'b',
  prefix = 'processed/'
): SourceManifestEntry {
  return {
    bucket,
    prefix,
    objectName,
    generation,
    metageneration,
    size: '1024',
    sha256: 'a'.repeat(64),
  };
}

function makeState(
  entries: Array<{ name: string; generation: string; metageneration: string }>
): CurrentGcsState {
  return {
    objectNames: new Set(entries.map((e) => e.name)),
    metadata: new Map(
      entries.map((e) => [
        e.name,
        { generation: e.generation, metageneration: e.metageneration },
      ])
    ),
  };
}

describe('compareSurveyManifestToCurrentGcs (AC15-3 強化)', () => {
  it('returns empty drift when survey and GCS match exactly', () => {
    const entries = [
      makeEntry('processed/a.pdf', '100', '1'),
      makeEntry('processed/b.pdf', '200', '1'),
    ];
    const state = makeState([
      { name: 'processed/a.pdf', generation: '100', metageneration: '1' },
      { name: 'processed/b.pdf', generation: '200', metageneration: '1' },
    ]);
    const result = compareSurveyManifestToCurrentGcs(entries, state);
    expect(result.missingInGcs).to.deep.equal([]);
    expect(result.extraInGcs).to.deep.equal([]);
    expect(result.generationMismatches).to.deep.equal([]);
    expect(result.metagenerationMismatches).to.deep.equal([]);
    expect(result.metadataFetchErrors).to.deep.equal([]);
    expect(hasManifestDrift(result)).to.equal(false);
  });

  it('detects missingInGcs when survey has object that current GCS does not', () => {
    const entries = [
      makeEntry('processed/a.pdf', '100', '1'),
      makeEntry('processed/b.pdf', '200', '1'),
    ];
    const state = makeState([
      { name: 'processed/a.pdf', generation: '100', metageneration: '1' },
    ]);
    const result = compareSurveyManifestToCurrentGcs(entries, state);
    expect(result.missingInGcs).to.deep.equal(['processed/b.pdf']);
    expect(result.extraInGcs).to.deep.equal([]);
    expect(hasManifestDrift(result)).to.equal(true);
  });

  it('detects extraInGcs when current GCS has object that survey does not', () => {
    const entries = [makeEntry('processed/a.pdf', '100', '1')];
    const state = makeState([
      { name: 'processed/a.pdf', generation: '100', metageneration: '1' },
      { name: 'processed/new.pdf', generation: '999', metageneration: '1' },
    ]);
    const result = compareSurveyManifestToCurrentGcs(entries, state);
    expect(result.missingInGcs).to.deep.equal([]);
    expect(result.extraInGcs).to.deep.equal(['processed/new.pdf']);
    expect(hasManifestDrift(result)).to.equal(true);
  });

  it('detects generation mismatch when same objectName has different generation', () => {
    const entries = [makeEntry('processed/a.pdf', '100', '1')];
    const state = makeState([
      { name: 'processed/a.pdf', generation: '101', metageneration: '1' },
    ]);
    const result = compareSurveyManifestToCurrentGcs(entries, state);
    expect(result.generationMismatches).to.deep.equal([
      { objectName: 'processed/a.pdf', surveyGeneration: '100', currentGeneration: '101' },
    ]);
    expect(result.metagenerationMismatches).to.deep.equal([]);
    expect(hasManifestDrift(result)).to.equal(true);
  });

  it('detects metageneration mismatch when generation matches but metageneration differs', () => {
    const entries = [makeEntry('processed/a.pdf', '100', '1')];
    const state = makeState([
      { name: 'processed/a.pdf', generation: '100', metageneration: '2' },
    ]);
    const result = compareSurveyManifestToCurrentGcs(entries, state);
    expect(result.generationMismatches).to.deep.equal([]);
    expect(result.metagenerationMismatches).to.deep.equal([
      {
        objectName: 'processed/a.pdf',
        surveyMetageneration: '1',
        currentMetageneration: '2',
      },
    ]);
    expect(hasManifestDrift(result)).to.equal(true);
  });

  it('skips metageneration comparison when generation already mismatched', () => {
    // generation 不一致なら metageneration は別世代の値で意味を成さない設計
    const entries = [makeEntry('processed/a.pdf', '100', '1')];
    const state = makeState([
      { name: 'processed/a.pdf', generation: '999', metageneration: '7' },
    ]);
    const result = compareSurveyManifestToCurrentGcs(entries, state);
    expect(result.generationMismatches).to.have.length(1);
    expect(result.metagenerationMismatches).to.deep.equal([]);
  });

  it('combines multiple drift categories and sorts deterministically', () => {
    const entries = [
      makeEntry('processed/c.pdf', '300', '1'),
      makeEntry('processed/a.pdf', '100', '1'),
      makeEntry('processed/b.pdf', '200', '1'),
      makeEntry('processed/d.pdf', '400', '1'),
    ];
    const state = makeState([
      // a: missing (no entry in state)
      // b: generation mismatch
      { name: 'processed/b.pdf', generation: '999', metageneration: '1' },
      // c: metageneration mismatch
      { name: 'processed/c.pdf', generation: '300', metageneration: '9' },
      // d: missing
      // e: extra (in GCS only)
      { name: 'processed/e.pdf', generation: '500', metageneration: '1' },
      { name: 'processed/f.pdf', generation: '600', metageneration: '1' },
    ]);
    const result = compareSurveyManifestToCurrentGcs(entries, state);
    expect(result.missingInGcs).to.deep.equal(['processed/a.pdf', 'processed/d.pdf']);
    expect(result.extraInGcs).to.deep.equal(['processed/e.pdf', 'processed/f.pdf']);
    expect(result.generationMismatches).to.deep.equal([
      { objectName: 'processed/b.pdf', surveyGeneration: '200', currentGeneration: '999' },
    ]);
    expect(result.metagenerationMismatches).to.deep.equal([
      {
        objectName: 'processed/c.pdf',
        surveyMetageneration: '1',
        currentMetageneration: '9',
      },
    ]);
    expect(hasManifestDrift(result)).to.equal(true);
  });

  it('treats metadataFetchErrors as drift (transient errors block re-confirmation)', () => {
    const entries = [makeEntry('processed/a.pdf', '100', '1')];
    const state = makeState([
      { name: 'processed/a.pdf', generation: '100', metageneration: '1' },
    ]);
    const result = compareSurveyManifestToCurrentGcs(entries, state, [
      { objectName: 'processed/x.pdf', error: '503 Service Unavailable' },
    ]);
    expect(result.missingInGcs).to.deep.equal([]);
    expect(result.extraInGcs).to.deep.equal([]);
    expect(result.metadataFetchErrors).to.deep.equal([
      { objectName: 'processed/x.pdf', error: '503 Service Unavailable' },
    ]);
    expect(hasManifestDrift(result)).to.equal(true);
  });

  it('returns empty drift when both survey and GCS are empty', () => {
    const result = compareSurveyManifestToCurrentGcs([], makeState([]));
    expect(hasManifestDrift(result)).to.equal(false);
  });
});

describe('hasManifestDrift', () => {
  const baseResult: ManifestDriftResult = {
    missingInGcs: [],
    extraInGcs: [],
    generationMismatches: [],
    metagenerationMismatches: [],
    metadataFetchErrors: [],
  };

  it('returns false for fully empty drift result', () => {
    expect(hasManifestDrift(baseResult)).to.equal(false);
  });

  it('returns true if missingInGcs is non-empty', () => {
    expect(hasManifestDrift({ ...baseResult, missingInGcs: ['x'] })).to.equal(true);
  });

  it('returns true if extraInGcs is non-empty', () => {
    expect(hasManifestDrift({ ...baseResult, extraInGcs: ['x'] })).to.equal(true);
  });

  it('returns true if generationMismatches is non-empty', () => {
    expect(
      hasManifestDrift({
        ...baseResult,
        generationMismatches: [
          { objectName: 'x', surveyGeneration: '1', currentGeneration: '2' },
        ],
      })
    ).to.equal(true);
  });

  it('returns true if metagenerationMismatches is non-empty', () => {
    expect(
      hasManifestDrift({
        ...baseResult,
        metagenerationMismatches: [
          { objectName: 'x', surveyMetageneration: '1', currentMetageneration: '2' },
        ],
      })
    ).to.equal(true);
  });

  it('returns true if metadataFetchErrors is non-empty', () => {
    expect(
      hasManifestDrift({
        ...baseResult,
        metadataFetchErrors: [{ objectName: 'x', error: 'boom' }],
      })
    ).to.equal(true);
  });
});

describe('formatDriftError', () => {
  it('returns empty string for empty drift result', () => {
    const empty: ManifestDriftResult = {
      missingInGcs: [],
      extraInGcs: [],
      generationMismatches: [],
      metagenerationMismatches: [],
      metadataFetchErrors: [],
    };
    expect(formatDriftError(empty)).to.equal('');
  });

  it('formats all five drift categories with labels', () => {
    const result: ManifestDriftResult = {
      missingInGcs: ['a.pdf'],
      extraInGcs: ['b.pdf'],
      generationMismatches: [
        { objectName: 'c.pdf', surveyGeneration: '1', currentGeneration: '2' },
      ],
      metagenerationMismatches: [
        { objectName: 'd.pdf', surveyMetageneration: '3', currentMetageneration: '4' },
      ],
      metadataFetchErrors: [{ objectName: 'e.pdf', error: '503' }],
    };
    const formatted = formatDriftError(result);
    expect(formatted).to.include('missing in current GCS');
    expect(formatted).to.include('a.pdf');
    expect(formatted).to.include('extra in current GCS');
    expect(formatted).to.include('b.pdf');
    expect(formatted).to.include('generation mismatches');
    expect(formatted).to.include('c.pdf: survey=1 current=2');
    expect(formatted).to.include('metageneration mismatches');
    expect(formatted).to.include('d.pdf: surveyMeta=3 currentMeta=4');
    expect(formatted).to.include('getMetadata fetch errors');
    expect(formatted).to.include('e.pdf: 503');
  });

  it('truncates per-category items to maxItemsPerCategory and shows summary line', () => {
    const many = Array.from({ length: 15 }, (_, i) => `file-${i.toString().padStart(2, '0')}.pdf`);
    const result: ManifestDriftResult = {
      missingInGcs: many,
      extraInGcs: [],
      generationMismatches: [],
      metagenerationMismatches: [],
      metadataFetchErrors: [],
    };
    const formatted = formatDriftError(result, 5);
    expect(formatted).to.include('missing in current GCS');
    expect(formatted).to.include('file-00.pdf');
    expect(formatted).to.include('file-04.pdf');
    expect(formatted).to.not.include('file-05.pdf');
    expect(formatted).to.include('... and 10 more');
  });
});

describe('SURVEY_OR_PRECONDITION_DRIFT_RUNBOOK', () => {
  it('contains six numbered steps for operator re-run procedure', () => {
    for (const step of ['1.', '2.', '3.', '4.', '5.', '6.']) {
      expect(SURVEY_OR_PRECONDITION_DRIFT_RUNBOOK).to.include(step);
    }
  });

  it('mentions writeSummary preservation, Firestore quiesce, re-survey and re-classify', () => {
    expect(SURVEY_OR_PRECONDITION_DRIFT_RUNBOOK).to.match(/writeSummary/);
    expect(SURVEY_OR_PRECONDITION_DRIFT_RUNBOOK).to.match(/Firestore quiesce/);
    expect(SURVEY_OR_PRECONDITION_DRIFT_RUNBOOK).to.match(/pdf-feature-survey/);
    expect(SURVEY_OR_PRECONDITION_DRIFT_RUNBOOK).to.match(/classify-collision-docs/);
    expect(SURVEY_OR_PRECONDITION_DRIFT_RUNBOOK).to.match(/execute-collision-migration/);
  });
});
