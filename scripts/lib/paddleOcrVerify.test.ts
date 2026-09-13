import assert from 'node:assert/strict';
import { test } from 'node:test';
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
  buildReport,
  buildStepSummaryMarkdown,
  parseArgs,
  sha256File,
  GATE_THRESHOLDS_SECONDS,
  type GoldenManifest,
  type GoldenRequestRecord,
} from '../paddle-ocr-verify';

const DEV_ENV_PATH = path.join(__dirname, '..', 'clients', 'dev.env');
const REAL_DEV_URL = 'https://paddle-ocr-whfgr6jwaa-an.a.run.app';

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

test('resolveServiceUrl: ホストがdev.envと不一致なら即エラー', () => {
  const devEnvContent = 'PADDLE_OCR_URL="https://a.example.com"';
  assert.throws(() =>
    resolveServiceUrl({ explicitUrl: 'https://evil.example.com', devEnvContent, devEnvPathForError: 'x' })
  );
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
  const devEnvContent = require('fs').readFileSync(DEV_ENV_PATH, 'utf-8');
  assert.equal(resolveServiceUrl({ devEnvContent, devEnvPathForError: DEV_ENV_PATH }), REAL_DEV_URL);
});

// ---------------------------------------------------------------------------
// manifest整合性チェック(実fixtureディレクトリに対して実行、回帰検知)
// ---------------------------------------------------------------------------

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'paddle-ocr-golden');
const MANIFEST_PATH = path.join(FIXTURE_DIR, 'manifest.json');

test('verifyGoldenManifestHashes: 実fixtureは全件ハッシュ一致する', () => {
  const manifest = JSON.parse(require('fs').readFileSync(MANIFEST_PATH, 'utf-8')) as GoldenManifest;
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
  const real = JSON.parse(require('fs').readFileSync(MANIFEST_PATH, 'utf-8')) as GoldenManifest;
  const tampered: GoldenManifest = JSON.parse(JSON.stringify(real));
  tampered.fixtures['golden-plain-01'].sourcePdfSha256['golden_plain_01.pdf'] = 'deadbeef'.repeat(8);
  const result = verifyGoldenManifestHashes(tampered, FIXTURE_DIR);
  assert.equal(result.ok, false);
  assert.ok(result.mismatches.some((m) => m.includes('golden_plain_01.pdf')));
});

test('deriveExpectedModelVersion: 実manifestから期待modelVersionを組み立てる', () => {
  const manifest = JSON.parse(require('fs').readFileSync(MANIFEST_PATH, 'utf-8')) as GoldenManifest;
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
  const expected = crypto.createHash('sha256').update(require('fs').readFileSync(p)).digest('hex');
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
    modelVersionMatch: true,
    ...overrides,
  };
}

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

test('buildReport: n<10ならinconclusive=true', () => {
  const requests = Array.from({ length: 6 }, (_, i) => makeRecord({ order: i })); // 1件目除くと5件
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:30:00Z',
    serviceSnapshotStart: { revisionName: 'r1', imageDigest: 'd1' },
    serviceSnapshotEnd: { revisionName: 'r1', imageDigest: 'd1' },
    requests,
  });
  assert.equal(report.inconclusive, true);
  assert.match(report.inconclusiveReason ?? '', /標本数が不足/);
});

test('buildReport: 2件目以降が全件timedOutでsubsequentがnullでもinconclusive=true(codex review指摘の回帰テスト)', () => {
  // 1件目は成功、2件目以降は全てタイムアウト → 有効サンプル0件 → subsequentはnullになる。
  // 修正前は `subsequent !== null && subsequent.n < 10` が false 評価され、
  // 全件タイムアウトでもconclusive扱いになりワークフローが緑になるバグがあった。
  const requests = [
    makeRecord({ order: 0 }),
    ...Array.from({ length: 5 }, (_, i) =>
      makeRecord({ order: i + 1, timedOut: true, httpStatus: null, fatal: false, textCheck: undefined, modelVersionMatch: undefined })
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
  assert.match(report.inconclusiveReason ?? '', /標本数が不足/);
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
// buildStepSummaryMarkdown
// ---------------------------------------------------------------------------

test('buildStepSummaryMarkdown: projected PASS/FAILの注記文言を含む', () => {
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

test('parseArgs: --repeatが不正な場合はエラー', () => {
  assert.throws(() => parseArgs(['--repeat=0']));
  assert.throws(() => parseArgs(['--repeat=abc']));
});
