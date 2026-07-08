#!/usr/bin/env ts-node
/**
 * ADR-0018 Phase C: 既存documentsへの detail/main サブコレクション backfill (Issue #547)
 *
 * Phase B (dual-write、PR #569/#571/#573/#574/#575) 以降に一度も再処理されていない
 * 既存docへ `documents/{docId}/detail/main` を作成し、`ocrExcerpt` を親の既存
 * `ocrResult`/`ocrResultUrl` から算出して親docへ書込む。Phase D (dual-read cutover) の
 * 前提条件「detail/main が存在しない doc はゼロ」(ADR-0018 §原子性要件2) を成立させる。
 *
 * ## 実行モード (排他、いずれか1つ必須)
 * - `--audit`:   read-only。status分布 × detail/main有無 × search.tokenHash欠落数を集計
 * - `--dry-run`: read-only。backfill対象件数の確定とサンプルdoc ID表示(書込0)
 * - `--execute`: per-docトランザクションでbackfill実行(レート制御付き、冪等)
 * - `--verify`:  read-only。親↔detailの内容パリティ(canonical hash照合)と
 *                ocrExcerpt再計算照合。不一致は報告のみ(自動修正しない)
 *
 * ## 設計判断 (Codexセカンドオピニオン 2026-07-08 反映)
 * - **batch書込ではなく 1 doc = 1 トランザクション** (Codex Critical 1 対応):
 *   `tx.getAll(親, detail)` → detail存在/in-pipelineならskip → `tx.create(detail)` +
 *   `tx.update(親, {ocrExcerpt})`。Firestoreトランザクションの直列化保証により、
 *   backfill実行中に並行する再処理(dual-write)があってもトランザクションが自動リトライ→
 *   新鮮な状態を再読→skipとなり、古いデータで新しいOCR結果を上書きする経路が構造的に
 *   存在しない。`create()` は既存docに対して失敗するため二重防御になる。
 *   副次効果: batch 500 ops上限(2N≤500)・10MiBリクエスト上限の考慮も不要になる。
 * - **対象はprocessed限定ではなく「in-pipeline (pending/processing) 以外の全doc」**
 *   (Codex Critical 2 対応): error/split等のdocもPhase DのFE writeBatch (`update()`) の
 *   対象になりうるため、存在保証は全statusに必要。in-pipeline除外の理由は
 *   scripts/lib/backfillDetailHelpers.ts の decideBackfillAction doc comment 参照。
 * - **レート制御** (Codex Critical 3 対応): 親docの `ocrExcerpt` 更新は
 *   updateDocumentGroups.onDocumentWrite を発火させ、groupキー不変でも delta:0 の
 *   group transaction が最大4件走る(groupAggregation.ts:115-117 実読で確認)。
 *   searchIndexer は tokenHash 一致で早期return するため大半は素通り(audit で
 *   tokenHash 欠落数を事前計測)。同時実行数 + 起動間隔でトリガー負荷を制御する。
 * - **ocrExcerpt算出は本番と同一ヘルパー共用** (Codex Important 対応):
 *   functions/src/ocr/ocrExcerpt.ts (ocrProcessor.tsから抽出) を import。
 *
 * ## 冪等性・再実行安全性
 * detail/main が既に存在する doc はスキップするため、途中killからの再開 = 単純再実行。
 * 2周目の実行で written=0 になることが devリハーサルの冪等性完了条件。
 *
 * ## 個人情報保護
 * fileName/customerName/officeName 等はログに一切出力しない。出力は件数と
 * doc ID (Firestore auto-ID、非PII) のみ。
 *
 * 使用方法 (推奨: GitHub Actions "Run Operations Script"):
 *   backfill-detail-subcollection --audit
 *   backfill-detail-subcollection --dry-run
 *   backfill-detail-subcollection --execute --limit 10   (canary)
 *   backfill-detail-subcollection --execute
 *   backfill-detail-subcollection --verify
 */

import * as admin from 'firebase-admin';
import { buildOcrExcerpt } from '../functions/src/ocr/ocrExcerpt';
import {
  decideBackfillAction,
  buildDetailPayload,
  canonicalHash,
  createCounters,
  IN_PIPELINE_STATUSES,
  type BackfillCounters,
} from './lib/backfillDetailHelpers';

