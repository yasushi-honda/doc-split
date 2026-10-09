import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseImageName, summarizeAccuracy, type AccuracyRecord } from '../paddle-ocr-downscale-accuracy';

describe('parseImageName', () => {
  it('<fixtureId>__<variant>.jpg を分解する', () => {
    assert.deepEqual(parseImageName('golden-plain-01__large.jpg'), { fixtureId: 'golden-plain-01', variant: 'large' });
  });

  it('区切りが無い・拡張子違いはfail-loud', () => {
    assert.throws(() => parseImageName('golden-plain-01.jpg'));
    assert.throws(() => parseImageName('golden-plain-01__large.png'));
  });

  it('fixtureIdに許可する文字以外(パス区切りなど)はfail-loud', () => {
    assert.throws(() => parseImageName('../x__large.jpg'));
  });
});

describe('summarizeAccuracy', () => {
  const rec = (variant: string, similarity: number, ok = true): AccuracyRecord => ({
    fixtureId: 'f',
    variant,
    status: ok ? 200 : 503,
    wallMs: 1,
    similarity,
    expectedLength: 10,
    actualLength: 10,
  });

  it('variantごとに平均・最小・件数を出す', () => {
    const s = summarizeAccuracy([rec('control', 1), rec('control', 0.9), rec('large', 0.8)]);
    assert.equal(s.control.count, 2);
    assert.ok(Math.abs(s.control.mean - 0.95) < 1e-9);
    assert.equal(s.control.min, 0.9);
    assert.equal(s.large.mean, 0.8);
  });

  it('失敗(200以外)は類似度0として平均に含め、失敗件数も数える', () => {
    const s = summarizeAccuracy([rec('large', 1), rec('large', 0, false)]);
    assert.equal(s.large.mean, 0.5);
    assert.equal(s.large.failed, 1);
  });

  it('レコードが空ならfail-loud', () => {
    assert.throws(() => summarizeAccuracy([]));
  });
});
