#!/usr/bin/env ts-node
/**
 * Issue #432 PR-C: dev 環境に 5 分類網羅 fixture を投入 (idempotent)
 *
 * 目的 (Codex Critical 反映): cocoro 環境は被害ゼロ (0 件 no-op) のため
 * execute-collision-migration.ts の execute path が kanameone 本番で初動するリスク。
 * dev に意図的な衝突 + orphan を作り、execute path を全分類で実環境前検証する。
 *
 * 投入内容 (planId が `pr-c-fixture-*` 固定で識別可能):
 *   - parent doc (5 page) + Storage 実体
 *   - MatchedByHash 衝突 group: 2 child docs 同 fileName, 1 件は hash 一致 PDF (parent から再生成),
 *     1 件は hash 不一致 PDF を upload
 *   - Ambiguous group: 2 child docs 同 fileName, 両方とも hash 不一致 (rotatedAt は片方 set)
 *   - RepairableMissingFile orphan: child doc with parent 在 + splitFromPages 在, Storage upload なし
 *   - LostOrUnrecoverable orphan: child doc with parentDocumentId=null
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=doc-split-dev STORAGE_BUCKET=doc-split-dev.firebasestorage.app \
 *     npx ts-node scripts/setup-collision-fixture.ts [--cleanup]
 *
 * --cleanup: fixture を削除する (再投入前のリセット用)
 */

import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { PDFDocument } from 'pdf-lib';

const projectId = process.env.FIREBASE_PROJECT_ID;
const storageBucket = process.env.STORAGE_BUCKET;

if (!projectId) {
  console.error('FIREBASE_PROJECT_ID を設定してください');
  process.exit(1);
}
if (!storageBucket) {
  console.error('STORAGE_BUCKET を設定してください');
  process.exit(1);
}

// 安全策: fixture は dev 環境専用 (本番事故防止)
if (!projectId.includes('dev')) {
  console.error(
    `FATAL: setup-collision-fixture は dev 環境専用です。projectId=${projectId} は dev を含みません。`
  );
  process.exit(2);
}

const cleanup = process.argv.includes('--cleanup');

admin.initializeApp({ projectId, storageBucket });
const db = admin.firestore();
const bucket = admin.storage().bucket();

const FIXTURE_PREFIX = 'processed/';
// F-A1: parent PDF は実環境同様 `original/` 配下に置く (旧版は processed/ に置いていて
// classify が parent 不在を見落とす欠陥を隠蔽していた)。
const PARENT_PREFIX = 'original/';
const PARENT_DOC_ID = 'pr-c-fixture-parent';
const FIXTURE_DOC_IDS = {
  PARENT: PARENT_DOC_ID,
  MATCHED_WINNER: 'pr-c-fixture-matched-winner',
  MATCHED_LOSER: 'pr-c-fixture-matched-loser',
  AMBIGUOUS_A: 'pr-c-fixture-ambiguous-a',
  AMBIGUOUS_B: 'pr-c-fixture-ambiguous-b',
  REPAIRABLE_ORPHAN: 'pr-c-fixture-repairable-orphan',
  LOST_ORPHAN: 'pr-c-fixture-lost-orphan',
};
const COLLISION_FILENAME = '20260101_fixture_未判定_未判定_p1.pdf';
const AMBIGUOUS_FILENAME = '20260102_fixture_未判定_未判定_p2.pdf';
const REPAIRABLE_FILENAME = '20260103_fixture_未判定_未判定_p3.pdf';
const LOST_FILENAME = '20260104_fixture_未判定_未判定_p4.pdf';

// parent PDF: 5 pages, content をページ番号で区別 (hash 比較対象として必要)
async function makeParentPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 5; i++) {
    const page = pdf.addPage([100, 100]);
    // 各ページに違う矩形を描画して hash 区別を確保 (font 不要)
    page.drawRectangle({ x: 10 + i * 5, y: 10 + i * 5, width: 30, height: 30 });
  }
  return Buffer.from(await pdf.save());
}

// 別 PDF (mismatched 用): 全く異なる構造
async function makeUnrelatedPdf(seed: number): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([200, 200]);
  page.drawRectangle({
    x: seed * 10,
    y: seed * 10,
    width: 50,
    height: 50,
  });
  return Buffer.from(await pdf.save());
}

