#!/usr/bin/env ts-node
/**
 * 候補抽出のドキュメント単位実機検証（read-only、docs/handoff/GOAL.md タスクB）
 *
 * scripts/spike-candidate-extraction.ts（タスクA）はページ単位で候補抽出を検証したが、
 * 本番実装（functions/src/ocr/ocrProcessor.ts の extractOcrCandidates()）は
 * ドキュメント単位（複数ページ結合済みocrResult）で1回だけ呼び出す設計。
 * この粒度の乖離はCodexセカンドオピニオン（1回目のreview-diff）で指摘され、
 * GOAL.mdタスクAに既知の限界として記録されていた。
 *
 * 本スクリプトは実装済みのextractOcrCandidates()を直接import(再実装ではない)し、
 * dev環境seedフィクスチャの複数ページ文書を対象に、本番と同じ結合フォーマット
 * （`--- Page N ---\n${text}`をpageResultsと同じ順序でjoin）で実際にドキュメント単位
 * 呼出しを行い、以下を確認する:
 *   1. 複数ページ分の結合テキストを入力にしても安定してJSON解析できるか
 *   2. ドキュメント単位1回あたりの実際のプロンプトサイズ・トークンコスト
 *   3. 結合済みocrResult全体に対するgrounding（候補がどこかのページに逐語的に存在するか）
 *
 * 使用方法:
 *   推奨: GitHub Actions "Run Operations Script" → environment: dev /
 *         script: verify-candidate-extraction-document-level で実行（ADC不要）。
 *   ローカル実行（フォールバック）:
 *     gcloud auth application-default login (doc-split-dev環境のアカウントで)
 *     GOOGLE_CLOUD_PROJECT=doc-split-dev npx ts-node scripts/verify-candidate-extraction-document-level.ts
 */

import * as admin from 'firebase-admin';
import { GoogleGenAI } from '@google/genai';
import { withRetry, RETRY_CONFIGS } from '../functions/src/utils/retry';
import { GEMINI_CONFIG } from '../functions/src/utils/config';
import { normalizeForMatching } from '../functions/src/utils/extractors';
import { MIXED_FAX_PDFS, readFixture } from './seed-dev-data';
import { CANDIDATE_MODEL_CONFIG, buildOcrPrompt, extractAllPdfPages } from './lib/geminiOcrCompare';

/** scripts/compare-gemini-ocr-models.ts と同じ意図の誤課金防止ガード */
const ALLOWED_PROJECT_ID = 'doc-split-dev';

const PROJECT_ID =
  process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || '';
const LOCATION = 'asia-northeast1';

if (!PROJECT_ID) {
  console.error('GOOGLE_CLOUD_PROJECT (または FIREBASE_PROJECT_ID) を設定してください');
  process.exit(1);
}

if (PROJECT_ID !== ALLOWED_PROJECT_ID) {
  console.error(
    `❌ このスクリプトは ${ALLOWED_PROJECT_ID} 専用です (指定されたプロジェクト: ${PROJECT_ID})。` +
      'dev環境seedフィクスチャの正解ラベル前提のため他環境では実行できません。'
  );
  process.exit(1);
}

// scripts/measure-summary-cost.ts と同じ理由: functions/src/ocr/ocrProcessor.ts はモジュール
// スコープで admin.firestore()/admin.storage() を呼ぶため、admin.initializeApp() より前に
// 静的importすると FirebaseAppError(no-app) になる。initializeApp後に動的importする。
admin.initializeApp({ projectId: PROJECT_ID });

async function ocrPageVerbatim(
  ai: InstanceType<typeof GoogleGenAI>,
  pageBuffer: Buffer,
  pageNumber: number
): Promise<string> {
  const base64Data = pageBuffer.toString('base64');
  const response = await withRetry(
    () =>
      ai.models.generateContent({
        model: CANDIDATE_MODEL_CONFIG.modelId,
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType: 'application/pdf', data: base64Data } },
              { text: buildOcrPrompt(pageNumber) },
            ],
          },
        ],
        config: {
          maxOutputTokens: GEMINI_CONFIG.maxOutputTokens,
          thinkingConfig: CANDIDATE_MODEL_CONFIG.thinkingConfig,
        },
      }),
    RETRY_CONFIGS.gemini
  );
  return response.text || '';
}

