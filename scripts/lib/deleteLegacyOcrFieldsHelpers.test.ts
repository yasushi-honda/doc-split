/**
 * delete-legacy-ocr-fields.ts の純粋ロジック部のテスト (ADR-0018 Phase E, Issue #547)
 */

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { decideDeletionAction, buildDeletionFieldUpdate } from './deleteLegacyOcrFieldsHelpers';

describe('decideDeletionAction', () => {
  test('status=pending は skip-in-pipeline (親の値有無に関わらず)', () => {
    assert.equal(
      decideDeletionAction({
        status: 'pending',
        parentHasOcrResult: true,
        parentHasPageResults: true,
        detailExists: true,
        ocrResultMatches: true,
        pageResultsMatches: true,
      }),
      'skip-in-pipeline'
    );
  });

  test('status=processing は skip-in-pipeline', () => {
    assert.equal(
      decideDeletionAction({
        status: 'processing',
        parentHasOcrResult: true,
        parentHasPageResults: true,
        detailExists: true,
        ocrResultMatches: true,
        pageResultsMatches: true,
      }),
      'skip-in-pipeline'
    );
  });

  test('親にocrResult/pageResultsどちらも値がない場合は already-deleted (PR-E1後の正常状態)', () => {
    assert.equal(
      decideDeletionAction({
        status: 'processed',
        parentHasOcrResult: false,
        parentHasPageResults: false,
        detailExists: true,
        ocrResultMatches: null,
        pageResultsMatches: null,
      }),
      'already-deleted'
    );
  });

  test('親に値があるがdetailが存在しない場合は skip-detail-missing', () => {
    assert.equal(
      decideDeletionAction({
        status: 'processed',
        parentHasOcrResult: true,
        parentHasPageResults: true,
        detailExists: false,
        ocrResultMatches: null,
        pageResultsMatches: null,
      }),
      'skip-detail-missing'
    );
  });

  test('親ocrResultありdetailと不一致の場合は skip-mismatch', () => {
    assert.equal(
      decideDeletionAction({
        status: 'processed',
        parentHasOcrResult: true,
        parentHasPageResults: false,
        detailExists: true,
        ocrResultMatches: false,
        pageResultsMatches: null,
      }),
      'skip-mismatch'
    );
  });

  test('親pageResultsありdetailと不一致の場合は skip-mismatch (ocrResultは一致)', () => {
    assert.equal(
      decideDeletionAction({
        status: 'processed',
        parentHasOcrResult: true,
        parentHasPageResults: true,
        detailExists: true,
        ocrResultMatches: true,
        pageResultsMatches: false,
      }),
      'skip-mismatch'
    );
  });

  test('親にocrResult/pageResults両方あり、両方detailと一致する場合は delete', () => {
    assert.equal(
      decideDeletionAction({
        status: 'processed',
        parentHasOcrResult: true,
        parentHasPageResults: true,
        detailExists: true,
        ocrResultMatches: true,
        pageResultsMatches: true,
      }),
      'delete'
    );
  });

  test('親にocrResultのみ存在(pageResultsは既にない)、detailと一致する場合は delete', () => {
    assert.equal(
      decideDeletionAction({
        status: 'processed',
        parentHasOcrResult: true,
        parentHasPageResults: false,
        detailExists: true,
        ocrResultMatches: true,
        pageResultsMatches: null,
      }),
      'delete'
    );
  });

  test('親にpageResultsのみ存在(ocrResultは既にない)、detailと一致する場合は delete', () => {
    assert.equal(
      decideDeletionAction({
        status: 'processed',
        parentHasOcrResult: false,
        parentHasPageResults: true,
        detailExists: true,
        ocrResultMatches: null,
        pageResultsMatches: true,
      }),
      'delete'
    );
  });

  test('status未定義(undefined)でも in-pipeline扱いされず通常判定に進む', () => {
    assert.equal(
      decideDeletionAction({
        status: undefined,
        parentHasOcrResult: false,
        parentHasPageResults: false,
        detailExists: true,
        ocrResultMatches: null,
        pageResultsMatches: null,
      }),
      'already-deleted'
    );
  });

  test('status=error でも親に値があり一致すれば delete対象になる(in-pipelineではないため)', () => {
    assert.equal(
      decideDeletionAction({
        status: 'error',
        parentHasOcrResult: true,
        parentHasPageResults: true,
        detailExists: true,
        ocrResultMatches: true,
        pageResultsMatches: true,
      }),
      'delete'
    );
  });
});

describe('buildDeletionFieldUpdate', () => {
  test('親にocrResult/pageResults両方ある場合、両方のFieldValue.deleteキーを含む', () => {
    const update = buildDeletionFieldUpdate({ parentHasOcrResult: true, parentHasPageResults: true });
    assert.deepEqual(Object.keys(update).sort(), ['ocrResult', 'pageResults']);
  });

  test('親にocrResultのみある場合、ocrResultキーのみ含む(pageResultsは含めない)', () => {
    const update = buildDeletionFieldUpdate({ parentHasOcrResult: true, parentHasPageResults: false });
    assert.deepEqual(Object.keys(update), ['ocrResult']);
  });

  test('親にpageResultsのみある場合、pageResultsキーのみ含む', () => {
    const update = buildDeletionFieldUpdate({ parentHasOcrResult: false, parentHasPageResults: true });
    assert.deepEqual(Object.keys(update), ['pageResults']);
  });

  test('親にどちらもない場合、空オブジェクトを返す(呼出元は削除自体をskipする想定)', () => {
    const update = buildDeletionFieldUpdate({ parentHasOcrResult: false, parentHasPageResults: false });
    assert.deepEqual(Object.keys(update), []);
  });
});
