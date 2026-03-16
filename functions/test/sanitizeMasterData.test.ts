/**
 * マスターデータ正規化テスト
 *
 * Firestoreから読み込んだマスターデータの型崩れを防ぐサニタイズ関数のテスト。
 * 背景: kanameone環境で INVALID_ARGUMENT: Property array contains an invalid nested entity
 *       エラーが発生。マスターデータに配列やオブジェクトが混入していた。
 */

import { expect } from 'chai';
import {
  sanitizeCustomerMasters,
  sanitizeOfficeMasters,
  sanitizeDocumentMasters,
} from '../src/utils/sanitizeMasterData';

describe('sanitizeMasterData', () => {
  describe('sanitizeCustomerMasters', () => {
    it('正常なデータはそのまま通過する', () => {
      const input = [{
        id: 'c1',
        name: '田中太郎',
        furigana: 'たなかたろう',
        isDuplicate: false,
        careManagerName: '山田花子',
        aliases: ['田中', 'タナカ'],
      }];
      const result = sanitizeCustomerMasters(input);
      expect(result).to.deep.equal(input);
    });

    it('careManagerNameが配列の場合、先頭要素を文字列化する', () => {
      const input = [{
        id: 'c1',
        name: '田中太郎',
        careManagerName: ['山田', '佐藤'] as unknown as string,
      }];
      const result = sanitizeCustomerMasters(input);
      expect(result[0].careManagerName).to.equal('山田');
    });

    it('careManagerNameがオブジェクトの場合、undefinedにする', () => {
      const input = [{
        id: 'c1',
        name: '田中太郎',
        careManagerName: { text: '山田' } as unknown as string,
      }];
      const result = sanitizeCustomerMasters(input);
      expect(result[0].careManagerName).to.be.undefined;
    });

    it('nameが空文字やundefinedの場合、そのレコードを除外する', () => {
      const input = [
        { id: 'c1', name: '' },
        { id: 'c2', name: undefined as unknown as string },
        { id: 'c3', name: '鈴木一郎' },
      ];
      const result = sanitizeCustomerMasters(input);
      expect(result).to.have.length(1);
      expect(result[0].name).to.equal('鈴木一郎');
    });

    it('aliasesが文字列の場合、配列に変換する', () => {
      const input = [{
        id: 'c1',
        name: '田中太郎',
        aliases: '田中' as unknown as string[],
      }];
      const result = sanitizeCustomerMasters(input);
      expect(result[0].aliases).to.deep.equal(['田中']);
    });

    it('aliasesがネストした配列の場合、フラット化してstring以外を除外する', () => {
      const input = [{
        id: 'c1',
        name: '田中太郎',
        aliases: ['田中', ['タナカ', '太郎']] as unknown as string[],
      }];
      const result = sanitizeCustomerMasters(input);
      expect(result[0].aliases).to.deep.equal(['田中']);
    });
  });

  describe('sanitizeOfficeMasters', () => {
    it('正常なデータはそのまま通過する', () => {
      const input = [{
        id: 'o1',
        name: 'デイサービスさくら',
        shortName: 'さくら',
        isDuplicate: false,
        aliases: ['サクラ'],
      }];
      const result = sanitizeOfficeMasters(input);
      expect(result).to.deep.equal(input);
    });

    it('shortNameがオブジェクトの場合、undefinedにする', () => {
      const input = [{
        id: 'o1',
        name: 'デイサービスさくら',
        shortName: { text: 'さくら' } as unknown as string,
      }];
      const result = sanitizeOfficeMasters(input);
      expect(result[0].shortName).to.be.undefined;
    });

    it('shortNameが配列の場合、先頭要素を文字列化する', () => {
      const input = [{
        id: 'o1',
        name: 'デイサービスさくら',
        shortName: ['さくら', 'サクラ'] as unknown as string,
      }];
      const result = sanitizeOfficeMasters(input);
      expect(result[0].shortName).to.equal('さくら');
    });
  });

  describe('sanitizeDocumentMasters', () => {
    it('正常なデータはそのまま通過する', () => {
      const input = [{
        id: 'd1',
        name: '介護保険証',
        category: '保険',
        keywords: ['被保険者証', '介護保険'],
        aliases: ['保険証'],
      }];
      const result = sanitizeDocumentMasters(input);
      expect(result).to.deep.equal(input);
    });

    it('keywordsにネストした配列が含まれる場合、string要素のみ残す', () => {
      const input = [{
        id: 'd1',
        name: '介護保険証',
        keywords: ['被保険者証', ['介護保険']] as unknown as string[],
      }];
      const result = sanitizeDocumentMasters(input);
      expect(result[0].keywords).to.deep.equal(['被保険者証']);
    });

    it('keywordsが文字列の場合、配列に変換する', () => {
      const input = [{
        id: 'd1',
        name: '介護保険証',
        keywords: '被保険者証' as unknown as string[],
      }];
      const result = sanitizeDocumentMasters(input);
      expect(result[0].keywords).to.deep.equal(['被保険者証']);
    });
  });
});
