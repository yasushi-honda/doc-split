#!/usr/bin/env ts-node
/**
 * summary生成経路(要約)の実コスト測定スクリプト(Issue #562)
 *
 * PR #561(Gemini 3.5 Flash移行)のレビューで、summary経路(`generateSummaryCore`)が
 * OCR経路と異なりthinkingConfigを一切設定していないことが判明した。gemini-3.5-flashは
 * thinkingトークンが常時発生しうるため、実際にどの程度のthinkingトークン/コストが
 * 発生するかをdev環境の実文書で1回実測し、Issue #562の対応要否判断の材料とする。
 *
 * `generateSummaryCore`をFirestore上の既存文書のocrResultで直接1回呼び出す
 * (`regenerateSummary` onCallと同じコア関数、認証層はバイパス)。実際にVertex AIへの
 * 課金が発生し、trackGeminiUsage経由でstats/gemini/daily/{today}のsummary内訳が
 * 更新される点に留意(measurement目的の実行のため許容)。文書自体への書込は行わない。
 *
 * 使用方法:
 *   推奨: GitHub Actions "Run Operations Script" → environment: dev /
 *         script: measure-summary-cost --doc-id
 *   ローカル実行（フォールバック）:
 *     gcloud auth application-default login (doc-split-dev環境のアカウントで)
 *     FIREBASE_PROJECT_ID=doc-split-dev npx ts-node scripts/measure-summary-cost.ts --doc-id <docId>
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

const docIdIndex = process.argv.indexOf('--doc-id');
const docId = docIdIndex >= 0 ? process.argv[docIdIndex + 1] : undefined;
if (!docId) {
  console.error('--doc-id <docId> を指定してください');
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

async function main(): Promise<void> {
  // functions/src/utils/rateLimiter.ts はモジュールトップレベルで admin.firestore()
  // を参照するため(GEMINI_PRICING経由でsummaryGenerator.tsから間接importされる)、
  // 静的importだとadmin.initializeApp()より先に評価されてFirebaseAppError(no-app)に
  // なる。動的importでadmin初期化後まで評価を遅延させる
  // (rateLimiterIntegration.test.tsの./helpers/initFirestoreEmulator分離と同種の対策)。
  const { generateSummaryCore, MIN_OCR_LENGTH_FOR_SUMMARY } = await import('../functions/src/ocr/summaryGenerator');

  const snap = await db.doc(`documents/${docId}`).get();
  if (!snap.exists) {
    console.error(`❌ documents/${docId} が見つかりません`);
    process.exit(1);
  }

  const data = snap.data()!;
  // ADR-0018 Phase D PR-D4 (Issue #547): detail/main優先 + 親フォールバックで
  // ocrResultを解決する。frontend/src/hooks/useDocuments.ts の resolveDetailFields、
  // functions/src/ocr/documentDetail.ts と同じフィールド単位フォールバック規則。
  const detailSnap = await db.doc(`documents/${docId}/detail/main`).get();
  const detailData = detailSnap.exists ? detailSnap.data() : undefined;
  const ocrResult: string = typeof detailData?.ocrResult === 'string'
    ? detailData.ocrResult
    : (typeof data.ocrResult === 'string' ? data.ocrResult : '');
  const documentType: string = data.documentType || '';

  console.log(`対象文書: ${docId}`);
  console.log(`documentType: ${documentType || '(なし)'}`);
  console.log(`ocrResult文字数: ${ocrResult.length}`);

  if (ocrResult.length < MIN_OCR_LENGTH_FOR_SUMMARY) {
    console.error(
      `❌ ocrResultが短すぎます (${ocrResult.length}文字 < 最小${MIN_OCR_LENGTH_FOR_SUMMARY}文字)。summary生成をスキップします。`
    );
    process.exit(1);
  }

  console.log('\n--- generateSummaryCore実行(実Gemini呼び出し) ---');
  const result = await generateSummaryCore(ocrResult, documentType);
  console.log('\n--- 結果 ---');
  console.log(JSON.stringify(result, null, 2));
  console.log(
    '\n✅ 完了。stats/gemini/daily/{today}のbySource.summaryに実測値が記録されました。' +
      '(check-gemini-cost-statsで確認可能)'
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('ERROR:', err);
    process.exit(1);
  });
