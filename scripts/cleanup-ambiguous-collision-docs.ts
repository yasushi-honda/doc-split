#!/usr/bin/env ts-node
/**
 * Issue #492: Ambiguous collision docs cleanup (方針 A データ駆動版)
 *
 * 同名・同 Storage path を共有する重複 Firestore docs (Issue #432 復旧で
 * manual-review 除外された Ambiguous 群) を winner 1 件残しで削除する。
 *
 * 安全装置 (cleanup 本経路 = dry-run / --execute):
 *   - dry-run デフォルト。--execute 明示時のみ削除
 *   - plan JSON (scripts/plans/) に winner/loser を固定。projectId 二重照合
 *   - preconditions all-or-nothing (scripts/lib/ambiguousCleanup.ts 参照)。
 *     ユーザーが触った doc (verified / editedAt / rotatedAt) は削除禁止
 *   - 削除前に winner+loser 全フィールド JSON バックアップを必ず出力
 *   - 件数厳密アサーション (plan.expectedLoserCount と 1 件でもずれたら abort)
 *   - Storage 実体は一切触らない (winner が同一ファイルを参照継続)。
 *     cleanup 本経路は Storage の read (existence check) のみで delete API を呼ばない
 *   - --execute は STORAGE_BUCKET 必須 (事後検証を欠いた削除を構造的に排除)
 *   - 事後検証: loser 不在 / winner 現存 / winner の実 fileUrl が指す Storage 実体現存
 *   - 未知フラグは exit 2 (typo が黙って dry-run に化けるのを防ぐ)
 *
 * ※ 例外経路: --seed-dev-fixture / --cleanup-fixture は dev 専用 (assertDevOnly
 *    ガード) で、fixture の Storage 実体の作成・削除を行う。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=<project-id> STORAGE_BUCKET=<bucket> \
 *     npx ts-node scripts/cleanup-ambiguous-collision-docs.ts \
 *       [--plan <path>] [--dry-run] [--execute] [--backup-out <path>]
 *       [--seed-dev-fixture [--seed-violation]] [--cleanup-fixture]
 *
 *   --plan 省略時は FIREBASE_PROJECT_ID から plans/ 配下を自動選択
 *   --dry-run: 明示フラグ (デフォルト挙動と同じ。workflow choice の可読性用)
 *   --seed-dev-fixture: dev 専用。fixture plan と一致する合成 docs を投入
 *   --seed-violation: fixture の loser 1 件に editedAt を付与 (reject 経路の実証用)
 *   --cleanup-fixture: dev 専用。fixture docs + Storage 実体を削除
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument } from 'pdf-lib';
import {
  CleanupPlan,
  DocState,
  validatePlanStructure,
  evaluatePreconditions,
} from './lib/ambiguousCleanup';

const projectId = process.env.FIREBASE_PROJECT_ID;
const storageBucket = process.env.STORAGE_BUCKET;

if (!projectId) {
  console.error('FIREBASE_PROJECT_ID を設定してください');
  process.exit(1);
}

function getOpt(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

// 未知フラグ reject: typo (--exeucte 等) が黙って dry-run に化けるのを防ぐ
const KNOWN_FLAGS = new Set([
  '--execute',
  '--dry-run',
  '--seed-dev-fixture',
  '--seed-violation',
  '--cleanup-fixture',
]);
const VALUE_OPTS = new Set(['--plan', '--backup-out']);
{
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (VALUE_OPTS.has(a)) {
      i++; // 値をスキップ
      continue;
    }
    if (a.startsWith('--') && !KNOWN_FLAGS.has(a)) {
      console.error(`FATAL: 未知のフラグ: ${a} (有効: ${[...KNOWN_FLAGS, ...VALUE_OPTS].join(' ')})`);
      process.exit(2);
    }
  }
}

const execute = process.argv.includes('--execute');
const seedDevFixture = process.argv.includes('--seed-dev-fixture');
const seedViolation = process.argv.includes('--seed-violation');
const cleanupFixture = process.argv.includes('--cleanup-fixture');
const planPathOpt = getOpt('--plan');

// --execute は事後検証 (Storage 実体現存チェック) まで含めて 1 セット。
// STORAGE_BUCKET なしの削除実行を構造的に排除する (silent-failure review 反映)
if (execute && !storageBucket) {
  console.error('FATAL: --execute には STORAGE_BUCKET が必須です (事後検証に使用)');
  process.exit(2);
}
const backupOut =
  getOpt('--backup-out') ||
  path.join(process.cwd(), `cleanup-ambiguous-backup-${projectId}.json`);

// plan 自動選択: projectId → plans/ 配下。未知 projectId は明示 --plan 必須
function resolvePlanPath(): string {
  if (planPathOpt) return planPathOpt;
  if (projectId === 'docsplit-kanameone') {
    return path.join(__dirname, 'plans', 'cleanup-ambiguous-492-kanameone.json');
  }
  if (projectId!.includes('dev')) {
    return path.join(__dirname, 'plans', 'cleanup-ambiguous-492-dev-fixture.json');
  }
  console.error(
    `FATAL: projectId=${projectId} 用の既定 plan がありません。--plan で明示してください。`
  );
  process.exit(2);
}

admin.initializeApp(
  storageBucket ? { projectId, storageBucket } : { projectId }
);
const db = admin.firestore();

function loadPlan(planPath: string): CleanupPlan {
  let plan: CleanupPlan;
  try {
    plan = JSON.parse(fs.readFileSync(planPath, 'utf-8')) as CleanupPlan;
  } catch (err) {
    // SyntaxError にはファイルパスが含まれないため文脈を付けて rethrow
    console.error(`FATAL: plan の読込/parse に失敗: ${planPath}`);
    throw err;
  }
  const structErrors = validatePlanStructure(plan);
  if (structErrors.length > 0) {
    console.error('FATAL: plan 構造エラー:');
    for (const e of structErrors) console.error(`  - ${e}`);
    process.exit(2);
  }
  if (plan.projectId !== projectId) {
    console.error(
      `FATAL: plan.projectId=${plan.projectId} と FIREBASE_PROJECT_ID=${projectId} が不一致`
    );
    process.exit(2);
  }
  return plan;
}

function gsUrl(fileName: string): string {
  return `gs://${storageBucket}/processed/${fileName}`;
}

/** dev 専用ガード */
function assertDevOnly(op: string): void {
  if (!projectId!.includes('dev')) {
    console.error(`FATAL: ${op} は dev 環境専用です (projectId=${projectId})`);
    process.exit(2);
  }
  if (!storageBucket) {
    console.error(`FATAL: ${op} には STORAGE_BUCKET が必要です`);
    process.exit(2);
  }
}

