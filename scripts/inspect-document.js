#!/usr/bin/env node
/**
 * Firestore documents 詳細出力スクリプト（read-only）
 *
 * Storage 404 / fileUrl 不整合 / 孤児ドキュメント等の調査に使用する。
 * documents コレクションを fileName 完全一致で検索し、エラー原因究明に必要な
 * フィールド一式（status / fileUrl / parentDocumentId / splitFromPages / pageRotations 等）
 * を JSON で出力する。書き込みは一切行わない。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone node scripts/inspect-document.js \
 *     --file-name 20260509_未判定_未判定_p3.pdf
 *
 *   FIREBASE_PROJECT_ID=docsplit-kanameone node scripts/inspect-document.js \
 *     --doc-id <document-id>
 *
 * オプション:
 *   --file-name <name>  fileName 完全一致でドキュメント検索（必須または --doc-id）
 *   --doc-id <id>       ドキュメント ID 指定で取得
 *   --include-related   parentDocumentId / splitInto を辿って関連ドキュメントも出力
 */

const admin = require('firebase-admin');

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID を設定してください');
  process.exit(1);
}

function getOpt(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const fileName = getOpt('--file-name');
const docId = getOpt('--doc-id');
const includeRelated = process.argv.includes('--include-related');

if (!fileName && !docId) {
  console.error('--file-name <name> または --doc-id <id> を指定してください');
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

function tsToIso(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate().toISOString();
  return String(ts);
}

function summarize(doc) {
  const d = doc.data();
  return {
    id: doc.id,
    status: d.status,
    fileName: d.fileName,
    displayFileName: d.displayFileName,
    fileUrl: d.fileUrl,
    mimeType: d.mimeType,
    totalPages: d.totalPages,
    parentDocumentId: d.parentDocumentId,
    splitFromPages: d.splitFromPages,
    splitInto: d.splitInto,
    isSplitSource: d.isSplitSource,
    pageRotations: d.pageRotations,
    rotatedAt: tsToIso(d.rotatedAt),
    processedAt: tsToIso(d.processedAt),
    updatedAt: tsToIso(d.updatedAt),
    fileDate: tsToIso(d.fileDate),
    retryCount: d.retryCount,
    retryAfter: tsToIso(d.retryAfter),
    lastErrorMessage: d.lastErrorMessage,
    confirmedBy: d.confirmedBy,
    confirmedAt: tsToIso(d.confirmedAt),
  };
}

async function fetchById(id) {
  const snap = await db.doc(`documents/${id}`).get();
  if (!snap.exists) return null;
  return snap;
}

async function main() {
  const found = [];

  if (docId) {
    const snap = await fetchById(docId);
    if (snap) found.push(snap);
    else console.error(`docId ${docId} not found`);
  }

  if (fileName) {
    const snap = await db
      .collection('documents')
      .where('fileName', '==', fileName)
      .get();
    snap.forEach((doc) => found.push(doc));
  }

  console.log(`=== Found ${found.length} document(s) ===`);
  for (const doc of found) {
    console.log(JSON.stringify(summarize(doc), null, 2));
  }

  if (includeRelated) {
    const seen = new Set(found.map((d) => d.id));
    const queue = [];
    for (const doc of found) {
      const d = doc.data();
      if (d.parentDocumentId && !seen.has(d.parentDocumentId)) {
        queue.push({ id: d.parentDocumentId, role: 'parent' });
      }
      if (Array.isArray(d.splitInto)) {
        for (const childId of d.splitInto) {
          if (!seen.has(childId)) queue.push({ id: childId, role: 'child' });
        }
      }
    }

    if (queue.length > 0) {
      console.log(`\n=== Related documents (${queue.length}) ===`);
      for (const { id, role } of queue) {
        const snap = await fetchById(id);
        if (snap) {
          console.log(`-- ${role}: ${id} --`);
          console.log(JSON.stringify(summarize(snap), null, 2));
        } else {
          console.log(`-- ${role}: ${id} (not found) --`);
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
