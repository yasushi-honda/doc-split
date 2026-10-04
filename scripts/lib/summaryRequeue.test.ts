import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_REQUEUE_IDS,
  parseRequeueDocIds,
  evaluateRequeueEligibility,
  buildRequeuePlan,
  buildStateBackup,
  evaluateRequeueGate,
  resolveAllowlist,
  formatStateBackupLine,
  isSameStateSnapshot,
  buildRequeueUpdate,
  planRequeueWrite,
} from './summaryRequeue';

test('parseRequeueDocIds: 1〜10件のカンマ区切りを受け付け、前後空白を除去する', () => {
  assert.deepEqual(parseRequeueDocIds('a1'), ['a1']);
  assert.deepEqual(parseRequeueDocIds(' a1 , b-2,c_3 '), ['a1', 'b-2', 'c_3']);
  const ten = Array.from({ length: MAX_REQUEUE_IDS }, (_, i) => `d${i}`).join(',');
  assert.equal(parseRequeueDocIds(ten).length, MAX_REQUEUE_IDS);
});

test('parseRequeueDocIds: 空・undefined・空白のみ・カンマのみは「空」エラー', () => {
  for (const bad of ['', undefined, '  ', ',']) {
    assert.throws(() => parseRequeueDocIds(bad as string | undefined), /空|空要素|不可/, JSON.stringify(bad));
  }
});

test('parseRequeueDocIds: 11件は件数エラー(重複を含む11件でも件数チェックが先に効く)', () => {
  const eleven = Array.from({ length: MAX_REQUEUE_IDS + 1 }, (_, i) => `d${i}`);
  assert.throws(() => parseRequeueDocIds(eleven.join(',')), /最大10件/);
  assert.throws(() => parseRequeueDocIds([...eleven.slice(0, 10), 'd0'].join(',')), /最大10件/);
});

test('parseRequeueDocIds: 重複(trim後・同一ID)は重複エラー、大文字小文字違いは別ID', () => {
  assert.throws(() => parseRequeueDocIds('a,a'), /重複/);
  assert.throws(() => parseRequeueDocIds('a, a'), /重複/);
  assert.deepEqual(parseRequeueDocIds('A,a'), ['A', 'a']);
});

