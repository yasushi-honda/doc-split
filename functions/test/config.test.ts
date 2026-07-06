/**
 * config.ts: parseOcrThinkingBudget / parseModelId / isThreePointFiveModel /
 * resolveGeminiPricing テスト (Issue #546, #548)
 *
 * GEMINI_CONFIG.* はモジュール読み込み時に一度だけ評価されるため、
 * 環境変数の組み合わせを直接テストするには純粋関数として切り出した各関数を検証する。
 */

import { expect } from 'chai';
import {
  parseOcrThinkingBudget,
  parseModelId,
  isThreePointFiveModel,
  resolveGeminiPricing,
} from '../src/utils/config';

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

describe('config: parseModelId (Issue #548)', () => {
  it('未設定(undefined)の場合は既定値gemini-3.5-flashを返す(移行後の既定モデル)', () => {
    expect(parseModelId(undefined)).to.equal('gemini-3.5-flash');
  });

  it('空文字列の場合は既定値gemini-3.5-flashを返す', () => {
    expect(parseModelId('')).to.equal('gemini-3.5-flash');
  });

  it('"gemini-3.5-flash"を指定した場合はそのまま返す', () => {
    expect(parseModelId('gemini-3.5-flash')).to.equal('gemini-3.5-flash');
  });

  it('"gemini-2.5-flash"を指定した場合はそのまま返す(ロールバック用途)', () => {
    expect(parseModelId('gemini-2.5-flash')).to.equal('gemini-2.5-flash');
  });

  it('未サポートの値は既定値gemini-3.5-flashにフォールバックする(誤設定時の安全側動作)', () => {
    expect(parseModelId('gemini-1.5-flash')).to.equal('gemini-3.5-flash');
  });

  it('前後空白付き"gemini-2.5-flash"はtrimしてそのまま扱われる', () => {
    expect(parseModelId('  gemini-2.5-flash  ')).to.equal('gemini-2.5-flash');
  });
});

describe('config: isThreePointFiveModel (Issue #548)', () => {
  it('"gemini-3.5-flash"はtrueを返す', () => {
    expect(isThreePointFiveModel('gemini-3.5-flash')).to.equal(true);
  });

  it('"gemini-2.5-flash"はfalseを返す', () => {
    expect(isThreePointFiveModel('gemini-2.5-flash')).to.equal(false);
  });
});

describe('config: resolveGeminiPricing (Issue #548)', () => {
  it('"gemini-3.5-flash"は実単価(入力$1.50/出力$9.00)を返す', () => {
    expect(resolveGeminiPricing('gemini-3.5-flash')).to.deep.equal({
      inputPer1MTokens: 1.5,
      outputPer1MTokens: 9.0,
    });
  });

  it('"gemini-2.5-flash"は実単価(入力$0.30/出力$2.50)を返す', () => {
    expect(resolveGeminiPricing('gemini-2.5-flash')).to.deep.equal({
      inputPer1MTokens: 0.3,
      outputPer1MTokens: 2.5,
    });
  });

  it('未知のmodelIdはgemini-2.5-flash単価にフォールバックする(安全側動作)', () => {
    expect(resolveGeminiPricing('gemini-1.5-flash')).to.deep.equal({
      inputPer1MTokens: 0.3,
      outputPer1MTokens: 2.5,
    });
  });
});
