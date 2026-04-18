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
 */

import { expect } from 'chai';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const OCR_PROCESSOR_PATH = 'src/ocr/ocrProcessor.ts';

/**
 * `export async function handleProcessingError(` から始まる関数の本体を抽出する。
 *
 * 波括弧のネストカウントで関数終端を特定するシンプル実装。対象の ocrProcessor.ts
 * は文字列/正規表現/テンプレートリテラル内に `{` `}` を含まないため実用上は安全。
 * 将来ここにリテラル波括弧が混入した場合は AST ベース抽出への移行が必要。
 *
 * 抽出失敗時は空文字を返し、caller 側で「occurrence 0」として明示失敗させる。
 */
function extractFunctionBody(source: string, signaturePrefix: string): string {
  const startIdx = source.indexOf(signaturePrefix);
  if (startIdx === -1) return '';

  const openBraceIdx = source.indexOf('{', startIdx);
  if (openBraceIdx === -1) return '';

  let depth = 0;
  for (let i = openBraceIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(openBraceIdx, i + 1);
      }
    }
  }
  return '';
}

/**
 * 関数本体内の `safeLogError(...)` 呼出の引数ブロック (括弧内) を抽出する。
 *
 * 関数本体全体を対象にした regex だと、無関係な同名ローカル変数・他 logger 呼出・
 * 文字列リテラルなどに偽陽性が出る (silent-failure-hunter 指摘)。本関数で引数
 * ブロックに scope を絞ることで、params 検証の精度を上げる。
 */
function extractSafeLogErrorArgs(functionBody: string): string {
  const match = functionBody.match(/\bsafeLogError\s*\(/);
  if (!match || match.index === undefined) return '';

  const openParenIdx = functionBody.indexOf('(', match.index);
  if (openParenIdx === -1) return '';

  let depth = 0;
  for (let i = openParenIdx; i < functionBody.length; i++) {
    const ch = functionBody[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        return functionBody.slice(openParenIdx, i + 1);
      }
    }
  }
  return '';
}

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
  const functionBody = extractFunctionBody(
    source,
    'export async function handleProcessingError('
  );
  const safeLogErrorArgs = extractSafeLogErrorArgs(functionBody);

  it('handleProcessingError 関数本体が抽出できる', () => {
    expect(functionBody.length).to.be.greaterThan(
      0,
      '`export async function handleProcessingError(` 宣言が見つからない。' +
        'リネーム/シグネチャ変更時は本契約の見直しが必要。'
    );
  });

  it('handleProcessingError 本体内に safeLogError 呼出がある', () => {
    const SAFE_LOG_ERROR_CALL = /\bsafeLogError\s*\(/;
    expect(SAFE_LOG_ERROR_CALL.test(functionBody)).to.equal(
      true,
      'handleProcessingError 内で safeLogError 呼出が見つからない。' +
        'errors collection への記録が消失すると #266/#271 同系の silent failure を招く。'
    );
  });

  it('safeLogError 引数ブロックが抽出できる', () => {
    expect(safeLogErrorArgs.length).to.be.greaterThan(
      0,
      'safeLogError(...) の引数ブロックが抽出できない。' +
        '呼出形式の変更 (spread 展開等) の可能性あり — 本契約の見直しが必要。'
    );
  });

  it('safeLogError 引数に error が渡されている', () => {
    // shorthand `error,` / explicit `error: something` の両方を許容。
    // `error` object 自体が欠落すると stack trace・原因追跡が失われる。
    const ERROR_PARAM = /\berror\s*[,:}]/;
    expect(ERROR_PARAM.test(safeLogErrorArgs)).to.equal(
      true,
      'safeLogError 引数に error が含まれていない。' +
        'error object 欠落で stack trace が errors collection に残らない。'
    );
  });

  it('safeLogError 引数に source: \'ocr\' が含まれる', () => {
    const SOURCE_OCR = /source:\s*['"]ocr['"]/;
    expect(SOURCE_OCR.test(safeLogErrorArgs)).to.equal(
      true,
      'safeLogError 引数に source: \'ocr\' が見つからない。' +
        'errors collection の絞込/集計で欠落する。'
    );
  });

  it('safeLogError 引数に documentId が渡されている', () => {
    const DOCUMENT_ID_PARAM = /\bdocumentId\s*[,:}]/;
    expect(DOCUMENT_ID_PARAM.test(safeLogErrorArgs)).to.equal(
      true,
      'safeLogError 引数に documentId が見つからない。' +
        'エラーとドキュメントの紐付けが失われる。'
    );
  });

  it('safeLogError 引数に functionName が渡されている', () => {
    const FUNCTION_NAME_PARAM = /\bfunctionName\s*[,:}]/;
    expect(FUNCTION_NAME_PARAM.test(safeLogErrorArgs)).to.equal(
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
      expect(body).to.include('const x = 1');
      expect(body.startsWith('{')).to.equal(true);
      expect(body.endsWith('}')).to.equal(true);
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
      expect(body).to.include('break');
      expect(body).to.include('return 1');
    });

    it('negative: 関数宣言不在時は空文字', () => {
      const fixture = `const x = 1;`;
      const body = extractFunctionBody(fixture, 'export async function foo(');
      expect(body).to.equal('');
    });
  });

  describe('extractSafeLogErrorArgs detection logic', () => {
    it('positive: 単純な呼出から引数ブロックを抽出する', () => {
      const fixture = `await safeLogError({ error, source: 'ocr' });`;
      const args = extractSafeLogErrorArgs(fixture);
      expect(args.startsWith('(')).to.equal(true);
      expect(args.endsWith(')')).to.equal(true);
      expect(args).to.include("source: 'ocr'");
    });

    it('positive: 引数内の括弧 (関数呼出等) をネストカウントする', () => {
      const fixture = `safeLogError({ error: wrap(raw), source: 'ocr' });`;
      const args = extractSafeLogErrorArgs(fixture);
      expect(args).to.include('wrap(raw)');
      expect(args.endsWith(')')).to.equal(true);
    });

    it('negative: safeLogError 呼出不在時は空文字', () => {
      const fixture = `console.error('failed');`;
      const args = extractSafeLogErrorArgs(fixture);
      expect(args).to.equal('');
    });

    it('scope: 関数本体内の無関係な functionName 変数は検知対象外', () => {
      // safeLogError 呼出の外にある functionName は引数ブロック抽出で除外されること。
      const fixture = [
        `const functionName = 'fake';`,
        `safeLogError({ error, source: 'ocr', documentId: id });`,
      ].join('\n');
      const args = extractSafeLogErrorArgs(fixture);
      expect(args).to.not.include("'fake'");
      expect(/\bfunctionName\s*[,:}]/.test(args)).to.equal(
        false,
        '引数ブロック外の functionName 変数が含まれてはならない (偽陽性防御)'
      );
    });
  });
});