/**
 * PR-C2: 別 Node プロセスを spawn して `regenerateChildPdf(parent, start, end)` を
 * 実行し、その bytes を Storage upload 用に取り出す。setup プロセスと classify プロセスが
 * 別 process である本番条件を fixture でも再現することで、「visual fingerprint が
 * cross-process で一致する」ことを fixture 検証で実証する (Codex Important 反映)。
 *
 * 失敗時は throw して setup を中止する。
 */
function regenerateChildPdfInOtherProcess(
  parentPdfBuffer: Buffer,
  startPage: number,
  endPage: number
): Buffer {
  const parentTmp = path.join(
    os.tmpdir(),
    `fixture-parent-${crypto.randomBytes(4).toString('hex')}.pdf`
  );
  const outTmp = path.join(
    os.tmpdir(),
    `fixture-child-${crypto.randomBytes(4).toString('hex')}.pdf`
  );
  const regenModule = path.resolve(__dirname, './lib/pdfRegenerator');
  const script = `
    const fs = require('fs');
    const { regenerateChildPdf } = require(${JSON.stringify(regenModule)});
    (async () => {
      const parent = fs.readFileSync(${JSON.stringify(parentTmp)});
      const child = await regenerateChildPdf(parent, ${startPage}, ${endPage});
      fs.writeFileSync(${JSON.stringify(outTmp)}, child);
    })().catch((err) => {
      process.stderr.write(err.stack || err.message);
      process.exit(1);
    });
  `;
  const scriptTmp = path.join(
    os.tmpdir(),
    `fixture-spawn-${crypto.randomBytes(4).toString('hex')}.js`
  );
  fs.writeFileSync(parentTmp, parentPdfBuffer);
  fs.writeFileSync(scriptTmp, script);
  try {
    const result = spawnSync(
      process.execPath,
      ['--require', 'ts-node/register', scriptTmp],
      {
        encoding: 'utf-8',
        timeout: 30000,
        cwd: path.resolve(__dirname, '../'),
      }
    );
    // Critical (silent-failure-hunter PR #441 review): spawn 自体の失敗 (ENOENT 等) /
    // signal kill (SIGTERM by timeout) / outTmp 未書き込み を握りつぶすと、壊れた or
    // 古い winner PDF を MatchedByHash fixture として upload してしまい、本番条件
    // (cross-process MatchedByHash 成立) を fixture で破る silent failure になる。
    if (result.error) {
      throw new Error(
        `cross-process regenerate spawn failed: ${result.error.message} (signal=${result.signal ?? '<none>'})`
      );
    }
    if (result.signal) {
      throw new Error(
        `cross-process regenerate killed by signal=${result.signal} stderr=${result.stderr}`
      );
    }
    if (result.status !== 0) {
      throw new Error(
        `cross-process regenerate exit=${result.status} stderr=${result.stderr}`
      );
    }
    if (!fs.existsSync(outTmp)) {
      throw new Error(
        `cross-process regenerate reported success (status=0) but outTmp was not written: ${outTmp}`
      );
    }
    const buf = fs.readFileSync(outTmp);
    if (buf.length === 0) {
      throw new Error(`cross-process regenerate produced empty file: ${outTmp}`);
    }
    return buf;
  } finally {
    // ENOENT 以外の cleanup 失敗は log だけ残す (disk full 等の検知)
    for (const p of [parentTmp, outTmp, scriptTmp]) {
      try {
        fs.unlinkSync(p);
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code !== 'ENOENT') {
          console.warn(`tmp cleanup failed path=${p} code=${code}: ${(err as Error).message}`);
        }
      }
    }
  }
}

async function uploadPdf(path: string, buf: Buffer): Promise<void> {
  await bucket.file(path).save(buf, {
    metadata: { contentType: 'application/pdf' },
  });
}

async function setDoc(
  id: string,
  data: admin.firestore.DocumentData
): Promise<void> {
  await db.doc(`documents/${id}`).set(data);
}

async function deleteDocIfExists(id: string): Promise<void> {
  const ref = db.doc(`documents/${id}`);
  const snap = await ref.get();
  if (snap.exists) await ref.delete();
}

async function deleteFileIfExists(path: string): Promise<void> {
  try {
    await bucket.file(path).delete();
  } catch {
    /* ignore not-found */
  }
}

