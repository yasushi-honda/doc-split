#!/usr/bin/env ts-node
/**
 * Issue #811/#823 remediation Phase 2b: `classify-drive-export-drift.ts`(read-only)が
 * 検出した破損document(trashed/misplaced/blocked:target-path-not-created)を、本番の
 * `executeDriveExport()`を対象docIdへ逐次直接呼び出すことで実際に修復する(read-write)。
 *
 * 新しいDrive操作ロジックは一切書かない。`exportDocument()`の既存フォールバック挙動
 * (404/trashed検知→現在の正しいフォルダへ再配置・再アップロード)をそのまま再利用する。
 *
 * 設計の全体像・アーキテクチャ決定(D1〜D10)・plan-crossreview(grip自白+codex 2巡)の
 * 反映内容は `~/.claude/plans/sharded-mapping-squid.md` を参照。
 *
 * plan JSONは`classify-drive-export-drift.ts --out <path>`が出力したものをそのまま使う。
 * このスクリプトはplan JSONを「対象docId候補リスト」としてのみ使い、修復対象の実際の状態
 * (driveFileId/parents/trashed/modifiedTime等)はexecute直前に必ずFirestore/Driveを
 * 再読込して取得する(classify時点のスナップショットを信頼しない、plan-crossreview D8/D9)。
 *
 * 既定はdry-run(書き込みゼロ)。本番への書き込みには--executeが必須。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone STORAGE_BUCKET=docsplit-kanameone.firebasestorage.app \
 *     npx ts-node scripts/execute-drive-export-repair.ts --plan /tmp/plan.json --manifest-out /tmp/manifest.json
 *   (--execute を追加すると実際に書き込む。上記はdry-run)
 *
 * オプション:
 *   --plan <path>                     必須。classify-drive-export-drift.tsが出力したplan JSON
 *   --execute                         実際に書き込む(既定はdry-run)
 *   --limit <N>                       対象候補数の上限(安全弁)
 *   --expected-count <N>              --limit適用後の件数と突合(不一致なら書き込み前に中断)
 *   --expected-total <N>              --limit適用前の全候補件数と突合(誤ったplan・スコープ
 *                                      違いの取り違え検知、plan-crossreview H5)
 *   --manifest-out <path>             manifest JSONの出力先(既定: 自動生成ファイル名)
 *   --sleep-ms <N>                    doc毎のウェイト(既定250、Drive/Storage APIレート制限緩和)
 *   --max-consecutive-failures <N>    連続失敗でのサーキットブレーカー閾値(既定5)
 *   --max-total-failures <N>          累計失敗でのサーキットブレーカー閾値(既定20)
 *   --max-plan-age-hours <N>          plan鮮度ゲート(既定24時間、D10)
 *   --allow-stale-plan                D10のゲートを突破する(kanameone/cocoro本番のGitHub
 *                                      Actions実行では選択肢を用意しない運用で担保)
 *   --acknowledge-restore-folders     plan.wouldRestoreFoldersが非空の場合のみ必須(D7)
 */

import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { drive_v3 } from 'googleapis';
import type { Document } from '../shared/types';
import type { DriftPlan } from './classify-drive-export-drift';
import {
  DRIFT_PLAN_SCHEMA_VERSION,
  extractCandidateIds,
  summarizeExclusions,
  assertExpectedTotal,
  isPlanStale,
  isNowHealthy,
  shouldSkipForPossibleManualEdit,
  shouldTripCircuitBreaker,
  tagRepairError,
  emptyManifestSummary,
  type RepairManifest,
  type RepairManifestEntry,
} from './lib/driveExportRepairTargets';
import { applyLimit, assertExpectedCount } from './lib/driveExportBackfillHelpers';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID 環境変数を設定してください');
  process.exit(1);
}

const args = process.argv.slice(2);
let planPath: string | undefined;
let execute = false;
let limit: number | undefined;
let expectedCount: number | undefined;
let expectedTotal: number | undefined;
let manifestOutPath: string | undefined;
let dryRunFlagSeen = false;
let sleepMs = 250;
let maxConsecutiveFailures = 5;
let maxTotalFailures = 20;
let maxPlanAgeHours = 24;
let allowStalePlan = false;
let acknowledgeRestoreFolders = false;

