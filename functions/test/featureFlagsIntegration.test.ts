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
import {
  isFaxDuplicationEnabled,
  isDriveExportEnabled,
  getDriveExportGate,
  FEATURE_FLAGS_DOC_PATH,
} from '../src/utils/featureFlags';

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

describe('isDriveExportEnabled (Google Drive連携 feature flag, ADR-0022)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('フラグドキュメントが存在しない場合、安全側デフォルトとして無効(false)を返す', async () => {
    expect(await isDriveExportEnabled(db)).to.equal(false);
  });

  it('フラグドキュメントは存在するがdriveExportフィールドがない場合、無効(false)を返す', async () => {
    await db.doc(FEATURE_FLAGS_DOC_PATH).set({ unrelatedField: 'x' });
    expect(await isDriveExportEnabled(db)).to.equal(false);
  });

  it('driveExport: trueの場合、有効(true)を返す', async () => {
    await db.doc(FEATURE_FLAGS_DOC_PATH).set({ driveExport: true });
    expect(await isDriveExportEnabled(db)).to.equal(true);
  });

  it('driveExport: falseの場合、無効(false)を返す', async () => {
    await db.doc(FEATURE_FLAGS_DOC_PATH).set({ driveExport: false });
    expect(await isDriveExportEnabled(db)).to.equal(false);
  });

  it('driveExportが文字列"true"等truthyな非boolean値の場合も、無効(false)を返す(fail-closed)', async () => {
    await db.doc(FEATURE_FLAGS_DOC_PATH).set({ driveExport: 'true' as unknown as boolean });
    expect(await isDriveExportEnabled(db)).to.equal(false);
  });

  it('faxDuplicationがtrueでもdriveExportが未設定なら、driveExportは無効(false)を返す(フラグ独立性)', async () => {
    await db.doc(FEATURE_FLAGS_DOC_PATH).set({ faxDuplication: true });
    expect(await isDriveExportEnabled(db)).to.equal(false);
  });
});

describe('getDriveExportGate (allowlist込みgate、Phase D/E再設計 Codex Finding1対応)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('フラグドキュメントが存在しない場合、enabled:false・allowlist:null(制限なし)を返す', async () => {
    expect(await getDriveExportGate(db)).to.deep.equal({ enabled: false, allowlist: null });
  });

  it('driveExportAllowlistフィールドが無い場合、allowlist:null(制限なし、既存の全展開挙動を保持)を返す', async () => {
    await db.doc(FEATURE_FLAGS_DOC_PATH).set({ driveExport: true });
    expect(await getDriveExportGate(db)).to.deep.equal({ enabled: true, allowlist: null });
  });

  it('driveExportAllowlistが空配列の場合、allowlist:[](全docId拒否)を返す', async () => {
    await db.doc(FEATURE_FLAGS_DOC_PATH).set({ driveExport: true, driveExportAllowlist: [] });
    expect(await getDriveExportGate(db)).to.deep.equal({ enabled: true, allowlist: [] });
  });

  it('driveExportAllowlistが文字列配列の場合、そのままallowlistとして返す', async () => {
    await db.doc(FEATURE_FLAGS_DOC_PATH).set({ driveExport: true, driveExportAllowlist: ['docA', 'docB'] });
    expect(await getDriveExportGate(db)).to.deep.equal({ enabled: true, allowlist: ['docA', 'docB'] });
  });

  it('driveExportAllowlistが配列でない(不正値)場合、fail-closedでallowlist:[](全拒否)を返す', async () => {
    await db.doc(FEATURE_FLAGS_DOC_PATH).set({ driveExport: true, driveExportAllowlist: 'docA' as unknown });
    expect(await getDriveExportGate(db)).to.deep.equal({ enabled: true, allowlist: [] });
  });

  it('driveExportAllowlistが非string混在配列の場合、fail-closedでallowlist:[](全拒否)を返す', async () => {
    await db
      .doc(FEATURE_FLAGS_DOC_PATH)
      .set({ driveExport: true, driveExportAllowlist: ['docA', 123] as unknown });
    expect(await getDriveExportGate(db)).to.deep.equal({ enabled: true, allowlist: [] });
  });

  it('driveExportAllowlistフィールドが明示的にnullの場合、フィールド不在とは区別しfail-closedでallowlist:[](全拒否)を返す(codex review P1指摘対応: コンソール誤操作等でnullが書き込まれても制限なし扱いにならない)', async () => {
    await db.doc(FEATURE_FLAGS_DOC_PATH).set({ driveExport: true, driveExportAllowlist: null });
    expect(await getDriveExportGate(db)).to.deep.equal({ enabled: true, allowlist: [] });
  });
});
