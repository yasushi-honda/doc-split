import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  resolveServiceUrl,
  buildChatRequestBody,
  sendSummaryWithRetries,
  scoreRunRecord,
  checkRuntimeContract,
  runtimeContractOk,
  fetchProps,
  evaluateFabricationGate,
  evaluateRecombinationGate,
  evaluateCoverageAggregateGate,
  evaluateCoveragePerDocGate,
  evaluateNumericFabricationGate,
  evaluateAmountAbsenceGate,
  evaluateOutputSanityGate,
  evaluateDeterminismGate,
  buildReport,
  buildStepSummaryMarkdown,
  determineExitCode,
  parseArgs,
  extractContent,
  loadMetaByDoc,
  loadFullSourceText,
  sourceTextForScoring,
  buildPromptForDoc,
  loadMetaRaw,
  DEV_ENV_PATH,
  DOC_IDS,
  MAX_RETRIES,
  type SummaryRunRecord,
  type EvaluatedSummaryRunRecord,
  type SummarySendOutcome,
  type SummaryRequestFn,
  type SummaryAttemptResult,
  type RuntimeManifest,
} from './sarashinaSummaryVerify';
import { IdTokenProvider } from './cloudRunVerifyCommon';

const REAL_DEV_URL = 'https://sarashina-summary-whfgr6jwaa-an.a.run.app';

// ---------------------------------------------------------------------------
// resolveServiceUrl
// ---------------------------------------------------------------------------

test('resolveServiceUrl: 優先順位は--url > 環境変数 > dev.env', () => {
  const devEnvContent = 'SARASHINA_SUMMARY_URL="https://a.example.com"';
  assert.equal(
    resolveServiceUrl({ explicitUrl: 'https://a.example.com/', devEnvContent, devEnvPathForError: 'x' }),
    'https://a.example.com/'
  );
  assert.equal(
    resolveServiceUrl({ envVarUrl: 'https://a.example.com/foo', devEnvContent, devEnvPathForError: 'x' }),
    'https://a.example.com/foo'
  );
  assert.equal(resolveServiceUrl({ devEnvContent, devEnvPathForError: 'x' }), 'https://a.example.com');
});

test('resolveServiceUrl: ホストがdev.envと不一致なら即エラー', () => {
  const devEnvContent = 'SARASHINA_SUMMARY_URL="https://a.example.com"';
  assert.throws(() =>
    resolveServiceUrl({ explicitUrl: 'https://b.example.com', devEnvContent, devEnvPathForError: 'x' })
  );
});

test('resolveServiceUrl: 実際のscripts/clients/dev.envと整合する(回帰検知)', () => {
  const devEnvContent = fs.readFileSync(DEV_ENV_PATH, 'utf-8');
  const url = resolveServiceUrl({ devEnvContent, devEnvPathForError: DEV_ENV_PATH });
  assert.equal(url, REAL_DEV_URL);
});

// ---------------------------------------------------------------------------
// buildChatRequestBody / extractContent
// ---------------------------------------------------------------------------

test('buildChatRequestBody: 既定値はDEFAULT_MAX_TOKENS/DEFAULT_TEMPERATURE、cache_promptは常にfalse', () => {
  const body = buildChatRequestBody('プロンプト本文');
  assert.deepEqual(body.messages, [{ role: 'user', content: 'プロンプト本文' }]);
  assert.equal(body.cache_prompt, false);
  assert.equal(body.chat_template_kwargs.enable_thinking, false);
});

test('buildChatRequestBody: maxTokens/temperatureを上書きできる', () => {
  const body = buildChatRequestBody('x', { maxTokens: 64, temperature: 0 });
  assert.equal(body.max_tokens, 64);
  assert.equal(body.temperature, 0);
});

test('extractContent: choices[0].message.contentを取り出す', () => {
  const raw = JSON.stringify({ choices: [{ message: { content: '要約テキスト' } }] });
  assert.equal(extractContent(raw), '要約テキスト');
});

test('extractContent: contentが無ければ空文字を返す', () => {
  const raw = JSON.stringify({ choices: [{ message: {} }] });
  assert.equal(extractContent(raw), '');
});

// ---------------------------------------------------------------------------
// sendSummaryWithRetries
// ---------------------------------------------------------------------------

function fakeTokenProvider(): IdTokenProvider {
  return new IdTokenProvider('aud', async () => 'fake-token');
}

function makeFakeRequestFn(results: SummaryAttemptResult[]): SummaryRequestFn {
  let i = 0;
  return async () => results[Math.min(i++, results.length - 1)];
}

