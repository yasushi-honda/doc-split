#!/usr/bin/env ts-node
/**
 * ADR-0018 Phase E: 本体 documents/{docId} から ocrResult/pageResults を削除する
 * destructiveマイグレーション (Issue #547)
 *
 * PR-E1 (dual-write停止) 完了後、既存docの本体に残っている ocrResult/pageResults
 * (backfill完了後もdual-writeで残置されていた値) を、detail/mainとの内容パリティ
 * 確認を経てから `FieldValue.delete()` で削除する。egressの実削減はこのスクリプトの
 * 実行によって初めて発生する (Firestoreはprojection非対応のため、フィールドを
 * 実際に本体から消さない限り一覧クエリの転送量は変わらない)。
 *
 * ## 実行モード (排他、いずれか1つ必須)
 * - `--mark-preflight --marked-by <name>`: PR-E1が対象環境に完全デプロイ済みであることを
 *   運用者が確認した上で実行するゲート。`_migrations/adr0018PhaseEPreflight` に記録する。
 *   `--execute`/`--rollback` はこのマーカーがない環境では即abortする。
 * - `--dry-run`: read-only。親にocrResult/pageResultsの値が残っているdoc数を概算する
 *   (軽量scanのため、detail一致確認はしない。真の判定は--execute実行時に行う)
 * - `--execute [--limit N]`: per-docトランザクションで削除実行(レート制御付き、冪等)。
 *   削除直前に親↔detailのcanonicalHash一致を同一tx内で再検証し、不一致・detail不在・
 *   in-pipelineはskipする。削除するdocはmanifestに記録する(rollback用)。
 * - `--verify`: read-only。in-pipeline以外の全docで、親にocrResult/pageResultsが
 *   存在しないこと・detail/mainは残存していることを確認する。
 * - `--rollback --run-id <runId>`: 指定runIdのmanifestに記録されたdocのみを対象に、
 *   detail/mainの**現在値**を親へ書き戻す(削除時点の値の完全な巻き戻しではない。
 *   Phase F着手前のdetail/main温存が前提の限定的な復旧手段)。
 *
 * ## 設計判断 (Codexセカンドオピニオン 2026-07-10 反映)
 * - **PR-E1後は「親に値がない」が正常状態**: backfill(Phase C)の判定ロジックとは
 *   逆方向。decideDeletionAction (lib/deleteLegacyOcrFieldsHelpers.ts) が
 *   already-deleted/skip-mismatch/skip-detail-missing/skip-in-pipeline/delete の
 *   5分類を行う。
 * - **削除前提条件はmigration markerで機械的にゲートする**: PR-E1未デプロイ環境での
 *   誤実行(削除しても新規処理ですぐ親に値が復活する)を構造的に防ぐ。
 * - **manifestはFirestoreのみで完結、GCS不要**: 削除する値そのものを複製する必要はなく
 *   (detail/mainが値の実体を保持し続ける)、「このdocは削除された」という記録
 *   (docId + deletedFields + deletedAt) だけで十分。削除本体とmanifest書込みを
 *   同一transactionにまとめることで、GCS書込み成功/Firestore commit失敗のような
 *   原子性の懸念が構造的に排除される。
 * - **rollbackは限定的な復旧手段**: PR-E1で親への書込みを止めているため、rollback後も
 *   新規OCR処理・再処理では親に値が書き戻されない。既存docの復元のみを保証する。
 *
 * 使用方法 (推奨: GitHub Actions "Run Operations Script"):
 *   delete-legacy-ocr-fields --mark-preflight --marked-by yasushi-honda
 *   delete-legacy-ocr-fields --dry-run
 *   delete-legacy-ocr-fields --execute --limit 10   (canary)
 *   delete-legacy-ocr-fields --execute
 *   delete-legacy-ocr-fields --verify
 *   delete-legacy-ocr-fields --rollback --run-id 20260715-093000
 */

import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import {
  decideDeletionAction,
  buildDeletionFieldUpdate,
  canonicalHash,
  createDeletionCounters,
  IN_PIPELINE_STATUSES,
  type DeletionCounters,
} from './lib/deleteLegacyOcrFieldsHelpers';