test('parseRequeueDocIds: 不正文字・空要素・先頭ハイフン(オプション誤読防止)・改行・全角は不正文字エラー', () => {
  for (const bad of ['a/b', 'a,,b', 'a,', '--execute', '-x', 'a\nb', 'ａ', 'a b']) {
    assert.throws(() => parseRequeueDocIds(bad), /英数字|空要素/, JSON.stringify(bad));
  }
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

test('evaluateRequeueEligibility: summaryStateが明示null・undefined・非文字列でも対象(fromState=null)', () => {
  for (const summaryState of [null, undefined, 123, {}]) {
    assert.deepEqual(evaluateRequeueEligibility({ status: 'processed', summaryState }), {
      eligible: true,
      fromState: null,
    });
  }
});

test('evaluateRequeueEligibility: 未処理と要約処理中が重なる場合は未処理(not-processed)を優先する', () => {
  assert.deepEqual(evaluateRequeueEligibility({ status: 'pending', summaryState: 'processing' }), {
    eligible: false,
    reason: 'not-processed',
  });
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

test('buildRequeuePlan: 更新内容は要約キュー用の値・時刻・削除の3区分で固定', () => {
  const plan = buildRequeuePlan();
  assert.deepEqual(plan.set, { summaryState: 'pending', summaryAttemptCount: 0 });
  // PR-C: 手動依頼の印(summaryManualRequestedAt)も付ける。印がないpendingは、自動生成が無効の間は
  // バッチが実行せず「作成待ち」のまま残るため。
  assert.deepEqual([...plan.serverTimestamps].sort(), ['summaryManualRequestedAt', 'summaryStateUpdatedAt', 'updatedAt']);
  assert.deepEqual([...plan.deleteFields].sort(), ['summaryError', 'summaryErrorKind', 'summaryRunId']);
});

test('buildRequeueUpdate: 書込みキーは宣言した8つだけで、サーバー時刻と削除は番兵に置換される(対象外フィールド不変の担保)', () => {
  const TS = Symbol('serverTimestamp');
  const DEL = Symbol('delete');
  const update = buildRequeueUpdate(buildRequeuePlan(), { serverTimestamp: TS, deleteField: DEL });
  assert.deepEqual(Object.keys(update).sort(), [
    'summaryAttemptCount',
    'summaryError',
    'summaryErrorKind',
    'summaryManualRequestedAt',
    'summaryRunId',
    'summaryState',
    'summaryStateUpdatedAt',
    'updatedAt',
  ]);
  assert.equal(update.summaryState, 'pending');
  assert.equal(update.summaryAttemptCount, 0);
  assert.equal(update.updatedAt, TS);
  assert.equal(update.summaryStateUpdatedAt, TS);
  assert.equal(update.summaryManualRequestedAt, TS);
  for (const f of ['summaryError', 'summaryErrorKind', 'summaryRunId']) assert.equal(update[f], DEL);
});

test('buildRequeueUpdate: 要約本文・OCR・確定項目のキーを一切含まない', () => {
  const update = buildRequeueUpdate(buildRequeuePlan(), { serverTimestamp: 1, deleteField: 2 });
  for (const forbidden of ['summary', 'status', 'ocrResult', 'ocrRunId', 'customerId', 'officeId', 'summaryProvider']) {
    assert.equal(forbidden in update, false, forbidden);
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

test('evaluateRequeueGate: 許可リスト未設定(null=全文書対象)は拒否し、先に絞る手順を示す', () => {
  const r = evaluateRequeueGate({ l1Provider: 'sarashina', flag: true, allowlist: null }, ['a']);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /set-sarashina-summary-allowlist --set/);
});

test('evaluateRequeueGate: L1がsarashinaでなければ拒否し、理由に実値(未設定含む)を出す', () => {
  for (const l1Provider of ['none', 'gemini']) {
    const r = evaluateRequeueGate({ l1Provider, flag: true, allowlist: null }, ['a']);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, new RegExp(`SUMMARY_PROVIDER.*${l1Provider}`));
  }
  const unset = evaluateRequeueGate({ l1Provider: undefined, flag: true, allowlist: null }, ['a']);
  assert.equal(unset.ok, false);
  if (!unset.ok) assert.match(unset.reason, /未設定/);
});

test('evaluateRequeueGate: L2フラグが明示trueでなければ拒否する(false/未設定/文字列/数値)', () => {
  for (const flag of [false, undefined, 'true', 1]) {
    const r = evaluateRequeueGate({ l1Provider: 'sarashina', flag, allowlist: null }, ['a']);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /sarashinaSummary/);
  }
});

test('evaluateRequeueGate: 許可リスト外のIDは全て理由に列挙して拒否する', () => {
  const r = evaluateRequeueGate({ l1Provider: 'sarashina', flag: true, allowlist: ['a'] }, ['a', 'y', 'z']);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /y,z/);
});

test('evaluateRequeueGate: 空配列の許可リストは全拒否(未設定nullとは別物)', () => {
  assert.equal(evaluateRequeueGate({ l1Provider: 'sarashina', flag: true, allowlist: [] }, ['a']).ok, false);
});

test('resolveAllowlist: フィールド不在(または文書なし)は未設定=null(全許可)', () => {
  assert.equal(resolveAllowlist(undefined), null);
  assert.equal(resolveAllowlist({}), null);
  assert.equal(resolveAllowlist({ sarashinaSummary: true }), null);
});

test('resolveAllowlist: 正常な文字列配列はそのまま返す(空配列は全拒否として保持)', () => {
  assert.deepEqual(resolveAllowlist({ sarashinaSummaryAllowlist: ['a', 'b'] }), ['a', 'b']);
  assert.deepEqual(resolveAllowlist({ sarashinaSummaryAllowlist: [] }), []);
});

test('resolveAllowlist: 配列以外・非文字列要素を含む不正値は全拒否[]に倒す(本番のgetSarashinaSummaryGateと同じfail-closed)', () => {
  for (const bad of ['a,b', 'a', 1, true, null, { 0: 'a' }, ['a', 1], ['a', null], [['a']]]) {
    assert.deepEqual(resolveAllowlist({ sarashinaSummaryAllowlist: bad }), [], `不正値: ${JSON.stringify(bad)}`);
  }
});

function parseLine(line: string): Record<string, string> {
  return Object.fromEntries(
    line.split(' ').map((kv: string) => {
      const i = kv.indexOf('=');
      return [kv.slice(0, i), decodeURIComponent(kv.slice(i + 1))];
    })
  );
}

test('formatStateBackupLine: ログのマスキング対象の波括弧を含まず、値を復元できる', () => {
  const backup = buildStateBackup('doc1', {
    summaryState: 'error',
    summaryAttemptCount: 3,
    summaryProvider: 'sarashina',
    summaryError: 'timeout {code: 504} after 600s',
    summaryErrorKind: 'timeout',
    summaryRunId: 'run-1',
  });
  const line = formatStateBackupLine(backup);
  assert.equal(/[{}]/.test(line), false);
  assert.equal(line.includes('\n'), false);
  const parsed = parseLine(line);
  assert.equal(parsed.docId, 'doc1');
  assert.equal(parsed.summaryError, 'timeout {code: 504} after 600s');
  assert.equal(parsed.summaryAttemptCount, '3');
});

test('formatStateBackupLine: 未設定(null)は空値で出力する(旧形式文書)', () => {
  const line = formatStateBackupLine(buildStateBackup('doc2', { status: 'processed' }));
  const parsed = parseLine(line);
  for (const k of ['summaryState', 'summaryAttemptCount', 'summaryProvider', 'summaryError', 'summaryErrorKind', 'summaryRunId']) {
    assert.equal(parsed[k], '', k);
  }
});

test('isSameStateSnapshot: 状態フィールドが全て同じなら一致(要約本文など対象外フィールドの差は無視する)', () => {
  const a = buildStateBackup('d', { summaryState: 'done', summaryAttemptCount: 1, summaryProvider: 'gemini', summary: { text: 'A' } });
  const b = buildStateBackup('d', { summaryState: 'done', summaryAttemptCount: 1, summaryProvider: 'gemini', summary: { text: 'B' } });
  assert.equal(isSameStateSnapshot(a, b), true);
});

test('isSameStateSnapshot: 手動再生成などで状態が変わっていれば不一致(巻き戻し記録とのずれを検知する)', () => {
  const before = buildStateBackup('d', { summaryState: 'error', summaryAttemptCount: 3, summaryError: 'x' });
  for (const changed of [
    { summaryState: 'done', summaryAttemptCount: 3, summaryError: 'x' },
    { summaryState: 'error', summaryAttemptCount: 4, summaryError: 'x' },
    { summaryState: 'error', summaryAttemptCount: 3 },
    { summaryState: 'error', summaryAttemptCount: 3, summaryError: 'x', summaryRunId: 'r2' },
  ]) {
    assert.equal(isSameStateSnapshot(before, buildStateBackup('d', changed)), false, JSON.stringify(changed));
  }
});

test('isSameStateSnapshot: docIdが違えば不一致', () => {
  assert.equal(isSameStateSnapshot(buildStateBackup('a', {}), buildStateBackup('b', {})), false);
});

test('formatStateBackupLine: 長い値は200文字で切り詰める(ログ肥大の防止)', () => {
  const line = formatStateBackupLine(buildStateBackup('d', { summaryError: 'x'.repeat(500) }));
  assert.equal(parseLine(line).summaryError.length, 200);
});

test('isSameStateSnapshot: 空文字と未設定は別物として扱う', () => {
  const empty = buildStateBackup('d', { summaryError: '' });
  const missing = buildStateBackup('d', {});
  assert.equal(isSameStateSnapshot(empty, missing), false);
});

test('planRequeueWrite: 全件が適格で状態も一致すれば阻害なし', () => {
  const datas = [{ status: 'processed', summaryState: 'done' }, { status: 'processed' }];
  const expected = datas.map((d, i) => buildStateBackup(`d${i}`, d));
  assert.deepEqual(planRequeueWrite(['d0', 'd1'], datas, expected), { blocked: [] });
});

test('planRequeueWrite: 1件が要約処理中になっていればその1件だけを理由付きで阻害に挙げる', () => {
  const datas = [{ status: 'processed', summaryState: 'done' }, { status: 'processed', summaryState: 'processing' }];
  const expected = [buildStateBackup('d0', datas[0]), buildStateBackup('d1', { status: 'processed', summaryState: 'done' })];
  assert.deepEqual(planRequeueWrite(['d0', 'd1'], datas, expected), { blocked: ['d1: summary-in-flight'] });
});

test('planRequeueWrite: 削除された文書はnot-found、未処理はnot-processed', () => {
  assert.deepEqual(planRequeueWrite(['d0', 'd1'], [undefined, { status: 'pending' }]), {
    blocked: ['d0: not-found', 'd1: not-processed'],
  });
});

test('planRequeueWrite: 適格でもプレビュー時から状態が変わっていれば state-changed-since-preview', () => {
  const before = buildStateBackup('d0', { status: 'processed', summaryState: 'error', summaryAttemptCount: 3 });
  const nowData = { status: 'processed', summaryState: 'done', summaryAttemptCount: 3 };
  assert.deepEqual(planRequeueWrite(['d0'], [nowData], [before]), { blocked: ['d0: state-changed-since-preview'] });
});

test('planRequeueWrite: 適格性の判定が状態一致の判定より先(処理中はstate-changedではなくsummary-in-flight)', () => {
  const before = buildStateBackup('d0', { status: 'processed', summaryState: 'done' });
  const r = planRequeueWrite(['d0'], [{ status: 'processed', summaryState: 'processing' }], [before]);
  assert.deepEqual(r, { blocked: ['d0: summary-in-flight'] });
});

test('planRequeueWrite: expected省略時は適格性だけを見る(プレビュー段階)', () => {
  assert.deepEqual(planRequeueWrite(['d0'], [{ status: 'processed', summaryState: 'done' }]), { blocked: [] });
});

test('planRequeueWrite: ids・fresh・expectedの長さが違えば例外(取り違え防止)', () => {
  assert.throws(() => planRequeueWrite(['d0', 'd1'], [{ status: 'processed' }]));
  assert.throws(() => planRequeueWrite(['d0'], [{ status: 'processed' }], []));
});
