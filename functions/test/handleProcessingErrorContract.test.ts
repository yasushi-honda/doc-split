/**
 * handleProcessingError の safeLogError 呼出契約テスト (Issue #276, #271 follow-up)
 *
 * 目的: ocrProcessor.handleProcessingError が errors collection への記録
 * (safeLogError) を呼び続けることを静的検証で保証する。
 *
 * 背景 (#266/#271 の safeLogError 契約拡張ライン):
 * 既存 summaryCatchLogErrorContract.test.ts (#266) は summary 生成 catch 句のみを
 * 対象とし、handleProcessingError 末尾の safeLogError 呼出は静的契約で保護されていな
 * かった。削除されても CI は通過してしまう silent failure リスクあり (#271
 * code-reviewer Suggestion, conf 70)。
 *
 * 方式選定:
 * handleProcessingError は console.error アンカーと safeLogError 呼出が数十行離れて
 * おり、summaryCatchLogErrorContract の ANCHOR_WINDOW_LINES=8 線形検知は適用不可。
 * 本テストは以下 2 段階の scope 縮約で検証する:
 *   1. 関数本体を brace-nesting で抽出 (extractFunctionBody)
 *   2. 関数本体内の safeLogError(...) 引数ブロックを paren-nesting で抽出し、
 *      そのブロック内で各 param の存在を検証
 * これにより関数本体内の無関係な同名変数/コメントへの偽陽性を回避する。
 *
 * 将来委譲: 現時点で委譲先なし (handleProcessingError の safeLogError 呼出保護は
 *          source 構造保護が本質のため恒久 contract として保持)
 */

import { expect } from 'chai';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { extractBraceBlock, extractParenBlock } from './helpers/extractBraceBlock';