const ALLOWED_PROJECT_IDS = ['doc-split-dev', 'docsplit-kanameone', 'docsplit-cocoro'];

/**
 * レート制御。backfill-detail-subcollection.ts (Phase C) と同じ値からスタートする
 * (kanameone実測: CONCURRENCY=4, 起動間隔150ms≈6.7docs/secでgroup tx ~27/sec、
 * documentGroupsのdiff最適化(groupAggregation.ts, Phase E実装済み)によりocrResult/
 * pageResults削除単独ではgroup transaction自体が発生しないため、Phase Cより負荷は
 * 軽い想定。devリハーサルで実測し、必要ならチューニングする)。
 */
const CONCURRENCY = 4;
const EXECUTE_START_INTERVAL_MS = 150;

const PREFLIGHT_DOC_PATH = '_migrations/adr0018PhaseEPreflight';

const EXPLICIT_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || '';
const AMBIENT_PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '';
if (EXPLICIT_PROJECT_ID && AMBIENT_PROJECT_ID && EXPLICIT_PROJECT_ID !== AMBIENT_PROJECT_ID) {
  console.error(
    `❌ FIREBASE_PROJECT_ID (${EXPLICIT_PROJECT_ID}) と GOOGLE_CLOUD_PROJECT/GCLOUD_PROJECT ` +
      `(${AMBIENT_PROJECT_ID}) が食い違っています。意図しない環境への書込を防ぐため中断します。`
  );
  process.exit(1);
}
const PROJECT_ID = EXPLICIT_PROJECT_ID || AMBIENT_PROJECT_ID;

if (!PROJECT_ID) {
  console.error('FIREBASE_PROJECT_ID (または GOOGLE_CLOUD_PROJECT) を設定してください');
  process.exit(1);
}
if (!ALLOWED_PROJECT_IDS.includes(PROJECT_ID)) {
  console.error(`❌ このスクリプトは ${ALLOWED_PROJECT_IDS.join('/')} 専用です (指定: ${PROJECT_ID})`);
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}
const db = admin.firestore();

type Mode = 'mark-preflight' | 'dry-run' | 'execute' | 'verify' | 'rollback';

function parseArgs(): { mode: Mode; limit: number; markedBy: string; runId: string } {
  const MODE_FLAGS: Record<string, Mode> = {
    '--mark-preflight': 'mark-preflight',
    '--dry-run': 'dry-run',
    '--execute': 'execute',
    '--verify': 'verify',
    '--rollback': 'rollback',
  };
  const args = process.argv.slice(2);
  const modes: Mode[] = [];
  let limit = 0;
  let markedBy = '';
  let runId = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg in MODE_FLAGS) {
      modes.push(MODE_FLAGS[arg]);
      continue;
    }
    if (arg === '--limit') {
      limit = Number(args[i + 1]);
      if (!Number.isInteger(limit) || limit <= 0) {
        console.error('--limit には正の整数を指定してください (例: --limit 10)');
        process.exit(1);
      }
      i++;
      continue;
    }
    if (arg === '--marked-by') {
      markedBy = args[i + 1] ?? '';
      i++;
      continue;
    }
    if (arg === '--run-id') {
      runId = args[i + 1] ?? '';
      i++;
      continue;
    }
    console.error(`未知の引数です: ${arg} (--limit=N 形式は不可、--limit N を使用)`);
    process.exit(1);
  }

  if (modes.length !== 1) {
    console.error(
      '使用方法: --mark-preflight --marked-by <name> | --dry-run | --execute [--limit N] | --verify | --rollback --run-id <runId> のいずれか1つを指定'
    );
    process.exit(1);
  }
  const mode = modes[0];
  if (limit > 0 && mode !== 'execute') {
    console.error('--limit は --execute 専用です');
    process.exit(1);
  }
  if (mode === 'mark-preflight' && !markedBy) {
    console.error('--mark-preflight には --marked-by <name> が必須です (監査証跡)');
    process.exit(1);
  }
  if (mode === 'rollback' && !runId) {
    console.error('--rollback には --run-id <runId> が必須です');
    process.exit(1);
  }
  return { mode, limit, markedBy, runId };
}

