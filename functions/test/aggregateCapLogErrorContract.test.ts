/**
 * aggregate cap 発動経路の safeLogError 呼出契約テスト (Issue #283)
 *
 * 目的: ocrProcessor.processDocument 内の aggregate cap block が、truncation 発動時に
 * safeLogError (errors collection + 通知) を呼び続けることを静的検証で保証する。
 *
 * 背景 (#283):
 * 既存実装 (#282 マージ時点) は aggregate cap 発動時に ocrProcessor.ts L152-154 で
 * 単発 console.warn を出すのみ。warn level は Cloud Logging alert に拾われにくく、
 * Issue #209 型実害 (Vertex AI 暴走 1.1M chars) が運用側で認知できない silent failure
 * 経路が残っていた。本契約は safeLogError 格上げ (#283 Option B) を lock-in する。
 *
 * 方式選定:
 * aggregate cap block は `if (afterAggregateChars < beforeAggregateChars) { ... }`
 * 条件ブロック内。このブロックを brace-nesting で抽出し、block 内での safeLogError
 * 呼出と params (source: 'ocr' / documentId / functionName) を検証する。
 * Phase 1 (#276) の extractFunctionBody / extractSafeLogErrorArgs と同一手法。
 */

import { expect } from 'chai';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { extractBraceBlock, extractParenBlock } from './helpers/extractBraceBlock';

const OCR_PROCESSOR_PATH = 'src/ocr/ocrProcessor.ts';
const AGGREGATE_CAP_ANCHOR =
  /if\s*\(\s*afterAggregateChars\s*<\s*beforeAggregateChars\s*\)\s*\{/;

const extractAggregateCapBlock = (source: string) =>
  extractBraceBlock(source, AGGREGATE_CAP_ANCHOR);

describe('aggregate cap safeLogError contract (#283)', () => {
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
  const capBlock = extractBraceBlock(source, AGGREGATE_CAP_ANCHOR);
  const safeLogErrorArgs = extractParenBlock(capBlock, /\bsafeLogError\s*\(/);

  it('aggregate cap block が抽出できる', () => {
    expect(capBlock.length).to.be.greaterThan(
      0,
      '`if (afterAggregateChars < beforeAggregateChars) { ... }` anchor が見つからない。' +
        '変数名リネーム/条件書き換え時は本契約の見直しが必要。'
    );
  });

  it('aggregate cap block 内に safeLogError 呼出がある', () => {
    const SAFE_LOG_ERROR_CALL = /\bsafeLogError\s*\(/;
    expect(SAFE_LOG_ERROR_CALL.test(capBlock)).to.equal(
      true,
      'aggregate cap block 内で safeLogError 呼出が見つからない。' +
        'errors collection への記録が消失すると #209 型実害の再発を認知できない (#283 silent failure)。'
    );
  });

  // #283 Codex review Low: Cloud Functions lifecycle で await 漏れは fire-and-forget 化し
  // 実行終了前に Firestore 書込が truncate される。await 付き呼出を契約化。
  it('aggregate cap block 内の safeLogError 呼出に await が付いている', () => {
    const AWAITED_SAFE_LOG_ERROR = /\bawait\s+safeLogError\s*\(/;
    expect(AWAITED_SAFE_LOG_ERROR.test(capBlock)).to.equal(
      true,
      'aggregate cap block 内の safeLogError 呼出に await が付いていない。' +
        'Cloud Functions 実行終了前に Firestore 書込が truncate される silent failure リスクあり。'
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
    const ERROR_PARAM = /\berror\s*[,:}]/;
    expect(ERROR_PARAM.test(safeLogErrorArgs)).to.equal(
      true,
      'safeLogError 引数に error が含まれていない。' +
        'stack trace が errors collection に残らず原因追跡不能になる。'
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

  describe('extractAggregateCapBlock detection logic', () => {
    it('positive: 通常の if block を抽出する', () => {
      const fixture = `
const before = 100;
if (afterAggregateChars < beforeAggregateChars) {
  console.warn('truncated');
  await safeLogError({ error, source: 'ocr' });
}
`;
      const block = extractAggregateCapBlock(fixture);
      expect(block).to.include('safeLogError');
      expect(block.startsWith('{')).to.equal(true);
      expect(block.endsWith('}')).to.equal(true);
    });

    it('positive: ネストしたブロック (try-catch 等) を正しくカウントする', () => {
      const fixture = `
if (afterAggregateChars < beforeAggregateChars) {
  try { await safeLogError({ error }); } catch (e) { console.error(e); }
}
`;
      const block = extractAggregateCapBlock(fixture);
      expect(block).to.include('try');
      expect(block).to.include('catch');
    });

    it('negative: anchor 不在時は空文字', () => {
      const fixture = `const x = 1;`;
      expect(extractAggregateCapBlock(fixture)).to.equal('');
    });

    it('scope: block 外の safeLogError は検知対象外', () => {
      // aggregate cap block 以外での safeLogError 呼出は本契約の検知対象外であることを確認。
      const fixture = `
await safeLogError({ error, source: 'other' });
if (afterAggregateChars < beforeAggregateChars) {
  console.warn('truncated');
}
`;
      const block = extractAggregateCapBlock(fixture);
      expect(/\bsafeLogError\s*\(/.test(block)).to.equal(
        false,
        'block 外の safeLogError 呼出が block 抽出結果に含まれてはならない'
      );
    });
  });
});
