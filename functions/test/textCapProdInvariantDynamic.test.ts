/**
 * textCap handleAggregateInvariantViolation の prod observability 動的 invocation テスト (Issue #299)
 *
 * 目的: grep contract (textCapProdInvariantContract.test.ts / textCapPendingLogsContract.test.ts)
 * が shape/anchor を静的に lock-in するのに対し、本 test は runtime 挙動を動的に検証する二段防御:
 *
 * - 条件分岐 reversal (prod 分岐内で `if (!condition)` 等に mutate された regression)
 * - `handleAggregateInvariantViolation` が呼ばれない silent 回帰
 * - `documentId` 伝搬の actual propagation (silent-failure-hunter S2 補完)
 * - errorLogger load 失敗時の console.error fallback (Codex S3 指摘対応)
 *
 * 実装戦略: `createRequire(import.meta.url)` で CJS require を取得し、`require.cache` に
 * errorLogger の stub module を直接注入する。`sinon` / `proxyquire` 等の追加依存を避けるため
 * Node core のみで実装。Node の module cache は global singleton なので、textCap.ts 内部の
 * dynamic `require('./errorLogger')` にも stub が反映される。
 *
 * 注意点:
 * - Mocha は default で file 内逐次実行のため module cache 差し替えは安全だが、並列実行を
 *   有効化する場合は本ファイルを分離必須 (cache は Node global singleton)
 * - `@ts-expect-error TS1470` は `import.meta` を CJS 出力と判定する tsc 抑制用。runtime は
 *   ESM で解決される (Node.js v24 + mocha + ts-node/register の自動検出)
 */

import { expect } from 'chai';
import { createRequire } from 'module';
import type { SummaryField } from '../../shared/types';

// @ts-expect-error TS1470: tsc は CJS 出力と判定するが runtime は ESM で解決可能 (Node v20+ + ts-node/register)
const requireCjs = createRequire(import.meta.url);
const ERROR_LOGGER_PATH = requireCjs.resolve('../src/utils/errorLogger');
const TEXT_CAP_PATH = requireCjs.resolve('../src/utils/textCap');

interface SafeLogErrorParams {
  error: Error;
  source: string;
  functionName: string;
  documentId?: string;
}

interface StubState {
  calls: SafeLogErrorParams[];
  throwOnLoad: boolean;
}

/**
 * errorLogger module を stub に差し替える。`throwOnLoad=true` の場合は require 時に
 * throw して console.error fallback path (textCap.ts:131 catch) を誘発する。
 */
function installErrorLoggerStub(state: StubState): void {
  delete requireCjs.cache[ERROR_LOGGER_PATH];
  delete requireCjs.cache[TEXT_CAP_PATH];

  if (state.throwOnLoad) {
    Object.defineProperty(requireCjs.cache, ERROR_LOGGER_PATH, {
      configurable: true,
      get() {
        throw new Error('simulated errorLogger load failure');
      },
    });
    return;
  }

  const stubExports = {
    safeLogError: async (params: SafeLogErrorParams): Promise<void> => {
      state.calls.push(params);
    },
  };

  requireCjs.cache[ERROR_LOGGER_PATH] = {
    id: ERROR_LOGGER_PATH,
    filename: ERROR_LOGGER_PATH,
    loaded: true,
    parent: null,
    children: [],
    exports: stubExports,
    paths: [],
  } as unknown as NodeJS.Module;
}

function uninstallErrorLoggerStub(): void {
  delete requireCjs.cache[ERROR_LOGGER_PATH];
  delete requireCjs.cache[TEXT_CAP_PATH];
}

function withNodeEnv<T>(env: string, fn: () => T): T {
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = env;
  try {
    return fn();
  } finally {
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
  }
}

