#!/usr/bin/env node
/**
 * Firestore documents.fileUrl と Storage 実体の整合性監査スクリプト（read-only）
 *
 * documents コレクションを全件スキャンし、Storage `processed/` の実ファイル一覧と
 * 突合する。Issue #432 PR-B 以降の `processed/{docId}/{fileName}` 形式も
 * `bucket.getFiles({prefix:'processed/'})` の再帰スキャンで検出可。
 *
 * 検出する不整合:
 *   1. fileUrl 孤児: fileUrl が指す Storage オブジェクトが存在しない (Firestore→Storage 欠損)
 *   2. fileName 衝突: 複数 docs が同じ fileName を持つ（fileUrl が衝突する候補）
 *   3. reverse orphan: Storage 実体あり、Firestore doc から参照なし (Issue #432 PR-D)
 *      PR-B 補償処理の二段失敗 (Firestore set 失敗 → Storage delete も失敗) や
 *      手動 Storage 操作で発生し得る。bucket 容量の silent な消費源
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone node scripts/audit-storage-mismatch.js
 *
 * オプション:
 *   --prefix <path>          Storage の対象 prefix（デフォルト: processed/）
 *   --no-orphans             fileUrl 孤児チェック (Firestore→Storage) を省略
 *   --no-collisions          fileName 衝突チェックを省略
 *   --no-reverse-orphans     reverse orphan チェック (Storage→Firestore) を省略
 *   --show-creation-times    collision 出力に createdAt を含める (PR-B/D2 等 deploy 反映前後の
 *                            切り分け用、Issue #432 session82 で導入)
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
const skipReverseOrphans = process.argv.includes('--no-reverse-orphans');
const showCreationTimes = process.argv.includes('--show-creation-times');

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

/**
 * `gs://<bucket>/<path>` 形式の URL から path を抽出するが、bucket 名が
 * 指定された expected bucket と一致する場合のみ返す。一致しない場合は null。
 * 環境差 (`.appspot.com` / `.firebasestorage.app` 混在等) で別 bucket の参照
 * を現環境の参照と誤計上する false negative を防ぐ (Issue #432 PR-D Codex 指摘)。
 */
function extractPathIfBucketMatches(url, expectedBucket) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!m) return null;
  if (m[1] !== expectedBucket) return null;
  return m[2];
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
      createdAt: tsToIso(data.createdAt),
      lastErrorMessage: data.lastErrorMessage,
    });
  });

  const targetDocs = allDocs.filter((d) => {
    const path = pathFromUrl(d.fileUrl);
    return path && path.startsWith(prefix);
  });
  console.log(`Documents with fileUrl matching prefix "${prefix}": ${targetDocs.length}\n`);

  // Storage の全 path を一度だけ load (orphans / reverse orphans の両方で使う)
  let storagePaths = null;
  if (!skipOrphans || !skipReverseOrphans) {
    storagePaths = await listAllStorageFiles(prefix);
  }

  if (!skipOrphans) {
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

  if (!skipReverseOrphans) {
    // sanity check: Firestore docs と Storage list の整合性を verify
    // (Issue #432 silent-failure-hunter C2 指摘: 0 件レポートが load 失敗を hide する)
    if (targetDocs.length > 0 && storagePaths.size === 0) {
      console.error(
        `FATAL: Firestore に prefix="${prefix}" 参照 docs が ${targetDocs.length} 件あるが、` +
          `Storage list は 0 件。false reverse-orphan 報告を防ぐため abort。` +
          `bucket 名 (${bucket.name}) と IAM 権限を確認すること。`
      );
      await admin.app().delete();
      process.exit(2);
    }

    // Firestore documents から参照されている Storage path 集合
    // bucket 名が一致しない fileUrl (別環境 / 旧形式 https URL 等) は除外し、解析失敗件数を記録
    const referencedPaths = new Set();
    let fileUrlParseFailureCount = 0;
    let fileUrlOtherBucketCount = 0;
    let fileUrlNullOrEmptyCount = 0;
    for (const d of allDocs) {
      if (d.fileUrl === undefined || d.fileUrl === null || d.fileUrl === '') {
        fileUrlNullOrEmptyCount += 1;
        continue;
      }
      // bucket 名一致確認 (false negative 防止)
      const p = extractPathIfBucketMatches(d.fileUrl, bucket.name);
      if (p === null) {
        // bucket mismatch or non-gs:// URL → 解析失敗 / 別 bucket として分類
        const looksGs = typeof d.fileUrl === 'string' && d.fileUrl.startsWith('gs://');
        if (looksGs) {
          fileUrlOtherBucketCount += 1;
        } else {
          fileUrlParseFailureCount += 1;
          console.warn(
            `WARN: fileUrl 解析失敗 (no-reference 扱い): docId=${d.id} status=${d.status} fileUrl=${JSON.stringify(d.fileUrl)}`
          );
        }
        continue;
      }
      if (p.startsWith(prefix)) {
        referencedPaths.add(p);
      }
    }

    if (fileUrlParseFailureCount > 0 || fileUrlOtherBucketCount > 0) {
      console.warn(
        `\nWARN: fileUrl 解析失敗 ${fileUrlParseFailureCount} 件 / 別 bucket 参照 ${fileUrlOtherBucketCount} 件 / ` +
          `null or empty ${fileUrlNullOrEmptyCount} 件。reverse orphan に false positive 含む可能性。` +
          `gsutil rm 前に必ず原因調査すること。`
      );
    }

    // Storage 実体あり Firestore 参照なし = reverse orphan
    const reverseOrphans = [];
    for (const p of storagePaths) {
      if (!referencedPaths.has(p)) {
        reverseOrphans.push(p);
      }
    }

    console.log(
      `\n=== reverse orphans (Storage 実体あり Firestore 参照なし): ${reverseOrphans.length} ===`
    );
    reverseOrphans.forEach((p) =>
      console.log(`  gs://${bucket.name}/${p}`)
    );

    // docId namespace pattern (processed/{docId}/...) を hint 表示。
    // Firestore auto-ID = `[A-Za-z0-9]{20}` 固定仕様に厳密一致 + 同 ID の doc が
    // 不在であることを確認 (Issue #432 PR-D 補強: codex / silent-failure I1 指摘反映)。
    // PR-B 補償処理二段失敗で発生する正規パターン。
    const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
    const allDocIds = new Set(allDocs.map((d) => d.id));
    const docIdNamespaceOrphans = reverseOrphans.filter((p) => {
      if (!p.startsWith(normalizedPrefix)) return false;
      const segments = p.slice(normalizedPrefix.length).split('/');
      if (segments.length < 2) return false;
      if (!/^[A-Za-z0-9]{20}$/.test(segments[0])) return false;
      // 同 ID の doc が存在しない場合のみ PR-B 由来候補 (set 失敗で doc 不在のはず)
      return !allDocIds.has(segments[0]);
    });
    if (docIdNamespaceOrphans.length > 0) {
      console.log(
        `\n  docId namespace pattern (processed/{docId}/..., doc 不在): ${docIdNamespaceOrphans.length}`
      );
      console.log(
        '  (Issue #432 PR-B 補償処理二段失敗 / 手動 Storage 操作で発生する可能性が高い候補)'
      );
    }
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
        const base = `  ${d.id} | status=${d.status} | rotatedAt=${d.rotatedAt} | fileUrl=${d.fileUrl}`;
        if (showCreationTimes) {
          console.log(`${base} | createdAt=${d.createdAt} | processedAt=${d.processedAt}`);
        } else {
          console.log(base);
        }
      }
    }
  }

  await admin.app().delete();
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
