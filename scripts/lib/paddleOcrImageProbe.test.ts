import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseProbeArgs, parseSizes, summarizeProbe, type ProbeResult } from '../paddle-ocr-image-probe';

describe('parseSizes', () => {
  it('WxH をカンマ区切りで解釈する', () => {
    assert.deepEqual(parseSizes('3000x2250,4080x3060'), [
      { width: 3000, height: 2250 },
      { width: 4080, height: 3060 },
    ]);
  });

  it('大文字Xと前後空白を許容する', () => {
    assert.deepEqual(parseSizes(' 4000X3000 '), [{ width: 4000, height: 3000 }]);
  });

  it('不正な形式・0・負数・空はfail-loudにする', () => {
    assert.throws(() => parseSizes(''));
    assert.throws(() => parseSizes('4000'));
    assert.throws(() => parseSizes('0x100'));
    assert.throws(() => parseSizes('-1x100'));
    assert.throws(() => parseSizes('axb'));
  });
});

describe('parseProbeArgs', () => {
  it('--dir と --sizes が必須', () => {
    assert.throws(() => parseProbeArgs([]));
    assert.throws(() => parseProbeArgs(['--dir=/tmp/x']));
  });

  it('既定値を補う', () => {
    const a = parseProbeArgs(['--dir=/tmp/x', '--sizes=4080x3060']);
    assert.equal(a.dir, '/tmp/x');
    assert.deepEqual(a.sizes, [{ width: 4080, height: 3060 }]);
    assert.equal(a.out, 'paddle-ocr-image-probe.json');
  });

  it('未知のオプションはfail-loud', () => {
    assert.throws(() => parseProbeArgs(['--dir=/tmp/x', '--sizes=1x1', '--bogus=1']));
  });
});

describe('summarizeProbe', () => {
  const ok = (w: number, h: number): ProbeResult => ({ width: w, height: h, status: 200, wallMs: 1000, errorCode: null });
  const crash = (w: number, h: number): ProbeResult => ({ width: w, height: h, status: 503, wallMs: 2500, errorCode: null });

  it('長辺4000px以下と超を分けて集計し、超側だけ失敗なら閾値依存と判定する', () => {
    const s = summarizeProbe([ok(3000, 2250), ok(4000, 3000), crash(4080, 3060)]);
    assert.equal(s.atOrBelow4000.failed, 0);
    assert.equal(s.above4000.failed, 1);
    assert.equal(s.verdict, 'FAILS_ONLY_ABOVE_4000');
  });

  it('全て成功なら再現しない', () => {
    assert.equal(summarizeProbe([ok(3000, 2250), ok(4080, 3060)]).verdict, 'NOT_REPRODUCED');
  });

  it('4000px以下でも失敗するなら別原因の可能性として区別する', () => {
    assert.equal(summarizeProbe([crash(3000, 2250), crash(4080, 3060)]).verdict, 'FAILS_ALSO_AT_OR_BELOW_4000');
  });

  it('結果が空ならfail-loud', () => {
    assert.throws(() => summarizeProbe([]));
  });
});
