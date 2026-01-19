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
  const appSettings = await db.doc('settings/app').get();
  console.log('settings/app:', JSON.stringify(appSettings.data(), null, 2));
}

main()
  .then(() => { fs.unlinkSync(tmpKeyPath); process.exit(0); })
  .catch(e => { console.error(e); fs.unlinkSync(tmpKeyPath); process.exit(1); });
