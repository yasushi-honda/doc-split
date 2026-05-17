#!/usr/bin/env node
// PR-D4 S6 AC7 用 fixture Firebase ID token 取得
// 使い方:
//   FIREBASE_PROJECT_ID=doc-split-dev node scripts/get-firebase-id-token-for-fixture.cjs
//   FIREBASE_PROJECT_ID=doc-split-dev node scripts/get-firebase-id-token-for-fixture.cjs --cleanup
//
// 副作用: dev project users/{FIXTURE_UID} doc 1 件 create/delete (revocable)
// 出力: stdout に ID token のみ (パイプで gcloud secrets create --data-file=- に渡す)

const admin = require('firebase-admin');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const API_KEY = process.env.FIREBASE_WEB_API_KEY;
const FIXTURE_UID = process.env.FIXTURE_UID || 'pr-d4-rotate-fixture-uid';
const CLEANUP = process.argv.includes('--cleanup');

if (!PROJECT_ID) {
  console.error('ERROR: FIREBASE_PROJECT_ID env var required');
  process.exit(2);
}
if (!CLEANUP && !API_KEY) {
  console.error('ERROR: FIREBASE_WEB_API_KEY env var required (skip if --cleanup)');
  process.exit(2);
}
if (PROJECT_ID !== 'doc-split-dev') {
  console.error(`ERROR: dev only (got: ${PROJECT_ID})`);
  process.exit(2);
}

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
const auth = admin.auth();

async function cleanup() {
  console.error(`[cleanup] deleting users/${FIXTURE_UID}`);
  await db.doc(`users/${FIXTURE_UID}`).delete().catch(() => {});
  try {
    await auth.deleteUser(FIXTURE_UID);
    console.error(`[cleanup] deleted Auth user ${FIXTURE_UID}`);
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
  }
  console.error('[cleanup] done');
}

async function getIdToken() {
  console.error(`[setup] creating users/${FIXTURE_UID} whitelist entry`);
  await db.doc(`users/${FIXTURE_UID}`).set(
    {
      role: 'admin',
      displayName: 'PR-D4 S6 rotate fixture',
      email: 'pr-d4-fixture@doc-split-dev.invalid',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      purpose: 'pr-d4-s6-ac7-rollback-rehearsal',
    },
    { merge: true }
  );

  console.error(`[token] creating custom token for ${FIXTURE_UID}`);
  const customToken = await auth.createCustomToken(FIXTURE_UID, {
    pr_d4_fixture: true,
  });

  console.error('[token] exchanging custom token → ID token via Identity Toolkit');
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    console.error(`ERROR: Identity Toolkit ${res.status}: ${errBody}`);
    process.exit(1);
  }
  const data = await res.json();
  if (!data.idToken) {
    console.error(`ERROR: response missing idToken: ${JSON.stringify(data)}`);
    process.exit(1);
  }
  process.stdout.write(data.idToken);
}

(async () => {
  try {
    if (CLEANUP) {
      await cleanup();
    } else {
      await getIdToken();
    }
    process.exit(0);
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    if (e.stack) console.error(e.stack);
    process.exit(1);
  }
})();
