/**
 * Functions 読者の detail/main 切替 配線契約テスト (ADR-0018 Phase D PR-D2, Issue #547)
 *
 * ocrProcessorDetailDualWriteContract.test.ts と同じ grep-based 契約パターン。
 * 「4読者すべてが resolveDetailFields (detail優先+親フォールバック) 経由で
 * ocrResult/pageResults を読む」配線をソース文字列レベルで lock-in する。
 *
 * 1読者でも切替が漏れると、Phase E (親からの実フィールド削除) 後にその読者が
 * 空データを受け取り、silent な機能停止 (分割候補0件/要約不可/再利用不成立) が起きる。
 */

import { expect } from 'chai';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf-8');

const getOcrTextSrc = read('src/ocr/getOcrText.ts');
const regenerateSummarySrc = read('src/ocr/regenerateSummary.ts');
const ocrProcessorSrc = read('src/ocr/ocrProcessor.ts');
const pdfOperationsSrc = read('src/pdf/pdfOperations.ts');

describe('detail/main 読者切替 配線契約 (ADR-0018 Phase D PR-D2)', () => {
  it('getOcrText: read-only transaction の tx.getAll で親+detailを同一スナップショット読みする (ADR #5)', () => {
    expect(getOcrTextSrc).to.match(
      /db\.runTransaction\(\s*async \(tx\) => tx\.getAll\(docRef, detailRef\),\s*\{ readOnly: true \}\s*\)/
    );
    expect(getOcrTextSrc).to.match(/resolveDetailFields\(detailSnap\.data\(\), data\)/);
  });

  it('regenerateSummary: 同上の transactional paired-read (ADR #6)', () => {
    expect(regenerateSummarySrc).to.match(
      /db\.runTransaction\(\s*async \(tx\) => tx\.getAll\(docRef, detailRef\),\s*\{ readOnly: true \}\s*\)/
    );
    expect(regenerateSummarySrc).to.match(/resolveDetailFields\(detailSnap\.data\(\), docData\)/);
  });

  it('ocrProcessor: pageResultsReuse の読込元が detail 優先 (ADR #1)', () => {
    expect(ocrProcessorSrc).to.match(
      /const existingPageResults = resolveDetailFields\(detailSnap\.data\(\), docData\)\.pageResults/
    );
    // 旧経路 (docData.pageResults 直読み) が reuse 判定に残っていないこと
    expect(ocrProcessorSrc).to.not.match(
      /const existingPageResults = docData\.pageResults/
    );
  });

  it('pdfOperations: detectSplitPoints / splitPdf とも db.getAll(docRef, detailRef) の同一時点読み (ADR #2,#3)', () => {
    const getAllCount = [...pdfOperationsSrc.matchAll(/db\.getAll\(docRef, detailRef\)/g)].length;
    expect(getAllCount, 'detectSplitPoints と splitPdf の2箇所').to.equal(2);
    // 旧経路 (docData.pageResults 直読み) が残っていないこと
    expect(pdfOperationsSrc).to.not.match(/docData\.pageResults/);
  });

  it('Phase E 前提ゲート(部分): 本PRの4読者ソースに親 ocrResult/pageResults の直読みが残っていない', () => {
    // getOcrText/regenerateSummary の親 ocrResult 直読み(`data.ocrResult` / `docData.ocrResult`)が
    // resolveDetailFields 経由に置き換わっていること。
    // (ocrResultUrl は Phase E 後も親に残る offload ポインタのため対象外)
    expect(getOcrTextSrc).to.not.match(/data\.ocrResult as string/);
    expect(regenerateSummarySrc).to.not.match(/docData\.ocrResult as string/);
  });
});
