/**
 * ocrProcessor.ts の pageResults再利用(D3)配線契約テスト (Issue #526)
 *
 * `validatePageResultsForReuse()`自体はpageResultsReuse.test.tsで純粋関数として
 * 検証済みだが、ocrProcessor.ts側が実際にこの関数を呼び出し、戻り値で正しく
 * 分岐しているかは別問題(呼出漏れ・分岐条件のtypoはtscで検知できない)。
 * 本テストはこの配線をソース文字列レベルでlock-inする
 * (`ocrProcessorConfirmedFieldWiringContract.test.ts`が同種の前例)。
 */

import { expect } from 'chai';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('ocrProcessor pageResultsReuse wiring contract (Issue #526 D3)', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/ocr/ocrProcessor.ts'), 'utf-8');

  it('validatePageResultsForReuseがdocData.pageResults/parentDocumentIdを引数に呼ばれる', () => {
    expect(source).to.include(
      'validatePageResultsForReuse(existingPageResults, docData.parentDocumentId)'
    );
  });

  it('reusable=trueの分岐でexistingPageResultsをpageResults/totalPagesへ反映しページOCRをスキップする', () => {
    const reuseBranchMatch = source.match(
      /if \(reuseCheck\.reusable && existingPageResults\) \{([\s\S]*?)\} else \{/
    );
    expect(reuseBranchMatch, 'reuse branch (if reuseCheck.reusable && existingPageResults) not found')
      .to.not.equal(null);
    const branchBody = reuseBranchMatch![1];
    expect(branchBody).to.include('pageResults = existingPageResults');
    expect(branchBody).to.include('totalPages = existingPageResults.length');
  });

  it('reusable=falseの分岐は既存のダウンロード+ページ単位OCRループへフォールバックする', () => {
    const elseIndex = source.indexOf('} else {', source.indexOf('validatePageResultsForReuse('));
    expect(elseIndex).to.be.greaterThan(-1);
    const afterElse = source.slice(elseIndex, elseIndex + 2000);
    expect(afterElse).to.include('bucket.file(filePath)');
    expect(afterElse).to.include('PDFDocument.load(buffer)');
  });
});
