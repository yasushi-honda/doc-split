/**
 * ocrProcessor.ts の候補抽出+arbitration統合配線契約テスト (GOAL.md OCR突合精度向上
 * ミッション タスクD)
 *
 * processDocument()はFirestore admin/Gemini APIへの重い依存があり、実行ベースの
 * unit testが困難なため、既存の`ocrProcessorAggregateCallerContract.test.ts`
 * `ocrProcessorConfirmedFieldWiringContract.test.ts`と同じgrep-based契約パターン
 * (docs/context/test-strategy.md §2.1)で以下を lock-in する:
 *
 * 1. extractOcrCandidates()がocrResult確定後に呼ばれ、戻り値のトークン数がtotal*に
 *    加算される(trackGeminiUsageによる実コスト計測、タスクGのA/Bハーネスとは別に
 *    本番コスト可視化のため必須)
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

  it('extractOcrCandidates呼出は1箇所のみ(candidates変数へ代入)', () => {
    const callCount = (source.match(/extractOcrCandidates\s*\(/g) ?? []).length;
    // 定義箇所(export async function extractOcrCandidates)1 + 呼出箇所1 = 2
    expect(callCount, 'processDocument内からの呼出が想定外の数(定義+呼出=2以外)').to.equal(2);
    expect(source).to.match(
      /const candidates = await extractOcrCandidates\(ocrResult, docId\)/,
      'extractOcrCandidates(ocrResult, docId)呼出でcandidatesへ代入する形が見つからない'
    );
  });

  it('candidatesのトークン数がtotalInputTokens/totalOutputTokens/totalThinkingTokensへ加算される', () => {
    expect(source).to.match(/totalInputTokens \+= candidates\.inputTokens/);
    expect(source).to.match(/totalOutputTokens \+= candidates\.outputTokens/);
    expect(source).to.match(/totalThinkingTokens \+= candidates\.thinkingTokens/);
  });

  it('extractOcrCandidates呼出はloadMasterData呼出より後(masterDataは候補抽出に不要な独立処理)', () => {
    const loadMasterDataIndex = source.indexOf('await loadMasterData(');
    const extractCandidatesIndex = source.indexOf('await extractOcrCandidates(');
    expect(loadMasterDataIndex).to.be.greaterThan(-1);
    expect(extractCandidatesIndex).to.be.greaterThan(-1);
    expect(extractCandidatesIndex).to.be.greaterThan(loadMasterDataIndex);
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
