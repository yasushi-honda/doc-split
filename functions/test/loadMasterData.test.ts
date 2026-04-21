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

  it('drop が発生すると console.warn で observable 化される (#344)', async () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: unknown) => warnings.push(String(msg));
    try {
      const stub = createFirestoreStub({
        'masters/documents/items': [
          { id: 'd1', data: { name: '保険証' } },
          { id: 'd2', data: {} }, // name 欠落 → drop
        ],
        'masters/customers/items': [],
        'masters/offices/items': [],
      });
      await loadMasterData(stub);
      expect(warnings).to.have.length(1);
      expect(warnings[0]).to.include('[loadMasterData]');
      expect(warnings[0]).to.include('Records dropped during sanitize');
      expect(warnings[0]).to.include('documents: 1/2');
      expect(warnings[0]).to.include('d2');
    } finally {
      console.warn = originalWarn;
    }
  });

  it('全レコード drop のケースでは ALL RECORDS DROPPED prefix になる (#344)', async () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: unknown) => warnings.push(String(msg));
    try {
      const stub = createFirestoreStub({
        'masters/documents/items': [{ id: 'd1', data: {} }], // name 欠落
        'masters/customers/items': [],
        'masters/offices/items': [],
      });
      await loadMasterData(stub);
      expect(warnings).to.have.length(1);
      expect(warnings[0]).to.include('ALL RECORDS DROPPED');
      expect(warnings[0]).to.include('documents: 1/1');
    } finally {
      console.warn = originalWarn;
    }
  });

  it('drop ゼロのケースでは console.warn が呼ばれない (no-op path) (#344)', async () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: unknown) => warnings.push(String(msg));
    try {
      const stub = createFirestoreStub({
        'masters/documents/items': [{ id: 'd1', data: { name: '保険証' } }],
        'masters/customers/items': [],
        'masters/offices/items': [],
      });
      await loadMasterData(stub);
      expect(warnings).to.deep.equal([]);
    } finally {
      console.warn = originalWarn;
    }
  });

  it('rawCount=0 の kind が混在しても ALL RECORDS DROPPED は誤発動しない (#344 silent-failure-hunter)', async () => {
    // customers / offices が空 (rawCount=0) で documents のみ全件 drop した時、
    // hasAllDroppedKind は documents の rawCount>0 判定で ALL RECORDS DROPPED 発動。
    // rawCount=0 コレクションが偽陽性トリガーにならないことを lock-in。
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: unknown) => warnings.push(String(msg));
    try {
      const stub = createFirestoreStub({
        'masters/documents/items': [{ id: 'd1', data: {} }], // 全件 drop
        'masters/customers/items': [], // rawCount=0
        'masters/offices/items': [], // rawCount=0
      });
      await loadMasterData(stub);
      expect(warnings[0]).to.include('ALL RECORDS DROPPED');
      // customers/offices は warn の summary に含まれない (dropped.filter で除外)
      expect(warnings[0]).not.to.include('customers');
      expect(warnings[0]).not.to.include('offices');
    } finally {
      console.warn = originalWarn;
    }
  });

  it('id 欠落レコードが drop された場合、droppedIds には "(unknown)" が入る (#344)', async () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: unknown) => warnings.push(String(msg));
    try {
      const stub = createFirestoreStub({
        'masters/documents/items': [{ id: '', data: {} }], // id も name も欠落 (doc.id='' は createFirestoreStub で保持)
        'masters/customers/items': [],
        'masters/offices/items': [],
      });
      await loadMasterData(stub);
      // id は空文字のまま toDocumentMaster に渡り、sanitize で name 欠落 → drop。
      // safeId は string && length>0 なので '' は '(unknown)' に fallback する契約 lock-in
      expect(warnings[0]).to.include('(unknown)');
    } finally {
      console.warn = originalWarn;
    }
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