describe('textCap handleAggregateInvariantViolation 動的 invocation (#299)', () => {
  let state: StubState;

  beforeEach(() => {
    state = { calls: [], throwOnLoad: false };
    installErrorLoggerStub(state);
  });

  afterEach(() => {
    uninstallErrorLoggerStub();
  });

  describe('prod 環境: safeLogError 呼出の動的検証', () => {
    it('invalid 入力で safeLogError が 1 回呼ばれる (callCount=1)', () => {
      // textCap を stub 反映後に require で再 load
      const textCap = requireCjs(TEXT_CAP_PATH) as typeof import('../src/utils/textCap');
      withNodeEnv('production', () => {
        const invalid = {
          text: 'short',
          truncated: false,
          originalLength: 999,
        } as unknown as SummaryField;
        textCap.capPageResultsAggregate([invalid]);
      });
      expect(state.calls).to.have.length(1);
    });

    it('引数 shape: source/functionName/error instanceof Error', () => {
      const textCap = requireCjs(TEXT_CAP_PATH) as typeof import('../src/utils/textCap');
      withNodeEnv('production', () => {
        const invalid = {
          text: 'short',
          truncated: false,
          originalLength: 999,
        } as unknown as SummaryField;
        textCap.capPageResultsAggregate([invalid]);
      });
      const call = state.calls[0];
      expect(call).to.exist;
      expect(call?.source).to.equal('ocr');
      expect(call?.functionName).to.equal('capPageResultsAggregate');
      expect(call?.error).to.be.instanceOf(Error);
      expect(call?.error.message).to.match(/invariant violation/);
    });

    it('context.documentId が safeLogError 引数に伝搬される', () => {
      const textCap = requireCjs(TEXT_CAP_PATH) as typeof import('../src/utils/textCap');
      withNodeEnv('production', () => {
        const invalid = {
          text: 'short',
          truncated: false,
          originalLength: 999,
        } as unknown as SummaryField;
        textCap.capPageResultsAggregate([invalid], { documentId: 'doc-dynamic-123' });
      });
      expect(state.calls[0]?.documentId).to.equal('doc-dynamic-123');
    });

    it('valid 入力では safeLogError が呼ばれない (false positive 防止)', () => {
      const textCap = requireCjs(TEXT_CAP_PATH) as typeof import('../src/utils/textCap');
      withNodeEnv('production', () => {
        const valid: SummaryField[] = [
          { text: 'v1', truncated: false },
          { text: 'v2', truncated: false },
        ];
        textCap.capPageResultsAggregate(valid);
      });
      expect(state.calls).to.have.length(0);
    });
  });

  describe('dev 環境: throw 維持 + safeLogError 呼ばれず', () => {
    it('dev + invalid → throw し safeLogError は呼ばれない (prod 分岐専用)', () => {
      const textCap = requireCjs(TEXT_CAP_PATH) as typeof import('../src/utils/textCap');
      // dev 環境 (NODE_ENV != production) で throw することを確認
      const invalid = {
        text: 'short',
        truncated: false,
        originalLength: 999,
      } as unknown as SummaryField;
      expect(() => textCap.capPageResultsAggregate([invalid])).to.throw(/invariant violation/);
      expect(state.calls).to.have.length(0);
    });
  });

  describe('errorLogger load 失敗時 console.error fallback (Codex S3)', () => {
    it('prod + require 失敗 + invalid → console.error `[textCap]` prefix', () => {
      // stub を load 失敗 mode で注入
      uninstallErrorLoggerStub();
      state = { calls: [], throwOnLoad: true };
      installErrorLoggerStub(state);

      const textCap = requireCjs(TEXT_CAP_PATH) as typeof import('../src/utils/textCap');
      const consoleErrorCalls: unknown[][] = [];
      const originalConsoleError = console.error;
      console.error = (...args: unknown[]) => {
        consoleErrorCalls.push(args);
      };
      try {
        withNodeEnv('production', () => {
          const invalid = {
            text: 'short',
            truncated: false,
            originalLength: 999,
          } as unknown as SummaryField;
          expect(() => textCap.capPageResultsAggregate([invalid])).to.not.throw();
        });
      } finally {
        console.error = originalConsoleError;
      }
      expect(consoleErrorCalls.length).to.be.at.least(1);
      const firstMessage = String(consoleErrorCalls[0]?.[0] ?? '');
      expect(firstMessage).to.match(/\[textCap\].*failed to load errorLogger/);
    });

    it('prod + require 失敗 + valid → console.error 呼ばれない (load path 未到達)', () => {
      uninstallErrorLoggerStub();
      state = { calls: [], throwOnLoad: true };
      installErrorLoggerStub(state);

      const textCap = requireCjs(TEXT_CAP_PATH) as typeof import('../src/utils/textCap');
      const consoleErrorCalls: unknown[][] = [];
      const originalConsoleError = console.error;
      console.error = (...args: unknown[]) => {
        consoleErrorCalls.push(args);
      };
      try {
        withNodeEnv('production', () => {
          const valid: SummaryField[] = [{ text: 'v1', truncated: false }];
          textCap.capPageResultsAggregate(valid);
        });
      } finally {
        console.error = originalConsoleError;
      }
      expect(consoleErrorCalls.length).to.equal(0);
    });
  });
});
