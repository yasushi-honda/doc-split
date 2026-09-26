import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isConfirmOnVerifyCandidate,
  isValidConfirmedFieldValue,
  tallyConfirmOnVerifyDecisions,
  tallyDriveExportStatus,
  formatCountRecord,
  buildConfirmOnVerifyManifest,
  isRollbackEligibleByUpdateTime,
  computeRollbackInstructions,
  isValidManifestEntry,
  isValidManifest,
  isValidManifestCustomerOutcome,
  isValidManifestOfficeOutcome,
  isValidFieldTypeAnomaly,
  CONFIRM_ON_VERIFY_MANIFEST_SCHEMA_VERSION,
} from './confirmOnVerifyBackfillHelpers';

test('isConfirmOnVerifyCandidate: customerConfirmed/officeConfirmedのどちらかがtrueでなければ対象', () => {
  assert.equal(isConfirmOnVerifyCandidate({}), true);
  assert.equal(isConfirmOnVerifyCandidate({ customerConfirmed: false, officeConfirmed: false }), true);
  assert.equal(isConfirmOnVerifyCandidate({ customerConfirmed: true, officeConfirmed: false }), true);
  assert.equal(isConfirmOnVerifyCandidate({ customerConfirmed: true, officeConfirmed: true }), false);
});

test('isValidConfirmedFieldValue: フィールド不在(undefined)またはboolean以外はfalse(pr-review-toolkit指摘: nullや文字列等の型異常データがmanifestへ無検証で書き込まれ、rollback全体を巻き込むfalse negativeを防ぐ)', () => {
  assert.equal(isValidConfirmedFieldValue(undefined), true);
  assert.equal(isValidConfirmedFieldValue(true), true);
  assert.equal(isValidConfirmedFieldValue(false), true);
  assert.equal(isValidConfirmedFieldValue(null), false);
  assert.equal(isValidConfirmedFieldValue('true'), false);
  assert.equal(isValidConfirmedFieldValue(1), false);
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

test('formatCountRecord: key=value形式に整形する(Issue #1059 M3、GitHub Actionsログsecret maskingで`{`が読めなくなる対策)', () => {
  assert.equal(formatCountRecord({}), '(なし)');
  assert.equal(formatCountRecord({ 'same-name-collision': 2, 'already-confirmed': 1 }), 'same-name-collision=2, already-confirmed=1');
});

test('buildConfirmOnVerifyManifest: 渡したentries・totalScanned・scanIncompleteをそのまま保持し、schemaVersionを付与する(Issue #1059 L1/L4)', () => {
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
    totalScanned: 42,
    scanIncomplete: true,
  });
  assert.equal(manifest.runId, 'run-1');
  assert.equal(manifest.entries.length, 1);
  assert.equal(manifest.entries[0].docId, 'doc-1');
  assert.equal(manifest.schemaVersion, CONFIRM_ON_VERIFY_MANIFEST_SCHEMA_VERSION);
  assert.equal(manifest.totalScanned, 42);
  assert.equal(manifest.scanIncomplete, true);
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
  assert.equal(
    isValidManifestEntry({
      docId: 'doc-6/../other-collection/doc-7',
      customer: { confirmedCustomer: false },
      office: { confirmedOffice: false },
      backfillUpdateTime: { seconds: 1, nanoseconds: 0 },
    }),
    false,
    'docIdに"/"を含む場合(手編集による別パス誤参照防止、pr-review-toolkit指摘)'
  );
  assert.equal(
    isValidManifestEntry({
      docId: 'doc-7',
      customer: { confirmedCustomer: false, customerConfirmedBefore: true }, // falseなのに余分なプロパティ混入
      office: { confirmedOffice: false },
      backfillUpdateTime: { seconds: 1, nanoseconds: 0 },
    }),
    false,
    'confirmedCustomer:falseなのに余分なプロパティが混入(discriminated unionが禁止する状態、type-design-analyzer指摘)'
  );
  assert.equal(
    isValidManifestEntry({
      docId: 'doc-8',
      customer: { confirmedCustomer: false },
      office: { confirmedOffice: false, officeConfirmedBefore: true }, // falseなのに余分なプロパティ混入
      backfillUpdateTime: { seconds: 1, nanoseconds: 0 },
    }),
    false,
    'confirmedOffice:falseなのに余分なプロパティが混入(type-design-analyzer指摘)'
  );
});

test('isValidFieldTypeAnomaly: docId・fileName・fields(1件以上、既知の判別子のみ)を要求する', () => {
  assert.equal(isValidFieldTypeAnomaly({ docId: 'doc-1', fileName: 'a.pdf', fields: ['customerConfirmed'] }), true);
  assert.equal(isValidFieldTypeAnomaly({ docId: 'doc-1', fileName: 'a.pdf', fields: [] }), false, 'fields空配列は不正');
  assert.equal(
    isValidFieldTypeAnomaly({ docId: 'doc-1', fileName: 'a.pdf', fields: ['unknownField'] }),
    false,
    '未知の判別子は不正'
  );
  assert.equal(isValidFieldTypeAnomaly({ docId: 'doc-1/x', fileName: 'a.pdf', fields: ['officeConfirmed'] }), false, 'docIdの"/"混入');
});

