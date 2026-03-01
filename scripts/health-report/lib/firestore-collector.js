const admin = require('firebase-admin');

const apps = new Map();

function getApp(projectId) {
  if (apps.has(projectId)) return apps.get(projectId);
  const appName = `health-report-${projectId}`;
  const app = admin.initializeApp({ projectId }, appName);
  apps.set(projectId, app);
  return app;
}

async function collectDocumentStats(projectId) {
  const app = getApp(projectId);
  const db = admin.firestore(app);

  const statuses = ['processed', 'pending', 'processing', 'error', 'split'];
  const counts = {};

  await Promise.all(
    statuses.map(async (status) => {
      try {
        const snapshot = await db.collection('documents').where('status', '==', status).count().get();
        counts[status] = snapshot.data().count;
      } catch (err) {
        console.warn(`Failed to count status="${status}" for ${projectId}:`, err.message);
        counts[status] = '?';
      }
    })
  );

  return counts;
}

async function collectErrorDocuments(projectId, limit = 5) {
  const app = getApp(projectId);
  const db = admin.firestore(app);

  try {
    const snapshot = await db
      .collection('documents')
      .where('status', '==', 'error')
      .orderBy('updatedAt', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        fileName: data.fileName || '(no name)',
        errorMessage: data.lastErrorMessage || data.errorMessage || '-',
      };
    });
  } catch (err) {
    console.warn(`Failed to collect error documents for ${projectId}:`, err.message);
    return [];
  }
}

async function collectAll(projectId) {
  const [documentStats, errorDocuments] = await Promise.all([
    collectDocumentStats(projectId).catch(() => ({ error: 'Failed to collect' })),
    collectErrorDocuments(projectId).catch(() => []),
  ]);

  return { documentStats, errorDocuments };
}

function cleanup() {
  for (const app of apps.values()) {
    app.delete().catch(() => {});
  }
  apps.clear();
}

module.exports = { collectAll, collectDocumentStats, collectErrorDocuments, cleanup };