interface PreflightState {
  exists: boolean;
  legacyParentWritesDisabled: boolean;
}

async function readPreflightState(): Promise<PreflightState> {
  const snap = await db.doc(PREFLIGHT_DOC_PATH).get();
  if (!snap.exists) return { exists: false, legacyParentWritesDisabled: false };
  const data = snap.data()!;
  return { exists: true, legacyParentWritesDisabled: data.legacyParentWritesDisabled === true };
}

/** --execute/--rollback (実書込みモード) 専用のpreflightゲート。未確認環境では即abort */
async function requirePreflightOrAbort(): Promise<void> {
  const state = await readPreflightState();
  if (!state.exists || !state.legacyParentWritesDisabled) {
    console.error(
      `❌ preflightマーカー (${PREFLIGHT_DOC_PATH}) が未設定、または legacyParentWritesDisabled=true ` +
        'ではありません。PR-E1 (dual-write停止) が対象環境に完全デプロイ済みであることを確認したうえで ' +
        '`--mark-preflight --marked-by <name>` を先に実行してください。'
    );
    process.exit(1);
  }
}

function describeErrorForLog(err: unknown): string {
  const name = err instanceof Error ? err.constructor.name : typeof err;
  const code = (err as { code?: number | string })?.code;
  return code !== undefined ? `${name} code=${code}` : name;
}

/**
 * documents 全件を軽量スキャンする(select field maskでstatus/ocrResult/pageResultsの
 * 有無のみ判定できる最小限のフィールドを転送)。dry-runの概算表示に使う。
 * 真の削除可否判定(detail一致確認)は--execute時のper-docトランザクション内で行う。
 */
interface ScannedDoc {
  id: string;
  status: string | undefined;
  hasOcrResult: boolean;
  hasPageResults: boolean;
}

async function scanAllDocuments(): Promise<ScannedDoc[]> {
  const snap = await db.collection('documents').select('status', 'ocrResult', 'pageResults').get();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      status: typeof data.status === 'string' ? data.status : undefined,
      hasOcrResult: typeof data.ocrResult === 'string',
      hasPageResults: Array.isArray(data.pageResults),
    };
  });
}

function printDryRunSummary(docs: ScannedDoc[]): void {
  let inPipeline = 0;
  let alreadyDeleted = 0;
  let hasLegacyValue = 0;
  for (const d of docs) {
    if (typeof d.status === 'string' && (IN_PIPELINE_STATUSES as readonly string[]).includes(d.status)) {
      inPipeline++;
      continue;
    }
    if (!d.hasOcrResult && !d.hasPageResults) {
      alreadyDeleted++;
    } else {
      hasLegacyValue++;
    }
  }
  console.log(`\n--- dry-run概算 (全${docs.length}件、detail一致確認なしの軽量scan) ---`);
  console.log(`in-pipeline (${IN_PIPELINE_STATUSES.join('/')}): ${inPipeline}`);
  console.log(`既に親からocrResult/pageResultsが削除済み: ${alreadyDeleted}`);
  console.log(`削除候補(親に値が残存、--executeで詳細判定): ${hasLegacyValue}`);
  console.log('※ 実際の削除可否(detail一致確認・detail不在検出)は --execute 実行時に1docずつ判定される');
}

/** 同時実行数 + グローバル起動間隔を制御するworkerプール (backfill-detail-subcollection.tsと同一実装) */
async function runWithRateControl<T>(
  items: T[],
  startIntervalMs: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  let nextSlot = 0;
  async function runner(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      if (startIntervalMs > 0) {
        const slot = Math.max(Date.now(), nextSlot);
        nextSlot = slot + startIntervalMs;
        const wait = slot - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
      await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => runner()));
}

function manifestCollectionPath(runId: string): string {
  return `_migrations/adr0018PhaseEDeletionRun_${runId}/deletedDocs`;
}