async function doCleanup(): Promise<void> {
  console.log('Cleaning up fixture...');
  for (const id of Object.values(FIXTURE_DOC_IDS)) {
    await deleteDocIfExists(id);
  }
  // Storage cleanup: parent + collision + ambiguous (orphan は元々なし)
  // 旧 path (= 旧 fileUrl 形式) と新 docId namespace 形式の両方掃除
  const pathsToDelete = [
    `${PARENT_PREFIX}${PARENT_DOC_ID}.pdf`, // F-A1: parent は original/ 配下
    `${FIXTURE_PREFIX}${PARENT_DOC_ID}.pdf`, // 旧 fixture 残存 (互換 cleanup)
    `${FIXTURE_PREFIX}${COLLISION_FILENAME}`, // 旧形式 (collision)
    `${FIXTURE_PREFIX}${AMBIGUOUS_FILENAME}`, // 旧形式 (ambiguous)
    `${FIXTURE_PREFIX}${FIXTURE_DOC_IDS.MATCHED_WINNER}/${COLLISION_FILENAME}`,
    `${FIXTURE_PREFIX}${FIXTURE_DOC_IDS.MATCHED_LOSER}/${COLLISION_FILENAME}`,
    `${FIXTURE_PREFIX}${FIXTURE_DOC_IDS.AMBIGUOUS_A}/${AMBIGUOUS_FILENAME}`,
    `${FIXTURE_PREFIX}${FIXTURE_DOC_IDS.AMBIGUOUS_B}/${AMBIGUOUS_FILENAME}`,
    `${FIXTURE_PREFIX}${FIXTURE_DOC_IDS.REPAIRABLE_ORPHAN}/${REPAIRABLE_FILENAME}`,
  ];
  for (const path of pathsToDelete) {
    await deleteFileIfExists(path);
  }
  console.log('Cleanup complete.');
}

