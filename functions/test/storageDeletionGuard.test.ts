/**
 * Storage delete safety net のユニットテスト (Issue #432 PR-A)
 *
 * 純粋関数 hasOtherSharingDoc の挙動分岐を検証。
 * Firestore 連携部 (canSafelyDeleteStorageFile) は emulator integration test 範囲。
 */

import { expect } from 'chai';
import { hasOtherSharingDoc } from '../src/storage/storageDeletionGuard';

describe('hasOtherSharingDoc (Issue #432 PR-A safety net)', () => {
  describe('単独参照 (delete 安全)', () => {
    it('共有 doc が 0 件 → false (他参照なし、安全)', () => {
      expect(hasOtherSharingDoc([], 'self-id')).to.be.false;
    });

    it('共有 doc が自分自身のみ → false (他参照なし、安全)', () => {
      expect(hasOtherSharingDoc([{ id: 'self-id' }], 'self-id')).to.be.false;
    });
  });

  describe('共有あり (delete 危険、skip すべき)', () => {
    it('共有 doc が他 1 件 → true (他参照あり、危険)', () => {
      expect(hasOtherSharingDoc([{ id: 'other-id' }], 'self-id')).to.be.true;
    });

    it('共有 doc が 2 件以上 → true (他参照あり、危険)', () => {
      expect(
        hasOtherSharingDoc([{ id: 'self-id' }, { id: 'other-id' }], 'self-id')
      ).to.be.true;
    });

    it('共有 doc が 2 件で自分が含まれない → true (limit(2) 範囲外に自分があるケース)', () => {
      expect(
        hasOtherSharingDoc([{ id: 'other-1' }, { id: 'other-2' }], 'self-id')
      ).to.be.true;
    });
  });

  describe('境界・異常系', () => {
    it('selfDocumentId が空文字でも単独 doc が空文字なら false', () => {
      expect(hasOtherSharingDoc([{ id: '' }], '')).to.be.false;
    });

    it('selfDocumentId が空文字、共有 doc が他 ID あり → true', () => {
      expect(hasOtherSharingDoc([{ id: 'other' }], '')).to.be.true;
    });
  });
});
