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
      expect(result.items).to.deep.equal(input);
      expect(result.droppedIds).to.deep.equal([]);
    });

    it('careManagerNameが配列の場合、先頭要素を文字列化する', () => {
      const input = [{
        id: 'c1',
        name: '田中太郎',
        careManagerName: ['山田', '佐藤'] as unknown as string,
      }];
      const result = sanitizeCustomerMasters(input);
      expect(result.items[0].careManagerName).to.equal('山田');
    });

    it('careManagerNameがオブジェクトの場合、undefinedにする', () => {
      const input = [{
        id: 'c1',
        name: '田中太郎',
        careManagerName: { text: '山田' } as unknown as string,
      }];
      const result = sanitizeCustomerMasters(input);
      expect(result.items[0].careManagerName).to.be.undefined;
    });

    it('nameが空文字やundefinedの場合、そのレコードを除外する', () => {
      const input = [
        { id: 'c1', name: '' },
        { id: 'c2', name: undefined as unknown as string },
        { id: 'c3', name: '鈴木一郎' },
      ];
      const result = sanitizeCustomerMasters(input);
      expect(result.items).to.have.length(1);
      expect(result.items[0].name).to.equal('鈴木一郎');
      expect(result.droppedIds).to.deep.equal(['c1', 'c2']);
    });

    it('droppedEntriesにdropの理由(reason)が付与される(#503)', () => {
      const input = [
        { id: 'c1', name: '' }, // 空文字 → empty-name
        { id: 'c2', name: undefined as unknown as string }, // 欠落 → invalid-type
        { id: 'c3', name: { text: '鈴木' } as unknown as string }, // オブジェクト → invalid-type
        { id: 'c4', name: '鈴木一郎' },
      ];
      const result = sanitizeCustomerMasters(input);
      expect(result.droppedEntries).to.deep.equal([
        { id: 'c1', reason: 'empty-name' },
        { id: 'c2', reason: 'invalid-type' },
        { id: 'c3', reason: 'invalid-type' },
      ]);
      // droppedIds は droppedEntries から導出される後方互換フィールド
      expect(result.droppedIds).to.deep.equal(result.droppedEntries.map((e) => e.id));
    });

    it('aliasesが文字列の場合、配列に変換する', () => {
      const input = [{
        id: 'c1',
        name: '田中太郎',
        aliases: '田中' as unknown as string[],
      }];
      const result = sanitizeCustomerMasters(input);
      expect(result.items[0].aliases).to.deep.equal(['田中']);
    });

    it('aliasesがネストした配列の場合、フラット化してstring以外を除外する', () => {
      const input = [{
        id: 'c1',
        name: '田中太郎',
        aliases: ['田中', ['タナカ', '太郎']] as unknown as string[],
      }];
      const result = sanitizeCustomerMasters(input);
      expect(result.items[0].aliases).to.deep.equal(['田中']);
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
      expect(result.items).to.deep.equal(input);
      expect(result.droppedIds).to.deep.equal([]);
    });

    it('shortNameがオブジェクトの場合、undefinedにする', () => {
      const input = [{
        id: 'o1',
        name: 'デイサービスさくら',
        shortName: { text: 'さくら' } as unknown as string,
      }];
      const result = sanitizeOfficeMasters(input);
      expect(result.items[0].shortName).to.be.undefined;
    });

    it('shortNameが配列の場合、先頭要素を文字列化する', () => {
      const input = [{
        id: 'o1',
        name: 'デイサービスさくら',
        shortName: ['さくら', 'サクラ'] as unknown as string,
      }];
      const result = sanitizeOfficeMasters(input);
      expect(result.items[0].shortName).to.equal('さくら');
    });

    it('droppedEntriesにdropの理由(reason)が付与される(#503)', () => {
      const input = [
        { id: 'o1', name: '' }, // 空文字 → empty-name
        { id: 'o2', name: 123 as unknown as string }, // 数値 → invalid-type
        { id: 'o3', name: 'デイサービスさくら' },
      ];
      const result = sanitizeOfficeMasters(input);
      expect(result.droppedEntries).to.deep.equal([
        { id: 'o1', reason: 'empty-name' },
        { id: 'o2', reason: 'invalid-type' },
      ]);
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
        dateMarker: '発行日',
      }];
      const result = sanitizeDocumentMasters(input);
      expect(result.items).to.deep.equal(input);
      expect(result.droppedIds).to.deep.equal([]);
    });

    it('keywordsにネストした配列が含まれる場合、string要素のみ残す', () => {
      const input = [{
        id: 'd1',
        name: '介護保険証',
        keywords: ['被保険者証', ['介護保険']] as unknown as string[],
      }];
      const result = sanitizeDocumentMasters(input);
      expect(result.items[0].keywords).to.deep.equal(['被保険者証']);
    });

    it('keywordsが文字列の場合、配列に変換する', () => {
      const input = [{
        id: 'd1',
        name: '介護保険証',
        keywords: '被保険者証' as unknown as string[],
      }];
      const result = sanitizeDocumentMasters(input);
      expect(result.items[0].keywords).to.deep.equal(['被保険者証']);
    });

    it('dateMarkerが正常なstringの場合、そのまま通過する', () => {
      const input = [{
        id: 'd1',
        name: '介護保険証',
        dateMarker: '発行日',
      }];
      const result = sanitizeDocumentMasters(input);
      expect(result.items[0].dateMarker).to.equal('発行日');
    });

    it('dateMarkerがundefinedの場合、undefinedのまま', () => {
      const input = [{
        id: 'd1',
        name: '介護保険証',
        dateMarker: undefined,
      }];
      const result = sanitizeDocumentMasters(input);
      expect(result.items[0].dateMarker).to.be.undefined;
    });

    it('dateMarkerがnumberの場合、undefinedにする', () => {
      const input = [{
        id: 'd1',
        name: '介護保険証',
        dateMarker: 20260101 as unknown as string,
      }];
      const result = sanitizeDocumentMasters(input);
      expect(result.items[0].dateMarker).to.be.undefined;
    });

    it('dateMarkerがobjectの場合、undefinedにする', () => {
      const input = [{
        id: 'd1',
        name: '介護保険証',
        dateMarker: { text: '発行日' } as unknown as string,
      }];
      const result = sanitizeDocumentMasters(input);
      expect(result.items[0].dateMarker).to.be.undefined;
    });

    it('dateMarkerが配列の場合、先頭要素を文字列化する', () => {
      const input = [{
        id: 'd1',
        name: '介護保険証',
        dateMarker: ['発行日', '作成日'] as unknown as string,
      }];
      const result = sanitizeDocumentMasters(input);
      expect(result.items[0].dateMarker).to.equal('発行日');
    });

    it('dateMarkerが空文字の場合、undefinedに正規化する（下流の truthy チェック依存を排除）', () => {
      const input = [{
        id: 'd1',
        name: '介護保険証',
        dateMarker: '',
      }];
      const result = sanitizeDocumentMasters(input);
      expect(result.items[0].dateMarker).to.be.undefined;
    });

    it('droppedEntriesにdropの理由(reason)が付与される(#503)', () => {
      const input = [
        { id: 'd1', name: '' }, // 空文字 → empty-name
        { id: 'd2', name: ['介護保険証'] as unknown as string }, // 配列 → invalid-type
        { id: 'd3', name: '介護保険証' },
      ];
      const result = sanitizeDocumentMasters(input);
      expect(result.droppedEntries).to.deep.equal([
        { id: 'd1', reason: 'empty-name' },
        { id: 'd2', reason: 'invalid-type' },
      ]);
    });
  });
});