async function seedFixture(plan: CleanupPlan): Promise<void> {
  assertDevOnly('--seed-dev-fixture');
  const bucket = admin.storage().bucket();

  // 親 doc
  const parentId = plan.groups[0].parentDocumentId;
  await db.collection('documents').doc(parentId).set({
    fileName: 'fixture492-parent.pdf',
    status: 'processed',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    fixture: 'issue-492-cleanup',
  });

  for (const [gi, g] of plan.groups.entries()) {
    // 共有 Storage 実体 (1 グループ 1 ファイル)
    const pdf = await PDFDocument.create();
    pdf.addPage([200, 200]);
    const bytes = await pdf.save();
    await bucket.file(`processed/${g.fileName}`).save(Buffer.from(bytes), {
      contentType: 'application/pdf',
    });

    const fileUrl = gsUrl(g.fileName);
    const docIds = [g.winnerDocId, ...g.loserDocIds];
    for (const [di, docId] of docIds.entries()) {
      const isWinner = di === 0;
      const data: Record<string, unknown> = {
        fileName: g.fileName,
        fileUrl,
        parentDocumentId: g.parentDocumentId,
        status: 'processed',
        customerName: '未判定',
        documentType: '未判定',
        // グループ 1 の winner のみ verified=true (本番 p1-4 / p23-24 相当)
        verified: isWinner && gi === 0,
        customerConfirmed: isWinner && gi === 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        fixture: 'issue-492-cleanup',
      };
      // reject 経路実証: 最初のグループの loser-a に editedAt を付与
      if (seedViolation && gi === 0 && docId === g.loserDocIds[0]) {
        data.editedAt = admin.firestore.FieldValue.serverTimestamp();
      }
      await db.collection('documents').doc(docId).set(data);
    }
  }
  console.log(
    `✅ fixture 投入完了: parent 1 + docs ${plan.groups.reduce((n, g) => n + 1 + g.loserDocIds.length, 0)} 件` +
      (seedViolation ? ' (violation: グループ1 loser-a に editedAt 付与)' : '')
  );
}

