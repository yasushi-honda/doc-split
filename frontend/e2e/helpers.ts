/**
 * E2Eテスト共通ヘルパー
 */

import { Page } from '@playwright/test';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

export const TEST_USER = {
  email: 'test@example.com',
  password: 'testpassword123',
};

/**
 * Emulator環境でメール/パスワードログイン
 * @param waitSelector ログイン後の待機セレクタ（モバイルでは 'h1:has-text("書類管理")' を指定）
 */
export async function loginWithTestUser(page: Page, waitSelector = 'text=書類一覧') {
  await page.goto('/');
  await page.evaluate(
    async ({ email, password }) => {
      // @ts-expect-error - Vite devサーバー経由でモジュール解決
      const { auth, signInWithEmailAndPassword } = await import('/src/lib/firebase.ts');
      await signInWithEmailAndPassword(auth, email, password);
    },
    { email: TEST_USER.email, password: TEST_USER.password }
  );
  await page.waitForSelector(waitSelector, { timeout: 10000 });
}

/** タブをクリック */
export async function clickTab(page: Page, tabName: string) {
  await page.locator('[role="tab"]').filter({ hasText: tabName }).click();
}

/**
 * Firestore Emulatorへ直接接続するfirebase-admin Firestoreインスタンス(E2E専用)。
 * `firebase emulators:exec`が`FIRESTORE_EMULATOR_HOST`/`GCLOUD_PROJECT`を注入した
 * プロセス内で呼び出すこと(scripts/seed-*.jsと同じ接続方式)。
 */
function getAdminFirestore() {
  const projectId = process.env.GCLOUD_PROJECT || 'doc-split-dev';
  if (getApps().length === 0) {
    initializeApp({ projectId });
  }
  return getFirestore();
}

/**
 * Issue #1031 E2E用: `documents`コレクションを`fileName`で検索し、statusを直接更新する。
 * OCR処理そのもの(外部Gemini API呼び出し)はCI環境で実行不能なため、`pending`documentに
 * 対してバックグラウンド完了(onSnapshot経由)をシミュレートする。
 */
export async function updateDocumentStatusByFileName(fileName: string, status: string) {
  const db = getAdminFirestore();
  const snap = await db.collection('documents').where('fileName', '==', fileName).limit(1).get();
  if (snap.empty) {
    throw new Error(`no document found for fileName=${fileName}`);
  }
  await snap.docs[0]!.ref.update({ status });
}

/**
 * Issue #1031 E2E用: `documents/status:'pending'`ドキュメントを直接作成する(functions/src/upload/uploadPdf.tsが
 * トランザクションで作成する内容を模倣、`detail/main`サブコレクションは省略)。
 *
 * 実uploadPdf Cloud Functionは`onCall`ハンドラの先頭でCloud Storageへの書き込み(`file.save()`)を行うが、
 * このE2E実行では`firebase emulators:exec --only auth,firestore,functions`(Storageエミュレータ非対象、
 * 既存CI設定と同じ)で動かすためStorageアクセスが失敗する。そのためPlaywrightの`page.route`で
 * uploadPdf呼び出し自体をインターセプトし、この関数でFirestoreへ直接ドキュメントを作成した上で
 * 成功レスポンスを返す(Storage保存を要しないバックグラウンド継続UIの契約のみを検証する)。
 */
export async function createPendingDocumentForE2E(fileName: string): Promise<string> {
  const db = getAdminFirestore();
  const docRef = db.collection('documents').doc();
  await docRef.set({
    id: docRef.id,
    processedAt: new Date(),
    fileId: `e2e-fake-fileId-${docRef.id}`,
    fileName,
    mimeType: 'application/pdf',
    documentType: '',
    customerName: '',
    officeName: '',
    fileUrl: `gs://e2e-fake-bucket/${fileName}`,
    fileDate: null,
    isDuplicateCustomer: false,
    totalPages: 0,
    targetPageNumber: 1,
    status: 'pending',
    sourceType: 'upload',
  });
  return docRef.id;
}
