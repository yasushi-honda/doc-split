/**
 * displayFileName バックフィル テスト
 *
 * buildDisplayFileNameFromDoc (backfill 固有のドキュメントデータ組立) をテスト。
 * timestampToDateString の単体 test は timestampHelpers.test.ts に移動済み。
 */

import { expect } from 'chai';
import { buildDisplayFileNameFromDoc } from '../src/utils/backfillDisplayFileName';

describe('displayFileName バックフィル', () => {
  describe('buildDisplayFileNameFromDoc', () => {
    it('全メタ情報が揃ったドキュメントから displayFileName を生成', () => {
      const doc = {
        documentType: '介護保険証',
        customerName: '田中太郎',
        officeName: 'デイサービスさくら',
        fileDate: { seconds: 1773619200, nanoseconds: 0 },
      };
      const result = buildDisplayFileNameFromDoc(doc);
      // 日付部分はTZにより変動するため、パターンで検証
      expect(result).to.match(/^介護保険証_デイサービスさくら_\d{8}_田中太郎\.pdf$/);
    });

    it('fileDate が null のドキュメントは日付部分を省略', () => {
      const doc = {
        documentType: '介護保険証',
        customerName: '田中太郎',
        officeName: 'デイサービスさくら',
        fileDate: null,
      };
      expect(buildDisplayFileNameFromDoc(doc)).to.equal(
        '介護保険証_デイサービスさくら_田中太郎.pdf'
      );
    });

    it('全てデフォルト値のドキュメントは null を返す', () => {
      const doc = {
        documentType: '未判定',
        customerName: '不明顧客',
        officeName: '',
        fileDate: null,
      };
      expect(buildDisplayFileNameFromDoc(doc)).to.be.null;
    });

    it('メタ情報が空文字のドキュメントは該当部分を省略', () => {
      const doc = {
        documentType: '介護保険証',
        customerName: '',
        officeName: '',
        fileDate: null,
      };
      expect(buildDisplayFileNameFromDoc(doc)).to.equal('介護保険証.pdf');
    });

    it('displayFileName が既に設定されているドキュメントでも生成可能（上書き判断は呼び出し側）', () => {
      const doc = {
        documentType: '診断書',
        customerName: '佐藤花子',
        officeName: '',
        fileDate: { seconds: 1773619200, nanoseconds: 0 },
      };
      const result = buildDisplayFileNameFromDoc(doc);
      expect(result).to.match(/^診断書_\d{8}_佐藤花子\.pdf$/);
    });
  });
});
