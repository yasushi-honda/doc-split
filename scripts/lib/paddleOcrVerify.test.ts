import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  GOLDEN_CASES,
  parseEnvField,
  requireEnvField,
  resolveServiceUrl,
  verifyGoldenManifestHashes,
  deriveExpectedModelVersion,
  decodeJwtExpSeconds,
  IdTokenProvider,
  snapshotsMatch,
  classifyFailure,
  summarizeLatencies,
  projectToSeconds,
  gateVerdict,
  compareGoldenText,
  checkContract,
  contractOk,
  buildReport,
  determineExitCode,
  buildOcrEndpoint,
  buildStepSummaryMarkdown,
  parseArgs,
  sha256File,
  sendGoldenCaseWithRetries,
  GATE_THRESHOLDS_SECONDS,
  type GoldenManifest,
  type GoldenRequestRecord,
  type OcrAttemptResult,
  type OcrRequestFn,
} from '../paddle-ocr-verify';

const DEV_ENV_PATH = path.join(__dirname, '..', 'clients', 'dev.env');
const REAL_DEV_URL = 'https://paddle-ocr-whfgr6jwaa-an.a.run.app';
const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'paddle-ocr-golden');
const MANIFEST_PATH = path.join(FIXTURE_DIR, 'manifest.json');

// ---------------------------------------------------------------------------
// GOLDEN_CASES / fixture対応表
// ---------------------------------------------------------------------------

test('GOLDEN_CASES: 6件、multipage-01のみpageIndexが0/1で分かれる', () => {
  assert.equal(GOLDEN_CASES.length, 6);
  const multipage = GOLDEN_CASES.filter((c) => c.manifestId === 'golden-multipage-01');
  assert.equal(multipage.length, 2);
  assert.deepEqual(
    multipage.map((c) => c.pageIndex).sort(),
    [0, 1]
  );
});

// ---------------------------------------------------------------------------
// parseEnvField / requireEnvField
// ---------------------------------------------------------------------------

test('parseEnvField: 二重引用符・前後空白を除去する', () => {
  const content = 'FOO="bar baz"\nBAZ=qux\n';
  assert.equal(parseEnvField(content, 'FOO'), 'bar baz');
  assert.equal(parseEnvField(content, 'BAZ'), 'qux');
});

test('parseEnvField: キーが存在しない場合nullを返す', () => {
  assert.equal(parseEnvField('FOO=bar', 'MISSING'), null);
});

test('requireEnvField: プレースホルダー値(<TBD>等)はエラーにする', () => {
  assert.throws(() => requireEnvField('URL="<TBD>"', 'URL', 'test.env'));
  assert.throws(() => requireEnvField('URL=""', 'URL', 'test.env'));
});

test('requireEnvField: 正常値はそのまま返す', () => {
  assert.equal(requireEnvField('URL="https://example.com"', 'URL', 'test.env'), 'https://example.com');
});

// ---------------------------------------------------------------------------
// resolveServiceUrl
// ---------------------------------------------------------------------------

test('resolveServiceUrl: 優先順位は--url > 環境変数 > dev.env', () => {
  const devEnvContent = 'PADDLE_OCR_URL="https://a.example.com"';
  assert.equal(
    resolveServiceUrl({ explicitUrl: 'https://a.example.com/', devEnvContent, devEnvPathForError: 'x' }),
    'https://a.example.com/'
  );
});

test('resolveServiceUrl: envVarUrlのみ指定した場合(中間優先度)はそれが使われる', () => {
  const devEnvContent = 'PADDLE_OCR_URL="https://a.example.com"';
  assert.equal(
    resolveServiceUrl({ envVarUrl: 'https://a.example.com/path', devEnvContent, devEnvPathForError: 'x' }),
    'https://a.example.com/path'
  );
});

test('resolveServiceUrl: explicitUrlが空文字ならenvVarUrlへフォールバックする(||演算子の意図通りの挙動)', () => {
  const devEnvContent = 'PADDLE_OCR_URL="https://a.example.com"';
  assert.equal(
    resolveServiceUrl({ explicitUrl: '', envVarUrl: 'https://a.example.com/env', devEnvContent, devEnvPathForError: 'x' }),
    'https://a.example.com/env'
  );
});

test('resolveServiceUrl: ホストがdev.envと不一致なら即エラー', () => {
  const devEnvContent = 'PADDLE_OCR_URL="https://a.example.com"';
  assert.throws(() =>
    resolveServiceUrl({ explicitUrl: 'https://evil.example.com', devEnvContent, devEnvPathForError: 'x' })
  );
});

test('resolveServiceUrl: 不正なURL形式はエラーにする', () => {
  const devEnvContent = 'PADDLE_OCR_URL="https://a.example.com"';
  assert.throws(() => resolveServiceUrl({ explicitUrl: 'not-a-url', devEnvContent, devEnvPathForError: 'x' }));
});

test('resolveServiceUrl: 何も指定しなければdev.envの値を使う', () => {
  const devEnvContent = 'PADDLE_OCR_URL="https://a.example.com"';
  assert.equal(resolveServiceUrl({ devEnvContent, devEnvPathForError: 'x' }), 'https://a.example.com');
});

test('resolveServiceUrl: dev.env自体がプレースホルダーならエラー', () => {
  const devEnvContent = 'PADDLE_OCR_URL="<TBD>"';
  assert.throws(() => resolveServiceUrl({ devEnvContent, devEnvPathForError: 'x' }));
});

test('resolveServiceUrl: 実際のscripts/clients/dev.envと整合する(回帰検知)', () => {
  const devEnvContent = fs.readFileSync(DEV_ENV_PATH, 'utf-8');
  assert.equal(resolveServiceUrl({ devEnvContent, devEnvPathForError: DEV_ENV_PATH }), REAL_DEV_URL);
});

// ---------------------------------------------------------------------------
// buildOcrEndpoint
// ---------------------------------------------------------------------------

test('buildOcrEndpoint: 末尾スラッシュなしのURLはそのまま/ocrを付与する', () => {
  assert.equal(buildOcrEndpoint('https://a.example.com'), 'https://a.example.com/ocr');
});

test('buildOcrEndpoint: 末尾スラッシュ付きURLは二重スラッシュにならない(codex review 13周目指摘の回帰テスト)', () => {
  // resolveServiceUrl()は末尾スラッシュ付きURL(--url/PADDLE_OCR_URL経由)を明示的に許容する
  // (上記「優先順位は--url > 環境変数 > dev.env」テストが`https://a.example.com/`で検証済み)。
  // 従来は単純な文字列連結だったため`//ocr`という不正パスになり、Cloud Run/FastAPI側で
  // 404になって全リクエストが失敗しうる欠陥があった。
  assert.equal(buildOcrEndpoint('https://a.example.com/'), 'https://a.example.com/ocr');
});

test('buildOcrEndpoint: 末尾に複数スラッシュがあってもまとめて除去する(境界値)', () => {
  assert.equal(buildOcrEndpoint('https://a.example.com///'), 'https://a.example.com/ocr');
});

// ---------------------------------------------------------------------------
// manifest整合性チェック(実fixtureディレクトリに対して実行、回帰検知)
// ---------------------------------------------------------------------------

test('verifyGoldenManifestHashes: 実fixtureは全件ハッシュ一致する', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8')) as GoldenManifest;
  const result = verifyGoldenManifestHashes(manifest, FIXTURE_DIR);
  assert.deepEqual(result.mismatches, []);
  assert.equal(result.ok, true);
});

