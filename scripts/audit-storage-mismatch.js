#!/usr/bin/env node
/**
 * Firestore documents.fileUrl と Storage 実体の整合性監査スクリプト（read-only）
 *
 * documents コレクションを全件スキャンし、Storage `processed/` の実ファイル一覧と
 * 突合する。検出する不整合:
 *   1. fileUrl 孤児: fileUrl が指す Storage オブジェクトが存在しない
 *   2. fileName 衝突: 複数 docs が同じ fileName を持つ（fileUrl が衝突する候補）
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone node scripts/audit-storage-mismatch.js
 *
 * オプション:
 *   --prefix <path>  Storage の対象 prefix（デフォルト: processed/）
 *   --no-orphans     fileUrl 孤児チェックを省略（fileName 衝突のみ出力）
 *   --no-collisions  fileName 衝突チェックを省略
 */

const admin = require('firebase-admin');

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID を設定してください');
  process.exit(1);
}

// CLAUDE.md「Storage バケット名」: .appspot.com / .firebasestorage.app の 2 形式が混在しており、
// projectId からの推測は禁止。scripts/clients/<env>.env の STORAGE_BUCKET を必ず env 経由で渡す。
const storageBucket = process.env.STORAGE_BUCKET;
if (!storageBucket) {
  console.error('STORAGE_BUCKET を設定してください (例: docsplit-kanameone.firebasestorage.app)');
  process.exit(1);
}

function getOpt(name, def = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const prefix = getOpt('--prefix', 'processed/');
const skipOrphans = process.argv.includes('--no-orphans');
const skipCollisions = process.argv.includes('--no-collisions');

admin.initializeApp({ projectId, storageBucket });
const db = admin.firestore();
const bucket = admin.storage().bucket();

function tsToIso(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate().toISOString();
  return String(ts);
}

async function listAllStorageFiles(prefixPath) {
  const all = new Set();
  let token;
  let page = 0;
  do {
    const [files, nextQuery] = await bucket.getFiles({
      prefix: prefixPath,
      maxResults: 1000,
      pageToken: token,
      autoPaginate: false,
    });
    files.forEach((f) => all.add(f.name));
    page += 1;
    token = nextQuery && nextQuery.pageToken;
  } while (token);
  console.log(
    `Storage list complete: prefix="${prefixPath}", pages=${page}, files=${all.size}`,
  );
  return all;
}

function pathFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/^gs:\/\/[^/]+\/(.+)$/);
  return m ? m[1] : null;
}

async function main() {
  console.log(`Project: ${projectId}`);
  console.log(`Bucket : ${bucket.name}`);
  console.log(`Prefix : ${prefix}\n`);

  console.log('Loading documents collection...');
  const snap = await db.collection('documents').get();
  console.log(`Total documents: ${snap.size}`);

  const allDocs = [];
  snap.forEach((doc) => {
    const data = doc.data();
    allDocs.push({
      id: doc.id,
      status: data.status,
      fileName: data.fileName,
      displayFileName: data.displayFileName,
      fileUrl: data.fileUrl,
      parentDocumentId: data.parentDocumentId,
      splitInto: data.splitInto,
      isSplitSource: data.isSplitSource,
      rotatedAt: tsToIso(data.rotatedAt),
      processedAt: tsToIso(data.processedAt),
      updatedAt: tsToIso(data.updatedAt),
      lastErrorMessage: data.lastErrorMessage,
    });
  });

  const targetDocs = allDocs.filter((d) => {
    const path = pathFromUrl(d.fileUrl);
    return path && path.startsWith(prefix);
  });
  console.log(`Documents with fileUrl matching prefix "${prefix}": ${targetDocs.length}\n`);

  if (!skipOrphans) {
    const storagePaths = await listAllStorageFiles(prefix);
    const orphans = [];
    for (const d of targetDocs) {
      const path = pathFromUrl(d.fileUrl);
      if (!storagePaths.has(path)) {
        orphans.push(d);
      }
    }
    console.log(`\n=== fileUrl orphans (Storage 実体なし): ${orphans.length} ===`);
    orphans.forEach((o) => console.log(JSON.stringify(o)));

    const orphansByStatus = orphans.reduce((acc, o) => {
      acc[o.status || 'unknown'] = (acc[o.status || 'unknown'] || 0) + 1;
      return acc;
    }, {});
    console.log(`\nOrphan breakdown by status: ${JSON.stringify(orphansByStatus)}`);
  }

  if (!skipCollisions) {
    const byFileName = new Map();
    for (const d of targetDocs) {
      if (!d.fileName) continue;
      if (!byFileName.has(d.fileName)) byFileName.set(d.fileName, []);
      byFileName.get(d.fileName).push(d);
    }
    const collisions = [...byFileName.entries()].filter(([, v]) => v.length > 1);
    console.log(`\n=== fileName collisions (複数 docs が同名): ${collisions.length} groups ===`);
    for (const [fileName, docs] of collisions) {
      console.log(`\n-- ${fileName} (${docs.length} docs) --`);
      for (const d of docs) {
        console.log(`  ${d.id} | status=${d.status} | rotatedAt=${d.rotatedAt} | fileUrl=${d.fileUrl}`);
      }
    }
  }

  await admin.app().delete();
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