test('sendSummaryWithRetries: 200は即成功', async () => {
  const requestFn = makeFakeRequestFn([{ status: 200, body: '{"choices":[]}', wallMs: 10, kind: 'success' }]);
  const outcome = await sendSummaryWithRetries({
    requestBody: buildChatRequestBody('x'),
    serviceUrl: 'https://x',
    tokenProvider: fakeTokenProvider(),
    requestFn,
    backoffMs: 1,
  });
  assert.equal(outcome.result.kind, 'success');
  assert.equal(outcome.retriedCount, 0);
});

test('sendSummaryWithRetries: timeoutは即timedOut(リトライしない、二重推論防止)', async () => {
  const requestFn = makeFakeRequestFn([{ status: null, body: null, wallMs: 620000, kind: 'timeout' }]);
  const outcome = await sendSummaryWithRetries({
    requestBody: buildChatRequestBody('x'),
    serviceUrl: 'https://x',
    tokenProvider: fakeTokenProvider(),
    requestFn,
    backoffMs: 1,
  });
  assert.equal(outcome.result.kind, 'timedOut');
  if (outcome.result.kind === 'timedOut') {
    assert.equal(outcome.result.failureKind, 'clientTimeout');
  }
  assert.equal(outcome.retriedCount, 0);
});

test('sendSummaryWithRetries: 504は即timedOut(リトライしない)', async () => {
  const requestFn = makeFakeRequestFn([{ status: 504, body: 'gateway timeout', wallMs: 620000, kind: 'success' }]);
  const outcome = await sendSummaryWithRetries({
    requestBody: buildChatRequestBody('x'),
    serviceUrl: 'https://x',
    tokenProvider: fakeTokenProvider(),
    requestFn,
    backoffMs: 1,
  });
  assert.equal(outcome.result.kind, 'timedOut');
  if (outcome.result.kind === 'timedOut') {
    assert.equal(outcome.result.failureKind, 'serverTimeout504');
  }
});

test('sendSummaryWithRetries: 429はmaxRetriesまでリトライしてから成功できる', async () => {
  const requestFn = makeFakeRequestFn([
    { status: 429, body: 'rate limited', wallMs: 1, kind: 'success' },
    { status: 200, body: '{"choices":[]}', wallMs: 1, kind: 'success' },
  ]);
  const outcome = await sendSummaryWithRetries({
    requestBody: buildChatRequestBody('x'),
    serviceUrl: 'https://x',
    tokenProvider: fakeTokenProvider(),
    requestFn,
    backoffMs: 1,
    maxRetries: MAX_RETRIES,
  });
  assert.equal(outcome.result.kind, 'success');
  assert.equal(outcome.retriedCount, 1);
});

test('sendSummaryWithRetries: 429がmaxRetriesを超えるとfatal', async () => {
  const requestFn = makeFakeRequestFn([{ status: 429, body: 'rate limited', wallMs: 1, kind: 'success' }]);
  const outcome = await sendSummaryWithRetries({
    requestBody: buildChatRequestBody('x'),
    serviceUrl: 'https://x',
    tokenProvider: fakeTokenProvider(),
    requestFn,
    backoffMs: 1,
    maxRetries: 1,
  });
  assert.equal(outcome.result.kind, 'fatal');
});

test('sendSummaryWithRetries: 401は1回だけトークン再発行して再試行する', async () => {
  const requestFn = makeFakeRequestFn([
    { status: 401, body: 'unauthorized', wallMs: 1, kind: 'success' },
    { status: 200, body: '{"choices":[]}', wallMs: 1, kind: 'success' },
  ]);
  const outcome = await sendSummaryWithRetries({
    requestBody: buildChatRequestBody('x'),
    serviceUrl: 'https://x',
    tokenProvider: fakeTokenProvider(),
    requestFn,
    backoffMs: 1,
  });
  assert.equal(outcome.result.kind, 'success');
  assert.equal(outcome.authRetried, true);
});

test('sendSummaryWithRetries: networkErrorはmaxRetriesまでリトライしてから成功できる(pr-test-analyzer指摘: 未テストだった経路)', async () => {
  const requestFn = makeFakeRequestFn([
    { status: null, body: null, wallMs: 1, kind: 'networkError', errorDetail: 'FetchError: ECONNRESET' },
    { status: 200, body: '{"choices":[]}', wallMs: 1, kind: 'success' },
  ]);
  const outcome = await sendSummaryWithRetries({
    requestBody: buildChatRequestBody('x'),
    serviceUrl: 'https://x',
    tokenProvider: fakeTokenProvider(),
    requestFn,
    backoffMs: 1,
    maxRetries: MAX_RETRIES,
  });
  assert.equal(outcome.result.kind, 'success');
  assert.equal(outcome.retriedCount, 1);
});

