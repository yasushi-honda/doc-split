/**
 * handleProcessingError の safeLogError 呼出契約テスト (Issue #276, #271 follow-up)
 *
 * 目的: ocrProcessor.handleProcessingError が errors collection への記録
 * (safeLogError) を呼び続けることを静的検証で保証する。
 *
 * 背景 (#271 code-reviewer Suggestion, conf 70):
 * 既存 summaryCatchLogErrorContract.test.ts は summary 生成 catch 句のみを対象とし、
 * handleProcessingError 末尾の safeLogError 呼出は静的/動的契約テストで保護されていなかった。
 * 削除されても CI は通過してしまう silent failure リスクあり。
 *
 * 方式選定:
 * handleProcessingError は console.error (L380) と safeLogError 呼出 (L430付近) が
 * ~50 行離れており、summaryCatchLogErrorContract の ANCHOR_WINDOW_LINES=8 線形検知は
 * 適用不可。本テストは「関数スコープ検知」として、関数本体全体を対象に以下を確認する。
 */

import { expect } from 'chai';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const OCR_PROCESSOR_PATH = 'src/ocr/ocrProcessor.ts';

/**
 * `export async function handleProcessingError(` から始まる関数の本体を抽出する。
 *
 * 波括弧のネストカウントで関数終端を特定するシンプル実装。
 * 文字列/コメント内の波括弧はソース量が多いと誤カウントの可能性があるが、
 * 本関数は他所で `{` や `}` を文字列として扱わないため実用上は安全。
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
        'errors collection への記録が消失すると #178/#209 同様の silent failure を招く。'
    );
  });

  it('safeLogError 呼出の params に source: \'ocr\' が含まれる', () => {
    const SOURCE_OCR = /source:\s*['"]ocr['"]/;
    expect(SOURCE_OCR.test(functionBody)).to.equal(
      true,
      'safeLogError params に source: \'ocr\' が見つからない。' +
        'errors collection の絞込/集計で欠落する。'
    );
  });

  it('safeLogError 呼出の params に documentId が含まれる', () => {
    const DOCUMENT_ID_PARAM = /documentId:/;
    expect(DOCUMENT_ID_PARAM.test(functionBody)).to.equal(
      true,
      'safeLogError params に documentId: が見つからない。' +
        'エラーとドキュメントの紐付けが失われる。'
    );
  });

  it('safeLogError 呼出の params に functionName が含まれる', () => {
    const FUNCTION_NAME_PARAM = /functionName[\s:,]/;
    expect(FUNCTION_NAME_PARAM.test(functionBody)).to.equal(
      true,
      'safeLogError params に functionName が見つからない。' +
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
});
