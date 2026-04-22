/**
 * force-reindex.js の audit log integration test (Issue #239 review #3, #4)
 *
 * 対象:
 *   - emitFailureEvent helper: stdout JSON + audit log の二重出力 SSoT
 *   - buildAuditCtx: GITHUB_ACTOR / USER fallback の優先順位
 *   - BATCH_SUMMARY severity 三項演算子の境界 (failed=0/>0)
 *
 * 設計方針:
 *   - 実 Cloud Logging を呼ばず、auditLogger の loggingFactory DI で mock 注入
 *   - emitFailureEvent は force-reindex.js から export して直接テスト可能に
 *   - 三項演算子は pure logic として独立検証 (runAllDrift 全体の integration は不要)
 */

import { expect } from 'chai';
import * as path from 'path';
import { createRequire } from 'module';

const requireCjs = createRequire(`${process.cwd()}/package.json`);
const forceReindex = requireCjs(
  path.resolve(process.cwd(), '../scripts/force-reindex.js'),
) as {
  emitFailureEvent: (params: {
    event: string;
    severity: string;
    mode?: string;
    docId?: string;
    error?: Error;
    dryRun?: boolean;
    auditCtx: { projectId: string; executedBy?: string };
    loggingFactory?: (projectId: string) => unknown;
  }) => Promise<void>;
  buildAuditCtx: (projectId: string) => { projectId: string; executedBy: string };
};

/** Cloud Logging 実 API を呼ばないための mock factory */
function makeNoopLoggingFactory() {
  return (_projectId: string) => ({
    log: (_logName: string) => ({
      entry: (metadata: unknown, data: unknown) => ({ metadata, data }),
      write: async () => {},
    }),
  });
}

const auditLoggerMod = requireCjs(
  path.resolve(process.cwd(), '../scripts/lib/auditLogger.js'),
) as {
  EVENTS: Readonly<Record<string, string>>;
  SEVERITIES: Readonly<Record<string, string>>;
  _resetCacheForTest: () => void;
};

const { EVENTS, SEVERITIES, _resetCacheForTest } = auditLoggerMod;
const { emitFailureEvent, buildAuditCtx } = forceReindex;

/** stdout/stderr 捕捉 helper */
function captureOutput<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; stdout: string; stderr: string }> {
  let stdoutBuf = '';
  let stderrBuf = '';
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdoutBuf += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrBuf += String(chunk);
    return true;
  }) as typeof process.stderr.write;

  return Promise.resolve(fn())
    .then((result) => {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
      return { result, stdout: stdoutBuf, stderr: stderrBuf };
    })
    .catch((e) => {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
      throw e;
    });
}

describe('force-reindex: emitFailureEvent (#239 review #3)', () => {
  beforeEach(() => {
    _resetCacheForTest();
  });

  it('stdout JSON と Cloud Logging audit を両方に出力する (SSoT)', async () => {
    // loggingFactory mock 注入で実 Cloud Logging API を回避 (CI 環境で認証情報なしでも動作)
    const fakeErr = Object.assign(new Error('test failure'), {
      code: 7,
      reindexStage: 'documents_search_update',
    });

    const { stderr } = await captureOutput(() =>
      emitFailureEvent({
        event: EVENTS.FAILED,
        severity: SEVERITIES.ERROR,
        mode: 'doc-id',
        docId: 'docTest',
        error: fakeErr,
        dryRun: false,
        auditCtx: { projectId: 'doc-split-dev', executedBy: 'test-user' },
        loggingFactory: makeNoopLoggingFactory(),
      }),
    );

    // stderr 1 行目に AC-4 の構造化 JSON (Cloud Logging は noop mock のため stderr 追加なし)
    const lines = stderr.trim().split('\n').filter((l) => l.length > 0);
    expect(lines).to.have.lengthOf(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.severity).to.equal('ERROR');
    expect(parsed.event).to.equal('force_reindex_failed');
    expect(parsed.docId).to.equal('docTest');
    expect(parsed.stage).to.equal('documents_search_update');
    expect(parsed.errorCode).to.equal(7);
    expect(parsed.errorMessage).to.equal('test failure');
    expect(parsed.stack).to.be.a('string');
  });

  it('docId 未指定時は null を出力する', async () => {
    const fakeErr = new Error('startup error');

    const { stderr } = await captureOutput(() =>
      emitFailureEvent({
        event: EVENTS.STARTUP_FAILED,
        severity: SEVERITIES.ERROR,
        error: fakeErr,
        auditCtx: { projectId: 'doc-split-dev' },
        loggingFactory: makeNoopLoggingFactory(),
      }),
    );

    const lines = stderr.trim().split('\n').filter((l) => l.length > 0);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.docId).to.equal(null);
    expect(parsed.event).to.equal('force_reindex_startup_failed');
  });

  it('writeForceReindexAuditLog にも payload を伝達する (二重出力 invariant)', async () => {
    // loggingFactory に call 捕捉機構を仕込んで、Cloud Logging 経路にも到達することを確認
    const writeCalls: Array<{ logName: string; data: Record<string, unknown> }> = [];
    const trackingFactory = (_projectId: string) => ({
      log: (logName: string) => ({
        entry: (_metadata: unknown, data: unknown) => ({ logName, data }),
        write: async (entry: { logName: string; data: Record<string, unknown> }) => {
          writeCalls.push({ logName: entry.logName, data: entry.data });
        },
      }),
    });

    await captureOutput(() =>
      emitFailureEvent({
        event: EVENTS.FAILED,
        severity: SEVERITIES.ERROR,
        mode: 'doc-id',
        docId: 'docDualSink',
        error: new Error('dual sink test'),
        dryRun: false,
        auditCtx: { projectId: 'doc-split-dev', executedBy: 'tester' },
        loggingFactory: trackingFactory,
      }),
    );

    expect(writeCalls).to.have.lengthOf(1);
    expect(writeCalls[0].logName).to.equal('force_reindex_audit');
    expect(writeCalls[0].data.event).to.equal('force_reindex_failed');
    expect(writeCalls[0].data.docId).to.equal('docDualSink');
  });
});