const ALLOWED_PROJECT_IDS = ['doc-split-dev', 'docsplit-kanameone', 'docsplit-cocoro'];

/**
 * レート制御 (Codex Critical 3 対応)。
 * CONCURRENCY=4 × EXECUTE_START_INTERVAL_MS=150 ≈ 6.7 docs/sec (グローバルレート、
 * runWithRateControl が起動スロットを同期的に予約することで保証)。
 * kanameone 9,355件で約23分。1 doc backfill = 親update 1回 (トリガー発火は
 * onDocumentWrite→group tx最大4件) + detail create 1回 (documents/{id} 直下では
 * ないためonDocumentWriteは発火しない)。→ group tx ~27/sec、Firestore余裕範囲。
 *
 * search.tokenHash 欠落の processed doc は、searchIndexer が search メタデータを
 * 親へ書き戻すため onDocumentWrite が2度目に発火し、group tx は最大8件/docになる
 * (review C2指摘反映: 2度目のsearchIndexer発火はhash一致で早期returnし無限ループには
 * ならない)。audit の tokenHash欠落数(backfill対象内)で該当規模を事前確認すること。
 *
 * --verify は読取専用でトリガーを一切発火しないため、起動間隔なし
 * (concurrency制限のみ) で実行する (review A4/D1指摘反映)。
 */
const CONCURRENCY = 4;
const EXECUTE_START_INTERVAL_MS = 150;

/** verify で不一致検出時に表示するサンプルdoc ID数の上限 */
const MISMATCH_SAMPLE_LIMIT = 20;

const PROJECT_ID =
  process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || '';

if (!PROJECT_ID) {
  console.error('GOOGLE_CLOUD_PROJECT (または FIREBASE_PROJECT_ID) を設定してください');
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

type Mode = 'audit' | 'dry-run' | 'execute' | 'verify';

function parseArgs(): { mode: Mode; limit: number } {
  const MODE_FLAGS: Record<string, Mode> = {
    '--audit': 'audit',
    '--dry-run': 'dry-run',
    '--execute': 'execute',
    '--verify': 'verify',
  };
  const args = process.argv.slice(2);
  const modes: Mode[] = [];
  let limit = 0; // 0 = 無制限

  // 未知の引数は明示拒否する (Codex Phase C review P2反映: `--limit=10` や typo が
  // 黙殺されると、canary意図の起動が全件実行に化ける。destructiveスクリプトでは
  // 「解釈できない指定 = 即エラー」が唯一安全なデフォルト)
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
      i++; // 値を消費
      continue;
    }
    console.error(`未知の引数です: ${arg} (--limit=N 形式は不可、--limit N を使用)`);
    process.exit(1);
  }

  if (modes.length !== 1) {
    console.error('使用方法: --audit | --dry-run | --execute [--limit N] | --verify のいずれか1つを指定');
    process.exit(1);
  }
  // --limit は execute 専用 (review A3指摘反映: 他モードで受理するとヘッダに
  // 表示されるのに適用されず、operator が「サンプル済み」と誤認するため明示拒否)
  if (limit > 0 && modes[0] !== 'execute') {
    console.error('--limit は --execute 専用です (audit/dry-run/verify は常に全件対象)');
    process.exit(1);
  }
  return { mode: modes[0], limit };
}

/**
 * detail/main を持つ親doc IDの集合を1回のcollection-groupスキャンで取得する。
 * `select()` (投影フィールドなし = key-only projection) により転送はドキュメント名のみで、
 * 9,000件規模でも軽量。documents/{docId}/detail/main 以外のパスは除外する。
 */
async function fetchParentIdsWithDetail(): Promise<Set<string>> {
  const parentIds = new Set<string>();
  const snap = await db.collectionGroup('detail').select().get();
  for (const doc of snap.docs) {
    const parent = doc.ref.parent.parent;
    if (doc.id === 'main' && parent && parent.parent?.id === 'documents' && !parent.parent.parent) {
      parentIds.add(parent.id);
    }
  }
  return parentIds;
}