async function deleteOneDoc(docId: string, runId: string, counters: DeletionCounters): Promise<void> {
  try {
    const docRef = db.doc(`documents/${docId}`);
    const detailRef = docRef.collection('detail').doc('main');
    const manifestRef = db.doc(`${manifestCollectionPath(runId)}/${docId}`);

    const outcome = await db.runTransaction<string>(async (tx) => {
      const [parentSnap, detailSnap] = await tx.getAll(docRef, detailRef);
      if (!parentSnap.exists) return 'parent-deleted-during-run';
      const data = parentSnap.data()!;
      const parentHasOcrResult = typeof data.ocrResult === 'string';
      const parentHasPageResults = Array.isArray(data.pageResults);

      let ocrResultMatches: boolean | null = null;
      let pageResultsMatches: boolean | null = null;
      if (detailSnap.exists) {
        const detailData = detailSnap.data()!;
        if (parentHasOcrResult) {
          ocrResultMatches = canonicalHash(data.ocrResult) === canonicalHash(detailData.ocrResult);
        }
        if (parentHasPageResults) {
          pageResultsMatches =
            canonicalHash(data.pageResults) === canonicalHash(detailData.pageResults ?? []);
        }
      }

      const decision = decideDeletionAction({
        status: data.status,
        parentHasOcrResult,
        parentHasPageResults,
        detailExists: detailSnap.exists,
        ocrResultMatches,
        pageResultsMatches,
      });

      if (decision !== 'delete') return decision;

      const fieldUpdate = buildDeletionFieldUpdate({ parentHasOcrResult, parentHasPageResults });
      const deletedFields = Object.keys(fieldUpdate);
      tx.update(docRef, fieldUpdate);
      // manifest書込みは削除本体と同一transaction (MUST: 原子性)。GCS不要:
      // detail/mainが値の実体を保持し続けるため、docId + 削除フィールド一覧のみ記録する。
      tx.set(manifestRef, {
        deletedFields,
        deletedAt: FieldValue.serverTimestamp(),
      });
      return 'delete';
    });

    switch (outcome) {
      case 'delete':
        counters.deleted++;
        break;
      case 'already-deleted':
        counters.skippedAlreadyDeleted++;
        break;
      case 'skip-mismatch':
        counters.skippedMismatch++;
        console.warn(`[deleteOneDoc] 不一致のためskip docId=${docId} (要調査)`);
        break;
      case 'skip-detail-missing':
        counters.skippedDetailMissing++;
        console.warn(`[deleteOneDoc] detail不在のためskip docId=${docId} (要調査)`);
        break;
      case 'skip-in-pipeline':
        counters.skippedInPipeline++;
        break;
      case 'parent-deleted-during-run':
        counters.parentDeletedDuringRun++;
        break;
      default:
        counters.decisionChanged++;
    }
  } catch (err) {
    counters.errors++;
    console.warn(`[deleteOneDoc] 失敗 docId=${docId} (${describeErrorForLog(err)})`);
  }
}

interface VerifyResult {
  checked: number;
  inPipeline: number;
  legacyFieldStillPresent: string[];
  detailMissingForNonDeleted: string[];
  errors: number;
}

async function verifyOneDoc(docId: string, result: VerifyResult): Promise<void> {
  try {
    const docRef = db.doc(`documents/${docId}`);
    const detailRef = docRef.collection('detail').doc('main');
    const [parentSnap, detailSnap] = await db.getAll(docRef, detailRef);
    if (!parentSnap.exists) return;
    const data = parentSnap.data()!;

    if (typeof data.status === 'string' && (IN_PIPELINE_STATUSES as readonly string[]).includes(data.status)) {
      result.inPipeline++;
      return;
    }
    result.checked++;

    const hasOcrResult = typeof data.ocrResult === 'string';
    const hasPageResults = Array.isArray(data.pageResults);
    if (hasOcrResult || hasPageResults) {
      result.legacyFieldStillPresent.push(docId);
    }
    if (!detailSnap.exists) {
      result.detailMissingForNonDeleted.push(docId);
    }
  } catch (err) {
    result.errors++;
    console.warn(`[verifyOneDoc] 読込失敗 docId=${docId} (${describeErrorForLog(err)})`);
  }
}

