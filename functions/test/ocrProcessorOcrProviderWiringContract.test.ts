/**
 * ocrProcessor.ts の OCR_PROVIDER配線契約テスト (ADR-0025 PR6)
 *
 * processDocument自体はStorage/Gemini/PaddleOCR副作用が大きく直接呼び出せないため
 * (ocrProcessorEarlyOwnershipCheckWiringContract.test.tsと同方針)、配線自体を
 * ソース文字列レベルでlock-inする。判定ロジック(resolveOcrProvider自体の動作)は
 * featureFlagsIntegration.test.ts(emulator)で検証する。
 *
 * 検証する契約:
 * 1. resolveOcrProviderの呼出しがprocessDocument内で1回だけ
 * 2. processDocument本体にocrWithGemini(の直接呼出しが残っていない
 *    (ocrPass1ディスパッチャー経由に一本化されていること)
 */

import { expect } from 'chai';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { extractBraceBlock } from './helpers/extractBraceBlock';

const OCR_PROCESSOR_PATH = 'src/ocr/ocrProcessor.ts';
const PROCESS_DOCUMENT_ANCHOR = /export\s+async\s+function\s+processDocument\s*\(/;
const OCR_PASS1_ANCHOR = /async\s+function\s+ocrPass1\s*\(/;

function expectSingleDefinition(source: string, pattern: RegExp, label: string): void {
  const count = (source.match(pattern) ?? []).length;
  expect(count, `${label} の定義が複数存在する場合は anchor の narrow が必要`).to.equal(1);
}

describe('ocrProcessor OCR_PROVIDER配線契約 (ADR-0025 PR6)', () => {
  let processDocumentBody = '';
  let ocrPass1Body = '';

  before(() => {
    const absPath = resolve(process.cwd(), OCR_PROCESSOR_PATH);
    const source = readFileSync(absPath, 'utf-8');

    expectSingleDefinition(
      source,
      /export\s+async\s+function\s+processDocument\s*\(/g,
      'processDocument'
    );
    const body = extractBraceBlock(source, PROCESS_DOCUMENT_ANCHOR);
    expect(body, 'processDocument 関数本体の抽出に失敗した').to.not.be.null;
    processDocumentBody = body!;

    expectSingleDefinition(source, /async\s+function\s+ocrPass1\s*\(/g, 'ocrPass1');
    const pass1Body = extractBraceBlock(source, OCR_PASS1_ANCHOR);
    expect(pass1Body, 'ocrPass1 関数本体の抽出に失敗した').to.not.be.null;
    ocrPass1Body = pass1Body!;
  });

  it('resolveOcrProvider の呼出しが processDocument 内で文書ごとに1回だけ行われる', () => {
    const matches = processDocumentBody.match(/resolveOcrProvider\(/g) ?? [];
    expect(
      matches.length,
      'resolveOcrProviderはFirestore readを伴うため、ページOCRループ内で毎回呼ぶとreadが重複し、' +
        '同一文書内でプロバイダが途中変化する不整合も起こりうる'
    ).to.equal(1);
  });

  it('processDocument 本体に ocrWithGemini( の直接呼出しが残っていない(ocrPass1経由に一本化)', () => {
    // 'ocrWithGemini(' 単体だと、ocrWithGeminiを説明する日本語コメント(例: 384行目付近の
    // 「既存ocrWithGemini()とは独立した」)に偽陽性でマッチするため、実際の呼出しパターン
    // ('await ocrWithGemini(')でのみ判定する。
    expect(
      processDocumentBody,
      'processDocument内でocrWithGeminiを直接呼ぶと、ocrProvider解決結果(PaddleOCR切替)が' +
        '無視される回帰になる'
    ).to.not.include('await ocrWithGemini(');
  });

  it('processDocument 本体で PDFループ・非PDF分岐の両方が ocrPass1( を呼んでいる', () => {
    const matches = processDocumentBody.match(/await ocrPass1\(/g) ?? [];
    expect(matches.length, 'PDFページ分岐・画像分岐の計2箇所でocrPass1を呼ぶ想定').to.equal(2);
  });

  it('ocrPass1 は provider==="paddle" で ocrWithPaddle、それ以外で ocrWithGemini を呼ぶ', () => {
    expect(ocrPass1Body).to.match(/provider\s*===\s*'paddle'/);
    expect(ocrPass1Body).to.include('await ocrWithPaddle(');
    expect(ocrPass1Body).to.include('await ocrWithGemini(');
  });

  // pr-test-analyzerセカンドオピニオン指摘(Critical): ocrExtraction.version相当の監査用
  // provenanceフィールド(pass1ModelVersion→modelId)は、この配線契約テストを含むどのテストからも
  // 一切参照されていなかった。「modelId: pass1ModelVersion」が「modelId: MODEL_ID」へ差し戻される
  // 回帰(コード自身のコメントが明言する「捨てるとPaddle移行後は監査上Geminiと誤記録される」)を
  // 検知するため、ソース文字列レベルでlock-inする。
  it('PDFループ・非PDF分岐の両方で ocrPass1 呼出し直後に pass1ModelVersion を更新している', () => {
    const matches = processDocumentBody.match(/pass1ModelVersion\s*=\s*result\.modelVersion;/g) ?? [];
    expect(
      matches.length,
      'PDFページ分岐・画像分岐の計2箇所でpass1ModelVersionを更新する想定。' +
        '片方でも欠落するとそのプロバイダのprovenanceがMODEL_ID(Gemini)のまま' +
        '取り残される回帰になる'
    ).to.equal(2);
  });

  it('buildOcrExtractionUpdatePayload には modelId: pass1ModelVersion が渡り、固定のMODEL_IDは渡っていない', () => {
    expect(
      processDocumentBody,
      'modelId: pass1ModelVersion であるべき箇所がmodelId: MODEL_IDへ差し戻されると、' +
        'PaddleOCRで処理してもFirestoreには常にGeminiのmodelIdが記録される回帰になる'
    ).to.include('modelId: pass1ModelVersion,');
    expect(processDocumentBody).to.not.match(/modelId:\s*MODEL_ID,/);
  });

  it('pageResults再利用パス(OCR自体をスキップ)では、既存のocrExtraction.versionを継承しMODEL_IDへ上書きしない', () => {
    // codex review P2指摘対応: PaddleOCRで処理された親のpageResultsを継承した分割子ドキュメントの
    // provenanceが、再利用パス(ocrPass1を呼ばない)でGeminiのMODEL_IDへ誤って上書きされない
    // ことを検証する。抽出対象は「reuseCheck.reusable && existingPageResults」ブロック本体。
    const reuseBlock = extractBraceBlock(
      processDocumentBody,
      /if\s*\(\s*reuseCheck\.reusable\s*&&\s*existingPageResults\s*\)/
    );
    expect(reuseBlock, '再利用パスのifブロック本体の抽出に失敗した').to.not.be.null;
    expect(
      reuseBlock,
      '再利用パスでdocData.ocrExtraction.versionを継承する処理が見つからない'
    ).to.match(/docData\.ocrExtraction/);
    expect(
      reuseBlock,
      '再利用パスでpass1ModelVersionにinheritedModelVersion相当の値を代入していない'
    ).to.match(/pass1ModelVersion\s*=\s*inheritedModelVersion/);
  });
});