test('isValidFieldTypeAnomaly: fieldsに重複があればfalse(L3、Issue #1059: 判別子として意味を成さない冗長データ)', () => {
  assert.equal(
    isValidFieldTypeAnomaly({ docId: 'doc-1', fileName: 'a.pdf', fields: ['customerConfirmed', 'customerConfirmed'] }),
    false
  );
});

test('isValidManifestCustomerOutcome/isValidManifestOfficeOutcome: confirmed:trueでも未知の余分なキーがあればfalse(L3、Issue #1059: false分岐との非対称解消)', () => {
  assert.equal(
    isValidManifestCustomerOutcome({
      confirmedCustomer: true,
      customerConfirmedBefore: false,
      resetNeedsManualCustomerSelection: false,
      unknownExtraKey: 'x',
    }),
    false
  );
  assert.equal(
    isValidManifestCustomerOutcome({ confirmedCustomer: true, resetNeedsManualCustomerSelection: false }),
    true,
    'customerConfirmedBeforeはJSON round-trip後にキー自体が消えうるため欠如は許容する'
  );
  assert.equal(
    isValidManifestOfficeOutcome({ confirmedOffice: true, officeConfirmedBefore: false, unknownExtraKey: 'x' }),
    false
  );
  assert.equal(isValidManifestOfficeOutcome({ confirmedOffice: true }), true, 'officeConfirmedBefore欠如は許容する');
});

test('isValidManifest: buildConfirmOnVerifyManifestで生成した正常なmanifestはJSON往復後もtrueになる(生成側/検証側のずれを検知する回帰テスト、pr-review-toolkit指摘)', () => {
  const manifest = buildConfirmOnVerifyManifest({
    runId: 'run-1',
    projectId: 'proj-1',
    timestampIso: '2026-09-25T00:00:00.000Z',
    entries: [
      {
        docId: 'doc-1',
        customer: { confirmedCustomer: true, customerConfirmedBefore: undefined, resetNeedsManualCustomerSelection: true },
        office: { confirmedOffice: true, officeConfirmedBefore: false },
        backfillUpdateTime: { seconds: 1_700_000_000, nanoseconds: 123 },
      },
    ],
    totalScanned: 10,
    scanIncomplete: false,
  });
  const roundTripped: unknown = JSON.parse(JSON.stringify(manifest));
  assert.equal(isValidManifest(roundTripped), true);
});

test('isValidManifest: entries中に1件でも不正なものがあればfalse(部分的に壊れたJSONの検知)', () => {
  const validEntry = {
    docId: 'doc-1',
    customer: { confirmedCustomer: false },
    office: { confirmedOffice: false },
    backfillUpdateTime: { seconds: 1, nanoseconds: 0 },
  };
  const base = {
    schemaVersion: CONFIRM_ON_VERIFY_MANIFEST_SCHEMA_VERSION,
    runId: 'r1',
    projectId: 'p1',
    timestamp: '2026-09-25T00:00:00.000Z',
    totalScanned: 5,
    scanIncomplete: false,
  };
  assert.equal(isValidManifest({ ...base, entries: [validEntry], fieldTypeAnomalies: [] }), true);
  assert.equal(
    isValidManifest({ ...base, entries: [validEntry, { docId: 'doc-2' }], fieldTypeAnomalies: [] }),
    false,
    '2件目が不正entryなら全体をfalseにする(手編集・部分破損JSONの検知)'
  );
  assert.equal(isValidManifest({ ...base, entries: [], fieldTypeAnomalies: [] }), true);
  assert.equal(isValidManifest({ ...base, entries: [] }), false, 'fieldTypeAnomaliesが配列でない(欠如)');
  assert.equal(
    isValidManifest({
      ...base,
      entries: [],
      fieldTypeAnomalies: [{ docId: 'doc-3', fileName: 'a.pdf', fields: ['customerConfirmed', 'officeConfirmed'] }],
    }),
    true,
    '正常なfieldTypeAnomaliesはtrue'
  );
  assert.equal(
    isValidManifest({ ...base, entries: [], fieldTypeAnomalies: [{ docId: 'doc-4', fileName: 'a.pdf', fields: [] }] }),
    false,
    'fieldsが空配列は不正(判別子として意味を成さない)'
  );
  assert.equal(isValidManifest({ ...base, entries: undefined }), false, 'entriesが配列でない');
  assert.equal(
    isValidManifest({ ...base, schemaVersion: 999, entries: [], fieldTypeAnomalies: [] }),
    false,
    'schemaVersion不一致は不正(L4、Issue #1059)'
  );
  assert.equal(
    isValidManifest({ ...base, totalScanned: '5', entries: [], fieldTypeAnomalies: [] }),
    false,
    'totalScannedの型不一致は不正(L1、Issue #1059)'
  );
  assert.equal(
    isValidManifest({ ...base, scanIncomplete: 'false', entries: [], fieldTypeAnomalies: [] }),
    false,
    'scanIncompleteの型不一致は不正(L1、Issue #1059)'
  );
});
