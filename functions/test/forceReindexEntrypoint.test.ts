/**
 * force-reindex.js の runEntrypoint integration test
 *
 * 対象: entrypoint 構造 (try/finally + process.exitCode + flushAndCloseLogging +
 *       emitFailureEvent の try/catch 入れ子) の invariant を unit test で lock-in。
 *
 * ロック対象:
 *   - I1 (exitCode を flush より先に設定) の regression 検出
 *   - I2 (emitFailureEvent を try/catch で包む) の regression 検出
 *   - main throw + flush throw 複合時の exitCode guard (EXIT_PARTIAL_FAILURE 維持)
 *   - projectId 未設定時の stderr JSON fallback + stringify throw 時の original error surface
 *
 * 非対象:
 *   - I3 (初期値 EXIT_PRECONDITION) は defensive fallback として保持されるのみで
 *     現行制御フローでは observable でないため assertion しない
 *
 * 設計方針:
 *   - runEntrypoint({ main, flushAndCloseLogging, emitFailureEvent, buildAuditCtx }) で DI
 *   - process.exitCode / FIREBASE_PROJECT_ID / stdio は withProcessSandbox で save/restore 集約
 *   - 文字列 literal ではなく auditLogger の EVENTS/SEVERITIES 定数を参照 (drift 防止)
 */

import { expect } from 'chai';
import * as path from 'path';
import { createRequire } from 'module';

const requireCjs = createRequire(`${process.cwd()}/package.json`);
const forceReindex = requireCjs(
  path.resolve(process.cwd(), '../scripts/force-reindex.js'),
) as {
  runEntrypoint: (deps?: {
    main?: () => Promise<number>;
    flushAndCloseLogging?: () => Promise<void>;
    emitFailureEvent?: (params: Record<string, unknown>) => Promise<void>;
    buildAuditCtx?: (projectId: string) => { projectId: string; executedBy: string };
  }) => Promise<void>;
  EXIT_OK: number;
  EXIT_PARTIAL_FAILURE: number;
};
const auditLoggerMod = requireCjs(
  path.resolve(process.cwd(), '../scripts/lib/auditLogger.js'),
) as {
  EVENTS: Readonly<Record<string, string>>;
  SEVERITIES: Readonly<Record<string, string>>;
};

const { runEntrypoint, EXIT_OK, EXIT_PARTIAL_FAILURE } = forceReindex;
const { EVENTS, SEVERITIES } = auditLoggerMod;

/**
 * 各 test の process 副作用 (stdio / exitCode / FIREBASE_PROJECT_ID) を sandbox 化。
 * overrides で差し替え内容を宣言し、try/finally の boilerplate を一箇所に集約する。
 * projectId は `null` で明示的削除、`undefined` 省略で現状維持を表現する。
 */
async function withProcessSandbox(
  overrides: {
    stdout?: (chunk: string | Uint8Array) => boolean;
    stderr?: (chunk: string | Uint8Array) => boolean;
    projectId?: string | null;
  },
  fn: () => Promise<void>,
): Promise<void> {
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  const origExitCode = process.exitCode;
  const origProjectId = process.env.FIREBASE_PROJECT_ID;

  if (overrides.stdout) {
    process.stdout.write = overrides.stdout as typeof process.stdout.write;
  }
  if (overrides.stderr) {
    process.stderr.write = overrides.stderr as typeof process.stderr.write;
  }
  if (overrides.projectId === null) {
    delete process.env.FIREBASE_PROJECT_ID;
  } else if (overrides.projectId !== undefined) {
    process.env.FIREBASE_PROJECT_ID = overrides.projectId;
  }
  // test 観測値が前回の残留 exitCode と混ざらないように unset
  process.exitCode = undefined;

  try {
    await fn();
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    process.exitCode = origExitCode;
    if (origProjectId === undefined) {
      delete process.env.FIREBASE_PROJECT_ID;
    } else {
      process.env.FIREBASE_PROJECT_ID = origProjectId;
    }
  }
}

/** stderr を蓄積する buffer と write 関数のペアを生成 */
function makeStderrCapture(): { buf: { value: string }; write: (chunk: string | Uint8Array) => boolean } {
  const buf = { value: '' };
  const write = (chunk: string | Uint8Array) => {
    buf.value += String(chunk);
    return true;
  };
  return { buf, write };
}

const noopWrite = () => true;

