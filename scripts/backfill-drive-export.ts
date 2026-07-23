#!/usr/bin/env ts-node
/**
 * Google Drive エクスポート バックフィルスクリプト(ADR-0022 Phase 1、code-review指摘#43対応)
 *
 * Feature Flag(`settings/features.driveExport`)がOFFの間にverifiedされたdocumentは、
 * `functions/src/drive/driveExportTrigger.ts`が早期return(完全no-op)するため
 * `driveExportStatus`フィールド自体が一切書き込まれない。フラグをONにした後も、この
 * 「フィールド不在」のdocumentはトリガー(verified false→trueのrising edge検知のみ)にも
 * 定期スイープ(`driveExportScheduled.ts`、`driveExportStatus in ['error','exporting']`
 * のみが対象)にも一生乗らない — cocoro/kanameoneが「既存の確認済み書類を後から
 * Driveへ遡及エクスポートしたい」という本機能導入の主動機に直結する既知の穴。
 *
 * 本スクリプトはこの「バックフィル対象」docを見つけ、`driveExportStatus:'error'`を
 * 一時的にセットする。実際のDrive API呼び出し・Secret Manager アクセス・フォルダ解決等は
 * 本スクリプトでは一切行わない — 次回の定期スイープ(`driveExportScheduled.ts`、15分毎)が
 * error状態のdocを拾い、Cloud Functions内(Drive API/Secret Manager等への正規のアクセス権を
 * 持つ実行環境)で実際のエクスポートを行う。`updatedAt`を意図的にバックデートすることで、
 * 通常のエラーリトライ用1時間cooldown(直近の失敗を連続リトライしないためのガード)を
 * 待たず、次回のスイープ(最大15分後)で即座に拾われるようにする。
 *
 * 新規Cloud Function(onCall)は作らない設計方針(decision-maker確認済み、2026-07-22):
 * `scripts/fix-stuck-documents.js`等の既存の管理スクリプト慣習(--dry-run対応、
 * GitHub Actionsの"Run Operations Script"経由でも実行可能)に倣う。
 *
 * ## Phase D/E再設計(2026-07-23、Codex High指摘#2/#4対応)
 *
 * kanameone(876件)/cocoro(93件)への本番展開に向け、以下をcanary安全に対応:
 * - `--limit`/`--expected-count`/`--manifest-out`: 段階的実行(canary→全量)と誤操作防止
 * - `--rollback <manifest>`: backfillが一時的にセットした'error'マーカーの選択的復帰
 * - race修正: 従来の無条件`batch.update`を、各docの`updateTime`を`lastUpdateTime`
 *   precondition として使う個別`update()`に置換。通常の確認操作(driveExportTrigger等)が
 *   read→write間に同一docへ書込むと`FAILED_PRECONDITION`(code 9)でスキップ・ログ出力し、
 *   相手の状態を上書きしない(Codex High指摘#4「通常操作とbackfillの競合」対応)。
 *   **重要**: precondition には Firestore の`Timestamp`オブジェクトをそのまま渡すこと。
 *   ISO文字列等へ変換して往復させると`updateTime`のnanosecond精度が失われ、precondition
 *   が常に不一致になり全書込みが無言で失敗する(pr-d4-backfillの実装で確認済みの罠)。
 *
 * `/code-review high`指摘対応(2026-07-23): ①`--limit`/`--expected-count`の値省略時に
 * サイレントに「フラグ未指定」扱いになり誤操作(無制限に全件処理)につながるバグを
 * 修正(値省略/別フラグとの衝突を検出しエラー終了) ②`markAsBackfillTarget()`/rollbackの
 * Partial Updateについて「更新対象外フィールドが変化しないこと」を
 * `backfill-drive-export.integration.test.ts`(Firestore emulator)で検証(CLAUDE.md MUST)
 * ③rollbackの「doc不在」と「進行済みでrollback対象外」を別カウンタに分離 ④`--limit`指定時
 * は候補がその件数に達した時点でページングを打ち切り、`--limit`未満の残り全件を無駄に
 * 走査しない(canary実行のFirestore読取コスト削減)。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=doc-split-dev npx ts-node scripts/backfill-drive-export.ts --dry-run
 *   FIREBASE_PROJECT_ID=doc-split-dev npx ts-node scripts/backfill-drive-export.ts
 *   FIREBASE_PROJECT_ID=doc-split-dev npx ts-node scripts/backfill-drive-export.ts \
 *     --limit 5 --expected-count 5 --manifest-out /tmp/canary-manifest.json
 *   FIREBASE_PROJECT_ID=doc-split-dev npx ts-node scripts/backfill-drive-export.ts \
 *     --rollback /tmp/canary-manifest.json --dry-run
 *
 * オプション:
 *   --dry-run             書込みを行わず対象件数・docIdをプレビュー
 *   --limit N              マーク対象を先頭からN件に制限(canary実行用)
 *   --expected-count N     対象件数がNと一致することを書込み前にアサート(誤操作防止)
 *   --manifest-out <path>  マークしたdocIdをJSONで出力(runId/projectId/timestamp付き)
 *   --rollback <manifest>  manifestに記載のdocIdのうち、まだbackfillのerrorマーカーの
 *                          ままのものだけをfield-absentへ復帰する(選択的rollback)
 */

