/**
 * generateSummary regression テスト (Issue #213)
 *
 * 目的:
 * - Vertex AI generateContent 呼び出しに maxOutputTokens=8192 が付与され続けることを保証 (Issue #209 再発防止)
 * - Firestore の summary フィールド書き込みに truncated/originalLength が同梱され続けることを保証 (#178 教訓)
 */

import { expect } from 'chai';
import {
  buildSummaryGenerationRequest,
  buildSummaryFields,
} from '../src/ocr/summaryRequestBuilder';
import { GEMINI_CONFIG } from '../src/utils/config';
import type { CappedText } from '../src/utils/pageTextCap';

describe('summaryRequestBuilder: buildSummaryGenerationRequest', () => {
  it('generationConfig.maxOutputTokens に GEMINI_CONFIG.maxOutputTokens を必ず設定する', () => {
    const req = buildSummaryGenerationRequest('test prompt');
    expect(req.generationConfig.maxOutputTokens).to.equal(GEMINI_CONFIG.maxOutputTokens);
  });

  it('Issue #209 再発防止: maxOutputTokens は 8192 で固定 (config整合性)', () => {
    const req = buildSummaryGenerationRequest('test prompt');
    expect(req.generationConfig.maxOutputTokens).to.equal(8192);
  });

  it('contents[0].parts[0].text に prompt 全文を含む', () => {
    const prompt = '【要約】以下のOCR結果を要約してください\n本文サンプル';
    const req = buildSummaryGenerationRequest(prompt);
    expect(req.contents).to.have.lengthOf(1);
    expect(req.contents[0].role).to.equal('user');
    expect(req.contents[0].parts).to.have.lengthOf(1);
    expect(req.contents[0].parts[0].text).to.equal(prompt);
  });

  it('空 prompt でも generationConfig は維持される (防御の不変条件)', () => {
    const req = buildSummaryGenerationRequest('');
    expect(req.generationConfig).to.deep.equal({ maxOutputTokens: 8192 });
  });

  it('長大 prompt (50K chars) でも generationConfig は維持される', () => {
    const longPrompt = 'a'.repeat(50_000);
    const req = buildSummaryGenerationRequest(longPrompt);
    expect(req.generationConfig.maxOutputTokens).to.equal(8192);
    expect(req.contents[0].parts[0].text.length).to.equal(50_000);
  });
});

describe('summaryRequestBuilder: buildSummaryFields', () => {
  it('truncated=false の通常ケースで3フィールド全てを返す (#178 教訓)', () => {
    const summary: CappedText = {
      text: '通常の要約テキスト',
      originalLength: 100,
      truncated: false,
    };
    expect(buildSummaryFields(summary)).to.deep.equal({
      summary: '通常の要約テキスト',
      summaryTruncated: false,
      summaryOriginalLength: 100,
    });
  });

  it('truncated=true の切り詰めケースでも3フィールド全てを返す', () => {
    const summary: CappedText = {
      text: '切り詰め後\n[TRUNCATED]',
      originalLength: 1_100_000,
      truncated: true,
    };
    expect(buildSummaryFields(summary)).to.deep.equal({
      summary: '切り詰め後\n[TRUNCATED]',
      summaryTruncated: true,
      summaryOriginalLength: 1_100_000,
    });
  });

  it('空 summary でも 3 フィールドが必ず含まれる (FE側マッピングを破壊しない)', () => {
    const summary: CappedText = { text: '', originalLength: 0, truncated: false };
    const fields = buildSummaryFields(summary);
    expect(Object.keys(fields).sort()).to.deep.equal([
      'summary',
      'summaryOriginalLength',
      'summaryTruncated',
    ]);
  });
});

describe('GEMINI_CONFIG: maxOutputTokens 不変条件', () => {
  it('Issue #205, #209 防御: maxOutputTokens は 8192 で固定', () => {
    expect(GEMINI_CONFIG.maxOutputTokens).to.equal(8192);
  });
});
