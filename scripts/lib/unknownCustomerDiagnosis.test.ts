import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bucketDocumentType,
  bucketStatus,
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

test('summarizeDiagnosis: 画面の「不明利用者・未判定・選択待ち」に当たる組み合わせ(processed・未判定・確認なし・未確認)を別に数える', () => {
  const since = Date.parse('2026-11-01T00:00:00+09:00');
  const s = summarizeDiagnosis(
    [
      doc(), // 画面の条件に一致
      doc({ verified: true }), // 確認済み: 除く
      doc({ customerConfirmed: true }), // 顧客確定済み: 除く
      doc({ status: 'pending' }), // processedでない: 一致しない
      doc({ docTypeBucket: 'empty' }), // 書類種別が空: 画面では「未判定」と出る可能性がある別集団
    ],
    since,
  );
  assert.equal(s.screenPatternStrict, 1);
  assert.equal(s.screenPatternDocTypeEmpty, 1);
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
  assert.equal(s.screenPatternStrict, 0);
  assert.deepEqual(s.byStatus, {});
});