test('verifyGoldenManifestHashes: manifestに存在しないmanifestIdは検出する', () => {
  const manifest: GoldenManifest = {
    fixtures: {},
    textDetectionModelFileHashes: {},
    textRecognitionModelFileHashes: {},
  };
  const result = verifyGoldenManifestHashes(manifest, FIXTURE_DIR);
  assert.equal(result.ok, false);
  assert.ok(result.mismatches.some((m) => m.includes('golden-plain-01')));
});

test('verifyGoldenManifestHashes: SHA-256不一致を検出する', () => {
  const real = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8')) as GoldenManifest;
  const tampered: GoldenManifest = JSON.parse(JSON.stringify(real));
  tampered.fixtures['golden-plain-01'].sourcePdfSha256['golden_plain_01.pdf'] = 'deadbeef'.repeat(8);
  const result = verifyGoldenManifestHashes(tampered, FIXTURE_DIR);
  assert.equal(result.ok, false);
  assert.ok(result.mismatches.some((m) => m.includes('golden_plain_01.pdf')));
});

test('deriveExpectedModelVersion: 実manifestから期待modelVersionを組み立てる', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8')) as GoldenManifest;
  const version = deriveExpectedModelVersion(manifest);
  assert.match(version, /^PP-OCRv6_medium\/det:[0-9a-f]{12}\/rec:[0-9a-f]{12}$/);
});

test('deriveExpectedModelVersion: ハッシュ欠落時はエラー', () => {
  const manifest: GoldenManifest = {
    fixtures: {},
    textDetectionModelFileHashes: {},
    textRecognitionModelFileHashes: {},
  };
  assert.throws(() => deriveExpectedModelVersion(manifest));
});

test('sha256File: 既知バイト列のハッシュが一致する', () => {
  const p = path.join(FIXTURE_DIR, 'golden_plain_01.pdf');
  const expected = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  assert.equal(sha256File(p), expected);
});

// ---------------------------------------------------------------------------
// JWT exp デコード
// ---------------------------------------------------------------------------