interface ScannedDoc {
  id: string;
  status: string | undefined;
  hasTokenHash: boolean;
  hasOcrExcerpt: boolean;
}

/**
 * documents 全件を軽量スキャンする(select field maskでstatus/search.tokenHash/
 * ocrExcerptのみ転送。ocrExcerptは最大200字の軽量フィールド)。
 * 重フィールド(ocrResult/pageResults)は --execute のper-docトランザクション内、
 * --verify の対象doc読込時にのみ取得する。
 */
async function scanAllDocuments(): Promise<ScannedDoc[]> {
  const snap = await db
    .collection('documents')
    .select('status', 'search.tokenHash', 'ocrExcerpt')
    .get();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      status: typeof data.status === 'string' ? data.status : undefined,
      hasTokenHash: typeof data.search?.tokenHash === 'string' && data.search.tokenHash.length > 0,
      hasOcrExcerpt: typeof data.ocrExcerpt === 'string',
    };
  });
}

interface Classification {
  targets: ScannedDoc[];
  counters: BackfillCounters;
  statusDist: Map<string, { total: number; detailExists: number; targets: number }>;
  tokenHashMissing: number;
}

function classify(docs: ScannedDoc[], parentIdsWithDetail: Set<string>): Classification {
  const counters = createCounters();
  const statusDist = new Map<string, { total: number; detailExists: number; targets: number }>();
  const targets: ScannedDoc[] = [];
  let tokenHashMissing = 0;

  for (const doc of docs) {
    counters.scanned++;
    const statusKey = doc.status ?? '(missing)';
    const dist = statusDist.get(statusKey) ?? { total: 0, detailExists: 0, targets: 0 };
    dist.total++;

    const detailExists = parentIdsWithDetail.has(doc.id);
    if (detailExists) dist.detailExists++;

    const decision = decideBackfillAction({
      status: doc.status,
      detailExists,
      hasOcrExcerpt: doc.hasOcrExcerpt,
    });
    if (decision === 'backfill-detail-and-excerpt' || decision === 'backfill-excerpt-only') {
      if (decision === 'backfill-detail-and-excerpt') counters.targetsDetailAndExcerpt++;
      else counters.targetsExcerptOnly++;
      dist.targets++;
      targets.push(doc);
      // searchIndexerトリガー増幅の見積りはbackfillが実際に親を更新するdoc(=target)に
      // 限定して数える (review A5指摘反映: 全doc対象だとskip分まで含み過大推定になる)
      if (!doc.hasTokenHash) tokenHashMissing++;
    } else if (decision === 'skip-complete') {
      counters.skippedComplete++;
    } else {
      counters.skippedInPipeline++;
    }
    statusDist.set(statusKey, dist);
  }

  return { targets, counters, statusDist, tokenHashMissing };
}

function printClassification(c: Classification): void {
  console.log(`\n--- status別内訳 (全${c.counters.scanned}件) ---`);
  for (const [status, dist] of [...c.statusDist.entries()].sort()) {
    console.log(
      `status=${status}: total=${dist.total} detail/main有=${dist.detailExists} backfill対象=${dist.targets}`
    );
  }
  const totalTargets = c.counters.targetsDetailAndExcerpt + c.counters.targetsExcerptOnly;
  console.log(`\nbackfill対象合計: ${totalTargets}`);
  console.log(`  内訳: detail+excerpt作成=${c.counters.targetsDetailAndExcerpt} / excerptのみ補完=${c.counters.targetsExcerptOnly}`);
  console.log(`スキップ(detail/main・ocrExcerptとも既存): ${c.counters.skippedComplete}`);
  console.log(`スキップ(in-pipeline: ${IN_PIPELINE_STATUSES.join('/')}): ${c.counters.skippedInPipeline}`);
  console.log(
    `search.tokenHash欠落(backfill対象内): ${c.tokenHashMissing} (該当docはsearchIndexer書き戻しでgroup tx最大8件/docに増幅)`
  );
}

