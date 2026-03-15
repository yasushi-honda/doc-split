/**
 * displayFileName 生成テスト
 *
 * #178 Stage 1: OCR完了時・PDF分割時に displayFileName を自動生成
 */

import { expect } from 'chai';
import { generateDisplayFileName } from '../src/utils/displayFileNameGenerator';

describe('displayFileName 自動生成 (#178 Stage 1)', () => {
  describe('generateDisplayFileName - 基本生成', () => {
    it('全メタ情報が揃っている場合、書類名_事業所_日付_顧客名.pdf を生成', () => {
      const result = generateDisplayFileName({
        documentType: '介護保険証',
        customerName: '田中太郎',
        officeName: 'デイサービスさくら',
        fileDate: '2026/03/15',
      });
      expect(result).to.equal('介護保険証_デイサービスさくら_20260315_田中太郎.pdf');
    });

    it('日付がない場合は日付部分を省略', () => {
      const result = generateDisplayFileName({
        documentType: '介護保険証',
        customerName: '田中太郎',
        officeName: 'デイサービスさくら',
      });
      expect(result).to.equal('介護保険証_デイサービスさくら_田中太郎.pdf');
    });

    it('事業所名がない場合は事業所部分を省略', () => {
      const result = generateDisplayFileName({
        documentType: '介護保険証',
        customerName: '田中太郎',
        fileDate: '2026/03/15',
      });
      expect(result).to.equal('介護保険証_20260315_田中太郎.pdf');
    });

    it('顧客名が「不明顧客」の場合は顧客部分を省略', () => {
      const result = generateDisplayFileName({
        documentType: '介護保険証',
        customerName: '不明顧客',
        officeName: 'デイサービスさくら',
        fileDate: '2026/03/15',
      });
      expect(result).to.equal('介護保険証_デイサービスさくら_20260315.pdf');
    });

    it('書類種別が「未判定」の場合は書類部分を省略', () => {
      const result = generateDisplayFileName({
        documentType: '未判定',
        customerName: '田中太郎',
        officeName: 'デイサービスさくら',
        fileDate: '2026/03/15',
      });
      expect(result).to.equal('デイサービスさくら_20260315_田中太郎.pdf');
    });
  });

  describe('generateDisplayFileName - エッジケース', () => {
    it('全てのメタ情報がデフォルト値の場合はnullを返す', () => {
      const result = generateDisplayFileName({
        documentType: '未判定',
        customerName: '不明顧客',
        officeName: '未判定',
      });
      expect(result).to.be.null;
    });

    it('全てundefinedの場合はnullを返す', () => {
      const result = generateDisplayFileName({});
      expect(result).to.be.null;
    });

    it('拡張子をカスタマイズ可能', () => {
      const result = generateDisplayFileName({
        documentType: '介護保険証',
        customerName: '田中太郎',
        extension: '.jpg',
      });
      expect(result).to.equal('介護保険証_田中太郎.jpg');
    });
  });
});