test('sendSummaryWithRetries: networkErrorがmaxRetriesを超えるとtimedOut扱いになる(二重推論防止と同じ着地点)', async () => {
  const requestFn = makeFakeRequestFn([
    { status: null, body: null, wallMs: 1, kind: 'networkError', errorDetail: 'FetchError: ECONNRESET' },
  ]);
  const outcome = await sendSummaryWithRetries({
    requestBody: buildChatRequestBody('x'),
    serviceUrl: 'https://x',
    tokenProvider: fakeTokenProvider(),
    requestFn,
    backoffMs: 1,
    maxRetries: 1,
  });
  assert.equal(outcome.result.kind, 'timedOut');
  if (outcome.result.kind === 'timedOut') {
    assert.equal(outcome.result.failureKind, 'networkError');
    assert.equal(outcome.result.errorDetail, 'FetchError: ECONNRESET');
  }
  assert.equal(outcome.retriedCount, 1);
});

// ---------------------------------------------------------------------------
// scoreRunRecord (実fixtureで採点)
// ---------------------------------------------------------------------------

const metaByDoc = loadMetaByDoc();

function successOutcome(body: string): SummarySendOutcome {
  return { elapsedMs: 100, retriedCount: 0, authRetried: false, result: { kind: 'success', httpStatus: 200, body } };
}

function chatBody(content: string): string {
  return JSON.stringify({ choices: [{ message: { content } }] });
}

test('scoreRunRecord: D9(正直に「記載なし」と回答)はmustCover充足・捏造0件', () => {
  const fullText = loadFullSourceText('D9');
  const src = sourceTextForScoring(fullText);
  const text = '・書類の種類: 福祉用具貸与確認書\n・関係者: 利用者 三好 陽子様、事業所名（省略）\n・重要な日付: 貸与開始日 令和8年9月20日\n・金額: （省略）\n・特筆すべき状態・変化: なし</s>';
  const record = scoreRunRecord('D9', 1, src, metaByDoc.D9, successOutcome(chatBody(text)));
  assert.equal(record.kind, 'evaluated');
  if (record.kind !== 'evaluated') throw new Error('unreachable');
  assert.equal(record.coverage.mustCoverSatisfied, true);
  assert.equal(record.fabrication.fabricatedCount, 0);
  assert.equal(record.numeric.passed, true);
});

test('scoreRunRecord: 原典に無い組織名を出力すると固有名詞捏造としてfabricatedCount>0になる', () => {
  const fullText = loadFullSourceText('D9');
  const src = sourceTextForScoring(fullText);
  const text = '・関係者: 利用者 三好 陽子様、介護サポート株式会社</s>';
  const record = scoreRunRecord('D9', 1, src, metaByDoc.D9, successOutcome(chatBody(text)));
  assert.equal(record.kind, 'evaluated');
  if (record.kind !== 'evaluated') throw new Error('unreachable');
  assert.ok(record.fabrication.fabricatedCount > 0);
});

test('scoreRunRecord: timedOutの場合はkind:timedOutのみで記録される(評価フィールドを持たない)', () => {
  const outcome: SummarySendOutcome = {
    elapsedMs: 620000,
    retriedCount: 0,
    authRetried: false,
    result: { kind: 'timedOut', failureKind: 'clientTimeout', httpStatus: null },
  };
  const record = scoreRunRecord('D9', 1, 'src', metaByDoc.D9, outcome);
  assert.equal(record.kind, 'timedOut');
  assert.ok(!('rawText' in record));
  assert.ok(!('coverage' in record));
});

test('scoreRunRecord: content空文字(スキーマ不一致・生成失敗)はfatal扱いになる(silent-failure-hunter指摘、Critical)', () => {
  const fullText = loadFullSourceText('D10');
  const src = sourceTextForScoring(fullText);
  const record = scoreRunRecord('D10', 1, src, metaByDoc.D10, successOutcome(chatBody('')));
  assert.equal(record.kind, 'fatal');
  if (record.kind !== 'fatal') throw new Error('unreachable');
  assert.match(record.fatalReason, /空/);
});

test('scoreRunRecord: choices[0].message.content欠落(schemaミスマッチ)もfatal扱いになる', () => {
  const fullText = loadFullSourceText('D10');
  const src = sourceTextForScoring(fullText);
  const record = scoreRunRecord('D10', 1, src, metaByDoc.D10, successOutcome(JSON.stringify({ choices: [{ message: {} }] })));
  assert.equal(record.kind, 'fatal');
});

// ---------------------------------------------------------------------------
// runtime-contract
// ---------------------------------------------------------------------------

const FAKE_MANIFEST: RuntimeManifest = {
  model: { baseImageBuildInfo: 'b11065-ce8caa6e6' },
  runtimeContract: { modelAlias: 'sarashina2.2-3b-instruct-v0.1-Q8_0', nCtx: 8192, totalSlots: 1 },
};

test('checkRuntimeContract: 全項目一致でPASS相当', () => {
  const check = checkRuntimeContract(
    {
      build_info: 'b11065-ce8caa6e6',
      model_alias: 'sarashina2.2-3b-instruct-v0.1-Q8_0',
      total_slots: 1,
      default_generation_settings: { n_ctx: 8192 },
    },
    FAKE_MANIFEST
  );
  assert.equal(runtimeContractOk(check), true);
});

