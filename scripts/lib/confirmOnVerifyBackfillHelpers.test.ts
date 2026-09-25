import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isConfirmOnVerifyCandidate,
  tallyConfirmOnVerifyDecisions,
  tallyDriveExportStatus,
  buildConfirmOnVerifyManifest,
  isRollbackEligibleByUpdateTime,
  computeRollbackInstructions,
  isValidManifestEntry,
  isValidManifest,
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
    entries: [
      {
        docId: 'doc-1',
        customer: { confirmedCustomer: true, customerConfirmedBefore: undefined, resetNeedsManualCustomerSelection: false },
        office: { confirmedOffice: false },
        backfillUpdateTime: { seconds: 1, nanoseconds: 0 },
      },
    ],
  });
  assert.equal(manifest.runId, 'run-1');
  assert.equal(manifest.entries.length, 1);
  assert.equal(manifest.entries[0].docId, 'doc-1');
});

test('isRollbackEligibleByUpdateTime: backfill書込み直後のupdateTimeとライブのupdateTimeが完全一致する場合のみtrue', () => {
  const entry = {
    docId: 'doc-1',
    customer: { confirmedCustomer: true, customerConfirmedBefore: undefined, resetNeedsManualCustomerSelection: false },
    office: { confirmedOffice: true, officeConfirmedBefore: undefined },
    backfillUpdateTime: { seconds: 1_700_000_000, nanoseconds: 123_000_000 },
  } as const;
  assert.equal(isRollbackEligibleByUpdateTime(entry, { seconds: 1_700_000_000, nanoseconds: 123_000_000 }), true);
  assert.equal(
    isRollbackEligibleByUpdateTime(entry, { seconds: 1_700_000_001, nanoseconds: 123_000_000 }),
    false,
    'secondsが異なれば(人間の再確定/OCR再処理の自動確定いずれによる上書きでも)対象外'
  );
  assert.equal(
    isRollbackEligibleByUpdateTime(entry, { seconds: 1_700_000_000, nanoseconds: 123_000_001 }),
    false,
    'nanosecondsが1でも異なれば対象外(同一ミリ秒内の別書込みをtoMillis()丸めで見逃さないための精度、codexレビュー指摘5回目)'
  );
});

test('computeRollbackInstructions: 実行前がフィールド不在ならdelete、falseならその値へset', () => {
  const deleteBoth = computeRollbackInstructions({
    docId: 'doc-1',
    customer: { confirmedCustomer: true, customerConfirmedBefore: undefined, resetNeedsManualCustomerSelection: false },
    office: { confirmedOffice: true, officeConfirmedBefore: undefined },
    backfillUpdateTime: { seconds: 1000, nanoseconds: 0 },
  });
  assert.deepEqual(deleteBoth.customer, { action: 'delete' });
  assert.deepEqual(deleteBoth.office, { action: 'delete' });
  assert.equal(deleteBoth.needsManualCustomerSelection, undefined);

  const setFalse = computeRollbackInstructions({
    docId: 'doc-2',
    customer: { confirmedCustomer: true, customerConfirmedBefore: false, resetNeedsManualCustomerSelection: false },
    office: { confirmedOffice: false },
    backfillUpdateTime: { seconds: 1000, nanoseconds: 0 },
  });
  assert.deepEqual(setFalse.customer, { action: 'set', value: false });
  assert.equal(setFalse.office, undefined, 'confirmedOffice:falseのentryはoffice側の指示を返さない');
});

test('computeRollbackInstructions: resetNeedsManualCustomerSelection:trueなら、顧客確定と一緒にneedsManualCustomerSelection:trueへ戻す指示を返す(codexレビュー指摘)', () => {
  const result = computeRollbackInstructions({
    docId: 'doc-3',
    customer: { confirmedCustomer: true, customerConfirmedBefore: undefined, resetNeedsManualCustomerSelection: true },
    office: { confirmedOffice: false },
    backfillUpdateTime: { seconds: 1000, nanoseconds: 0 },
  });
  assert.deepEqual(result.needsManualCustomerSelection, { action: 'set', value: true });
});

