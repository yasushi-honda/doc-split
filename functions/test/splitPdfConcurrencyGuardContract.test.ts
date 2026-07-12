/**
 * splitPdf 二重split race防止の grep contract テスト (Issue #539)
 *
 * splitPdf は同一documentIdへの並行呼出しに対する排他制御を持たない設計だったため、
 * 二重クリック/クライアント再送等でstatus='split'書込みが競合すると、片方が生成した
 * 子ドキュメントが親のsplitIntoから参照されない孤児になるリスクがあった
 * (Issue #432と同種の「気づかれない重複・孤児データ」リスク)。
 *
 * 対策は2層 (rotatePdfPagesの既存パターンを踏襲):
 *   1. 早期拒否: 読取り時点でstatus==='split'なら重い処理(PDF分割/Storage書込み)前に
 *      already-existsで拒否する
 *   2. 楽観的並行性制御: batch.update(docRef, ..., {lastUpdateTime})で、読取り〜書込みの
 *      間に他プロセスが親docを更新していたら FAILED_PRECONDITION で commit 自体が拒否される
 *
 * ソース文字列レベルで配線の退行を防ぐ (splitPdfDocIdNamespace.test.ts と同形式)。
 * precondition自体の実際のFirestore挙動は splitPdfConcurrencyGuardIntegration.test.ts
 * (emulator) で検証する。
 *
 * Issue #622: splitPdf 関数体スコープに閉じた検索に統一する。
 * ファイル全体 (sourceText) を対象にした indexOf/exec は、detectSplitPoints (readDocWithDetail
 * を splitPdf より前に呼ぶ) や rotatePdfPages (同一の `{ lastUpdateTime: startUpdateTime }`
 * literal を持つ) 側の記述に偶然救われて pass する vacuous test になりうる。
 * splitPdf 本体の外にあるヘルパー (isFirestorePreconditionFailure / isFirestoreNotFound /
 * recheckParentBeforeRetry の定義自体) の検証のみ sourceText を使う。
 */

import { expect } from 'chai';
import { readFileSync } from 'fs';
import { resolve } from 'path';
// 削除すると Mocha esm-utils がこのファイルを ESM として load し、
// `ReferenceError: __dirname is not defined in ES module scope` で test 全体が
// load 失敗する (NodeNext + ローカル import なし時の挙動、splitPdfDocIdNamespace.test.ts と同型)。
// 副作用ゼロの local import を 1 つ追加することで CJS loader に推論させる workaround。
import '../src/storage/storageDeletionGuard';

const SOURCE_PATH = resolve(__dirname, '..', 'src/pdf/pdfOperations.ts');
const sourceText = readFileSync(SOURCE_PATH, 'utf-8');

/**
 * splitPdf 関数の export 行から、対応する `);` までを括弧バランスで抽出する
 * (rotatePdfPagesContract.test.ts の extractRotatePdfPagesFunctionBody と同形式)。
 * detectSplitPoints 等の他関数にある同名 literal (readDocWithDetail 等) への
 * 誤マッチを避けるため、grep contract は本関数の戻り値のみを対象にする。
 */
function extractSplitPdfFunctionBody(): string {
  const startMarker = 'export const splitPdf = onCall(';
  const startIdx = sourceText.indexOf(startMarker);
  expect(startIdx, 'splitPdf 関数が見つからない').to.be.greaterThan(-1);

  let depth = 0;
  let i = startIdx + startMarker.length - 1; // `(` 位置
  for (; i < sourceText.length; i++) {
    if (sourceText[i] === '(') depth++;
    else if (sourceText[i] === ')') {
      depth--;
      if (depth === 0) break;
    }
  }
  const endIdx = sourceText.indexOf(';', i) + 1;
  return sourceText.slice(startIdx, endIdx);
}