function requireValue(flag: string, index: number): string {
  const value = args[index + 1];
  if (value === undefined) {
    console.error(`${flag} には値を指定してください(値が省略されています)`);
    process.exit(1);
  }
  return value;
}
function requireNonNegativeIntValue(flag: string, index: number): number {
  const raw = requireValue(flag, index);
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    console.error(`${flag} には非負整数を指定してください(受け取った値: "${raw}")`);
    process.exit(1);
  }
  return parsed;
}

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--plan') {
    planPath = requireValue('--plan', i);
    i++;
  } else if (args[i] === '--execute') {
    execute = true;
  } else if (args[i] === '--dry-run') {
    // 既定がdry-runのためno-op(明示的に意図を示したい呼び出し元のための許容フラグ、
    // backfill-drive-export.ts等の既存スクリプトの慣習と表記を揃える)。
    dryRunFlagSeen = true;
  } else if (args[i] === '--limit') {
    limit = requireNonNegativeIntValue('--limit', i);
    i++;
  } else if (args[i] === '--expected-count') {
    expectedCount = requireNonNegativeIntValue('--expected-count', i);
    i++;
  } else if (args[i] === '--expected-total') {
    expectedTotal = requireNonNegativeIntValue('--expected-total', i);
    i++;
  } else if (args[i] === '--manifest-out') {
    manifestOutPath = requireValue('--manifest-out', i);
    i++;
  } else if (args[i] === '--sleep-ms') {
    sleepMs = requireNonNegativeIntValue('--sleep-ms', i);
    i++;
  } else if (args[i] === '--max-consecutive-failures') {
    maxConsecutiveFailures = requireNonNegativeIntValue('--max-consecutive-failures', i);
    i++;
  } else if (args[i] === '--max-total-failures') {
    maxTotalFailures = requireNonNegativeIntValue('--max-total-failures', i);
    i++;
  } else if (args[i] === '--max-plan-age-hours') {
    maxPlanAgeHours = requireNonNegativeIntValue('--max-plan-age-hours', i);
    i++;
  } else if (args[i] === '--allow-stale-plan') {
    allowStalePlan = true;
  } else if (args[i] === '--acknowledge-restore-folders') {
    acknowledgeRestoreFolders = true;
  } else {
    console.error(`未知の引数です: "${args[i]}"(タイポの可能性があります。ヘッダーコメントの使用方法を参照してください)`);
    process.exit(1);
  }
}

if (dryRunFlagSeen && execute) {
  console.error('--dry-run と --execute は同時に指定できません(引数の順序に関わらず矛盾はエラーにします)');
  process.exit(1);
}
if (!planPath) {
  console.error('--plan <path> を指定してください(classify-drive-export-drift.tsが出力したplan JSON)');
  process.exit(1);
}
if (!existsSync(planPath)) {
  console.error(`指定されたplanファイルが存在しません: ${planPath}`);
  process.exit(1);
}

const storageBucket = process.env.STORAGE_BUCKET;
if (!storageBucket) {
  console.error(
    'STORAGE_BUCKET 環境変数を設定してください(scripts/clients/<env>.env のSTORAGE_BUCKET参照。' +
      '修復対象の全カテゴリ(trashed/misplaced/target-path-not-created)がexportDocument()内部で' +
      'Storageからのダウンロードを伴うため、classify-drive-export-drift.tsと異なり' +
      '--skip-storage-check相当のオプションは存在しない)'
  );
  process.exit(1);
}

admin.initializeApp({ projectId, storageBucket });
const db = admin.firestore();

const runId = randomUUID();
const manifestPath = manifestOutPath ?? `execute-drive-export-repair-manifest-${runId}.json`;

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 一時ファイル書き出し→renameによる原子的な書き込み(codex High由来Medium#8: 通常の
 * writeFileSyncの直接上書きは、書き込み途中でプロセスが強制終了した場合に壊れたJSONを
 * 残しうる。同一ファイルシステム内のrenameSyncはPOSIX上atomicなため、クラッシュしても
 * 「直前の完全な内容」か「新しい完全な内容」のいずれかが必ず残る)。
 */