async function runRollback(runId: string): Promise<void> {
  const manifestSnap = await db.collection(manifestCollectionPath(runId)).get();
  if (manifestSnap.empty) {
    console.error(`❌ run-id=${runId} のmanifestが見つかりません (${manifestCollectionPath(runId)})`);
    process.exit(1);
  }
  console.log(`\n--- rollback: run-id=${runId}、対象${manifestSnap.size}件 ---`);
  console.log(
    'ℹ️ detail/mainの現在値で親を復元します(削除時点の値の完全な巻き戻しではありません。' +
      'PR-E1により新規処理は親へ書込まないため、rollback後も親の値は将来の再処理で更新されません)'
  );

  let restored = 0;
  let detailMissing = 0;
  let errors = 0;
  const docIds = manifestSnap.docs.map((d) => d.id);

  await runWithRateControl(docIds, EXECUTE_START_INTERVAL_MS, async (docId) => {
    try {
      const docRef = db.doc(`documents/${docId}`);
      const detailRef = docRef.collection('detail').doc('main');
      const manifestRef = db.doc(`${manifestCollectionPath(runId)}/${docId}`);
      const [detailSnap, manifestDocSnap] = await db.getAll(detailRef, manifestRef);
      if (!detailSnap.exists) {
        detailMissing++;
        console.warn(`[rollback] detail/main不在のため復元不可 docId=${docId}`);
        return;
      }
      const deletedFields: string[] = manifestDocSnap.data()?.deletedFields ?? [];
      const detailData = detailSnap.data()!;
      const restore: Record<string, unknown> = {};
      if (deletedFields.includes('ocrResult') && typeof detailData.ocrResult === 'string') {
        restore.ocrResult = detailData.ocrResult;
      }
      if (deletedFields.includes('pageResults') && Array.isArray(detailData.pageResults)) {
        restore.pageResults = detailData.pageResults;
      }
      if (Object.keys(restore).length === 0) return;
      await docRef.update(restore);
      restored++;
    } catch (err) {
      errors++;
      console.warn(`[rollback] 失敗 docId=${docId} (${describeErrorForLog(err)})`);
    }
  });

  console.log(`\n--- rollback結果 ---`);
  console.log(`復元: ${restored}`);
  console.log(`detail/main不在(復元不可): ${detailMissing}`);
  console.log(`エラー: ${errors}`);
  if (errors > 0 || detailMissing > 0) process.exitCode = 1;
}

