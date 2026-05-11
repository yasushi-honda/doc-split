/**
 * Issue #432 PR-C: scripts/lib/pdfRegenerator.ts pure function テスト (F-D1)
 *
 * 目的:
 *   - 正常系 (page range 抽出が pdf-lib 仕様通り)
 *   - 境界値 (1 ページ / 全ページ / 範囲外)
 *   - 異常系 (不正 PDF buffer / page range 不正)
 *   - deterministic 性 (同入力 → 同 sha256) ★ MatchedByHash 判定の信頼性根拠
 *
 * MatchedByHash classifier は「sha256(actual storage) == sha256(regenerated from parent)」で
 * 勝者を確定する設計のため、regenerateChildPdf が deterministic でなければ classifier
 * の根本前提が崩れる。本テストはそこをロック。
 */

import { expect } from 'chai';
import * as crypto from 'crypto';
import { PDFDocument } from 'pdf-lib';
import { regenerateChildPdf } from '../../scripts/lib/pdfRegenerator';

async function makeNPagePdf(n: number, seed: number = 0): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < n; i++) {
    const page = pdf.addPage([100, 100]);
    page.drawRectangle({ x: 5 + i * 3 + seed, y: 5 + i * 3 + seed, width: 20, height: 20 });
  }
  return Buffer.from(await pdf.save());
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

describe('pdfRegenerator.regenerateChildPdf (Issue #432 PR-C, F-D1)', () => {
  describe('正常系: page range 抽出', () => {
    it('5 ページ親 + start=2 end=3 → 2 ページ child', async () => {
      const parent = await makeNPagePdf(5);
      const child = await regenerateChildPdf(parent, 2, 3);
      const childPdf = await PDFDocument.load(child);
      expect(childPdf.getPageCount()).to.equal(2);
    });

    it('境界: start=1 end=1 (単一ページ)', async () => {
      const parent = await makeNPagePdf(5);
      const child = await regenerateChildPdf(parent, 1, 1);
      const childPdf = await PDFDocument.load(child);
      expect(childPdf.getPageCount()).to.equal(1);
    });

    it('境界: start=1 end=N (全ページ)', async () => {
      const parent = await makeNPagePdf(5);
      const child = await regenerateChildPdf(parent, 1, 5);
      const childPdf = await PDFDocument.load(child);
      expect(childPdf.getPageCount()).to.equal(5);
    });
  });

  describe('異常系: page range 不正', () => {
    it('startPage=0 → throw', async () => {
      const parent = await makeNPagePdf(5);
      try {
        await regenerateChildPdf(parent, 0, 1);
        expect.fail('expected throw');
      } catch (err) {
        expect((err as Error).message).to.contain('invalid page range');
      }
    });

    it('startPage > endPage → throw', async () => {
      const parent = await makeNPagePdf(5);
      try {
        await regenerateChildPdf(parent, 3, 2);
        expect.fail('expected throw');
      } catch (err) {
        expect((err as Error).message).to.contain('invalid page range');
      }
    });

    it('endPage > totalPages → throw', async () => {
      const parent = await makeNPagePdf(3);
      try {
        await regenerateChildPdf(parent, 1, 10);
        expect.fail('expected throw');
      } catch (err) {
        expect((err as Error).message).to.contain('out of bounds');
      }
    });

    it('不正 PDF buffer (空 buffer) → pdf-lib エラーが伝播', async () => {
      try {
        await regenerateChildPdf(Buffer.from([]), 1, 1);
        expect.fail('expected throw');
      } catch (err) {
        // pdf-lib のエラー型に依存しない汎用検証 (load 失敗)
        expect(err).to.be.instanceOf(Error);
      }
    });
  });

  describe('★ deterministic 性 (MatchedByHash classifier の信頼性根拠)', () => {
    it('同入力 + 同 page range で 2 回生成 → sha256 が完全一致', async () => {
      const parent = await makeNPagePdf(5);
      const child1 = await regenerateChildPdf(parent, 2, 3);
      const child2 = await regenerateChildPdf(parent, 2, 3);
      expect(sha256(child1)).to.equal(sha256(child2));
    });

    it('異なる page range なら sha256 が異なる', async () => {
      const parent = await makeNPagePdf(5);
      const child1 = await regenerateChildPdf(parent, 1, 1);
      const child2 = await regenerateChildPdf(parent, 2, 2);
      expect(sha256(child1)).to.not.equal(sha256(child2));
    });

    it('異なる parent (page 1 の内容が異なる) なら同 page range でも sha256 が異なる', async () => {
      const parent1 = await makeNPagePdf(5, 0);
      const parent2 = await makeNPagePdf(5, 7); // seed 差で page 1 の rectangle 位置が変わる
      const child1 = await regenerateChildPdf(parent1, 1, 1);
      const child2 = await regenerateChildPdf(parent2, 1, 1);
      expect(sha256(child1)).to.not.equal(sha256(child2));
    });
  });
});
