/**
 * scripts/lib/auditLogger.js の contract test (Issue #239)
 *
 * 対象:
 *   - writeForceReindexAuditLog(): payload schema invariant + fail-open behavior
 *   - LOG_NAME: 'force_reindex_audit' 固定
 *   - VALID_SEVERITIES: Cloud Logging string severity
 *
 * 設計方針:
 *   - 実 Cloud Logging API を呼ばない (CI コスト + 認証回避、Codex Q5 推奨方針)
 *   - loggingFactory option で Logging client を mock 注入
 *   - PII 除外、stack 除外、fail-open invariant を lock-in
 */

import { expect } from 'chai';
import * as path from 'path';
import { createRequire } from 'module';

type AuditPayload = Record<string, unknown>;
type AuditMetadata = { severity: AuditSeverity; resource: { type: string } };

// runtime invariant を compile-time でも表現する literal union (typo 防止)
type AuditSeverity = 'INFO' | 'NOTICE' | 'WARNING' | 'ERROR' | 'CRITICAL';
type AuditEvent =
  | 'force_reindex_executed'
  | 'force_reindex_failed'
  | 'force_reindex_fatal'
  | 'force_reindex_batch_summary'
  | 'force_reindex_audit_log_failed'
  | 'force_reindex_startup_failed';
type AuditMode = 'doc-id' | 'all-drift';

interface AuditPayloadInput {
  event: AuditEvent;
  severity: AuditSeverity;
  mode?: AuditMode;
  dryRun?: boolean;
  docId?: string;
  counts?: Record<string, number>;
  hashes?: { oldHash: string | null; newHash: string };
  error?: unknown;
}

interface AuditCtx {
  projectId: string;
  executedBy?: string;
}

interface AuditOptions {
  loggingFactory?: (projectId: string) => FakeLogging;
}

interface FakeEntry {
  metadata: AuditMetadata;
  data: AuditPayload;
}

interface FakeLog {
  entry: (metadata: AuditMetadata, data: AuditPayload) => FakeEntry;
  write: (entry: FakeEntry) => Promise<void>;
}

interface FakeLogging {
  log: (logName: string) => FakeLog;
}

interface EventsMap {
  readonly EXECUTED: 'force_reindex_executed';
  readonly FAILED: 'force_reindex_failed';
  readonly FATAL: 'force_reindex_fatal';
  readonly BATCH_SUMMARY: 'force_reindex_batch_summary';
  readonly AUDIT_LOG_FAILED: 'force_reindex_audit_log_failed';
  readonly STARTUP_FAILED: 'force_reindex_startup_failed';
  readonly LOGGING_CLOSE_FAILED: 'force_reindex_logging_close_failed';
  readonly LOGGING_CLOSE_UNAVAILABLE: 'force_reindex_logging_close_unavailable';
}

interface SeveritiesMap {
  readonly INFO: 'INFO';
  readonly NOTICE: 'NOTICE';
  readonly WARNING: 'WARNING';
  readonly ERROR: 'ERROR';
  readonly CRITICAL: 'CRITICAL';
}

interface FakeLoggingWithClose {
  loggingService?: { close?: () => Promise<void> | void };
}

interface AuditLoggerModule {
  writeForceReindexAuditLog: (
    payload: AuditPayloadInput,
    ctx: AuditCtx,
    options?: AuditOptions,
  ) => Promise<{ ok: boolean; error?: Error }>;
  flushAndCloseLogging: () => Promise<void>;
  EVENTS: EventsMap;
  SEVERITIES: SeveritiesMap;
  LOG_NAME: 'force_reindex_audit';
  VALID_SEVERITIES: Set<AuditSeverity>;
  _resetCacheForTest: () => void;
  _setLoggingForTest: (projectId: string, logging: FakeLoggingWithClose) => void;
}

const requireCjs = createRequire(`${process.cwd()}/package.json`);
const auditLoggerMod = requireCjs(
  path.resolve(process.cwd(), '../scripts/lib/auditLogger.js'),
) as AuditLoggerModule;

const {
  writeForceReindexAuditLog,
  flushAndCloseLogging,
  EVENTS,
  SEVERITIES,
  LOG_NAME,
  VALID_SEVERITIES,
  _resetCacheForTest,
  _setLoggingForTest,
} = auditLoggerMod;

/** Fake Logging factory: 呼び出された entry/metadata を捕捉 */
function makeFakeLoggingFactory() {
  const calls: Array<{ logName: string; metadata: AuditMetadata; data: AuditPayload }> = [];
  const factory = (_projectId: string): FakeLogging => ({
    log: (logName: string): FakeLog => ({
      entry: (metadata, data) => ({ metadata, data }),
      write: async (entry) => {
        calls.push({ logName, metadata: entry.metadata, data: entry.data });
      },
    }),
  });
  return { factory, calls };
}

