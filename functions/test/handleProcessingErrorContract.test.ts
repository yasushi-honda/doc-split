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
 *   1. 関数本体を brace-nesting で抽出 (extractBraceBlock + signature prefix)
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
import { SAFE_LOG_ERROR_CALL } from './helpers/patterns';

const OCR_PROCESSOR_PATH = 'src/ocr/ocrProcessor.ts';

// brace/paren 抽出は共通 helper (extractBraceBlock / extractParenBlock) を使用 (#302)。
// 関数本体の抽出 = brace-nesting、safeLogError 引数の抽出 = paren-nesting で scope を絞ることで
// 無関係な同名変数・他 logger 呼出・文字列リテラルへの偽陽性を回避する。

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
  // Issue #962: catch(updateErr)ブロック内に専用のsafeLogError呼出を追加したため、
  // SAFE_LOG_ERROR_CALL(非global正規表現)の素朴な最初のmatchはupdateErr側を拾ってしまう。
  // updateErrブロックをbrace-nestingで先に切り出し、その「後ろ」の残りソースから
  // 末尾(元のerror用)のsafeLogError呼出を抽出することで、両呼出を別々に検証する。
  const updateErrBlock = extractBraceBlock(functionBody, /catch\s*\(updateErr\)/);
  const updateErrSafeLogErrorArgs = extractParenBlock(updateErrBlock, SAFE_LOG_ERROR_CALL);
  const afterUpdateErrBlock =
    functionBody !== null && updateErrBlock !== null
      ? functionBody.slice(functionBody.indexOf(updateErrBlock) + updateErrBlock.length)
      : null;
  const safeLogErrorArgs = extractParenBlock(afterUpdateErrBlock, SAFE_LOG_ERROR_CALL);

  it('handleProcessingError 関数本体が抽出できる', () => {
    expect(
      functionBody,
      '`export async function handleProcessingError(` 宣言が見つからない。' +
        'リネーム/シグネチャ変更時は本契約の見直しが必要。'
    ).to.not.be.null;
  });

  it('handleProcessingError 本体内に safeLogError 呼出がある', () => {
    // #312 PR-2 (comment-analyzer Important 3): 以前 block 内に再宣言していた SAFE_LOG_ERROR_CALL を
    // file-level 定数 (L32) に統一。
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

  // Issue #962: catch(updateErr)のfallback節(状態更新自体のリトライ枯渇)はconsole.errorのみで
  // Sentry等のアラート経路(safeLogError)に乗っていなかった。専用のsafeLogError呼出を要求する。
  describe('catch(updateErr) 内の safeLogError 呼出 (Issue #962)', () => {
    it('catch(updateErr) ブロックが抽出できる', () => {
      expect(
        updateErrBlock,
        '`catch (updateErr)` ブロックが見つからない。' +
          '状態更新リトライのfallback構造が変更された場合は本契約の見直しが必要。'
      ).to.not.be.null;
    });

    it('catch(updateErr) 内に safeLogError 呼出がある', () => {
      expect(updateErrBlock, 'updateErrBlock 抽出失敗 (上位 it を確認)').to.not.be.null;
      expect(SAFE_LOG_ERROR_CALL.test(updateErrBlock!)).to.equal(
        true,
        'catch(updateErr) 内で safeLogError 呼出が見つからない。' +
          '状態更新自体のリトライ枯渇(元のerrorより深刻な事象)がSentyへ届かなくなる (Issue #962)。'
      );
    });

    it('updateErr用 safeLogError 引数ブロックが抽出できる', () => {
      expect(
        updateErrSafeLogErrorArgs,
        'catch(updateErr) 内の safeLogError(...) 引数ブロックが抽出できない。'
      ).to.not.be.null;
    });

    it('updateErr用 safeLogError 引数に updateErr (error) が渡されている', () => {
      const UPDATE_ERR_PARAM = /\bupdateErr\b/;
      expect(updateErrSafeLogErrorArgs, '抽出失敗 (上位 it を確認)').to.not.be.null;
      expect(UPDATE_ERR_PARAM.test(updateErrSafeLogErrorArgs!)).to.equal(
        true,
        'safeLogError 引数に updateErr が渡されていない。stack trace が失われる。'
      );
    });

    it('updateErr用 safeLogError 引数に source: \'ocr\' が含まれる', () => {
      const SOURCE_OCR = /source:\s*['"]ocr['"]/;
      expect(updateErrSafeLogErrorArgs, '抽出失敗').to.not.be.null;
      expect(SOURCE_OCR.test(updateErrSafeLogErrorArgs!)).to.equal(true);
    });

    it('updateErr用 safeLogError 引数に documentId が渡されている', () => {
      const DOCUMENT_ID_PARAM = /\bdocumentId\s*[,:}]/;
      expect(updateErrSafeLogErrorArgs, '抽出失敗').to.not.be.null;
      expect(DOCUMENT_ID_PARAM.test(updateErrSafeLogErrorArgs!)).to.equal(true);
    });

    it('updateErr用 safeLogError 引数の functionName が、元のerror用呼出と区別できるタグを持つ', () => {
      // 同一functionNameだとSentry/errors collection上で「状態更新自体の失敗」と
      // 「元のOCR処理エラー」が区別できなくなる (Issue #962 の課題2そのもの)。
      const FUNCTION_NAME_PARAM = /\bfunctionName\s*[,:}]/;
      expect(updateErrSafeLogErrorArgs, '抽出失敗').to.not.be.null;
      expect(FUNCTION_NAME_PARAM.test(updateErrSafeLogErrorArgs!)).to.equal(true);
      expect(updateErrSafeLogErrorArgs!).to.match(
        /functionName:\s*`?\$\{functionName\}[^,}]*updateErr/i,
        'functionName が元の呼出元名をそのまま流用しており、updateErr発生を示すタグが付与されていない。'
      );
    });
  });

  // #312 PR-2 B2 方針 (pr-test-analyzer S1): signature prefix anchor の挙動を lock-in する目的で
  // 残置。extractBraceBlock.test.ts の helper 単体テストでは ANCHOR (= signature string) 変更の
  // regression を検知できないため、本 describe が直接捕捉する。positive/nested/negative を網羅。
  describe('関数本体抽出ロジック (extractBraceBlock + signature prefix)', () => {
    it('positive: 通常の関数本体を抽出する', () => {
      const fixture = `
export async function foo() {
  const x = 1;
  return x;
}
`;
      const body = extractBraceBlock(fixture, 'export async function foo(');
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
      const body = extractBraceBlock(fixture, 'export async function foo(');
      expect(body, '関数本体が抽出できていない').to.not.be.null;
      expect(body!).to.include('break');
      expect(body!).to.include('return 1');
    });

    it('negative: 関数宣言不在時は null', () => {
      const fixture = `const x = 1;`;
      const body = extractBraceBlock(fixture, 'export async function foo(');
      expect(body).to.be.null;
    });
  });

  // #312 PR-2 B2 方針 (pr-test-analyzer S1): SAFE_LOG_ERROR_CALL anchor の挙動を lock-in する
  // 目的で残置。positive/nested/negative/scope で偽陽性防御 (関数本体内の無関係な functionName
  // 変数を引数ブロック抽出で除外) を保証。helper 単体テストでは ANCHOR 変更の regression を
  // 検知できないため本 describe が直接捕捉する。
  describe('safeLogError 引数ブロック抽出ロジック (extractParenBlock + SAFE_LOG_ERROR_CALL)', () => {
    it('positive: 単純な呼出から引数ブロックを抽出する', () => {
      const fixture = `await safeLogError({ error, source: 'ocr' });`;
      const args = extractParenBlock(fixture, SAFE_LOG_ERROR_CALL);
      expect(args, '引数ブロックが抽出できていない').to.not.be.null;
      expect(args!.startsWith('(')).to.equal(true);
      expect(args!.endsWith(')')).to.equal(true);
      expect(args!).to.include("source: 'ocr'");
    });

    it('positive: 引数内の括弧 (関数呼出等) をネストカウントする', () => {
      const fixture = `safeLogError({ error: wrap(raw), source: 'ocr' });`;
      const args = extractParenBlock(fixture, SAFE_LOG_ERROR_CALL);
      expect(args, '引数ブロックが抽出できていない').to.not.be.null;
      expect(args!).to.include('wrap(raw)');
      expect(args!.endsWith(')')).to.equal(true);
    });

    it('negative: safeLogError 呼出不在時は null', () => {
      const fixture = `console.error('failed');`;
      const args = extractParenBlock(fixture, SAFE_LOG_ERROR_CALL);
      expect(args).to.be.null;
    });

    it('scope: 関数本体内の無関係な functionName 変数は検知対象外', () => {
      // safeLogError 呼出の外にある functionName は引数ブロック抽出で除外されること。
      const fixture = [
        `const functionName = 'fake';`,
        `safeLogError({ error, source: 'ocr', documentId: id });`,
      ].join('\n');
      const args = extractParenBlock(fixture, SAFE_LOG_ERROR_CALL);
      expect(args, '引数ブロックが抽出できていない').to.not.be.null;
      expect(args!).to.not.include("'fake'");
      expect(/\bfunctionName\s*[,:}]/.test(args!)).to.equal(
        false,
        '引数ブロック外の functionName 変数が含まれてはならない (偽陽性防御)'
      );
    });
  });
});
