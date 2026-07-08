import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decideBackfillAction,
  buildDetailPayload,
  canonicalHash,
  canonicalStringify,
  createCounters,
} from './backfillDetailHelpers';

test('decideBackfillAction: pending/processingはstatus優先でin-pipelineスキップ(detail有無より優先)', () => {
  assert.equal(decideBackfillAction({ status: 'pending', detailExists: false }), 'skip-in-pipeline');
  assert.equal(decideBackfillAction({ status: 'pending', detailExists: true }), 'skip-in-pipeline');
  assert.equal(decideBackfillAction({ status: 'processing', detailExists: false }), 'skip-in-pipeline');
});

test('decideBackfillAction: detail既存はスキップ(冪等性)', () => {
  assert.equal(decideBackfillAction({ status: 'processed', detailExists: true }), 'skip-detail-exists');
  assert.equal(decideBackfillAction({ status: 'error', detailExists: true }), 'skip-detail-exists');
});

test('decideBackfillAction: processed/error/split等のdetail不在docはbackfill対象(processed限定にしない — Codex C2反映)', () => {
  assert.equal(decideBackfillAction({ status: 'processed', detailExists: false }), 'backfill');
  assert.equal(decideBackfillAction({ status: 'error', detailExists: false }), 'backfill');
  assert.equal(decideBackfillAction({ status: 'split', detailExists: false }), 'backfill');
});

test('decideBackfillAction: status欠落/非文字列のdocもbackfill対象(存在保証の網羅性)', () => {
  assert.equal(decideBackfillAction({ status: undefined, detailExists: false }), 'backfill');
  assert.equal(decideBackfillAction({ status: 123, detailExists: false }), 'backfill');
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

test('buildDetailPayload: 両フィールド不在なら空オブジェクト(存在保証のため空でも作成)', () => {
  assert.deepEqual(buildDetailPayload({ customerName: 'x' }), {});
});

test('buildDetailPayload: 型不正(非string/非array)はコピーしない', () => {
  assert.deepEqual(buildDetailPayload({ ocrResult: 123, pageResults: 'not-array' }), {});
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

test('createCounters: 全カウンタ0で初期化', () => {
  const c = createCounters();
  assert.equal(Object.values(c).every((v) => v === 0), true);
});