async function main(): Promise<void> {
  console.log('=== 候補抽出ドキュメント単位実機検証 (docs/handoff/GOAL.md タスクB) ===');
  console.log(`プロジェクト: ${PROJECT_ID} / リージョン: ${LOCATION}`);
  console.log(`対象文書数: ${MIXED_FAX_PDFS.length} (${MIXED_FAX_PDFS.map((m) => m.id).join(', ')})`);

  // 実装済みの本番関数をそのまま呼ぶ(再実装ではない)。admin.initializeApp()後の動的importが必須。
  const { extractOcrCandidates } = await import('../functions/src/ocr/ocrProcessor');

  const ai = new GoogleGenAI({ vertexai: true, project: PROJECT_ID, location: LOCATION });

  let successCount = 0;
  let attemptCount = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalThinking = 0;
  let groundedCount = 0;
  let nonNullCount = 0;

  for (const mixed of MIXED_FAX_PDFS) {
    const pdfBuffer = readFixture(mixed.fixture);
    const pageBuffers = await extractAllPdfPages(pdfBuffer);

    // 本番のprocessDocument()と同じ結合フォーマット(ocrProcessor.ts:331-333)を再現
    const pageTexts: string[] = [];
    for (let i = 0; i < pageBuffers.length; i++) {
      const text = await ocrPageVerbatim(ai, pageBuffers[i], i + 1);
      pageTexts.push(`--- Page ${i + 1} ---\n${text}`);
    }
    const ocrResult = pageTexts.join('\n\n');
    console.log(
      `\n[${mixed.id}] ${pageBuffers.length}ページ結合、ocrResult長=${ocrResult.length}文字`
    );

    attemptCount++;
    // 実装済みの本番関数をそのまま呼ぶ(再実装ではない)
    const result = await extractOcrCandidates(ocrResult);
    totalInput += result.inputTokens;
    totalOutput += result.outputTokens;
    totalThinking += result.thinkingTokens;

    const isEmpty =
      result.documentTypeCandidate === null &&
      result.customerNameCandidate === null &&
      result.officeNameCandidate === null &&
      result.dateCandidate === null;
    if (isEmpty) {
      console.log(`  ❌ 全項目null(JSON解析失敗またはAPI異常の可能性、extractOcrCandidates内でwarn出力済み)`);
      continue;
    }
    successCount++;

    const fields: Array<[string, string | null]> = [
      ['documentType', result.documentTypeCandidate],
      ['customer', result.customerNameCandidate],
      ['office', result.officeNameCandidate],
      ['date', result.dateCandidate],
    ];
    const normalizedOcrResult = normalizeForMatching(ocrResult);
    const summary = fields
      .map(([label, candidate]) => {
        if (candidate === null) return `${label}=(null)`;
        nonNullCount++;
        const grounded = normalizedOcrResult.includes(normalizeForMatching(candidate));
        if (grounded) groundedCount++;
        return `${label}=${grounded ? '✅grounded' : `⚠️not-grounded:"${candidate}"`}`;
      })
      .join(' / ');
    console.log(`  ${summary} (in=${result.inputTokens}/out=${result.outputTokens}/thinking=${result.thinkingTokens})`);
  }

  console.log(`\n実行結果: 成功 ${successCount}/${attemptCount}`);
  console.log(`grounding: ${groundedCount}/${nonNullCount} 件の非null候補がocrResult全体内に逐語的に存在`);
  if (attemptCount > 0) {
    console.log(
      `ドキュメント単位1回あたりの平均トークン: input=${(totalInput / attemptCount).toFixed(0)} ` +
        `output=${(totalOutput / attemptCount).toFixed(0)} thinking=${(totalThinking / attemptCount).toFixed(0)}`
    );
    const pricing = CANDIDATE_MODEL_CONFIG.pricing;
    const billableOutput = totalOutput + totalThinking;
    const costUsd = (totalInput * pricing.inputPer1MTokens + billableOutput * pricing.outputPer1MTokens) / 1_000_000;
    console.log(`候補抽出呼出しの概算コスト (試行${attemptCount}件、ドキュメント単位): $${costUsd.toFixed(6)}`);
  }

  if (successCount < attemptCount) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('❌ エラー:', err);
  process.exit(1);
});