async function main(): Promise<void> {
  console.log(`Project: ${projectId}`);
  console.log(`Bucket : ${storageBucket}`);

  if (cleanup) {
    await doCleanup();
    await admin.app().delete();
    return;
  }

  // 既存 fixture を削除してから再投入 (idempotent)
  await doCleanup();

  console.log('\nGenerating parent PDF...');
  const parentBuf = await makeParentPdf();
  // F-A1: parent は original/ 配下 (実環境同様)。classify-collision-docs.ts が `processed/`
  // Storage 一覧だけで parent 不在判定する欠陥を再発見させない。
  const parentPath = `${PARENT_PREFIX}${PARENT_DOC_ID}.pdf`;
  await uploadPdf(parentPath, parentBuf);
  await setDoc(PARENT_DOC_ID, {
    id: PARENT_DOC_ID,
    status: 'split',
    fileName: 'pr-c-fixture-parent.pdf',
    fileUrl: `gs://${storageBucket}/${parentPath}`,
    isSplitSource: true,
    splitInto: [
      FIXTURE_DOC_IDS.MATCHED_WINNER,
      FIXTURE_DOC_IDS.MATCHED_LOSER,
      FIXTURE_DOC_IDS.AMBIGUOUS_A,
      FIXTURE_DOC_IDS.AMBIGUOUS_B,
      FIXTURE_DOC_IDS.REPAIRABLE_ORPHAN,
    ],
    totalPages: 5,
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // ── MatchedByHash group ──
  // 旧形式 fileUrl で衝突: 両 child docs が `processed/{COLLISION_FILENAME}` を指す
  // Storage には MATCHED_WINNER の期待 fingerprint と一致する PDF を 1 つだけ upload。
  //
  // PR-C2 (Codex Important 反映): winner PDF は **別 Node プロセス** で生成する。
  // 同プロセス生成だと PR-C1 で見落とした「sha256(raw bytes) は一致するが、別プロセスで
  // 生成された raw bytes とは異なる」リスクが再発する可能性があるため、本番条件 (setup
  // と classify が別プロセス) を fixture で再現する。
  // visual fingerprint は cross-process で一致する設計のため、これでも MatchedByHash 成立。
  console.log('Setting up MatchedByHash collision group (cross-process generation)...');
  const winnerExpectedBuf = regenerateChildPdfInOtherProcess(parentBuf, 1, 1);
  const collisionPath = `${FIXTURE_PREFIX}${COLLISION_FILENAME}`;
  await uploadPdf(collisionPath, winnerExpectedBuf);
  const collisionFileUrl = `gs://${storageBucket}/${collisionPath}`;
  await setDoc(FIXTURE_DOC_IDS.MATCHED_WINNER, {
    id: FIXTURE_DOC_IDS.MATCHED_WINNER,
    status: 'processed',
    fileName: COLLISION_FILENAME,
    fileUrl: collisionFileUrl,
    parentDocumentId: PARENT_DOC_ID,
    splitFromPages: { start: 1, end: 1 },
    totalPages: 1,
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  // loser doc は別 page range (hash mismatched) を主張するが Storage は winner 内容
  await setDoc(FIXTURE_DOC_IDS.MATCHED_LOSER, {
    id: FIXTURE_DOC_IDS.MATCHED_LOSER,
    status: 'processed',
    fileName: COLLISION_FILENAME,
    fileUrl: collisionFileUrl,
    parentDocumentId: PARENT_DOC_ID,
    splitFromPages: { start: 2, end: 2 }, // 期待 hash != Storage 実体
    totalPages: 1,
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // ── Ambiguous group ──
  // 両 child docs とも別 page を主張、Storage は無関係 PDF (両者 hash 不一致)
  console.log('Setting up Ambiguous collision group...');
  const ambiguousPath = `${FIXTURE_PREFIX}${AMBIGUOUS_FILENAME}`;
  await uploadPdf(ambiguousPath, await makeUnrelatedPdf(7));
  const ambiguousFileUrl = `gs://${storageBucket}/${ambiguousPath}`;
  await setDoc(FIXTURE_DOC_IDS.AMBIGUOUS_A, {
    id: FIXTURE_DOC_IDS.AMBIGUOUS_A,
    status: 'processed',
    fileName: AMBIGUOUS_FILENAME,
    fileUrl: ambiguousFileUrl,
    parentDocumentId: PARENT_DOC_ID,
    splitFromPages: { start: 3, end: 3 },
    totalPages: 1,
    rotatedAt: admin.firestore.FieldValue.serverTimestamp(), // suggestedWinner hint
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await setDoc(FIXTURE_DOC_IDS.AMBIGUOUS_B, {
    id: FIXTURE_DOC_IDS.AMBIGUOUS_B,
    status: 'processed',
    fileName: AMBIGUOUS_FILENAME,
    fileUrl: ambiguousFileUrl,
    parentDocumentId: PARENT_DOC_ID,
    splitFromPages: { start: 4, end: 4 },
    totalPages: 1,
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // ── RepairableMissingFile orphan ──
  console.log('Setting up RepairableMissingFile orphan...');
  const repairablePath = `${FIXTURE_PREFIX}${REPAIRABLE_FILENAME}`;
  // Storage には upload しない (orphan)
  await setDoc(FIXTURE_DOC_IDS.REPAIRABLE_ORPHAN, {
    id: FIXTURE_DOC_IDS.REPAIRABLE_ORPHAN,
    status: 'processed',
    fileName: REPAIRABLE_FILENAME,
    fileUrl: `gs://${storageBucket}/${repairablePath}`,
    parentDocumentId: PARENT_DOC_ID,
    splitFromPages: { start: 5, end: 5 },
    totalPages: 1,
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // ── LostOrUnrecoverable orphan ──
  console.log('Setting up LostOrUnrecoverable orphan...');
  await setDoc(FIXTURE_DOC_IDS.LOST_ORPHAN, {
    id: FIXTURE_DOC_IDS.LOST_ORPHAN,
    status: 'processed',
    fileName: LOST_FILENAME,
    fileUrl: `gs://${storageBucket}/${FIXTURE_PREFIX}${LOST_FILENAME}`,
    // parentDocumentId なし (orphan with no recovery path)
    parentDocumentId: null,
    splitFromPages: null,
    totalPages: 1,
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log('\n✅ Fixture setup complete. 5 docs (excl. parent) covering 4 classifications.');
  console.log('Run: npx ts-node scripts/classify-collision-docs.ts');

  await admin.app().delete();
}

main().catch(async (err) => {
  console.error('Failed:', err);
  try {
    await admin.app().delete();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
