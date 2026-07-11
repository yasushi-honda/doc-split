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

describe('splitPdf 二重split race防止 grep contract (Issue #539)', () => {
  it("早期拒否: docData.status === 'split' なら already-exists で拒否する", () => {
    expect(sourceText).to.match(/docData\.status === 'split'/);
    expect(sourceText).to.match(/'already-exists'/);
  });

  it('早期拒否チェックは readDocWithDetail の直後、PDF download より前にある', () => {
    const readIdx = sourceText.indexOf('await readDocWithDetail(db, docRef)');
    const statusCheckIdx = sourceText.indexOf("docData.status === 'split'");
    const downloadIdx = sourceText.indexOf('acquireSourceSnapshot(file)');
    expect(readIdx).to.be.greaterThan(-1);
    expect(statusCheckIdx, 'status check must be found').to.be.greaterThan(readIdx);
    expect(downloadIdx).to.be.greaterThan(statusCheckIdx);
  });

  it('startUpdateTime を読取り時点のsnapshotから保持しnullガードする (retry時再代入のためlet)', () => {
    expect(sourceText).to.match(/let startUpdateTime = docSnapshot\.updateTime;/);
    expect(sourceText).to.match(/if \(!startUpdateTime\) \{/);
  });

  it('drift retry前に recheckParentBeforeRetry で親docを再チェックし startUpdateTime を更新する (Issue #539 fix: stale precondition誤検知防止)', () => {
    expect(sourceText).to.match(/async function recheckParentBeforeRetry\(/);
    // T1 (sourceSnapshot取得時drift) と T3 (final drift) の両方の retry 直前で呼ばれる
    const callSites = sourceText.match(
      /startUpdateTime = await recheckParentBeforeRetry\(docRef, documentId\);/g
    );
    expect(callSites, 'recheckParentBeforeRetry call sites must be found').to.not.be.null;
    expect(callSites!.length, 'must be called at both T1 and T3 retry points').to.equal(2);
  });

  it('recheckParentBeforeRetry は already-exists / not-found / failed-precondition の3系統を判定する', () => {
    const fnMatch = /async function recheckParentBeforeRetry\([\s\S]{0,900}?\n}/.exec(sourceText);
    expect(fnMatch, 'recheckParentBeforeRetry function body must be found').to.not.be.null;
    const fnBody = fnMatch![0];
    expect(fnBody).to.match(/if \(!snap\.exists\) \{/);
    expect(fnBody).to.match(/'not-found'/);
    expect(fnBody).to.match(/data\.status === 'split'/);
    expect(fnBody).to.match(/'already-exists'/);
    expect(fnBody).to.match(/if \(!updateTime\) \{/);
    expect(fnBody).to.match(/'failed-precondition'/);
  });

  it('親doc更新は lastUpdateTime precondition 付きの batch.update である', () => {
    const updateMatch = /batch\.update\(\s*docRef,/.exec(sourceText);
    const preconditionMatch = /\{\s*lastUpdateTime:\s*startUpdateTime\s*\}/.exec(sourceText);
    expect(updateMatch, 'batch.update(docRef, ...) call site must be found').to.not.be.null;
    expect(preconditionMatch, 'lastUpdateTime precondition must be found').to.not.be.null;
    expect(preconditionMatch!.index).to.be.greaterThan(updateMatch!.index);
  });

  it('precondition mismatch は internal ではなく aborted で区別される (rotatePdfPagesと共通の isFirestorePreconditionFailure ヘルパー)', () => {
    expect(sourceText).to.match(/function isFirestorePreconditionFailure\(/);
    expect(sourceText).to.match(/isFirestorePreconditionFailure\(firestoreErr\)/);
    expect(sourceText).to.match(/errCode === 9/); // FAILED_PRECONDITION (ヘルパー定義内)
    expect(sourceText).to.match(/errCode === 'failed-precondition'/);
    expect(sourceText).to.match(
      /HttpsError\(\s*['"]aborted['"][\s\S]{0,200}concurrent split detected/
    );
  });

  it('precondition mismatch 時も既存の Storage cleanup を経由してから aborted へ分岐する', () => {
    const catchIdx = sourceText.indexOf('} catch (firestoreErr) {');
    const cleanupCallMatch = /await cleanupAccumulatedStorageFiles\(\s*accumulated,\s*'firestoreBatch',/.exec(
      sourceText
    );
    const preconditionCheckIdx = sourceText.indexOf(
      'isFirestorePreconditionFailure(firestoreErr)'
    );
    expect(catchIdx).to.be.greaterThan(-1);
    expect(cleanupCallMatch, 'cleanup call site must be found').to.not.be.null;
    expect(cleanupCallMatch!.index).to.be.greaterThan(catchIdx);
    expect(preconditionCheckIdx).to.be.greaterThan(cleanupCallMatch!.index);
  });
});
