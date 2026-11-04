#!/usr/bin/env ts-node
/**
 * 「利用者が不明(customerName='不明顧客'、画面では「不明利用者」)」の書類の診断集計(read-only、PIIなし)。
 *
 * 背景: ADR-0031。画面に「不明利用者・未判定・選択待ち」の書類が9件以上あったのに、
 * count-undetermined-documents(processedAt>=since かつ documentType=='未判定')の11/4分は4件だった。
 * 食い違いの原因が「集計条件の取りこぼし」か「その後の処理・削除」かを切り分けるため、
 * 処理日時・書類種別・状態への依存を外した件数を出す。
 *
 * 出力は件数のみ(状態・書類種別・確認状態の別、処理日時と作成日時の日別)。書類名・利用者名・本文は
 * 取得も出力もしない(GitHub Actionsのログは公開されるため)。書き込みは一切行わない。
 * 状態・書類種別は固定のバケットに丸めて出す(自由文字列を出さない)。
 *
 * 使用方法(GitHub Actions: Run Operations Script):
 *   diagnose-unknown-customer-documents --since 2026-11-01
 */

import * as admin from 'firebase-admin';
import { jstDayRanges, parseSinceArg } from './lib/undeterminedSummary';
import {
  bucketDocumentType,
  bucketStatus,
  dailyRateRows,
  summarizeDiagnosis,
  unknownProcessedByDay,
  type DiagnosisDocInput,
} from './lib/unknownCustomerDiagnosis';

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
if (!since || sinceMs === null) {
  console.error('--since YYYY-MM-DD(JSTの実在する日付)を指定してください');
  process.exit(1);
}
const sinceStartMs: number = sinceMs;

admin.initializeApp({ projectId });
const db = admin.firestore();

/** 画面の「不明利用者」は、保存値'不明顧客'の表示(shared/customerIdentity.tsのformatCustomerNameForDisplay) */
const STORED_UNKNOWN_CUSTOMER = '不明顧客';
const FIELDS = ['status', 'documentType', 'processedAt', 'createdAt', 'customerConfirmed', 'needsManualCustomerSelection', 'officeConfirmed', 'officeCandidates', 'verified', 'parentDocumentId'] as const;
const READ_LIMIT = 20000;

function toMs(v: unknown): number | null {
  const t = v as admin.firestore.Timestamp | undefined;
  return t && typeof t.toMillis === 'function' ? t.toMillis() : null;
}

function printMap(label: string, map: Record<string, number>): void {
  const entries = Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  console.log(`${label}: ${entries.map(([k, v]) => `${k}=${v}`).join(', ') || '(なし)'}`);
}