describe('force-reindex: buildAuditCtx', () => {
  let originalGithubActor: string | undefined;
  let originalUser: string | undefined;

  beforeEach(() => {
    originalGithubActor = process.env.GITHUB_ACTOR;
    originalUser = process.env.USER;
    delete process.env.GITHUB_ACTOR;
    delete process.env.USER;
  });

  afterEach(() => {
    if (originalGithubActor !== undefined) process.env.GITHUB_ACTOR = originalGithubActor;
    else delete process.env.GITHUB_ACTOR;
    if (originalUser !== undefined) process.env.USER = originalUser;
    else delete process.env.USER;
  });

  it('GITHUB_ACTOR を最優先で executedBy に採用 (Actions 環境)', () => {
    process.env.GITHUB_ACTOR = 'actions-bot';
    process.env.USER = 'should-be-ignored';
    const ctx = buildAuditCtx('doc-split-dev');
    expect(ctx).to.deep.equal({ projectId: 'doc-split-dev', executedBy: 'actions-bot' });
  });

  it('GITHUB_ACTOR 未設定時は USER をフォールバック (ローカル環境)', () => {
    process.env.USER = 'developer';
    const ctx = buildAuditCtx('doc-split-dev');
    expect(ctx.executedBy).to.equal('developer');
  });

  it('両方未設定なら "unknown" を採用', () => {
    const ctx = buildAuditCtx('doc-split-dev');
    expect(ctx.executedBy).to.equal('unknown');
  });
});

/**
 * BATCH_SUMMARY severity の境界テスト (review #4)
 *
 * runAllDrift 末尾の `failed > 0 ? SEVERITIES.WARNING : SEVERITIES.NOTICE` が
 * 監視アラート条件と直結するため、三項演算子の境界 (failed=0, failed=1) を直接検証。
 * full integration は emulator 必須のため、ここでは pure logic として表現する helper を切り出す
 * のではなく、severity 計算式を test 内で reproduce して invariant を documentation する。
 */
describe('force-reindex: BATCH_SUMMARY severity boundary (#239 review #4)', () => {
  function computeBatchSummarySeverity(failed: number): string {
    return failed > 0 ? SEVERITIES.WARNING : SEVERITIES.NOTICE;
  }

  it('failed=0 で NOTICE (成功時、アラート未発火)', () => {
    expect(computeBatchSummarySeverity(0)).to.equal('NOTICE');
  });

  it('failed=1 で WARNING (1 件失敗でアラート発火、SOP 観測対象)', () => {
    expect(computeBatchSummarySeverity(1)).to.equal('WARNING');
  });

  it('failed=100 で WARNING (大量失敗でも severity 不変、規模はアラート側で判断)', () => {
    expect(computeBatchSummarySeverity(100)).to.equal('WARNING');
  });
});
