#!/usr/bin/env ts-node
/**
 * 再処理しても未判定・利用者不明のまま残る書類を、特徴の件数だけで分類する(read-only、PIIなし)。
 *
 * 背景: ADR-0031。向き補正を入れた再処理で、書類種別が未判定の書類の多くは判定できたが、一部の書類
 * (未判定のまま残る・利用者が不明のまま)は解消しなかった。その原因の手がかりを、書類名・利用者名・
 * 本文を出さずに得る。GitHub Actionsのログは公開されるため、出力は固定の帯(バケット)ごとの件数のみ。
 *
 * 対象グループ(--group で選ぶ。共通: status=processed・人の確認なし・処理日時 >= --since、--untilで上限):
 *   undetermined: 書類種別が「未判定」
 *   unknown-customer: 利用者が不明(customerName='不明顧客'相当)
 *
 * 出す特徴(いずれも固定の帯): ページ数、認識テキストの長さ(文字数のみ。内容は見ない)、書類種別・利用者の
 * 抽出の信頼度と一致の種類、利用者候補の件数、処理に使った仕組み。値そのもの(テキスト・名前・提案値)は出さない。
 * 書き込みは一切行わない。
 *
 * 使用方法(GitHub Actions: Run Operations Script):
 *   classify-unresolved-documents --since 2026-11-01 --group undetermined
 *   classify-unresolved-documents --since 2026-11-01 --group unknown-customer
 */

import * as admin from 'firebase-admin';
import { isCustomerUnknown, parseSinceArg } from './lib/undeterminedSummary';
import { bucketDocumentType, bucketStatus } from './lib/unknownCustomerDiagnosis';
import { ocrEngineBucket } from './lib/reprocessUnknownCustomer';
import {
  candidateCountBand,
  confidenceBand,
  matchTypeBucket,
  pagesBand,
  summarizeFeatures,
  textLengthBand,
  type FeatureRow,
} from './lib/classifyUnresolved';

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
const untilArg = getArg('--until');
if (process.argv.includes('--until') && untilArg === undefined) {
  console.error('--until には YYYY-MM-DD を指定してください');
  process.exit(1);
}
let untilMs: number | undefined;
if (untilArg !== undefined) {
  const parsed = parseSinceArg(untilArg);
  if (parsed === null || parsed <= sinceStartMs) {
    console.error('--until YYYY-MM-DD(JSTの実在する日付、--sinceより後。その日の0時を含まない上限)を指定してください');
    process.exit(1);
  }
  untilMs = parsed;
}
const group = getArg('--group');
if (group !== 'undetermined' && group !== 'unknown-customer') {
  console.error('--group は undetermined または unknown-customer を指定してください');
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

const READ_LIMIT = 20000;
const FIELDS = [
  'status',
  'processedAt',
  'verified',
  'customerName',
  'documentType',
  'totalPages',
  'ocrResultUrl',
  'ocrExtraction.version',
  'ocrExtraction.documentType.confidence',
  'ocrExtraction.documentType.matchType',
  'ocrExtraction.customer.confidence',
  'ocrExtraction.customer.matchType',
  'customerCandidates',
] as const;

function toMs(v: unknown): number | null {
  const t = v as admin.firestore.Timestamp | undefined;
  return t && typeof t.toMillis === 'function' ? t.toMillis() : null;
}

function printMap(label: string, map: Record<string, number>): void {
  const entries = Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  console.log(`  ${label}: ${entries.map(([k, v]) => `${k}=${v}`).join(', ') || '(なし)'}`);
}

async function main(): Promise<void> {
  console.log(
    `対象: ${group === 'undetermined' ? '書類種別が「未判定」' : "customerName='不明顧客'"}・processed・人の確認なし・処理日時(JST) >= ${since} 0時${untilArg ? ` かつ < ${untilArg} 0時` : ''}`,
  );
  const query =
    group === 'undetermined'
      ? db.collection('documents').where('documentType', '==', '未判定')
      : db.collection('documents').where('customerName', '==', '不明顧客');
  const snap = await query
    .select(...FIELDS)
    .limit(READ_LIMIT)
    .get();
  if (snap.size >= READ_LIMIT) {
    console.error(`ERROR: 読み取り上限(${READ_LIMIT}件)に達しました。取りこぼしを避けるため中断します`);
    process.exit(1);
  }

  const targets = snap.docs.filter((d) => {
    const data = d.data();
    const processedMs = toMs(data.processedAt);
    if (bucketStatus(data.status) !== 'processed' || data.verified === true) return false;
    if (processedMs === null || processedMs < sinceStartMs || (untilMs !== undefined && processedMs >= untilMs)) return false;
    return group === 'undetermined' ? bucketDocumentType(data.documentType) === 'undetermined' : isCustomerUnknown(data.customerName);
  });
  console.log(`対象の書類: ${targets.length}件`);
  if (targets.length === 0) return;

  // 認識テキストの長さ(文字数のみ)。detail/main.ocrResult を読むが、内容は出力せず、長さの帯だけを使う
  const detailRefs = targets.map((d) => db.doc(`documents/${d.id}/detail/main`));
  const detailSnaps = await db.getAll(...detailRefs, { fieldMask: ['ocrResult'] });

  const rows: FeatureRow[] = targets.map((d, i) => {
    const data = d.data();
    const ext = data.ocrExtraction ?? {};
    const detailText = detailSnaps[i].exists ? detailSnaps[i].data()?.ocrResult : undefined;
    const hasUrl = typeof data.ocrResultUrl === 'string' && data.ocrResultUrl.length > 0;
    return {
      pages: pagesBand(data.totalPages),
      textLength: textLengthBand(detailText, hasUrl),
      docTypeConfidence: confidenceBand(ext.documentType?.confidence),
      docTypeMatch: matchTypeBucket(ext.documentType?.matchType),
      customerConfidence: confidenceBand(ext.customer?.confidence),
      customerMatch: matchTypeBucket(ext.customer?.matchType),
      customerCandidates: candidateCountBand(Array.isArray(data.customerCandidates) ? data.customerCandidates.length : undefined),
      engine: ocrEngineBucket(ext.version),
    };
  });

  const s = summarizeFeatures(rows);
  console.log('');
  console.log(`特徴の分布(${rows.length}件。各行の合計は件数に一致)`);
  printMap('ページ数', s.pages);
  printMap('認識テキストの長さ(文字数)', s.textLength);
  printMap('書類種別の抽出: 信頼度', s.docTypeConfidence);
  printMap('書類種別の抽出: 一致の種類', s.docTypeMatch);
  printMap('利用者の抽出: 信頼度', s.customerConfidence);
  printMap('利用者の抽出: 一致の種類', s.customerMatch);
  printMap('利用者候補の件数', s.customerCandidates);
  printMap('処理に使った仕組み', s.engine);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('ERROR:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
