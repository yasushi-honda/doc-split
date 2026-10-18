import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsePdfProbeArgs, pixelsAtDpi, summarizePdfProbe, toPdfProbeCase } from '../paddle-ocr-pdf-probe';
import type { ProbeResult } from '../paddle-ocr-image-probe';

const result = (width: number, height: number, status: number | null, errorCode: string | null = null): ProbeResult => ({
  width,
  height,
  status,
  wallMs: 100,
  errorCode,
  attempts: 1,
});

describe('pixelsAtDpi', () => {
  it('A4(595x842pt)とA3横(1191x842pt)をraster.pyと同じ計算で求める', () => {
    assert.equal(pixelsAtDpi(595, 842), 1652 * 2338);
    assert.equal(pixelsAtDpi(1191, 842), 3308 * 2338);
  });

  it('端数はint()相当で切り捨てる(整数でない寸法)', () => {
    assert.equal(pixelsAtDpi(595.28, 841.89), Math.trunc(595.28 * (200 / 72)) * Math.trunc(841.89 * (200 / 72)));
  });
});

describe('parsePdfProbeArgs', () => {
  it('--dir と --cases を解釈し、casesは長辺→面積の昇順に並ぶ', () => {
    const a = parsePdfProbeArgs(['--dir=probe-pdfs', '--cases=1191x842,595x842,704x1000']);
    assert.deepEqual(a.cases, [
      { width: 595, height: 842 },
      { width: 704, height: 1000 },
      { width: 1191, height: 842 },
    ]);
    assert.equal(a.out, 'paddle-ocr-pdf-probe.json');
    assert.equal(a.url, undefined);
  });

  it('必須引数の欠落・未知のオプション・不正な寸法はfail-loudにする', () => {
    assert.throws(() => parsePdfProbeArgs(['--cases=595x842']));
    assert.throws(() => parsePdfProbeArgs(['--dir=d']));
    assert.throws(() => parsePdfProbeArgs(['--dir=d', '--cases=595x842', '--foo=1']));
    assert.throws(() => parsePdfProbeArgs(['--dir=d', '--cases=0x842']));
  });
});

describe('toPdfProbeCase / summarizePdfProbe', () => {
  it('200はok、422等の入力拒否はrejected、5xx・ネットワーク断はfailedに分類する', () => {
    assert.equal(toPdfProbeCase(result(595, 842, 200)).outcome, 'ok');
    assert.equal(toPdfProbeCase(result(595, 842, 422, 'PIXEL_LIMIT_EXCEEDED')).outcome, 'rejected');
    assert.equal(toPdfProbeCase(result(595, 842, 503)).outcome, 'failed');
    assert.equal(toPdfProbeCase(result(595, 842, null, 'NETWORK_ERROR')).outcome, 'failed');
  });

  it('失敗が1件でもあればFAILURESとして失敗ケースを列挙する', () => {
    const s = summarizePdfProbe([result(595, 842, 200), result(1191, 842, 503)].map(toPdfProbeCase));
    assert.equal(s.verdict, 'FAILURES');
    assert.deepEqual(s.failedCases, ['1191x842']);
  });

  it('全て成功ならNO_FAILURE、成功が1件も無く全て入力拒否ならINCONCLUSIVE', () => {
    assert.equal(summarizePdfProbe([result(595, 842, 200)].map(toPdfProbeCase)).verdict, 'NO_FAILURE');
    assert.equal(summarizePdfProbe([result(595, 842, 422)].map(toPdfProbeCase)).verdict, 'INCONCLUSIVE');
  });

  it('対照が成功しても、要求ケースが入力拒否ならOCRが走っていないためINCONCLUSIVEにする', () => {
    const s = summarizePdfProbe([result(595, 842, 200), result(1191, 842, 413)].map(toPdfProbeCase));
    assert.equal(s.verdict, 'INCONCLUSIVE');
    assert.deepEqual(s.failedCases, []);
  });

  it('入力拒否のケースがあっても、別ケースの失敗があればFAILURESを優先する', () => {
    const s = summarizePdfProbe([result(595, 842, 422), result(1191, 842, 503)].map(toPdfProbeCase));
    assert.equal(s.verdict, 'FAILURES');
  });

  it('結果が空なら例外にする', () => {
    assert.throws(() => summarizePdfProbe([]));
  });
});