describe('force-reindex: runEntrypoint (#387)', () => {
  it('success path: main 成功 → finally で flush、process.exitCode === EXIT_OK', async () => {
    const callOrder: string[] = [];

    await withProcessSandbox({ stdout: noopWrite, stderr: noopWrite }, async () => {
      await runEntrypoint({
        main: async () => {
          callOrder.push('main');
          return EXIT_OK;
        },
        flushAndCloseLogging: async () => {
          callOrder.push('flush');
        },
        emitFailureEvent: async () => {
          callOrder.push('emitFailure');
        },
        buildAuditCtx: (projectId) => ({ projectId, executedBy: 'test' }),
      });

      expect(callOrder).to.deep.equal(['main', 'flush']);
      expect(process.exitCode).to.equal(EXIT_OK);
    });
  });

  it('main throw: emitFailureEvent → flush の順で呼ばれ process.exitCode === EXIT_PARTIAL_FAILURE', async () => {
    const callOrder: string[] = [];

    await withProcessSandbox(
      { stdout: noopWrite, stderr: noopWrite, projectId: 'doc-split-dev' },
      async () => {
        await runEntrypoint({
          main: async () => {
            callOrder.push('main');
            throw new Error('simulated async error after initializeApp');
          },
          flushAndCloseLogging: async () => {
            callOrder.push('flush');
          },
          emitFailureEvent: async (params: Record<string, unknown>) => {
            callOrder.push('emitFailure');
            // FATAL / CRITICAL が投入されることを定数参照で確認 (drift 防止)
            expect(params.event).to.equal(EVENTS.FATAL);
            expect(params.severity).to.equal(SEVERITIES.CRITICAL);
          },
          buildAuditCtx: (projectId) => ({ projectId, executedBy: 'test' }),
        });

        // 順序 invariant: emitFailure が flush より先 (audit log を drop しないため)
        expect(callOrder).to.deep.equal(['main', 'emitFailure', 'flush']);
        expect(process.exitCode).to.equal(EXIT_PARTIAL_FAILURE);
      },
    );
  });

  it('flush throw (success 後): process.exitCode を EXIT_PARTIAL_FAILURE に強制上書き (I1 invariant)', async () => {
    const callOrder: string[] = [];
    const stderr = makeStderrCapture();

    await withProcessSandbox({ stdout: noopWrite, stderr: stderr.write }, async () => {
      await runEntrypoint({
        main: async () => {
          callOrder.push('main');
          return EXIT_OK;
        },
        flushAndCloseLogging: async () => {
          callOrder.push('flush');
          throw new Error('simulated flush failure');
        },
        emitFailureEvent: async () => {
          callOrder.push('emitFailure');
        },
        buildAuditCtx: (projectId) => ({ projectId, executedBy: 'test' }),
      });

      // main は成功したが flush 失敗 → audit drop の強い示唆として強制失敗扱い
      expect(callOrder).to.deep.equal(['main', 'flush']);
      expect(process.exitCode).to.equal(EXIT_PARTIAL_FAILURE);
      expect(stderr.buf.value).to.include('flushAndCloseLogging failed');
    });
  });

  it('emitFailureEvent throw: FATAL silent loss 防止、exitCode === EXIT_PARTIAL_FAILURE 維持 (I2 invariant)', async () => {
    const callOrder: string[] = [];
    const stderr = makeStderrCapture();

    await withProcessSandbox(
      { stdout: noopWrite, stderr: stderr.write, projectId: 'doc-split-dev' },
      async () => {
        await runEntrypoint({
          main: async () => {
            callOrder.push('main');
            throw new Error('simulated main failure');
          },
          flushAndCloseLogging: async () => {
            callOrder.push('flush');
          },
          emitFailureEvent: async () => {
            callOrder.push('emitFailure');
            // JSON circular 等で emitFailureEvent 自体が throw する regression を模擬
            throw new Error('simulated emit failure');
          },
          buildAuditCtx: (projectId) => ({ projectId, executedBy: 'test' }),
        });

        // emitFailure throw を吸収し flush まで到達する
        expect(callOrder).to.deep.equal(['main', 'emitFailure', 'flush']);
        // main throw 時点で EXIT_PARTIAL_FAILURE に設定済み → emit throw でも維持
        expect(process.exitCode).to.equal(EXIT_PARTIAL_FAILURE);
        // 最低限 stderr に original error が残ること (silent loss 防止)
        expect(stderr.buf.value).to.include('emitFailureEvent failed');
        expect(stderr.buf.value).to.include('original error');
      },
    );
  });

  it('main throw + flush throw: 複合失敗でも process.exitCode === EXIT_PARTIAL_FAILURE 維持 (flush catch guard)', async () => {
    // flush catch の `if (process.exitCode === EXIT_OK)` guard が regression で
    // 消えた/緩められた場合に検出する。main throw 後は既に EXIT_PARTIAL_FAILURE で、
    // flush 失敗が exit code を上書きしてはならない (情報劣化防止)。
    const callOrder: string[] = [];
    const stderr = makeStderrCapture();

    await withProcessSandbox(
      { stdout: noopWrite, stderr: stderr.write, projectId: 'doc-split-dev' },
      async () => {
        await runEntrypoint({
          main: async () => {
            callOrder.push('main');
            throw new Error('simulated main failure');
          },
          flushAndCloseLogging: async () => {
            callOrder.push('flush');
            throw new Error('simulated flush failure');
          },
          emitFailureEvent: async () => {
            callOrder.push('emitFailure');
          },
          buildAuditCtx: (projectId) => ({ projectId, executedBy: 'test' }),
        });

        expect(callOrder).to.deep.equal(['main', 'emitFailure', 'flush']);
        expect(process.exitCode).to.equal(EXIT_PARTIAL_FAILURE);
        expect(stderr.buf.value).to.include('flushAndCloseLogging failed');
      },
    );
  });

  it('projectId 未設定 + stringify throw: original error も silent loss しない', async () => {
    // BigInt を error.code に仕込むと JSON.stringify は
    // "Do not know how to serialize a BigInt" で throw する。
    // その時 original error の code / message を stderr に別行で surface しないと
    // #386 で防いだ silent loss パターンが fallback 経路で再発する。
    const callOrder: string[] = [];
    const stderr = makeStderrCapture();

    await withProcessSandbox(
      { stdout: noopWrite, stderr: stderr.write, projectId: null },
      async () => {
        const errWithBigIntCode: Error & { code?: bigint } = Object.assign(
          new Error('simulated fatal bigint'),
          { code: BigInt(42) },
        );

        await runEntrypoint({
          main: async () => {
            throw errWithBigIntCode;
          },
          flushAndCloseLogging: async () => {
            callOrder.push('flush');
          },
          emitFailureEvent: async () => {
            callOrder.push('emitFailure');
          },
          buildAuditCtx: (projectId) => ({ projectId, executedBy: 'test' }),
        });

        expect(callOrder).to.deep.equal(['flush']);
        expect(process.exitCode).to.equal(EXIT_PARTIAL_FAILURE);
        expect(stderr.buf.value).to.include('error stringify failed');
        // 重要: original error の message / code が silent loss していないこと
        expect(stderr.buf.value).to.include('simulated fatal bigint');
        expect(stderr.buf.value).to.include('code=42');
      },
    );
  });

  it('main throw without FIREBASE_PROJECT_ID: fallback stderr 経路で stringify、flush は実行される', async () => {
    // I3 関連: projectId 未設定時でも audit ctx 構築に依存せず safe に落ちること
    const callOrder: string[] = [];
    const stderr = makeStderrCapture();

    await withProcessSandbox(
      { stdout: noopWrite, stderr: stderr.write, projectId: null },
      async () => {
        await runEntrypoint({
          main: async () => {
            throw Object.assign(new Error('simulated fatal'), { code: 13 });
          },
          flushAndCloseLogging: async () => {
            callOrder.push('flush');
          },
          emitFailureEvent: async () => {
            callOrder.push('emitFailure');
          },
          buildAuditCtx: (projectId) => ({ projectId, executedBy: 'test' }),
        });

        // projectId 未設定 → emitFailureEvent 経路に入らず stderr JSON で fallback
        expect(callOrder).to.deep.equal(['flush']);
        expect(process.exitCode).to.equal(EXIT_PARTIAL_FAILURE);
        const fatalLine = stderr.buf.value.split('\n').find((l) => l.includes(EVENTS.FATAL));
        expect(fatalLine, 'stderr に FATAL JSON が出力される').to.be.a('string');
        const parsed = JSON.parse(fatalLine as string);
        expect(parsed.severity).to.equal(SEVERITIES.CRITICAL);
        expect(parsed.errorMessage).to.equal('simulated fatal');
        expect(parsed.errorCode).to.equal(13);
      },
    );
  });
});
