/**
 * loadMasterData の単体テスト。3 コレクション並列取得 + サニタイズ委譲 + Firestore エラー伝播を検証する。
 */

import { expect } from 'chai';
import type * as admin from 'firebase-admin';
import { loadMasterData } from '../src/utils/loadMasterData';

/** Firestore の collection().get() を最小限スタブする */
function createFirestoreStub(
  collectionData: Record<string, Array<{ id: string; data: Record<string, unknown> }>>
): admin.firestore.Firestore {
  return {
    collection(path: string) {
      return {
        get: async () => ({
          docs: (collectionData[path] || []).map((d) => ({
            id: d.id,
            data: () => d.data,
          })),
        }),
      };
    },
  } as unknown as admin.firestore.Firestore;
}

describe('loadMasterData', () => {
  it('3コレクションを並列取得し、サニタイズ済みで返す', async () => {
    const stub = createFirestoreStub({
      'masters/documents/items': [
        { id: 'd1', data: { name: '介護保険証', category: '保険', dateMarker: '発行日' } },
      ],
      'masters/customers/items': [
        { id: 'c1', data: { name: '田中太郎', furigana: 'たなかたろう' } },
      ],
      'masters/offices/items': [
        { id: 'o1', data: { name: 'デイサービスさくら', shortName: 'さくら' } },
      ],
    });

    const result = await loadMasterData(stub);

    expect(result.documents).to.have.length(1);
    expect(result.documents[0]).to.include({ id: 'd1', name: '介護保険証', dateMarker: '発行日' });
    expect(result.customers).to.have.length(1);
    expect(result.customers[0]).to.include({ id: 'c1', name: '田中太郎' });
    expect(result.offices).to.have.length(1);
    expect(result.offices[0]).to.include({ id: 'o1', name: 'デイサービスさくら' });
  });

  it('空コレクションの場合、空配列を返す', async () => {
    const stub = createFirestoreStub({
      'masters/documents/items': [],
      'masters/customers/items': [],
      'masters/offices/items': [],
    });

    const result = await loadMasterData(stub);

    expect(result.documents).to.deep.equal([]);
    expect(result.customers).to.deep.equal([]);
    expect(result.offices).to.deep.equal([]);
  });

  it('サニタイズが適用される（dateMarkerが型崩れしている場合、undefinedに正規化）', async () => {
    const stub = createFirestoreStub({
      'masters/documents/items': [
        { id: 'd1', data: { name: '介護保険証', dateMarker: { text: '発行日' } } },
      ],
      'masters/customers/items': [],
      'masters/offices/items': [],
    });

    const result = await loadMasterData(stub);

    expect(result.documents[0]?.dateMarker).to.be.undefined;
  });

  it('Firestoreエラーは呼び出し元に伝播する', async () => {
    const failingStub = {
      collection() {
        return {
          get: async () => {
            throw new Error('Firestore unavailable');
          },
        };
      },
    } as unknown as admin.firestore.Firestore;

    try {
      await loadMasterData(failingStub);
      expect.fail('should throw');
    } catch (err) {
      expect((err as Error).message).to.equal('Firestore unavailable');
    }
  });

  it('3コレクションのうち1つだけrejectしても呼び出し元に伝播する（Promise.all 先着reject）', async () => {
    const partialFailingStub = {
      collection(path: string) {
        return {
          get: async () => {
            if (path === 'masters/customers/items') {
              throw new Error('customers fetch failed');
            }
            return {
              docs:
                path === 'masters/documents/items'
                  ? [{ id: 'd1', data: () => ({ name: '保険証' }) }]
                  : [{ id: 'o1', data: () => ({ name: '事業所A' }) }],
            };
          },
        };
      },
    } as unknown as admin.firestore.Firestore;

    try {
      await loadMasterData(partialFailingStub);
      expect.fail('should throw');
    } catch (err) {
      expect((err as Error).message).to.equal('customers fetch failed');
    }
  });

  it('全レコードがサニタイズで除外されるケース（name欠落のみ）では空配列を返す', async () => {
    const stub = createFirestoreStub({
      'masters/documents/items': [
        { id: 'd1', data: { category: '保険' } }, // name 欠落
        { id: 'd2', data: { name: '', category: '届出' } }, // name 空文字
      ],
      'masters/customers/items': [
        { id: 'c1', data: { furigana: 'たろう' } }, // name 欠落
      ],
      'masters/offices/items': [
        { id: 'o1', data: { name: 123 } }, // name が数値（型崩れ）
      ],
    });

    const result = await loadMasterData(stub);

    expect(result.documents).to.deep.equal([]);
    expect(result.customers).to.deep.equal([]);
    expect(result.offices).to.deep.equal([]);
  });

  it('name欠落レコードはsilent dropされ、有効レコードのみ残る（3 sanitizer 全てで同契約）', async () => {
    const stub = createFirestoreStub({
      'masters/documents/items': [
        { id: 'd1', data: { name: '保険証', category: '保険' } },
        { id: 'd2', data: { category: '届出' } }, // name 欠落 → drop
        { id: 'd3', data: { name: '請求書' } },
      ],
      'masters/customers/items': [
        { id: 'c1', data: { name: '田中太郎' } },
        { id: 'c2', data: { furigana: 'すずき' } }, // name 欠落 → drop
        { id: 'c3', data: { name: '鈴木花子' } },
      ],
      'masters/offices/items': [
        { id: 'o1', data: { name: '事業所A' } },
        { id: 'o2', data: { shortName: 'B' } }, // name 欠落 → drop
        { id: 'o3', data: { name: '事業所C' } },
      ],
    });

    const result = await loadMasterData(stub);

    expect(result.documents).to.have.length(2);
    expect(result.documents.map((d) => d.id)).to.deep.equal(['d1', 'd3']);
    expect(result.customers).to.have.length(2);
    expect(result.customers.map((c) => c.id)).to.deep.equal(['c1', 'c3']);
    expect(result.offices).to.have.length(2);
    expect(result.offices.map((o) => o.id)).to.deep.equal(['o1', 'o3']);
  });
});