/** Fake Logging factory that throws on write (fail-open テスト用) */
function makeFailingLoggingFactory(error: Error) {
  const factory = (_projectId: string): FakeLogging => ({
    log: (_logName: string): FakeLog => ({
      entry: (metadata, data) => ({ metadata, data }),
      write: async () => {
        throw error;
      },
    }),
  });
  return { factory };
}

/** stderr 捕捉 helper (fail-open の出力検証用) */
async function captureStderr<T>(fn: () => Promise<T>): Promise<{ result: T; stderr: string }> {
  let buffer = '';
  const original = process.stderr.write.bind(process.stderr);
  // process.stderr.write は overload union 型のため typeof キャストで合わせる
  process.stderr.write = ((chunk: string | Uint8Array) => {
    buffer += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    const result = await fn();
    return { result, stderr: buffer };
  } finally {
    process.stderr.write = original;
  }
}

describe('scripts/lib/auditLogger (#239)', () => {
  beforeEach(() => {
    _resetCacheForTest();
  });

  describe('LOG_NAME constant', () => {
    it('force_reindex_audit に固定されている (SOP クエリと整合)', () => {
      expect(LOG_NAME).to.equal('force_reindex_audit');
    });
  });

  describe('VALID_SEVERITIES', () => {
    it('Cloud Logging string severity 5 種を含む', () => {
      expect(VALID_SEVERITIES.has('INFO')).to.be.true;
      expect(VALID_SEVERITIES.has('NOTICE')).to.be.true;
      expect(VALID_SEVERITIES.has('WARNING')).to.be.true;
      expect(VALID_SEVERITIES.has('ERROR')).to.be.true;
      expect(VALID_SEVERITIES.has('CRITICAL')).to.be.true;
    });
  });

  describe('EVENTS constant', () => {
    it('event 名 SSoT を提供する (typo 防止)', () => {
      expect(EVENTS.EXECUTED).to.equal('force_reindex_executed');
      expect(EVENTS.FAILED).to.equal('force_reindex_failed');
      expect(EVENTS.FATAL).to.equal('force_reindex_fatal');
      expect(EVENTS.BATCH_SUMMARY).to.equal('force_reindex_batch_summary');
      expect(EVENTS.AUDIT_LOG_FAILED).to.equal('force_reindex_audit_log_failed');
      expect(EVENTS.STARTUP_FAILED).to.equal('force_reindex_startup_failed');
    });

    it('Object.freeze で変更不可', () => {
      expect(Object.isFrozen(EVENTS)).to.be.true;
    });
  });

  describe('SEVERITIES constant', () => {
    it('Cloud Logging string severity 5 種を提供する (typo 防止)', () => {
      expect(SEVERITIES.INFO).to.equal('INFO');
      expect(SEVERITIES.NOTICE).to.equal('NOTICE');
      expect(SEVERITIES.WARNING).to.equal('WARNING');
      expect(SEVERITIES.ERROR).to.equal('ERROR');
      expect(SEVERITIES.CRITICAL).to.equal('CRITICAL');
    });

    it('Object.freeze で変更不可', () => {
      expect(Object.isFrozen(SEVERITIES)).to.be.true;
    });

    it('VALID_SEVERITIES と整合 (single source of truth)', () => {
      for (const v of Object.values(SEVERITIES)) {
        expect(VALID_SEVERITIES.has(v)).to.be.true;
      }
    });
  });

  describe('writeForceReindexAuditLog - 正常系', () => {
    const ctx: AuditCtx = { projectId: 'doc-split-dev', executedBy: 'github-actions[bot]' };

    it('成功 payload を Cloud Logging に書き込む (force_reindex_executed)', async () => {
      const { factory, calls } = makeFakeLoggingFactory();
      const result = await writeForceReindexAuditLog(
        {
          event: EVENTS.EXECUTED,
          severity: 'NOTICE',
          mode: 'doc-id',
          docId: 'docABC123',
          dryRun: false,
          counts: { tokensAdded: 25, tokensRemoved: 3 },
          hashes: { oldHash: 'stale001', newHash: '1a2b3c4d' },
        },
        ctx,
        { loggingFactory: factory },
      );

      expect(result.ok).to.be.true;
      expect(calls).to.have.lengthOf(1);
      expect(calls[0].logName).to.equal('force_reindex_audit');
      expect(calls[0].metadata.severity).to.equal('NOTICE');
      expect(calls[0].metadata.resource.type).to.equal('global');

      const payload = calls[0].data;
      expect(payload.event).to.equal('force_reindex_executed');
      expect(payload.projectId).to.equal('doc-split-dev');
      expect(payload.mode).to.equal('doc-id');
      expect(payload.docId).to.equal('docABC123');
      expect(payload.dryRun).to.equal(false);
      expect(payload.counts).to.deep.equal({ tokensAdded: 25, tokensRemoved: 3 });
      expect(payload.hashes).to.deep.equal({ oldHash: 'stale001', newHash: '1a2b3c4d' });
      expect(payload.executedBy).to.equal('github-actions[bot]');
      expect(payload.timestamp).to.match(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('dryRun:true を payload に含める (AC-5)', async () => {
      const { factory, calls } = makeFakeLoggingFactory();
      await writeForceReindexAuditLog(
        { event: EVENTS.EXECUTED, severity: 'NOTICE', dryRun: true, docId: 'docXYZ' },
        ctx,
        { loggingFactory: factory },
      );
      expect(calls[0].data.dryRun).to.equal(true);
    });

    it('failed event は ERROR severity と error 詳細を含む (AC-2)', async () => {
      const { factory, calls } = makeFakeLoggingFactory();
      const fakeErr = Object.assign(new Error('Firestore PERMISSION_DENIED'), {
        code: 7,
        reindexStage: 'documents_search_update',
      });

      await writeForceReindexAuditLog(
        { event: EVENTS.FAILED, severity: 'ERROR', docId: 'docFail', error: fakeErr },
        ctx,
        { loggingFactory: factory },
      );

      expect(calls[0].metadata.severity).to.equal('ERROR');
      expect(calls[0].data.event).to.equal('force_reindex_failed');
      expect(calls[0].data.error).to.deep.equal({
        code: 7,
        message: 'Firestore PERMISSION_DENIED',
        stage: 'documents_search_update',
      });
    });

    it('error.stack は payload に含めない (監査価値なし)', async () => {
      const { factory, calls } = makeFakeLoggingFactory();
      const fakeErr = new Error('boom');
      fakeErr.stack = 'Error: boom\n  at /some/file.js:123';

      await writeForceReindexAuditLog(
        { event: EVENTS.FAILED, severity: 'ERROR', error: fakeErr },
        ctx,
        { loggingFactory: factory },
      );

      expect(calls[0].data.error).to.not.have.property('stack');
      expect(JSON.stringify(calls[0].data)).to.not.include('at /some/file.js');
    });

    it('batch summary event をサポート (AC-11)', async () => {
      const { factory, calls } = makeFakeLoggingFactory();
      await writeForceReindexAuditLog(
        {
          event: EVENTS.BATCH_SUMMARY,
          severity: 'NOTICE',
          mode: 'all-drift',
          dryRun: false,
          counts: { processed: 1000, drifted: 5, reindexed: 5, failed: 0 },
        },
        ctx,
        { loggingFactory: factory },
      );
      expect(calls[0].data.event).to.equal('force_reindex_batch_summary');
      expect((calls[0].data.counts as Record<string, number>).processed).to.equal(1000);
    });
  });

  describe('writeForceReindexAuditLog - PII 除外 (AC-10)', () => {
    it('schema にない PII フィールド (customerName/officeName/fileName) は payload に含めない', async () => {
      const { factory, calls } = makeFakeLoggingFactory();
      // 型契約上は AuditPayloadInput に PII フィールドは存在しないが、JS 呼び出し経路から
      // 誤って渡された場合の invariant 検証のため Record<string, unknown> 経由で渡す。
      const payloadWithPii: Record<string, unknown> = {
        event: EVENTS.EXECUTED,
        severity: 'NOTICE',
        docId: 'docPII',
        customerName: '田中太郎',
        officeName: 'サンプル事業所',
        fileName: '請求書_2026-04.pdf',
      };
      await writeForceReindexAuditLog(
        payloadWithPii as unknown as AuditPayloadInput,
        { projectId: 'doc-split-dev' },
        { loggingFactory: factory },
      );

      const serialized = JSON.stringify(calls[0].data);
      expect(serialized).to.not.include('田中太郎');
      expect(serialized).to.not.include('サンプル事業所');
      expect(serialized).to.not.include('請求書');
      expect(calls[0].data).to.not.have.property('customerName');
      expect(calls[0].data).to.not.have.property('officeName');
      expect(calls[0].data).to.not.have.property('fileName');
    });
  });

  describe('writeForceReindexAuditLog - fail-open (AC-3, AC-9)', () => {
    it('Cloud Logging 書き込み失敗時、reject せず ok:false を返す', async () => {
      const { factory } = makeFailingLoggingFactory(new Error('Logging API unavailable'));

      const { result, stderr } = await captureStderr(() =>
        writeForceReindexAuditLog(
          { event: EVENTS.EXECUTED, severity: 'NOTICE' },
          { projectId: 'doc-split-dev' },
          { loggingFactory: factory },
        ),
      );

      expect(result.ok).to.be.false;
      expect(result.error).to.be.an.instanceof(Error);
      expect(stderr).to.include('force_reindex_audit_log_failed');
      expect(stderr).to.include('Logging API unavailable');
    });

    it('stderr 出力は構造化 JSON 形式 + WARNING severity (AC-9)', async () => {
      const { factory } = makeFailingLoggingFactory(new Error('boom'));

      const { stderr } = await captureStderr(() =>
        writeForceReindexAuditLog(
          { event: EVENTS.EXECUTED, severity: 'NOTICE' },
          { projectId: 'p' },
          { loggingFactory: factory },
        ),
      );

      const lines = stderr.trim().split('\n');
      const lastLine = lines[lines.length - 1];
      const parsed = JSON.parse(lastLine);
      expect(parsed.severity).to.equal('WARNING');
      expect(parsed.event).to.equal('force_reindex_audit_log_failed');
      expect(parsed.errorMessage).to.equal('boom');
      expect(parsed.timestamp).to.match(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('writeForceReindexAuditLog - 入力検証', () => {
    it('ctx.projectId 未指定で fail-open (本体停止しない)', async () => {
      const { factory } = makeFakeLoggingFactory();
      const { result, stderr } = await captureStderr(() =>
        writeForceReindexAuditLog(
          { event: EVENTS.EXECUTED, severity: 'NOTICE' },
          { projectId: '' },
          { loggingFactory: factory },
        ),
      );
      expect(result.ok).to.be.false;
      expect(stderr).to.include('ctx.projectId is required');
    });

    it('payload.event 未指定で fail-open', async () => {
      const { factory } = makeFakeLoggingFactory();
      const { result, stderr } = await captureStderr(() =>
        writeForceReindexAuditLog(
          // 型契約上は許されない値を runtime 検証のテストのため強制 cast
          { event: '' as AuditEvent, severity: SEVERITIES.NOTICE },
          { projectId: 'p' },
          { loggingFactory: factory },
        ),
      );
      expect(result.ok).to.be.false;
      expect(stderr).to.include('payload.event is required');
    });

    it('invalid severity で fail-open', async () => {
      const { factory } = makeFakeLoggingFactory();
      const { result, stderr } = await captureStderr(() =>
        writeForceReindexAuditLog(
          // 型契約上は許されない値を runtime 検証のテストのため強制 cast で渡す
          { event: EVENTS.EXECUTED, severity: 'INVALID' as AuditSeverity },
          { projectId: 'p' },
          { loggingFactory: factory },
        ),
      );
      expect(result.ok).to.be.false;
      expect(stderr).to.include('invalid severity');
    });
  });

  describe('writeForceReindexAuditLog - defensive fallback (review #6)', () => {
    it('err.code が BigInt でも JSON.stringify TypeError を握り潰す', async () => {
      const bigintErr = Object.assign(new Error('bigint code'), { code: BigInt(7) });
      const { factory } = makeFailingLoggingFactory(bigintErr);

      const { result, stderr } = await captureStderr(() =>
        writeForceReindexAuditLog(
          { event: EVENTS.EXECUTED, severity: SEVERITIES.NOTICE },
          { projectId: 'p' },
          { loggingFactory: factory },
        ),
      );

      // fail-open invariant: stringify が throw しても reject しない
      expect(result.ok).to.be.false;
      // last-resort text fallback が出力される
      expect(stderr).to.include('audit_log_failed');
      expect(stderr).to.include('bigint code');
    });
  });

  describe('writeForceReindexAuditLog - Map cache per-project (review #5)', () => {
    it('異なる projectId に対して factory が個別に解決される', async () => {
      const factoryCalls: string[] = [];
      const trackingFactory = (projectId: string): FakeLogging => {
        factoryCalls.push(projectId);
        return {
          log: (_logName: string): FakeLog => ({
            entry: (metadata, data) => ({ metadata, data }),
            write: async () => {},
          }),
        };
      };

      await writeForceReindexAuditLog(
        { event: EVENTS.EXECUTED, severity: SEVERITIES.NOTICE },
        { projectId: 'project-a' },
        { loggingFactory: trackingFactory },
      );
      await writeForceReindexAuditLog(
        { event: EVENTS.EXECUTED, severity: SEVERITIES.NOTICE },
        { projectId: 'project-b' },
        { loggingFactory: trackingFactory },
      );

      // 各 projectId で factory 呼出 (cache key 化されている、silent bug 防止)
      expect(factoryCalls).to.deep.equal(['project-a', 'project-b']);
    });
  });

  // #384: process.exit() で in-flight gRPC writes が drop される問題への対策。
  // flushAndCloseLogging() が cached Logging instance の loggingService.close() を
  // gracefully 呼ぶことで、event loop natural drain と組み合わせて書き込み完全性を保証する。
  describe('flushAndCloseLogging (#384)', () => {
    it('cached Logging instances の loggingService.close() を全て呼ぶ', async () => {
      const closeCalls: string[] = [];
      _setLoggingForTest('project-a', {
        loggingService: {
          close: async () => {
            closeCalls.push('project-a');
          },
        },
      });
      _setLoggingForTest('project-b', {
        loggingService: {
          close: async () => {
            closeCalls.push('project-b');
          },
        },
      });

      await flushAndCloseLogging();

      expect(closeCalls).to.have.members(['project-a', 'project-b']);
    });

    it('flush 後に cache が clear され、二重 close されない', async () => {
      let closeCount = 0;
      _setLoggingForTest('project-a', {
        loggingService: {
          close: async () => {
            closeCount += 1;
          },
        },
      });

      await flushAndCloseLogging();
      await flushAndCloseLogging();

      expect(closeCount).to.equal(1);
    });

    it('close() が throw しても本体は throw しない (fail-open invariant)', async () => {
      _setLoggingForTest('project-a', {
        loggingService: {
          close: async () => {
            throw new Error('grpc channel already closed');
          },
        },
      });

      // #386 review C1: 本体 throw しないことに加え、診断情報を stderr に出力する
      const { stderr } = await captureStderr(async () => {
        await flushAndCloseLogging();
      });

      expect(stderr).to.contain(EVENTS.LOGGING_CLOSE_FAILED);
      expect(stderr).to.contain('project-a');
      expect(stderr).to.contain('grpc channel already closed');
    });

    it('loggingService が undefined でも throw せず、unavailable 診断を出力する', async () => {
      _setLoggingForTest('project-a', {});

      // #386 review C2: silent skip ではなく LOGGING_CLOSE_UNAVAILABLE を必ず stderr に残す
      const { stderr } = await captureStderr(async () => {
        await flushAndCloseLogging();
      });

      expect(stderr).to.contain(EVENTS.LOGGING_CLOSE_UNAVAILABLE);
      expect(stderr).to.contain('project-a');
    });

    it('loggingService.close が undefined でも throw せず、unavailable 診断を出力する', async () => {
      _setLoggingForTest('project-a', { loggingService: {} });

      const { stderr } = await captureStderr(async () => {
        await flushAndCloseLogging();
      });

      expect(stderr).to.contain(EVENTS.LOGGING_CLOSE_UNAVAILABLE);
    });

    it('close() が同期 throw しても本体は throw せず診断を出力する (#386 review C1 補強)', async () => {
      _setLoggingForTest('project-a', {
        loggingService: {
          close: () => {
            throw new Error('synchronous throw');
          },
        },
      });

      const { stderr } = await captureStderr(async () => {
        await flushAndCloseLogging();
      });

      expect(stderr).to.contain(EVENTS.LOGGING_CLOSE_FAILED);
      expect(stderr).to.contain('synchronous throw');
    });

    it('cache が空でも throw しない', async () => {
      await flushAndCloseLogging();
    });

    it('複数 instance のうち 1 つが throw しても他の close は実行される', async () => {
      const closeCalls: string[] = [];
      _setLoggingForTest('project-a', {
        loggingService: {
          close: async () => {
            throw new Error('a failed');
          },
        },
      });
      _setLoggingForTest('project-b', {
        loggingService: {
          close: async () => {
            closeCalls.push('project-b');
          },
        },
      });

      // project-a が失敗しても project-b は close される (fail-isolation invariant)
      const { stderr } = await captureStderr(async () => {
        await flushAndCloseLogging();
      });

      expect(closeCalls).to.deep.equal(['project-b']);
      // project-a の失敗は LOGGING_CLOSE_FAILED として stderr に残る
      expect(stderr).to.contain(EVENTS.LOGGING_CLOSE_FAILED);
      expect(stderr).to.contain('a failed');
    });
  });
});
