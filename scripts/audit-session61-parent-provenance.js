#!/usr/bin/env node
/**
 * session61 復旧 4 docs (op-0136〜op-0139) の親 PDF provenance post-audit (read-only)
 *
 * Issue #432 PR-C2-execution A で kanameone 本番に execute した 4 docs について、
 * Codex MCP セカンドオピニオン (threadId 019e1bc6-bbd9-7580-9442-08f8f534fd72) 指摘の
 * 「親 PDF が後で差し替わっていた場合、自動復旧が誤復旧になる」リスクを遡及検証する。
 *
 * 判定基準:
 *   - untouched: 親 Storage の timeCreated === updated AND Firestore parent doc に rotation 痕跡なし
 *     AND 子 doc createdAt > parent.timeCreated (時系列が辻褄合う)
 *   - suspect: 上記いずれか違反 (= 差替/rotation 痕跡あり)
 *   - undetermined: parent doc / Storage object / fileUrl 不在
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone STORAGE_BUCKET=docsplit-kanameone.firebasestorage.app \
 *     node scripts/audit-session61-parent-provenance.js [--out <path>]
 *
 * dev 環境では target docId が不在のため graceful skip (exit 0)。
 *
 * read-only: Storage / Firestore に対する set / update / delete / write 系 API は呼ばない。
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID を設定してください');
  process.exit(1);
}

const storageBucket = process.env.STORAGE_BUCKET;
if (!storageBucket) {
  console.error('STORAGE_BUCKET を設定してください (例: docsplit-kanameone.firebasestorage.app)');
  process.exit(1);
}

function getOpt(name, def = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const outPath = getOpt('--out', null);

const TARGET_OPERATIONS = [
  { operationId: 'op-0136', docId: 'Lso7jEXzWxBjU4Cj6zqR', parentDocumentId: 'Xe6jCKoTk4yflHqefDtb' },
  { operationId: 'op-0137', docId: 'M7i4Nx6khiYEo2KTGJHg', parentDocumentId: 'EkZ6bwIM3ji17UugWeEr' },
  { operationId: 'op-0138', docId: 'U4Lf5ZPNA4IyH73SXE2P', parentDocumentId: 'FIGbegoDvfaUTO2cYHkI' },
  { operationId: 'op-0139', docId: 'gifjllJ57Sx58TktzHCf', parentDocumentId: 'EkZ6bwIM3ji17UugWeEr' },
];

admin.initializeApp({ projectId, storageBucket });
const db = admin.firestore();
const bucket = admin.storage().bucket();

function tsToIso(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate().toISOString();
  if (typeof ts === 'string') return ts;
  return null;
}

function pathFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!m) return null;
  return { bucket: m[1], path: m[2] };
}

const ROTATION_HINT_FIELDS = [
  'rotatedAt',
  'lastRotatedAt',
  'rotationHistory',
  'lastRotatedPages',
  'rotatePdfPagesAt',
  'pagesRotatedAt',
];

function collectRotationHints(data) {
  const hints = {};
  let hasAny = false;
  for (const key of ROTATION_HINT_FIELDS) {
    if (data[key] !== undefined && data[key] !== null) {
      hints[key] = tsToIso(data[key]) || data[key];
      hasAny = true;
    }
  }
  return { hasAny, hints };
}

async function fetchDocSafely(docId) {
  try {
    const snap = await db.collection('documents').doc(docId).get();
    if (!snap.exists) return { exists: false, data: null };
    return { exists: true, data: snap.data() };
  } catch (err) {
    return { exists: false, data: null, error: String(err && err.message || err) };
  }
}

async function fetchStorageMetadataSafely(filePath) {
  try {
    const [metadata] = await bucket.file(filePath).getMetadata();
    return {
      exists: true,
      generation: String(metadata.generation || ''),
      metageneration: String(metadata.metageneration || ''),
      timeCreated: metadata.timeCreated || null,
      updated: metadata.updated || null,
      md5Hash: metadata.md5Hash || null,
      size: metadata.size != null ? Number(metadata.size) : null,
      contentType: metadata.contentType || null,
    };
  } catch (err) {
    const code = err && (err.code || err.status);
    if (code === 404 || code === '404') {
      return { exists: false };
    }
    return { exists: false, error: String(err && err.message || err) };
  }
}

function judgeVerdict({ childCreatedAtIso, parentStorageMeta, rotationHints }) {
  // Storage 不在 or 取得失敗 → undetermined
  if (!parentStorageMeta || !parentStorageMeta.exists) {
    return {
      verdict: 'undetermined',
      reasons: ['parent storage object missing or unreadable'],
    };
  }

  const reasons = [];

  // 親 Storage の timeCreated と updated が異なる = 書き込み以後の更新あり
  if (parentStorageMeta.timeCreated && parentStorageMeta.updated &&
      parentStorageMeta.timeCreated !== parentStorageMeta.updated) {
    reasons.push(`parent.updated (${parentStorageMeta.updated}) !== parent.timeCreated (${parentStorageMeta.timeCreated})`);
  }

  // metageneration > 1 = metadata 更新あり (custom metadata 等含む)
  if (parentStorageMeta.metageneration && Number(parentStorageMeta.metageneration) > 1) {
    reasons.push(`parent.metageneration=${parentStorageMeta.metageneration} (>1)`);
  }

  // Firestore parent doc に rotation 痕跡フィールドあり
  if (rotationHints && rotationHints.hasAny) {
    reasons.push(`parent firestore doc has rotation hints: ${Object.keys(rotationHints.hints).join(', ')}`);
  }

  // 子 doc createdAt が parent.timeCreated より前 = 時系列矛盾 (親が後から作られた = 差替の可能性)
  if (childCreatedAtIso && parentStorageMeta.timeCreated) {
    const childMs = new Date(childCreatedAtIso).getTime();
    const parentMs = new Date(parentStorageMeta.timeCreated).getTime();
    if (Number.isFinite(childMs) && Number.isFinite(parentMs) && childMs < parentMs) {
      reasons.push(`child.createdAt (${childCreatedAtIso}) < parent.timeCreated (${parentStorageMeta.timeCreated})`);
    }
  }

  if (reasons.length === 0) {
    return { verdict: 'untouched', reasons: [] };
  }
  return { verdict: 'suspect', reasons };
}

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`Project        : ${projectId}`);
  console.log(`Bucket         : ${bucket.name}`);
  console.log(`Target ops     : ${TARGET_OPERATIONS.length}`);
  console.log(`Started at     : ${startedAt}`);
  console.log(`Cloud Logging  : skipped (CI SA に logging.viewer 未付与のため metadata + Firestore のみで判定)`);

  // dev 環境向け graceful skip: 4 docs のいずれかが存在するか確認
  const childChecks = await Promise.all(
    TARGET_OPERATIONS.map(async (t) => ({
      ...t,
      childSnap: await fetchDocSafely(t.docId),
    })),
  );
  const anyChildExists = childChecks.some((c) => c.childSnap.exists);

  if (!anyChildExists) {
    const skipReport = {
      schemaVersion: 1,
      projectId,
      bucket: bucket.name,
      startedAt,
      finishedAt: new Date().toISOString(),
      cloudLoggingChecked: false,
      cloudLoggingSkipReason: 'CI SA に logging.viewer 未付与',
      skipped: true,
      skipReason: 'target docs not found in this environment, skipping',
      operations: [],
    };
    console.log('\n=== target docs not found in this environment, skipping (exit 0) ===');
    if (outPath) {
      fs.writeFileSync(outPath, JSON.stringify(skipReport, null, 2));
      console.log(`Report written to: ${outPath}`);
    } else {
      console.log(JSON.stringify(skipReport, null, 2));
    }
    await admin.app().delete();
    return;
  }

  // parentDocumentId のユニーク集合 (3 件)
  const uniqueParentIds = [...new Set(TARGET_OPERATIONS.map((t) => t.parentDocumentId))];
  console.log(`Unique parents : ${uniqueParentIds.length}`);

  // 親 doc を fetch (Firestore) + Storage metadata 取得
  const parentResults = {};
  for (const parentId of uniqueParentIds) {
    const parentSnap = await fetchDocSafely(parentId);
    const result = {
      parentDocumentId: parentId,
      firestore: {
        exists: parentSnap.exists,
        fetchError: parentSnap.error || null,
      },
      storage: null,
      rotationHints: null,
    };
    if (parentSnap.exists) {
      const data = parentSnap.data;
      const fileUrl = data.fileUrl;
      const parsed = pathFromUrl(fileUrl);
      result.firestore.fileName = data.fileName || null;
      result.firestore.fileUrl = fileUrl || null;
      result.firestore.parentBucket = parsed ? parsed.bucket : null;
      result.firestore.parentStoragePath = parsed ? parsed.path : null;
      result.firestore.createdAt = tsToIso(data.createdAt);
      result.firestore.updatedAt = tsToIso(data.updatedAt);
      result.firestore.processedAt = tsToIso(data.processedAt);
      result.firestore.status = data.status || null;
      result.firestore.isSplitSource = data.isSplitSource === true;
      result.rotationHints = collectRotationHints(data);

      if (parsed && parsed.bucket === bucket.name) {
        result.storage = await fetchStorageMetadataSafely(parsed.path);
      } else if (parsed) {
        result.storage = { exists: false, error: `bucket mismatch: ${parsed.bucket} vs ${bucket.name}` };
      } else {
        result.storage = { exists: false, error: 'parent fileUrl is null or unparseable' };
      }
    }
    parentResults[parentId] = result;
  }

  // 4 ops それぞれ判定
  const operations = [];
  for (const t of TARGET_OPERATIONS) {
    const childCheck = childChecks.find((c) => c.docId === t.docId);
    const childData = childCheck && childCheck.childSnap.data;
    const childExists = childCheck && childCheck.childSnap.exists;
    const childCreatedAt = childExists ? tsToIso(childData.createdAt) : null;
    const childFileUrl = childExists ? (childData.fileUrl || null) : null;
    const childFileName = childExists ? (childData.fileName || null) : null;
    const parent = parentResults[t.parentDocumentId];

    const verdictInfo = childExists
      ? judgeVerdict({
          childCreatedAtIso: childCreatedAt,
          parentStorageMeta: parent && parent.storage,
          rotationHints: parent && parent.rotationHints,
        })
      : { verdict: 'undetermined', reasons: ['child document not found'] };

    operations.push({
      operationId: t.operationId,
      docId: t.docId,
      parentDocumentId: t.parentDocumentId,
      child: {
        exists: !!childExists,
        fileName: childFileName,
        fileUrl: childFileUrl,
        createdAt: childCreatedAt,
      },
      parent: parent,
      verdict: verdictInfo.verdict,
      reasons: verdictInfo.reasons,
    });
  }

  const report = {
    schemaVersion: 1,
    projectId,
    bucket: bucket.name,
    startedAt,
    finishedAt: new Date().toISOString(),
    cloudLoggingChecked: false,
    cloudLoggingSkipReason: 'CI SA に logging.viewer 未付与',
    skipped: false,
    summary: {
      total: operations.length,
      byVerdict: operations.reduce((acc, o) => {
        acc[o.verdict] = (acc[o.verdict] || 0) + 1;
        return acc;
      }, {}),
    },
    operations,
  };

  // 人間可読 summary を stdout (JSON body は artifact 経由で取得 — log secret masking 回避)
  console.log('\n=== Summary ===');
  console.log(`Total ops      : ${report.summary.total}`);
  for (const [v, n] of Object.entries(report.summary.byVerdict)) {
    console.log(`  ${v}: ${n}`);
  }
  console.log('\n=== Per-operation verdict ===');
  for (const op of operations) {
    console.log(`${op.operationId} ${op.docId} parent=${op.parentDocumentId}: ${op.verdict}`);
    if (op.reasons && op.reasons.length > 0) {
      for (const r of op.reasons) console.log(`  - ${r}`);
    }
  }

  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`\nReport written to: ${outPath}`);
  } else {
    console.log('\n=== Full report (no --out specified) ===');
    console.log(JSON.stringify(report, null, 2));
  }

  await admin.app().delete();
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
