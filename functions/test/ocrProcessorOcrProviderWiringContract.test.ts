/**
 * ocrProcessor.ts の Pass1(OCR)配線契約テスト (ADR-0025 PR6、ADR-0029でGemini経路を廃止)
 *
 * processDocument自体はStorage/PaddleOCR副作用が大きく直接呼び出せないため
 * (ocrProcessorEarlyOwnershipCheckWiringContract.test.tsと同方針)、配線自体を
 * ソース文字列レベルでlock-inする。
 *
 * 検証する契約(plan-crossreview 指摘: 旧アサーションを削るだけにせず、削除後も意味のある
 * 不変条件を明示する):
 * 1. PDF・画像の両経路が ocrPass1 を呼び、ocrPass1 は PaddleOCR(ocrWithPaddle)だけを呼ぶ
 * 2. 返されたモデル版(modelVersion)が pass1ModelVersion へ保存され、Firestoreの
 *    ocrExtraction.version(modelId)として書かれる
 * 3. Geminiの経路(provider解決・緊急ログ・ocrWithGemini・GoogleGenAI)がソースに存在しない
 *    (OCR_PROVIDER=gemini を与えてもGemini呼び出しが起きない=そもそも呼び出し口が無い)
 * 4. 既存pageResultsの再利用パス(OCRを呼ばない)で、継承元のocrExtraction.versionを維持し、
 *    継承元にも版が無い場合は 'unknown'(OCRを実行しておらず継承元の版も欠ける)になる
 *
 * 'gemini' が宣言されても警告のうえpaddleに倒れる実行時の挙動は config.test.ts
 * (parseOcrProvider)で検証する。
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

describe('ocrProcessor Pass1(OCR)配線契約 (ADR-0025 PR6、ADR-0029)', () => {
  let source = '';
  let processDocumentBody = '';
  let ocrPass1Body = '';

  before(() => {
    const absPath = resolve(process.cwd(), OCR_PROCESSOR_PATH);
    source = readFileSync(absPath, 'utf-8');

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

  // 契約1: PDF・画像の両経路が PaddleOCR を呼ぶ
  it('processDocument 本体で PDFループ・非PDF分岐の両方が ocrPass1( を呼んでいる(provider引数なし)', () => {
    const matches = processDocumentBody.match(/await ocrPass1\(/g) ?? [];
    expect(matches.length, 'PDFページ分岐・画像分岐の計2箇所でocrPass1を呼ぶ想定').to.equal(2);
    expect(processDocumentBody, 'PDFページ分岐の呼出しシグネチャが変わっている').to.match(
      /await ocrPass1\(pageBuffer,\s*'application\/pdf',\s*pageNumber\)/
    );
    expect(processDocumentBody, '画像分岐の呼出しシグネチャが変わっている').to.match(
      /await ocrPass1\(buffer,\s*mimeType\)/
    );
  });

  it('ocrPass1 は PaddleOCR(ocrWithPaddle)だけを呼び、provider分岐・Gemini呼出しを持たない', () => {
    expect(ocrPass1Body).to.include('await ocrWithPaddle(');
    expect(ocrPass1Body, 'ocrPass1にprovider分岐が残っている(Gemini廃止、ADR-0029)').to.not.match(/provider/);
    expect(ocrPass1Body).to.not.match(/ocrWithGemini|GoogleGenAI|generateContent/);
  });

  // 契約2: 返されたモデル版が保存される
  it('PDFループ・非PDF分岐の両方で ocrPass1 呼出し直後に pass1ModelVersion を更新している', () => {
    const matches = processDocumentBody.match(/pass1ModelVersion\s*=\s*result\.modelVersion;/g) ?? [];
    expect(
      matches.length,
      'PDFページ分岐・画像分岐の計2箇所でpass1ModelVersionを更新する想定。' +
        '片方でも欠落するとその経路のprovenance(ocrExtraction.version)が既定値のまま取り残される'
    ).to.equal(2);
  });

  it('buildOcrExtractionUpdatePayload には modelId: pass1ModelVersion が渡る', () => {
    expect(
      processDocumentBody,
      'modelId: pass1ModelVersion が渡らないと、PaddleOCRで処理しても返されたモデル版がFirestoreに保存されない'
    ).to.include('modelId: pass1ModelVersion,');
  });

  // 契約3: Geminiの経路がソースに存在しない
  it('ocrProcessor.ts にGeminiの経路(provider解決・緊急ログ・ocrWithGemini・SDK・固定モデルID)が存在しない', () => {
    expect(source).to.not.match(/resolveOcrProvider|logGeminiEmergencyOnce|gemini_ocr_emergency_used/);
    expect(source).to.not.match(/ocrWithGemini|GoogleGenAI|@google\/genai|GEMINI_CONFIG/);
    expect(source, '固定のMODEL_ID(Geminiのモデル名)が復活している').to.not.match(/\bMODEL_ID\b/);
    expect(processDocumentBody, 'processDocument内にgemini provider分岐が残っている').to.not.match(
      /ocrProvider\s*[!=]==\s*'gemini'/
    );
  });

  // 契約4: 再利用パスの来歴
  it("pass1ModelVersion の既定値は 'unknown'(実行していないエンジン名を偽って書かない)", () => {
    expect(processDocumentBody).to.match(/let pass1ModelVersion\s*=\s*'unknown';/);
  });

  it('pageResults再利用パス(OCR自体をスキップ)では、既存のocrExtraction.versionを継承する', () => {
    // PaddleOCRで処理された親のpageResultsを継承した分割子ドキュメントのprovenanceが、
    // 再利用パス(ocrPass1を呼ばない)で既定値('unknown')へ誤って上書きされないことを検証する。
    // 抽出対象は「reuseCheck.reusable && existingPageResults」ブロック本体。
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
    expect(reuseBlock, '再利用パスでocrPass1を呼んでいる(OCRをスキップする契約に反する)').to.not.match(/ocrPass1\(/);
  });

  it('OCRの判定にL2(Firestoreのpaddleocrフラグ)を使わない: ocrProcessor.tsはgetPaddleOcrGateを参照しない', () => {
    expect(source, 'L2をOCRの判定に再び使うと、設定欠落でOCRが止まる設計に戻る').to.not.match(/getPaddleOcrGate/);
  });
});
