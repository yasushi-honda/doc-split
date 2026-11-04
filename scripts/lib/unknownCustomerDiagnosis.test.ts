import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bucketDocumentType,
  bucketStatus,
  isCustomerSelectionWaiting,
  isSelectionWaiting,
  summarizeDiagnosis,
  type DiagnosisDocInput,
} from './unknownCustomerDiagnosis';

const D1 = Date.parse('2026-11-04T00:10:00Z'); // JST 2026-11-04 09:10
const D0 = Date.parse('2026-10-20T03:00:00Z'); // JST 2026-10-20

function doc(overrides: Partial<DiagnosisDocInput> = {}): DiagnosisDocInput {
  return {
    status: 'processed',
    docTypeBucket: 'undetermined',
    processedAtMs: D1,
    createdAtMs: D1,
    customerConfirmed: false,
    needsManualCustomerSelection: null,
    officeUnconfirmed: false,
    verified: false,
    isSplitChild: true,
    ...overrides,
  };
}

test('bucketDocumentType: 「未判定」・空/欠損・それ以外に分け、値そのものは出さない', () => {
  assert.equal(bucketDocumentType('未判定'), 'undetermined');
  assert.equal(bucketDocumentType(''), 'empty');
  assert.equal(bucketDocumentType('   '), 'empty');
  assert.equal(bucketDocumentType(null), 'empty');
  assert.equal(bucketDocumentType(undefined), 'empty');
  assert.equal(bucketDocumentType('居宅介護支援'), 'other');
  assert.equal(bucketDocumentType(123), 'other');
});

test('bucketStatus: 既知の状態のみ返し、それ以外は other(自由文字列を出さない)', () => {
  for (const s of ['pending', 'processing', 'processed', 'error', 'split']) assert.equal(bucketStatus(s), s);
  assert.equal(bucketStatus('田中太郎'), 'other');
  assert.equal(bucketStatus(undefined), 'missing');
  assert.equal(bucketStatus(''), 'missing');
});

test('summarizeDiagnosis: 窓(--since)の判定は処理日時を優先し、無ければ作成日時、両方無ければ日付なしとして含める', () => {
  const since = Date.parse('2026-11-01T00:00:00+09:00');
  const s = summarizeDiagnosis(
    [
      doc({ processedAtMs: D1, createdAtMs: D0 }), // 処理日時が窓内 → 含む
      doc({ processedAtMs: D0, createdAtMs: D1 }), // 処理日時が窓外 → 除外(処理日時優先)
      doc({ processedAtMs: null, createdAtMs: D1 }), // 作成日時で判定 → 含む
      doc({ processedAtMs: null, createdAtMs: null }), // 日付なし → 含む
    ],
    since,
  );
  assert.equal(s.inWindow, 3);
  assert.equal(s.noDate, 1);
  assert.equal(s.excludedByWindow, 1);
});

test('summarizeDiagnosis: 状態・書類種別・確認状態・分割の別に数える(条件の取りこぼし診断)', () => {
  const since = Date.parse('2026-11-01T00:00:00+09:00');
  const s = summarizeDiagnosis(
    [
      doc(),
      doc({ status: 'pending' }),
      doc({ docTypeBucket: 'empty' }),
      doc({ docTypeBucket: 'other' }),
      doc({ customerConfirmed: null }),
      doc({ customerConfirmed: true }),
      doc({ verified: true }),
      doc({ isSplitChild: false }),
    ],
    since,
  );
  assert.equal(s.inWindow, 8);
  assert.equal(s.byStatus['processed'], 7);
  assert.equal(s.byStatus['pending'], 1);
  assert.equal(s.byDocType['undetermined'], 6);
  assert.equal(s.byDocType['empty'], 1);
  assert.equal(s.byDocType['other'], 1);
  assert.equal(s.byCustomerConfirmed['false'], 6);
  assert.equal(s.byCustomerConfirmed['true'], 1);
  assert.equal(s.byCustomerConfirmed['missing'], 1);
  assert.equal(s.verified, 1);
  assert.equal(s.splitChildren, 7);
});

test('isCustomerSelectionWaiting: 画面のisCustomerConfirmedの反転と同じ(customerConfirmed優先、無ければneedsManualCustomerSelection、どちらも無ければ確定済み)', () => {
  assert.equal(isCustomerSelectionWaiting({ customerConfirmed: false, needsManualCustomerSelection: null }), true);
  assert.equal(isCustomerSelectionWaiting({ customerConfirmed: true, needsManualCustomerSelection: true }), false); // customerConfirmedが優先
  assert.equal(isCustomerSelectionWaiting({ customerConfirmed: null, needsManualCustomerSelection: true }), true);
  assert.equal(isCustomerSelectionWaiting({ customerConfirmed: null, needsManualCustomerSelection: false }), false);
  assert.equal(isCustomerSelectionWaiting({ customerConfirmed: null, needsManualCustomerSelection: null }), false); // 欠損は確定済み扱い(画面と同じ)
});

test('isSelectionWaiting: 顧客未確定、または事業所未確定(officeConfirmed=falseかつ候補あり)のどちらでも選択待ち(画面のneedsReviewと同じ。同姓同名はマスター照合が要るため含まない)', () => {
  assert.equal(isSelectionWaiting({ customerConfirmed: true, needsManualCustomerSelection: null, officeUnconfirmed: false }), false);
  assert.equal(isSelectionWaiting({ customerConfirmed: true, needsManualCustomerSelection: null, officeUnconfirmed: true }), true);
  assert.equal(isSelectionWaiting({ customerConfirmed: null, needsManualCustomerSelection: null, officeUnconfirmed: true }), true); // 顧客フラグ欠損でも事業所未確定なら選択待ち
  assert.equal(isSelectionWaiting({ customerConfirmed: false, needsManualCustomerSelection: null, officeUnconfirmed: false }), true);
});

