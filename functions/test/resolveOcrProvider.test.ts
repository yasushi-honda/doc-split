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

describe('resolveOcrProvider (ADR-0025、倒れ先paddle)', () => {
  it('L1が"gemini"(明示指定)のときだけ"gemini"を返す', () => {
    expect(resolveOcrProvider('gemini')).to.equal('gemini');
  });

  it('L1が"paddle"のとき"paddle"を返す', () => {
    expect(resolveOcrProvider('paddle')).to.equal('paddle');
  });

  it('引数省略時は本番のL1既定値を使う(このテストプロセスはOCR_PROVIDER未設定のため"paddle")', () => {
    expect(process.env.OCR_PROVIDER, 'このテストはOCR_PROVIDER未設定を前提とする').to.equal(undefined);
    expect(resolveOcrProvider()).to.equal('paddle');
  });

  it('Firestoreを読まない(引数はL1のみ)', () => {
    expect(resolveOcrProvider.length, 'L2(Firestore db/docId)を引数に取らない').to.be.lessThan(2);
  });
});