const OCR_PROCESSOR_PATH = 'src/ocr/ocrProcessor.ts';
const SAFE_LOG_ERROR_CALL = /\bsafeLogError\s*\(/;

// brace/paren 抽出は共通 helper (extractBraceBlock / extractParenBlock) を使用 (#302)。
// 関数本体の抽出 = brace-nesting、safeLogError 引数の抽出 = paren-nesting で scope を絞ることで
// 無関係な同名変数・他 logger 呼出・文字列リテラルへの偽陽性を回避する。
// #312: helper が anchor 不在時に null を返すため、alias wrapper も string | null を透過する。
const extractFunctionBody = (source: string, signaturePrefix: string): string | null =>
  extractBraceBlock(source, signaturePrefix);
const extractSafeLogErrorArgs = (functionBody: string): string | null =>
  extractParenBlock(functionBody, SAFE_LOG_ERROR_CALL);

describe('handleProcessingError safeLogError contract (#276)', () => {
  before(() => {
    const absPath = resolve(process.cwd(), OCR_PROCESSOR_PATH);
    if (!existsSync(absPath)) {
      throw new Error(
        `${OCR_PROCESSOR_PATH} が存在しない。ocrProcessor.ts がリネーム/削除された場合は本契約の見直しが必要。`
      );
    }
  });

  const absPath = resolve(process.cwd(), OCR_PROCESSOR_PATH);
  const source = readFileSync(absPath, 'utf-8');
  const functionBody = extractBraceBlock(
    source,
    'export async function handleProcessingError('
  );
  const safeLogErrorArgs = extractParenBlock(functionBody, /\bsafeLogError\s*\(/);

  it('handleProcessingError 関数本体が抽出できる', () => {
    expect(
      functionBody,
      '`export async function handleProcessingError(` 宣言が見つからない。' +
        'リネーム/シグネチャ変更時は本契約の見直しが必要。'
    ).to.not.be.null;
  });

  it('handleProcessingError 本体内に safeLogError 呼出がある', () => {
    const SAFE_LOG_ERROR_CALL = /\bsafeLogError\s*\(/;
    expect(functionBody, 'functionBody 抽出失敗 (上位 it を確認)').to.not.be.null;
    expect(SAFE_LOG_ERROR_CALL.test(functionBody!)).to.equal(
      true,
      'handleProcessingError 内で safeLogError 呼出が見つからない。' +
        'errors collection への記録が消失すると #266/#271 同系の silent failure を招く。'
    );
  });

  it('safeLogError 引数ブロックが抽出できる', () => {
    expect(
      safeLogErrorArgs,
      'safeLogError(...) の引数ブロックが抽出できない。' +
        '呼出形式の変更 (spread 展開等) の可能性あり — 本契約の見直しが必要。'
    ).to.not.be.null;
  });

  it('safeLogError 引数に error が渡されている', () => {
    // shorthand `error,` / explicit `error: something` の両方を許容。
    // `error` object 自体が欠落すると stack trace・原因追跡が失われる。
    const ERROR_PARAM = /\berror\s*[,:}]/;
    expect(safeLogErrorArgs, 'safeLogErrorArgs 抽出失敗 (上位 it を確認)').to.not.be.null;
    expect(ERROR_PARAM.test(safeLogErrorArgs!)).to.equal(
      true,
      'safeLogError 引数に error が含まれていない。' +
        'error object 欠落で stack trace が errors collection に残らない。'
    );
  });

  it('safeLogError 引数に source: \'ocr\' が含まれる', () => {
    const SOURCE_OCR = /source:\s*['"]ocr['"]/;
    expect(safeLogErrorArgs, 'safeLogErrorArgs 抽出失敗').to.not.be.null;
    expect(SOURCE_OCR.test(safeLogErrorArgs!)).to.equal(
      true,
      'safeLogError 引数に source: \'ocr\' が見つからない。' +
        'errors collection の絞込/集計で欠落する。'
    );
  });

  it('safeLogError 引数に documentId が渡されている', () => {
    const DOCUMENT_ID_PARAM = /\bdocumentId\s*[,:}]/;
    expect(safeLogErrorArgs, 'safeLogErrorArgs 抽出失敗').to.not.be.null;
    expect(DOCUMENT_ID_PARAM.test(safeLogErrorArgs!)).to.equal(
      true,
      'safeLogError 引数に documentId が見つからない。' +
        'エラーとドキュメントの紐付けが失われる。'
    );
  });

  it('safeLogError 引数に functionName が渡されている', () => {
    const FUNCTION_NAME_PARAM = /\bfunctionName\s*[,:}]/;
    expect(safeLogErrorArgs, 'safeLogErrorArgs 抽出失敗').to.not.be.null;
    expect(FUNCTION_NAME_PARAM.test(safeLogErrorArgs!)).to.equal(
      true,
      'safeLogError 引数に functionName が見つからない。' +
        'どの呼出元で発生したエラーか特定できなくなる。'
    );
  });

  describe('extractFunctionBody detection logic', () => {
    it('positive: 通常の関数本体を抽出する', () => {
      const fixture = `
export async function foo() {
  const x = 1;
  return x;
}
`;
      const body = extractFunctionBody(fixture, 'export async function foo(');
      expect(body, '関数本体が抽出できていない').to.not.be.null;
      expect(body!).to.include('const x = 1');
      expect(body!.startsWith('{')).to.equal(true);
      expect(body!.endsWith('}')).to.equal(true);
    });

    it('positive: ネストしたブロックを正しくカウントする', () => {
      const fixture = `
export async function foo() {
  if (true) {
    for (;;) { break; }
  }
  return 1;
}
`;
      const body = extractFunctionBody(fixture, 'export async function foo(');
      expect(body, '関数本体が抽出できていない').to.not.be.null;
      expect(body!).to.include('break');
      expect(body!).to.include('return 1');
    });

    it('negative: 関数宣言不在時は null', () => {
      const fixture = `const x = 1;`;
      const body = extractFunctionBody(fixture, 'export async function foo(');
      expect(body).to.be.null;
    });
  });

  describe('extractSafeLogErrorArgs detection logic', () => {
    it('positive: 単純な呼出から引数ブロックを抽出する', () => {
      const fixture = `await safeLogError({ error, source: 'ocr' });`;
      const args = extractSafeLogErrorArgs(fixture);
      expect(args, '引数ブロックが抽出できていない').to.not.be.null;
      expect(args!.startsWith('(')).to.equal(true);
      expect(args!.endsWith(')')).to.equal(true);
      expect(args!).to.include("source: 'ocr'");
    });

    it('positive: 引数内の括弧 (関数呼出等) をネストカウントする', () => {
      const fixture = `safeLogError({ error: wrap(raw), source: 'ocr' });`;
      const args = extractSafeLogErrorArgs(fixture);
      expect(args, '引数ブロックが抽出できていない').to.not.be.null;
      expect(args!).to.include('wrap(raw)');
      expect(args!.endsWith(')')).to.equal(true);
    });

    it('negative: safeLogError 呼出不在時は null', () => {
      const fixture = `console.error('failed');`;
      const args = extractSafeLogErrorArgs(fixture);
      expect(args).to.be.null;
    });

    it('scope: 関数本体内の無関係な functionName 変数は検知対象外', () => {
      // safeLogError 呼出の外にある functionName は引数ブロック抽出で除外されること。
      const fixture = [
        `const functionName = 'fake';`,
        `safeLogError({ error, source: 'ocr', documentId: id });`,
      ].join('\n');
      const args = extractSafeLogErrorArgs(fixture);
      expect(args, '引数ブロックが抽出できていない').to.not.be.null;
      expect(args!).to.not.include("'fake'");
      expect(/\bfunctionName\s*[,:}]/.test(args!)).to.equal(
        false,
        '引数ブロック外の functionName 変数が含まれてはならない (偽陽性防御)'
      );
    });
  });
});
