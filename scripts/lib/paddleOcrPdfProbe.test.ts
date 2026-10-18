import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parsePdfProbeArgs, pixelsAtDpi, summarizePdfProbe, toPdfProbeCase } from '../paddle-ocr-pdf-probe';
import { probeOne, type ProbeResult } from '../paddle-ocr-image-probe';

const result = (width: number, height: number, status: number | null, errorCode: string | null = null, attempts = 1): ProbeResult => ({
  width,
  height,
  status,
  wallMs: 100,
  errorCode,
  attempts,
});

describe('pixelsAtDpi', () => {
  it('A4(595x842pt)とA3横(1191x842pt)をraster.pyと同じ計算で求める', () => {
    assert.equal(pixelsAtDpi(595, 842), 1652 * 2338);
    assert.equal(pixelsAtDpi(1191, 842), 3308 * 2338);
  });

  it('端数は切り捨てる(整数でない寸法。固定値: 595.28x841.89pt → 1653x2338)', () => {
    assert.equal(pixelsAtDpi(595.28, 841.89), 1653 * 2338);
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

  it('ケース数は6件まで通り、7件はfail-loud(ワークフロー側の上限6件と同値)', () => {
    const six = '600x800,610x800,620x800,630x800,640x800,650x800';
    assert.equal(parsePdfProbeArgs(['--dir=d', `--cases=${six}`]).cases.length, 6);
    assert.throws(() => parsePdfProbeArgs(['--dir=d', `--cases=${six},660x800`]));
  });

  it('重複(先頭ゼロ・大文字Xの表記ゆれ含む)は1件にまとめる', () => {
    assert.deepEqual(parsePdfProbeArgs(['--dir=d', '--cases=595x842,0595X842']).cases, [{ width: 595, height: 842 }]);
  });

  it('--cases・--dir が空文字でもfail-loudにする', () => {
    assert.throws(() => parsePdfProbeArgs(['--dir=d', '--cases=']));
    assert.throws(() => parsePdfProbeArgs(['--dir=', '--cases=595x842']));
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
    assert.equal(toPdfProbeCase(result(595, 842, 429)).outcome, 'failed');
  });

  it('1回目が失敗し再試行で200になったケースはrecoveredにする(okにしない)', () => {
    const c = toPdfProbeCase(result(1191, 842, 200, null, 2));
    assert.equal(c.outcome, 'recovered');
    assert.equal(c.attempts, 2);
  });

  it('attempts未設定は1回扱い(ok)', () => {
    const r = result(595, 842, 200);
    delete r.attempts;
    const c = toPdfProbeCase(r);
    assert.equal(c.outcome, 'ok');
    assert.equal(c.attempts, 1);
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

  it('入力拒否のケースがあっても、初回成功の対照と別ケースの失敗があればFAILURESを優先し、拒否ケースも列挙する', () => {
    const s = summarizePdfProbe([result(595, 842, 200), result(704, 1000, 422), result(1191, 842, 503)].map(toPdfProbeCase));
    assert.equal(s.verdict, 'FAILURES');
    assert.deepEqual(s.failedCases, ['1191x842']);
    assert.deepEqual(s.rejectedCases, ['704x1000']);
  });

  it('再試行で復旧したケースはNO_FAILUREにせず、FAILURESとしてrecoveredCasesに列挙する', () => {
    const s = summarizePdfProbe([result(595, 842, 200), result(1191, 842, 200, null, 2)].map(toPdfProbeCase));
    assert.equal(s.verdict, 'FAILURES');
    assert.deepEqual(s.recoveredCases, ['1191x842']);
    assert.deepEqual(s.failedCases, []);
  });

  it('初回成功の対照が無ければ、失敗があってもINCONCLUSIVE(サービス不調と画素数起因を区別できない)', () => {
    assert.equal(summarizePdfProbe([result(1191, 842, 503)].map(toPdfProbeCase)).verdict, 'INCONCLUSIVE');
    assert.equal(summarizePdfProbe([result(1191, 842, 200, null, 2)].map(toPdfProbeCase)).verdict, 'INCONCLUSIVE');
    assert.equal(summarizePdfProbe([result(595, 842, 422), result(1191, 842, 503)].map(toPdfProbeCase)).verdict, 'INCONCLUSIVE');
  });

  it('複数の失敗ケースは入力順で列挙し、caveatを必ず含める', () => {
    const s = summarizePdfProbe([result(595, 842, 200), result(704, 1000, 503), result(1191, 842, null, 'CLIENT_TIMEOUT')].map(toPdfProbeCase));
    assert.deepEqual(s.failedCases, ['704x1000', '1191x842']);
    assert.ok(s.caveat.length > 0);
  });

  it('結果が空なら例外にする', () => {
    assert.throws(() => summarizePdfProbe([]));
  });
});

describe('probeOne のContent-Type', () => {
  const realFetch = globalThis.fetch;
  const tmpDirs: string[] = [];
  afterEach(() => {
    globalThis.fetch = realFetch;
    while (tmpDirs.length > 0) {
      fs.rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
    }
  });

  const captureHeaders = async (contentType?: string): Promise<Record<string, string>> => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-one-'));
    tmpDirs.push(dir);
    const file = path.join(dir, 'x.bin');
    fs.writeFileSync(file, Buffer.from([1, 2, 3]));
    let captured: Record<string, string> = {};
    globalThis.fetch = (async (_url: unknown, init?: { headers?: Record<string, string> }) => {
      captured = init?.headers ?? {};
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const size = { width: 1, height: 1 };
    await (contentType === undefined
      ? probeOne('https://example.invalid', 'tok', file, size)
      : probeOne('https://example.invalid', 'tok', file, size, contentType));
    return captured;
  };

  it('第5引数を省略すると従来どおりimage/jpegを送る(既存の画像プローブの挙動は不変)', async () => {
    assert.deepEqual(await captureHeaders(), { 'Content-Type': 'image/jpeg', Authorization: 'Bearer tok' });
  });

  it('application/pdfを渡すとPDFとして送る', async () => {
    assert.deepEqual(await captureHeaders('application/pdf'), { 'Content-Type': 'application/pdf', Authorization: 'Bearer tok' });
  });
});
