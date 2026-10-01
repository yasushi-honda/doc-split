#!/usr/bin/env ts-node
/**
 * 確認済み書類の顧客ID紐づけ補完(同名マスターがちょうど1件の場合のみ)
 *
 * 背景: 確認ボタンの自動確定・書類詳細の保存は、顧客名が有効で同名衝突が無ければ`customerId`が
 * 空のままでも「確認済み」にする。Driveエクスポートは`customerId`でマスターを引いてフリガナを
 * 取るため、紐づけが無い確認済み書類は「フリガナが未設定のため…」でエラーになる(kanameone、
 * 2026-10-01)。同名の顧客マスターが**ちょうど1件**の書類だけ、`customerId`をそのマスターへ補完する。
 * 同姓同名(空白違いを含む)・同名なし・未確認・顧客名無効の書類は自動では触らない(manifestに
 * 理由別のdocIdだけ出力し、現場判断に回す)。
 *
 * 書くのは`customerId`の1フィールドのみ(customerName・customerKey・careManager・updatedAt等は
 * 不変)。`updatedAt`を触らないのは、定期スイープがpermanentエラーを`updatedAt`から1時間後に
 * 再試行するため(更新すると再試行が遅れる)。紐づけ後は定期スイープ(15分ごと)が自動で再試行する。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone npx ts-node scripts/backfill-customer-id-link.ts \
 *     [--dry-run] [--limit N] [--expected-count N] [--manifest-out path]
 *   FIREBASE_PROJECT_ID=... npx ts-node scripts/backfill-customer-id-link.ts --rollback <manifest> [--dry-run]
 *
 * - `--dry-run`: 書込みなし(対象件数と理由別内訳、manifestのみ)
 * - `--limit N`: 対象を先頭(documentId順)からN件に絞る(canary)
 * - `--expected-count N`: `--limit`適用後の実対象件数と一致しなければ、書込み前に中断(誤操作防止)
 * - `--rollback`: manifestのdocIdを再取得し、`updateTime`が書込み直後と一致する書類だけを元に戻す
 *
 * PII対策: ログ・manifestにはdocId・マスターID・件数のみ(顧客名・ファイル名は出さない)。
 */

import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { MASTER_PATHS } from '../functions/src/utils/masterPaths';
import { applyLimit, assertExpectedCount, ExpectedCountMismatchError } from './lib/driveExportBackfillHelpers';
import { formatCountRecord } from './lib/confirmOnVerifyBackfillHelpers';
import {
  SKIP_REASONS,
  buildCustomerIdLinkManifest,
  buildMasterIndex,
  classifyCustomerIdLink,
  computeCustomerIdRollbackInstruction,
  isRollbackEligibleByUpdateTime,
  isValidCustomerIdLinkManifest,
  type CustomerIdBefore,
  type CustomerIdLinkManifestEntry,
  type SkipReason,
} from './lib/customerIdLinkBackfillHelpers';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID 環境変数を設定してください');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');

/** backfill-confirm-on-verify.tsと同じ規約: 値省略/別フラグとの衝突を誤操作として弾く。 */
function getArg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  const value = process.argv[i + 1];
  if (value === undefined || value.startsWith('--')) {
    console.error(`${name} には値を指定してください(値が省略されているか、別のフラグと衝突しています)`);
    process.exit(1);
  }
  return value;
}

function getIntArg(name: string): number | undefined {
  const raw = getArg(name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    console.error(`${name} には0以上の整数を指定してください(受け取った値: "${raw}")`);
    process.exit(1);
  }
  return n;
}

const limit = getIntArg('--limit');
const expectedCount = getIntArg('--expected-count');
const manifestOutPath = getArg('--manifest-out');
const rollbackManifestPath = getArg('--rollback');

admin.initializeApp({ projectId });
const db = admin.firestore();

const PAGE_SIZE = 200;

