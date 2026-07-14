/**
 * 集計所属変更メンテナンスゲート(functions/src/utils/maintenanceGate.ts) integration テスト
 * (GOAL.md タスクG、Firestore emulator)
 *
 * 実行: firebase emulators:exec --only firestore --project maintenance-gate-integration-test \
 *         'npm run test:integration'
 */

import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import { cleanupCollections } from './helpers/cleanupEmulator';
import { isGroupAggregationGateOpen, MAINTENANCE_FLAGS_DOC_PATH } from '../src/utils/maintenanceGate';

const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['system'];

describe('isGroupAggregationGateOpen (GOAL.md タスクG メンテナンスゲート)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('フラグドキュメントが存在しない場合、安全側デフォルトとして開いている(true)を返す', async () => {
    expect(await isGroupAggregationGateOpen(db)).to.equal(true);
  });

  it('フラグドキュメントは存在するがgroupAggregationGateOpenフィールドがない場合、開いている(true)を返す', async () => {
    await db.doc(MAINTENANCE_FLAGS_DOC_PATH).set({ unrelatedField: 'x' });
    expect(await isGroupAggregationGateOpen(db)).to.equal(true);
  });

  it('groupAggregationGateOpen: trueの場合、開いている(true)を返す', async () => {
    await db.doc(MAINTENANCE_FLAGS_DOC_PATH).set({ groupAggregationGateOpen: true });
    expect(await isGroupAggregationGateOpen(db)).to.equal(true);
  });

  it('groupAggregationGateOpen: falseの場合、閉じている(false)を返す', async () => {
    await db.doc(MAINTENANCE_FLAGS_DOC_PATH).set({ groupAggregationGateOpen: false });
    expect(await isGroupAggregationGateOpen(db)).to.equal(false);
  });

  it('falseからtrueに戻すと、再び開いている(true)を返す(ゲート再開の確認)', async () => {
    await db.doc(MAINTENANCE_FLAGS_DOC_PATH).set({ groupAggregationGateOpen: false });
    expect(await isGroupAggregationGateOpen(db)).to.equal(false);

    await db.doc(MAINTENANCE_FLAGS_DOC_PATH).set({ groupAggregationGateOpen: true }, { merge: true });
    expect(await isGroupAggregationGateOpen(db)).to.equal(true);
  });
});