test('checkRuntimeContract: build_infoが不一致ならFAIL相当', () => {
  const check = checkRuntimeContract(
    {
      build_info: 'b99999-deadbeef',
      model_alias: 'sarashina2.2-3b-instruct-v0.1-Q8_0',
      total_slots: 1,
      default_generation_settings: { n_ctx: 8192 },
    },
    FAKE_MANIFEST
  );
  assert.equal(runtimeContractOk(check), false);
  assert.equal(check.buildInfoOk, false);
});

test('fetchProps: 到達不能なURLへは短いtimeoutMsのままハングせず失敗する(codex review指摘: 無制限fetch防止)', async () => {
  await assert.rejects(() => fetchProps('http://127.0.0.1:1', 'fake-token', 300));
});

test('checkRuntimeContract: n_ctxが欠落(undefined)ならFAIL相当(NaN比較等でtrueにならない)', () => {
  const check = checkRuntimeContract(
    { build_info: 'b11065-ce8caa6e6', model_alias: 'sarashina2.2-3b-instruct-v0.1-Q8_0', total_slots: 1 },
    FAKE_MANIFEST
  );
  assert.equal(check.nCtxOk, false);
  assert.equal(runtimeContractOk(check), false);
});

// ---------------------------------------------------------------------------
// ゲート判定
// ---------------------------------------------------------------------------

function evaluatedRecord(overrides: Partial<EvaluatedSummaryRunRecord> & { docId: string; run: number }): EvaluatedSummaryRunRecord {
  const fullText = loadFullSourceText(overrides.docId);
  const src = sourceTextForScoring(fullText);
  const text = overrides.rawText ?? 'ダミー要約';
  const outcome = successOutcome(chatBody(text));
  const base = scoreRunRecord(overrides.docId, overrides.run, src, metaByDoc[overrides.docId], outcome);
  if (base.kind !== 'evaluated') throw new Error('evaluatedRecord: scoreRunRecordがevaluatedを返しませんでした');
  return { ...base, ...overrides };
}

test('evaluateFabricationGate: 全run捏造0件ならPASS', () => {
  const records = [evaluatedRecord({ docId: 'D9', run: 1 })];
  const entry = evaluateFabricationGate(records);
  assert.equal(entry.verdict, 'PASS');
});

test('evaluateFabricationGate: 1件でも捏造があればFAIL', () => {
  const records = [evaluatedRecord({ docId: 'D9', run: 1, rawText: '介護サポート株式会社が対応' })];
  const entry = evaluateFabricationGate(records);
  assert.equal(entry.verdict, 'FAIL');
});

test('evaluateFabricationGate: 評価対象0件はNOT_EVALUATED', () => {
  const records: SummaryRunRecord[] = [
    { docId: 'D9', run: 1, wallMs: 1, httpStatus: null, retriedCount: 0, kind: 'timedOut', failureKind: 'clientTimeout' },
  ];
  assert.equal(evaluateFabricationGate(records).verdict, 'NOT_EVALUATED');
});

test('evaluateRecombinationGate: 再結合検知はWARN(FAILにしない)', () => {
  // D3の「水無月訪問看護」は既知の再結合パターン(PR2a pr0-fabrication-expected.json参照、
  // 原典の括弧書き略記「訪問看護（水無月）」の言い換えであり捏造ではない)。
  // pr-test-analyzer指摘: 期待値を実行結果から動的算出するとトートロジーになり退行を
  // 検知できないため、固定値'WARN'で比較する。
  const fullText = loadFullSourceText('D3');
  const src = sourceTextForScoring(fullText);
  const text = '水無月訪問看護が対応しました。';
  const record = scoreRunRecord('D3', 1, src, metaByDoc.D3, successOutcome(chatBody(text)));
  assert.equal(record.kind, 'evaluated');
  if (record.kind !== 'evaluated') throw new Error('unreachable');
  assert.ok(record.fabrication.recombinedCount > 0, '前提: このテキストは再結合パターンとして検知されるはず');
  const entry = evaluateRecombinationGate([record]);
  assert.equal(entry.verdict, 'WARN');
});

test('evaluateCoveragePerDocGate: mustCover欠落があればFAIL', () => {
  const records = [evaluatedRecord({ docId: 'D9', run: 1, rawText: '無関係な文章です' })];
  const entry = evaluateCoveragePerDocGate(records);
  assert.equal(entry.verdict, 'FAIL');
});

