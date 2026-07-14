/**
 * backfillUnassignedCareManagerGroup() integration テスト (GOAL.md タスクG、Firestore emulator)
 *
 * CM未設定グループ(担当CM別集計の非対称性バグ修正)の安全な初期作成ロジックを検証する。
 * `/codex plan` セカンドオピニオンで指摘された「既存なら上書きせず異常終了」の防御を
 * 中心にlock-inする。
 *
 * 実行: firebase emulators:exec --only firestore --project backfill-cm-unassigned-integration-test \
 *         'npm run test:integration'
 */

import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { cleanupCollections } from './helpers/cleanupEmulator';
import { backfillUnassignedCareManagerGroup } from '../src/utils/groupAggregation';

const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['documents', 'documentGroups'];
const GROUP_ID = 'careManager___UNASSIGNED_CARE_MANAGER__';

function baseDoc(overrides: Record<string, unknown> = {}) {
  return {
    fileName: 'x.pdf',
    processedAt: Timestamp.now(),
    ...overrides,
  };
}

describe('backfillUnassignedCareManagerGroup (GOAL.md タスクG)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('careManagerKey空+customerKey非空の書類のみを対象にCM未設定グループを新規作成する', async () => {
    const batch = db.batch();
    batch.set(db.collection('documents').doc('doc-cm-a'), baseDoc({
      customerName: '山田太郎', careManager: '佐藤花子', status: 'processed',
    }));
    batch.set(db.collection('documents').doc('doc-cm-missing-1'), baseDoc({
      customerName: '鈴木一郎', status: 'processed',
    }));
    batch.set(db.collection('documents').doc('doc-cm-missing-2'), baseDoc({
      customerName: '田中花子', careManager: '', status: 'completed',
    }));
    batch.set(db.collection('documents').doc('doc-split-excluded'), baseDoc({
      customerName: '除外太郎', status: 'split',
    }));
    batch.set(db.collection('documents').doc('doc-pending-no-customer'), baseDoc({
      status: 'pending',
    }));
    await batch.commit();

    const result = await backfillUnassignedCareManagerGroup(db, 500);

    expect(result.matched).to.equal(2);
    expect(result.count).to.equal(2);
    expect(result.groupId).to.equal(GROUP_ID);

    const groupSnap = await db.collection('documentGroups').doc(GROUP_ID).get();
    expect(groupSnap.exists).to.equal(true);
    const data = groupSnap.data()!;
    expect(data.groupType).to.equal('careManager');
    expect(data.groupKey).to.equal('__UNASSIGNED_CARE_MANAGER__');
    expect(data.displayName).to.equal('CM未設定');
    expect(data.count).to.equal(2);
    expect(data.latestDocs).to.have.lengthOf(2);
  });

  it('対象0件の場合、グループを作成せずcount:0を返す', async () => {
    await db.collection('documents').doc('doc-cm-a').set(baseDoc({
      customerName: '山田太郎', careManager: '佐藤花子', status: 'processed',
    }));

    const result = await backfillUnassignedCareManagerGroup(db, 500);

    expect(result.matched).to.equal(0);
    expect(result.count).to.equal(0);

    const groupSnap = await db.collection('documentGroups').doc(GROUP_ID).get();
    expect(groupSnap.exists).to.equal(false);
  });

  it('CM未設定グループが既に存在する場合、上書きせず異常終了する(/codex plan指摘の防御)', async () => {
    await db.collection('documents').doc('doc-cm-missing-1').set(baseDoc({
      customerName: '鈴木一郎', status: 'processed',
    }));
    await db.collection('documentGroups').doc(GROUP_ID).set({
      groupType: 'careManager',
      groupKey: '__UNASSIGNED_CARE_MANAGER__',
      displayName: 'CM未設定',
      count: 999,
      latestAt: Timestamp.now(),
      latestDocs: [],
      updatedAt: Timestamp.now(),
    });

    let thrown: unknown;
    try {
      await backfillUnassignedCareManagerGroup(db, 500);
    } catch (e) {
      thrown = e;
    }

    expect(thrown, 'must throw when group already exists').to.not.be.undefined;
    expect((thrown as Error).message).to.include('already exists');

    // 既存グループが上書きされていないことを確認
    const groupSnap = await db.collection('documentGroups').doc(GROUP_ID).get();
    expect(groupSnap.data()!.count).to.equal(999);
  });
});