async function main(): Promise<void> {
  const { mode, limit, markedBy, runId } = parseArgs();
  console.log(`=== delete-legacy-ocr-fields (ADR-0018 Phase E, Issue #547) ===`);
  console.log(`プロジェクト: ${PROJECT_ID} / モード: ${mode}${limit ? ` / limit: ${limit}` : ''}`);
  console.log('個人情報はログに出力しません(件数とdoc IDのみ)。');

  if (mode === 'mark-preflight') {
    await db.doc(PREFLIGHT_DOC_PATH).set({
      legacyParentWritesDisabled: true,
      markedAt: FieldValue.serverTimestamp(),
      markedBy,
    });
    console.log(`\n✅ preflightマーカーを記録しました (${PREFLIGHT_DOC_PATH})`);
    console.log('PR-E1 (dual-write停止) が対象環境に完全デプロイ済みであることを確認した上で実行したことを前提とします。');
    return;
  }

  if (mode === 'dry-run') {
    const state = await readPreflightState();
    console.log(
      `\npreflight状態: ${state.exists ? (state.legacyParentWritesDisabled ? '✅ 設定済み' : '⚠️ 存在するがlegacyParentWritesDisabled=false') : '❌ 未設定'}`
    );
    const docs = await scanAllDocuments();
    printDryRunSummary(docs);
    console.log('\n=== dry-run完了 (read-only、書込なし) ===');
    return;
  }

  if (mode === 'execute') {
    await requirePreflightOrAbort();
    const runIdForExecute = new Date().toISOString().replace(/[:.]/g, '-');
    const docs = await scanAllDocuments();
    let candidates = docs.filter((d) => d.hasOcrResult || d.hasPageResults);
    if (limit > 0) {
      candidates = candidates.slice(0, limit);
      console.log(`\n--limit ${limit} 指定によりcanary実行: 対象を先頭${candidates.length}件に制限`);
    }
    if (candidates.length === 0) {
      console.log('\n✅ 削除候補0件(冪等: 全doc削除済み or 対象なし)');
      return;
    }
    console.log(`\n--- 削除実行: run-id=${runIdForExecute}、候補${candidates.length}件 ---`);
    console.log(`(concurrency=${CONCURRENCY}, 起動間隔${EXECUTE_START_INTERVAL_MS}ms ≈ ${(1000 / EXECUTE_START_INTERVAL_MS).toFixed(1)} docs/sec)`);
    const counters = createDeletionCounters();
    const started = Date.now();
    await runWithRateControl(candidates, EXECUTE_START_INTERVAL_MS, (d) =>
      deleteOneDoc(d.id, runIdForExecute, counters)
    );
    console.log(`\n--- 実行結果 (${Math.round((Date.now() - started) / 1000)}秒) ---`);
    console.log(`削除成功: ${counters.deleted}`);
    console.log(`skip(既に削除済み、正常系): ${counters.skippedAlreadyDeleted}`);
    console.log(`skip(親↔detail不一致、要調査): ${counters.skippedMismatch}`);
    console.log(`skip(detail不在、要調査): ${counters.skippedDetailMissing}`);
    console.log(`skip(in-pipeline): ${counters.skippedInPipeline}`);
    console.log(`skip(実行中に親doc削除): ${counters.parentDeletedDuringRun}`);
    console.log(`エラー: ${counters.errors}`);
    console.log(`\nrun-id: ${runIdForExecute} (rollback時に --run-id ${runIdForExecute} を指定)`);
    if (counters.errors > 0 || counters.skippedMismatch > 0 || counters.skippedDetailMissing > 0) {
      console.error('❌ エラーまたは要調査のskipが発生しました。内容を確認してください。');
      process.exitCode = 1;
    } else if (limit > 0) {
      console.log(`✅ canary実行完了(${limit}件上限)。次: 結果確認後、--execute(制限なし)で全量実行`);
    } else {
      console.log('✅ execute完了。次: 同モード再実行で削除0件(冪等性確認) → --verify');
    }
    return;
  }

  if (mode === 'rollback') {
    await requirePreflightOrAbort();
    await runRollback(runId);
    return;
  }

  // mode === 'verify'
  const docs = await scanAllDocuments();
  const result: VerifyResult = {
    checked: 0,
    inPipeline: 0,
    legacyFieldStillPresent: [],
    detailMissingForNonDeleted: [],
    errors: 0,
  };
  console.log(`\n--- 検証: ${docs.length}件 (in-pipelineは判定時に除外) ---`);
  await runWithRateControl(
    docs.map((d) => d.id),
    0,
    (id) => verifyOneDoc(id, result)
  );
  console.log(`\n--- 検証結果 ---`);
  console.log(`検証対象: ${result.checked} / in-pipeline除外: ${result.inPipeline} / 読込エラー: ${result.errors}`);
  console.log(
    `親にocrResult/pageResultsが残存: ${result.legacyFieldStillPresent.length}` +
      (result.legacyFieldStillPresent.length > 0
        ? ` (sample: ${result.legacyFieldStillPresent.slice(0, 20).join(', ')})`
        : '')
  );
  console.log(
    `detail/main不在: ${result.detailMissingForNonDeleted.length}` +
      (result.detailMissingForNonDeleted.length > 0
        ? ` (sample: ${result.detailMissingForNonDeleted.slice(0, 20).join(', ')})`
        : '')
  );
  if (result.legacyFieldStillPresent.length > 0 || result.errors > 0) {
    console.error(
      `❌ FAIL: 親に残存${result.legacyFieldStillPresent.length}件 / 読込エラー${result.errors}件`
    );
    process.exitCode = 1;
  } else {
    console.log('✅ PASS: 全doc(in-pipeline以外)から親のocrResult/pageResultsが削除済み');
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(`❌ 致命的エラー (${describeErrorForLog(err)})`);
    process.exit(1);
  });
