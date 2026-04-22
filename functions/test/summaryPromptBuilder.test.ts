/**
 * buildSummaryPrompt pure function unit test (Issue #251 Scope 2)
 *
 * 要約生成プロンプトの境界値・fallback・セクション保持を、firebase-admin /
 * Vertex AI の初期化なしで検証する。分離の経緯は summaryPromptBuilder.ts 冒頭参照。
 *
 * 方式: pure unit test (mocha + chai)。外部依存ゼロ、test case は入力→出力の
 * 期待値比較のみ。
 */

import { expect } from 'chai';
import {
  buildSummaryPrompt,
  MAX_SUMMARY_INPUT_LENGTH,
} from '../src/ocr/summaryPromptBuilder';

const TRUNCATION_SUFFIX = '...(以下省略)';

describe('buildSummaryPrompt (#251 Scope 2)', () => {
  describe('ocrResult 切り詰め境界', () => {
    it('length === MAX_SUMMARY_INPUT_LENGTH (8000) は切り詰めなし', () => {
      const ocr = 'a'.repeat(MAX_SUMMARY_INPUT_LENGTH);
      const prompt = buildSummaryPrompt(ocr, '請求書');
      expect(prompt).to.include(ocr);
      expect(prompt).to.not.include(TRUNCATION_SUFFIX);
    });

    it('length === MAX_SUMMARY_INPUT_LENGTH + 1 (8001) は切り詰めあり', () => {
      const ocr = 'a'.repeat(MAX_SUMMARY_INPUT_LENGTH + 1);
      const prompt = buildSummaryPrompt(ocr, '請求書');
      // 末尾の 1 文字は欠落 → 完全一致では含まれない
      expect(prompt).to.not.include(ocr);
      // 先頭 8000 文字 + 省略 suffix は含まれる
      expect(prompt).to.include('a'.repeat(MAX_SUMMARY_INPUT_LENGTH) + TRUNCATION_SUFFIX);
    });

    it('length < MAX_SUMMARY_INPUT_LENGTH はそのまま差し込まれる', () => {
      const ocr = '短いOCR結果';
      const prompt = buildSummaryPrompt(ocr, '請求書');
      expect(prompt).to.include(ocr);
      expect(prompt).to.not.include(TRUNCATION_SUFFIX);
    });

    it('空文字 OCR でも prompt は生成される (caller 責任で短文ガード済み想定)', () => {
      const prompt = buildSummaryPrompt('', '請求書');
      expect(prompt).to.not.include(TRUNCATION_SUFFIX);
      expect(prompt).to.include('【OCR結果】');
      expect(prompt).to.include('【要約】');
    });
  });

  describe('documentType fallback', () => {
    it('documentType が空文字列ならタイトルに "書類" が差し込まれる', () => {
      const prompt = buildSummaryPrompt('dummy ocr', '');
      expect(prompt).to.include('「書類」のOCR結果です');
    });

    it('documentType に値があればその値が差し込まれる', () => {
      const prompt = buildSummaryPrompt('dummy ocr', '介護保険証');
      expect(prompt).to.include('「介護保険証」のOCR結果です');
      // fallback ラベルは含まれない
      expect(prompt).to.not.include('「書類」のOCR結果です');
    });
  });

  describe('プロンプト構造 (主要セクション保持)', () => {
    it('OCR 結果・要約・ポイント のセクション見出しを全て含む', () => {
      const prompt = buildSummaryPrompt('sample', '書類A');
      expect(prompt).to.include('【要約のポイント】');
      expect(prompt).to.include('【OCR結果】');
      expect(prompt).to.include('【要約】');
    });

    it('要約ポイント 4 項目 (目的・日付金額・関係者・平易化) を含む', () => {
      const prompt = buildSummaryPrompt('sample', '書類A');
      expect(prompt).to.include('書類の主な目的・内容');
      expect(prompt).to.include('重要な日付や金額');
      expect(prompt).to.include('関係者（顧客名、事業所名など）');
      expect(prompt).to.include('専門用語は平易に言い換える');
    });

    it('「3〜5行で要約してください」の指示を含む', () => {
      const prompt = buildSummaryPrompt('sample', '書類A');
      expect(prompt).to.include('3〜5行で要約');
    });
  });

  describe('外部依存ゼロ (firebase-admin / Vertex 不要)', () => {
    it('admin 初期化なし + Vertex mock なしで PASS する (本 test の存在自体が証拠)', () => {
      // このブロックに到達していれば import 副作用で初期化エラーになっていない。
      // summaryGenerator.ts の依存チェーン (rateLimiter.ts → firebase-admin) から
      // 切り離されていることを assertion レベルで lock-in する。
      expect(typeof buildSummaryPrompt).to.equal('function');
      expect(MAX_SUMMARY_INPUT_LENGTH).to.equal(8000);
    });
  });
});