import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import { writeFileSync, readFileSync } from 'node:fs';
import {
  BACKFILL_ERROR_MESSAGE,
  isBackfillCandidate,
  isRollbackCandidate,
  computeBackdatedUpdatedAtMs,
  applyLimit,
  assertExpectedCount,
  ExpectedCountMismatchError,
  buildManifest,
  estimateSweepEta,
  type BackfillManifest,
} from './lib/driveExportBackfillHelpers';

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID 環境変数を設定してください');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');

/**
 * 値を取る引数を取得する。フラグ自体は指定されているが値が省略されている場合
 * (末尾に置かれた、または値の代わりに別の`--`フラグが続いている)は、「フラグ
 * 未指定」と区別がつかなくなり誤操作(例: `--limit`の値が欠落し無制限で全件が
 * 対象になる)につながるため、明示的にエラー終了する(code-review high指摘#1対応)。
 */
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

/**
 * `functions/src/drive/driveExportScheduled.ts`の`DRIVE_EXPORT_ERROR_RETRY_THRESHOLD_MS`
 * (1時間)と同じ値。`functions/src`配下のモジュールをそのままimportしない理由: それらは
 * `admin.firestore()`等のモジュールレベル副作用を持ち、TypeScriptのimportは常にファイル
 * 先頭へhoistされるため、本スクリプトの`admin.initializeApp()`より先に評価されて
 * "The default Firebase app does not exist" 等のエラーで壊れる(`scripts/`から
 * `functions/src`を安全にimportできるのは副作用のない純粋関数モジュールのみ、
 * 既存の`backfill-detail-subcollection.ts`の`ocrExcerpt.ts` import等が前例)。
 * 値を変更する場合は両方揃えること。
 */
const ERROR_RETRY_THRESHOLD_MS = 60 * 60 * 1000;
/** 次回スイープ(最大15分後)で確実に拾われるためのバッファ(閾値ちょうどの境界値レースを避ける)。 */
const BACKFILL_BACKDATE_BUFFER_MS = 5 * 60 * 1000;

/** 定期スイープ側の1回あたり再エンキュー上限(DRIVE_EXPORT_SCHEDULED_BATCH_SIZE)と同じ値。 */
const SWEEP_BATCH_SIZE = 10;
const SWEEP_INTERVAL_MINUTES = 15;

interface Candidate {
  ref: FirebaseFirestore.DocumentReference;
  id: string;
  fileName: string;
  updateTime: FirebaseFirestore.Timestamp;
}

/**
 * `verified==true`をページングし、backfill候補(driveExportStatusフィールド不在)を集める。
 * `stopAt`(--limitの値)が指定されている場合、候補がその件数に達した時点でページングを
 * 打ち切る(canary実行(`--limit`小規模指定)で、対象外の残り大多数まで走査するコストを
 * 避けるため。code-review high指摘#4対応)。打ち切った場合`scanIncomplete:true`を返し、
 * `totalScanned`/`candidates.length`はその時点までの部分値であることを呼び出し元に伝える。
 */
