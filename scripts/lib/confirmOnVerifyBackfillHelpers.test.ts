import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isConfirmOnVerifyCandidate,
  tallyConfirmOnVerifyDecisions,
  tallyDriveExportStatus,
  buildConfirmOnVerifyManifest,
  isCustomerFieldRollbackEligible,
  isOfficeFieldRollbackEligible,
  computeRollbackInstructions,
} from './confirmOnVerifyBackfillHelpers';

test('isConfirmOnVerifyCandidate: customerConfirmed/officeConfirmedのどちらかがtrueでなければ対象', () => {
  assert.equal(isConfirmOnVerifyCandidate({}), true);
  assert.equal(isConfirmOnVerifyCandidate({ customerConfirmed: false, officeConfirmed: false }), true);
  assert.equal(isConfirmOnVerifyCandidate({ customerConfirmed: true, officeConfirmed: false }), true);
  assert.equal(isConfirmOnVerifyCandidate({ customerConfirmed: true, officeConfirmed: true }), false);
});

test('tallyConfirmOnVerifyDecisions: 確定パターン別・skip理由別に集計する', () => {
  const tally = tallyConfirmOnVerifyDecisions([
    { customer: { action: 'confirm' }, office: { action: 'confirm' } },
    { customer: { action: 'confirm' }, office: { action: 'skip', reason: 'invalid-name' } },
    { customer: { action: 'skip', reason: 'same-name-collision' }, office: { action: 'confirm' } },
    {
      customer: { action: 'skip', reason: 'same-name-collision' },
      office: { action: 'skip', reason: 'already-confirmed' },
    },
  ]);
  assert.equal(tally.confirmBoth, 1);
  assert.equal(tally.confirmCustomerOnly, 1);
  assert.equal(tally.confirmOfficeOnly, 1);
  assert.equal(tally.confirmNeither, 1);
  assert.deepEqual(tally.customerSkipReasons, { 'same-name-collision': 2 });
  assert.deepEqual(tally.officeSkipReasons, { 'invalid-name': 1, 'already-confirmed': 1 });
});

test('tallyDriveExportStatus: フィールド不在は"(フィールド不在)"キーに集計する', () => {
  const tally = tallyDriveExportStatus(['error', 'error', 'exported', undefined]);
  assert.deepEqual(tally, { error: 2, exported: 1, '(フィールド不在)': 1 });
});

test('buildConfirmOnVerifyManifest: 渡したentriesをそのまま保持する', () => {
  const manifest = buildConfirmOnVerifyManifest({
    runId: 'run-1',
    projectId: 'proj-1',
    timestampIso: '2026-09-23T00:00:00.000Z',
    entries: [{ docId: 'doc-1', confirmedCustomer: true, confirmedOffice: false }],
  });
  assert.equal(manifest.runId, 'run-1');
  assert.equal(manifest.entries.length, 1);
  assert.equal(manifest.entries[0].docId, 'doc-1');
});

test('isCustomerFieldRollbackEligible: confirmedByが未設定(null/undefined)のときのみtrue', () => {
  assert.equal(isCustomerFieldRollbackEligible({}), true);
  assert.equal(isCustomerFieldRollbackEligible({ confirmedBy: null }), true);
  assert.equal(isCustomerFieldRollbackEligible({ confirmedBy: 'user-1' }), false, '人間が後から確定した場合はロールバック対象外');
});

test('isOfficeFieldRollbackEligible: officeConfirmedByが未設定のときのみtrue', () => {
  assert.equal(isOfficeFieldRollbackEligible({}), true);
  assert.equal(isOfficeFieldRollbackEligible({ officeConfirmedBy: 'user-1' }), false);
});

test('computeRollbackInstructions: 実行前がフィールド不在ならdelete、falseならその値へset', () => {
  const deleteBoth = computeRollbackInstructions({
    docId: 'doc-1',
    confirmedCustomer: true,
    confirmedOffice: true,
  });
  assert.deepEqual(deleteBoth.customer, { action: 'delete' });
  assert.deepEqual(deleteBoth.office, { action: 'delete' });

  const setFalse = computeRollbackInstructions({
    docId: 'doc-2',
    confirmedCustomer: true,
    customerConfirmedBefore: false,
    confirmedOffice: false,
  });
  assert.deepEqual(setFalse.customer, { action: 'set', value: false });
  assert.equal(setFalse.office, undefined, 'confirmedOffice:falseのentryはoffice側の指示を返さない');
});
