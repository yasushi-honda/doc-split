/**
 * Storage delete safety net のユニットテスト (Issue #432 PR-A)
 *
 * 純粋関数 hasOtherSharingDoc の挙動分岐を検証。
 * Firestore 連携部 (canSafelyDeleteStorageFile) は Issue #432 PR-B で
 * emulator integration test を追加予定 (本 PR スコープ外)。
 */

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
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

    it('共有 doc が 2 件で自分が含まれない → true (3+ 件共有時に limit(2) 範囲外に自分が出るケース、保守的に delete 不可)', () => {
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

/**
 * 構造化ログのキー名契約テスト (Issue #432 PR-A)
 *
 * Cloud Logging クエリ (Test plan で監視対象) は以下のキー名に依存する:
 *   - skippedStorageDelete: true
 *   - skipReason: 'sharedFileUrl' | 'safetyNetQueryFailed'
 *   - operation: 'rotatePdfPages' | 'deleteDocument'
 *   - documentId, fileUrl
 *
 * 将来のリファクタでキー名が silently 変更されると kanameone 環境の監視が壊れるため、
 * grep contract で固定する (純粋関数のテストでは検出不可能な接続部の lock-in)。
 */
describe('構造化ログのキー名契約 (Issue #432 PR-A Cloud Logging クエリ保護)', () => {
  const sourceFiles = [
    {
      label: 'pdfOperations.ts (rotatePdfPages)',
      filePath: path.join(__dirname, '..', 'src', 'pdf', 'pdfOperations.ts'),
      operationName: 'rotatePdfPages',
    },
    {
      label: 'deleteDocument.ts',
      filePath: path.join(__dirname, '..', 'src', 'documents', 'deleteDocument.ts'),
      operationName: 'deleteDocument',
    },
  ];

  for (const { label, filePath, operationName } of sourceFiles) {
    describe(label, () => {
      const content = fs.readFileSync(filePath, 'utf-8');

      it("skippedStorageDelete: true キーが含まれる", () => {
        expect(content).to.match(/skippedStorageDelete:\s*true/);
      });

      it("skipReason キーが含まれる (skip 理由の識別フィールド)", () => {
        expect(content).to.include('skipReason:');
      });

      it("skipReason に 'sharedFileUrl' リテラルが含まれる (共有検出 skip)", () => {
        expect(content).to.match(/skipReason:\s*['"]sharedFileUrl['"]/);
      });

      it("skipReason に 'safetyNetQueryFailed' リテラルが含まれる (query 失敗 skip)", () => {
        expect(content).to.match(/skipReason:\s*['"]safetyNetQueryFailed['"]/);
      });

      it(`operation キーに '${operationName}' が含まれる`, () => {
        const pattern = new RegExp(
          `operation:\\s*['"]${operationName}['"]`
        );
        expect(content).to.match(pattern);
      });

      it("documentId キーが含まれる (Cloud Logging filter で必須)", () => {
        expect(content).to.match(/^\s*documentId,?\s*$/m);
      });

      it("fileUrl キーが含まれる (Cloud Logging filter で必須)", () => {
        expect(content).to.match(/^\s*fileUrl,?\s*$/m);
      });
    });
  }
});