async function collectCandidates(
  stopAt: number | undefined
): Promise<{ totalScanned: number; candidates: Candidate[]; scanIncomplete: boolean }> {
  let totalScanned = 0;
  const candidates: Candidate[] = [];
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let hasMore = true;

  while (hasMore) {
    let query = db
      .collection('documents')
      .where('verified', '==', true)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) {
      hasMore = false;
      break;
    }

    for (const docSnap of snapshot.docs) {
      totalScanned++;
      const data = docSnap.data();
      if (isBackfillCandidate(data)) {
        candidates.push({
          ref: docSnap.ref,
          id: docSnap.id,
          fileName: (data.fileName as string) || '(no name)',
          updateTime: docSnap.updateTime,
        });
        if (stopAt !== undefined && candidates.length >= stopAt) {
          return { totalScanned, candidates, scanIncomplete: true };
        }
      }
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    hasMore = snapshot.docs.length === PAGE_SIZE;
  }

  return { totalScanned, candidates, scanIncomplete: false };
}

/**
 * 個別`update()` + `lastUpdateTime`precondition でrace-freeに書込む(Codex High指摘#4対応)。
 * precondition不一致(通常操作が並行して同docへ書込んだ等)はFAILED_PRECONDITION(code 9)
 * として検出しskip、元の状態を上書きしない。
 */
async function markAsBackfillTarget(
  candidate: Candidate,
  backdatedUpdatedAt: FirebaseFirestore.Timestamp
): Promise<'ok' | 'precondition-failed'> {
  try {
    await candidate.ref.update(
      {
        driveExportStatus: 'error',
        driveExportError: BACKFILL_ERROR_MESSAGE,
        updatedAt: backdatedUpdatedAt,
      },
      { lastUpdateTime: candidate.updateTime }
    );
    return 'ok';
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 9) {
      console.log(`  スキップ(並行書込み検出、precondition不一致): ${candidate.id}`);
      return 'precondition-failed';
    }
    throw err;
  }
}