test('evaluateCoverageAggregateGate: role=fabrication(D9/D10)は集計から除外される', () => {
  const records = [evaluatedRecord({ docId: 'D9', run: 1, rawText: '無関係' })];
  const { entry, aggregate } = evaluateCoverageAggregateGate(records, metaByDoc);
  assert.equal(aggregate?.factsTotal, 0);
  assert.equal(entry.verdict, 'NOT_EVALUATED');
});

test('evaluateCoverageAggregateGate: role=coverageのdocは集計に含まれる', () => {
  const fullText = loadFullSourceText('D5');
  const src = sourceTextForScoring(fullText);
  const text = '宮下 譲様、ひまわり訪問介護、9月22日に訪問しました。';
  const record = scoreRunRecord('D5', 1, src, metaByDoc.D5, successOutcome(chatBody(text)));
  const { aggregate } = evaluateCoverageAggregateGate([record], metaByDoc);
  assert.ok((aggregate?.factsTotal ?? 0) > 0);
});

test('evaluateNumericFabricationGate: 原典に無い数値はFAIL', () => {
  const fullText = loadFullSourceText('D6');
  const src = sourceTextForScoring(fullText);
  const text = '東雲 直人様、あさひ訪問介護ステーション、99999円、9月30日。';
  const record = scoreRunRecord('D6', 1, src, metaByDoc.D6, successOutcome(chatBody(text)));
  const entry = evaluateNumericFabricationGate([record]);
  assert.equal(entry.verdict, 'FAIL');
});

test('evaluateAmountAbsenceGate: must_not_contain_amount対象(D10)で金額が混入すればWARN', () => {
  const fullText = loadFullSourceText('D10');
  const src = sourceTextForScoring(fullText);
  const text = '本日の体調は落ち着いています。費用は1,000円でした。';
  const record = scoreRunRecord('D10', 1, src, metaByDoc.D10, successOutcome(chatBody(text)));
  const entry = evaluateAmountAbsenceGate([record]);
  assert.equal(entry.verdict, 'WARN');
});

test('evaluateAmountAbsenceGate: 対象docが無ければNOT_EVALUATED', () => {
  const record = evaluatedRecord({ docId: 'D9', run: 1 });
  const entry = evaluateAmountAbsenceGate([record]);
  assert.equal(entry.verdict, 'NOT_EVALUATED');
});

test('evaluateOutputSanityGate: </s>混入(全run既定)はWARN(thinking-leakもFAILにしない設計)', () => {
  const record = evaluatedRecord({ docId: 'D9', run: 1, rawText: 'テキスト</s>' });
  const entry = evaluateOutputSanityGate([record]);
  assert.equal(entry.verdict, 'WARN');
});

const D9_MUST_COVER_TEXT = '三好 陽子様、9月20日に対応しました。';

test('evaluateDeterminismGate: 同一docの複数runで判定が一致すればPASS', () => {
  const r1 = evaluatedRecord({ docId: 'D9', run: 1, rawText: D9_MUST_COVER_TEXT });
  const r2 = evaluatedRecord({ docId: 'D9', run: 2, rawText: D9_MUST_COVER_TEXT });
  const entry = evaluateDeterminismGate([r1, r2]);
  assert.equal(entry.verdict, 'PASS');
});

test('evaluateDeterminismGate: 同一docのrun間でmustCover充足が食い違えばFAIL', () => {
  const r1 = evaluatedRecord({ docId: 'D9', run: 1, rawText: D9_MUST_COVER_TEXT });
  const r2 = evaluatedRecord({ docId: 'D9', run: 2, rawText: '無関係な文章' });
  const entry = evaluateDeterminismGate([r1, r2]);
  assert.equal(entry.verdict, 'FAIL');
});

test('evaluateDeterminismGate: 1runしか無いdocのみの場合はNOT_EVALUATED', () => {
  const r1 = evaluatedRecord({ docId: 'D9', run: 1 });
  assert.equal(evaluateDeterminismGate([r1]).verdict, 'NOT_EVALUATED');
});

// ---------------------------------------------------------------------------
// buildReport / determineExitCode
// ---------------------------------------------------------------------------

function snap(revisionName: string, imageDigest: string | null) {
  return { revisionName, imageDigest };
}

test('buildReport: 開始/終了スナップショット不一致はinconclusive', () => {
  const records = [evaluatedRecord({ docId: 'D9', run: 1 })];
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: 't0',
    finishedAt: 't1',
    serviceSnapshotStart: snap('rev-1', 'img-1'),
    serviceSnapshotEnd: snap('rev-2', 'img-1'),
    runtimeContract: null,
    records,
    metaByDoc,
    expectedDocs: ['D9'],
    expectedRunsPerDoc: 1,
  });
  assert.equal(report.inconclusive, true);
});

