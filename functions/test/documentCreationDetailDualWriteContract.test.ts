/**
 * 新規doc作成3箇所(checkGmailAttachments/uploadPdf/import-historical-gmail)の
 * detail/main dual-write配線契約テスト (ADR-0018 Phase B, Issue #547)
 *
 * ADR書込表#4: 新規doc作成時にocrResultを空文字初期化する3箇所全てで、同一transaction内
 * でdetail/mainにも `ocrResult: ''` を書込む(dual-write原則)ことをlock-inする。
 */

import { expect } from 'chai';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { extractBraceBlock } from './helpers/extractBraceBlock';

const TARGETS = [
  {
    label: 'checkGmailAttachments.ts',
    path: 'src/gmail/checkGmailAttachments.ts',
    setCall: 'transaction.set(docRef, {',
  },
  {
    label: 'uploadPdf.ts',
    path: 'src/upload/uploadPdf.ts',
    setCall: 'transaction.set(docRef, {',
  },
];

describe('新規doc作成箇所の detail/main dual-write contract (ADR-0018 Phase B)', () => {
  for (const target of TARGETS) {
    describe(target.label, () => {
      let source: string | null = null;

      before(() => {
        const fullPath = resolve(__dirname, '..', target.path);
        source = existsSync(fullPath) ? readFileSync(fullPath, 'utf-8') : null;
      });

      it('ソースファイルが存在する', () => {
        expect(source, `${target.path} must exist`).to.not.be.null;
      });

      it("detail/mainへ transaction.set(docRef.collection('detail').doc('main'), { ocrResult: '' }) が存在する", () => {
        const detailBlock = extractBraceBlock(
          source,
          /transaction\.set\(\s*docRef\.collection\('detail'\)\.doc\('main'\),\s*/,
          { anchorMode: 'after-match' }
        );
        expect(detailBlock, 'detail/main transaction.set(...) block must be found')
          .to.not.be.null;
        expect(detailBlock).to.match(/ocrResult:\s*''/);
      });

      it('detail/main setは本体docの transaction.set より後、同一 transaction コールバック内にある', () => {
        expect(source).to.not.be.null;
        const mainSetIdx = source!.indexOf(target.setCall);
        const detailSetIdx = source!.indexOf(
          "transaction.set(docRef.collection('detail').doc('main')"
        );
        expect(mainSetIdx).to.be.greaterThan(-1);
        expect(detailSetIdx).to.be.greaterThan(mainSetIdx);
      });
    });
  }

  describe('import-historical-gmail.js', () => {
    let source: string | null = null;

    before(() => {
      const fullPath = resolve(
        __dirname,
        '..',
        '..',
        'scripts',
        'import-historical-gmail.js'
      );
      source = existsSync(fullPath) ? readFileSync(fullPath, 'utf-8') : null;
    });

    it('ソースファイルが存在する', () => {
      expect(source, 'scripts/import-historical-gmail.js must exist').to.not.be
        .null;
    });

    it("detail/mainへ transaction.set(docRef.collection('detail').doc('main'), { ocrResult: '' }) が存在する", () => {
      const detailBlock = extractBraceBlock(
        source,
        /transaction\.set\(\s*docRef\.collection\('detail'\)\.doc\('main'\),\s*/,
        { anchorMode: 'after-match' }
      );
      expect(detailBlock, 'detail/main transaction.set(...) block must be found').to
        .not.be.null;
      expect(detailBlock).to.match(/ocrResult:\s*''/);
    });

    it('detail/main setは本体docの transaction.set より後、同一 transaction コールバック内にある', () => {
      expect(source).to.not.be.null;
      const mainSetIdx = source!.indexOf('transaction.set(docRef, {');
      const detailSetIdx = source!.indexOf(
        "transaction.set(docRef.collection('detail').doc('main')"
      );
      expect(mainSetIdx).to.be.greaterThan(-1);
      expect(detailSetIdx).to.be.greaterThan(mainSetIdx);
    });
  });
});
