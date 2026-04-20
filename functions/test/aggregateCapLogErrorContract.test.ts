/**
 * aggregate cap 発動経路の safeLogError 呼出契約テスト (Issue #283)
 *
 * 目的: ocrProcessor.processDocument 内の aggregate cap block が、truncation 発動時に
 * safeLogError (errors collection + 通知) を呼び続けることを静的検証で保証する。
 *
 * 背景: 既存実装 (#282 マージ時点) は aggregate cap 発動時に console.warn のみを出しており、
 * warn level は Cloud Logging alert に拾われにくく、Issue #209 型実害 (Vertex AI 暴走 1.1M chars)
 * が運用側で認知できない silent failure 経路が残っていた。本契約は safeLogError 格上げ
 * (#283 Option B) を lock-in する。
 *
 * 方式: grep-based (docs/context/test-strategy.md §2.1 参照)。
 * anchor: `if (afterAggregateChars < beforeAggregateChars) { ... }`
 *
 * 将来委譲: 現時点で委譲先なし (aggregate cap 発動時の safeLogError 呼出保護は
 *          source 構造保護が本質のため恒久 contract として保持)
 */

import { expect } from 'chai';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { extractBraceBlock, extractParenBlock } from './helpers/extractBraceBlock';

const OCR_PROCESSOR_PATH = 'src/ocr/ocrProcessor.ts';
const AGGREGATE_CAP_ANCHOR =
  /if\s*\(\s*afterAggregateChars\s*<\s*beforeAggregateChars\s*\)\s*\{/;

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
    expect(
      capBlock,
      '`if (afterAggregateChars < beforeAggregateChars) { ... }` anchor が見つからない。' +
        '変数名リネーム/条件書き換え時は本契約の見直しが必要。'
    ).to.not.be.null;
  });

  it('aggregate cap block 内に safeLogError 呼出がある', () => {
    const SAFE_LOG_ERROR_CALL = /\bsafeLogError\s*\(/;
    expect(capBlock, 'capBlock 抽出失敗 (上位 it を確認)').to.not.be.null;
    expect(SAFE_LOG_ERROR_CALL.test(capBlock!)).to.equal(
      true,
      'aggregate cap block 内で safeLogError 呼出が見つからない。' +
        'errors collection への記録が消失すると #209 型実害の再発を認知できない (#283 silent failure)。'
    );
  });

  // #283 Codex review Low: Cloud Functions lifecycle で await 漏れは fire-and-forget 化し
  // 実行終了前に Firestore 書込が truncate される。await 付き呼出を契約化。
  it('aggregate cap block 内の safeLogError 呼出に await が付いている', () => {
    const AWAITED_SAFE_LOG_ERROR = /\bawait\s+safeLogError\s*\(/;
    expect(capBlock, 'capBlock 抽出失敗').to.not.be.null;
    expect(AWAITED_SAFE_LOG_ERROR.test(capBlock!)).to.equal(
      true,
      'aggregate cap block 内の safeLogError 呼出に await が付いていない。' +
        'Cloud Functions 実行終了前に Firestore 書込が truncate される silent failure リスクあり。'
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
    const ERROR_PARAM = /\berror\s*[,:}]/;
    expect(safeLogErrorArgs, 'safeLogErrorArgs 抽出失敗').to.not.be.null;
    expect(ERROR_PARAM.test(safeLogErrorArgs!)).to.equal(
      true,
      'safeLogError 引数に error が含まれていない。' +
        'stack trace が errors collection に残らず原因追跡不能になる。'
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

  // #312 PR-2 B2 方針 (pr-test-analyzer S1): ANCHOR 正規表現 (AGGREGATE_CAP_ANCHOR) 自体の挙動を
  // lock-in する目的で残置。extractBraceBlock.test.ts の helper 単体テストでは ANCHOR 変更の
  // regression を検知できない (helper は入力にのみ依存) ため、本 describe が ANCHOR 正規表現の
  // 変更回帰を直接捕捉する。将来 B1 (集約) への移行や削除を検討する際はこの責務を
  // どこに移すかを明示すること。
  describe('aggregate cap block 抽出ロジック (AGGREGATE_CAP_ANCHOR 検出)', () => {
    it('positive: 通常の if block を抽出する', () => {
      const fixture = `
const before = 100;
if (afterAggregateChars < beforeAggregateChars) {
  console.warn('truncated');
  await safeLogError({ error, source: 'ocr' });
}
`;
      const block = extractBraceBlock(fixture, AGGREGATE_CAP_ANCHOR);
      expect(block, 'block 抽出失敗').to.not.be.null;
      expect(block!).to.include('safeLogError');
      expect(block!.startsWith('{')).to.equal(true);
      expect(block!.endsWith('}')).to.equal(true);
    });

    it('positive: ネストしたブロック (try-catch 等) を正しくカウントする', () => {
      const fixture = `
if (afterAggregateChars < beforeAggregateChars) {
  try { await safeLogError({ error }); } catch (e) { console.error(e); }
}
`;
      const block = extractBraceBlock(fixture, AGGREGATE_CAP_ANCHOR);
      expect(block, 'block 抽出失敗').to.not.be.null;
      expect(block!).to.include('try');
      expect(block!).to.include('catch');
    });

    it('negative: anchor 不在時は null', () => {
      const fixture = `const x = 1;`;
      expect(extractBraceBlock(fixture, AGGREGATE_CAP_ANCHOR)).to.be.null;
    });

    it('scope: block 外の safeLogError は検知対象外', () => {
      // aggregate cap block 以外での safeLogError 呼出は本契約の検知対象外であることを確認。
      const fixture = `
await safeLogError({ error, source: 'other' });
if (afterAggregateChars < beforeAggregateChars) {
  console.warn('truncated');
}
`;
      const block = extractBraceBlock(fixture, AGGREGATE_CAP_ANCHOR);
      expect(block, 'block 抽出失敗').to.not.be.null;
      expect(/\bsafeLogError\s*\(/.test(block!)).to.equal(
        false,
        'block 外の safeLogError 呼出が block 抽出結果に含まれてはならない'
      );
    });
  });
});