/**
 * 同時実行数 + グローバル起動間隔の両方を制御するworkerプール (トリガー負荷制御)。
 *
 * 起動スロットは await の**前に同期的に予約する** (review A2/D2指摘反映: 予約を
 * await後に行うと、複数workerが同じ古いlastStartを読んで同一スロットに整列し、
 * 実効レートが最大CONCURRENCY倍まで劣化してレート制御が機能しなくなる)。
 * startIntervalMs=0 で起動間隔なし(concurrency制限のみ)になる(--verify用)。
 */
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
        nextSlot = slot + startIntervalMs; // 同期的にスロット予約(この行までawaitなし)
        const wait = slot - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
      await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => runner()));
}

type BackfillOutcome = 'written-detail-and-excerpt' | 'written-excerpt-only' | 'parent-deleted' | 'decision-changed';

/**
 * 1 docのbackfillを単一トランザクションで実行する (設計判断は冒頭doc comment参照)。
 * トランザクション内で親・detailを読み直すため、スキャン時点との状態差(並行再処理等)は
 * ここで最終判定される。
 *
 * detail作成とocrExcerpt補完は独立に判定する (Codex Phase C review P1反映:
 * detail既存でも親のocrExcerptが欠けていればexcerptのみ書く。seed-dev-data.ts等の
 * 「detailはdual-writeするがexcerptは書かない」経路で作られたdocを収束させるため)。
 *
 * カウンタ加算はトランザクションの**外**で行う (review A1指摘反映: Firestoreは競合時に
 * トランザクションコールバックを再実行するため、コールバック内で加算すると
 * 「attempt1でwritten++→commit失敗→attempt2でskip判定」のような経路で
 * 実際には書き込まれていないdocがwrittenに計上される)。
 */
async function backfillOneDoc(docId: string, counters: BackfillCounters): Promise<void> {
  const docRef = db.doc(`documents/${docId}`);
  const detailRef = docRef.collection('detail').doc('main');
  try {
    const outcome = await db.runTransaction<BackfillOutcome>(async (tx) => {
      const [parentSnap, detailSnap] = await tx.getAll(docRef, detailRef);
      if (!parentSnap.exists) {
        // スキャン後に削除された(削除同期は deleteDocument.ts が担保)
        return 'parent-deleted';
      }
      const data = parentSnap.data()!;
      const decision = decideBackfillAction({
        status: data.status,
        detailExists: detailSnap.exists,
        hasOcrExcerpt: typeof data.ocrExcerpt === 'string',
      });
      if (decision === 'skip-in-pipeline' || decision === 'skip-complete') {
        // スキャン後に並行処理がdetail/main+excerptを書いた or statusがin-pipelineに変わった(正常系)
        return 'decision-changed';
      }
      if (decision === 'backfill-detail-and-excerpt') {
        tx.create(detailRef, buildDetailPayload(data));
      }
      tx.update(docRef, {
        ocrExcerpt: buildOcrExcerpt(
          typeof data.ocrResult === 'string' ? data.ocrResult : '',
          typeof data.ocrResultUrl === 'string' ? data.ocrResultUrl : null
        ),
      });
      return decision === 'backfill-detail-and-excerpt' ? 'written-detail-and-excerpt' : 'written-excerpt-only';
    });
    if (outcome === 'written-detail-and-excerpt') counters.writtenDetailAndExcerpt++;
    else if (outcome === 'written-excerpt-only') counters.writtenExcerptOnly++;
    else if (outcome === 'parent-deleted') counters.parentDeleted++;
    else counters.decisionChanged++;
  } catch (err) {
    counters.errors++;
    // 個人情報保護: エラー種別のみ出力(メッセージ本文にStorageパス等が含まれうるため)
    const name = err instanceof Error ? err.constructor.name : typeof err;
    console.warn(`[backfillOneDoc] 失敗 docId=${docId} (${name})`);
  }
}

/** 不一致件数と、報告用のサンプルdoc ID(上限MISMATCH_SAMPLE_LIMIT)を保持する */
class MismatchTally {
  count = 0;
  samples: string[] = [];
  add(docId: string): void {
    this.count++;
    if (this.samples.length < MISMATCH_SAMPLE_LIMIT) this.samples.push(docId);
  }
  toString(): string {
    return `${this.count}${this.samples.length > 0 ? ` (sample: ${this.samples.join(', ')})` : ''}`;
  }
}