describe('splitPdf 二重split race防止 grep contract (Issue #539)', () => {
  let splitPdfBody: string;

  before(() => {
    splitPdfBody = extractSplitPdfFunctionBody();
  });

  it("早期拒否: docData.status === 'split' なら already-exists で拒否する", () => {
    expect(splitPdfBody).to.match(/docData\.status === 'split'/);
    expect(splitPdfBody).to.match(/'already-exists'/);
  });

  it('早期拒否チェックは readDocWithDetail の直後、PDF download より前にある (splitPdf 本体スコープ限定, Issue #622)', () => {
    const readIdx = splitPdfBody.indexOf('await readDocWithDetail(db, docRef)');
    const statusCheckIdx = splitPdfBody.indexOf("docData.status === 'split'");
    const downloadIdx = splitPdfBody.indexOf('acquireSourceSnapshot(file)');
    expect(readIdx).to.be.greaterThan(-1);
    expect(statusCheckIdx, 'status check must be found').to.be.greaterThan(readIdx);
    expect(downloadIdx).to.be.greaterThan(statusCheckIdx);
  });

  it('startUpdateTime を読取り時点のsnapshotから保持しnullガードする (retry時再代入のためlet)', () => {
    expect(splitPdfBody).to.match(/let startUpdateTime = docSnapshot\.updateTime;/);
    expect(splitPdfBody).to.match(/if \(!startUpdateTime\) \{/);
  });

  it('drift retry前に recheckParentBeforeRetry で親docを再チェックし startUpdateTime を更新する (Issue #539 fix: stale precondition誤検知防止)', () => {
    expect(sourceText).to.match(/async function recheckParentBeforeRetry\(/);
    // T1 (sourceSnapshot取得時drift) と T3 (final drift) の両方の retry 直前で呼ばれる
    const callSites = splitPdfBody.match(
      /startUpdateTime = await recheckParentBeforeRetry\(docRef, documentId, docData\.status, fileUrl\);/g
    );
    expect(callSites, 'recheckParentBeforeRetry call sites must be found').to.not.be.null;
    expect(callSites!.length, 'must be called at both T1 and T3 retry points').to.equal(2);
  });

  it('recheckParentBeforeRetry は already-exists / not-found / failed-precondition の3系統に加え status/fileUrl drift も判定する (Codex PR #623 P1 fix)', () => {
    // recheckParentBeforeRetry は splitPdf 関数体の外で定義されたヘルパーのため sourceText 全体から抽出する
    const fnMatch = /async function recheckParentBeforeRetry\([\s\S]{0,1400}?\n}/.exec(sourceText);
    expect(fnMatch, 'recheckParentBeforeRetry function body must be found').to.not.be.null;
    const fnBody = fnMatch![0];
    expect(fnBody).to.match(/if \(!snap\.exists\) \{/);
    expect(fnBody).to.match(/'not-found'/);
    expect(fnBody).to.match(/data\.status === 'split'/);
    expect(fnBody).to.match(/'already-exists'/);
    // Codex P1: statusまたはfileUrlが初回読取りから変化していたら、docData/sourcePageResults等の
    // 実処理データがstaleなままrebaseされてしまうため、updateTimeのみのrebaseは行わずabortする
    expect(fnBody).to.match(
      /data\.status !== expectedStatus \|\| data\.fileUrl !== expectedFileUrl/
    );
    expect(fnBody).to.match(/if \(!updateTime\) \{/);
    expect(fnBody).to.match(/'failed-precondition'/);
  });

  it('親doc更新は lastUpdateTime precondition 付きの batch.update である (splitPdf 本体スコープ限定, Issue #622)', () => {
    const updateMatch = /batch\.update\(\s*docRef,/.exec(splitPdfBody);
    const preconditionMatch = /\{\s*lastUpdateTime:\s*startUpdateTime\s*\}/.exec(splitPdfBody);
    expect(updateMatch, 'batch.update(docRef, ...) call site must be found').to.not.be.null;
    expect(preconditionMatch, 'lastUpdateTime precondition must be found').to.not.be.null;
    expect(preconditionMatch!.index).to.be.greaterThan(updateMatch!.index);
  });

  it('precondition mismatch は internal ではなく aborted で区別される (rotatePdfPagesと共通の isFirestorePreconditionFailure ヘルパー)', () => {
    // isFirestorePreconditionFailure 自体は splitPdf 関数体の外で定義されたヘルパーのため sourceText で確認
    expect(sourceText).to.match(/export function isFirestorePreconditionFailure\(/);
    expect(sourceText).to.match(/errCode === 9/); // FAILED_PRECONDITION (ヘルパー定義内)
    expect(sourceText).to.match(/errCode === 'failed-precondition'/);
    // 呼び出し箇所・分岐メッセージは splitPdf 本体スコープで検証
    expect(splitPdfBody).to.match(/isFirestorePreconditionFailure\(firestoreErr\)/);
    expect(splitPdfBody).to.match(
      /HttpsError\(\s*['"]aborted['"][\s\S]{0,200}concurrent split detected/
    );
  });

  it('NOT_FOUND (親doc削除) は FAILED_PRECONDITION (二重split) と区別したメッセージになる (Issue #620, #622)', () => {
    expect(sourceText).to.match(/function isFirestoreNotFound\(/);
    expect(splitPdfBody).to.match(/isFirestoreNotFound\(firestoreErr\)/);
    expect(splitPdfBody).to.match(
      /HttpsError\(\s*['"]aborted['"][\s\S]{0,200}was deleted during processing/
    );
  });

  it('precondition mismatch 時も既存の Storage cleanup を経由してから aborted へ分岐する (splitPdf 本体スコープ限定, Issue #622)', () => {
    const catchIdx = splitPdfBody.indexOf('} catch (firestoreErr) {');
    const cleanupCallMatch = /await cleanupAccumulatedStorageFiles\(\s*accumulated,\s*'firestoreBatch',/.exec(
      splitPdfBody
    );
    const preconditionCheckIdx = splitPdfBody.indexOf(
      'isFirestorePreconditionFailure(firestoreErr)'
    );
    expect(catchIdx).to.be.greaterThan(-1);
    expect(cleanupCallMatch, 'cleanup call site must be found').to.not.be.null;
    expect(cleanupCallMatch!.index).to.be.greaterThan(catchIdx);
    expect(preconditionCheckIdx).to.be.greaterThan(cleanupCallMatch!.index);
  });
});
