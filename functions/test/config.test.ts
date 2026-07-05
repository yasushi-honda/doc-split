/**
 * config.ts: parseOcrThinkingBudget テスト (Issue #546)
 *
 * GEMINI_CONFIG.ocrThinkingBudget はモジュール読み込み時に一度だけ評価されるため、
 * 環境変数の組み合わせを直接テストするには純粋関数として切り出した本関数を検証する。
 */

import { expect } from 'chai';
import { parseOcrThinkingBudget } from '../src/utils/config';

describe('config: parseOcrThinkingBudget (Issue #546)', () => {
  it('未設定(undefined)の場合は既定値0を返す', () => {
    expect(parseOcrThinkingBudget(undefined)).to.equal(0);
  });

  it('空文字列の場合は既定値0を返す', () => {
    expect(parseOcrThinkingBudget('')).to.equal(0);
  });

  it('"0"を指定した場合は0を返す(明示的なthinking無効化)', () => {
    expect(parseOcrThinkingBudget('0')).to.equal(0);
  });

  it('"-1"を指定した場合は-1を返す(dynamic thinkingへのロールバック)', () => {
    expect(parseOcrThinkingBudget('-1')).to.equal(-1);
  });

  // Codexレビュー指摘: サポート対象外の値をそのままGeminiに渡すと全OCRリクエストが
  // バリデーションエラーになるため、ドキュメント化された0/-1以外は既定値0にフォールバックする。
  it('小数(1.5)は未サポート値として既定値0にフォールバックする', () => {
    expect(parseOcrThinkingBudget('1.5')).to.equal(0);
  });

  it('-1以外の負数(-2)は未サポート値として既定値0にフォールバックする', () => {
    expect(parseOcrThinkingBudget('-2')).to.equal(0);
  });

  it('範囲外の正の整数(1024)は未サポート値として既定値0にフォールバックする', () => {
    expect(parseOcrThinkingBudget('1024')).to.equal(0);
  });

  it('数値として解釈できない文字列の場合は既定値0にフォールバックする(誤設定時の安全側動作)', () => {
    expect(parseOcrThinkingBudget('not-a-number')).to.equal(0);
  });

  // PR#550レビュー指摘: GCPコンソール等からのコピペで混入する前後空白・改行はtrimして扱う。
  it('前後空白付き"-1"("  -1  ")はtrimして-1として扱われる', () => {
    expect(parseOcrThinkingBudget('  -1  ')).to.equal(-1);
  });

  it('末尾改行付き"-1"("-1\\n")はtrimして-1として扱われる', () => {
    expect(parseOcrThinkingBudget('-1\n')).to.equal(-1);
  });

  it('前後空白付き"0"("  0  ")はtrimして0として扱われる', () => {
    expect(parseOcrThinkingBudget('  0  ')).to.equal(0);
  });
});
