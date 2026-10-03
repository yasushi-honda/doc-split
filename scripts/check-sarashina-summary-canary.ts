#!/usr/bin/env ts-node
/**
 * Sarashina要約のcanary測定(ADR-0027 PR6の客観ゲート(1)〜(3))。read-only。
 *
 * 使用方法(FIREBASE_PROJECT_IDは必須):
 *   --canary-ids id1,id2,...,id10   分母=指定した文書(最大10件)。取得できない文書は分母に含めてFAIL寄りに数える
 *   --hours N                       分母=直近N時間にsummaryStateUpdatedAtが更新された文書(全体展開後の期間集計、1〜168)
 *   --canary-ids 指定時の--hoursは省略可(リクエストログの集計窓、既定24)
 *
 * 取得するのはsummaryState/summaryErrorKindのみ(fieldMask/select)。PIIフィールドは読まない。
 * 処理時間は文書に保存されないため、ゲート(3)はSarashinaサービスのCloud Runリクエストログの
 * リクエスト単位latency(コールドスタート込み)で測る。詳細は scripts/lib/sarashinaCanaryStats.ts。
 * ゲート(4)(5)(decision-makerの原文照合とrun.invoker確認)は本スクリプトの対象外。
 *
 * 終了コード: ゲート(1)〜(3)の総合がFAILなら1(ログ取得失敗・打切りによる不完全な測定を含む)、PASSなら0。
 * 取得するのはsummaryState/summaryErrorKind/summaryProviderのみ。doneはsummaryProvider=sarashinaのみ数える。
 */
import { execFileSync } from 'child_process';
import * as admin from 'firebase-admin';
import {
  evaluateCanaryGate,
  isLatencyIncomplete,
  summarizeCanaryDocs,
  summarizeRequestLatencies,
  type CanaryDocSnapshot,
  type RequestLogEntry,
} from './lib/sarashinaCanaryStats';

const ALLOWED_PROJECT_IDS = ['doc-split-dev', 'docsplit-kanameone', 'docsplit-cocoro'];
const SARASHINA_SERVICE = 'sarashina-summary';
const MAX_CANARY_IDS = 10;
const MAX_PERIOD_DOCS = 5000;
const LOG_LIMIT = 1000;
const DEFAULT_LOG_HOURS = 24;
const MAX_HOURS = 168;
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || '';
if (!ALLOWED_PROJECT_IDS.includes(PROJECT_ID)) {
  console.error(`❌ FIREBASE_PROJECT_ID は ${ALLOWED_PROJECT_IDS.join('/')} のいずれかを指定してください (指定: ${PROJECT_ID})`);
  process.exit(1);
}

function getArg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function parseHours(raw: string | undefined, fallback: number | null): number | null {
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) {
    console.error(`❌ --hours は整数で指定してください (指定: ${raw})`);
    process.exit(1);
  }
  const n = Number(raw);
  if (n < 1 || n > MAX_HOURS) {
    console.error(`❌ --hours は1〜${MAX_HOURS}の範囲で指定してください (指定: ${n})`);
    process.exit(1);
  }
  return n;
}

const canaryIdsRaw = getArg('--canary-ids');
const hours = parseHours(getArg('--hours'), canaryIdsRaw === undefined ? null : DEFAULT_LOG_HOURS);
if (canaryIdsRaw === undefined && hours === null) {
  console.error('❌ --canary-ids <id,...> または --hours <N> のどちらかを指定してください');
  process.exit(1);
}

function parseCanaryIds(raw: string): string[] {
  const ids = raw.split(',').filter((s) => s.length > 0);
  if (ids.length === 0 || ids.length > MAX_CANARY_IDS) {
    console.error(`❌ --canary-ids は1〜${MAX_CANARY_IDS}件で指定してください (指定: ${ids.length}件)`);
    process.exit(1);
  }
  if (new Set(ids).size !== ids.length) {
    console.error('❌ --canary-ids に重複があります');
    process.exit(1);
  }
  const bad = ids.filter((id) => !ID_PATTERN.test(id));
  if (bad.length > 0) {
    console.error('❌ --canary-ids に使えない文字を含むIDがあります(英数字・_・-のみ)');
    process.exit(1);
  }
  return ids;
}

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

