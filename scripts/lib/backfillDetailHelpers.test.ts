import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decideBackfillAction,
  buildDetailPayload,
  detectStaleDetail,
  canonicalHash,
  canonicalStringify,
  createCounters,
} from './backfillDetailHelpers';

test('decideBackfillAction: pending/processingはstatus優先でin-pipelineスキップ(detail有無・excerpt有無より優先)', () => {
  assert.equal(
    decideBackfillAction({ status: 'pending', detailExists: false, hasOcrExcerpt: false }),
    'skip-in-pipeline'
  );
  assert.equal(
    decideBackfillAction({ status: 'pending', detailExists: true, hasOcrExcerpt: true }),
    'skip-in-pipeline'
  );
  assert.equal(
    decideBackfillAction({ status: 'processing', detailExists: false, hasOcrExcerpt: false }),
    'skip-in-pipeline'
  );
});

test('decideBackfillAction: detail既存+excerpt既存は完了スキップ(冪等性)', () => {
  assert.equal(
    decideBackfillAction({ status: 'processed', detailExists: true, hasOcrExcerpt: true }),
    'skip-complete'
  );
  assert.equal(
    decideBackfillAction({ status: 'error', detailExists: true, hasOcrExcerpt: true }),
    'skip-complete'
  );
});

test('decideBackfillAction: detail既存でもexcerpt欠落ならexcerpt-only対象(Codex Phase C review P1: seed-dev-data等のdetailのみdual-write経路)', () => {
  assert.equal(
    decideBackfillAction({ status: 'processed', detailExists: true, hasOcrExcerpt: false }),
    'backfill-excerpt-only'
  );
  assert.equal(
    decideBackfillAction({ status: 'error', detailExists: true, hasOcrExcerpt: false }),
    'backfill-excerpt-only'
  );
});

test('decideBackfillAction: processed/error/split等のdetail不在docはフルbackfill対象(processed限定にしない — Codex C2反映)', () => {
  for (const status of ['processed', 'error', 'split']) {
    assert.equal(
      decideBackfillAction({ status, detailExists: false, hasOcrExcerpt: false }),
      'backfill-detail-and-excerpt'
    );
  }
  // excerptが既にあってもdetail不在ならフルbackfill(excerptは同値上書きで冪等)
  assert.equal(
    decideBackfillAction({ status: 'processed', detailExists: false, hasOcrExcerpt: true }),
    'backfill-detail-and-excerpt'
  );
});

test('decideBackfillAction: status欠落/非文字列のdocもbackfill対象(存在保証の網羅性)', () => {
  assert.equal(
    decideBackfillAction({ status: undefined, detailExists: false, hasOcrExcerpt: false }),
    'backfill-detail-and-excerpt'
  );
  assert.equal(
    decideBackfillAction({ status: 123, detailExists: false, hasOcrExcerpt: false }),
    'backfill-detail-and-excerpt'
  );
});

test('buildDetailPayload: ocrResult/pageResultsが存在すればコピーする', () => {
  const payload = buildDetailPayload({
    ocrResult: 'テキスト',
    pageResults: [{ pageNumber: 1 }],
    customerName: 'コピーされない他フィールド',
  });
  assert.deepEqual(payload, { ocrResult: 'テキスト', pageResults: [{ pageNumber: 1 }] });
});

test('buildDetailPayload: 空文字列のocrResultもコピーする(Storage offload済みdoc互換)', () => {
  assert.deepEqual(buildDetailPayload({ ocrResult: '' }), { ocrResult: '' });
});

test('buildDetailPayload: ocrResult不在でも空文字列で必ず書く(本番全作成経路の「常にstring」不変条件維持、review C1)', () => {
  assert.deepEqual(buildDetailPayload({ customerName: 'x' }), { ocrResult: '' });
});

test('buildDetailPayload: 型不正(非string/非array)はocrResult空文字フォールバック+pageResults省略', () => {
  assert.deepEqual(buildDetailPayload({ ocrResult: 123, pageResults: 'not-array' }), { ocrResult: '' });
});

test('buildDetailPayload: 空のpageResults配列は捏造せずそのままコピー(親に実在する場合のみ)', () => {
  assert.deepEqual(buildDetailPayload({ ocrResult: 'x', pageResults: [] }), {
    ocrResult: 'x',
    pageResults: [],
  });
});

test('detectStaleDetail: 親クリア済み(ocrResult不在)+detailに非空コンテンツ残存はstale (Codex 3rd P1)', () => {
  assert.equal(detectStaleDetail({}, { ocrResult: '古いOCRテキスト' }), true);
  assert.equal(detectStaleDetail({ status: 'error' }, { pageResults: [{ pageNumber: 1 }] }), true);
});

test('detectStaleDetail: 親にocrResultがstringで存在すればstaleではない(通常のparity検証対象)', () => {
  assert.equal(detectStaleDetail({ ocrResult: 'text' }, { ocrResult: '別のtext' }), false);
  // Storage offload済み(親ocrResult='')もstring存在扱い
  assert.equal(detectStaleDetail({ ocrResult: '' }, { ocrResult: '古い残存' }), false);
});

test('detectStaleDetail: detail側が空コンテンツ(backfill自身が書くocrResult:\'\'等)はstaleではない', () => {
  assert.equal(detectStaleDetail({}, { ocrResult: '' }), false);
  assert.equal(detectStaleDetail({}, { ocrResult: '', pageResults: [] }), false);
  assert.equal(detectStaleDetail({}, {}), false);
});

test('canonicalStringify: キー順序が異なる同一オブジェクトは同一文字列', () => {
  const a = { x: 1, y: { b: 2, a: 3 } };
  const b = { y: { a: 3, b: 2 }, x: 1 };
  assert.equal(canonicalStringify(a), canonicalStringify(b));
});

test('canonicalHash: キー順序が異なる同一内容は同一ハッシュ、内容差は別ハッシュ', () => {
  assert.equal(canonicalHash({ a: 1, b: [1, 2] }), canonicalHash({ b: [1, 2], a: 1 }));
  assert.notEqual(canonicalHash({ a: 1 }), canonicalHash({ a: 2 }));
});

test('canonicalStringify: 配列の順序は保持される(pageResultsのページ順は意味を持つ)', () => {
  assert.notEqual(canonicalStringify([1, 2]), canonicalStringify([2, 1]));
});

test('canonicalStringify: null/プリミティブ/空配列/空オブジェクトの境界値', () => {
  assert.equal(canonicalStringify(null), 'null');
  assert.equal(canonicalStringify(''), '""');
  assert.equal(canonicalStringify([]), '[]');
  assert.equal(canonicalStringify({}), '{}');
});

test('canonicalStringify: undefined(フィールド不在のdetail.ocrResult等)は安定した文字列を返しnull/\'\'と区別される', () => {
  assert.equal(canonicalStringify(undefined), 'undefined');
  assert.notEqual(canonicalHash(undefined), canonicalHash(null));
  assert.notEqual(canonicalHash(undefined), canonicalHash(''));
});

test('createCounters: 全カウンタ0で初期化', () => {
  const c = createCounters();
  assert.equal(Object.values(c).every((v) => v === 0), true);
});