function makeJwt(payload: Record<string, unknown>): string {
  const b64url = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64url({ alg: 'RS256' })}.${b64url(payload)}.signature`;
}

test('decodeJwtExpSeconds: 正常なJWTからexpを取り出す', () => {
  const token = makeJwt({ exp: 1234567890, aud: 'https://example.com' });
  assert.equal(decodeJwtExpSeconds(token), 1234567890);
});

test('decodeJwtExpSeconds: パディングなしbase64urlも処理できる', () => {
  const token = makeJwt({ exp: 1 });
  assert.equal(decodeJwtExpSeconds(token), 1);
});

test('decodeJwtExpSeconds: partsが2未満ならnull', () => {
  assert.equal(decodeJwtExpSeconds('not-a-jwt'), null);
});

test('decodeJwtExpSeconds: 不正なbase64・JSONならnull', () => {
  assert.equal(decodeJwtExpSeconds('a.!!!invalid-base64!!!.c'), null);
});

test('decodeJwtExpSeconds: expフィールドが数値でなければnull', () => {
  const token = makeJwt({ exp: 'not-a-number' });
  assert.equal(decodeJwtExpSeconds(token), null);
});

// ---------------------------------------------------------------------------
// IdTokenProvider
// ---------------------------------------------------------------------------

test('IdTokenProvider: 有効期限内はキャッシュを返し再取得しない', async () => {
  let mintCount = 0;
  const futureExp = Math.floor(Date.now() / 1000) + 3600;
  const provider = new IdTokenProvider('aud', async () => {
    mintCount++;
    return makeJwt({ exp: futureExp });
  });
  await provider.getToken();
  await provider.getToken();
  assert.equal(mintCount, 1);
});

test('IdTokenProvider: exp-300秒を切ったら再取得する', async () => {
  let mintCount = 0;
  const soonExp = Math.floor(Date.now() / 1000) + 200; // 300秒マージンより短い
  const provider = new IdTokenProvider('aud', async () => {
    mintCount++;
    return makeJwt({ exp: soonExp });
  });
  await provider.getToken();
  await provider.getToken();
  assert.equal(mintCount, 2);
});

test('IdTokenProvider: exp境界値(ちょうどnow+300)は再取得する(厳密な<比較の境界確認)', async () => {
  let mintCount = 0;
  const boundaryExp = Math.floor(Date.now() / 1000) + 300;
  const provider = new IdTokenProvider('aud', async () => {
    mintCount++;
    return makeJwt({ exp: boundaryExp });
  });
  await provider.getToken();
  await provider.getToken();
  // now < exp - 300 は now < boundaryExp - 300 = 発行時刻 相当 となり、
  // 経過時間がわずかでも真になり得ない設計であることを確認する(再取得される)。
  assert.equal(mintCount, 2);
});

test('IdTokenProvider: expデコード不能ならキャッシュせず毎回再取得する', async () => {
  let mintCount = 0;
  const provider = new IdTokenProvider('aud', async () => {
    mintCount++;
    return 'not-a-valid-jwt';
  });
  await provider.getToken();
  await provider.getToken();
  assert.equal(mintCount, 2);
});

test('IdTokenProvider: forceRefresh=trueは常に再取得する', async () => {
  let mintCount = 0;
  const futureExp = Math.floor(Date.now() / 1000) + 3600;
  const provider = new IdTokenProvider('aud', async () => {
    mintCount++;
    return makeJwt({ exp: futureExp });
  });
  await provider.getToken();
  await provider.getToken(true);
  assert.equal(mintCount, 2);
});

test('IdTokenProvider: 同時呼び出しは1回のmintに集約される(inflight)', async () => {
  let mintCount = 0;
  const futureExp = Math.floor(Date.now() / 1000) + 3600;
  const provider = new IdTokenProvider('aud', async () => {
    mintCount++;
    await new Promise((r) => setTimeout(r, 10));
    return makeJwt({ exp: futureExp });
  });
  await Promise.all([provider.getToken(), provider.getToken(), provider.getToken()]);
  assert.equal(mintCount, 1);
});

// ---------------------------------------------------------------------------
// snapshotsMatch
// ---------------------------------------------------------------------------

test('snapshotsMatch: revisionName・imageDigestが両方一致すればtrue', () => {
  const a = { revisionName: 'r1', imageDigest: 'd1' };
  const b = { revisionName: 'r1', imageDigest: 'd1' };
  assert.equal(snapshotsMatch(a, b), true);
});

test('snapshotsMatch: revisionNameが違えばfalse', () => {
  assert.equal(
    snapshotsMatch({ revisionName: 'r1', imageDigest: 'd1' }, { revisionName: 'r2', imageDigest: 'd1' }),
    false
  );
});

test('snapshotsMatch: imageDigestが違えばfalse', () => {
  assert.equal(
    snapshotsMatch({ revisionName: 'r1', imageDigest: 'd1' }, { revisionName: 'r1', imageDigest: 'd2' }),
    false
  );
});

// ---------------------------------------------------------------------------
// classifyFailure
// ---------------------------------------------------------------------------

test('classifyFailure: timeoutは常にtimeout', () => {
  assert.equal(classifyFailure('timeout', null), 'timeout');
});

test('classifyFailure: networkErrorは常にretryable', () => {
  assert.equal(classifyFailure('networkError', null), 'retryable');
});

test('classifyFailure: 429/5xxはretryable', () => {
  assert.equal(classifyFailure('httpStatus', 429), 'retryable');
  assert.equal(classifyFailure('httpStatus', 500), 'retryable');
  assert.equal(classifyFailure('httpStatus', 503), 'retryable');
  assert.equal(classifyFailure('httpStatus', 599), 'retryable');
});

test('classifyFailure: 5xx境界の外側(499/600)はfatal(pr-test-analyzer指摘の境界値追加)', () => {
  assert.equal(classifyFailure('httpStatus', 499), 'fatal');
  assert.equal(classifyFailure('httpStatus', 600), 'fatal');
});

test('classifyFailure: 400/413/415/422はfatal', () => {
  assert.equal(classifyFailure('httpStatus', 400), 'fatal');
  assert.equal(classifyFailure('httpStatus', 413), 'fatal');
  assert.equal(classifyFailure('httpStatus', 415), 'fatal');
  assert.equal(classifyFailure('httpStatus', 422), 'fatal');
});

test('classifyFailure: 401/403はfatal(classifyFailure単体では認証リトライを扱わない)', () => {
  assert.equal(classifyFailure('httpStatus', 401), 'fatal');
  assert.equal(classifyFailure('httpStatus', 403), 'fatal');
});

// ---------------------------------------------------------------------------
// summarizeLatencies / projectToSeconds / gateVerdict
// ---------------------------------------------------------------------------

test('summarizeLatencies: 空配列はn=0でp50/p95は0', () => {
  const s = summarizeLatencies([]);
  assert.deepEqual(s, { p50Ms: 0, p95Ms: 0, minMs: 0, maxMs: 0, n: 0 });
});

test('summarizeLatencies: nearest-rank法でp50/p95を算出する', () => {
  const values = Array.from({ length: 20 }, (_, i) => (i + 1) * 1000); // 1000..20000
  const s = summarizeLatencies(values);
  assert.equal(s.n, 20);
  assert.equal(s.minMs, 1000);
  assert.equal(s.maxMs, 20000);
  assert.equal(s.p50Ms, 10000);
  assert.equal(s.p95Ms, 19000);
});

test('projectToSeconds: ミリ秒/ページ×ページ数を秒に変換する', () => {
  assert.equal(projectToSeconds(12000, 71), 852);
  assert.equal(projectToSeconds(1000, 1), 1);
});

test('gateVerdict: actualSecondsがnullならNOT_EVALUATED', () => {
  assert.equal(gateVerdict(null, 850), 'NOT_EVALUATED');
});

test('gateVerdict: 閾値以下ならPASS、超過ならFAIL', () => {
  assert.equal(gateVerdict(850, 850), 'PASS');
  assert.equal(gateVerdict(849.9, 850), 'PASS');
  assert.equal(gateVerdict(850.1, 850), 'FAIL');
});

test('GATE_THRESHOLDS_SECONDS: 親計画確定値と一致する', () => {
  assert.deepEqual(GATE_THRESHOLDS_SECONDS, { p1: 30, p20: 400, p71: 850 });
});

// ---------------------------------------------------------------------------
// compareGoldenText
// ---------------------------------------------------------------------------

test('compareGoldenText: 完全一致はexactMatch=true', () => {
  const r = compareGoldenText('こんにちは', 'こんにちは');
  assert.equal(r.exactMatch, true);
});

test('compareGoldenText: 不一致時は最初の相違位置を返す', () => {
  const r = compareGoldenText('ABCDE', 'ABXDE');
  assert.equal(r.exactMatch, false);
  assert.equal(r.firstDiffAt, 2);
  assert.equal(r.expectedLength, 5);
  assert.equal(r.actualLength, 5);
});

test('compareGoldenText: 長さが違う場合も相違位置を検出する', () => {
  const r = compareGoldenText('ABC', 'AB');
  assert.equal(r.exactMatch, false);
  assert.equal(r.firstDiffAt, 2);
});

// ---------------------------------------------------------------------------
// checkContract / contractOk
// ---------------------------------------------------------------------------

test('checkContract: 全項目一致ならcontractOk=true、実測値も保持する', () => {
  const c = checkContract({ pageCount: 1, engine: 'paddleocr', renderDpi: 200, modelVersion: 'v1', text: 'hello' }, 'v1', 'hello');
  assert.equal(contractOk(c), true);
  assert.deepEqual(c, {
    pageCountOk: true,
    engineOk: true,
    renderDpiOk: true,
    modelVersionMatch: true,
    textFieldOk: true,
    actualPageCount: 1,
    actualEngine: 'paddleocr',
    actualRenderDpi: 200,
    actualModelVersion: 'v1',
    actualTextField: 'hello',
  });
});

test('checkContract: modelVersion不一致はcontractOk=falseで実測値(actualModelVersion含む)を保持する(codex review 9周目指摘の回帰テスト)', () => {
  const c = checkContract({ pageCount: 1, engine: 'paddleocr', renderDpi: 200, modelVersion: 'stale', text: 'hello' }, 'v1', 'hello');
  assert.equal(contractOk(c), false);
  assert.equal(c.modelVersionMatch, false);
  assert.equal(c.actualEngine, 'paddleocr');
  // codex review 9周目指摘(P2): 実際に返されたmodelVersionを保持しないと、artifact単体から
  // どのモデルが稼働していたか診断できない。
  assert.equal(c.actualModelVersion, 'stale');
});

test('checkContract: 複数項目が同時に不一致でもそれぞれ個別に記録される', () => {
  const c = checkContract({ pageCount: 2, engine: 'other', renderDpi: 96, text: 'wrong' }, 'v1', 'hello');
  assert.equal(c.pageCountOk, false);
  assert.equal(c.engineOk, false);
  assert.equal(c.renderDpiOk, false);
  assert.equal(c.modelVersionMatch, false);
  assert.equal(c.textFieldOk, false);
  assert.equal(c.actualPageCount, 2);
  assert.equal(c.actualRenderDpi, 96);
  assert.equal(c.actualModelVersion, undefined);
  assert.equal(c.actualTextField, 'wrong');
});

test('checkContract: text欠落・pages[0]のみ正しい場合はtextFieldOk=falseになる(codex review 12周目指摘の回帰テスト)', () => {
  // services/paddle-ocr/app.py:302の`"\n\n".join(pages)`で生成される`text`フィールドが
  // 欠落・古い値・`pages`と乖離した値を返しても、従来はpages[0]のみの突合だったため
  // 検知できなかった(本番Functions側が実際に消費するのは`text`フィールドである)。
  const c = checkContract({ pageCount: 1, engine: 'paddleocr', renderDpi: 200, modelVersion: 'v1', text: undefined }, 'v1', 'hello');
  assert.equal(c.textFieldOk, false);
  assert.equal(contractOk(c), false);
});

// ---------------------------------------------------------------------------
// sendGoldenCaseWithRetries(注入可能なOcrRequestFnでリトライ状態機械をテスト)
// ---------------------------------------------------------------------------

const SAMPLE_CASE = GOLDEN_CASES[0]; // golden_plain_01.pdf
const EXPECTED_TEXT = (JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, SAMPLE_CASE.pagesJsonFile), 'utf-8')) as string[])[
  SAMPLE_CASE.pageIndex
];
const SAMPLE_MODEL_VERSION = 'PP-OCRv6_medium/det:abc/rec:def';

function successBody(overrides: Partial<{ text: string; pageCount: number; engine: string; renderDpi: number; modelVersion: string; processingMs: number }> = {}): string {
  return JSON.stringify({
    text: overrides.text ?? EXPECTED_TEXT,
    pages: [overrides.text ?? EXPECTED_TEXT],
    pageCount: overrides.pageCount ?? 1,
    engine: overrides.engine ?? 'paddleocr',
    renderDpi: overrides.renderDpi ?? 200,
    modelVersion: overrides.modelVersion ?? SAMPLE_MODEL_VERSION,
    processingMs: overrides.processingMs ?? 9000,
  });
}

function fakeTokenProvider(mintFn: () => Promise<string> = async () => makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 })): IdTokenProvider {
  return new IdTokenProvider('aud', mintFn);
}

function queueRequestFn(queue: OcrAttemptResult[]): OcrRequestFn {
  let i = 0;
  return async () => {
    if (i >= queue.length) {
      throw new Error(`queueRequestFn: キューが尽きました(${i + 1}回目の呼び出し)`);
    }
    return queue[i++];
  };
}

test('sendGoldenCaseWithRetries: 1回目で200成功なら即座に成功レコードを返す', async () => {
  const requestFn = queueRequestFn([{ status: 200, body: successBody(), wallMs: 9500, kind: 'success' }]);
  const record = await sendGoldenCaseWithRetries(SAMPLE_CASE, 0, 0, 'https://x', SAMPLE_MODEL_VERSION, fakeTokenProvider(), requestFn);
  assert.equal(record.fatal, false);
  assert.equal(record.timedOut, false);
  assert.equal(record.textCheck?.exactMatch, true);
  assert.equal(record.contractCheck?.modelVersionMatch, true);
  assert.equal(record.retriedCount, 0);
});

test('sendGoldenCaseWithRetries: タイムアウトはリトライせず即timedOut=trueで返す(逐次性汚染防止)', async () => {
  const requestFn = queueRequestFn([{ status: null, body: null, wallMs: 180000, kind: 'timeout' }]);
  const record = await sendGoldenCaseWithRetries(SAMPLE_CASE, 0, 0, 'https://x', SAMPLE_MODEL_VERSION, fakeTokenProvider(), requestFn);
  assert.equal(record.timedOut, true);
  assert.equal(record.fatal, false);
  assert.equal(record.retriedCount, 0);
  // silent-failure-hunter指摘(High、pr-review-toolkit): クライアントタイムアウト/サーバ504/
  // networkErrorの3要因が最終レコードで区別できるようfailureKindを持つ。
  assert.equal(record.failureKind, 'clientTimeout');
});

test('sendGoldenCaseWithRetries: networkErrorはリトライせず即timedOutとして扱う(codex review 8周目指摘の回帰テスト)', async () => {
  // 修正前はnetworkErrorを429/5xxと同様にリトライしていたが、fetch()の汎用例外だけからは
  // 「サーバに全く到達しなかった」のか「サーバは受理し処理継続中に接続が切れた」のかを
  // 区別できない。504/クライアントタイムアウトと同じ理由でリトライせずtimedOut扱いにする。
  const requestFn = queueRequestFn([{ status: null, body: null, wallMs: 100, kind: 'networkError', errorDetail: 'ECONNRESET: connection reset' }]);
  const record = await sendGoldenCaseWithRetries(SAMPLE_CASE, 0, 0, 'https://x', SAMPLE_MODEL_VERSION, fakeTokenProvider(), requestFn, 1);
  assert.equal(record.timedOut, true);
  assert.equal(record.fatal, false);
  assert.equal(record.retriedCount, 0);
  // silent-failure-hunter指摘(High、pr-review-toolkit): 従来はfailureKind/errorDetailを
  // レコードへ渡し忘れており、原因調査に必要な情報がJSON artifact/Step Summaryに
  // 一切残らなかった(保持する設計自体はOcrAttemptResult側に既にあった)。
  assert.equal(record.failureKind, 'networkError');
  assert.equal(record.errorDetail, 'ECONNRESET: connection reset');
});

test('sendGoldenCaseWithRetries: 429/5xxはリトライ上限まで再試行しfatalになる', async () => {
  const requestFn = queueRequestFn(
    Array.from({ length: 4 }, () => ({ status: 503, body: 'Service Unavailable', wallMs: 100, kind: 'success' as const }))
  );
  const record = await sendGoldenCaseWithRetries(SAMPLE_CASE, 0, 0, 'https://x', SAMPLE_MODEL_VERSION, fakeTokenProvider(), requestFn, 1);
  assert.equal(record.fatal, true);
  assert.equal(record.httpStatus, 503);
  assert.equal(record.retriedCount, 3);
});

test('sendGoldenCaseWithRetries: 504(サービス自身のPROCESSING_TIMEOUT)はリトライせずtimedOut扱いにする(codex review 6周目指摘の回帰テスト)', async () => {
  // services/paddle-ocr側の504はバックグラウンドでOCR処理継続+エンジンロック保持が続く設計
  // (README.md「既知の限界」節)。クライアントタイムアウトと同じ理由でリトライすると
  // 逐次計測の前提を汚染するため、リトライせずtimedOutとして記録する。
  const requestFn = queueRequestFn([{ status: 504, body: '{"error":{"code":"PROCESSING_TIMEOUT"}}', wallMs: 240000, kind: 'success' }]);
  const record = await sendGoldenCaseWithRetries(SAMPLE_CASE, 0, 0, 'https://x', SAMPLE_MODEL_VERSION, fakeTokenProvider(), requestFn, 1);
  assert.equal(record.timedOut, true);
  assert.equal(record.fatal, false);
  assert.equal(record.retriedCount, 0);
  // silent-failure-hunter指摘(High、pr-review-toolkit): 504もhttpStatus:nullに一律化されて
  // おり、クライアントタイムアウト/networkErrorと区別がつかなかった。実際のステータスと
  // failureKindを保持する。
  assert.equal(record.failureKind, 'serverTimeout504');
  assert.equal(record.httpStatus, 504);
});

test('sendGoldenCaseWithRetries: 400等の非リトライ4xxは即fatal(リトライしない)', async () => {
  const requestFn = queueRequestFn([{ status: 400, body: '{"error":"EMPTY_BODY"}', wallMs: 50, kind: 'success' }]);
  const record = await sendGoldenCaseWithRetries(SAMPLE_CASE, 0, 0, 'https://x', SAMPLE_MODEL_VERSION, fakeTokenProvider(), requestFn);
  assert.equal(record.fatal, true);
  assert.equal(record.retriedCount, 0);
  assert.match(record.fatalReason ?? '', /400/);
});

test('sendGoldenCaseWithRetries: 401→トークン再発行→200成功', async () => {
  let mintCount = 0;
  const provider = fakeTokenProvider(async () => {
    mintCount++;
    return makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
  });
  const requestFn = queueRequestFn([
    { status: 401, body: '{"error":"UNAUTHORIZED"}', wallMs: 50, kind: 'success' },
    { status: 200, body: successBody(), wallMs: 9000, kind: 'success' },
  ]);
  const record = await sendGoldenCaseWithRetries(SAMPLE_CASE, 0, 0, 'https://x', SAMPLE_MODEL_VERSION, provider, requestFn);
  assert.equal(record.fatal, false);
  assert.equal(record.authRetried, true);
  assert.equal(mintCount, 2); // 初回 + 401後の強制再発行
});

test('sendGoldenCaseWithRetries: 401→トークン再発行後も403が続けばfatal(2回目は再試行しない)', async () => {
  const requestFn = queueRequestFn([
    { status: 401, body: '{}', wallMs: 50, kind: 'success' },
    { status: 403, body: '{}', wallMs: 50, kind: 'success' },
  ]);
  const record = await sendGoldenCaseWithRetries(SAMPLE_CASE, 0, 0, 'https://x', SAMPLE_MODEL_VERSION, fakeTokenProvider(), requestFn);
  assert.equal(record.fatal, true);
  assert.equal(record.authRetried, true);
  assert.match(record.fatalReason ?? '', /認可設定/);
});

test('sendGoldenCaseWithRetries: 200だがJSONパース不能な場合はレスポンス本文を含めてfatal', async () => {
  const requestFn = queueRequestFn([{ status: 200, body: '<html>Bad Gateway</html>', wallMs: 100, kind: 'success' }]);
  const record = await sendGoldenCaseWithRetries(SAMPLE_CASE, 0, 0, 'https://x', SAMPLE_MODEL_VERSION, fakeTokenProvider(), requestFn);
  assert.equal(record.fatal, true);
  assert.match(record.fatalReason ?? '', /Bad Gateway/);
});

test('sendGoldenCaseWithRetries: golden text不一致はfatal、textCheckに差分情報を保持する', async () => {
  const requestFn = queueRequestFn([{ status: 200, body: successBody({ text: '違うテキスト' }), wallMs: 9000, kind: 'success' }]);
  const record = await sendGoldenCaseWithRetries(SAMPLE_CASE, 0, 0, 'https://x', SAMPLE_MODEL_VERSION, fakeTokenProvider(), requestFn);
  assert.equal(record.fatal, true);
  assert.equal(record.textCheck?.exactMatch, false);
  assert.equal(record.fatalReason, 'golden textと不一致');
});

test('sendGoldenCaseWithRetries: 契約違反(modelVersion不一致)はfatalでcontractCheckに実測値を保持する', async () => {
  const requestFn = queueRequestFn([{ status: 200, body: successBody({ modelVersion: 'stale-version' }), wallMs: 9000, kind: 'success' }]);
  const record = await sendGoldenCaseWithRetries(SAMPLE_CASE, 0, 0, 'https://x', SAMPLE_MODEL_VERSION, fakeTokenProvider(), requestFn);
  assert.equal(record.fatal, true);
  assert.equal(record.contractCheck?.modelVersionMatch, false);
  // codex review 9周目指摘(P2): modelVersion不一致時、期待値との比較結果(boolean)だけでなく
  // 実際にサービスが返した値も保持していないと、artifact単体からどのモデルが稼働していたか
  // 診断できない。
  assert.equal(record.contractCheck?.actualModelVersion, 'stale-version');
  assert.match(record.fatalReason ?? '', /契約検証/);
});

test('sendGoldenCaseWithRetries: pages[0]はgolden textと一致するがtextフィールドが乖離している場合もfatal(codex review 12周目指摘の回帰テスト)', async () => {
  // 従来はpages[0]のみをgolden textと突合しており、レスポンスのトップレベルtextフィールド
  // (本番Functions側が実際に消費するフィールド)が欠落・古い値・pagesと乖離した値を返しても
  // 検知できなかった。successBody()ヘルパーはtext/pagesを常に同じ値で生成するため、ここでは
  // 意図的にJSONを手組みしてtextだけを乖離させる。
  const body = JSON.stringify({
    text: 'STALE_TEXT_DIVERGED_FROM_PAGES',
    pages: [EXPECTED_TEXT],
    pageCount: 1,
    engine: 'paddleocr',
    renderDpi: 200,
    modelVersion: SAMPLE_MODEL_VERSION,
    processingMs: 9000,
  });
  const requestFn = queueRequestFn([{ status: 200, body, wallMs: 9000, kind: 'success' }]);
  const record = await sendGoldenCaseWithRetries(SAMPLE_CASE, 0, 0, 'https://x', SAMPLE_MODEL_VERSION, fakeTokenProvider(), requestFn);
  assert.equal(record.fatal, true);
  assert.equal(record.textCheck?.exactMatch, true);
  assert.equal(record.contractCheck?.textFieldOk, false);
  assert.equal(record.contractCheck?.actualTextField, 'STALE_TEXT_DIVERGED_FROM_PAGES');
  assert.match(record.fatalReason ?? '', /契約検証/);
});

/** テスト用の決定論的時計。呼び出しごとにキューの値を順に返す(末尾到達後は最後の値を返す)。 */
function fakeClock(timestamps: number[]): () => number {
  let i = 0;
  return () => {
    const t = i < timestamps.length ? timestamps[i] : timestamps[timestamps.length - 1];
    i++;
    return t;
  };
}

test('sendGoldenCaseWithRetries: processingMsからclientObservedExcessMsを算出する(累積経過時間ベース、codex review 5周目指摘反映)', async () => {
  const requestFn = queueRequestFn([{ status: 200, body: successBody({ processingMs: 8000 }), wallMs: 9500, kind: 'success' }]);
  // caseStarted=0、1回目の試行完了時刻=9500 → elapsedMs=9500-0=9500
  const nowFn = fakeClock([0, 9500]);
  const record = await sendGoldenCaseWithRetries(SAMPLE_CASE, 0, 0, 'https://x', SAMPLE_MODEL_VERSION, fakeTokenProvider(), requestFn, 1, nowFn);
  assert.equal(record.wallMs, 9500);
  assert.equal(record.processingMs, 8000);
  assert.equal(record.clientObservedExcessMs, 1500);
});

test('sendGoldenCaseWithRetries: リトライ発生時はwallMsに全試行+バックオフの累積時間が反映される(codex review 5周目 P1の回帰テスト、8周目反映でnetworkError→503に変更)', async () => {
  // 修正前は最終試行の`attempt.wallMs`(=50)のみを記録しており、1回目の失敗試行+バックオフに
  // 費やした時間が消えていた。1回目失敗(503、t=0→100)、バックオフ、2回目成功(t=2100→2150)
  // というシナリオで、記録されるwallMsが「ケース開始からの累積」になっていることを確認する。
  // (8周目反映: networkErrorは即timedOutになりリトライしなくなったため、リトライ自体が
  // 発生するシナリオとして503(HTTP-statusベースのretryable)に差し替えた。)
  const requestFn = queueRequestFn([
    { status: 503, body: 'Service Unavailable', wallMs: 100, kind: 'success' },
    { status: 200, body: successBody(), wallMs: 50, kind: 'success' },
  ]);
  const nowFn = fakeClock([0, 100, 2150]); // caseStarted=0, 1回目試行後=100, 2回目試行後=2150
  const record = await sendGoldenCaseWithRetries(SAMPLE_CASE, 0, 0, 'https://x', SAMPLE_MODEL_VERSION, fakeTokenProvider(), requestFn, 1, nowFn);
  assert.equal(record.fatal, false);
  assert.equal(record.retriedCount, 1);
  // 最終試行単体のwallMs(50)ではなく、ケース開始からの累積(2150)が記録される。
  assert.equal(record.wallMs, 2150);
});

test('sendGoldenCaseWithRetries: トークン取得(gcloud起動等)にかかった時間はwallMsに含めない(codex review 9周目指摘の回帰テスト)', async () => {
  // 修正前はループに入る前(=トークン取得より前)にcaseStartedを記録していたため、初回発行
  // (または約55分ごとのキャッシュ失効後の再発行)で`gcloud auth print-identity-token`
  // サブプロセスが実際にかかる時間までp1/p95ゲートの対象レイテンシに混入していた。
  // ここではnowFn/backoffMsとも本番既定値(実時計)のまま、トークン取得だけを意図的に
  // 遅延させ、その遅延分がwallMsに現れないことを確認する。
  const provider = fakeTokenProvider(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
    return makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
  });
  const requestFn = queueRequestFn([{ status: 200, body: successBody(), wallMs: 5, kind: 'success' }]);
  const record = await sendGoldenCaseWithRetries(SAMPLE_CASE, 0, 0, 'https://x', SAMPLE_MODEL_VERSION, provider, requestFn);
  assert.equal(record.fatal, false);
  // トークン取得に80ms要していても、計測開始点はその後なのでwallMsはごく小さいまま
  // (トークン取得時間を含んでいれば80ms以上になるはず)。
  assert.ok(record.wallMs < 80, `wallMs=${record.wallMs}はトークン取得の80ms遅延を含んでいないはず`);
});

// ---------------------------------------------------------------------------
// buildReport
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<GoldenRequestRecord> = {}): GoldenRequestRecord {
  return {
    manifestId: 'golden-plain-01',
    pdfFile: 'golden_plain_01.pdf',
    round: 0,
    order: 0,
    wallMs: 10000,
    processingMs: 9000,
    clientObservedExcessMs: 1000,
    httpStatus: 200,
    retriedCount: 0,
    authRetried: false,
    timedOut: false,
    fatal: false,
    textCheck: { exactMatch: true, expectedLength: 10, actualLength: 10 },
    contractCheck: {
      pageCountOk: true,
      engineOk: true,
      renderDpiOk: true,
      modelVersionMatch: true,
      textFieldOk: true,
      actualPageCount: 1,
      actualEngine: 'paddleocr',
      actualRenderDpi: 200,
    },
    ...overrides,
  };
}

test('buildReport: 空のrequests配列でも例外を投げず、全てnull/inconclusive=trueになる(境界値)', () => {
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:30:00Z',
    serviceSnapshotStart: { revisionName: 'r1', imageDigest: 'd1' },
    serviceSnapshotEnd: { revisionName: 'r1', imageDigest: 'd1' },
    requests: [],
  });
  assert.equal(report.inconclusive, true);
  assert.equal(report.firstRequestMs, null);
  assert.equal(report.subsequent, null);
  assert.equal(report.successRateSubsequent, null);
  assert.deepEqual(report.gates, []);
  assert.deepEqual(report.goldenMatchSummary, { total: 0, matched: 0 });
});

test('buildReport: 終了時スナップショットがnull(gcloud取得失敗)でもrequestsを保持しinconclusive=trueになる(codex review 3周目指摘の回帰テスト)', () => {
  // 修正前は終了時スナップショット取得の例外がmain()のトップレベルcatchまで伝播し、
  // それまでに収集したrequestsが空スケルトンで丸ごと失われるバグがあった。
  const requests = Array.from({ length: 18 }, (_, i) => makeRecord({ order: i, wallMs: 10000 }));
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:30:00Z',
    serviceSnapshotStart: { revisionName: 'r1', imageDigest: 'd1' },
    serviceSnapshotEnd: null,
    requests,
  });
  assert.equal(report.inconclusive, true);
  assert.match(report.inconclusiveReason ?? '', /取得に失敗/);
  assert.equal(report.requests.length, 18); // データは保持される
  assert.deepEqual(report.gates, []);
});

test('buildReport: 開始時スナップショットがnullでもinconclusive=trueになる', () => {
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:30:00Z',
    serviceSnapshotStart: null,
    serviceSnapshotEnd: { revisionName: 'r1', imageDigest: 'd1' },
    requests: [makeRecord({ order: 0 })],
  });
  assert.equal(report.inconclusive, true);
  assert.match(report.inconclusiveReason ?? '', /取得に失敗/);
});

test('buildReport: リクエストが1件のみの場合、rest=[]でsuccessRateSubsequentはnull(0除算にならない)', () => {
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:30:00Z',
    serviceSnapshotStart: { revisionName: 'r1', imageDigest: 'd1' },
    serviceSnapshotEnd: { revisionName: 'r1', imageDigest: 'd1' },
    requests: [makeRecord({ order: 0 })],
  });
  assert.equal(report.successRateSubsequent, null);
  assert.equal(report.subsequent, null);
  assert.equal(report.inconclusive, true); // n=0 < 10
});

test('buildReport: スナップショット不一致ならinconclusive=trueでgatesは空', () => {
  const requests = Array.from({ length: 15 }, (_, i) => makeRecord({ order: i }));
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:30:00Z',
    serviceSnapshotStart: { revisionName: 'r1', imageDigest: 'd1' },
    serviceSnapshotEnd: { revisionName: 'r2', imageDigest: 'd1' },
    requests,
  });
  assert.equal(report.inconclusive, true);
  assert.match(report.inconclusiveReason ?? '', /サービススナップショット/);
  assert.deepEqual(report.gates, []);
});

test('buildReport: n=9(閾値未満の境界)ならinconclusive=true', () => {
  const requests = Array.from({ length: 10 }, (_, i) => makeRecord({ order: i })); // 1件目除くと9件
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:30:00Z',
    serviceSnapshotStart: { revisionName: 'r1', imageDigest: 'd1' },
    serviceSnapshotEnd: { revisionName: 'r1', imageDigest: 'd1' },
    requests,
  });
  assert.equal(report.subsequent?.n, 9);
  assert.equal(report.inconclusive, true);
  assert.match(report.inconclusiveReason ?? '', /標本数が不足/);
});

test('buildReport: n=10(閾値ちょうど)ならinconclusive=false(境界値、pr-test-analyzer指摘)', () => {
  const requests = Array.from({ length: 11 }, (_, i) => makeRecord({ order: i })); // 1件目除くと10件
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:30:00Z',
    serviceSnapshotStart: { revisionName: 'r1', imageDigest: 'd1' },
    serviceSnapshotEnd: { revisionName: 'r1', imageDigest: 'd1' },
    requests,
  });
  assert.equal(report.subsequent?.n, 10);
  assert.equal(report.inconclusive, false);
});

test('buildReport: 2件目以降が全件timedOutでsubsequentがnullでもinconclusive=true(codex review指摘の回帰テスト)', () => {
  // 1件目は成功、2件目以降は全てタイムアウト → 有効サンプル0件 → subsequentはnullになる。
  // 修正前は `subsequent !== null && subsequent.n < 10` が false 評価され、
  // 全件タイムアウトでもconclusive扱いになりワークフローが緑になるバグがあった。
  const requests = [
    makeRecord({ order: 0 }),
    ...Array.from({ length: 5 }, (_, i) =>
      makeRecord({ order: i + 1, timedOut: true, httpStatus: null, fatal: false, textCheck: undefined, contractCheck: undefined })
    ),
  ];
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:30:00Z',
    serviceSnapshotStart: { revisionName: 'r1', imageDigest: 'd1' },
    serviceSnapshotEnd: { revisionName: 'r1', imageDigest: 'd1' },
    requests,
  });
  assert.equal(report.subsequent, null);
  assert.equal(report.inconclusive, true);
  // このシナリオはtimedOutが存在するため、優先度の高い「タイムアウト検知」が理由として
  // 表示される(codex review 7周目反映。以前は「標本数が不足」を検証していた)。
  assert.match(report.inconclusiveReason ?? '', /タイムアウトまたは504/);
  assert.deepEqual(report.gates, []);
});

test('buildReport: 十分な標本数・スナップショット一致ならgatesが評価される', () => {
  const requests = Array.from({ length: 18 }, (_, i) => makeRecord({ order: i, wallMs: 10000 + i * 100 }));
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:30:00Z',
    serviceSnapshotStart: { revisionName: 'r1', imageDigest: 'd1' },
    serviceSnapshotEnd: { revisionName: 'r1', imageDigest: 'd1' },
    requests,
  });
  assert.equal(report.inconclusive, false);
  assert.equal(report.gates.length, 3);
  assert.equal(report.firstRequestMs, 10000);
  assert.ok(report.subsequent);
  assert.equal(report.subsequent?.n, 17);
});

test('buildReport: 1件目がfatalな場合、p1ゲートはNOT_EVALUATEDになる(code-reviewer指摘Highの回帰テスト)', () => {
  // 修正前はfirst.wallMsをそのままp1ゲートに使っていたため、失敗した1件目のレイテンシが
  // たまたま短い(即fatal応答等)場合にPASSと誤判定するバグがあった。
  const requests = [
    makeRecord({ order: 0, fatal: true, wallMs: 50, fatalReason: '400 Bad Request', textCheck: undefined, contractCheck: undefined }),
    ...Array.from({ length: 10 }, (_, i) => makeRecord({ order: i + 1, wallMs: 9000 })),
  ];
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:30:00Z',
    serviceSnapshotStart: { revisionName: 'r1', imageDigest: 'd1' },
    serviceSnapshotEnd: { revisionName: 'r1', imageDigest: 'd1' },
    requests,
  });
  const p1Gate = report.gates.find((g) => g.id === 'p1');
  assert.equal(p1Gate?.verdict, 'NOT_EVALUATED');
  assert.equal(p1Gate?.actualSeconds, null);
  // firstRequestMsは診断用に生値を保持し続ける(0除算等の実害はない)
  assert.equal(report.firstRequestMs, 50);
});

test('buildReport: 1件でもtimedOutがあればレポート全体がinconclusiveになる(codex review 7周目指摘の回帰テスト)', () => {
  // 修正前はp1ゲート個別のNOT_EVALUATEDのみを検証していたが、codex review(7周目)指摘により
  // 「timedOut後は以降のインスタンス割当が汚染されうるため、p1だけでなくsubsequent系列全体を
  // 信頼できない」という設計に変更した。1件でもtimedOutがあればgates全体が空になる。
  const requests = [
    makeRecord({ order: 0, timedOut: true, fatal: false, httpStatus: null, wallMs: 180000, textCheck: undefined, contractCheck: undefined }),
    ...Array.from({ length: 10 }, (_, i) => makeRecord({ order: i + 1, wallMs: 9000 })),
  ];
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:30:00Z',
    serviceSnapshotStart: { revisionName: 'r1', imageDigest: 'd1' },
    serviceSnapshotEnd: { revisionName: 'r1', imageDigest: 'd1' },
    requests,
  });
  assert.equal(report.inconclusive, true);
  assert.match(report.inconclusiveReason ?? '', /タイムアウトまたは504/);
  assert.deepEqual(report.gates, []);
});

test('buildReport: fatal/timedOutなリクエストはsubsequent統計から除外される', () => {
  const requests = [
    makeRecord({ order: 0 }),
    ...Array.from({ length: 10 }, (_, i) => makeRecord({ order: i + 1, wallMs: 9000 })),
    makeRecord({ order: 11, fatal: true, fatalReason: 'golden text不一致' }),
    makeRecord({ order: 12, timedOut: true, httpStatus: null }),
  ];
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:30:00Z',
    serviceSnapshotStart: { revisionName: 'r1', imageDigest: 'd1' },
    serviceSnapshotEnd: { revisionName: 'r1', imageDigest: 'd1' },
    requests,
  });
  assert.equal(report.subsequent?.n, 10);
  assert.equal(report.timedOutCount, 1);
});

test('buildReport: status503Countが503件数を正しく数える', () => {
  const requests = [
    makeRecord({ order: 0 }),
    ...Array.from({ length: 9 }, (_, i) => makeRecord({ order: i + 1, wallMs: 9000 })),
    makeRecord({ order: 10, httpStatus: 503, fatal: true, fatalReason: '503', textCheck: undefined, contractCheck: undefined }),
    makeRecord({ order: 11, httpStatus: 503, fatal: true, fatalReason: '503', textCheck: undefined, contractCheck: undefined }),
  ];
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:30:00Z',
    serviceSnapshotStart: { revisionName: 'r1', imageDigest: 'd1' },
    serviceSnapshotEnd: { revisionName: 'r1', imageDigest: 'd1' },
    requests,
  });
  assert.equal(report.status503Count, 2);
});

test('buildReport: golden不一致件数はgoldenMatchSummaryに反映される', () => {
  const requests = [
    makeRecord({ order: 0 }),
    makeRecord({ order: 1, textCheck: { exactMatch: false, expectedLength: 5, actualLength: 5, firstDiffAt: 1 } }),
  ];
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:30:00Z',
    serviceSnapshotStart: { revisionName: 'r1', imageDigest: 'd1' },
    serviceSnapshotEnd: { revisionName: 'r1', imageDigest: 'd1' },
    requests,
  });
  assert.deepEqual(report.goldenMatchSummary, { total: 2, matched: 1 });
});

// ---------------------------------------------------------------------------
// determineExitCode
// ---------------------------------------------------------------------------
// pr-test-analyzer指摘(High、pr-review-toolkit): main()末尾にインライン化されていた
// CI赤/緑を決める唯一の分岐が、88件のテストのどこからも到達していなかった。純関数として
// 抽出した上で、ハッピーパスを含む主要な分岐を網羅する。

const HEALTHY_SNAPSHOT = { revisionName: 'r1', imageDigest: 'd1' };

test('determineExitCode: 全て健全(fatal/timedOutなし、全ゲートPASS)なら0のまま', () => {
  const requests = Array.from({ length: 18 }, (_, i) => makeRecord({ order: i, wallMs: 10000 + i * 100 }));
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:30:00Z',
    serviceSnapshotStart: HEALTHY_SNAPSHOT,
    serviceSnapshotEnd: HEALTHY_SNAPSHOT,
    requests,
  });
  assert.equal(report.inconclusive, false);
  assert.equal(determineExitCode(report, requests), 0);
});

test('determineExitCode: fatalなリクエストが1件でもあれば1', () => {
  const requests = [
    makeRecord({ order: 0, fatal: true, fatalReason: '400 Bad Request', textCheck: undefined, contractCheck: undefined }),
    ...Array.from({ length: 10 }, (_, i) => makeRecord({ order: i + 1, wallMs: 9000 })),
  ];
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:30:00Z',
    serviceSnapshotStart: HEALTHY_SNAPSHOT,
    serviceSnapshotEnd: HEALTHY_SNAPSHOT,
    requests,
  });
  assert.equal(determineExitCode(report, requests), 1);
});

test('determineExitCode: timedOutなリクエストが1件でもあれば1(report.inconclusiveと相関するが、requests側からも独立して判定する)', () => {
  const requests = [
    makeRecord({ order: 0, timedOut: true, httpStatus: null, textCheck: undefined, contractCheck: undefined }),
    ...Array.from({ length: 10 }, (_, i) => makeRecord({ order: i + 1, wallMs: 9000 })),
  ];
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:30:00Z',
    serviceSnapshotStart: HEALTHY_SNAPSHOT,
    serviceSnapshotEnd: HEALTHY_SNAPSHOT,
    requests,
  });
  assert.equal(report.inconclusive, true);
  assert.equal(determineExitCode(report, requests), 1);
});

test('determineExitCode: ゲートがFAILなら1', () => {
  const requests = Array.from({ length: 18 }, (_, i) => makeRecord({ order: i, wallMs: 999_000 }));
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:30:00Z',
    serviceSnapshotStart: HEALTHY_SNAPSHOT,
    serviceSnapshotEnd: HEALTHY_SNAPSHOT,
    requests,
  });
  assert.ok(report.gates.some((g) => g.verdict === 'FAIL'));
  assert.equal(determineExitCode(report, requests), 1);
});

test('determineExitCode: ゲートがNOT_EVALUATEDなら(fatal/timedOutがなくても)1', () => {
  // 1件目がfatalでp1ゲートがNOT_EVALUATEDになるケース(fatalなのでanyFatalでも1になるが、
  // ゲート未評価自体が独立した失敗条件であることも確認する)。
  const requests = [
    makeRecord({ order: 0, fatal: true, wallMs: 50, fatalReason: '400 Bad Request', textCheck: undefined, contractCheck: undefined }),
    ...Array.from({ length: 10 }, (_, i) => makeRecord({ order: i + 1, wallMs: 9000 })),
  ];
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:30:00Z',
    serviceSnapshotStart: HEALTHY_SNAPSHOT,
    serviceSnapshotEnd: HEALTHY_SNAPSHOT,
    requests,
  });
  assert.ok(report.gates.some((g) => g.verdict === 'NOT_EVALUATED'));
  assert.equal(determineExitCode(report, requests), 1);
});

test('determineExitCode: report.inconclusiveがtrueなら(requests側にfatal/timedOutがなくても)1', () => {
  // スナップショット不一致によるinconclusive(標本数は十分)。requests自体は健全。
  const requests = Array.from({ length: 18 }, (_, i) => makeRecord({ order: i, wallMs: 10000 }));
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:30:00Z',
    serviceSnapshotStart: { revisionName: 'r1', imageDigest: 'd1' },
    serviceSnapshotEnd: { revisionName: 'r2', imageDigest: 'd1' },
    requests,
  });
  assert.equal(report.inconclusive, true);
  assert.equal(report.gates.length, 0);
  assert.equal(requests.some((r) => r.fatal || r.timedOut), false);
  assert.equal(determineExitCode(report, requests), 1);
});

// ---------------------------------------------------------------------------
// buildStepSummaryMarkdown
// ---------------------------------------------------------------------------

test('buildStepSummaryMarkdown: projected PASS/FAILの注記文言を含む(conclusiveな場合)', () => {
  const requests = Array.from({ length: 18 }, (_, i) => makeRecord({ order: i, wallMs: 10000 }));
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:30:00Z',
    serviceSnapshotStart: { revisionName: 'r1', imageDigest: 'd1' },
    serviceSnapshotEnd: { revisionName: 'r1', imageDigest: 'd1' },
    requests,
  });
  const md = buildStepSummaryMarkdown(report);
  assert.match(md, /projected (PASS|FAIL)/);
  assert.match(md, /PR6のGo判定そのものではない/);
  assert.match(md, /真のcold確証なし/);
});

test('buildStepSummaryMarkdown: inconclusive(subsequent===null)でも例外を投げず、ゲート欄なし・有効サンプルなしの旨を表示する(pr-test-analyzer指摘Highの回帰テスト)', () => {
  // buildReportのP1回帰テストと同じシナリオ(全件timedOut)をmarkdown生成まで通す。
  // このmarkdownはGITHUB_STEP_SUMMARYへ出力され、decision-makerが実際に読む唯一の
  // 一次情報であるため、conclusiveな場合しかテストしていなかった従来のテストでは
  // このパスのレンダリング崩れ・情報欠落を検知できなかった。
  const requests = [
    makeRecord({ order: 0 }),
    ...Array.from({ length: 5 }, (_, i) =>
      makeRecord({ order: i + 1, timedOut: true, httpStatus: null, fatal: false, textCheck: undefined, contractCheck: undefined })
    ),
  ];
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:30:00Z',
    serviceSnapshotStart: { revisionName: 'r1', imageDigest: 'd1' },
    serviceSnapshotEnd: { revisionName: 'r1', imageDigest: 'd1' },
    requests,
  });
  const md = buildStepSummaryMarkdown(report);
  assert.match(md, /inconclusive: true/);
  // このシナリオは全件timedOutのため「標本数不足」と「タイムアウト検知」の両条件を満たすが、
  // タイムアウトの方が優先度の高い理由として表示される(codex review 7周目反映)。
  assert.match(md, /タイムアウトまたは504/);
  assert.match(md, /有効サンプルなし/);
  assert.match(md, /ゲート判定なし/);
  // ゲートテーブル自体(ヘッダ行)が出力されていないことを確認する。
  // 「projected PASS/FAIL」という文字列自体は固定注記(REPORT_NOTES)の説明文中に
  // 常に登場するため、doesNotMatchの対象にはできない(誤検知の原因になっていた)。
  assert.doesNotMatch(md, /\| ゲート \|/);
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

test('parseArgs: 既定値(mode=golden, repeat=3)', () => {
  const args = parseArgs([]);
  assert.equal(args.mode, 'golden');
  assert.equal(args.repeat, 3);
});

test('parseArgs: --mode/--url/--repeat/--outを解釈する', () => {
  const args = parseArgs(['--mode=golden', '--url=https://x', '--repeat=5', '--out=/tmp/out.json']);
  assert.equal(args.mode, 'golden');
  assert.equal(args.url, 'https://x');
  assert.equal(args.repeat, 5);
  assert.equal(args.out, '/tmp/out.json');
});

test('parseArgs: --repeatが0以下・非数値の場合はエラー', () => {
  assert.throws(() => parseArgs(['--repeat=0']));
  assert.throws(() => parseArgs(['--repeat=abc']));
});

test('parseArgs: --repeatが小数・数値プレフィックス混入文字列の場合もエラー(codex review指摘P2の回帰テスト)', () => {
  // Number.parseIntは"3.5"→3、"3junk"→3のように数値プレフィックスを無言で受理してしまう。
  // repeatは標本数(送信回数)を直接左右するため、厳密な整数文字列のみを許容する。
  assert.throws(() => parseArgs(['--repeat=3.5']));
  assert.throws(() => parseArgs(['--repeat=3junk']));
  assert.throws(() => parseArgs(['--repeat=-1']));
});

test('parseArgs: --repeatがNumber.parseIntでオーバーフローする桁数の場合はエラー(codex review 4周目指摘の回帰テスト)', () => {
  // "9"を300個並べた数字のみの文字列はNumber.parseIntでInfinityになる。
  // これを許すと `for (let round = 0; round < repeat; round++)` が終了しなくなる。
  const hugeDigits = '9'.repeat(300);
  assert.throws(() => parseArgs([`--repeat=${hugeDigits}`]));
});

test('parseArgs: --repeatが実用上の上限(20)を超える場合はエラー(codex review 7周目指摘: workflowのtimeout-minutes予算に収める)', () => {
  assert.throws(() => parseArgs(['--repeat=21']));
});

test('parseArgs: --repeatが上限ちょうど(20)なら受理する(境界値)', () => {
  const args = parseArgs(['--repeat=20']);
  assert.equal(args.repeat, 20);
});
