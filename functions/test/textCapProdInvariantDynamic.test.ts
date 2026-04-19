/**
 * textCap assertAggregatePageInvariant の prod observability 動的 invocation テスト (#288 item 1)
 *
 * grep contract (textCapProdInvariantContract.test.ts) と二段 lock-in:
 * - grep: shape (token 存在) + anchor 保護
 * - runtime (本 test): 条件分岐 reversal / callCount / 引数 propagation / console.error fallback
 *
 * mocha は default で file 内逐次実行のため module cache 差し替えは安全。並列実行を有効化する場合は
 * 本ファイルを分離必須（cache は Node global singleton）。
 */

import { expect } from 'chai';
import { createRequire } from 'module';
import type { SummaryField } from '../../shared/types';

// ts-node ESM モードで CJS require を得るため createRequire を使用。
// cache は Node 内部と同一参照のため stub が textCap.ts 内部の dynamic require に反映される。
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
 * requireCjs.cache に errorLogger の stub module を注入する。
 * `state.throwOnLoad=true` の場合は require 時に throw (console.error fallback path 検証用)。
 * accessor/data どちらも `delete` で除去可能なので cleanup は単一経路で OK。
 */
function installErrorLoggerStub(state: StubState): void {
  // 前回テストの cache 残留を除去（stub 反映 & 新規 load 誘発）
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
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = env;
  try {
    return fn();
  } finally {
    // original が undefined のとき代入すると文字列 'undefined' に coerce されるため delete で復元
    if (original === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = original;
    }
  }
}

describe('textCap prod invariant dynamic invocation (#288 item 1)', () => {
  let state: StubState;

  afterEach(() => {
    uninstallErrorLoggerStub();
  });

  describe('production 分岐の safeLogError 動的検証', () => {
    beforeEach(() => {
      state = { calls: [], throwOnLoad: false };
      installErrorLoggerStub(state);
    });

    it('prod + invalid page で safeLogError が callCount=1 で呼ばれる', () => {
      // 新規 load された textCap を取得 (stub を反映)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { capPageResultsAggregate } = requireCjs('../src/utils/textCap') as typeof import('../src/utils/textCap');

      const invalidPage = {
        text: 'short',
        truncated: false,
        originalLength: 999_999,
      } as unknown as SummaryField;

      withNodeEnv('production', () => {
        expect(() => capPageResultsAggregate([invalidPage])).to.not.throw();
      });

      expect(state.calls.length).to.equal(1);
    });

    it('prod + invalid page の safeLogError 引数に source:"ocr" / functionName:"capPageResultsAggregate" / error 含有', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { capPageResultsAggregate } = requireCjs('../src/utils/textCap') as typeof import('../src/utils/textCap');

      const invalidPage = {
        text: 'short',
        truncated: false,
        originalLength: 999_999,
      } as unknown as SummaryField;

      withNodeEnv('production', () => {
        capPageResultsAggregate([invalidPage]);
      });

      expect(state.calls.length).to.be.at.least(1);
      const call = state.calls[0];
      expect(call?.source).to.equal('ocr');
      expect(call?.functionName).to.equal('capPageResultsAggregate');
      expect(call?.error).to.be.instanceOf(Error);
      expect(call?.error.message).to.match(/capPageResultsAggregate invariant violation/);
    });

    it('prod + context.documentId 指定時に safeLogError 引数へ伝搬され、単一 emit される', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { capPageResultsAggregate } = requireCjs('../src/utils/textCap') as typeof import('../src/utils/textCap');

      const invalidPage = {
        text: 'short',
        truncated: false,
        originalLength: 999_999,
      } as unknown as SummaryField;

      withNodeEnv('production', () => {
        capPageResultsAggregate([invalidPage], { documentId: 'doc-xyz-123' });
      });

      // silent-failure-hunter S2 + Codex: 伝搬 propagation を assertion、
      // かつ二重 emit mutation を length 固定で捕捉
      expect(state.calls.length).to.equal(1);
      expect(state.calls[0]?.documentId).to.equal('doc-xyz-123');
    });

    it('prod + valid page では safeLogError は呼ばれない (false positive 防止)', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { capPageResultsAggregate } = requireCjs('../src/utils/textCap') as typeof import('../src/utils/textCap');

      const validPages: SummaryField[] = [
        { text: 'short1', truncated: false },
        { text: 'short2', truncated: false },
      ];

      withNodeEnv('production', () => {
        capPageResultsAggregate(validPages);
      });

      expect(state.calls.length).to.equal(0);
    });

    it('dev + invalid page では safeLogError は呼ばれず throw する (prod 分岐のみ emit)', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { capPageResultsAggregate } = requireCjs('../src/utils/textCap') as typeof import('../src/utils/textCap');

      const invalidPage = {
        text: 'short',
        truncated: false,
        originalLength: 999_999,
      } as unknown as SummaryField;

      withNodeEnv('development', () => {
        expect(() => capPageResultsAggregate([invalidPage])).to.throw(/invariant violation/);
      });

      expect(state.calls.length).to.equal(0);
    });
  });

  describe('errorLogger load 失敗時の console.error fallback', () => {
    // console.error を一時 spy 化し、args を取得して復元する helper
    function withConsoleErrorSpy<T>(fn: (calls: unknown[][]) => T): T {
      const original = console.error;
      const calls: unknown[][] = [];
      console.error = (...args: unknown[]): void => {
        calls.push(args);
      };
      try {
        return fn(calls);
      } finally {
        console.error = original;
      }
    }

    it('prod + errorLogger require 失敗 + invalid page → console.error ([textCap] prefix + invariant message) で fallback', () => {
      state = { calls: [], throwOnLoad: true };
      installErrorLoggerStub(state);

      const errorCalls = withConsoleErrorSpy((calls) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { capPageResultsAggregate } = requireCjs('../src/utils/textCap') as typeof import('../src/utils/textCap');

        const invalidPage = {
          text: 'short',
          truncated: false,
          originalLength: 999_999,
        } as unknown as SummaryField;

        withNodeEnv('production', () => {
          expect(() => capPageResultsAggregate([invalidPage])).to.not.throw();
        });
        return calls;
      });

      // prefix
      expect(errorCalls.length).to.be.at.least(1);
      const firstCall = errorCalls[0] ?? [];
      expect(String(firstCall[0] ?? '')).to.match(/\[textCap\]/);
      // message 引数 drop regression 捕捉: 引数いずれかに invariant violation 文字列が含まれる
      const joined = firstCall.map((a) => String(a)).join(' | ');
      expect(joined).to.match(/invariant violation/);
    });

    // pr-test-analyzer Important #1: valid path で fallback が発火しない対称テスト。
    // try/catch が prod 分岐外に hoist された mutation を捕捉。
    it('prod + errorLogger require 失敗 + valid page → console.error が呼ばれない (false positive 防止)', () => {
      state = { calls: [], throwOnLoad: true };
      installErrorLoggerStub(state);

      const errorCalls = withConsoleErrorSpy((calls) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { capPageResultsAggregate } = requireCjs('../src/utils/textCap') as typeof import('../src/utils/textCap');

        const validPages: SummaryField[] = [{ text: 'short', truncated: false }];

        withNodeEnv('production', () => {
          capPageResultsAggregate(validPages);
        });
        return calls;
      });

      expect(errorCalls.length).to.equal(0);
    });
  });
});
