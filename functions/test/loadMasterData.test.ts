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
});
