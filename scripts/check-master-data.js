#!/usr/bin/env node
/**
 * マスターデータ健全性チェックスクリプト
 *
 * Firestoreのマスターデータに型崩れ（配列やオブジェクトの混入）がないか検証する。
 * INVALID_ARGUMENT: Property array contains an invalid nested entity の予防に使用。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=docsplit-kanameone node scripts/check-master-data.js [--fix]
 *
 * オプション:
 *   --fix  問題のあるフィールドを自動修正する（デフォルトはdry-run）
 */

const admin = require('firebase-admin');

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID を設定してください');
  process.exit(1);
}

const fix = process.argv.includes('--fix');

/** Firestore バッチ上限は 500 writes。余裕を持って 400 件で chunk 分割する */
const BATCH_CHUNK_SIZE = 400;

admin.initializeApp({ projectId });
const db = admin.firestore();

/** 値が期待する型かチェック */
function checkField(docId, field, value, expectedType) {
  if (value === undefined || value === null) return null;

  if (expectedType === 'string' && typeof value !== 'string') {
    return { docId, field, actual: typeof value, isArray: Array.isArray(value), value: JSON.stringify(value).slice(0, 100) };
  }
  if (expectedType === 'string[]') {
    if (!Array.isArray(value)) {
      return { docId, field, actual: typeof value, isArray: false, value: JSON.stringify(value).slice(0, 100) };
    }
    const badElements = value.filter(v => typeof v !== 'string');
    if (badElements.length > 0) {
      return { docId, field, actual: 'array with non-string', isArray: true, value: JSON.stringify(badElements).slice(0, 100) };
    }
  }
  if (expectedType === 'boolean' && typeof value !== 'boolean') {
    return { docId, field, actual: typeof value, isArray: Array.isArray(value), value: JSON.stringify(value).slice(0, 100) };
  }
  return null;
}

/** フィールドを正規化 */
function sanitizeValue(value, expectedType) {
  if (value === undefined || value === null) return null;

  if (expectedType === 'string') {
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
    return admin.firestore.FieldValue.delete();
  }
  if (expectedType === 'string[]') {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.filter(v => typeof v === 'string');
    return admin.firestore.FieldValue.delete();
  }
  if (expectedType === 'boolean') {
    if (typeof value === 'boolean') return value;
    return admin.firestore.FieldValue.delete();
  }
  return value;
}

const COLLECTIONS = {
  'masters/customers/items': {
    name: 'string',
    furigana: 'string',
    careManagerName: 'string',
    notes: 'string',
    isDuplicate: 'boolean',
    aliases: 'string[]',
  },
  'masters/offices/items': {
    name: 'string',
    shortName: 'string',
    notes: 'string',
    isDuplicate: 'boolean',
    aliases: 'string[]',
  },
  'masters/documents/items': {
    name: 'string',
    category: 'string',
    keywords: 'string[]',
    aliases: 'string[]',
    dateMarker: 'string',
  },
};

async function main() {
  console.log(`プロジェクト: ${projectId}`);
  console.log(`モード: ${fix ? '修正実行' : 'dry-run（--fix で修正）'}\n`);

  let totalIssues = 0;
  let totalFixed = 0;

  for (const [collPath, schema] of Object.entries(COLLECTIONS)) {
    console.log(`--- ${collPath} ---`);
    const snap = await db.collection(collPath).get();
    const issues = [];

    const docDataMap = new Map();
    for (const doc of snap.docs) {
      const data = doc.data();
      docDataMap.set(doc.id, data);
      for (const [field, expectedType] of Object.entries(schema)) {
        const issue = checkField(doc.id, field, data[field], expectedType);
        if (issue) issues.push(issue);
      }
    }

    if (issues.length === 0) {
      console.log(`  ✅ ${snap.size}件チェック完了、問題なし`);
    } else {
      console.log(`  ⚠️ ${issues.length}件の型崩れを検出:`);
      for (const issue of issues) {
        console.log(`    ${issue.docId}.${issue.field}: 期待=string系, 実際=${issue.actual}${issue.isArray ? '(配列)' : ''} → ${issue.value}`);
      }

      if (fix) {
        const totalChunks = Math.ceil(issues.length / BATCH_CHUNK_SIZE);
        for (let i = 0; i < issues.length; i += BATCH_CHUNK_SIZE) {
          const chunk = issues.slice(i, i + BATCH_CHUNK_SIZE);
          const chunkNum = Math.floor(i / BATCH_CHUNK_SIZE) + 1;
          const batch = db.batch();
          for (const issue of chunk) {
            const docRef = db.doc(`${collPath}/${issue.docId}`);
            const data = docDataMap.get(issue.docId);
            const sanitized = sanitizeValue(data[issue.field], schema[issue.field]);
            batch.update(docRef, { [issue.field]: sanitized });
          }
          await batch.commit();
          console.log(`    → batch ${chunkNum}/${totalChunks}: ${chunk.length}件コミット`);
        }
        console.log(`    → 合計 ${issues.length}件を修正しました`);
        totalFixed += issues.length;
      }
    }

    totalIssues += issues.length;
  }

  console.log(`\n合計: ${totalIssues}件の問題${fix ? `、${totalFixed}件修正` : ''}`);
  if (totalIssues > 0 && !fix) {
    console.log('修正するには --fix オプションを付けて再実行してください');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('エラー:', err);
  process.exit(1);
});
