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
import type { SummaryField } from '../../shared/types';

describe('summaryRequestBuilder: buildSummaryGenerationRequest', () => {
  it('generationConfig.maxOutputTokens に GEMINI_CONFIG.maxOutputTokens を必ず設定する', () => {
    const req = buildSummaryGenerationRequest('test prompt');
    expect(req.generationConfig.maxOutputTokens).to.equal(GEMINI_CONFIG.maxOutputTokens);
  });

  // canary: GEMINI_CONFIG.maxOutputTokens を意図せず緩和した場合の安全網。
  // 値変更が必要なら #205/#209 の防御目的を再評価し、本テストも明示的に更新すること。
  it('canary: maxOutputTokens は 8192 で固定 (#205で導入、#209でsummary適用)', () => {
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

describe('summaryRequestBuilder: buildSummaryFields (Issue #215 discriminated union)', () => {
  it('truncated=false で { text, truncated:false } のみ返す (originalLength は型レベルで不在)', () => {
    const summary: SummaryField = {
      text: '通常の要約テキスト',
      truncated: false,
    };
    expect(buildSummaryFields(summary)).to.deep.equal({
      text: '通常の要約テキスト',
      truncated: false,
    });
  });

  it('truncated=true で { text, truncated:true, originalLength } を返す', () => {
    const summary: SummaryField = {
      text: '切り詰め後\n[TRUNCATED]',
      originalLength: 1_100_000,
      truncated: true,
    };
    expect(buildSummaryFields(summary)).to.deep.equal({
      text: '切り詰め後\n[TRUNCATED]',
      truncated: true,
      originalLength: 1_100_000,
    });
  });

  it('空テキスト (truncated=false) でも { text:"", truncated:false } が返る', () => {
    const summary: SummaryField = { text: '', truncated: false };
    const fields = buildSummaryFields(summary);
    expect(fields).to.deep.equal({ text: '', truncated: false });
    // 不変条件の保証: truncated=false の分岐で originalLength キーが含まれない
    expect(Object.keys(fields).sort()).to.deep.equal(['text', 'truncated']);
  });

  it('discriminated union: truncated=true の場合に必ず originalLength を含む (#215 型不変条件)', () => {
    const summary: SummaryField = {
      text: 'a'.repeat(30_000),
      originalLength: 50_000,
      truncated: true,
    };
    const fields = buildSummaryFields(summary);
    expect(Object.keys(fields).sort()).to.deep.equal([
      'originalLength',
      'text',
      'truncated',
    ]);
    // 型 narrowing で originalLength が number と保証される
    if (fields.truncated) {
      expect(fields.originalLength).to.equal(50_000);
    }
  });
});

describe('GEMINI_CONFIG: maxOutputTokens 不変条件 (canary)', () => {
  // builder 側 canary と二重で固定。値変更時は #205 (定数導入) と #209 (summary適用) の
  // 防御目的を再評価し、両テストを明示的に更新すること。
  it('GEMINI_CONFIG.maxOutputTokens は 8192 で固定', () => {
    expect(GEMINI_CONFIG.maxOutputTokens).to.equal(8192);
  });
});