function toSnapshot(data: FirebaseFirestore.DocumentData | undefined): CanaryDocSnapshot {
  return {
    state: typeof data?.summaryState === 'string' ? data.summaryState : null,
    errorKind: typeof data?.summaryErrorKind === 'string' ? data.summaryErrorKind : null,
    provider: typeof data?.summaryProvider === 'string' ? data.summaryProvider : null,
  };
}

async function loadByIds(ids: string[]): Promise<{ docs: CanaryDocSnapshot[]; missing: number; rows: string[] }> {
  const refs = ids.map((id) => db.collection('documents').doc(id));
  const snaps = await db.getAll(...refs, { fieldMask: ['summaryState', 'summaryErrorKind', 'summaryProvider'] });
  const docs: CanaryDocSnapshot[] = [];
  const rows: string[] = [];
  let missing = 0;
  for (const s of snaps) {
    if (!s.exists) {
      missing += 1;
      rows.push(`  ${s.id}  (文書なし)`);
      continue;
    }
    const snap = toSnapshot(s.data());
    docs.push(snap);
    rows.push(
      `  ${s.id}  state=${snap.state ?? '(なし)'}  provider=${snap.provider ?? '-'}  errorKind=${snap.errorKind ?? '-'}`
    );
  }
  return { docs, missing, rows };
}

async function loadByPeriod(periodHours: number): Promise<{ docs: CanaryDocSnapshot[]; truncated: boolean }> {
  const since = admin.firestore.Timestamp.fromMillis(Date.now() - periodHours * 3600 * 1000);
  const snap = await db
    .collection('documents')
    .where('summaryStateUpdatedAt', '>=', since)
    .select('summaryState', 'summaryErrorKind', 'summaryProvider')
    .limit(MAX_PERIOD_DOCS + 1)
    .get();
  const truncated = snap.size > MAX_PERIOD_DOCS;
  const docs = snap.docs.slice(0, MAX_PERIOD_DOCS).map((d) => toSnapshot(d.data()));
  return { docs, truncated };
}

