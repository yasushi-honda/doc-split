/**
 * ocrProcessor.ts の OCR結果Storageクリーンアップ配線契約テスト (Issue #625)
 *
 * `cleanupOrphanedOcrResultObjects` / `compensateDeleteOnFailure` は Storage/Firestore
 * 副作用が大きく processDocument を直接呼び出しては検証できない(既存 ocrRunGuardIntegration
 * 等と同方針)。本テストは呼出し配置をソース文字列レベルで lock-in する
 * (docs/context/test-strategy.md §2.1 のgrep-based契約パターン踏襲)。
 *
 * Issue #622 教訓: grep anchor をファイル全体に対して緩く書くと、無関係な箇所に
 * マッチして vacuous になりうる。本テストは processDocument 関数本体のみを
 * extractBraceBlock で抽出してからマッチさせ、スコープを限定する。
 */

import { expect } from 'chai';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { extractBraceBlock } from './helpers/extractBraceBlock';

const OCR_PROCESSOR_PATH = 'src/ocr/ocrProcessor.ts';
const PROCESS_DOCUMENT_ANCHOR = /export\s+async\s+function\s+processDocument\s*\(/;

const CLEANUP_FN_ANCHOR = /async\s+function\s+cleanupOrphanedOcrResultObjects\s*\(/;
const IS_CURRENT_OWNER_FN_ANCHOR = /async\s+function\s+isStillCurrentOwner\s*\(/;

/**
 * ファイル内で anchor が単一マッチであることを表明するヘルパー。
 * 2つ目の定義が追加された場合、extractBraceBlock の anchor は最初の定義に
 * マッチし続けるため、narrow 漏れによる vacuous test (#622 同種) を防ぐ。
 */
function expectSingleDefinition(source: string, pattern: RegExp, label: string): void {
  const count = (source.match(pattern) ?? []).length;
  expect(count, `${label} の定義が複数存在する場合は anchor の narrow が必要`).to.equal(1);
}

describe('ocrProcessor OCR結果クリーンアップ配線契約 (Issue #625)', () => {
  let processDocumentBody = '';
  let cleanupFunctionBody = '';
  let isStillCurrentOwnerBody = '';

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

    expectSingleDefinition(
      source,
      /async\s+function\s+cleanupOrphanedOcrResultObjects\s*\(/g,
      'cleanupOrphanedOcrResultObjects'
    );
    const cleanupBody = extractBraceBlock(source, CLEANUP_FN_ANCHOR);
    expect(cleanupBody, 'cleanupOrphanedOcrResultObjects 関数本体の抽出に失敗した').to.not.be.null;
    cleanupFunctionBody = cleanupBody!;

    expectSingleDefinition(
      source,
      /async\s+function\s+isStillCurrentOwner\s*\(/g,
      'isStillCurrentOwner'
    );
    const ownerCheckBody = extractBraceBlock(source, IS_CURRENT_OWNER_FN_ANCHOR);
    expect(ownerCheckBody, 'isStillCurrentOwner 関数本体の抽出に失敗した').to.not.be.null;
    isStillCurrentOwnerBody = ownerCheckBody!;
  });

  /**
   * processDocument内には capPageResultsAggregate 用の try/catch (Issue #293/#297) が
   * 先行して存在するため、`}\s*catch\s*\(\s*err\s*\)` を processDocumentBody 全体に対して
   * 素朴にマッチさせると先行 catch を誤って拾う(#622 と同種の vacuous risk)。
   * `await applyOcrCompletionTransaction(` 以降にスコープを絞り、その直後のcatchのみを抽出する。
   *
   * kanameone現場要件「複数顧客FAX複製機能」(GOAL.md)対応で、最終transaction本体
   * (`db.runTransaction(...)`)は processDocument から applyOcrCompletionTransaction() へ
   * 抽出済み(OCR/Storage副作用を含まず単体でintegration test可能にするため)。
   * processDocument側のtry/catch(補償削除の配線)自体は変更していないため、
   * anchorを db.runTransaction( → applyOcrCompletionTransaction( に更新するのみで
   * Issue #625の不変条件は引き続き同じテストで検証できる。
   */
  function extractRunTransactionCatchBlock(): string {
    const callIdx = processDocumentBody.indexOf('await applyOcrCompletionTransaction(');
    expect(callIdx, 'await applyOcrCompletionTransaction( が見つからない').to.be.greaterThan(-1);
    const fromCall = processDocumentBody.slice(callIdx);

    const callArgsBlock = extractBraceBlock(
      fromCall,
      'await applyOcrCompletionTransaction(',
      { anchorMode: 'after-match' }
    );
    expect(callArgsBlock, 'applyOcrCompletionTransaction呼出引数の抽出に失敗した').to.not.be
      .null;

    const afterCallIdx = fromCall.indexOf(callArgsBlock!) + callArgsBlock!.length;
    const afterCall = fromCall.slice(afterCallIdx);

    const catchBlock = extractBraceBlock(afterCall, /\}\s*catch\s*\(\s*err\s*\)\s*/, {
      anchorMode: 'after-match',
    });
    expect(catchBlock, 'applyOcrCompletionTransaction呼出直後のcatchブロックが抽出できない').to.not.be.null;
    return catchBlock!;
  }

  it('最終transactionはtry/catchで包まれている', () => {
    // kanameone現場要件対応(code-review high指摘)で、flag読取(isFaxDuplicationEnabled)を
    // try直後・applyOcrCompletionTransaction呼出より前に配置したため、try{直後に
    // 呼出が来ることを厳密に要求する旧アサーションは緩和する。processDocument内には
    // capPageResultsAggregate用の先行try/catch(Issue #293/#297)も存在するため、
    // 単純に最初の"try {"を拾うと誤検出する(#622同種のvacuous risk)。
    // applyOcrCompletionTransaction呼出の直前にある"try {"まで遡り、その間に
    // ブロックを閉じる"}"が挟まっていない(=同一tryブロック内である)ことを確認する。
    const callIdx = processDocumentBody.indexOf('await applyOcrCompletionTransaction(');
    expect(callIdx, 'await applyOcrCompletionTransaction( が見つからない').to.be.greaterThan(-1);
    const beforeCall = processDocumentBody.slice(0, callIdx);
    const lastTryIdx = beforeCall.lastIndexOf('try {');
    expect(lastTryIdx, 'applyOcrCompletionTransaction呼出より前にtry {が見つからない').to.be.greaterThan(-1);
    const between = processDocumentBody.slice(lastTryIdx, callIdx);
    expect(
      between,
      'applyOcrCompletionTransaction呼出がtry/catchで包まれていない — 失敗時の補償削除が配線されていない'
    ).to.not.match(/\}/);
  });

  it('catchブロックはocrResultUrlがある場合のみcompensateDeleteOnFailureを呼ぶ', () => {
    const catchBlock = extractRunTransactionCatchBlock();

    expect(catchBlock).to.match(
      /if\s*\(\s*ocrResultUrl\s*\)\s*\{/,
      'catchブロック内でocrResultUrlの有無を確認していない'
    );
    expect(catchBlock).to.match(
      /compensateDeleteOnFailure\s*\(\s*docId\s*,\s*ocrRunId\s*,\s*functionName\s*\)/,
      'catchブロック内でcompensateDeleteOnFailureが正しい引数で呼ばれていない'
    );
    expect(catchBlock).to.match(
      /throw\s+err\s*;/,
      'catchブロックが元のエラーをre-throwしていない — 呼出元processOCR.tsのsupersede/エラー処理を壊す'
    );
  });

  it('catchブロック内でcompensateDeleteOnFailureはthrow errより前に呼ばれる', () => {
    const catchBlock = extractRunTransactionCatchBlock();
    const compensateIdx = catchBlock.indexOf('compensateDeleteOnFailure(');
    const throwIdx = catchBlock.indexOf('throw err;');
    expect(compensateIdx, 'compensateDeleteOnFailure呼出が見つからない').to.be.greaterThan(-1);
    expect(throwIdx, 'throw err; が見つからない').to.be.greaterThan(-1);
    expect(compensateIdx).to.be.lessThan(throwIdx);
  });

  it('transaction成功後(catchブロックの外)でcleanupOrphanedOcrResultObjectsを呼ぶ', () => {
    // catchブロック終端以降、return文より前に呼ばれていることを確認する。
    const catchBlock = extractRunTransactionCatchBlock();
    const afterCatchIdx = processDocumentBody.indexOf(catchBlock) + catchBlock.length;
    const afterCatchSource = processDocumentBody.slice(afterCatchIdx);

    expect(afterCatchSource).to.match(
      /cleanupOrphanedOcrResultObjects\s*\(\s*docId\s*,\s*ocrRunId\s*,\s*ocrResultUrl\s*\?\s*ocrRunId\s*:\s*null\s*,\s*functionName\s*\)/,
      'transaction成功後にcleanupOrphanedOcrResultObjectsが正しい引数(検証用ocrRunId含む)で呼ばれていない'
    );

    const cleanupIdx = afterCatchSource.indexOf('cleanupOrphanedOcrResultObjects(');
    const returnIdx = afterCatchSource.indexOf('return {');
    expect(cleanupIdx, 'cleanupOrphanedOcrResultObjects呼出が見つからない').to.be.greaterThan(-1);
    expect(returnIdx, 'return文が見つからない').to.be.greaterThan(-1);
    expect(cleanupIdx).to.be.lessThan(returnIdx);
  });

  it('isStillCurrentOwnerはshouldSkipSuccessCleanupを正しい引数で呼ぶ', () => {
    expect(isStillCurrentOwnerBody).to.match(
      /shouldSkipSuccessCleanup\s*\(\s*snap\.exists\s*,\s*snap\.data\(\)\?\.\s*ocrRunId\s*,\s*ocrRunId\s*\)/,
      'shouldSkipSuccessCleanupが正しい引数で呼ばれていない'
    );
  });

  it('cleanupOrphanedOcrResultObjectsはlisting前にisStillCurrentOwnerで所有権を再確認する', () => {
    // 先行run自身の古い視点でのcleanupが、後続runが直近書き込んだ有効なオブジェクトを
    // 誤削除するレースを防ぐための安全確認。listing呼出しより前に配線されていること、
    // skip時はlisting自体を実行せずreturnすることを検証する(#622同種のvacuous test防止のため、
    // isStillCurrentOwner自体はisStillCurrentOwnerBodyで別途配線確認済み)。
    const preCheckIdx = cleanupFunctionBody.indexOf('isStillCurrentOwner(');
    const listingIdx = cleanupFunctionBody.indexOf('adapter.listObjectNames(');
    expect(preCheckIdx, 'listing前のisStillCurrentOwner呼出が見つからない').to.be.greaterThan(-1);
    expect(listingIdx, 'adapter.listObjectNames呼出が見つからない').to.be.greaterThan(-1);
    expect(preCheckIdx, 'isStillCurrentOwnerがlistingより後に配線されている').to.be.lessThan(
      listingIdx
    );

    expect(cleanupFunctionBody).to.match(
      /if\s*\(\s*!\s*\(\s*await\s+isStillCurrentOwner\s*\([\s\S]*?\)\s*\)\s*\)\s*\{[\s\S]*?return\s*;/,
      'isStillCurrentOwnerがfalseの場合にreturnしていない — listing/削除が実行されてしまう'
    );
  });

  it('cleanupOrphanedOcrResultObjectsは削除ループ内でも都度isStillCurrentOwnerを再検証しbreakする (CodeRabbit指摘反映 PR #629)', () => {
    // listing〜複数回deleteの間にも同じレースが起こりうるため、削除の都度所有権を
    // 再検証し、supersedeを検知した時点で残りの削除を中断してレースウィンドウを
    // 「削除1件ごと」まで縮小する。
    const forLoopIdx = cleanupFunctionBody.indexOf('for (const objectName of toDelete)');
    expect(forLoopIdx, 'for (const objectName of toDelete) ループが見つからない').to.be.greaterThan(
      -1
    );
    const ownerCheckCallCount = (cleanupFunctionBody.match(/isStillCurrentOwner\s*\(/g) ?? [])
      .length;
    expect(
      ownerCheckCallCount,
      'isStillCurrentOwner呼出がlisting前+ループ内の2箇所存在しない — 削除毎の再検証が配線されていない'
    ).to.equal(2);

    const loopBody = extractBraceBlock(
      cleanupFunctionBody.slice(forLoopIdx),
      'for (const objectName of toDelete)',
      { anchorMode: 'after-match' }
    );
    expect(loopBody, 'for ループ本体の抽出に失敗した').to.not.be.null;
    expect(loopBody).to.match(
      /if\s*\(\s*!\s*\(\s*await\s+isStillCurrentOwner\s*\([\s\S]*?\)\s*\)\s*\)\s*\{[\s\S]*?break\s*;/,
      'ループ内でisStillCurrentOwnerがfalseの場合にbreakしていない — supersede後も削除を継続してしまう'
    );

    const loopOwnerCheckIdx = loopBody!.indexOf('isStillCurrentOwner(');
    const loopDeleteIdx = loopBody!.indexOf('adapter.deleteObject(');
    expect(loopOwnerCheckIdx, 'ループ内のisStillCurrentOwner呼出が見つからない').to.be.greaterThan(
      -1
    );
    expect(loopDeleteIdx, 'ループ内のadapter.deleteObject呼出が見つからない').to.be.greaterThan(-1);
    expect(loopOwnerCheckIdx, 'ループ内でisStillCurrentOwnerがdeleteより後に配線されている').to.be
      .lessThan(loopDeleteIdx);
  });
});
