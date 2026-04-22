/**
 * Firestore emulator 接続 + default admin app 初期化 (integration test 用 helper)
 *
 * integration test で processOCR.ts 等を import すると、rateLimiter.ts → errorLogger.ts
 * 経由で module-level `admin.firestore()` が評価される。ESM loader では import が hoist
 * されて admin.initializeApp() より先に処理される。そこで本ヘルパーを
 *
 *   import './helpers/initFirestoreEmulator';  // default app 初期化を先行実行
 *   import { rescueStuckProcessingDocs } from '../src/ocr/processOCR';
 *
 * の順で top-level import することで、ESM の depth-first module resolution を利用して
 * processOCR.ts 評価前に default app を確実に初期化する。
 *
 * ocrRetryIntegration.test.ts は named app 方式で独立しているため干渉しない。
 */

import * as admin from 'firebase-admin';

process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8085';

// default app 初期化。同一 mocha run 内で複数の integration test が本ヘルパーを import しても
// 1 回だけ初期化されるよう duplicate-app を無視する。
try {
  admin.initializeApp({ projectId: 'rescue-stuck-integration-test' });
} catch (e) {
  const err = e as { code?: string };
  if (err?.code !== 'app/duplicate-app') throw e;
}

export {};