test('summarizeDiagnosis: 画面の「選択待ち」は確認済み・状態に依存しない(確認済みでも選択待ちに数える)', () => {
  const since = Date.parse('2026-11-01T00:00:00+09:00');
  const s = summarizeDiagnosis(
    [
      doc(), // 選択待ち・未確認・processed・未判定
      doc({ verified: true }), // 確認済みでも、顧客未確定なら画面は選択待ち
      doc({ status: 'pending' }), // processedでなくても選択待ち
      doc({ customerConfirmed: true }), // 顧客確定済み: 選択待ちでない
      doc({ customerConfirmed: null, needsManualCustomerSelection: true }), // 画面はneedsManualで選択待ち
      doc({ customerConfirmed: null, needsManualCustomerSelection: null }), // 欠損: 画面は確定済み扱い
    ],
    since,
  );
  assert.equal(s.selectionWaiting, 4);
  assert.equal(s.waitingByVerified['true'], 1);
  assert.equal(s.waitingByVerified['false'], 3);
  assert.equal(s.waitingByStatus['processed'], 3);
  assert.equal(s.waitingByStatus['pending'], 1);
});

test('summarizeDiagnosis: 選択待ちかつ書類種別「未判定」(画面の画像に当たる集団)と、取りこぼしの内訳を数える', () => {
  const since = Date.parse('2026-11-01T00:00:00+09:00');
  const s = summarizeDiagnosis(
    [
      doc(), // 選択待ち×未判定×processed×未確認
      doc({ verified: true }), // 選択待ち×未判定×確認済み: 前回S0が除外していた
      doc({ status: 'pending' }), // 選択待ち×未判定×pending
      doc({ docTypeBucket: 'empty' }), // 選択待ち×書類種別が空欄
      doc({ docTypeBucket: 'other' }), // 選択待ちだが書類種別あり: 画像の集団ではない
      doc({ customerConfirmed: true }), // 選択待ちでない
      doc({ customerConfirmed: true, officeUnconfirmed: true }), // 事業所未確定で選択待ち×未判定
    ],
    since,
  );
  assert.equal(s.selectionWaitingUndetermined, 4);
  assert.equal(s.selectionWaitingDocTypeEmpty, 1);
  assert.equal(s.officeOnlySelectionWaiting, 1);
});

test('summarizeDiagnosis: 前回の集計(count-undetermined-documents)の条件を独立に数える(選択待ちに依存しない)', () => {
  const since = Date.parse('2026-11-01T00:00:00+09:00');
  const s = summarizeDiagnosis(
    [
      doc(), // processed・未判定・確認なし・処理日時あり: 数える
      doc({ customerConfirmed: null, needsManualCustomerSelection: null }), // 顧客フラグ欠損でも数える(前回の条件は選択待ちを見ない)
      doc({ customerConfirmed: true }), // 顧客確定済みでも数える(前回の条件は選択待ちを見ない)
      doc({ verified: true }), // 確認済み: 数えない
      doc({ status: 'pending' }), // processedでない: 数えない
      doc({ docTypeBucket: 'empty' }), // 未判定でない: 数えない
      doc({ processedAtMs: null, createdAtMs: D1 }), // 処理日時なし(前回はprocessedAtで絞るため対象外): 数えない
    ],
    since,
  );
  assert.equal(s.previousS0Candidates, 3);
});

test('summarizeDiagnosis: 処理日時と作成日時のJST日付が食い違う件数と、日別(処理日時・作成日時)の件数を出す', () => {
  const since = Date.parse('2026-10-01T00:00:00+09:00');
  const s = summarizeDiagnosis(
    [doc({ processedAtMs: D1, createdAtMs: D0 }), doc({ processedAtMs: D1, createdAtMs: D1 })],
    since,
  );
  assert.equal(s.processedCreatedDayMismatch, 1);
  assert.equal(s.byProcessedDay['2026-11-04'], 2);
  assert.equal(s.byCreatedDay['2026-10-20'], 1);
  assert.equal(s.byCreatedDay['2026-11-04'], 1);
});

test('summarizeDiagnosis: 出力のキーは日付・固定語彙のみで、自由文字列を含まない', () => {
  const since = Date.parse('2026-10-01T00:00:00+09:00');
  const s = summarizeDiagnosis([doc({ status: bucketStatus('田中太郎') }), doc({ docTypeBucket: bucketDocumentType('山田花子') })], since);
  const keys = [
    ...Object.keys(s.byStatus),
    ...Object.keys(s.byDocType),
    ...Object.keys(s.byCustomerConfirmed),
    ...Object.keys(s.waitingByStatus),
    ...Object.keys(s.waitingByVerified),
    ...Object.keys(s.waitingByDocType),
    ...Object.keys(s.byProcessedDay),
    ...Object.keys(s.byCreatedDay),
  ];
  for (const k of keys) {
    assert.match(k, /^(processed|pending|processing|error|split|other|missing|undetermined|empty|true|false|\d{4}-\d{2}-\d{2}|none)$/, `想定外のキー: ${k}`);
  }
  assert.ok(!JSON.stringify(s).includes('田中') && !JSON.stringify(s).includes('山田'));
});

test('summarizeDiagnosis: 空入力は全てゼロ', () => {
  const s = summarizeDiagnosis([], Date.parse('2026-11-01T00:00:00+09:00'));
  assert.equal(s.inWindow, 0);
  assert.equal(s.selectionWaiting, 0);
  assert.equal(s.selectionWaitingUndetermined, 0);
  assert.deepEqual(s.byStatus, {});
});
