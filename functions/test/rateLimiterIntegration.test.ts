/**
 * rateLimiter.ts 統合テスト (Firebaseエミュレータ, Issue #546)
 *
 * GEMINI_PRICING と trackGeminiUsage は db = admin.firestore() (default app) を
 * モジュールトップレベルで参照するため、npm test (非エミュレータ) の共有プロセスに
 * default app を汚染しないよう、既存の *Integration.test.ts と同様に
 * 単独実行(test:integration)専用ファイルとして分離する。
 *
 * 実行: firebase emulators:exec --only firestore 'npm run test:integration'
 */

// 必ず最初に import: default admin app + emulator host を先行初期化。
// test:integration は複数の *Integration.test.ts を同一 mocha プロセスで実行するため、
// 他ファイルより後に読み込まれても duplicate-app エラーにならないよう本 helper を経由する。
import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import { cleanupCollections } from './helpers/cleanupEmulator';
import { GEMINI_PRICING, trackGeminiUsage } from '../src/utils/rateLimiter';

const db = admin.firestore();

function todayDocRef() {
  const today = new Date().toISOString().split('T')[0];
  return db.doc(`stats/gemini/daily/${today}`);
}

describe('rateLimiter 統合テスト (エミュレータ, Issue #546)', () => {
  afterEach(async () => {
    await cleanupCollections(db, ['stats/gemini/daily']);
  });

  describe('GEMINI_PRICING', () => {
    it('inputPer1MTokens は gemini-2.5-flash 実単価 $0.30 で固定', () => {
      expect(GEMINI_PRICING.inputPer1MTokens).to.equal(0.3);
    });

    it('outputPer1MTokens は gemini-2.5-flash 実単価 $2.50 で固定', () => {
      expect(GEMINI_PRICING.outputPer1MTokens).to.equal(2.5);
    });
  });

  describe('trackGeminiUsage: source別内訳 + thinkingトークン (Issue #546)', () => {
    it('source=ocr の呼び出しで bySource.ocr に内訳が記録される', async () => {
      await trackGeminiUsage(1000, 500, 100, 'ocr');

      const doc = await todayDocRef().get();
      const data = doc.data();
      expect(data?.inputTokens).to.equal(1000);
      expect(data?.outputTokens).to.equal(500);
      expect(data?.thinkingTokens).to.equal(100);
      expect(data?.requestCount).to.equal(1);
      expect(data?.bySource?.ocr?.inputTokens).to.equal(1000);
      expect(data?.bySource?.ocr?.outputTokens).to.equal(500);
      expect(data?.bySource?.ocr?.thinkingTokens).to.equal(100);
      expect(data?.bySource?.ocr?.requestCount).to.equal(1);
      // input: 1000*$0.30/1M + output(500+thinking100=600件分): 600*$2.50/1M
      expect(data?.bySource?.ocr?.estimatedCostUsd).to.be.closeTo(0.0018, 1e-9);
      expect(data?.bySource?.summary).to.be.undefined;
    });

    it('estimatedCostUsd は thinkingTokens を output 単価で合算した金額になる', async () => {
      await trackGeminiUsage(1_000_000, 1_000_000, 0, 'ocr');

      const withoutThinking = (await todayDocRef().get()).data()?.estimatedCostUsd;
      // input: 1M tokens * $0.30/1M = $0.30、output: 1M tokens * $2.50/1M = $2.50 → 合計$2.80
      expect(withoutThinking).to.be.closeTo(2.8, 1e-9);

      await todayDocRef().delete();
      await trackGeminiUsage(0, 0, 1_000_000, 'ocr');
      const onlyThinking = (await todayDocRef().get()).data()?.estimatedCostUsd;
      // thinkingTokens は output と同単価 ($2.50/1M) で課金される
      expect(onlyThinking).to.be.closeTo(2.5, 1e-9);
    });

    it('ocr と summary の呼び出しは bySource 内で独立して集計される', async () => {
      await trackGeminiUsage(1000, 500, 100, 'ocr');
      await trackGeminiUsage(200, 300, 0, 'summary');

      const data = (await todayDocRef().get()).data();
      // 全体合計は両 source の和
      expect(data?.inputTokens).to.equal(1200);
      expect(data?.outputTokens).to.equal(800);
      expect(data?.thinkingTokens).to.equal(100);
      expect(data?.requestCount).to.equal(2);
      // source 別は互いに影響しない
      expect(data?.bySource?.ocr?.inputTokens).to.equal(1000);
      expect(data?.bySource?.summary?.inputTokens).to.equal(200);
      expect(data?.bySource?.summary?.thinkingTokens).to.equal(0);
    });

    it('同一 source への複数回呼び出しは加算される (FieldValue.increment)', async () => {
      await trackGeminiUsage(100, 50, 10, 'ocr');
      await trackGeminiUsage(200, 80, 20, 'ocr');

      const data = (await todayDocRef().get()).data();
      expect(data?.bySource?.ocr?.inputTokens).to.equal(300);
      expect(data?.bySource?.ocr?.outputTokens).to.equal(130);
      expect(data?.bySource?.ocr?.thinkingTokens).to.equal(30);
      expect(data?.bySource?.ocr?.requestCount).to.equal(2);
    });
  });
});
