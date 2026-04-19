/**
 * textCap assertAggregatePageInvariant の prod observability 動的 invocation テスト (#288 item 1)
 *
 * 目的: Phase 2 (PR #296) で導入した grep-based contract を runtime 挙動で補強する。
 * grep は shape を lock-in するが、条件分岐 reversal や helper 未使用回帰を runtime で
 * 検知できないため、動的 mock を用いて safeLogError 呼出の事実と引数を直接検証する。
 *
 * 手法:
 * - `requireCjs.cache` 差し替えで `../src/utils/errorLogger` module を stub 化 (sinon/proxyquire
 *   等の追加依存なし)
 * - prod / dev / fallback 各経路を runtime 実行し callCount / args を検証
 * - afterEach で module cache を clean up し他 test への漏洩を防止
 *
 * Phase 2 grep contract (textCapProdInvariantContract.test.ts) との二段 lock-in:
 * - grep: shape (token 存在)、anchor 保護
 * - runtime (本 test): 条件分岐 reversal 検知、callCount、引数 shape
 */

import { expect } from 'chai';
import { createRequire } from 'module';
import type { SummaryField } from '../../shared/types';

// ts-node の ESM モードで require を使うため createRequire 経由で取得。
// Node.js module cache は global singleton のため、requireCjs.cache と Node 内部の
// requireCjs.cache は同一 object を参照し、本 test で注入した stub は textCap.ts 内部の
// dynamic require(...) にも反映される。
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
 * `stubState.throwOnLoad=true` の場合は require 時に throw (console.error fallback path 検証用)。
 */
function installErrorLoggerStub(state: StubState): void {
  // stub 注入前に既存 cache を除去 (他 test で load 済みの場合を考慮)
  delete requireCjs.cache[ERROR_LOGGER_PATH];
  // textCap.ts も cache から外して「次の require で新規 load させる」
  delete requireCjs.cache[TEXT_CAP_PATH];

  if (state.throwOnLoad) {
    // require 時に throw させるため getter を介して exports を提供
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
  // getter 形式も delete で両対応
  delete requireCjs.cache[ERROR_LOGGER_PATH];
  delete requireCjs.cache[TEXT_CAP_PATH];
}

function withNodeEnv<T>(env: string, fn: () => T): T {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = env;
  try {
    return fn();
  } finally {
    process.env.NODE_ENV = original;
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

    it('prod + context.documentId 指定時に safeLogError 引数へ伝搬される (silent-failure-hunter S2)', () => {
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

  describe('errorLogger load 失敗時の console.error fallback (Codex S3)', () => {
    it('prod + errorLogger require 失敗時に console.error ([textCap] prefix) で fallback', () => {
      state = { calls: [], throwOnLoad: true };
      installErrorLoggerStub(state);

      // console.error を spy 化
      const originalConsoleError = console.error;
      const errorCalls: unknown[][] = [];
      console.error = (...args: unknown[]): void => {
        errorCalls.push(args);
      };

      try {
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

        // console.error が [textCap] prefix で呼ばれていること
        expect(errorCalls.length).to.be.at.least(1);
        const firstCall = errorCalls[0];
        expect(String(firstCall?.[0] ?? '')).to.match(/\[textCap\]/);
      } finally {
        console.error = originalConsoleError;
      }
    });
  });
});
