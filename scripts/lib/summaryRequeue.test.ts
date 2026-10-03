import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_REQUEUE_IDS,
  parseRequeueDocIds,
  evaluateRequeueEligibility,
  buildRequeuePlan,
  buildStateBackup,
  evaluateRequeueGate,
} from './summaryRequeue';

test('parseRequeueDocIds: 1〜10件のカンマ区切りを受け付け、前後空白を除去する', () => {
  assert.deepEqual(parseRequeueDocIds('a1'), ['a1']);
  assert.deepEqual(parseRequeueDocIds(' a1 , b-2,c_3 '), ['a1', 'b-2', 'c_3']);
  const ten = Array.from({ length: MAX_REQUEUE_IDS }, (_, i) => `d${i}`).join(',');
  assert.equal(parseRequeueDocIds(ten).length, MAX_REQUEUE_IDS);
});

test('parseRequeueDocIds: 境界外・異常系は例外(空/undefined/11件/重複/不正文字/空要素)', () => {
  assert.throws(() => parseRequeueDocIds(''));
  assert.throws(() => parseRequeueDocIds(undefined));
  const eleven = Array.from({ length: MAX_REQUEUE_IDS + 1 }, (_, i) => `d${i}`).join(',');
  assert.throws(() => parseRequeueDocIds(eleven));
  assert.throws(() => parseRequeueDocIds('a,a'));
  assert.throws(() => parseRequeueDocIds('a/b'));
  assert.throws(() => parseRequeueDocIds('a,,b'));
});

test('evaluateRequeueEligibility: processedかつ要約が処理中でなければ対象(summaryState未設定の旧形式を含む)', () => {
  assert.deepEqual(evaluateRequeueEligibility({ status: 'processed' }), { eligible: true, fromState: null });
  for (const s of ['done', 'error', 'skipped', 'pending']) {
    assert.deepEqual(evaluateRequeueEligibility({ status: 'processed', summaryState: s }), {
      eligible: true,
      fromState: s,
    });
  }
});

test('evaluateRequeueEligibility: 存在しない/未処理/要約処理中は対象外', () => {
  assert.deepEqual(evaluateRequeueEligibility(undefined), { eligible: false, reason: 'not-found' });
  for (const status of ['pending', 'processing', 'error', undefined]) {
    assert.deepEqual(evaluateRequeueEligibility({ status }), { eligible: false, reason: 'not-processed' });
  }
  assert.deepEqual(evaluateRequeueEligibility({ status: 'processed', summaryState: 'processing' }), {
    eligible: false,
    reason: 'summary-in-flight',
  });
});

test('buildRequeuePlan: 触るのは要約キュー用フィールドだけで、summary本文・OCR・確定項目は含まない', () => {
  const plan = buildRequeuePlan();
  assert.deepEqual(plan.set, { summaryState: 'pending', summaryAttemptCount: 0 });
  assert.deepEqual([...plan.serverTimestamps].sort(), ['summaryStateUpdatedAt', 'updatedAt']);
  assert.deepEqual([...plan.deleteFields].sort(), ['summaryError', 'summaryErrorKind', 'summaryRunId']);
  const touched = new Set([...Object.keys(plan.set), ...plan.serverTimestamps, ...plan.deleteFields]);
  for (const forbidden of [
    'summary',
    'status',
    'ocrResult',
    'ocrRunId',
    'customerId',
    'officeId',
    'customerConfirmed',
    'officeConfirmed',
    'documentType',
    'displayFileName',
    'summaryProvider',
  ]) {
    assert.equal(touched.has(forbidden), false, `${forbidden} は更新対象に含めない`);
  }
});

test('buildStateBackup: 状態フィールドだけを保存し、要約本文(summary)は含めない', () => {
  const backup = buildStateBackup('doc1', {
    status: 'processed',
    summaryState: 'done',
    summaryAttemptCount: 2,
    summaryProvider: 'gemini',
    summaryError: 'x',
    summaryErrorKind: 'timeout',
    summaryRunId: 'r1',
    summary: { text: '個人情報を含む要約本文' },
    ocrResult: 'OCR本文',
  });
  assert.equal(backup.docId, 'doc1');
  assert.deepEqual(backup.state, {
    summaryState: 'done',
    summaryAttemptCount: 2,
    summaryProvider: 'gemini',
    summaryError: 'x',
    summaryErrorKind: 'timeout',
    summaryRunId: 'r1',
  });
  assert.equal(JSON.stringify(backup).includes('個人情報'), false);
  assert.equal(JSON.stringify(backup).includes('OCR本文'), false);
});

test('buildStateBackup: 未設定フィールドはnullで記録する(旧形式文書)', () => {
  const backup = buildStateBackup('doc2', { status: 'processed' });
  assert.deepEqual(backup.state, {
    summaryState: null,
    summaryAttemptCount: null,
    summaryProvider: null,
    summaryError: null,
    summaryErrorKind: null,
    summaryRunId: null,
  });
});

test('evaluateRequeueGate: L1=sarashina・L2フラグtrue・全IDが許可リスト内のときだけ通す', () => {
  assert.deepEqual(
    evaluateRequeueGate({ l1Provider: 'sarashina', flag: true, allowlist: ['a', 'b', 'c'] }, ['a', 'b']),
    { ok: true }
  );
});

test('evaluateRequeueGate: 許可リスト未設定(null)は全許可なので通す', () => {
  assert.deepEqual(evaluateRequeueGate({ l1Provider: 'sarashina', flag: true, allowlist: null }, ['a']), {
    ok: true,
  });
});

test('evaluateRequeueGate: L1が違う/L2フラグがtrueでない/許可リスト外IDがあれば拒否する', () => {
  for (const l1Provider of ['none', 'gemini', undefined, '']) {
    const r = evaluateRequeueGate({ l1Provider, flag: true, allowlist: null }, ['a']);
    assert.equal(r.ok, false);
  }
  for (const flag of [false, undefined, 'true', 1]) {
    const r = evaluateRequeueGate({ l1Provider: 'sarashina', flag, allowlist: null }, ['a']);
    assert.equal(r.ok, false);
  }
  const outside = evaluateRequeueGate({ l1Provider: 'sarashina', flag: true, allowlist: ['a'] }, ['a', 'z']);
  assert.equal(outside.ok, false);
  if (!outside.ok) assert.match(outside.reason, /z/);
  // 空配列の許可リストは全拒否(未設定nullとは別物)
  assert.equal(evaluateRequeueGate({ l1Provider: 'sarashina', flag: true, allowlist: [] }, ['a']).ok, false);
});
