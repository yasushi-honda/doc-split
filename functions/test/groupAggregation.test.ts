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
import { getAffectedGroups, normalizeGroupKey } from '../src/utils/groupAggregation';
import { CONSTANTS } from '../../shared/types';

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

/**
 * getAffectedGroups() の careManager未設定グループ集計テスト
 *
 * 背景: `careManager`は任意フィールドでフォールバックがなく、正規化キーが
 * 空文字になり得る。従来の実装はキーが空のgroupTypeを集計から丸ごと除外して
 * いたため、担当CM別集計が顧客別集計より大幅に少なく表示される非対称性バグ
 * (kanameone実測 2026-07-14時点: customer合計9,620件 vs careManager合計6,283件、
 * 本PRのバックフィル前スナップショット。数値は将来の本番バックフィルで変化する) が発生していた。
 *
 * 本テストは、careManagerKeyが空でも予約key(CONSTANTS.UNASSIGNED_CARE_MANAGER_KEY)+
 * 表示名「CM未設定」で集計対象に含まれることをlock-inする。
 */
describe('getAffectedGroups (careManager未設定グループの集計 / 非対称性バグ修正)', () => {
  describe('境界値: careManagerKeyが空の場合、予約keyで集計対象に含まれる', () => {
    it('careManager: undefined, careManagerKey: "" → 予約keyでcareManagerグループにdelta+1', () => {
      const after = baseDoc({ careManager: undefined, careManagerKey: '' });

      const result = getAffectedGroups(undefined, after);

      const cmEntry = result.find((r) => r.groupType === 'careManager');
      expect(cmEntry).to.deep.equal({
        groupType: 'careManager',
        groupKey: CONSTANTS.UNASSIGNED_CARE_MANAGER_KEY,
        displayName: CONSTANTS.UNASSIGNED_CARE_MANAGER_DISPLAY_NAME,
        delta: 1,
      });
    });

    it('careManagerKeyが空白文字のみ("　")を正規化した空文字 → 同一のCM未設定グループに集約される', () => {
      // normalizeGroupKey(全角スペース)が''になることを前提とし、getAffectedGroups()側の
      // 挙動としてはundefined/''と同じ扱いになることを検証する
      expect(normalizeGroupKey('　')).to.equal('');

      const after = baseDoc({ careManager: '　', careManagerKey: normalizeGroupKey('　') });

      const result = getAffectedGroups(undefined, after);

      const cmEntry = result.find((r) => r.groupType === 'careManager');
      expect(cmEntry).to.deep.include({
        groupKey: CONSTANTS.UNASSIGNED_CARE_MANAGER_KEY,
        displayName: CONSTANTS.UNASSIGNED_CARE_MANAGER_DISPLAY_NAME,
      });
    });

    it('customer/office/documentTypeのキーが空の場合は従来通り除外される（careManagerのみ特別扱い）', () => {
      const after = baseDoc({ customerName: undefined, customerKey: '' });

      const result = getAffectedGroups(undefined, after);

      const customerEntry = result.find((r) => r.groupType === 'customer');
      expect(customerEntry).to.be.undefined;
      // 他の3タイプは通常通り集計される
      expect(result).to.have.lengthOf(3);
    });
  });

  describe('customerKey未確定時（pending/processing/error相当）の非対称性再発防止', () => {
    it('customerKeyが空（OCR未完了相当）かつcareManagerKeyも空 → careManagerもcustomer同様に除外される（CM未設定へフォールバックしない）', () => {
      // pending/processing/error状態はcustomerName/officeName/documentType/careManagerが
      // 全て未設定（generateGroupKeys()経由でも全キーが空文字）。ここでcareManagerだけ
      // 無条件に予約keyへフォールバックすると、担当CM別合計が顧客別合計を一時的に
      // 上回る新たな非対称性を生む(本来の修正対象の逆パターン)。customerKeyが空の間は
      // careManagerも除外を維持することを検証する。
      const after = baseDoc({
        customerName: undefined,
        customerKey: '',
        officeName: undefined,
        officeKey: '',
        documentType: undefined,
        documentTypeKey: '',
        careManager: undefined,
        careManagerKey: '',
        status: 'pending',
      });

      const result = getAffectedGroups(undefined, after);

      expect(result).to.deep.equal([]);
    });

    it('customerKeyが空 → careManagerKeyが実在CM名でも通常通り計上される（rawKeyがある場合はfallback条件を経由しない）', () => {
      const after = baseDoc({
        customerName: undefined,
        customerKey: '',
        careManager: '佐藤花子',
        careManagerKey: '佐藤花子',
        status: 'pending',
      });

      const result = getAffectedGroups(undefined, after);

      const cmEntry = result.find((r) => r.groupType === 'careManager');
      expect(cmEntry).to.deep.equal({
        groupType: 'careManager',
        groupKey: '佐藤花子',
        displayName: '佐藤花子',
        delta: 1,
      });
    });

    it('customerKeyが確定した瞬間（pending→processed相当）にcareManagerKeyが空ならCM未設定へ計上される', () => {
      const before = baseDoc({
        customerName: undefined,
        customerKey: '',
        careManager: undefined,
        careManagerKey: '',
        status: 'pending',
      });
      const after = baseDoc({
        customerName: '山田太郎',
        customerKey: '山田太郎',
        careManager: undefined,
        careManagerKey: '',
        status: 'processed',
      });

      const result = getAffectedGroups(before, after);

      const cmEntry = result.find((r) => r.groupType === 'careManager');
      expect(cmEntry).to.deep.equal({
        groupType: 'careManager',
        groupKey: CONSTANTS.UNASSIGNED_CARE_MANAGER_KEY,
        displayName: CONSTANTS.UNASSIGNED_CARE_MANAGER_DISPLAY_NAME,
        delta: 1,
      });
    });
  });

  describe('増減対称性: 実在CM ⇄ CM未設定の変更', () => {
    it('実在CMから未設定に変更 → 旧グループdelta-1 + CM未設定グループdelta+1', () => {
      const before = baseDoc({ careManager: '佐藤花子', careManagerKey: '佐藤花子' });
      const after = baseDoc({ careManager: undefined, careManagerKey: '' });

      const result = getAffectedGroups(before, after);

      const cmEntries = result.filter((r) => r.groupType === 'careManager');
      expect(cmEntries).to.have.lengthOf(2);
      expect(cmEntries).to.deep.include({
        groupType: 'careManager',
        groupKey: '佐藤花子',
        displayName: '佐藤花子',
        delta: -1,
      });
      expect(cmEntries).to.deep.include({
        groupType: 'careManager',
        groupKey: CONSTANTS.UNASSIGNED_CARE_MANAGER_KEY,
        displayName: CONSTANTS.UNASSIGNED_CARE_MANAGER_DISPLAY_NAME,
        delta: 1,
      });
    });

    it('未設定から実在CMに変更 → CM未設定グループdelta-1 + 新グループdelta+1', () => {
      const before = baseDoc({ careManager: undefined, careManagerKey: '' });
      const after = baseDoc({ careManager: '鈴木一郎', careManagerKey: '鈴木一郎' });

      const result = getAffectedGroups(before, after);

      const cmEntries = result.filter((r) => r.groupType === 'careManager');
      expect(cmEntries).to.have.lengthOf(2);
      expect(cmEntries).to.deep.include({
        groupType: 'careManager',
        groupKey: CONSTANTS.UNASSIGNED_CARE_MANAGER_KEY,
        displayName: CONSTANTS.UNASSIGNED_CARE_MANAGER_DISPLAY_NAME,
        delta: -1,
      });
      expect(cmEntries).to.deep.include({
        groupType: 'careManager',
        groupKey: '鈴木一郎',
        displayName: '鈴木一郎',
        delta: 1,
      });
    });

    it('careManager未設定のまま他フィールドのみ変更 → CM未設定グループはdelta:0で維持', () => {
      const before = baseDoc({ careManager: undefined, careManagerKey: '', customerName: '山田太郎', customerKey: '山田太郎' });
      const after = baseDoc({ careManager: undefined, careManagerKey: '', customerName: '鈴木一郎', customerKey: '鈴木一郎' });

      const result = getAffectedGroups(before, after);

      const cmEntry = result.find((r) => r.groupType === 'careManager');
      expect(cmEntry).to.deep.equal({
        groupType: 'careManager',
        groupKey: CONSTANTS.UNASSIGNED_CARE_MANAGER_KEY,
        displayName: CONSTANTS.UNASSIGNED_CARE_MANAGER_DISPLAY_NAME,
        delta: 0,
      });
    });
  });

  describe('split状態との組み合わせ', () => {
    it('careManager未設定の書類がstatus:splitに変化 → CM未設定グループはdelta-1のみ（追加なし）', () => {
      const before = baseDoc({ careManager: undefined, careManagerKey: '', status: 'completed' });
      const after = baseDoc({ careManager: undefined, careManagerKey: '', status: 'split' });

      const result = getAffectedGroups(before, after);

      const cmEntry = result.find((r) => r.groupType === 'careManager');
      expect(cmEntry).to.deep.equal({
        groupType: 'careManager',
        groupKey: CONSTANTS.UNASSIGNED_CARE_MANAGER_KEY,
        displayName: CONSTANTS.UNASSIGNED_CARE_MANAGER_DISPLAY_NAME,
        delta: -1,
      });
    });
  });

  describe('予約keyの非衝突性（Codexセカンドオピニオン指摘①のlock-in）', () => {
    it('予約key自身をnormalizeGroupKey()に通しても、予約keyと一致しない（大文字を含むため常に非衝突）', () => {
      const normalized = normalizeGroupKey(CONSTANTS.UNASSIGNED_CARE_MANAGER_KEY);

      expect(normalized).to.not.equal(CONSTANTS.UNASSIGNED_CARE_MANAGER_KEY);
    });
  });
});