async function removeFixture(plan: CleanupPlan): Promise<void> {
  assertDevOnly('--cleanup-fixture');
  const bucket = admin.storage().bucket();
  const ids = new Set<string>([plan.groups[0].parentDocumentId]);
  for (const g of plan.groups) {
    ids.add(g.winnerDocId);
    for (const id of g.loserDocIds) ids.add(id);
  }
  for (const id of ids) {
    // fixture マーカー付き doc のみ削除 (実データ巻き込み防止)
    const snap = await db.collection('documents').doc(id).get();
    if (snap.exists && snap.data()?.fixture === 'issue-492-cleanup') {
      await snap.ref.delete();
    }
  }
  for (const g of plan.groups) {
    // 404 のみ冪等扱い。permission/transient エラーは握り潰さず fail させる
    // (Codex review P2: silent cleanup failure 防止)
    await bucket
      .file(`processed/${g.fileName}`)
      .delete()
      .catch((err: { code?: number }) => {
        if (err.code === 404) return undefined;
        throw err;
      });
  }
  console.log(`✅ fixture 削除完了 (docs ${ids.size} 件 + Storage ${plan.groups.length} 件)`);
}

interface FetchedStates {
  states: Map<string, DocState>;
  /** 検証時点の snapshot updateTime。削除時の lastUpdateTime precondition に使う */
  updateTimes: Map<string, FirebaseFirestore.Timestamp>;
}

async function fetchDocStates(plan: CleanupPlan): Promise<FetchedStates> {
  const ids: string[] = [];
  for (const g of plan.groups) {
    ids.push(g.winnerDocId, ...g.loserDocIds);
  }
  const refs = ids.map((id) => db.collection('documents').doc(id));
  const snaps = await db.getAll(...refs);
  const states = new Map<string, DocState>();
  const updateTimes = new Map<string, FirebaseFirestore.Timestamp>();
  snaps.forEach((snap, i) => {
    states.set(ids[i], { exists: snap.exists, data: snap.data() as Record<string, unknown> });
    if (snap.exists && snap.updateTime) {
      updateTimes.set(ids[i], snap.updateTime);
    }
  });
  return { states, updateTimes };
}

function writeBackup(plan: CleanupPlan, docs: Map<string, DocState>): void {
  const backup = {
    createdAt: new Date().toISOString(),
    projectId,
    planIssue: plan.issue,
    note: 'Issue #492 cleanup 前の全対象 doc スナップショット (winner 含む)。Timestamp は {_seconds,_nanoseconds} 形式。',
    docs: Object.fromEntries(
      [...docs.entries()].map(([id, s]) => [id, s.exists ? s.data : null])
    ),
  };
  fs.writeFileSync(backupOut, JSON.stringify(backup, null, 2));
  console.log(`📦 バックアップ出力: ${backupOut} (${docs.size} docs)`);
}