test('buildReport: 終了時スナップショット取得失敗のエラー内容がinconclusiveReasonに残る(silent-failure-hunter指摘、High)', () => {
  const records = [evaluatedRecord({ docId: 'D9', run: 1 })];
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: 't0',
    finishedAt: 't1',
    serviceSnapshotStart: snap('rev-1', 'img-1'),
    serviceSnapshotEnd: null,
    serviceSnapshotEndError: 'gcloud呼び出し失敗: PERMISSION_DENIED',
    runtimeContract: null,
    records,
    metaByDoc,
    expectedDocs: ['D9'],
    expectedRunsPerDoc: 1,
  });
  assert.equal(report.inconclusive, true);
  assert.ok(report.inconclusiveReason?.includes('PERMISSION_DENIED'));
});

test('buildReport: /props取得失敗のエラー内容がruntime-contractゲートのdetailに残る(silent-failure-hunter指摘、High)', () => {
  const records = [evaluatedRecord({ docId: 'D9', run: 1 })];
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: 't0',
    finishedAt: 't1',
    serviceSnapshotStart: snap('rev-1', 'img-1'),
    serviceSnapshotEnd: snap('rev-1', 'img-1'),
    runtimeContract: null,
    runtimeContractError: 'FetchError: request to https://x/props timed out',
    records,
    metaByDoc,
    expectedDocs: ['D9'],
    expectedRunsPerDoc: 1,
  });
  const runtimeContractGate = report.gates.find((g) => g.id === 'runtime-contract');
  assert.equal(runtimeContractGate?.verdict, 'NOT_EVALUATED');
  assert.ok(runtimeContractGate?.detail.includes('timed out'));
  assert.equal(report.runtimeContractError, 'FetchError: request to https://x/props timed out');
});

test('buildReport: 全docで有効runがあればdocsWithoutSuccessfulRunは空・skippedRunsも空', () => {
  const records = DOC_IDS.map((docId) => evaluatedRecord({ docId, run: 1 }));
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: 't0',
    finishedAt: 't1',
    serviceSnapshotStart: snap('rev-1', 'img-1'),
    serviceSnapshotEnd: snap('rev-1', 'img-1'),
    runtimeContract: null,
    records,
    metaByDoc,
    expectedDocs: DOC_IDS,
    expectedRunsPerDoc: 1,
  });
  assert.deepEqual(report.docsWithoutSuccessfulRun, []);
  assert.deepEqual(report.skippedRuns, []);
});

test('buildReport: 有効runが0件のdocがあればinconclusiveかつdocsWithoutSuccessfulRunに含まれる(timedOutCountも計上)', () => {
  const records: SummaryRunRecord[] = [
    { docId: 'D9', run: 1, wallMs: 1, httpStatus: null, retriedCount: 0, kind: 'timedOut', failureKind: 'clientTimeout' },
  ];
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: 't0',
    finishedAt: 't1',
    serviceSnapshotStart: snap('rev-1', 'img-1'),
    serviceSnapshotEnd: snap('rev-1', 'img-1'),
    runtimeContract: null,
    records,
    metaByDoc,
    expectedDocs: ['D9'],
    expectedRunsPerDoc: 1,
  });
  assert.equal(report.inconclusive, true);
  assert.deepEqual(report.docsWithoutSuccessfulRun, ['D9']);
  assert.equal(report.timedOutCount, 1);
});

test('buildReport: 同一docに成功runがあってもtimedOutが1件でもあればinconclusive(codex review指摘)', () => {
  const records: SummaryRunRecord[] = [
    evaluatedRecord({ docId: 'D9', run: 1 }),
    { docId: 'D9', run: 2, wallMs: 1, httpStatus: 504, retriedCount: 0, kind: 'timedOut', failureKind: 'serverTimeout504' },
  ];
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: 't0',
    finishedAt: 't1',
    serviceSnapshotStart: snap('rev-1', 'img-1'),
    serviceSnapshotEnd: snap('rev-1', 'img-1'),
    runtimeContract: null,
    records,
    metaByDoc,
    expectedDocs: ['D9'],
    expectedRunsPerDoc: 2,
  });
  // このdocはisEvaluated(run1)がtrueなのでdocsWithoutSuccessfulRunには入らないが、
  // timedOutが1件存在する事実だけでinconclusiveになるべき(以降サンプル汚染の疑い)。
  assert.deepEqual(report.docsWithoutSuccessfulRun, []);
  assert.equal(report.timedOutCount, 1);
  assert.equal(report.inconclusive, true);
});

test('buildReport: budget超過等で要求した(doc,run)の一部が1回も送信されなければinconclusive(codex review指摘)', () => {
  const records = [evaluatedRecord({ docId: 'D9', run: 1 })];
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: 't0',
    finishedAt: 't1',
    serviceSnapshotStart: snap('rev-1', 'img-1'),
    serviceSnapshotEnd: snap('rev-1', 'img-1'),
    runtimeContract: null,
    records,
    metaByDoc,
    expectedDocs: ['D9', 'D10'],
    expectedRunsPerDoc: 1,
  });
  assert.equal(report.inconclusive, true);
  assert.deepEqual(report.skippedRuns, ['D10#1']);
  assert.ok(report.inconclusiveReason?.includes('D10#1'));
});