function readRequestLogs(windowHours: number): { entries: RequestLogEntry[]; truncated: boolean } {
  const since = new Date(Date.now() - windowHours * 3600 * 1000).toISOString();
  const filter =
    `resource.type="cloud_run_revision" AND resource.labels.service_name="${SARASHINA_SERVICE}" ` +
    `AND httpRequest.requestMethod="POST" AND timestamp>="${since}"`;
  const out = execFileSync(
    'gcloud',
    ['logging', 'read', filter, `--project=${PROJECT_ID}`, `--limit=${LOG_LIMIT}`, '--format=json'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  const rows = JSON.parse(out) as Array<{ httpRequest?: { status?: number; latency?: string } }>;
  const entries: RequestLogEntry[] = rows
    .filter((r) => typeof r.httpRequest?.status === 'number')
    .map((r) => ({ status: r.httpRequest!.status as number, latency: r.httpRequest?.latency }));
  return { entries, truncated: rows.length >= LOG_LIMIT };
}

async function main(): Promise<void> {
  console.log(`=== Sarashina要約 canary測定 (project=${PROJECT_ID}, read-only) ===`);

  let docs: CanaryDocSnapshot[];
  let missing = 0;
  let docsTruncated = false;
  let logWindowHours: number;
  if (canaryIdsRaw !== undefined) {
    const ids = parseCanaryIds(canaryIdsRaw);
    const loaded = await loadByIds(ids);
    docs = loaded.docs;
    missing = loaded.missing;
    logWindowHours = hours ?? DEFAULT_LOG_HOURS;
    console.log(`分母: 指定文書 ${ids.length}件(リクエストログの集計窓: 直近${logWindowHours}時間)`);
    console.log('--- 文書別 ---');
    loaded.rows.forEach((r) => console.log(r));
  } else {
    logWindowHours = hours as number;
    const loaded = await loadByPeriod(logWindowHours);
    docs = loaded.docs;
    docsTruncated = loaded.truncated;
    console.log(`分母: 直近${logWindowHours}時間にsummaryStateUpdatedAtが更新された文書`);
  }

  const summary = summarizeCanaryDocs(docs, missing);
  console.log('');
  console.log(`=== ① summaryState別(分母 ${summary.denominator}件、うち文書なし ${summary.missing}件) ===`);
  for (const [k, v] of Object.entries(summary.byState)) console.log(`${k}: ${v}`);
  console.log(`done(Sarashina以外で生成されたものは別掲): Sarashina ${summary.byState.done}件 / 他プロバイダ ${summary.doneByOtherProvider}件`);
  console.log(`fabrication_suspectedの最終error(state=error): ${summary.fabricationFinalErrors}件`);
  if (docsTruncated) {
    console.log(`⚠ 文書が${MAX_PERIOD_DOCS}件を超えたため打切り。この集計は不完全(ゲート判定はFAIL扱い)`);
  }

  console.log('');
  console.log(`=== ② Sarashinaリクエストログ(直近${logWindowHours}時間、service=${SARASHINA_SERVICE}) ===`);
  let latency = summarizeRequestLatencies([]);
  let logsTruncated = false;
  try {
    const logs = readRequestLogs(logWindowHours);
    logsTruncated = logs.truncated;
    latency = summarizeRequestLatencies(logs.entries);
  } catch (e) {
    console.log(`ログ取得に失敗: ${(e as Error).message.split('\n')[0]}`);
    console.log('(このためp95は測れず、ゲート(3)はFAIL扱い)');
  }
  const f = (n: number | null): string => (n === null ? '測定不能' : `${n.toFixed(1)}秒`);
  console.log(
    `200応答 ${latency.okCount}件 / 429拒否 ${latency.rejected429}件 / その他失敗 ${latency.otherFailures}件 / latency不明 ${latency.unparsable}件`
  );
  console.log(`p50=${f(latency.p50)} p95=${f(latency.p95)} max=${f(latency.max)}`);
  if (logsTruncated) console.log(`⚠ ログが${LOG_LIMIT}件に達した。古い分が欠けている可能性がある`);
  console.log('注意: 文書単位ではなくリクエスト単位(コールドスタート込み、再試行は複数件)。429は同時実行上限での拒否。');

  const gate = evaluateCanaryGate({
    denominator: summary.denominator,
    done: summary.byState.done,
    fabricationFinalErrors: summary.fabricationFinalErrors,
    p95Seconds: latency.p95,
    latencyIncomplete: isLatencyIncomplete(latency, logsTruncated),
  });
  const incomplete = docsTruncated;
  console.log('');
  console.log('=== ③ 客観ゲート判定(1)〜(3) ===');
  console.log(`(1) ${gate.doneRate.pass ? 'PASS' : 'FAIL'}: ${gate.doneRate.detail}`);
  console.log(`(2) ${gate.fabrication.pass ? 'PASS' : 'FAIL'}: ${gate.fabrication.detail}`);
  console.log(`(3) ${gate.latency.pass ? 'PASS' : 'FAIL'}: ${gate.latency.detail}`);
  const overallPass = gate.allPass && !incomplete;
  console.log(`総合((1)〜(3)): ${overallPass ? 'PASS' : 'FAIL'}`);
  console.log('※ ゲート(4)原文照合・(5)run.invokerの確認は別途(本スクリプトの対象外)');
  if (!overallPass) process.exitCode = 1;
}

main().catch((e) => {
  console.error('❌ 失敗:', (e as Error).message.split('\n')[0]);
  process.exit(1);
});