interface VerifyResult {
  checked: number;
  ocrResultMismatch: MismatchTally;
  pageResultsMismatch: MismatchTally;
  ocrExcerptMismatch: MismatchTally;
  detailMissing: MismatchTally;
  inPipeline: number;
  errors: number;
}

/**
 * parity検証: in-pipeline以外の全docについて親とdetail/mainを読み、
 * ocrResult/pageResultsのcanonical hash一致と、ocrExcerptの再計算一致を確認する。
 * 「親にフィールドが存在するのにdetail側に無い/値が異なる」を不一致として数える
 * (親に無いフィールドはdetail側にも無くてよい — buildDetailPayloadと同じ規則)。
 */
async function verifyOneDoc(docId: string, result: VerifyResult): Promise<void> {
  const docRef = db.doc(`documents/${docId}`);
  const detailRef = docRef.collection('detail').doc('main');
  try {
    const [parentSnap, detailSnap] = await db.getAll(docRef, detailRef);
    if (!parentSnap.exists) return; // 検証中に削除された(削除同期済みなら不一致ではない)
    const parent = parentSnap.data()!;

    // in-pipeline判定はexecuteパスと同一関数を通す (review D5指摘反映: 判定ロジックが
    // 二重実装だと将来の変更でexecute/verifyが静かに乖離する)
    if (
      decideBackfillAction({
        status: parent.status,
        detailExists: detailSnap.exists,
        hasOcrExcerpt: typeof parent.ocrExcerpt === 'string',
      }) === 'skip-in-pipeline'
    ) {
      result.inPipeline++;
      return;
    }
    result.checked++;

    if (!detailSnap.exists) {
      result.detailMissing.add(docId);
      return;
    }
    const detail = detailSnap.data()!;

    if (typeof parent.ocrResult === 'string') {
      if (canonicalHash(parent.ocrResult) !== canonicalHash(detail.ocrResult)) {
        result.ocrResultMismatch.add(docId);
      }
    }
    if (Array.isArray(parent.pageResults)) {
      if (canonicalHash(parent.pageResults) !== canonicalHash(detail.pageResults)) {
        result.pageResultsMismatch.add(docId);
      }
    }

    const expectedExcerpt = buildOcrExcerpt(
      typeof parent.ocrResult === 'string' ? parent.ocrResult : '',
      typeof parent.ocrResultUrl === 'string' ? parent.ocrResultUrl : null
    );
    if (parent.ocrExcerpt !== expectedExcerpt) {
      result.ocrExcerptMismatch.add(docId);
    }
  } catch (err) {
    result.errors++;
    const name = err instanceof Error ? err.constructor.name : typeof err;
    console.warn(`[verifyOneDoc] 読込失敗 docId=${docId} (${name})`);
  }
}