async function runBackfill(): Promise<void> {
  console.log(`プロジェクト: ${projectId}`);
  console.log(`モード: ${dryRun ? 'DRY RUN(変更なし)' : '実行'}`);
  if (limit !== undefined) console.log(`--limit: ${limit}`);
  if (expectedCount !== undefined) console.log(`--expected-count: ${expectedCount}`);
  console.log('---');

  const { totalScanned, candidates, scanIncomplete } = await collectCandidates(limit);
  const targets = applyLimit(candidates, limit);

  if (scanIncomplete) {
    console.log(`検査: ${totalScanned}件走査時点で--limit(${limit})件に到達したためスキャンを打ち切り`);
    console.log(`バックフィル候補(打ち切り時点まで): ${candidates.length}件、--limit適用後の対象: ${targets.length}件`);
    console.log('  (--limitにより全件は走査していないため、残り件数・総候補数は不明)');
  } else {
    const totalAlreadyTracked = totalScanned - candidates.length;
    console.log(`検査: ${totalScanned}件 (verified=true)`);
    console.log(`スキップ(既にdriveExportStatus管理下): ${totalAlreadyTracked}件`);
    console.log(`バックフィル候補: ${candidates.length}件`);
    if (limit !== undefined && targets.length < candidates.length) {
      console.log(`--limit適用後の対象: ${targets.length}件(残り${candidates.length - targets.length}件は今回対象外)`);
    }
  }
  for (const c of targets) {
    console.log(`  対象: ${c.id} [${c.fileName}]`);
  }

  // 書込み前にアサート(部分書込み後のabortを防ぐ、Codex High指摘#2対応)
  try {
    assertExpectedCount(targets.length, expectedCount);
  } catch (err) {
    if (err instanceof ExpectedCountMismatchError) {
      console.error(`\nERROR: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  if (dryRun) {
    console.log('\n--dry-run モードのため変更なし。実行するには --dry-run を外してください。');
    return;
  }

  const runId = randomUUID();
  const backdatedUpdatedAt = admin.firestore.Timestamp.fromMillis(
    computeBackdatedUpdatedAtMs(Date.now(), ERROR_RETRY_THRESHOLD_MS, BACKFILL_BACKDATE_BUFFER_MS)
  );

  const marked: string[] = [];
  let preconditionFailedCount = 0;
  for (const candidate of targets) {
    // eslint-disable-next-line no-await-in-loop
    const result = await markAsBackfillTarget(candidate, backdatedUpdatedAt);
    if (result === 'ok') {
      marked.push(candidate.id);
    } else {
      preconditionFailedCount++;
    }
  }

  console.log(`\n--- 結果 ---`);
  console.log(`マーク成功: ${marked.length}件`);
  if (preconditionFailedCount > 0) {
    console.log(`並行書込みによりスキップ: ${preconditionFailedCount}件`);
  }

  if (manifestOutPath) {
    const manifest: BackfillManifest = buildManifest({
      runId,
      projectId: projectId as string,
      timestampIso: new Date().toISOString(),
      docIds: marked,
    });
    writeFileSync(manifestOutPath, JSON.stringify(manifest, null, 2));
    console.log(`manifest出力: ${manifestOutPath} (runId=${runId})`);
  }

  if (marked.length > 0) {
    const eta = estimateSweepEta(marked.length, SWEEP_BATCH_SIZE, SWEEP_INTERVAL_MINUTES);
    console.log(
      `\n次回以降の定期スイープ(${SWEEP_INTERVAL_MINUTES}分毎・1回${SWEEP_BATCH_SIZE}件)で段階的に解消されます。` +
        `概算: 約${eta.estimatedRuns}回(${eta.estimatedMinutes}分 ≒ ${(eta.estimatedMinutes / 60).toFixed(1)}時間)で完了見込み。` +
        '進捗はFEの「エラー履歴」画面のDriveエクスポートエラータブで確認できます。'
    );
  }
}

/**
 * `--rollback <manifest>`: manifest記載のdocIdをliveで再取得し、まだbackfillの
 * sentinelエラーマーカーのままのものだけをfield-absentへ復帰する(Codex High指摘#2対応、
 * 選択的rollback)。exported/exporting/実エラーへ進んだdocは意図的にskipする
 * (ADR-0022ロールバック意味論: 「flag OFF」同様、backfill --rollbackもFirestoreの
 * マーカーのみを復帰対象とし、既に進行した状態は変更しない)。
 */
async function runRollback(manifestPath: string): Promise<void> {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as BackfillManifest;
  console.log(`プロジェクト: ${projectId}`);
  console.log(`モード: ${dryRun ? 'DRY RUN(変更なし)' : '実行'}`);
  console.log(`rollback対象manifest: ${manifestPath} (runId=${manifest.runId}, docIds=${manifest.docIds.length}件)`);
  console.log('---');

  let reverted = 0;
  let skippedNotFound = 0;
  let skippedProgressed = 0;
  let skippedPreconditionFailed = 0;

  for (const docId of manifest.docIds) {
    const ref = db.doc(`documents/${docId}`);
    // eslint-disable-next-line no-await-in-loop
    const snap = await ref.get();
    if (!snap.exists) {
      // 進行済み(exported等)とは別カテゴリ(doc自体が消えている=他要因によるdocument削除の
      // 可能性があり、operatorが見分けられるよう区別する。code-review high指摘#3対応)。
      console.log(`  スキップ(doc不在、要調査): ${docId}`);
      skippedNotFound++;
      continue;
    }
    const data = snap.data()!;
    if (!isRollbackCandidate(data)) {
      console.log(`  スキップ(backfillマーカーではない、進行済みor実エラー): ${docId} [status=${data.driveExportStatus ?? '(不在)'}]`);
      skippedProgressed++;
      continue;
    }

    console.log(`  対象: ${docId}`);
    if (dryRun) continue;

    try {
      // eslint-disable-next-line no-await-in-loop
      await ref.update(
        {
          driveExportStatus: admin.firestore.FieldValue.delete(),
          driveExportError: admin.firestore.FieldValue.delete(),
        },
        { lastUpdateTime: snap.updateTime }
      );
      reverted++;
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 9) {
        console.log(`  スキップ(並行書込み検出、precondition不一致): ${docId}`);
        skippedPreconditionFailed++;
        continue;
      }
      throw err;
    }
  }

  console.log(`\n--- 結果 ---`);
  console.log(`復帰: ${reverted}件`);
  console.log(`スキップ(進行済み/対象外): ${skippedProgressed}件`);
  if (skippedNotFound > 0) {
    console.log(`スキップ(doc不在、要調査): ${skippedNotFound}件`);
  }
  if (skippedPreconditionFailed > 0) {
    console.log(`並行書込みによりスキップ: ${skippedPreconditionFailed}件`);
  }
  if (dryRun) {
    console.log('\n--dry-run モードのため変更なし。実行するには --dry-run を外してください。');
  }
}

async function main(): Promise<void> {
  if (rollbackManifestPath) {
    await runRollback(rollbackManifestPath);
  } else {
    await runBackfill();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('エラー:', err);
  process.exit(1);
});