interface LinkTarget {
  ref: FirebaseFirestore.DocumentReference;
  id: string;
  updateTime: FirebaseFirestore.Timestamp;
  masterId: string;
  before: CustomerIdBefore;
}

function emptySkipped(): Record<SkipReason, string[]> {
  return Object.fromEntries(SKIP_REASONS.map((r) => [r, [] as string[]])) as Record<SkipReason, string[]>;
}

async function loadMasterIndex() {
  const snap = await db.collection(MASTER_PATHS.customers).get();
  return buildMasterIndex(snap.docs.map((d) => ({ id: d.id, name: d.data().name })));
}

/** `verified==true`をdocumentId順にページングして分類する(必要な4フィールドだけ読む)。 */
async function scan(): Promise<{
  totalScanned: number;
  targets: LinkTarget[];
  skipped: Record<SkipReason, string[]>;
}> {
  const index = await loadMasterIndex();
  console.log(`顧客マスター: ${index.ids.size}件読込`);

  const targets: LinkTarget[] = [];
  const skipped = emptySkipped();
  let totalScanned = 0;
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  for (;;) {
    let query = db
      .collection('documents')
      .where('verified', '==', true)
      .orderBy(admin.firestore.FieldPath.documentId())
      .select('customerId', 'customerName', 'customerConfirmed', 'verified')
      .limit(PAGE_SIZE);
    if (lastDoc) query = query.startAfter(lastDoc);
    // eslint-disable-next-line no-await-in-loop
    const snap = await query.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      totalScanned++;
      const r = classifyCustomerIdLink(d.data(), index);
      if (r.kind === 'link') {
        targets.push({ ref: d.ref, id: d.id, updateTime: d.updateTime, masterId: r.masterId, before: r.before });
      } else if (r.kind === 'skip') {
        skipped[r.reason].push(d.id);
      }
    }
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE_SIZE) break;
  }
  return { totalScanned, targets, skipped };
}

function writeManifest(path: string | undefined, manifest: object): void {
  if (path) writeFileSync(path, JSON.stringify(manifest, null, 2));
}