test('buildReport: gatesは9項目全て含む', () => {
  const records = [evaluatedRecord({ docId: 'D9', run: 1 })];
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: 't0',
    finishedAt: 't1',
    serviceSnapshotStart: snap('rev-1', 'img-1'),
    serviceSnapshotEnd: snap('rev-1', 'img-1'),
    runtimeContract: null,
    records,
    metaByDoc,
    expectedDocs: ['D9'],
    expectedRunsPerDoc: 1,
  });
  assert.deepEqual(
    report.gates.map((g) => g.id).sort(),
    [
      'amount-absence',
      'coverage-aggregate',
      'coverage-per-doc',
      'determinism',
      'fabrication',
      'numeric-fabrication',
      'output-sanity',
      'recombination',
      'runtime-contract',
    ]
  );
});

test('determineExitCode: WARN専用ゲートのみだと合格でもrecombination/amount-absence/output-sanityはexitCodeに影響しない', () => {
  // FAIL-capableな6ゲート(runtime-contract除く)を全てPASS/評価済みにするため、
  // role=coverageのD5(2run、集計対象)とD9(2run、</s>混入でoutput-sanityのみWARNを誘発)を使う。
  const D5_MUST_COVER_TEXT = '宮下 譲様、ひまわり訪問介護、9月22日に訪問しました。';
  const records = [
    evaluatedRecord({ docId: 'D5', run: 1, rawText: D5_MUST_COVER_TEXT }),
    evaluatedRecord({ docId: 'D5', run: 2, rawText: D5_MUST_COVER_TEXT }),
    evaluatedRecord({ docId: 'D9', run: 1, rawText: `${D9_MUST_COVER_TEXT}</s>` }),
    evaluatedRecord({ docId: 'D9', run: 2, rawText: `${D9_MUST_COVER_TEXT}</s>` }),
  ];
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: 't0',
    finishedAt: 't1',
    serviceSnapshotStart: snap('rev-1', 'img-1'),
    serviceSnapshotEnd: snap('rev-1', 'img-1'),
    runtimeContract: null,
    records,
    metaByDoc,
    expectedDocs: ['D5', 'D9'],
    expectedRunsPerDoc: 2,
  });
  const outputSanity = report.gates.find((g) => g.id === 'output-sanity');
  assert.equal(outputSanity?.verdict, 'WARN');
  // runtime-contractは/propsを取得していないためNOT_EVALUATED(別ゲート、本テストの対象外)。
  // それ以外のFAIL-capableゲートが全てPASSであることを確認したうえで、WARNのみが残る場合に
  // exitCodeへ影響しないことを検証する。
  const withoutRuntimeContract = { ...report, gates: report.gates.filter((g) => g.id !== 'runtime-contract') };
  for (const g of withoutRuntimeContract.gates) {
    if (g.id === 'recombination' || g.id === 'amount-absence' || g.id === 'output-sanity') continue;
    assert.equal(g.verdict, 'PASS', `${g.id}: ${g.detail}`);
  }
  assert.equal(determineExitCode({ ...withoutRuntimeContract, inconclusive: false }), 0);
});

test('determineExitCode: FAIL-capableゲートがFAILなら1', () => {
  const records = [evaluatedRecord({ docId: 'D9', run: 1, rawText: '介護サポート株式会社' })];
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: 't0',
    finishedAt: 't1',
    serviceSnapshotStart: snap('rev-1', 'img-1'),
    serviceSnapshotEnd: snap('rev-1', 'img-1'),
    runtimeContract: null,
    records,
    metaByDoc,
    expectedDocs: ['D9'],
    expectedRunsPerDoc: 1,
  });
  const withoutRuntimeContract = { ...report, gates: report.gates.filter((g) => g.id !== 'runtime-contract') };
  assert.equal(determineExitCode({ ...withoutRuntimeContract, inconclusive: false }), 1);
});

