#!/usr/bin/env ts-node
/**
 * dev環境のStorage上にある既存fixtureを指すpending文書を1件作成する(Issue #562)
 *
 * Issue #562(summary経路のthinkingConfig未設定によるコスト影響評価)で、既存の
 * MIXED_FAX_PDFS(5〜6ページ)より長い文書での挙動を確認するため、既にStorageへ
 * アップロード済みの`seed_generic_12p.pdf`(12ページ、seed-dev-data.tsのGENERIC_PDFS)を
 * 指すpending文書を1件だけ作成する。実OCRパイプライン(processOCR)が処理を開始する。
 *
 * scripts/seed-dev-data.tsのbuildPendingDoc()と同じスキーマ形状を使用。
 * 特定の文書IDに縛られない汎用スクリプトとして実装(既存Storage fixtureを指す
 * pending文書の単発作成という操作自体は今後の同種の実測ニーズでも再利用できる)。
 *
 * 使用方法:
 *   推奨: GitHub Actions "Run Operations Script" → environment: dev /
 *         script: create-pending-doc --doc-id
 *   ローカル実行（フォールバック）:
 *     gcloud auth application-default login (doc-split-dev環境のアカウントで)
 *     FIREBASE_PROJECT_ID=doc-split-dev npx ts-node scripts/create-pending-doc.ts \
 *       --doc-id <docId> --storage-path original/seed_generic_12p.pdf
 */

import * as admin from 'firebase-admin';

const ALLOWED_PROJECT_ID = 'doc-split-dev';

const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '';
if (projectId !== ALLOWED_PROJECT_ID) {
  console.error(
    `❌ このスクリプトは ${ALLOWED_PROJECT_ID} 専用です (指定されたプロジェクト: ${projectId || '(未設定)'})。` +
      '本番クライアント環境への実行は禁止です。'
  );
  process.exit(1);
}

function getArg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const docId = getArg('--doc-id');
const storagePath = getArg('--storage-path');
const storageBucket = process.env.STORAGE_BUCKET || `${projectId}.firebasestorage.app`;

if (!docId || !storagePath) {
  console.error('--doc-id <docId> --storage-path <original/xxx.pdf> を指定してください');
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

async function main(): Promise<void> {
  const ref = db.collection('documents').doc(docId!);
  const existing = await ref.get();
  if (existing.exists) {
    console.error(`❌ documents/${docId} は既に存在します。別のdoc-idを指定してください。`);
    process.exit(1);
  }

  const fileName = storagePath!.split('/').pop() || storagePath!;

  await ref.set({
    id: docId,
    processedAt: admin.firestore.Timestamp.now(),
    fileId: docId,
    fileName,
    mimeType: 'application/pdf',
    ocrResult: '',
    documentType: '',
    customerName: '',
    officeName: '',
    fileUrl: `gs://${storageBucket}/${storagePath}`,
    fileDate: null,
    isDuplicateCustomer: false,
    totalPages: 0,
    targetPageNumber: 1,
    status: 'pending',
    sourceType: 'upload',
  });

  console.log(`✅ documents/${docId} をpendingで作成しました (fileUrl: gs://${storageBucket}/${storagePath})`);
  console.log('processOCR(毎分ポーリング)が処理を開始します。');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('ERROR:', err);
    process.exit(1);
  });
