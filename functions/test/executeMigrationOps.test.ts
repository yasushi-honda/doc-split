/**
 * Issue #432 PR-C: scripts/lib/executeMigrationOps.ts pure function テスト (F-D2)
 *
 * CLAUDE.md MUST: 「DBにPartial Updateする関数を追加/変更 → テストに『更新対象外フィールドの
 * 値が変化しないこと』を含める」を pure-function ベースで担保する。
 *
 * 各 build*UpdatePayload は Firestore update() に渡す key set を固定する責務。
 * これらの key set が仕様通り (migrate=[fileUrl], regenerate=[fileUrl,status,lastErrorMessage],
 * markError=[status,lastErrorMessage]) であることを test で lock-in する。
 *
 * Note: admin.firestore.FieldValue.delete() は internal sentinel object で構造比較不可のため、
 * lastErrorMessage キーの存在のみ検証する。実際の delete 動作は Firestore emulator integration
 * test で別途確認 (本 PR スコープ外、PR-C2 で dev fixture 経由で動作確認)。
 */

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import {
  buildMigrateUpdatePayload,
  buildRegenerateUpdatePayload,
  buildMarkErrorUpdatePayload,
  EXPECTED_UPDATE_KEYS,
} from '../../scripts/lib/executeMigrationOps';

describe('executeMigrationOps Partial update 不変 (Issue #432 PR-C, F-D2, CLAUDE.md MUST)', () => {
  describe('buildMigrateUpdatePayload', () => {
    it('fileUrl 1 キーのみを返す (他フィールド不変)', () => {
      const payload = buildMigrateUpdatePayload('gs://bucket/processed/abc/file.pdf');
      const keys = Object.keys(payload).sort();
      expect(keys).to.deep.equal([...EXPECTED_UPDATE_KEYS.migrate].sort());
    });

    it('fileUrl の値は引数そのまま', () => {
      const url = 'gs://docsplit-kanameone.firebasestorage.app/processed/xyz/test.pdf';
      const payload = buildMigrateUpdatePayload(url);
      expect(payload.fileUrl).to.equal(url);
    });

    it('fileName / parentDocumentId / status / ocrExtraction 等は payload に含まれない', () => {
      const payload = buildMigrateUpdatePayload('gs://bucket/path');
      expect(payload).to.not.have.property('fileName');
      expect(payload).to.not.have.property('parentDocumentId');
      expect(payload).to.not.have.property('status');
      expect(payload).to.not.have.property('ocrExtraction');
      expect(payload).to.not.have.property('updatedAt');
      expect(payload).to.not.have.property('processedAt');
      expect(payload).to.not.have.property('rotatedAt');
    });
  });

  describe('buildRegenerateUpdatePayload', () => {
    it('fileUrl + status + lastErrorMessage 3 キーのみを返す', () => {
      const payload = buildRegenerateUpdatePayload('gs://bucket/processed/abc/file.pdf');
      const keys = Object.keys(payload).sort();
      expect(keys).to.deep.equal([...EXPECTED_UPDATE_KEYS.regenerate].sort());
    });

    it('status は processed に戻す (orphan 由来 error からの回復)', () => {
      const payload = buildRegenerateUpdatePayload('gs://bucket/path');
      expect(payload.status).to.equal('processed');
    });

    it('lastErrorMessage は FieldValue.delete() (sentinel) で削除', () => {
      const payload = buildRegenerateUpdatePayload('gs://bucket/path');
      expect(payload.lastErrorMessage).to.be.instanceOf(
        admin.firestore.FieldValue.delete().constructor
      );
    });

    it('fileName / parentDocumentId / ocrExtraction 等は payload に含まれない', () => {
      const payload = buildRegenerateUpdatePayload('gs://bucket/path');
      expect(payload).to.not.have.property('fileName');
      expect(payload).to.not.have.property('parentDocumentId');
      expect(payload).to.not.have.property('ocrExtraction');
      expect(payload).to.not.have.property('splitFromPages');
      expect(payload).to.not.have.property('updatedAt');
    });
  });

  describe('buildMarkErrorUpdatePayload', () => {
    it('status + lastErrorMessage 2 キーのみを返す (Storage 操作なし)', () => {
      const payload = buildMarkErrorUpdatePayload('test reason');
      const keys = Object.keys(payload).sort();
      expect(keys).to.deep.equal([...EXPECTED_UPDATE_KEYS.markError].sort());
    });

    it('status は error に固定', () => {
      const payload = buildMarkErrorUpdatePayload('test reason');
      expect(payload.status).to.equal('error');
    });

    it('lastErrorMessage に Issue #432 PR-C migration prefix + reason を含む', () => {
      const reason = 'no parentDocumentId; cannot regenerate';
      const payload = buildMarkErrorUpdatePayload(reason);
      expect(payload.lastErrorMessage).to.contain('Issue #432 PR-C migration');
      expect(payload.lastErrorMessage).to.contain(reason);
    });

    it('fileUrl / fileName / parentDocumentId 等は payload に含まれない', () => {
      const payload = buildMarkErrorUpdatePayload('test');
      expect(payload).to.not.have.property('fileUrl');
      expect(payload).to.not.have.property('fileName');
      expect(payload).to.not.have.property('parentDocumentId');
      expect(payload).to.not.have.property('updatedAt');
    });
  });

  describe('EXPECTED_UPDATE_KEYS (regression lock)', () => {
    it('migrate は fileUrl 1 キーのみであることをドキュメント化', () => {
      expect(EXPECTED_UPDATE_KEYS.migrate).to.deep.equal(['fileUrl']);
    });

    it('regenerate は fileUrl/status/lastErrorMessage 3 キーのみ', () => {
      expect([...EXPECTED_UPDATE_KEYS.regenerate].sort()).to.deep.equal(
        ['fileUrl', 'lastErrorMessage', 'status']
      );
    });

    it('markError は status/lastErrorMessage 2 キーのみ', () => {
      expect([...EXPECTED_UPDATE_KEYS.markError].sort()).to.deep.equal(
        ['lastErrorMessage', 'status']
      );
    });
  });
});
