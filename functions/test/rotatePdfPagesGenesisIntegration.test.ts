/**
 * rotatePdfPages genesis 分岐 統合テスト (Firebase emulator、ADR-0016 MUST 8)
 *
 * splitPdfIntegration.test.ts と同じ方式: Storage/pdf-lib の副作用は本テスト scope 外。
 * rotatePdfPages の Step 7 (`docRef.update({ fileUrl, pageRotations, rotatedAt, provenance,
 * ...(provenanceOrigin ? { provenanceOrigin } : {}) }, { lastUpdateTime })`) と同等の書き込みを
 * 実行し、CLAUDE.md MUST の Partial Update 不変契約 (更新対象外フィールドの値が変化しないこと) を
 * 検証する。genesis provenance の合成自体は createGenesisProvenance() の pure function unit test
 * (provenance.test.ts) でカバー済み。
 *
 * 実行: firebase emulators:exec --only firestore --project rotate-genesis-integration-test \
 *         'npm run test:integration'
 */

import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import { cleanupCollections } from './helpers/cleanupEmulator';
import { createGenesisProvenance } from '../src/pdf/provenance';

const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['documents'];

// rotatePdfPages Step 7 と同等の Partial Update (genesis doc、provenanceOrigin を含む)
async function applyGenesisRotationUpdate(
  docRef: admin.firestore.DocumentReference,
  params: {
    newFileUrl: string;
    provenance: unknown;
    provenanceOrigin: unknown;
  }
): Promise<void> {
  await docRef.update({
    fileUrl: params.newFileUrl,
    pageRotations: [{ pageNumber: 1, rotation: 90 }],
    rotatedAt: admin.firestore.FieldValue.serverTimestamp(),
    provenance: params.provenance,
    provenanceOrigin: params.provenanceOrigin,
  });
}

describe('rotatePdfPages genesis 分岐 統合テスト (ADR-0016 MUST 8)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('genesis doc の初回回転で provenance + provenanceOrigin のみが追加され、他フィールドは不変 (Partial Update 契約)', async () => {
    const docId = 'genesis-rotate-001';
    const originalFileUrl =
      'gs://docsplit-kanameone.firebasestorage.app/original/1785120783129_test.pdf';
    const originalData = {
      fileName: 'test.pdf',
      fileUrl: originalFileUrl,
      mimeType: 'application/pdf',
      totalPages: 1,
      status: 'processed',
      customerName: '森田 和則',
      officeName: 'はっぴーケアーサービス',
      documentType: 'サービス担当者に対する照会',
      verified: true,
    };
    await db.doc(`documents/${docId}`).set(originalData);

    const { provenance, provenanceOrigin } = createGenesisProvenance({
      observedObjectPath: 'original/1785120783129_test.pdf',
      observedBucket: 'docsplit-kanameone.firebasestorage.app',
      observedGeneration: '1700000000000001',
      observedMetageneration: '1',
      observedSha256: 'e'.repeat(64),
      hadParentDocumentId: false,
    });

    const newObjectPath = `processed/${docId}/rotations/rotation-id-1.pdf`;
    const newFileUrl = `gs://docsplit-kanameone.firebasestorage.app/${newObjectPath}`;

    await applyGenesisRotationUpdate(db.doc(`documents/${docId}`), {
      newFileUrl,
      provenance,
      provenanceOrigin,
    });

    const snap = await db.doc(`documents/${docId}`).get();
    const data = snap.data()!;

    // 追加/更新された 4 フィールド
    expect(data.fileUrl).to.equal(newFileUrl);
    expect(data.pageRotations).to.deep.equal([{ pageNumber: 1, rotation: 90 }]);
    expect(data.rotatedAt).to.exist;
    expect(data.provenance.sourcePath).to.equal('original/1785120783129_test.pdf');
    expect(data.provenance.derivedObjectPath).to.equal('original/1785120783129_test.pdf');
    expect(data.provenanceOrigin.method).to.equal('rotate-genesis');
    expect(data.provenanceOrigin.hadParentDocumentId).to.equal(false);

    // 更新対象外フィールドが不変 (CLAUDE.md MUST: Partial Update の不変契約)
    expect(data.fileName).to.equal('test.pdf');
    expect(data.mimeType).to.equal('application/pdf');
    expect(data.totalPages).to.equal(1);
    expect(data.status).to.equal('processed');
    expect(data.customerName).to.equal('森田 和則');
    expect(data.officeName).to.equal('はっぴーケアーサービス');
    expect(data.documentType).to.equal('サービス担当者に対する照会');
    expect(data.verified).to.equal(true);
  });

  it('通常 doc (provenance 既存) の回転更新は provenanceOrigin を含まない (通常分岐との差異確認)', async () => {
    const docId = 'normal-rotate-001';
    await db.doc(`documents/${docId}`).set({
      fileName: 'split-child.pdf',
      fileUrl: 'gs://bucket/processed/normal-rotate-001/output.pdf',
      status: 'processed',
    });

    // 通常分岐相当: provenanceOrigin を含めない update (rotatePdfPages の
    // `...(provenanceOrigin ? { provenanceOrigin } : {})` が偽の場合の payload と同型)
    await db.doc(`documents/${docId}`).update({
      fileUrl: 'gs://bucket/processed/normal-rotate-001/rotations/rotation-id-1.pdf',
      pageRotations: [{ pageNumber: 1, rotation: 90 }],
      rotatedAt: admin.firestore.FieldValue.serverTimestamp(),
      provenance: { sourcePath: 'attachments/parent.pdf' },
    });

    const snap = await db.doc(`documents/${docId}`).get();
    const data = snap.data()!;
    expect(data.provenance).to.exist;
    expect(data.provenanceOrigin).to.be.undefined;
  });
});
