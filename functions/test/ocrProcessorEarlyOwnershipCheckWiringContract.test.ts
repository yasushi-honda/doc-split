/**
 * ocrProcessor.ts の PDFページOCRループ早期所有権チェック配線契約テスト (Issue #626)
 *
 * supersededされたOCR runが、残りページのGemini API呼出しを消費し切ってから最終
 * transactionで初めて破棄される無駄を防ぐため、PDFページOCRループの各イテレーション
 * 開始時(Gemini呼出し前)に checkOcrRunStillOwned を挟んでいる。
 * processDocument自体はStorage/Gemini副作用が大きく直接呼び出せないため
 * (ocrRunGuardIntegration.test.ts / ocrProcessorOcrResultCleanupWiringContract.test.ts と
 * 同方針)、配線自体はソース文字列レベルでlock-inし、判定ロジック(checkOcrRunStillOwned
 * 自体)の実際の動作は ocrRunGuardIntegration.test.ts (emulator) で検証する。
 *
 * Issue #622 教訓: grep anchor をファイル全体に対して緩く書くと vacuous になりうるため、
 * PDFページループのブロックのみを extractBraceBlock で抽出してからマッチさせる。
 */

import { expect } from 'chai';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { extractBraceBlock } from './helpers/extractBraceBlock';

const OCR_PROCESSOR_PATH = 'src/ocr/ocrProcessor.ts';
const PROCESS_DOCUMENT_ANCHOR = /export\s+async\s+function\s+processDocument\s*\(/;
const PDF_PAGE_LOOP_ANCHOR = /for\s*\(\s*let\s+i\s*=\s*0\s*;\s*i\s*<\s*totalPages\s*;\s*i\+\+\s*\)/;
const CHECK_FN_ANCHOR = /export\s+async\s+function\s+checkOcrRunStillOwned\s*\(/;

function expectSingleDefinition(source: string, pattern: RegExp, label: string): void {
  const count = (source.match(pattern) ?? []).length;
  expect(count, `${label} の定義が複数存在する場合は anchor の narrow が必要`).to.equal(1);
}

describe('ocrProcessor PDFページOCRループ早期所有権チェック配線契約 (Issue #626)', () => {
  let pdfPageLoopBody = '';
  let checkFunctionBody = '';

  before(() => {
    const absPath = resolve(process.cwd(), OCR_PROCESSOR_PATH);
    const source = readFileSync(absPath, 'utf-8');

    expectSingleDefinition(
      source,
      /export\s+async\s+function\s+processDocument\s*\(/g,
      'processDocument'
    );
    const processDocumentBody = extractBraceBlock(source, PROCESS_DOCUMENT_ANCHOR);
    expect(processDocumentBody, 'processDocument 関数本体の抽出に失敗した').to.not.be.null;

    expectSingleDefinition(processDocumentBody!, /for\s*\(\s*let\s+i\s*=\s*0/g, 'PDFページループ');
    const loopBody = extractBraceBlock(processDocumentBody, PDF_PAGE_LOOP_ANCHOR, {
      anchorMode: 'after-match',
    });
    expect(loopBody, 'PDFページループ本体の抽出に失敗した').to.not.be.null;
    pdfPageLoopBody = loopBody!;

    expectSingleDefinition(
      source,
      /export\s+async\s+function\s+checkOcrRunStillOwned\s*\(/g,
      'checkOcrRunStillOwned'
    );
    const checkBody = extractBraceBlock(source, CHECK_FN_ANCHOR);
    expect(checkBody, 'checkOcrRunStillOwned 関数本体の抽出に失敗した').to.not.be.null;
    checkFunctionBody = checkBody!;
  });

  it('checkOcrRunStillOwned の呼出しが extractPdfPage / ocrWithGemini より前にある', () => {
    const checkCallIdx = pdfPageLoopBody.indexOf('await checkOcrRunStillOwned(');
    const extractPdfPageIdx = pdfPageLoopBody.indexOf('await extractPdfPage(buffer, i)');
    const ocrWithGeminiIdx = pdfPageLoopBody.indexOf("await ocrWithGemini(pageBuffer, 'application/pdf'");
    expect(checkCallIdx, 'checkOcrRunStillOwned呼出しが見つからない').to.be.greaterThan(-1);
    expect(extractPdfPageIdx, 'extractPdfPage呼出しが見つからない').to.be.greaterThan(checkCallIdx);
    expect(ocrWithGeminiIdx, 'ocrWithGemini呼出しが見つからない').to.be.greaterThan(extractPdfPageIdx);
  });

  it('ownership.ok が false の場合 OcrRunSupersededError を throw し、以降のGemini呼出しをスキップする', () => {
    const checkCallIdx = pdfPageLoopBody.indexOf('await checkOcrRunStillOwned(');
    const throwMatch = /if\s*\(\s*!ownership\.ok\s*\)\s*\{[\s\S]{0,400}?throw new OcrRunSupersededError\(/.exec(
      pdfPageLoopBody
    );
    expect(throwMatch, 'ownership.ok===false時のOcrRunSupersededError throwが見つからない').to.not.be.null;
    expect(throwMatch!.index).to.be.greaterThan(checkCallIdx);

    const ocrWithGeminiIdx = pdfPageLoopBody.indexOf("await ocrWithGemini(pageBuffer, 'application/pdf'");
    expect(throwMatch!.index, 'throwはGemini呼出しより前になければ早期中断の意味がない').to.be.lessThan(
      ocrWithGeminiIdx
    );
  });

  it('OcrRunSupersededError の tokenUsage は中断時点までの累積値(pagesProcessed: i)を渡す', () => {
    expect(pdfPageLoopBody).to.match(
      /throw new OcrRunSupersededError\([\s\S]{0,400}?pagesProcessed:\s*i,?\s*\}/
    );
    expect(pdfPageLoopBody).to.match(/inputTokens:\s*totalInputTokens/);
    expect(pdfPageLoopBody).to.match(/outputTokens:\s*totalOutputTokens/);
    expect(pdfPageLoopBody).to.match(/thinkingTokens:\s*totalThinkingTokens/);
  });

  it('checkOcrRunStillOwned はFirestore read失敗時に { ok: true } (継続) を返す (false positive回避)', () => {
    expect(checkFunctionBody).to.match(/\}\s*catch\s*\(\s*err\s*\)\s*\{[\s\S]{0,300}?return\s*\{\s*ok:\s*true\s*\};/);
  });

  it('checkOcrRunStillOwned は evaluateOcrRunOwnership を再利用し、独自の判定ロジックを複製しない', () => {
    expect(checkFunctionBody).to.match(/return evaluateOcrRunOwnership\(/);
  });
});
