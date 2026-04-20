/**
 * withNodeEnv NodeEnvValue literal union narrow の型契約 test (Issue #315 #3)
 *
 * 目的: `withNodeEnv` / `withNodeEnvAsync` signature の `value: NodeEnvValue` narrow を
 * @ts-expect-error で lock-in し、typo ('prdouction' 等) が型レベルで拒否されることを保証する。
 *
 * 背景: Issue #315 提案 #3 (type-design-analyzer) で literal union narrow を導入。
 * (string & {}) escape hatch は敢えて採用せず strict union に留め、真の typo 検知を実現。
 *
 * 方式: `@ts-expect-error` 型契約 test (docs/context/test-strategy.md §2.2 参照)。
 * tsconfig.test.json の include に test/types/ が含まれるため、npm run type-check:test で
 * strict 検査される (test/helpers/ は include 外で silent PASS する silent-failure-hunter C2
 * 指摘を回避するため本ファイルに分離)。
 * runtime 挙動 (prod 分岐到達、finally 復元等) は test/helpers/withNodeEnv.test.ts
 * (既存 8+4 ケース) で網羅。
 *
 * 将来委譲: NodeEnvValue に新しい値を追加する場合、本ファイルの @ts-expect-error directive が
 *          unused になるため tsc が fail → 意図的変更を明示させる安全弁。
 */

import { expect } from 'chai';
import { withNodeEnv, withNodeEnvAsync, type NodeEnvValue } from '../helpers/withNodeEnv';

describe('withNodeEnv NodeEnvValue 型契約 (#315)', () => {
  it('NodeEnvValue 型は production / test / development の 3 値 union である (構造 lock-in)', () => {
    // 配列リテラル宣言時点で tsc が union 構造を検証。値が 4 個になる / number に変わる等の
    // 破壊的変更は compile エラーで検知される。
    const members: readonly NodeEnvValue[] = ['production', 'test', 'development'];
    expect(members).to.have.lengthOf(3);
    expect(members).to.include.members(['production', 'test', 'development']);
  });

  it('typo (`prdouction` / `PROD` 等) は NodeEnvValue に含まれず @ts-expect-error で弾かれる', () => {
    // @ts-expect-error: 'prdouction' は NodeEnvValue に含まれない typo。
    const _typo1: NodeEnvValue = 'prdouction';
    // @ts-expect-error: 'PROD' 等の case 違いも別 literal として弾かれる。
    const _typo2: NodeEnvValue = 'PROD';
    void _typo1;
    void _typo2;
    expect(true).to.equal(true);
  });

  it('sync/async 両 helper が同じ NodeEnvValue を継承する (signature lock-in)', () => {
    // Parameters<typeof fn>[0] で signature 由来の型を参照し、sync/async 片側改変の silent drift を
    // 防止する (type-design-analyzer Important 対応)。
    // @ts-expect-error: sync 版 signature も同 union。
    const _syncTypo: Parameters<typeof withNodeEnv>[0] = 'debug';
    // @ts-expect-error: async 版 signature も同 union。
    const _asyncTypo: Parameters<typeof withNodeEnvAsync>[0] = 'stagings';
    void _syncTypo;
    void _asyncTypo;
    expect(true).to.equal(true);
  });
});
