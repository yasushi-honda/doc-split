/**
 * documents/{id} 削除経路3箇所(deleteDocument.ts / cleanup-duplicates.js /
 * cleanup-ambiguous-collision-docs.ts)の detail/main 削除同期契約テスト
 * (ADR-0018 Phase B, Issue #547)
 *
 * 本体docのみ削除しdetail/mainサブコレクションを残置すると孤児化する
 * (Storage同様、audit-storage-mismatch的な検知漏れの温床になる)。
 * 3経路すべてで本体削除と同一batch/commit内でdetail/mainも削除する配線を
 * ソース文字列レベルでlock-inする(splitPdfDetailDualWriteContract.test.ts等と同形式)。
 */

import { expect } from 'chai';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { extractBraceBlock } from './helpers/extractBraceBlock';

describe('documents 削除経路の detail/main dual-delete contract (ADR-0018 Phase B)', () => {
  describe('deleteDocument.ts', () => {
    let source: string | null = null;

    before(() => {
      const fullPath = resolve(__dirname, '..', 'src/documents/deleteDocument.ts');
      source = existsSync(fullPath) ? readFileSync(fullPath, 'utf-8') : null;
    });

    it('ソースファイルが存在する', () => {
      expect(source, 'src/documents/deleteDocument.ts must exist').to.not.be.null;
    });

    it('docRef削除と同一batchでdetail/mainを削除する', () => {
      const batchBlock = extractBraceBlock(source, /const batch = db\.batch\(\);/, {
        anchorMode: 'from-start',
      });
      expect(batchBlock, 'batch construction block must be found').to.not.be.null;
    });

    it("batch.delete(docRef.collection('detail').doc('main')) が batch.delete(docRef) より前、同一 batch.commit() 内にある", () => {
      expect(source).to.not.be.null;
      const detailDeleteIdx = source!.indexOf(
        "batch.delete(docRef.collection('detail').doc('main'));"
      );
      const docDeleteIdx = source!.indexOf('batch.delete(docRef);');
      const commitIdx = source!.indexOf('await batch.commit();');
      expect(detailDeleteIdx, 'detail/main batch.delete call site must be found').to
        .be.greaterThan(-1);
      expect(docDeleteIdx).to.be.greaterThan(detailDeleteIdx);
      expect(commitIdx).to.be.greaterThan(docDeleteIdx);
    });
  });

  describe('cleanup-duplicates.js', () => {
    let source: string | null = null;

    before(() => {
      const fullPath = resolve(__dirname, '..', '..', 'scripts', 'cleanup-duplicates.js');
      source = existsSync(fullPath) ? readFileSync(fullPath, 'utf-8') : null;
    });

    it('ソースファイルが存在する', () => {
      expect(source, 'scripts/cleanup-duplicates.js must exist').to.not.be.null;
    });

    it('BATCH_SIZEは250 (本体+detail/mainの2書込のため2N<=500)', () => {
      expect(source).to.match(/const BATCH_SIZE = 250;/);
    });

    it('旧BATCH_SIZE=500の判定は残存しない (回帰防止)', () => {
      expect(source).to.not.match(/const BATCH_SIZE = 500;/);
    });

    it('削除ループ内でdocuments本体とdetail/main両方をbatch.deleteする', () => {
      const loopBlock = extractBraceBlock(source, /for \(const doc of chunk\) \{/, {
        anchorMode: 'from-start',
      });
      expect(loopBlock, 'delete loop block must be found').to.not.be.null;
      expect(loopBlock).to.match(/batch\.delete\(db\.doc\(`documents\/\$\{doc\.id\}`\)\)/);
      expect(loopBlock).to.match(
        /batch\.delete\(db\.doc\(`documents\/\$\{doc\.id\}\/detail\/main`\)\)/
      );
    });
  });

  describe('cleanup-ambiguous-collision-docs.ts', () => {
    let source: string | null = null;

    before(() => {
      const fullPath = resolve(
        __dirname,
        '..',
        '..',
        'scripts',
        'cleanup-ambiguous-collision-docs.ts'
      );
      source = existsSync(fullPath) ? readFileSync(fullPath, 'utf-8') : null;
    });

    it('ソースファイルが存在する', () => {
      expect(source, 'scripts/cleanup-ambiguous-collision-docs.ts must exist').to.not
        .be.null;
    });

    it('単一batchのため削除対象件数の上限(250)チェックがある (本体+detail/mainの2書込)', () => {
      expect(source).to.match(/if \(deletions\.length > 250\) \{/);
    });

    it('削除batchループ内で親docとdetail/main両方をbatch.deleteする', () => {
      const loopBlock = extractBraceBlock(
        source,
        /const batch = db\.batch\(\);\s*\n\s*for \(const d of deletions\) \{/,
        { anchorMode: 'from-start' }
      );
      expect(loopBlock, 'deletion batch loop block must be found').to.not.be.null;
      expect(loopBlock).to.match(
        /batch\.delete\(db\.collection\('documents'\)\.doc\(d\.docId\), \{ lastUpdateTime \}\)/
      );
      expect(loopBlock).to.match(
        /db\.collection\('documents'\)\.doc\(d\.docId\)\.collection\('detail'\)\.doc\('main'\)/
      );
    });
  });
});
