/**
 * summaryErrorClassification.ts のエラー分類 pure function unit test (Issue #251 Scope3)
 *
 * ADR-0027 PR-E: Gemini 専用だった空/ブロック応答の検知(SummaryBlockedError 等)と
 * HttpsError マッピングは、要約のGemini経路とともに撤去した。ここでは Sarashina 以外の
 * 例外の受け皿として残る classifySummaryError(quota / transient / unknown)だけを検証する。
 *
 * 方式: pure unit test (mocha + chai)。外部依存ゼロ、入力→出力の期待値比較のみ。
 */

import { expect } from 'chai';
import * as classification from '../src/ocr/summaryErrorClassification';
import { classifySummaryError } from '../src/ocr/summaryErrorClassification';

describe('classifySummaryError (#251 Scope3)', () => {
  it('429/RESOURCE_EXHAUSTED相当のエラーは quota に分類される (retry.tsのis429Errorを再利用)', () => {
    const error = new Error('429 Too Many Requests');
    expect(classifySummaryError(error)).to.equal('quota');
  });

  it('quotaに該当しない一時的エラー(503/timeout等)は transient に分類される', () => {
    const error = new Error('Service temporarily unavailable');
    expect(classifySummaryError(error)).to.equal('transient');
  });

  it('分類不能な未知のエラーは unknown に分類される', () => {
    const error = new Error('Unexpected parse failure');
    expect(classifySummaryError(error)).to.equal('unknown');
  });

  it('Error以外の非オブジェクトthrow値も例外を投げず unknown に分類される', () => {
    expect(classifySummaryError('not an error')).to.equal('unknown');
    expect(classifySummaryError(undefined)).to.equal('unknown');
  });

  it('Gemini専用だった空/ブロック応答の検知・HttpsErrorマッピングは公開されていない (PR-E)', () => {
    const exported = Object.keys(classification);
    expect(exported).to.deep.equal(['classifySummaryError']);
  });
});
