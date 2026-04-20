/**
 * RawPageOcrResult 型不変条件テスト (Issue #267, #258, #278 follow-up)
 *
 * 目的: RawPageOcrResult = SummaryField & { pageNumber, inputTokens, outputTokens } の
 * discriminated union 不変条件を @ts-expect-error で lock-in する。
 *
 * 背景 (#258 pr-test-analyzer I2): PR #265 で「truncated=false では originalLength は型に存在しない」
 * ことを AC で宣言したが、将来 RawPageOcrResult の型表現が崩れた場合 (例: truncated を optional 化、
 * originalLength を両 variant で optional 化) に検知する静的契約が無かった。
 *
 * 命名 (#278): 旧名 PageOcrResult は shared/types.ts の post-processed `PageOcrResult`
 * (PageOcrMeta & SummaryField) と衝突していたため RawPageOcrResult にリネームした。
 *
 * 方式: `@ts-expect-error` 型契約 test (docs/context/test-strategy.md §2.2 参照)。
 * tsc --noEmit で compile エラーを期待する行に @ts-expect-error を置き、
 * 将来 discriminated union が崩れたら @ts-expect-error 自体が "unused directive" エラーになる。
 *
 * 将来委譲: 現時点で委譲先なし (RawPageOcrResult discriminated union 不変条件は
 *          型レベル保護が本質のため恒久 contract として保持)
 */

import { expect } from 'chai';
import type { RawPageOcrResult } from '../../src/ocr/buildPageResult';

describe('RawPageOcrResult 型不変条件 (#267, #278)', () => {
  it('truncated=false では originalLength が型に存在しない (@ts-expect-error で lock-in)', () => {
    const page: RawPageOcrResult = {
      pageNumber: 1,
      text: 'short',
      truncated: false,
      inputTokens: 10,
      outputTokens: 20,
    };
    // @ts-expect-error: truncated=false variant では originalLength は型に存在しない (#258 discriminated union 不変条件)
    void page.originalLength;
    expect(page.truncated).to.equal(false);
  });

  it('truncated=true では originalLength が必須', () => {
    const page: RawPageOcrResult = {
      pageNumber: 2,
      text: 'truncated',
      truncated: true,
      originalLength: 100_000,
      inputTokens: 10,
      outputTokens: 20,
    };
    expect(page.truncated).to.equal(true);
    // truncated=true variant では originalLength は型に存在する (access OK)
    expect(page.originalLength).to.equal(100_000);
  });
});
