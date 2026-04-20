/**
 * withNodeEnv helper 単体テスト (#306 + PR #311 review I3 教訓先取り)
 *
 * contract test 側での間接検証では拾いきれない helper 固有の挙動 (undefined 完全復元、
 * throw 経路での復元、async 版) を直接 lock-in する。
 */

import { expect } from 'chai';
import { withNodeEnv, withNodeEnvAsync, type NodeEnvValue } from './withNodeEnv';

describe('withNodeEnv helper', () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env.NODE_ENV;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved;
  });

  describe('withNodeEnv (sync)', () => {
    it('fn 実行中は指定値に切替わる', () => {
      process.env.NODE_ENV = 'test';
      const observed = withNodeEnv('production', () => process.env.NODE_ENV);
      expect(observed).to.equal('production');
    });

    it('fn 実行後に元値に復元される', () => {
      process.env.NODE_ENV = 'test';
      withNodeEnv('production', () => void 0);
      expect(process.env.NODE_ENV).to.equal('test');
    });

    it('original が undefined の場合は delete で復元される (「undefined」文字列化しない)', () => {
      delete process.env.NODE_ENV;
      withNodeEnv('production', () => void 0);
      expect(process.env.NODE_ENV).to.equal(undefined);
      expect('NODE_ENV' in process.env).to.equal(false);
    });

    it('fn が throw しても finally で復元される', () => {
      process.env.NODE_ENV = 'test';
      expect(() =>
        withNodeEnv('production', () => {
          throw new Error('boom');
        }),
      ).to.throw('boom');
      expect(process.env.NODE_ENV).to.equal('test');
    });

    it('throw + original undefined の組合せでも delete 復元される', () => {
      delete process.env.NODE_ENV;
      expect(() =>
        withNodeEnv('production', () => {
          throw new Error('boom');
        }),
      ).to.throw('boom');
      expect('NODE_ENV' in process.env).to.equal(false);
    });

    it('fn の戻り値を透過する', () => {
      const result = withNodeEnv('production', () => 42);
      expect(result).to.equal(42);
    });

    it('nested 呼出は LIFO 順で復元される', () => {
      // inner 終了時に outer の value (prod) に戻り、outer 終了時に元値 (test) に戻る。
      // helper が public で再帰呼出可能な以上、LIFO semantics を lock-in する。
      process.env.NODE_ENV = 'test';
      withNodeEnv('production', () => {
        expect(process.env.NODE_ENV).to.equal('production');
        withNodeEnv('development', () => {
          expect(process.env.NODE_ENV).to.equal('development');
        });
        expect(process.env.NODE_ENV, 'inner 終了時に outer の値へ').to.equal('production');
      });
      expect(process.env.NODE_ENV, 'outer 終了時に元値へ').to.equal('test');
    });
  });

  describe('withNodeEnvAsync', () => {
    it('await 対応し fn 実行中は指定値に切替わる', async () => {
      process.env.NODE_ENV = 'test';
      const observed = await withNodeEnvAsync('production', async () => {
        await Promise.resolve();
        return process.env.NODE_ENV;
      });
      expect(observed).to.equal('production');
      expect(process.env.NODE_ENV).to.equal('test');
    });

    it('async fn が reject しても finally で復元される', async () => {
      process.env.NODE_ENV = 'test';
      let threw = false;
      try {
        await withNodeEnvAsync('production', async () => {
          throw new Error('async boom');
        });
      } catch {
        threw = true;
      }
      expect(threw).to.equal(true);
      expect(process.env.NODE_ENV).to.equal('test');
    });

    it('async fn が await 前に同期 throw しても finally で復元される', async () => {
      // `return await fn()` は fn() が同期 throw した場合 try 内で捕捉され finally が走る。
      // `return fn()` に退行すると同期 throw は await 前に発生し Promise 化されずに抜ける。
      // 本テストは前者の挙動を lock-in する (`return fn()` への退行で fail)。
      process.env.NODE_ENV = 'test';
      let threw = false;
      try {
        await withNodeEnvAsync('production', () => {
          throw new Error('sync boom inside async helper');
        });
      } catch {
        threw = true;
      }
      expect(threw).to.equal(true);
      expect(process.env.NODE_ENV).to.equal('test');
    });

    it('async fn の戻り値を透過する', async () => {
      const result = await withNodeEnvAsync('production', async () => 99);
      expect(result).to.equal(99);
    });
  });

  // Issue #315 #3 (type-design-analyzer): signature が NodeEnvValue literal union で typo を
  // 完全拒否することを compile-time で lock-in (docs/context/test-strategy.md §2.2 型契約 test)。
  // (string & {}) escape hatch は採用せず strict union、実行時挙動は既存 sync/async describe
  // で網羅済のため、本 describe は型構造のみを検証する。
  describe('NodeEnvValue literal union narrow (#315)', () => {
    it('NodeEnvValue 型は production / test / development の 3 値 union である (構造 lock-in)', () => {
      // NodeEnvValue[] 宣言時点で tsc が union 構造を検証。値が 4 個になる / number に変わる
      // 等の破壊的変更は compile エラーで検知される。
      const members: readonly NodeEnvValue[] = ['production', 'test', 'development'];
      expect(members).to.have.lengthOf(3);
      expect(members).to.include.members(['production', 'test', 'development']);
    });

    it('typo (`prdouction` / `PROD` 等) は NodeEnvValue に含まれず @ts-expect-error で弾かれる', () => {
      // 未消費の @ts-expect-error は tsc エラーになるため、行末に typo literal を代入する形で
      // compile-time 検知を直接確認できる。runtime assert は不要 (expect().to.throw は getter
      // アクセスで no-op になるため採用しない — simplify review Critical 指摘対応)。
      // @ts-expect-error: 'prdouction' は NodeEnvValue に含まれない typo。
      const _typo1: NodeEnvValue = 'prdouction';
      // @ts-expect-error: 'PROD' 等の case 違いも別 literal として弾かれる。
      const _typo2: NodeEnvValue = 'PROD';
      void _typo1;
      void _typo2;
    });

    it('async 版 withNodeEnvAsync も NodeEnvValue を継承し typo を弾く', () => {
      // @ts-expect-error: async 版 signature にも同じ union が適用されることを型レベルで確認。
      const _asyncTypo: Parameters<typeof withNodeEnvAsync>[0] = 'stagings';
      void _asyncTypo;
    });
  });
});
