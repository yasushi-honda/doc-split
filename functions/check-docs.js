const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { execSync } = require('child_process');
const fs = require('fs');

const projectId = 'doc-split-dev';
const saEmail = execSync(`gcloud iam service-accounts list --project=${projectId} --filter="displayName:firebase-adminsdk" --format="value(email)"`, { encoding: 'utf-8' }).trim().split('\n')[0];

const tmpKeyPath = '/tmp/firebase-admin-key.json';
execSync(`gcloud iam service-accounts keys create ${tmpKeyPath} --iam-account="${saEmail}" --project=${projectId} 2>/dev/null || true`);

const serviceAccount = require(tmpKeyPath);
initializeApp({ credential: cert(serviceAccount), projectId });

const db = getFirestore();

async function main() {
  const docs = await db.collection('documents').orderBy('createdAt', 'desc').limit(5).get();
  console.log('Recent documents:');
  docs.forEach(doc => {
    const d = doc.data();
    console.log(`  ${doc.id}: status=${d.status}, fileName=${d.originalFileName}`);
  });
  
  // ステータスをpendingに戻す
  const doc = await db.collection('documents').doc('RtGruT75vzmayrDdfNsT').get();
  if (doc.exists) {
    await db.collection('documents').doc('RtGruT75vzmayrDdfNsT').update({ status: 'pending' });
    console.log('\nステータスをpendingに更新しました');
  }
}

main()
  .then(() => { fs.unlinkSync(tmpKeyPath); process.exit(0); })
  .catch(e => { console.error(e); process.exit(1); });
