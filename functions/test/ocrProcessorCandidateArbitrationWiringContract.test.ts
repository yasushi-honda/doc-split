/**
 * ocrProcessor.ts の候補抽出+arbitration統合配線契約テスト (GOAL.md OCR突合精度向上
 * ミッション タスクD)
 *
 * processDocument()はFirestore admin/Gemini APIへの重い依存があり、実行ベースの
 * unit testが困難なため、既存の`ocrProcessorAggregateCallerContract.test.ts`
 * `ocrProcessorConfirmedFieldWiringContract.test.ts`と同じgrep-based契約パターン
 * (docs/context/test-strategy.md §2.1)で以下を lock-in する:
 *
 * 1. Pass2(LLM候補抽出、OCR全文を毎回Geminiへ送る第2呼出し)は廃止済み(ADR-0025
 *    決定事項2、2026-10-03に実データで採用0件を確認)。extractOcrCandidatesの関数・呼出しが
 *    再導入されていないこと、候補は常に空の結果(EMPTY_CANDIDATE_RESULTのコピー)であること
 * 2. documentType/customerName/officeName/dateの4項目それぞれがarbitrate*を経由する
 *    (既存の全文ベース結果への直接代入に回帰していないこと)
 * 3. dateMarker解決(matchedDoc)がarbitration後のdocumentTypeResultを参照する
 *    (arbitration前のdocumentTypeBaseを参照する回帰を防止)
 */

import { expect } from 'chai';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('ocrProcessor candidate extraction + arbitration wiring contract (GOAL.md タスクD)', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/ocr/ocrProcessor.ts'), 'utf-8');

  it('Pass2(extractOcrCandidates)の関数・呼出しが存在しない(再導入防止)', () => {
    const callCount = (source.match(/extractOcrCandidates\s*\(/g) ?? []).length;
    expect(callCount, 'Pass2(OCR全文をGeminiへ送る第2呼出し)が再導入されている').to.equal(0);
    expect(source).to.not.match(/buildCandidateExtractionPrompt/, 'Pass2のプロンプトが残っている');
  });

  it('Geminiへのgenerate呼出しはPass1の緊急用経路(ocrWithGemini)の1箇所だけ', () => {
    const generateCount = (source.match(/\.generateContent\s*\(/g) ?? []).length;
    expect(
      generateCount,
      'ocrProcessor.ts内のgenerateContent呼出しがPass1緊急用(ocrWithGemini)以外にも存在する(顧客データの外部AI送信経路が増えている)'
    ).to.equal(1);
  });

  it('candidatesは常に空の結果(EMPTY_CANDIDATE_RESULTのコピー)で、トークン加算は行わない', () => {
    expect(source).to.match(
      /const candidates: OcrCandidateExtractionResult = \{ \.\.\.EMPTY_CANDIDATE_RESULT \}/,
      'candidatesが空の結果の固定になっていない'
    );
    expect(source).to.not.match(/totalInputTokens \+= candidates\./);
    expect(source).to.not.match(/candidateGeminiMs/);
  });

  it('documentTypeResultはarbitrateDocumentType(documentTypeBase, candidates.documentTypeCandidate, documents, ocrResult)の戻り値', () => {
    expect(source).to.match(/const documentTypeBase = extractDocumentTypeEnhanced\(ocrResult, documents\)/);
    expect(source).to.match(
      /const documentTypeResult = arbitrateDocumentType\(\s*documentTypeBase,\s*candidates\.documentTypeCandidate,\s*documents,\s*ocrResult\s*\)/
    );
  });

  it('customerResultはarbitrateCustomerName(customerBase, candidates.customerNameCandidate, customers, ocrResult)の戻り値', () => {
    expect(source).to.match(/const customerBase = extractCustomerCandidates\(ocrResult, customers\)/);
    expect(source).to.match(
      /const customerResult = arbitrateCustomerName\(\s*customerBase,\s*candidates\.customerNameCandidate,\s*customers,\s*ocrResult\s*\)/
    );
  });

  it('officeResultはarbitrateOfficeName(officeBase, candidates.officeNameCandidate, offices, ocrResult, { filenameInfo })の戻り値', () => {
    expect(source).to.match(
      /const officeBase = extractOfficeCandidates\(ocrResult, offices, \{ filenameInfo \}\)/
    );
    expect(source).to.match(
      /const officeResult = arbitrateOfficeName\(\s*officeBase,\s*candidates\.officeNameCandidate,\s*offices,\s*ocrResult,\s*\{ filenameInfo \}\s*\)/
    );
  });

  it('dateResultはarbitrateDate(dateBase, candidates.dateCandidate, ocrResult)の戻り値', () => {
    expect(source).to.match(
      /const dateBase = extractDateEnhanced\(ocrResult, dateMarker, firstPageText\)/
    );
    expect(source).to.match(
      /const dateResult = arbitrateDate\(dateBase, candidates\.dateCandidate, ocrResult\)/
    );
  });

  it('matchedDoc(dateMarker解決)はarbitration後のdocumentTypeResultを参照する(documentTypeBaseの直接参照ではない)', () => {
    expect(source).to.match(
      /const matchedDoc = documents\.find\(\(d\) => d\.name === documentTypeResult\.documentType\)/,
      'matchedDocがdocumentTypeResult(arbitration後)を参照していない — dateMarker解決が候補昇格結果に追従しない回帰の可能性'
    );
    expect(source).to.not.match(
      /documents\.find\(\(d\) => d\.name === documentTypeBase\.documentType\)/,
      'matchedDocがarbitration前のdocumentTypeBaseを参照している — 候補昇格結果に追従しない回帰'
    );
  });

  it('suggestedNewOffice判定はarbitration後のofficeResult.bestMatchを参照する', () => {
    const officeResultDeclIndex = source.indexOf('const officeResult = arbitrateOfficeName(');
    const noGoodMatchIndex = source.indexOf('const noGoodMatch = !officeResult.bestMatch');
    expect(officeResultDeclIndex).to.be.greaterThan(-1);
    expect(noGoodMatchIndex).to.be.greaterThan(-1);
    expect(noGoodMatchIndex).to.be.greaterThan(officeResultDeclIndex);
  });

  it('buildOcrExtractionUpdatePayload呼出はarbitration後の4変数(documentTypeResult/customerResult/officeResult/dateResult)を渡す', () => {
    expect(source).to.match(/documentTypeResult,\s*\n\s*customerResult,\s*\n\s*officeResult,\s*\n\s*dateResult,/);
  });
});