async function runBackfill(): Promise<void> {
  console.log(`プロジェクト: ${projectId}`);
  console.log(`モード: ${dryRun ? 'DRY RUN(書込みなし)' : '実行'}`);
  if (limit !== undefined) console.log(`--limit: ${limit}`);
  if (expectedCount !== undefined) console.log(`--expected-count: ${expectedCount}`);
  console.log('---');

  const { totalScanned, targets: allTargets, skipped } = await scan();
  const targets = applyLimit(allTargets, limit);
  const runId = randomUUID();
  const timestamp = new Date().toISOString();
  const skippedCounts = Object.fromEntries(SKIP_REASONS.map((r) => [r, skipped[r].length]));

  console.log(`走査: verified書類${totalScanned}件`);
  console.log(`紐づけ対象: ${allTargets.length}件${limit !== undefined ? `(--limit適用後 ${targets.length}件)` : ''}`);
  console.log(`紐づけ前の状態: ${formatCountRecord(countBy(targets.map((t) => t.before.state)))}`);
  console.log(`対象外(理由別): ${formatCountRecord(skippedCounts)}`);

  // 書込み前に件数を照合する(dry-runでも実施。不一致なら書込みなしで中断)
  try {
    assertExpectedCount(targets.length, expectedCount);
  } catch (err) {
    if (err instanceof ExpectedCountMismatchError) {
      console.error(`ERROR: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const entries: CustomerIdLinkManifestEntry[] = [];
  const buildManifest = () =>
    buildCustomerIdLinkManifest({ runId, projectId: projectId as string, timestamp, dryRun, entries, skipped, totalScanned, scanIncomplete: false });

  if (dryRun) {
    writeManifest(manifestOutPath, buildManifest());
    console.log('DRY RUN: 書込みは行いませんでした');
    return;
  }

  let written = 0;
  let skippedPrecondition = 0;
  try {
    for (const t of targets) {
      try {
        // 読んだ時点から書込みまでの間に別の更新があれば、precondition不一致(code 9)でスキップする
        // eslint-disable-next-line no-await-in-loop
        const result = await t.ref.update({ customerId: t.masterId }, { lastUpdateTime: t.updateTime });
        entries.push({
          docId: t.id,
          customerIdBefore: t.before,
          customerIdAfter: t.masterId,
          backfillUpdateTime: { seconds: result.writeTime.seconds, nanoseconds: result.writeTime.nanoseconds },
        });
        written++;
      } catch (err) {
        if ((err as { code?: number }).code === 9) {
          skippedPrecondition++;
          console.log(`  スキップ(読取後に別の書込みが発生): ${t.id}`);
          continue;
        }
        throw err;
      }
    }
  } finally {
    // 途中で例外停止しても、それまでの書込み記録(rollbackの入力)を必ず出力する
    writeManifest(manifestOutPath, buildManifest());
  }
  console.log('---');
  console.log(`完了: 紐づけ${written}件 / 読取後に変更ありスキップ${skippedPrecondition}件`);
  if (manifestOutPath) console.log(`manifest: ${manifestOutPath}`);
}

function countBy(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

async function runRollback(manifestPath: string): Promise<void> {
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  // 手編集・別バージョン・部分破損したmanifestで誤ったrollbackをしないよう、構造を検証して不正なら書込みなしで中断する
  if (!isValidCustomerIdLinkManifest(parsed)) {
    console.error(`ERROR: manifestの構造が不正です(${manifestPath})。手編集・別バージョン・部分破損したJSONではないか確認してください。`);
    process.exit(1);
  }
  const manifest = parsed;
  console.log(`プロジェクト: ${projectId}`);
  console.log(`モード: ${dryRun ? 'DRY RUN(変更なし)' : '実行'}`);
  console.log(`rollback対象: runId=${manifest.runId}, entries=${manifest.entries.length}件`);
  if (manifest.projectId !== projectId) {
    console.error(`ERROR: manifestのprojectId(${manifest.projectId})と実行対象(${projectId})が一致しません。誤操作防止のため中断します。`);
    process.exit(1);
  }

  let reverted = 0;
  let skippedNotFound = 0;
  let skippedProgressed = 0;
  let skippedPrecondition = 0;
  for (const entry of manifest.entries) {
    const ref = db.doc(`documents/${entry.docId}`);
    // eslint-disable-next-line no-await-in-loop
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`  スキップ(doc不在、要調査): ${entry.docId}`);
      skippedNotFound++;
      continue;
    }
    // 書込み直後のupdateTimeと完全一致する場合のみ戻す(その後に誰かが書いていれば触らない)
    if (!isRollbackEligibleByUpdateTime(entry, { seconds: snap.updateTime!.seconds, nanoseconds: snap.updateTime!.nanoseconds })) {
      console.log(`  スキップ(backfill以降に別の書込みが発生済み): ${entry.docId}`);
      skippedProgressed++;
      continue;
    }
    if (dryRun) {
      reverted++;
      continue;
    }
    const instruction = computeCustomerIdRollbackInstruction(entry);
    try {
      // eslint-disable-next-line no-await-in-loop
      await ref.update(
        { customerId: instruction.action === 'delete' ? admin.firestore.FieldValue.delete() : instruction.value },
        { lastUpdateTime: snap.updateTime! }
      );
      reverted++;
    } catch (err) {
      if ((err as { code?: number }).code === 9) {
        skippedPrecondition++;
        continue;
      }
      throw err;
    }
  }
  console.log('---');
  console.log(
    `${dryRun ? 'DRY RUN: 戻し対象' : '完了: 戻した'}${reverted}件 / doc不在${skippedNotFound}件 / 以降に変更あり${skippedProgressed}件 / 競合${skippedPrecondition}件`
  );
}

(rollbackManifestPath ? runRollback(rollbackManifestPath) : runBackfill())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