test('computeRollbackInstructions: 顧客側が対象外(confirmedCustomer:false)ならneedsManualCustomerSelectionの指示も返さない', () => {
  const result = computeRollbackInstructions({
    docId: 'doc-4',
    customer: { confirmedCustomer: false },
    office: { confirmedOffice: true, officeConfirmedBefore: false },
    backfillUpdateTime: { seconds: 1000, nanoseconds: 0 },
  });
  assert.equal(result.customer, undefined);
  assert.equal(result.needsManualCustomerSelection, undefined);
});

test('isValidManifestEntry: 正常なentry(顧客/事業所とも確定・非確定の組み合わせ)はtrue', () => {
  assert.equal(
    isValidManifestEntry({
      docId: 'doc-1',
      customer: { confirmedCustomer: true, customerConfirmedBefore: false, resetNeedsManualCustomerSelection: true },
      office: { confirmedOffice: false },
      backfillUpdateTime: { seconds: 1, nanoseconds: 0 },
    }),
    true
  );
  assert.equal(
    isValidManifestEntry({
      docId: 'doc-2',
      customer: { confirmedCustomer: false },
      office: { confirmedOffice: true, officeConfirmedBefore: undefined },
      backfillUpdateTime: { seconds: 1, nanoseconds: 0 },
    }),
    true
  );
});

test('isValidManifestEntry: 必須フィールド欠如・型不一致・不正な判別子はfalse', () => {
  assert.equal(isValidManifestEntry(null), false, 'null');
  assert.equal(isValidManifestEntry('not-an-object'), false, '非オブジェクト');
  assert.equal(
    isValidManifestEntry({
      customer: { confirmedCustomer: false },
      office: { confirmedOffice: false },
      backfillUpdateTime: { seconds: 1, nanoseconds: 0 },
    }),
    false,
    'docId欠如'
  );
  assert.equal(
    isValidManifestEntry({
      docId: 'doc-3',
      customer: { confirmedCustomer: true, customerConfirmedBefore: 'not-a-boolean', resetNeedsManualCustomerSelection: false },
      office: { confirmedOffice: false },
      backfillUpdateTime: { seconds: 1, nanoseconds: 0 },
    }),
    false,
    'customerConfirmedBeforeの型不一致'
  );
  assert.equal(
    isValidManifestEntry({
      docId: 'doc-4',
      customer: { confirmedCustomer: true }, // resetNeedsManualCustomerSelection欠如
      office: { confirmedOffice: false },
      backfillUpdateTime: { seconds: 1, nanoseconds: 0 },
    }),
    false,
    'confirmedCustomer:trueなのにresetNeedsManualCustomerSelection欠如'
  );
  assert.equal(
    isValidManifestEntry({
      docId: 'doc-5',
      customer: { confirmedCustomer: false },
      office: { confirmedOffice: false },
      backfillUpdateTime: { seconds: '1', nanoseconds: 0 },
    }),
    false,
    'backfillUpdateTime.secondsの型不一致'
  );
});

test('isValidManifest: entries中に1件でも不正なものがあればfalse(部分的に壊れたJSONの検知)', () => {
  const validEntry = {
    docId: 'doc-1',
    customer: { confirmedCustomer: false },
    office: { confirmedOffice: false },
    backfillUpdateTime: { seconds: 1, nanoseconds: 0 },
  };
  assert.equal(
    isValidManifest({ runId: 'r1', projectId: 'p1', timestamp: '2026-09-25T00:00:00.000Z', entries: [validEntry] }),
    true
  );
  assert.equal(
    isValidManifest({ runId: 'r1', projectId: 'p1', timestamp: '2026-09-25T00:00:00.000Z', entries: [validEntry, { docId: 'doc-2' }] }),
    false,
    '2件目が不正entryなら全体をfalseにする(手編集・部分破損JSONの検知)'
  );
  assert.equal(isValidManifest({ runId: 'r1', projectId: 'p1', timestamp: '2026-09-25T00:00:00.000Z' }), false, 'entriesが配列でない');
});