async function main(): Promise<void> {
  const { mode, limit } = parseArgs();
  console.log(`=== detail/main backfill (ADR-0018 Phase C, Issue #547) ===`);
  console.log(`プロジェクト: ${PROJECT_ID} / モード: ${mode}${limit ? ` / limit: ${limit}` : ''}`);
  console.log('個人情報はログに出力しません(件数とdoc IDのみ)。');

  const [docs, parentIdsWithDetail] = await Promise.all([scanAllDocuments(), fetchParentIdsWithDetail()]);
  const classification = classify(docs, parentIdsWithDetail);
  printClassification(classification);

  if (mode === 'audit') {
    console.log('\n=== audit完了 (read-only、書込なし) ===');
    return;
  }

  if (mode === 'dry-run') {
    const sample = classification.targets.slice(0, 10).map((t) => t.id);
    console.log(`\nbackfill対象サンプル(最大10件): ${sample.join(', ') || '(なし)'}`);
    console.log('\n=== dry-run完了 (read-only、書込なし) ===');
    return;
  }

  if (mode === 'execute') {
    let targets = classification.targets;
    if (limit > 0) {
      targets = targets.slice(0, limit);
      console.log(`\n--limit ${limit} 指定によりcanary実行: 対象を先頭${targets.length}件に制限`);
    }
    if (targets.length === 0) {
      console.log('\n✅ backfill対象0件(冪等: 全doc処理済み or 対象なし)');
      return;
    }
    console.log(
      `\n--- backfill実行: ${targets.length}件 (concurrency=${CONCURRENCY}, 起動間隔${EXECUTE_START_INTERVAL_MS}ms ≈ ${(1000 / EXECUTE_START_INTERVAL_MS).toFixed(1)} docs/sec) ---`
    );
    const started = Date.now();
    await runWithRateControl(targets, EXECUTE_START_INTERVAL_MS, (t) =>
      backfillOneDoc(t.id, classification.counters)
    );
    const c = classification.counters;
    console.log(`\n--- 実行結果 (${Math.round((Date.now() - started) / 1000)}秒) ---`);
    console.log(`書込成功(detail+excerpt作成): ${c.writtenDetailAndExcerpt}`);
    console.log(`書込成功(excerptのみ補完): ${c.writtenExcerptOnly}`);
    console.log(`実行時skip(並行処理がdetail+excerpt作成/status変更、正常系): ${c.decisionChanged}`);
    console.log(
      `実行時skip(スキャン後に親doc削除): ${c.parentDeleted}` +
        (c.parentDeleted > 0 ? ' ⚠️ 想定外に多い場合は削除経路を調査すること' : '')
    );
    console.log(`エラー: ${c.errors}`);
    if (c.errors > 0) {
      console.error('❌ エラーが発生したdocがあります。再実行(冪等)で解消するか確認してください。');
      process.exitCode = 1;
    } else {
      console.log('✅ execute完了。次: 同モード再実行で書込0件(冪等性確認) → --verify');
    }
    return;
  }

  // mode === 'verify' — 読取専用でトリガー発火なしのため起動間隔0(concurrency制限のみ)
  const verifyTargets = docs.map((d) => d.id);
  console.log(`\n--- parity検証: ${verifyTargets.length}件 (in-pipelineは判定時に除外) ---`);
  const result: VerifyResult = {
    checked: 0,
    ocrResultMismatch: new MismatchTally(),
    pageResultsMismatch: new MismatchTally(),
    ocrExcerptMismatch: new MismatchTally(),
    detailMissing: new MismatchTally(),
    inPipeline: 0,
    errors: 0,
  };
  await runWithRateControl(verifyTargets, 0, (id) => verifyOneDoc(id, result));

  console.log(`\n--- 検証結果 ---`);
  console.log(`検証対象: ${result.checked} / in-pipeline除外: ${result.inPipeline} / 読込エラー: ${result.errors}`);
  console.log(`detail/main不在: ${result.detailMissing}`);
  if (result.detailMissing.count > 0) {
    console.log(
      '  ℹ️ detail/main不在には「execute実行中にin-pipelineだったdocがその後error等に遷移した」' +
        'ケースが含まれうる — その場合は--executeを再実行(冪等)してから--verifyし直すこと (review A6)'
    );
  }
  console.log(`ocrResult不一致: ${result.ocrResultMismatch}`);
  console.log(`pageResults不一致: ${result.pageResultsMismatch}`);
  console.log(`ocrExcerpt不一致: ${result.ocrExcerptMismatch}`);
  console.log(
    `\n[Phase D投入ゲート情報] in-pipeline (${IN_PIPELINE_STATUSES.join('/')}) 件数: ${result.inPipeline} — Phase D-FE投入時点でゼロであることを別途確認 (ADR-0018 Phase C行)`
  );

  const mismatchTotal =
    result.detailMissing.count +
    result.ocrResultMismatch.count +
    result.pageResultsMismatch.count +
    result.ocrExcerptMismatch.count;
  if (mismatchTotal > 0 || result.errors > 0) {
    console.error(`❌ FAIL: 不一致${mismatchTotal}件 / エラー${result.errors}件`);
    process.exitCode = 1;
  } else {
    console.log('✅ PASS: 全doc parity一致');
  }
}

// firebase-adminのgRPCハンドルがイベントループに残りプロセスが自然終了しないため明示exit
// (compare-gemini-ocr-models-confirmed.ts と同じ規約)
main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    const name = err instanceof Error ? err.constructor.name : typeof err;
    console.error(`❌ 致命的エラー (${name})`);
    process.exit(1);
  });
