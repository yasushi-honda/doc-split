/**
 * withNodeEnv helper 単体テスト (#306 + PR #311 review I3 教訓先取り)
 *
 * contract test 側での間接検証では拾いきれない helper 固有の挙動 (undefined 完全復元、
 * throw 経路での復元、async 版) を直接 lock-in する。
 */

import { expect } from 'chai';
import { withNodeEnv, withNodeEnvAsync } from './withNodeEnv';

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
  });
});