async function main(): Promise<void> {
  console.log(`対象: customerName='不明顧客'(画面の「不明利用者」)の書類。窓: 処理日時(無ければ作成日時)のJST >= ${since} 0時`);

  const total = (await db.collection('documents').where('customerName', '==', STORED_UNKNOWN_CUSTOMER).count().get()).data().count;
  console.log(`customerName='不明顧客'の書類(全期間): ${total}件`);

  const snap = await db
    .collection('documents')
    .where('customerName', '==', STORED_UNKNOWN_CUSTOMER)
    .select(...FIELDS)
    .limit(READ_LIMIT)
    .get();
  if (snap.size >= READ_LIMIT) console.log(`注意: 読み取り上限(${READ_LIMIT}件)に達したため、集計は一部です`);

  const docs: DiagnosisDocInput[] = snap.docs.map((d) => {
    const data = d.data();
    return {
      status: bucketStatus(data.status),
      docTypeBucket: bucketDocumentType(data.documentType),
      processedAtMs: toMs(data.processedAt),
      createdAtMs: toMs(data.createdAt),
      customerConfirmed: typeof data.customerConfirmed === 'boolean' ? data.customerConfirmed : null,
      needsManualCustomerSelection:
        typeof data.needsManualCustomerSelection === 'boolean' ? data.needsManualCustomerSelection : null,
      // 事業所未確定(画面の選択待ちに含まれる): officeConfirmed===falseかつ候補あり。候補の中身は読まず、件数だけ使う
      officeUnconfirmed: data.officeConfirmed === false && Array.isArray(data.officeCandidates) && data.officeCandidates.length > 0,
      verified: data.verified === true,
      isSplitChild: typeof data.parentDocumentId === 'string' && data.parentDocumentId.length > 0,
    };
  });

  const s = summarizeDiagnosis(docs, sinceStartMs);
  console.log('');
  console.log(`窓の内側: ${s.inWindow}件(うち日付なし ${s.noDate}件)/窓の外(除外): ${s.excludedByWindow}件`);
  printMap('状態', s.byStatus);
  printMap('書類種別(未判定/空・欠損/その他)', s.byDocType);
  printMap('customerConfirmed', s.byCustomerConfirmed);
  console.log(`人が確認済み(verified): ${s.verified}件 / 分割で作られた書類: ${s.splitChildren}件`);
  console.log('');
  console.log(`画面の「選択待ち」(顧客未確定 または 事業所未確定。確認済み・状態に依存しない。同姓同名は含まない)に当たる書類: ${s.selectionWaiting}件`);
  console.log(`  うち顧客は確定済みで事業所未確定のみ: ${s.officeOnlySelectionWaiting}件`);
  printMap('  選択待ち × 状態', s.waitingByStatus);
  printMap('  選択待ち × 人が確認済み(verified)', s.waitingByVerified);
  printMap('  選択待ち × 書類種別', s.waitingByDocType);
  console.log(`先方の画面に並んでいた集団(選択待ち かつ 書類種別が「未判定」。確認済み・状態を問わない): ${s.selectionWaitingUndetermined}件`);
  printMap('  うち未判定 × 人が確認済み(verified)', s.waitingUndeterminedByVerified);
  printMap('  うち未判定 × 状態', s.waitingUndeterminedByStatus);
  console.log(`同じだが書類種別が空欄(画面では「未判定」と出る可能性): ${s.selectionWaitingDocTypeEmpty}件`);
  console.log(`(参考)前回の集計の条件(processed・未判定・人の確認なし・処理日時あり。選択待ちに依存しない): ${s.previousS0Candidates}件`);
  console.log(`処理日時と作成日時のJST日付が食い違う書類: ${s.processedCreatedDayMismatch}件`);
  console.log('');
  printMap('処理日時の日別(JST)', s.byProcessedDay);
  printMap('作成日時の日別(JST)', s.byCreatedDay);

  // 利用者不明の率(日別)。分母は、その日に処理された書類(status=processed)の全体件数
  const totalByDay: Record<string, number> = {};
  for (const range of jstDayRanges(sinceStartMs, Date.now())) {
    const countSnap = await db
      .collection('documents')
      .where('status', '==', 'processed')
      .where('processedAt', '>=', admin.firestore.Timestamp.fromMillis(range.startMs))
      .where('processedAt', '<', admin.firestore.Timestamp.fromMillis(range.endMs))
      .count()
      .get();
    totalByDay[range.day] = countSnap.data().count;
  }
  const unknownByDay = unknownProcessedByDay(docs, sinceStartMs);
  console.log('');
  console.log('利用者不明の率(日別、JST。分母=その日に処理されたprocessedの全体、分子=うち利用者不明のprocessed)');
  console.log('日(JST) | processed全体 | 利用者不明 | 率');
  const rows = dailyRateRows(totalByDay, unknownByDay);
  for (const r of rows) console.log(`${r.day} | ${r.total} | ${r.unknown} | ${r.rate}`);
  // 月別の合計(10月・11月の比較用)
  const byMonth: Record<string, { total: number; unknown: number }> = {};
  for (const r of rows) {
    const m = r.day.slice(0, 7);
    const cur = (byMonth[m] ??= { total: 0, unknown: 0 });
    cur.total += r.total;
    cur.unknown += r.unknown;
  }
  console.log('');
  console.log('月別(窓の範囲のみ。月の途中から始まる場合は一部の期間)');
  for (const [m, v] of Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`${m} | processed全体 ${v.total} | 利用者不明 ${v.unknown} | ${v.total > 0 ? ((v.unknown / v.total) * 100).toFixed(1) + '%' : '-'}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('ERROR:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
