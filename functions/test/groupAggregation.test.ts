/**
 * groupAggregation.getAffectedGroups() の diff 最適化テスト (ADR-0018 Phase E, Issue #547)
 *
 * 背景: Phase E で documents/{docId} 本体から ocrResult/pageResults を削除する破壊的
 * マイグレーションを行うと、documents 全件への write が一斉に発生する。onDocumentWritten
 * トリガー (updateDocumentGroups.ts) は customerKey/officeKey/documentTypeKey/careManagerKey
 * と status のみを見て getAffectedGroups() を呼び、これらが不変でも delta:0 の
 * no-op group transaction を無条件に push していた（Codexセカンドオピニオン指摘）。
 *
 * 本テストは getAffectedGroups() に追加した早期returnガードを lock-in する:
 *   - 集計対象フィールド（4種のキー + 表示名 + status）が完全に不変な場合 → 空配列（下流write 0）
 *   - いずれかが変化した場合 → 従来通り正しく delta が計算される
 */

import { expect } from 'chai';
import { Timestamp } from 'firebase-admin/firestore';
import { getAffectedGroups } from '../src/utils/groupAggregation';

/** テスト用の DocumentData ベースオブジェクト（集計対象フィールドを全て含む） */
function baseDoc(overrides: Record<string, unknown> = {}) {
  return {
    customerName: '山田太郎',
    officeName: '中央事業所',
    documentType: '介護保険証',
    careManager: '佐藤花子',
    customerKey: '山田太郎',
    officeKey: '中央事業所',
    documentTypeKey: '介護保険証',
    careManagerKey: '佐藤花子',
    fileName: 'original.pdf',
    processedAt: Timestamp.now(),
    status: 'completed',
    ...overrides,
  };
}

describe('getAffectedGroups (diff最適化 / Issue #547 Phase E)', () => {
  describe('集計対象フィールドが完全不変の場合', () => {
    it('ocrResult/pageResults相当の無関係フィールドのみ変更 → 空配列を返す（下流write 0）', () => {
      const before = baseDoc({ fileName: 'original.pdf' });
      // ocrResult/pageResultsはDocumentData型に含まれないため、集計に無関係な
      // fileName/processedAtの変更で代替してシミュレートする
      const after = baseDoc({ fileName: 'original.pdf', processedAt: Timestamp.now() });

      const result = getAffectedGroups(before, after);

      expect(result).to.deep.equal([]);
    });

    it('全フィールドが完全一致（同一オブジェクト相当）→ 空配列を返す', () => {
      const before = baseDoc();
      const after = baseDoc();

      const result = getAffectedGroups(before, after);

      expect(result).to.deep.equal([]);
    });

    it('status変化なし・全キー変化なしなら、fileName変更のみでも下流write 0', () => {
      const before = baseDoc({ fileName: 'a.pdf' });
      const after = baseDoc({ fileName: 'b.pdf' });

      const result = getAffectedGroups(before, after);

      expect(result).to.deep.equal([]);
    });
  });

  describe('集計対象フィールドが変化した場合（既存動作を維持）', () => {
    it('customerKeyが変化 → customerグループはdelta -1/+1、他グループはdelta 0で更新される', () => {
      const before = baseDoc({ customerName: '山田太郎', customerKey: '山田太郎' });
      const after = baseDoc({ customerName: '鈴木一郎', customerKey: '鈴木一郎' });

      const result = getAffectedGroups(before, after);

      const customerEntries = result.filter((r) => r.groupType === 'customer');
      expect(customerEntries).to.have.lengthOf(2);
      expect(customerEntries).to.deep.include({
        groupType: 'customer',
        groupKey: '山田太郎',
        displayName: '山田太郎',
        delta: -1,
      });
      expect(customerEntries).to.deep.include({
        groupType: 'customer',
        groupKey: '鈴木一郎',
        displayName: '鈴木一郎',
        delta: 1,
      });

      // 影響のない3グループは従来通りdelta:0で存在する（既存動作維持）
      const officeEntry = result.find((r) => r.groupType === 'office');
      const documentTypeEntry = result.find((r) => r.groupType === 'documentType');
      const careManagerEntry = result.find((r) => r.groupType === 'careManager');
      expect(officeEntry).to.deep.include({ delta: 0 });
      expect(documentTypeEntry).to.deep.include({ delta: 0 });
      expect(careManagerEntry).to.deep.include({ delta: 0 });
    });

    it('表示名(customerName)のみ変化しキーは同一 → 空配列にはならずdelta 0で表示名が更新される', () => {
      // 正規化により同一キーとなるが、生の表示名が変わるケース
      const before = baseDoc({ customerName: '山田太郎', customerKey: 'yamada' });
      const after = baseDoc({ customerName: 'Ｙａｍａｄａ', customerKey: 'yamada' });

      const result = getAffectedGroups(before, after);

      expect(result).to.not.deep.equal([]);
      const customerEntry = result.find((r) => r.groupType === 'customer');
      expect(customerEntry).to.deep.equal({
        groupType: 'customer',
        groupKey: 'yamada',
        displayName: 'Ｙａｍａｄａ',
        delta: 0,
      });
    });

    it('statusのみ変化（非splitの遷移）→ 空配列にはならずdelta 0で全グループが更新される', () => {
      const before = baseDoc({ status: 'processing' });
      const after = baseDoc({ status: 'completed' });

      const result = getAffectedGroups(before, after);

      expect(result).to.have.lengthOf(4);
      for (const entry of result) {
        expect(entry.delta).to.equal(0);
      }
    });

    it('statusがsplitに変化 → 対象グループはdelta -1のみ（追加なし）', () => {
      const before = baseDoc({ status: 'completed' });
      const after = baseDoc({ status: 'split' });

      const result = getAffectedGroups(before, after);

      expect(result).to.have.lengthOf(4);
      for (const entry of result) {
        expect(entry.delta).to.equal(-1);
      }
    });
  });

  describe('create / delete イベント（早期returnガードの対象外）', () => {
    it('create（before未定義）→ ガードをバイパスし全グループにdelta +1', () => {
      const after = baseDoc();

      const result = getAffectedGroups(undefined, after);

      expect(result).to.have.lengthOf(4);
      for (const entry of result) {
        expect(entry.delta).to.equal(1);
      }
    });

    it('delete（after未定義）→ ガードをバイパスし全グループにdelta -1', () => {
      const before = baseDoc();

      const result = getAffectedGroups(before, undefined);

      expect(result).to.have.lengthOf(4);
      for (const entry of result) {
        expect(entry.delta).to.equal(-1);
      }
    });

    it('before/after両方未定義 → 空配列', () => {
      const result = getAffectedGroups(undefined, undefined);

      expect(result).to.deep.equal([]);
    });
  });
});
