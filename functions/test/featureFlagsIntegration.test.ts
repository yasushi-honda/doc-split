/**
 * BE feature flag 読取ヘルパー(functions/src/utils/featureFlags.ts) integration テスト
 * (kanameone現場要件「複数顧客FAX複製機能」、GOAL.md 5-2、Firestore emulator)
 *
 * 実行: firebase emulators:exec --only firestore --project feature-flags-integration-test \
 *         'npm run test:integration'
 */

import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import { cleanupCollections } from './helpers/cleanupEmulator';
import { isFaxDuplicationEnabled, FEATURE_FLAGS_DOC_PATH } from '../src/utils/featureFlags';

const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['settings'];

describe('isFaxDuplicationEnabled (複数顧客FAX複製機能 feature flag)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('フラグドキュメントが存在しない場合、安全側デフォルトとして無効(false)を返す', async () => {
    expect(await isFaxDuplicationEnabled(db)).to.equal(false);
  });

  it('フラグドキュメントは存在するがfaxDuplicationフィールドがない場合、無効(false)を返す', async () => {
    await db.doc(FEATURE_FLAGS_DOC_PATH).set({ unrelatedField: 'x' });
    expect(await isFaxDuplicationEnabled(db)).to.equal(false);
  });

  it('faxDuplication: trueの場合、有効(true)を返す', async () => {
    await db.doc(FEATURE_FLAGS_DOC_PATH).set({ faxDuplication: true });
    expect(await isFaxDuplicationEnabled(db)).to.equal(true);
  });

  it('faxDuplication: falseの場合、無効(false)を返す', async () => {
    await db.doc(FEATURE_FLAGS_DOC_PATH).set({ faxDuplication: false });
    expect(await isFaxDuplicationEnabled(db)).to.equal(false);
  });

  it('faxDuplicationが文字列"true"等truthyな非boolean値の場合も、無効(false)を返す(fail-closed)', async () => {
    await db.doc(FEATURE_FLAGS_DOC_PATH).set({ faxDuplication: 'true' as unknown as boolean });
    expect(await isFaxDuplicationEnabled(db)).to.equal(false);
  });
});