function writeManifestAtomic(manifest: RepairManifest): void {
  const tmpPath = `${manifestPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), 'utf8');
  renameSync(tmpPath, manifestPath);
}

async function main(): Promise<void> {
  // admin.initializeApp()より前に静的importするとFirebaseAppError(no-app)になるため動的import。
  const { getDriveClient } = await import('../functions/src/utils/driveAuth');

  const rawPlan = readFileSync(planPath as string, 'utf8');
  const plan = JSON.parse(rawPlan) as DriftPlan;

  console.log(`プロジェクト: ${projectId}`);
  console.log(`plan: ${planPath} (planId=${plan.planId}, generatedAt=${plan.generatedAt})`);
  console.log(`モード: ${execute ? '実行(--execute)' : 'dry-run(既定、書き込みなし)'}`);
  console.log('---');

  // 起動時ゲート1: schemaVersion確認
  if (plan.schemaVersion !== DRIFT_PLAN_SCHEMA_VERSION) {
    console.error(
      `plan.schemaVersion が不一致です(期待値: ${DRIFT_PLAN_SCHEMA_VERSION}, 実際: ${plan.schemaVersion})。` +
        `classify-drive-export-drift.tsのバージョンが異なる可能性があります。`
    );
    process.exit(1);
  }

  // 起動時ゲート2: projectId一致確認(fail-closed、誤ったplanの誤適用事故を防ぐ)
  if (plan.projectId !== projectId) {
    console.error(
      `plan.projectId(${plan.projectId})とFIREBASE_PROJECT_ID(${projectId})が一致しません。` +
        `別環境のplanを誤って指定していないか確認してください。`
    );
    process.exit(1);
  }

  // 起動時ゲート3(D10): plan鮮度
  if (execute && isPlanStale(plan.generatedAt, Date.now(), maxPlanAgeHours) && !allowStalePlan) {
    console.error(
      `plan.generatedAt(${plan.generatedAt})が --max-plan-age-hours ${maxPlanAgeHours}時間を超過しています。` +
        `classify-drive-export-drift.tsを再実行して最新のplanを取得するか、意図的に古いplanを使う場合は` +
        `--allow-stale-plan を指定してください(kanameone/cocoro本番運用では非推奨)。`
    );
    process.exit(1);
  }

  // 起動時ゲート4(D7): ゴミ箱フォルダ復元の承認。
  // 注意: これはclassify時点で判明している範囲の事前警告に過ぎない。findOrCreateFolder()の
  // trashed復元は本番コード側で無条件(本スクリプトは変更しない)のため、classify実行後に
  // 新たにtrashedになったフォルダはこのゲートでは検知できない(plan-crossreview反映)。
  if (plan.wouldRestoreFolders.length > 0) {
    console.log(`⚠️  修復実行時にゴミ箱から復元されうるフォルダ(classify時点で判明分): ${plan.wouldRestoreFolders.length}件`);
    for (const f of plan.wouldRestoreFolders) {
      console.log(`  folderId=${f.folderId} name="${f.name}" 影響document数=${f.affectedDocCount}`);
    }
    if (execute && !acknowledgeRestoreFolders) {
      console.error(
        '上記フォルダの復元を承認する場合は --acknowledge-restore-folders を指定してください。' +
          '(これはclassify時点のスナップショットに基づく事前警告であり、実行時点の完全な保証ではありません)'
      );
      process.exit(1);
    }
  }

  // 対象抽出(D3)
  const candidateIdsAll = extractCandidateIds(plan);
  console.log(`候補件数(絞り込み前): ${candidateIdsAll.length}件`);
  const exclusions = summarizeExclusions(plan);
  console.log(
    `除外内訳(候補抽出の時点でfail-closed除外): healthy=${exclusions.healthy} ` +
      `unresolvedPath(ambiguous/api-error)=${exclusions.unresolvedPath} ` +
      `storageNotConfirmed(false/null)=${exclusions.storageNotConfirmed} ` +
      `otherBlockedReasons=${exclusions.otherBlockedReasons}`
  );
  assertExpectedTotal(candidateIdsAll.length, expectedTotal);

  const candidateIds = applyLimit(candidateIdsAll, limit);
  if (limit !== undefined) {
    console.log(`⚠️  --limit ${limit}: 候補を先頭${limit}件に制限します`);
  }
  assertExpectedCount(candidateIds.length, expectedCount);
  console.log(`実行対象候補件数(limit適用後): ${candidateIds.length}件`);
  console.log('---');

  if (!execute) {
    // dry-run: 内訳を表示して終了(書き込みは一切行わない)。
    const targetsById = new Map(plan.targets.map((t) => [t.docId, t] as const));
    const categoryCounts = new Map<string, number>();
    for (const docId of candidateIds) {
      const t = targetsById.get(docId);
      const label = t ? t.category : 'blocked:target-path-not-created';
      categoryCounts.set(label, (categoryCounts.get(label) ?? 0) + 1);
    }
    console.log('カテゴリ内訳:');
    for (const [label, count] of categoryCounts) {
      console.log(`  ${label}: ${count}件`);
    }
    console.log('先頭10件の例:');
    for (const docId of candidateIds.slice(0, 10)) {
      console.log(`  ${docId}`);
    }
    console.log('---');
    console.log('dry-run完了(書き込みなし)。実際に修復するには --execute を指定してください。');
    process.exit(0);
  }

  const manifest: RepairManifest = {
    schemaVersion: 'drive-export-repair-manifest-v1',
    runId,
    planId: plan.planId,
    projectId,
    mode: 'execute',
    generatedAt: new Date().toISOString(),
    summary: emptyManifestSummary(),
    entries: [],
  };
  writeManifestAtomic(manifest);

  // 候補が0件ならDrive認証自体を行わない(全ゲート通過を候補0件のplanで検証する
  // integration testを、実Drive認証なしで完結させるための効率化でもある)。
  if (candidateIds.length === 0) {
    console.log('実行対象候補が0件のため、何も行わずに終了します。');
    console.log(`manifest: ${manifestPath}`);
    process.exit(0);
  }

  const drive: drive_v3.Drive = await getDriveClient();
  const { executeDriveExport } = await import('../functions/src/drive/executeDriveExport');
  const MANUAL_EDIT_THRESHOLD_MS = 5 * 60 * 1000; // 5分(D9、codex High#1)

  let consecutiveFailures = 0;

  for (let i = 0; i < candidateIds.length; i++) {
    const docId = candidateIds[i];
    const startedAt = Date.now();

    const entry: RepairManifestEntry = { docId, category: 'trashed', phase: 'intent' };

    try {
      // pre-flight ①: Firestore再読込(D9、D8)。classify時点の値ではなく実行直前の値を使う。
      const snap = await db.doc(`documents/${docId}`).get();
      if (!snap.exists) {
        entry.finalStatus = 'skipped';
        entry.skipReason = 'drift-status-changed';
        manifest.summary.skippedDrift++;
        manifest.entries.push(entry);
        writeManifestAtomic(manifest);
        continue;
      }
      const doc = snap.data() as Document;
      const planTarget = plan.targets.find((t) => t.docId === docId);
      entry.category =
        plan.blocked.find((b) => b.docId === docId) !== undefined
          ? 'blocked-target-path-not-created'
          : (planTarget?.category ?? 'trashed');
      // blocked[target-path-not-created]由来はexpectedLeafFolderIdを持たない(classify時点で
      // 期待パス自体が未解決)ため、isNowHealthy()には常にundefinedを渡す(下記④で常にfalseに
      // なり、この設計上の理由により本カテゴリのみdriftの再検証をスキップする)。
      const expectedLeafFolderId = planTarget?.expectedLeafFolderId;

      if (doc.driveExportStatus !== 'exported') {
        entry.finalStatus = 'skipped';
        entry.skipReason = 'drift-status-changed';
        manifest.summary.skippedDrift++;
        manifest.entries.push(entry);
        writeManifestAtomic(manifest);
        continue;
      }

      // pre-flight ②(codex review指摘、execute-drive-export-repair実装後の3回目レビュー):
      // blocked[target-path-not-created]由来の候補は、classify-drive-export-drift.ts側で
      // blocked分岐がStorage確認より前にreturn/continueするため、storageObjectExistsが
      // 一度も計算されていない(targets由来の候補は既にD3抽出で`storageObjectExists===true`を
      // 要求済みだが、blocked由来はそのガードを経ていなかった)。exportDocument()は
      // カテゴリに関わらずStorageからのダウンロードを要するため、ここで自前に確認する。
      if (entry.category === 'blocked-target-path-not-created') {
        const bucket = admin.storage().bucket();
        const expectedPrefix = `gs://${bucket.name}/`;
        let storageConfirmed = false;
        if (typeof doc.fileUrl === 'string' && doc.fileUrl.startsWith(expectedPrefix)) {
          try {
            const filePath = doc.fileUrl.slice(expectedPrefix.length);
            const [exists] = await bucket.file(filePath).exists();
            storageConfirmed = exists;
          } catch (err) {
            console.log(`  ⚠️  docId=${docId}: pre-flightのStorage確認に失敗(スキップ扱い): ${(err as Error).message}`);
          }
        }
        if (!storageConfirmed) {
          entry.finalStatus = 'skipped';
          entry.skipReason = 'storage-not-confirmed';
          manifest.summary.skippedStorageNotConfirmed++;
          manifest.entries.push(entry);
          writeManifestAtomic(manifest);
          continue;
        }
      }

      // pre-flight ③: Drive側modifiedTimeとの比較(D9、codex High#1)。
      let oldParents: string[] | undefined;
      let oldFileTrashed: boolean | undefined;
      let oldModifiedTime: string | undefined;
      if (doc.driveFileId) {
        try {
          const res = await drive.files.get({
            fileId: doc.driveFileId,
            fields: 'parents,trashed,modifiedTime',
            supportsAllDrives: true,
          });
          oldParents = res.data.parents ?? undefined;
          oldFileTrashed = !!res.data.trashed;
          oldModifiedTime = res.data.modifiedTime ?? undefined;

          // pre-flight ④(codex review、execute-drive-export-repair実装後の4回目レビュー):
          // classify〜execute間に対象documentが別経路(通常のdocument編集による再export等)で
          // 既に修復済み(healthy)になっている場合、driveExportStatusは'exported'のまま
          // 変化しないため上のpre-flight①では検知できない。live状態がplan記録時のdrift
          // カテゴリと一致するかを、ここで初めて取得できるDrive側の実データ(parents/trashed)
          // を使って再検証する。既にhealthyならexecuteDriveExport()を呼ばずスキップする
          // (無駄なStorage再アップロード・親フォルダ再設定・modifiedTime変化を避ける)。
          if (isNowHealthy(oldFileTrashed, oldParents, expectedLeafFolderId)) {
            entry.oldDriveFileId = doc.driveFileId;
            entry.oldParents = oldParents;
            entry.oldFileTrashed = oldFileTrashed;
            entry.oldModifiedTime = oldModifiedTime;
            entry.finalStatus = 'skipped';
            entry.skipReason = 'drift-status-changed';
            manifest.summary.skippedDrift++;
            manifest.entries.push(entry);
            writeManifestAtomic(manifest);
            console.log(`  ℹ️  docId=${docId}: Drive側が既にplan記録時の期待配置(healthy)と一致しているためスキップ`);
            continue;
          }

          const driveExportedAtMs = doc.driveExportedAt ? doc.driveExportedAt.toMillis() : undefined;
          const modifiedTimeMs = oldModifiedTime ? new Date(oldModifiedTime).getTime() : undefined;
          if (shouldSkipForPossibleManualEdit(driveExportedAtMs, modifiedTimeMs, MANUAL_EDIT_THRESHOLD_MS)) {
            entry.oldDriveFileId = doc.driveFileId;
            entry.oldParents = oldParents;
            entry.oldFileTrashed = oldFileTrashed;
            entry.oldModifiedTime = oldModifiedTime;
            entry.finalStatus = 'skipped';
            entry.skipReason = 'possible-manual-edit';
            manifest.summary.skippedPossibleManualEdit++;
            manifest.entries.push(entry);
            writeManifestAtomic(manifest);
            console.log(`  ⚠️  docId=${docId}: Drive側modifiedTimeがdriveExportedAtより新しいため、手編集の可能性ありとしてスキップ`);
            continue;
          }
        } catch (err) {
          // files.get自体の失敗(404/権限等)は、修復自体を妨げない
          // (executeDriveExport()内部のresolveDriveFile()が同種のエラーを正規のフローで処理する)。
          console.log(`  ⚠️  docId=${docId}: pre-flightのfiles.get()に失敗(処理は継続): ${(err as Error).message}`);
        }
      }

      entry.oldDriveFileId = doc.driveFileId ?? undefined;
      entry.oldParents = oldParents;
      entry.oldFileTrashed = oldFileTrashed;
      entry.oldModifiedTime = oldModifiedTime;

      // intent行を先に書き出す(M3、クラッシュ耐性)。
      manifest.entries.push(entry);
      writeManifestAtomic(manifest);

      let claimed: boolean;
      try {
        claimed = await executeDriveExport(db, docId, { drive }, 'exported');
      } catch (err) {
        claimed = false;
        entry.finalStatus = 'failed';
        entry.error = (err as Error).message;
        consecutiveFailures++;
        manifest.summary.failed++;
        entry.phase = 'result';
        writeManifestAtomic(manifest);
        if (shouldTripCircuitBreaker(consecutiveFailures, manifest.summary.failed, maxConsecutiveFailures, maxTotalFailures)) {
          manifest.summary.abortedByCircuitBreaker = true;
          writeManifestAtomic(manifest);
          console.error(`サーキットブレーカー: 連続失敗${consecutiveFailures}件または累計失敗${manifest.summary.failed}件に到達したため中断します。`);
          process.exit(1);
        }
        await sleep(sleepMs);
        continue;
      }

      if (!claimed) {
        entry.finalStatus = 'skipped';
        entry.skipReason = 'drift-status-changed';
        entry.phase = 'result';
        manifest.summary.skippedDrift++;
        writeManifestAtomic(manifest);
        await sleep(sleepMs);
        continue;
      }

      // claim成功後、Firestoreを再読込して成否判定する(executeDriveExport()は内部でエラーを
      // catchしdriveExportStatus:'error'を書いてtrueを返すため、throwしない=成否は再読込必須)。
      const finalSnap = await db.doc(`documents/${docId}`).get();
      const finalData = finalSnap.data() as Document | undefined;
      manifest.summary.attempted++;
      entry.phase = 'result';
      entry.durationMs = Date.now() - startedAt;

      if (finalData?.driveExportStatus === 'exported') {
        entry.finalStatus = 'repaired';
        entry.newDriveFileId = finalData.driveFileId ?? undefined;
        consecutiveFailures = 0;
        manifest.summary.repaired++;
      } else {
        entry.finalStatus = 'failed';
        const taggedError = tagRepairError(runId, finalData?.driveExportError ?? '(driveExportErrorなし)');
        entry.error = taggedError;
        consecutiveFailures++;
        manifest.summary.failed++;

        // codex review(execute-repair実装後の初回レビュー)P2指摘: manifestへtagRepairError()の
        // 結果を記録するだけでは、Firestore上のdriveExportError自体は`executeDriveExport()`が
        // 書いた無印のメッセージのままで、`drive-export-status-report`等が「repair実行由来の
        // 失敗かどうか」を区別できない(R6/codex High#3の設計意図が実現されていなかった)。
        // 注意: `driveExportRunId`は本スクリプトの`runId`ではなく、executeDriveExport()が
        // 呼び出しの都度内部で生成するUUIDである(functions/src/drive/executeDriveExport.ts
        // 確認済み)。このスクリプト側からは値を知りえないため、直前に再読込したfinalData自身の
        // driveExportRunId(=このexecuteDriveExport()呼び出しが書いた値)を期待値として使い、
        // 他の実行(通常のsweep等)に横取りされていないことを確認してから上書きする
        // (exportDocument()自体のsupersededチェックと同じ作法)。
        const expectedRunId = finalData?.driveExportRunId;
        if (expectedRunId) {
          await db.runTransaction(async (tx) => {
            const ref = db.doc(`documents/${docId}`);
            const snap = await tx.get(ref);
            if (!snap.exists || (snap.data() as Document | undefined)?.driveExportRunId !== expectedRunId) {
              return; // 他の実行に引き継がれている → 上書きしない
            }
            tx.update(ref, { driveExportError: taggedError });
          });
        }
      }
      writeManifestAtomic(manifest);

      if (entry.finalStatus === 'failed') {
        if (shouldTripCircuitBreaker(consecutiveFailures, manifest.summary.failed, maxConsecutiveFailures, maxTotalFailures)) {
          manifest.summary.abortedByCircuitBreaker = true;
          writeManifestAtomic(manifest);
          console.error(`サーキットブレーカー: 連続失敗${consecutiveFailures}件または累計失敗${manifest.summary.failed}件に到達したため中断します。`);
          console.error('中断してもmanifestは保存済みで、既に成功した分はロールバックされません。');
          console.error(
            '注意: 中断後も失敗したdocumentはdriveExportStatus:\'error\'のままであり、本番の15分毎スイープが' +
              '約1時間後から自動的に拾って再試行し続けます(このスクリプトの中断=完全停止ではありません)。'
          );
          process.exit(1);
        }
      }
    } finally {
      if ((i + 1) % 25 === 0) {
        console.log(`  進捗: ${i + 1}/${candidateIds.length}件処理済み`);
      }
      await sleep(sleepMs);
    }
  }

  console.log('---');
  console.log(
    `結果: attempted=${manifest.summary.attempted} repaired=${manifest.summary.repaired} failed=${manifest.summary.failed} ` +
      `skippedDrift=${manifest.summary.skippedDrift} skippedPossibleManualEdit=${manifest.summary.skippedPossibleManualEdit} ` +
      `skippedStorageNotConfirmed=${manifest.summary.skippedStorageNotConfirmed}`
  );
  console.log(`manifest: ${manifestPath}`);
  console.log('完了。失敗分は本番スイープが後日自動再試行します(このスクリプトによる直接のリトライは行いません)。');
  process.exit(0);
}

main().catch((err) => {
  console.error('エラー:', err);
  process.exit(1);
});
