/**
 * summaryRequestBuilder regression テスト (Issue #213)
 *
 * 目的:
 * - Firestore の summary フィールド書き込みに truncated/originalLength が同梱され続けることを保証 (#178 教訓)
 * - ADR-0027 PR-E: 旧 buildSummaryGenerationRequest(要約のGeminiリクエスト)は撤去した。
 *   GEMINI_CONFIG.maxOutputTokens の canary は OCR緊急用経路でも使うため config.test.ts へ移した。
 */

import { expect } from 'chai';
import { buildSummaryFields } from '../src/ocr/summaryRequestBuilder';
import type { SummaryField } from '../../shared/types';

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