async function main(): Promise<void> {
  const planPath = resolvePlanPath();
  console.log('=== Issue #492 Ambiguous collision docs cleanup ===');
  console.log(`project: ${projectId}`);
  console.log(`plan: ${planPath}`);
  const plan = loadPlan(planPath);
  console.log(`  groups=${plan.groups.length}, expectedLoserCount=${plan.expectedLoserCount}`);
  // mode 表示は実際の動作と一致させる (fixture 系は --execute なしで書き込む dev 専用経路)
  const mode = cleanupFixture
    ? '⚠️ fixture-cleanup (dev: fixture docs + Storage 実体を削除)'
    : seedDevFixture
      ? 'fixture-seed (dev: fixture docs + Storage 実体を作成)'
      : execute
        ? '⚠️ EXECUTE (削除実行)'
        : 'dry-run (Firestore/Storage 書き込みなし。バックアップ JSON のみローカル出力)';
  console.log(`mode: ${mode}`);

  if (cleanupFixture) {
    await removeFixture(plan);
    return;
  }
  if (seedDevFixture) {
    await seedFixture(plan);
    return;
  }

  // 1. 現状取得
  const { states: docs, updateTimes } = await fetchDocStates(plan);

  // 2. バックアップ (dry-run でも出力し、レビュー材料にする)
  writeBackup(plan, docs);

  // 3. preconditions (all-or-nothing)
  const { violations, deletions } = evaluatePreconditions(plan, docs);
  if (violations.length > 0) {
    console.error(`❌ precondition 違反 ${violations.length} 件。削除は一切行いません:`);
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }

  console.log(`✅ preconditions 全通過。削除対象 ${deletions.length} 件:`);
  for (const d of deletions) {
    console.log(`  - ${d.docId} (${d.fileName}, winner=${d.winnerDocId})`);
  }

  if (!execute) {
    console.log('dry-run 終了 (削除するには --execute を指定)');
    return;
  }

  // 4. 削除実行 (Firestore doc のみ。Storage は不可侵)
  // Codex review P1 反映:
  //   - 単一 atomic batch commit (全成功 or 全失敗。部分削除状態を作らない)
  //   - lastUpdateTime precondition (検証後に doc が更新されていたら batch ごと fail
  //     = 検証〜削除間の TOCTOU でユーザー操作済み doc を消さない)
  if (deletions.length !== plan.expectedLoserCount) {
    console.error(
      `❌ 削除対象件数不一致: expected=${plan.expectedLoserCount} actual=${deletions.length}`
    );
    process.exit(1);
  }
  const batch = db.batch();
  for (const d of deletions) {
    const lastUpdateTime = updateTimes.get(d.docId);
    if (!lastUpdateTime) {
      console.error(`❌ ${d.docId} の updateTime が取得できず precondition を構成できません`);
      process.exit(1);
    }
    batch.delete(db.collection('documents').doc(d.docId), { lastUpdateTime });
  }
  try {
    await batch.commit();
  } catch (err) {
    // gRPC FAILED_PRECONDITION (code 9) = lastUpdateTime 不一致 = 検証後に doc が更新された
    const isPreconditionFailure = (err as { code?: number }).code === 9;
    console.error(
      '❌ batch 削除が失敗しました (atomic のため部分削除はありません)。' +
        (isPreconditionFailure
          ? '検証後に doc が更新されています (lastUpdateTime precondition 不一致)。再実行前に dry-run で状態を確認してください。'
          : '一時的エラー/権限エラーの可能性があります。原因解消後に dry-run から再実行してください。')
    );
    console.error(err);
    process.exit(1);
  }
  console.log(`🗑️ 削除完了: ${deletions.length} 件 (atomic batch + lastUpdateTime precondition)`);

  // 5. 事後検証
  const { states: after } = await fetchDocStates(plan);
  const postErrors: string[] = [];
  for (const g of plan.groups) {
    if (!after.get(g.winnerDocId)?.exists) {
      postErrors.push(`winner ${g.winnerDocId} が消えている (${g.fileName})`);
    }
    for (const id of g.loserDocIds) {
      if (after.get(id)?.exists) {
        postErrors.push(`loser ${id} が残存 (${g.fileName})`);
      }
    }
  }
  // Storage 実体の現存確認は winner の実 fileUrl から object path を導出する
  // (`processed/${fileName}` の再構築は split 由来 doc の docId namespace 形式
  //  `processed/{docId}/{fileName}` と乖離しうる — code review Important 反映)。
  // fileUrl は preconditions で非空を検証済み。STORAGE_BUCKET は --execute で必須。
  const bucket = admin.storage().bucket();
  for (const g of plan.groups) {
    const winnerFileUrl = docs.get(g.winnerDocId)?.data?.fileUrl as string;
    const m = winnerFileUrl.match(/^gs:\/\/([^/]+)\/(.+)$/);
    if (!m) {
      postErrors.push(`winner ${g.winnerDocId} の fileUrl が gs:// 形式でない: ${winnerFileUrl}`);
      continue;
    }
    const [, urlBucket, objectPath] = m;
    if (urlBucket !== storageBucket) {
      postErrors.push(
        `winner ${g.winnerDocId} の fileUrl bucket (${urlBucket}) が STORAGE_BUCKET (${storageBucket}) と不一致`
      );
      continue;
    }
    const [exists] = await bucket.file(objectPath).exists();
    if (!exists) {
      postErrors.push(`Storage 実体 ${objectPath} が不在 (winner ${g.winnerDocId} が閲覧不能)`);
    }
  }

  if (postErrors.length > 0) {
    console.error('❌ 事後検証エラー:');
    for (const e of postErrors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(
    `✅ 事後検証 OK: winner ${plan.groups.length} 件現存 / loser ${plan.expectedLoserCount} 件削除済 / Storage 実体現存`
  );
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
