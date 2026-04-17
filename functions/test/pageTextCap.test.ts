/**
 * OCRページテキスト長さ制限ユーティリティのテスト (Issue #205)
 *
 * 背景: Vertex AI Geminiのハルシネーション/暴走により異常に長い応答が
 * Firestoreの per-field 1 MiB 制限を超え INVALID_ARGUMENT を引き起こす問題への防御。
 */

import { expect } from 'chai';
import {
  capPageText,
  capPageResultsAggregate,
  MAX_PAGE_TEXT_LENGTH,
  MAX_AGGREGATE_PAGE_CHARS,
  MAX_SUMMARY_LENGTH,
} from '../src/utils/pageTextCap';

describe('pageTextCap', () => {
  describe('capPageText (per-page cap)', () => {
    it('短いテキストはそのまま返される', () => {
      const input = 'これはテストです。';
      const result = capPageText(input);

      expect(result.text).to.equal(input);
      expect(result.originalLength).to.equal(input.length);
      expect(result.truncated).to.be.false;
    });

    it('境界値: text.length === MAX_PAGE_TEXT_LENGTH は切り詰めない', () => {
      const input = 'a'.repeat(MAX_PAGE_TEXT_LENGTH);
      const result = capPageText(input);

      expect(result.text.length).to.equal(MAX_PAGE_TEXT_LENGTH);
      expect(result.truncated).to.be.false;
      expect(result.originalLength).to.equal(MAX_PAGE_TEXT_LENGTH);
    });

    it('境界値: text.length === MAX_PAGE_TEXT_LENGTH + 1 は切り詰める', () => {
      const input = 'a'.repeat(MAX_PAGE_TEXT_LENGTH + 1);
      const result = capPageText(input);

      expect(result.truncated).to.be.true;
      expect(result.originalLength).to.equal(MAX_PAGE_TEXT_LENGTH + 1);
      expect(result.text.length).to.be.at.most(MAX_PAGE_TEXT_LENGTH);
    });

    it('巨大テキスト (1.1M chars) でも text.length が cap を超えない', () => {
      const input = 'x'.repeat(1_102_788);
      const result = capPageText(input);

      expect(result.truncated).to.be.true;
      expect(result.originalLength).to.equal(1_102_788);
      expect(result.text.length).to.be.at.most(MAX_PAGE_TEXT_LENGTH);
    });

    it('切り詰めマーカー [TRUNCATED] が末尾に付与される', () => {
      const input = 'a'.repeat(MAX_PAGE_TEXT_LENGTH * 2);
      const result = capPageText(input);

      expect(result.text).to.match(/\[TRUNCATED\]$/);
    });

    it('カスタム maxLength が反映される', () => {
      const input = 'a'.repeat(100);
      const result = capPageText(input, 50);

      expect(result.truncated).to.be.true;
      expect(result.text.length).to.be.at.most(50);
      expect(result.originalLength).to.equal(100);
    });

    it('日本語マルチバイト文字でも文字数ベースで動作する', () => {
      const input = 'あ'.repeat(MAX_PAGE_TEXT_LENGTH + 100);
      const result = capPageText(input);

      expect(result.truncated).to.be.true;
      expect(result.originalLength).to.equal(MAX_PAGE_TEXT_LENGTH + 100);
      expect(result.text.length).to.be.at.most(MAX_PAGE_TEXT_LENGTH);
    });

    it('空文字列は切り詰められない', () => {
      const result = capPageText('');

      expect(result.text).to.equal('');
      expect(result.originalLength).to.equal(0);
      expect(result.truncated).to.be.false;
    });

    it('maxLength=0 でも安全に動作する（text空、truncated=true）', () => {
      const result = capPageText('hello', 0);

      expect(result.truncated).to.be.true;
      expect(result.text.length).to.be.at.most(0);
      expect(result.originalLength).to.equal(5);
    });
  });

  describe('capPageResultsAggregate (aggregate cap)', () => {
    it('合計が閾値以下なら全ページそのまま返される', () => {
      const pages = [
        { text: 'page1', originalLength: 5, truncated: false },
        { text: 'page2', originalLength: 5, truncated: false },
      ];
      const result = capPageResultsAggregate(pages);

      expect(result).to.have.length(2);
      expect(result[0]?.text).to.equal('page1');
      expect(result[1]?.text).to.equal('page2');
    });

    it('合計が閾値を超える場合は後続ページが切り詰められる', () => {
      const pageSize = MAX_PAGE_TEXT_LENGTH;
      const pages = Array.from({ length: 10 }, (_, i) => ({
        text: 'a'.repeat(pageSize),
        originalLength: pageSize,
        truncated: false,
        pageNumber: i + 1,
      }));

      const result = capPageResultsAggregate(pages);
      const totalChars = result.reduce((sum: number, p) => sum + p.text.length, 0);

      expect(totalChars).to.be.at.most(MAX_AGGREGATE_PAGE_CHARS);
    });

    it('aggregate超過時、超過したページは truncated=true でメタデータ保持', () => {
      const pageSize = MAX_PAGE_TEXT_LENGTH;
      const pages = Array.from({ length: 10 }, () => ({
        text: 'a'.repeat(pageSize),
        originalLength: pageSize,
        truncated: false,
      }));

      const result = capPageResultsAggregate(pages);
      const truncatedPages = result.filter((p) => p.truncated);

      expect(truncatedPages.length).to.be.at.least(1);
      truncatedPages.forEach((p) => {
        expect(p.originalLength).to.equal(pageSize);
      });
    });

    it('1ページ目で既に閾値超過の場合は1ページ目内で切り詰め', () => {
      const pages = [
        {
          text: 'a'.repeat(MAX_AGGREGATE_PAGE_CHARS + 100),
          originalLength: MAX_AGGREGATE_PAGE_CHARS + 100,
          truncated: false,
        },
      ];
      const result = capPageResultsAggregate(pages);

      expect(result[0]?.text.length).to.be.at.most(MAX_AGGREGATE_PAGE_CHARS);
      expect(result[0]?.truncated).to.be.true;
    });

    it('per-page cap と合計 cap の両方が適用される', () => {
      // 各ページ MAX_PAGE_TEXT_LENGTH 超 + 合計 MAX_AGGREGATE_PAGE_CHARS 超
      const pages = [
        { text: 'a'.repeat(60_000), originalLength: 60_000, truncated: false },
        { text: 'b'.repeat(60_000), originalLength: 60_000, truncated: false },
        { text: 'c'.repeat(60_000), originalLength: 60_000, truncated: false },
        { text: 'd'.repeat(60_000), originalLength: 60_000, truncated: false },
      ];
      const result = capPageResultsAggregate(pages);

      // 各ページ per-page cap 内
      result.forEach((p: { text: string; truncated?: boolean; originalLength?: number }) => {
        expect(p.text.length).to.be.at.most(MAX_PAGE_TEXT_LENGTH);
      });
      // 合計が aggregate cap 内
      const totalChars = result.reduce((sum: number, p) => sum + p.text.length, 0);
      expect(totalChars).to.be.at.most(MAX_AGGREGATE_PAGE_CHARS);
    });

    it('空配列は空配列を返す', () => {
      expect(capPageResultsAggregate([])).to.deep.equal([]);
    });
  });

  describe('MAX_SUMMARY_LENGTH (Issue #209)', () => {
    it('サマリー上限定数が想定値である', () => {
      expect(MAX_SUMMARY_LENGTH).to.equal(30_000);
    });

    it('境界値: text.length === MAX_SUMMARY_LENGTH は切り詰めない', () => {
      const input = 'a'.repeat(MAX_SUMMARY_LENGTH);
      const result = capPageText(input, MAX_SUMMARY_LENGTH);

      expect(result.text.length).to.equal(MAX_SUMMARY_LENGTH);
      expect(result.truncated).to.be.false;
    });

    it('境界値: text.length === MAX_SUMMARY_LENGTH + 1 は切り詰める', () => {
      const input = 'a'.repeat(MAX_SUMMARY_LENGTH + 1);
      const result = capPageText(input, MAX_SUMMARY_LENGTH);

      expect(result.truncated).to.be.true;
      expect(result.originalLength).to.equal(MAX_SUMMARY_LENGTH + 1);
      expect(result.text.length).to.be.at.most(MAX_SUMMARY_LENGTH);
    });

    it('巨大サマリー (1.1M chars 暴走相当) でも cap 内に収まる', () => {
      const input = 'x'.repeat(1_100_000);
      const result = capPageText(input, MAX_SUMMARY_LENGTH);

      expect(result.truncated).to.be.true;
      expect(result.originalLength).to.equal(1_100_000);
      expect(result.text.length).to.be.at.most(MAX_SUMMARY_LENGTH);
    });

    it('cap適用後のsummary は Firestore 1 MiB 制限内に余裕で収まる', () => {
      const input = 'あ'.repeat(MAX_SUMMARY_LENGTH * 2);
      const result = capPageText(input, MAX_SUMMARY_LENGTH);
      const bytesSize = Buffer.byteLength(result.text, 'utf8');

      expect(bytesSize).to.be.at.most(1_048_576);
    });
  });

  describe('Firestore書き込みサイズの実害確認', () => {
    it('cap適用後のpageResults配列はFirestore 1MiB制限内に収まる', () => {
      const pages = Array.from({ length: 30 }, (_, i) => ({
        text: 'あ'.repeat(MAX_PAGE_TEXT_LENGTH * 2), // 各ページ大きすぎ
        originalLength: MAX_PAGE_TEXT_LENGTH * 2,
        truncated: false,
        pageNumber: i + 1,
        inputTokens: 100,
        outputTokens: 50000,
      }));

      const capped = capPageResultsAggregate(pages);
      const serialized = JSON.stringify(capped);
      const bytesSize = Buffer.byteLength(serialized, 'utf8');

      // 1 MiB = 1,048,576 bytes
      expect(bytesSize).to.be.at.most(1_048_576);
    });
  });
});
