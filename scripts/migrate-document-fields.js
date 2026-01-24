#!/usr/bin/env node
/**
 * ドキュメントフィールドマイグレーション
 * storagePath → fileUrl、originalFileName → fileName、pageCount → totalPages に変換
 */

const admin = require('firebase-admin');

// プロジェクトIDを引数から取得
const projectId = process.argv[2];
const dryRun = process.argv.includes('--dry-run');

if (!projectId) {
  console.error('Usage: node migrate-document-fields.js <project-id> [--dry-run]');
  console.error('Example: node migrate-document-fields.js docsplit-kanameone');
  process.exit(1);
}

process.env.GOOGLE_CLOUD_PROJECT = projectId;

admin.initializeApp({
  projectId: projectId
});

const db = admin.firestore();

async function migrateDocuments() {
  console.log(`Migrating documents in project: ${projectId}`);
  console.log(`Dry run: ${dryRun}`);
  console.log('---');

  const snapshot = await db.collection('documents').get();

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const updates = {};

    // storagePath → fileUrl (gs:// URL形式に変換)
    if (!data.fileUrl && data.storagePath) {
      const bucket = `${projectId}.firebasestorage.app`;
      updates.fileUrl = `gs://${bucket}/${data.storagePath}`;
    }

    // originalFileName → fileName
    if (!data.fileName && data.originalFileName) {
      updates.fileName = data.originalFileName;
    }

    // pageCount → totalPages
    if (data.totalPages === undefined && data.pageCount !== undefined) {
      updates.totalPages = data.pageCount;
    }

    if (Object.keys(updates).length > 0) {
      console.log(`Document ${doc.id}:`);
      console.log(`  Updates: ${JSON.stringify(updates)}`);

      if (!dryRun) {
        try {
          await doc.ref.update(updates);
          console.log('  ✅ Updated');
          migrated++;
        } catch (e) {
          console.error(`  ❌ Error: ${e.message}`);
          errors++;
        }
      } else {
        console.log('  (dry-run, not updated)');
        migrated++;
      }
    } else {
      skipped++;
    }
  }

  console.log('---');
  console.log(`Total: ${snapshot.size}, Migrated: ${migrated}, Skipped: ${skipped}, Errors: ${errors}`);
}

migrateDocuments()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('Migration failed:', e);
    process.exit(1);
  });
