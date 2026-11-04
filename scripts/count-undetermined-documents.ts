#!/usr/bin/env ts-node
/**
 * 書類種別が「未判定」の書類の件数を集計する(read-only、PIIなし)。
 *
 * 背景: ADR-0031(PaddleOCRのページ向き補正)の効果を、再処理の前後で比べるための基準値を取る。
 * 出力は件数のみ(日別・ページ数帯・MIMEタイプ)。書類名・利用者名・事業所名・本文は取得も出力もしない
 * (GitHub Actionsのログは公開されるため)。書き込みは一切行わない。
 *
 * 対象: status=='processed' かつ documentType=='未判定' かつ processedAt >= --since(JST 0時)。
 * 注: processedAtはOCR完了時刻ではなく取込(pending作成)時刻(inspect-ocr-volume-stats.jsの注記と同じ)。
 *
 * 使用方法(GitHub Actions: Run Operations Script):
 *   count-undetermined-documents --since 2026-11-01
 *
 * 直接実行:
 *   FIREBASE_PROJECT_ID=<project-id> npx ts-node scripts/count-undetermined-documents.ts --since 2026-11-01
 */

import * as admin from 'firebase-admin';
import { jstDateKey, summarizeUndetermined, type UndeterminedDocInput } from './lib/undeterminedSummary';

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
if (!since || !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  console.error('--since YYYY-MM-DD(JSTの日付)を指定してください');
  process.exit(1);
}
const sinceMs = Date.parse(`${since}T00:00:00+09:00`);
if (Number.isNaN(sinceMs)) {
  console.error(`--since の日付が不正です: ${since}`);
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

const UNKNOWN_CUSTOMER = '不明顧客';
const FIELDS = ['processedAt', 'verified', 'customerName', 'totalPages', 'mimeType', 'distributionId'] as const;

async function main(): Promise<void> {
  const sinceTs = admin.firestore.Timestamp.fromMillis(sinceMs);
  console.log(`対象: status=processed / documentType=未判定 / 処理日時(JST) >= ${since} 0時`);

  // 全processedの件数(率の分母)。日別はprocessedAtの範囲でcount()集計する(読み取り課金を抑える)
  const nowMs = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const totalByDay: Record<string, number> = {};
  for (let start = sinceMs; start <= nowMs; start += DAY_MS) {
    const snap = await db
      .collection('documents')
      .where('status', '==', 'processed')
      .where('processedAt', '>=', admin.firestore.Timestamp.fromMillis(start))
      .where('processedAt', '<', admin.firestore.Timestamp.fromMillis(start + DAY_MS))
      .count()
      .get();
    totalByDay[jstDateKey(start)] = snap.data().count;
  }

  const snap = await db
    .collection('documents')
    .where('status', '==', 'processed')
    .where('documentType', '==', '未判定')
    .where('processedAt', '>=', sinceTs)
    .select(...FIELDS)
    .get();

  const docs: UndeterminedDocInput[] = snap.docs.map((d) => {
    const data = d.data();
    const processedAt = data.processedAt as admin.firestore.Timestamp | undefined;
    const name = data.customerName as string | undefined;
    const pages = data.totalPages;
    return {
      processedAtMs: processedAt ? processedAt.toMillis() : null,
      verified: data.verified === true,
      customerUnknown: !name || name === UNKNOWN_CUSTOMER,
      totalPages: typeof pages === 'number' ? pages : null,
      mimeType: typeof data.mimeType === 'string' ? data.mimeType : null,
      hasDistributionId: typeof data.distributionId === 'string' && data.distributionId.length > 0,
    };
  });

  const s = summarizeUndetermined(docs);
  console.log('');
  console.log(`未判定 合計: ${s.total}件(確認済み ${s.verified} / 未確認 ${s.unverified})`);
  console.log(`再処理の対象候補(未確認かつ利用者不明): ${s.reprocessTargets}件`);
  console.log(`複数利用者FAXの複製(distributionIdあり): ${s.withDistributionId}件`);
  console.log('');
  console.log('日(JST) | processed全体 | 未判定 | うち対象候補 | 未判定率');
  const days = Object.keys({ ...totalByDay, ...s.byDay }).sort();
  for (const day of days) {
    const total = totalByDay[day] ?? 0;
    const c = s.byDay[day] ?? { total: 0, reprocessTargets: 0 };
    const rate = total > 0 ? `${((c.total / total) * 100).toFixed(1)}%` : '-';
    console.log(`${day} | ${total} | ${c.total} | ${c.reprocessTargets} | ${rate}`);
  }
  console.log('');
  console.log('ページ数帯:', JSON.stringify(s.pagesBand));
  console.log('MIMEタイプ:', JSON.stringify(s.mimeTypes));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('ERROR:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
