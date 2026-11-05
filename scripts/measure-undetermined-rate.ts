#!/usr/bin/env ts-node
/**
 * 境界時刻(--cutoff)の前後で、書類種別が「未判定」の割合を比べる(read-only、PIIなし、件数と割合のみ)。
 *
 * 背景: ADR-0031。向き補正が未判定の主因だったかを確かめる、最も直接的な指標。反映後(--cutoff以降)に
 * 取り込まれた書類は、補正入りの仕組みで処理されている。再処理した書類は処理日時が古いままなので、
 * 反映後の集計には入らない(再処理スクリプトはprocessedAtを更新しない)。ただし、再処理や分割で新しく作られた
 * 書類(FAX複製・PDF分割)は処理日時が作成時刻になるため、反映後の集計に入りうる。集計はFirestoreのcount()だけで、書類の中身は読まない。
 *
 * 注意:
 *   - 反映前の値は、再処理で未判定が解消した書類を含むため、再処理の前に記録した値(10月7.9%など)より低く出る。
 *   - 処理日時はOCR完了時刻ではなく取り込み時刻。
 *   - 件数が少ない窓は割合が大きく振れるため、95%信頼区間(ウィルソン)を併記する。
 *
 * 使用方法(GitHub Actions: Run Operations Script):
 *   measure-undetermined-rate --since 2026-10-01 --cutoff 2026-11-04T18:30
 */

import * as admin from 'firebase-admin';
import { parseSinceArg } from './lib/undeterminedSummary';
import { formatRate, parseJstDateTime, timeRanges, type TimeRange } from './lib/rateWindows';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID 環境変数を設定してください');
  process.exit(1);
}

function getArg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const since = getArg('--since');
const sinceMs = parseSinceArg(since);
const cutoffArg = getArg('--cutoff');
const cutoffMs = parseJstDateTime(cutoffArg);
if (!since || sinceMs === null) {
  console.error('--since YYYY-MM-DD(JSTの実在する日付)を指定してください');
  process.exit(1);
}
if (!cutoffArg || cutoffMs === null || cutoffMs <= sinceMs) {
  console.error('--cutoff YYYY-MM-DDTHH:mm(JST、--sinceより後)を指定してください');
  process.exit(1);
}
const sinceStartMs: number = sinceMs;
const cutoffAtMs: number = cutoffMs;
const bucketHours = Number(getArg('--bucket-hours') ?? '6');
if (!Number.isFinite(bucketHours) || bucketHours <= 0 || bucketHours > 24) {
  console.error('--bucket-hours は0より大きく24以下の数値を指定してください');
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

const DAY_MS = 24 * 3_600_000;
const JST_OFFSET_MS = 9 * 3_600_000;

function label(ms: number): string {
  const d = new Date(ms + JST_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

async function countProcessed(r: TimeRange, undeterminedOnly: boolean): Promise<number> {
  let q: admin.firestore.Query = db.collection('documents').where('status', '==', 'processed');
  if (undeterminedOnly) q = q.where('documentType', '==', '未判定');
  const snap = await q
    .where('processedAt', '>=', admin.firestore.Timestamp.fromMillis(r.startMs))
    .where('processedAt', '<', admin.firestore.Timestamp.fromMillis(r.endMs))
    .count()
    .get();
  return snap.data().count;
}

interface Row {
  range: TimeRange;
  total: number;
  undetermined: number;
}

async function measure(ranges: TimeRange[]): Promise<Row[]> {
  return Promise.all(
    ranges.map(async (range) => {
      const [total, undetermined] = await Promise.all([countProcessed(range, false), countProcessed(range, true)]);
      return { range, total, undetermined };
    }),
  );
}

function printRows(rows: Row[]): void {
  console.log('窓(JST、開始以上・終了未満) | processed全体 | 未判定 | 率 [95%信頼区間]');
  for (const r of rows) {
    console.log(`${label(r.range.startMs)} 〜 ${label(r.range.endMs)} | ${r.total} | ${r.undetermined} | ${formatRate(r.undetermined, r.total)}`);
  }
}

function sum(rows: Row[]): { total: number; undetermined: number } {
  return rows.reduce((a, r) => ({ total: a.total + r.total, undetermined: a.undetermined + r.undetermined }), { total: 0, undetermined: 0 });
}

async function main(): Promise<void> {
  const nowMs = Date.now();
  if (cutoffAtMs >= nowMs) {
    console.error('--cutoff が現在より後です');
    process.exit(1);
  }
  console.log(`境界時刻(--cutoff): ${label(cutoffAtMs)} JST。窓は、処理日時(取り込み時刻)で切る`);

  const before = await measure(timeRanges(sinceStartMs, cutoffAtMs, DAY_MS));
  const after = await measure(timeRanges(cutoffAtMs, nowMs, bucketHours * 3_600_000));

  console.log('');
  console.log(`== 境界前(${since} 〜 境界時刻)。日別 ==`);
  console.log('注: 2026-10-05以降に取り込まれた書類は、再処理で未判定が解消した分を含むため、再処理の前に記録した値(10月7.9%など)より低く出る');
  printRows(before);
  const b = sum(before);
  console.log(`境界前の合計 | ${b.total} | ${b.undetermined} | ${formatRate(b.undetermined, b.total)}`);

  console.log('');
  console.log(`== 境界後(境界時刻 〜 現在)。${bucketHours}時間ごと ==`);
  console.log('注: 再処理や分割で新しく作られた書類(FAX複製・PDF分割)は、境界後の窓に入りうる');
  printRows(after);
  const a = sum(after);
  console.log(`境界後の合計 | ${a.total} | ${a.undetermined} | ${formatRate(a.undetermined, a.total)}`);

  console.log('');
  console.log('読み方: 境界の前後で、率の信頼区間が重ならなければ、差の根拠になる。重なる場合は、差があるとは言えない');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('ERROR:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
