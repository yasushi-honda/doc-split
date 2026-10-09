import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SIZES, hasAccessError, parseProbeArgs, parseSizes, shouldRetry, summarizeProbe, type ProbeResult } from '../paddle-ocr-image-probe';

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

describe('parseSizes の正規化', () => {
  it('長辺の昇順に並べ替える(クラッシュ後の再起動で小さい画像が巻き添え失敗するのを避ける)', () => {
    assert.deepEqual(parseSizes('4080x3060,3000x2250,4000x3000'), [
      { width: 3000, height: 2250 },
      { width: 4000, height: 3000 },
      { width: 4080, height: 3060 },
    ]);
  });

  it('同一寸法の重複と、先頭ゼロ・大文字Xによる表記ゆれの重複は1件にまとめる', () => {
    assert.deepEqual(parseSizes('4080x3060,4080X3060,04080x3060'), [{ width: 4080, height: 3060 }]);
  });

  it('同じ長辺なら面積の小さい順に並べる', () => {
    assert.deepEqual(parseSizes('4000x3000,4000x1000'), [
      { width: 4000, height: 1000 },
      { width: 4000, height: 3000 },
    ]);
  });
});

describe('shouldRetry', () => {
  const r = (status: number | null): ProbeResult => ({ width: 1, height: 1, status, wallMs: 1, errorCode: null });

  it('503・429・5xx・ネットワーク断/タイムアウト(null)は再試行する', () => {
    assert.equal(shouldRetry(r(503)), true);
    assert.equal(shouldRetry(r(429)), true);
    assert.equal(shouldRetry(r(500)), true);
    assert.equal(shouldRetry(r(null)), true);
  });

  it('200・入力拒否・認証不備は再試行しない', () => {
    assert.equal(shouldRetry(r(200)), false);
    assert.equal(shouldRetry(r(422)), false);
    assert.equal(shouldRetry(r(401)), false);
  });
});

describe('parseSizes の上限', () => {
  it(`${MAX_SIZES}件までは許可し、超えるとジョブ時間枠を守るためfail-loudにする`, () => {
    const ok = Array.from({ length: MAX_SIZES }, (_, i) => `${1000 + i}x1000`).join(',');
    assert.equal(parseSizes(ok).length, MAX_SIZES);
    assert.throws(() => parseSizes(`${ok},9000x1000`), /上限/);
  });
});

describe('hasAccessError', () => {
  const r = (status: number | null): ProbeResult => ({ width: 1, height: 1, status, wallMs: 1, errorCode: null });

  it('401/403/404は認証・設定不備としてプローブ自体の失敗扱いにする', () => {
    assert.equal(hasAccessError([r(200), r(401)]), true);
    assert.equal(hasAccessError([r(403)]), true);
    assert.equal(hasAccessError([r(404)]), true);
  });

  it('200・503・422・ネットワーク断は認証不備ではない', () => {
    assert.equal(hasAccessError([r(200), r(503), r(422), r(null)]), false);
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

  it('NOT_REPRODUCEDは「合成JPEGでは再現せず」の意味で、サイズ起因でないことの証明ではないと注記する', () => {
    assert.match(summarizeProbe([ok(3000, 2250), ok(4080, 3060)]).caveat, /合成/);
  });

  it('4000px以下でも失敗するなら別原因の可能性として区別する', () => {
    assert.equal(summarizeProbe([crash(3000, 2250), crash(4080, 3060)]).verdict, 'FAILS_ALSO_AT_OR_BELOW_4000');
  });

  it('結果が空ならfail-loud', () => {
    assert.throws(() => summarizeProbe([]));
  });

  it('4000px超しか送っていない場合は、成功した対照が無いので失敗しても閾値依存とは断定しない', () => {
    assert.equal(summarizeProbe([crash(4080, 3060)]).verdict, 'INCONCLUSIVE');
  });

  it('サービスの入力拒否(400/413/415/422)は処理失敗に数えず、評価対象外にする', () => {
    const rejected: ProbeResult = { width: 9000, height: 6000, status: 422, wallMs: 50, errorCode: 'PIXEL_LIMIT_EXCEEDED' };
    const s = summarizeProbe([ok(3000, 2250), rejected]);
    assert.equal(s.above4000.failed, 0);
    assert.equal(s.above4000.rejected, 1);
    assert.equal(s.verdict, 'INCONCLUSIVE');
  });

  it('入力拒否と処理失敗が混在しても、対照成功+超側の処理失敗なら閾値依存と判定する', () => {
    const rejected: ProbeResult = { width: 9000, height: 6000, status: 422, wallMs: 50, errorCode: 'PIXEL_LIMIT_EXCEEDED' };
    assert.equal(summarizeProbe([ok(3000, 2250), rejected, crash(4080, 3060)]).verdict, 'FAILS_ONLY_ABOVE_4000');
  });

  it('ネットワーク断・タイムアウト(status null)は処理失敗に数える', () => {
    const timeout: ProbeResult = { width: 4080, height: 3060, status: null, wallMs: 250000, errorCode: 'CLIENT_TIMEOUT' };
    assert.equal(summarizeProbe([ok(3000, 2250), timeout]).verdict, 'FAILS_ONLY_ABOVE_4000');
  });
});
