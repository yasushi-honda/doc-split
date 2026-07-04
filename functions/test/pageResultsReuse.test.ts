/**
 * pageResultsReuse.ts のテスト (Issue #526 D3)
 */

import { expect } from 'chai';
import { validatePageResultsForReuse } from '../src/ocr/pageResultsReuse';
import type { PageResultsReuseCheck } from '../src/ocr/pageResultsReuse';

const PARENT_ID = 'parent-doc-1';

function expectNotReusable(result: PageResultsReuseCheck, pattern: RegExp): void {
  expect(result.reusable).to.equal(false);
  if (result.reusable) {
    throw new Error('unreachable: result.reusable was expected to be false');
  }
  expect(result.reason).to.match(pattern);
}

describe('validatePageResultsForReuse', () => {
  it('parentDocumentIdありでpageNumberが1..Nの連番かつ全ページ非空テキストなら再利用可能', () => {
    const result = validatePageResultsForReuse(
      [
        { pageNumber: 1, text: 'page1 text' },
        { pageNumber: 2, text: 'page2 text' },
        { pageNumber: 3, text: 'page3 text' },
      ],
      PARENT_ID
    );
    expect(result.reusable).to.equal(true);
  });

  it('parentDocumentIdがundefinedの場合、構造が有効でも再利用不可(分割子ドキュメントでない)', () => {
    const result = validatePageResultsForReuse(
      [
        { pageNumber: 1, text: 'page1 text' },
        { pageNumber: 2, text: 'page2 text' },
      ],
      undefined
    );
    expectNotReusable(result, /not a split child/);
  });

  it('parentDocumentIdが空文字の場合、再利用不可', () => {
    const result = validatePageResultsForReuse([{ pageNumber: 1, text: 'page1 text' }], '');
    expectNotReusable(result, /not a split child/);
  });

  it('parentDocumentIdが文字列でない場合、再利用不可', () => {
    const result = validatePageResultsForReuse([{ pageNumber: 1, text: 'page1 text' }], 12345);
    expectNotReusable(result, /not a split child/);
  });

  it('pageResultsがundefinedの場合、再利用不可', () => {
    const result = validatePageResultsForReuse(undefined, PARENT_ID);
    expectNotReusable(result, /missing or empty/);
  });

  it('pageResultsが空配列の場合、再利用不可', () => {
    const result = validatePageResultsForReuse([], PARENT_ID);
    expectNotReusable(result, /missing or empty/);
  });

  it('pageResultsが配列でない場合、再利用不可', () => {
    const result = validatePageResultsForReuse('not-an-array', PARENT_ID);
    expectNotReusable(result, /missing or empty/);
  });

  it('pageNumberに欠番がある場合(1,3のみ)、再利用不可', () => {
    const result = validatePageResultsForReuse(
      [
        { pageNumber: 1, text: 'page1' },
        { pageNumber: 3, text: 'page3' },
      ],
      PARENT_ID
    );
    expectNotReusable(result, /sequential/);
  });

  it('pageNumberに重複がある場合(1,1,2)、再利用不可', () => {
    const result = validatePageResultsForReuse(
      [
        { pageNumber: 1, text: 'a' },
        { pageNumber: 1, text: 'b' },
        { pageNumber: 2, text: 'c' },
      ],
      PARENT_ID
    );
    expectNotReusable(result, /sequential/);
  });

  it('pageNumberの並び順が配列内で前後している場合、再利用不可(呼出元は配列を並び替えずそのまま使うため、ソートありきの判定は誤ったページ順でのOCR結果結合を招く)', () => {
    const result = validatePageResultsForReuse(
      [
        { pageNumber: 2, text: 'page2' },
        { pageNumber: 1, text: 'page1' },
        { pageNumber: 3, text: 'page3' },
      ],
      PARENT_ID
    );
    expectNotReusable(result, /in-order sequential/);
  });

  it('pageResultsにnull要素が混入している場合、例外を投げずreusable=falseを返す', () => {
    const result = validatePageResultsForReuse([{ pageNumber: 1, text: 'page1' }, null], PARENT_ID);
    expectNotReusable(result, /not objects/);
  });

  it('pageResultsに非オブジェクト要素(文字列)が混入している場合、例外を投げずreusable=falseを返す', () => {
    const result = validatePageResultsForReuse(
      [{ pageNumber: 1, text: 'page1' }, 'not-an-object'],
      PARENT_ID
    );
    expectNotReusable(result, /not objects/);
  });

  it('pageNumberが数値でない場合、再利用不可', () => {
    const result = validatePageResultsForReuse([{ pageNumber: '1', text: 'page1' }], PARENT_ID);
    expectNotReusable(result, /sequential/);
  });

  it('1件だけのpageResults(pageNumber=1)は正しく再利用可能と判定される', () => {
    const result = validatePageResultsForReuse([{ pageNumber: 1, text: 'single page' }], PARENT_ID);
    expect(result.reusable).to.equal(true);
  });

  it('いずれかのページのtextが空文字の場合、再利用不可', () => {
    const result = validatePageResultsForReuse(
      [
        { pageNumber: 1, text: 'page1' },
        { pageNumber: 2, text: '' },
      ],
      PARENT_ID
    );
    expectNotReusable(result, /empty text/);
  });

  it('いずれかのページのtextが空白のみの場合、再利用不可', () => {
    const result = validatePageResultsForReuse(
      [
        { pageNumber: 1, text: 'page1' },
        { pageNumber: 2, text: '   ' },
      ],
      PARENT_ID
    );
    expectNotReusable(result, /empty text/);
  });

  it('textフィールドが欠落している場合、再利用不可', () => {
    const result = validatePageResultsForReuse([{ pageNumber: 1 }], PARENT_ID);
    expectNotReusable(result, /empty text/);
  });

  it('textが文字列でない場合、再利用不可', () => {
    const result = validatePageResultsForReuse([{ pageNumber: 1, text: 123 }], PARENT_ID);
    expectNotReusable(result, /empty text/);
  });
});
