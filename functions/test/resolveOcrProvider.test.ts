/**
 * resolveOcrProvider の単体テスト (ADR-0025、PR-B: 倒れ先をpaddleへ)
 *
 * 以前はL1(環境変数OCR_PROVIDER)とL2(Firestoreのpaddleocrフラグ+allowlist)の2層で、
 * どちらかが欠けると無言でGeminiへ倒れる設計だった(2026-09-23/25にkanameone・cocoroで
 * 実際に回帰)。顧客データを外部AIへ送らない方針のため、倒れ先をpaddleへ反転し、
 * Geminiは緊急手段としてOCR_PROVIDER=gemini(L1)を明示したときだけ有効にする。
 * L2(Firestoreフラグ)はOCRの判定に使わない(全面切替済みで、残る危険は倒れ先を
 * Geminiにすることだけだったため)。よって本関数はFirestoreを読まない純粋関数。
 */

import { expect } from 'chai';
import { resolveOcrProvider } from '../src/utils/featureFlags';
import { PADDLE_OCR_CONFIG, parseOcrProvider } from '../src/utils/config';

describe('resolveOcrProvider (ADR-0025、倒れ先paddle)', () => {
  it('L1が"gemini"(明示指定)のときだけ"gemini"を返す', () => {
    expect(resolveOcrProvider('gemini')).to.equal('gemini');
  });

  it('L1が"paddle"のとき"paddle"を返す', () => {
    expect(resolveOcrProvider('paddle')).to.equal('paddle');
  });

  it('引数省略時は本番のL1(PADDLE_OCR_CONFIG.provider)をそのまま使う', () => {
    // 環境変数の有無(開発者のシェルのexport等)に依存せず、モジュール読込時に確定した本番値と一致することだけを検証する
    expect(resolveOcrProvider()).to.equal(PADDLE_OCR_CONFIG.provider === 'gemini' ? 'gemini' : 'paddle');
  });

  it('L1未設定・空・未知値はpaddleに解決される(parseOcrProvider→resolveOcrProviderの結合、Geminiに倒れない)', () => {
    for (const envValue of [undefined, '', '   ', 'code-default', 'GEMINI', 'gemini-3.5-flash', 'paddleocr']) {
      expect(resolveOcrProvider(parseOcrProvider(envValue)), `OCR_PROVIDER=${JSON.stringify(envValue)}`).to.equal('paddle');
    }
    expect(resolveOcrProvider(parseOcrProvider('gemini'))).to.equal('gemini');
    expect(resolveOcrProvider(parseOcrProvider('  gemini\n'))).to.equal('gemini');
  });
});
