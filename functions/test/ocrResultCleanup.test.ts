/**
 * OCR結果Storageクリーンアップ純粋関数のunit test (Issue #625)
 *
 * firebase-admin初期化なしで検証する (summaryPromptBuilder.test.ts等と同方針)。
 */

import { expect } from 'chai';
import {
  computeOcrResultObjectsToDelete,
  shouldSkipCompensatingDelete,
  shouldSkipSuccessCleanup,
} from '../src/ocr/ocrResultCleanup';

describe('computeOcrResultObjectsToDelete (Issue #625)', () => {
  it('keepObjectNameと異なる全オブジェクトを削除対象として返す', () => {
    const all = [
      'ocr-results/doc1/run-a.txt',
      'ocr-results/doc1/run-b.txt',
      'ocr-results/doc1/run-c.txt',
    ];
    expect(computeOcrResultObjectsToDelete(all, 'ocr-results/doc1/run-b.txt')).to.deep.equal([
      'ocr-results/doc1/run-a.txt',
      'ocr-results/doc1/run-c.txt',
    ]);
  });

  it('keepObjectNameがnullの場合は全件を削除対象とする(今回Storage保存が発生しなかった場合)', () => {
    const all = ['ocr-results/doc1/run-a.txt', 'ocr-results/doc1/run-b.txt'];
    expect(computeOcrResultObjectsToDelete(all, null)).to.deep.equal(all);
  });

  it('空配列を渡した場合は空配列を返す', () => {
    expect(computeOcrResultObjectsToDelete([], 'ocr-results/doc1/run-a.txt')).to.deep.equal([]);
  });

  it('keepObjectNameがlisting結果に存在しない場合は全件を削除対象とする', () => {
    const all = ['ocr-results/doc1/run-a.txt'];
    expect(computeOcrResultObjectsToDelete(all, 'ocr-results/doc1/run-zzz.txt')).to.deep.equal(all);
  });

  it('keepObjectName以外にオブジェクトが存在しない場合は空配列を返す', () => {
    const all = ['ocr-results/doc1/run-a.txt'];
    expect(computeOcrResultObjectsToDelete(all, 'ocr-results/doc1/run-a.txt')).to.deep.equal([]);
  });
});

describe('shouldSkipCompensatingDelete (Issue #625)', () => {
  it('ドキュメントがprocessedかつocrRunId一致 → スキップする(実は採用されていた)', () => {
    expect(shouldSkipCompensatingDelete(true, 'processed', 'run-a', 'run-a')).to.be.true;
  });

  it('ドキュメントが存在しない(削除済み) → スキップしない(補償削除してよい)', () => {
    expect(shouldSkipCompensatingDelete(false, undefined, undefined, 'run-a')).to.be.false;
  });

  it('ocrRunIdが別の値(所有権を失った) → スキップしない', () => {
    expect(shouldSkipCompensatingDelete(true, 'processing', 'run-b', 'run-a')).to.be.false;
  });

  it('statusがprocessedでない(まだprocessing等) → スキップしない', () => {
    expect(shouldSkipCompensatingDelete(true, 'processing', 'run-a', 'run-a')).to.be.false;
  });

  it('statusがprocessedだがocrRunIdが異なる(別runが既に上書き) → スキップしない', () => {
    expect(shouldSkipCompensatingDelete(true, 'processed', 'run-b', 'run-a')).to.be.false;
  });
});

describe('shouldSkipSuccessCleanup (Issue #625、/code-review low 指摘反映)', () => {
  it('ocrRunIdが依然一致 → スキップしない(cleanupしてよい)', () => {
    expect(shouldSkipSuccessCleanup(true, 'run-a', 'run-a')).to.be.false;
  });

  it('後続runにより既にocrRunIdが上書きされている → スキップする(誤削除防止)', () => {
    expect(shouldSkipSuccessCleanup(true, 'run-b', 'run-a')).to.be.true;
  });

  it('ドキュメントが削除されている → スキップする', () => {
    expect(shouldSkipSuccessCleanup(false, undefined, 'run-a')).to.be.true;
  });
});
