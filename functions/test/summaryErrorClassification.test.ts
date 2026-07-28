/**
 * summaryErrorClassification.ts の空/ブロック応答検知・エラー分類 pure function unit test
 * (Issue #251 Scope3)
 *
 * 背景 (#178/#209 教訓): Vertex AI が空/ブロック応答 (安全フィルタ等) を返した際、
 * finishReason/safetyRatings を記録しないまま「summary が空」の generic error に
 * なる silent failure を防ぐ。summaryGenerator.ts は rateLimiter.ts 経由でモジュール
 * レベル admin.firestore() に依存し admin.initializeApp() 未実行では import できない
 * ため、抽出・分類ロジックは side-effect-free な summaryErrorClassification.ts に
 * 分離してある (#196 の ocr/constants.ts と同じ方式、#251 Scope1 の mock 導入コストも回避)。
 *
 * 方式: pure unit test (mocha + chai)。外部依存ゼロ、入力→出力の期待値比較のみ。
 */

import { expect } from 'chai';
import {
  extractBlockedSummaryDetails,
  SummaryBlockedError,
  classifySummaryError,
  mapSummaryErrorToHttpsError,
} from '../src/ocr/summaryErrorClassification';

describe('extractBlockedSummaryDetails (#251 Scope3)', () => {
  it('finishReason/safetyRatings/blockReasonが揃っている場合はそのまま抽出する', () => {
    const details = extractBlockedSummaryDetails({
      candidates: [{ finishReason: 'SAFETY', safetyRatings: [{ category: 'HARM', probability: 'HIGH' }] }],
      promptFeedback: { blockReason: 'SAFETY' },
    });
    expect(details.finishReason).to.equal('SAFETY');
    expect(details.safetyRatings).to.deep.equal([{ category: 'HARM', probability: 'HIGH' }]);
    expect(details.blockReason).to.equal('SAFETY');
  });

  it('candidatesが空配列の場合はfinishReason/safetyRatingsがundefinedになる', () => {
    const details = extractBlockedSummaryDetails({ candidates: [] });
    expect(details.finishReason).to.be.undefined;
    expect(details.safetyRatings).to.be.undefined;
    expect(details.blockReason).to.be.undefined;
  });

  it('candidates/promptFeedbackが両方とも未定義でも例外を投げず全項目undefinedを返す', () => {
    const details = extractBlockedSummaryDetails({});
    expect(details.finishReason).to.be.undefined;
    expect(details.safetyRatings).to.be.undefined;
    expect(details.blockReason).to.be.undefined;
  });
});

describe('SummaryBlockedError (#251 Scope3)', () => {
  it('メッセージにfinishReason/blockReason/safetyRatingsが埋め込まれる', () => {
    const error = new SummaryBlockedError({
      finishReason: 'SAFETY',
      blockReason: 'SAFETY',
      safetyRatings: [{ category: 'HARM', probability: 'HIGH' }],
    });
    expect(error.message).to.include('finishReason=SAFETY');
    expect(error.message).to.include('blockReason=SAFETY');
    expect(error.message).to.include('HARM');
    expect(error.name).to.equal('SummaryBlockedError');
    expect(error.details.finishReason).to.equal('SAFETY');
  });

  it('全項目未定義でも unknown/none で埋め込まれ例外を投げない', () => {
    const error = new SummaryBlockedError({});
    expect(error.message).to.include('finishReason=unknown');
    expect(error.message).to.include('blockReason=none');
  });
});

describe('classifySummaryError (#251 Scope3)', () => {
  it('SummaryBlockedErrorは blocked に分類される', () => {
    const error = new SummaryBlockedError({ finishReason: 'SAFETY' });
    expect(classifySummaryError(error)).to.equal('blocked');
  });

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
});

describe('mapSummaryErrorToHttpsError (#251 Scope3 /code-review指摘: regenerateSummary.ts本体は' +
  'firebase-admin依存でテストプールから直接検証できないため、コード/メッセージ対応をここで担保する)', () => {
  it('quotaは resource-exhausted + 割当上限メッセージへマップされる', () => {
    const mapping = mapSummaryErrorToHttpsError('quota');
    expect(mapping?.code).to.equal('resource-exhausted');
    expect(mapping?.message).to.include('割当上限');
  });

  it('transientは unavailable + 一時的に利用できないメッセージへマップされる', () => {
    const mapping = mapSummaryErrorToHttpsError('transient');
    expect(mapping?.code).to.equal('unavailable');
    expect(mapping?.message).to.include('一時的に利用できません');
  });

  it('blockedは failed-precondition + 内容起因メッセージへマップされる', () => {
    const mapping = mapSummaryErrorToHttpsError('blocked');
    expect(mapping?.code).to.equal('failed-precondition');
    expect(mapping?.message).to.include('内容から要約を生成できませんでした');
  });

  it('unknownは null を返し caller 側で元エラーの rethrow を促す', () => {
    expect(mapSummaryErrorToHttpsError('unknown')).to.equal(null);
  });

  it('quota/transient/blockedの3コードは互いに異なるHttpsErrorコードを持つ (取り違え防止)', () => {
    const codes = (['quota', 'transient', 'blocked'] as const).map(
      (c) => mapSummaryErrorToHttpsError(c)?.code
    );
    expect(new Set(codes).size).to.equal(3);
  });
});