test('determineExitCode: anyFatal単独でも1になる(pr-test-analyzer指摘: 他のinconclusiveトリガーと絡めずに検証)', () => {
  // D5(role=coverage)を2run成功させ全FAIL-capableゲートをPASSにしたうえで、
  // D9のrun2だけをfatalにする。D9run1は評価済みのままなのでdocsWithoutSuccessfulRunには
  // 載らず、fatalなrunもattemptedKeysには含まれるのでskippedRunsも空、timedOutでもない。
  // つまりinconclusiveの他3トリガー(snapshot/timeout/budget-skip)は全てfalseのまま、
  // anyFatalだけが有効な状態を作り、determineExitCodeがこれを正しく1にすることを確認する。
  const D5_MUST_COVER_TEXT = '宮下 譲様、ひまわり訪問介護、9月22日に訪問しました。';
  const records: SummaryRunRecord[] = [
    evaluatedRecord({ docId: 'D5', run: 1, rawText: D5_MUST_COVER_TEXT }),
    evaluatedRecord({ docId: 'D5', run: 2, rawText: D5_MUST_COVER_TEXT }),
    evaluatedRecord({ docId: 'D9', run: 1, rawText: `${D9_MUST_COVER_TEXT}</s>` }),
    { docId: 'D9', run: 2, wallMs: 1, httpStatus: 400, retriedCount: 0, kind: 'fatal', fatalReason: 'HTTP 400: bad request' },
  ];
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: 't0',
    finishedAt: 't1',
    serviceSnapshotStart: snap('rev-1', 'img-1'),
    serviceSnapshotEnd: snap('rev-1', 'img-1'),
    runtimeContract: null,
    records,
    metaByDoc,
    expectedDocs: ['D5', 'D9'],
    expectedRunsPerDoc: 2,
  });
  assert.equal(report.inconclusive, false);
  assert.deepEqual(report.docsWithoutSuccessfulRun, []);
  assert.deepEqual(report.skippedRuns, []);
  const withoutRuntimeContract = { ...report, gates: report.gates.filter((g) => g.id !== 'runtime-contract') };
  for (const g of withoutRuntimeContract.gates) {
    if (g.id === 'recombination' || g.id === 'amount-absence' || g.id === 'output-sanity') continue;
    assert.equal(g.verdict, 'PASS', `前提が崩れている: ${g.id}=${g.verdict} (${g.detail})`);
  }
  assert.equal(determineExitCode(withoutRuntimeContract), 1);
});

test('buildStepSummaryMarkdown: 9行のゲート表を含む', () => {
  const records = [evaluatedRecord({ docId: 'D9', run: 1 })];
  const report = buildReport({
    serviceUrl: 'https://x',
    startedAt: 't0',
    finishedAt: 't1',
    serviceSnapshotStart: snap('rev-1', 'img-1'),
    serviceSnapshotEnd: snap('rev-1', 'img-1'),
    runtimeContract: null,
    records,
    metaByDoc,
    expectedDocs: ['D9'],
    expectedRunsPerDoc: 1,
  });
  const md = buildStepSummaryMarkdown(report);
  for (const gate of report.gates) {
    assert.ok(md.includes(gate.id), `Step Summaryにゲートid "${gate.id}" が含まれていません`);
  }
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

test('parseArgs: 既定値', () => {
  const args = parseArgs([]);
  assert.equal(args.runs, 3);
  assert.equal(args.temperature, 0.2);
  assert.equal(args.maxTokens, 1024);
  assert.deepEqual([...args.docs], [...DOC_IDS]);
});

test('parseArgs: --runsは1〜10の整数のみ許可', () => {
  assert.throws(() => parseArgs(['--runs=0']));
  assert.throws(() => parseArgs(['--runs=11']));
  assert.throws(() => parseArgs(['--runs=3.5']));
  assert.equal(parseArgs(['--runs=5']).runs, 5);
});

test('parseArgs: --docsは未知のdocでエラー', () => {
  assert.throws(() => parseArgs(['--docs=D1,D99']));
  assert.deepEqual([...parseArgs(['--docs=D9,D10']).docs], ['D9', 'D10']);
});

test('parseArgs: --temperatureは0〜2の範囲外でエラー', () => {
  assert.throws(() => parseArgs(['--temperature=3']));
  assert.throws(() => parseArgs(['--temperature=-1']));
  assert.equal(parseArgs(['--temperature=0']).temperature, 0);
});

test('parseArgs: --budget-minutesを指定できる', () => {
  const args = parseArgs(['--budget-minutes=30']);
  assert.equal(args.budgetMs, 30 * 60 * 1000);
});

// ---------------------------------------------------------------------------
// buildPromptForDoc(本番buildSummaryPromptとの整合)
// ---------------------------------------------------------------------------

test('buildPromptForDoc: 本番buildSummaryPromptと同一文面になる(D1)', () => {
  const metaRaw = loadMetaRaw();
  const fullText = loadFullSourceText('D1');
  const prompt = buildPromptForDoc('D1', fullText, metaRaw);
  assert.ok(prompt.includes('以下は「FAX送付状」のOCR結果です'));
  assert.ok(prompt.includes('【要約】'));
});

test('buildPromptForDoc: MAX_SUMMARY_INPUT_LENGTHを超える文書(D3)は「...(以下省略)」が付く', () => {
  const metaRaw = loadMetaRaw();
  const fullText = loadFullSourceText('D3');
  const prompt = buildPromptForDoc('D3', fullText, metaRaw);
  assert.ok(prompt.includes('...(以下省略)'));
});
