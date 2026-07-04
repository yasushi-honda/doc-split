/**
 * pageResultsReuse.ts のテスト (Issue #526 D3)
 */

import { expect } from 'chai';
import { validatePageResultsForReuse } from '../src/ocr/pageResultsReuse';

const PARENT_ID = 'parent-doc-1';

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
    expect(result.reusable).to.equal(false);
    expect(result.reason).to.match(/not a split child/);
  });

  it('parentDocumentIdが空文字の場合、再利用不可', () => {
    const result = validatePageResultsForReuse(
      [{ pageNumber: 1, text: 'page1 text' }],
      ''
    );
    expect(result.reusable).to.equal(false);
    expect(result.reason).to.match(/not a split child/);
  });

  it('parentDocumentIdが文字列でない場合、再利用不可', () => {
    const result = validatePageResultsForReuse(
      [{ pageNumber: 1, text: 'page1 text' }],
      12345
    );
    expect(result.reusable).to.equal(false);
    expect(result.reason).to.match(/not a split child/);
  });

  it('pageResultsがundefinedの場合、再利用不可', () => {
    const result = validatePageResultsForReuse(undefined, PARENT_ID);
    expect(result.reusable).to.equal(false);
    expect(result.reason).to.match(/missing or empty/);
  });

  it('pageResultsが空配列の場合、再利用不可', () => {
    const result = validatePageResultsForReuse([], PARENT_ID);
    expect(result.reusable).to.equal(false);
    expect(result.reason).to.match(/missing or empty/);
  });

  it('pageResultsが配列でない場合、再利用不可', () => {
    const result = validatePageResultsForReuse('not-an-array', PARENT_ID);
    expect(result.reusable).to.equal(false);
    expect(result.reason).to.match(/missing or empty/);
  });

  it('pageNumberに欠番がある場合(1,3のみ)、再利用不可', () => {
    const result = validatePageResultsForReuse(
      [
        { pageNumber: 1, text: 'page1' },
        { pageNumber: 3, text: 'page3' },
      ],
      PARENT_ID
    );
    expect(result.reusable).to.equal(false);
    expect(result.reason).to.match(/sequential/);
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
    expect(result.reusable).to.equal(false);
    expect(result.reason).to.match(/sequential/);
  });

  it('pageNumberの並び順が入力配列内で前後していても、ソート後に連番なら再利用可能', () => {
    const result = validatePageResultsForReuse(
      [
        { pageNumber: 2, text: 'page2' },
        { pageNumber: 1, text: 'page1' },
        { pageNumber: 3, text: 'page3' },
      ],
      PARENT_ID
    );
    expect(result.reusable).to.equal(true);
  });

  it('pageNumberが数値でない場合、再利用不可', () => {
    const result = validatePageResultsForReuse(
      [{ pageNumber: '1', text: 'page1' }],
      PARENT_ID
    );
    expect(result.reusable).to.equal(false);
    expect(result.reason).to.match(/sequential/);
  });

  it('1件だけのpageResults(pageNumber=1)は正しく再利用可能と判定される', () => {
    const result = validatePageResultsForReuse(
      [{ pageNumber: 1, text: 'single page' }],
      PARENT_ID
    );
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
    expect(result.reusable).to.equal(false);
    expect(result.reason).to.match(/empty text/);
  });

  it('いずれかのページのtextが空白のみの場合、再利用不可', () => {
    const result = validatePageResultsForReuse(
      [
        { pageNumber: 1, text: 'page1' },
        { pageNumber: 2, text: '   ' },
      ],
      PARENT_ID
    );
    expect(result.reusable).to.equal(false);
    expect(result.reason).to.match(/empty text/);
  });

  it('textフィールドが欠落している場合、再利用不可', () => {
    const result = validatePageResultsForReuse([{ pageNumber: 1 }], PARENT_ID);
    expect(result.reusable).to.equal(false);
    expect(result.reason).to.match(/empty text/);
  });

  it('textが文字列でない場合、再利用不可', () => {
    const result = validatePageResultsForReuse(
      [{ pageNumber: 1, text: 123 }],
      PARENT_ID
    );
    expect(result.reusable).to.equal(false);
    expect(result.reason).to.match(/empty text/);
  });
});
