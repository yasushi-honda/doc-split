#!/usr/bin/env ts-node
/**
 * Gemini 2.5 Flash vs 3.5 Flash OCR精度+コスト比較スクリプト（read-only、Issue #548）
 *
 * dev環境のseedフィクスチャ（scripts/seed-dev-data.ts の MIXED_FAX_PDFS、正解ラベル付き
 * 2ファイル・5segment・計11ページ）を両モデルでページ単位OCRし、functions/src/utils/extractors.ts
 * の各抽出関数（extractDocumentTypeEnhanced / extractCustomerCandidates / extractOfficeCandidates）を
 * functions/src/ocr/ocrProcessor.ts の processDocument() と同じ呼出形（filenameInfo込み）で使い、
 * 書類種別/顧客/事業所の3フィールドの抽出精度を比較する。日付(date)は対象外
 * （Issue #548本文が言及する4フィールドのうち3つのみを検証。理由: 正解の期待日付文字列を
 * ground truthとして別途モデリングする必要があり本スクリプトのスコープ外としたため）。
 *
 * Issue #548 の必須トリガー条件「dev seedでの2.5 vs 3.5 A/B PASS」のうち、上記3フィールドの
 * 精度非劣化を検証する。Firestore/Storageへの書込は一切行わない（ローカルfixture読込 +
 * Vertex AI呼出のみ）。
 *
 * 使用方法:
 *   推奨: GitHub Actions "Run Operations Script" → environment: dev /
 *         script: compare-gemini-ocr-models で実行（docsplit-cloud-build SAに
 *         roles/aiplatform.user 付与済み、ADC不要）。
 *   ローカル実行（フォールバック）:
 *     gcloud auth application-default login (doc-split-dev環境のアカウントで)
 *     GOOGLE_CLOUD_PROJECT=doc-split-dev npx ts-node scripts/compare-gemini-ocr-models.ts
 */

import { GoogleGenAI, ThinkingLevel, type ThinkingConfig } from '@google/genai';
import { PDFDocument } from 'pdf-lib';
import { withRetry, RETRY_CONFIGS } from '../functions/src/utils/retry';
import { GEMINI_CONFIG } from '../functions/src/utils/config';
import {
  extractDocumentTypeEnhanced,
  extractCustomerCandidates,
  extractOfficeCandidates,
  extractFilenameInfo,
} from '../functions/src/utils/extractors';
import type { DocumentMaster, CustomerMaster, OfficeMaster } from '../shared/types';
import { MIXED_FAX_PDFS, readFixture, CUSTOMERS, OFFICES, DOC_TYPES, CARE_MANAGERS } from './seed-dev-data';

/**
 * scripts/seed-dev-data.ts の ALLOWED_PROJECT_ID ガードと同じ意図: 本スクリプトは
 * dev環境のseedフィクスチャ(scripts/fixtures/seed/)の正解ラベルを前提にしており、
 * kanameone/cocoro等の他環境で実行しても意味を成さない。run-ops-script.yml は
 * environment(dev/kanameone/cocoro) × script の組合せを自由に選べる共通ワークフローの
 * ため、選択ミスでVertex AI課金が発生する事故を防ぐ (IAM権限の有無への間接依存ではなく
 * スクリプト自身で明示的に弾く)。
 */
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

type ModelRole = 'baseline' | 'candidate';

interface ModelConfig {
  role: ModelRole;
  label: string;
  modelId: string;
  thinkingConfig: ThinkingConfig;
  pricing: { inputPer1MTokens: number; outputPer1MTokens: number };
}

/**
 * 比較対象モデル定義。2.5は現行既定値(GEMINI_OCR_THINKING_BUDGET未設定時のデフォルト、
 * functions/src/utils/config.ts GEMINI_CONFIG.ocrThinkingBudget参照)、3.5はIssue #548
 * 移行予定設定(thinking完全無効化不可のため最小のlow)。
 * 単価は Vertex AI Gemini API 公式料金ページ(https://cloud.google.com/vertex-ai/generative-ai/pricing)
 * で確認済み(2026-07-06、gemini-2.5-flash/gemini-3.5-flash)。
 */
const MODEL_CONFIGS: ModelConfig[] = [
  {
    role: 'baseline',
    label: 'gemini-2.5-flash(現行)',
    modelId: 'gemini-2.5-flash',
    thinkingConfig: { thinkingBudget: 0 },
    pricing: { inputPer1MTokens: 0.3, outputPer1MTokens: 2.5 },
  },
  {
    role: 'candidate',
    label: 'gemini-3.5-flash(移行予定)',
    modelId: 'gemini-3.5-flash',
    thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    pricing: { inputPer1MTokens: 1.5, outputPer1MTokens: 9.0 },
  },
];

/**
 * functions/src/ocr/ocrProcessor.ts の OCR プロンプトと同一ベース + ページ番号suffix
 * (本番の ocrWithGemini はPDFの全ページで pageNumber を渡すため、常にsuffixが付与される。
 * 比較条件を揃えるためsuffixもページごとに付与する)。
 */
function buildOcrPrompt(pageNumber: number): string {
  return `
この画像/PDFの内容をOCRしてください。

【指示】
- テキストをそのまま正確に抽出してください
- 表がある場合は、構造を保ってテキスト化してください
- 手書き文字も可能な限り読み取ってください
- 読み取れない部分は[判読不能]と記載してください
- 余計な説明は不要です。抽出したテキストのみを出力してください

これは${pageNumber}ページ目です。
`;
}

interface PageGroundTruth {
  fixtureId: string;
  /** fixture内の1-basedページ番号 */
  pageNumber: number;
  /** ファイル名から事業所推定するfilenameInfo生成用 (functions/src/ocr/ocrProcessor.ts と同じ経路) */
  fileName: string;
  docType: string;
  customer: string;
  office: string;
}

/** MIXED_FAX_PDFS の segments（累積ページ数）をページ単位の正解ラベルに展開する */
function expandGroundTruth(): PageGroundTruth[] {
  const pages: PageGroundTruth[] = [];
  for (const mixed of MIXED_FAX_PDFS) {
    let pageNumber = 0;
    for (const seg of mixed.segments) {
      for (let p = 0; p < seg.pages; p++) {
        pageNumber += 1;
        pages.push({
          fixtureId: mixed.id,
          pageNumber,
          fileName: mixed.fileName,
          docType: seg.docType,
          customer: seg.customer,
          office: seg.office,
        });
      }
    }
  }
  return pages;
}

/** PDFから単一ページを抽出 (functions/src/ocr/ocrProcessor.ts の extractPdfPage と同ロジック) */
async function extractPdfPage(pdfBuffer: Buffer, pageIndex: number): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const newPdf = await PDFDocument.create();
  const [copiedPage] = await newPdf.copyPages(pdfDoc, [pageIndex]);
  newPdf.addPage(copiedPage);
  const pdfBytes = await newPdf.save();
  return Buffer.from(pdfBytes);
}

function buildMasters(): { documents: DocumentMaster[]; customers: CustomerMaster[]; offices: OfficeMaster[] } {
  return {
    documents: DOC_TYPES.map((t) => ({
      name: t.name,
      category: t.category,
      dateMarker: t.dateMarker,
      keywords: t.keywords,
    })),
    customers: CUSTOMERS.map((c) => ({
      id: c.id,
      name: c.name,
      furigana: c.furigana,
      careManagerName: CARE_MANAGERS[c.cm].name,
    })),
    offices: OFFICES.map((o) => ({
      id: o.id,
      name: o.name,
      shortName: o.shortName,
    })),
  };
}

interface PageOcrOutcome {
  groundTruth: PageGroundTruth;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  docTypeMatch: boolean;
  customerMatch: boolean;
  officeMatch: boolean;
  /** true の場合、空応答がsafetyブロック等のAPI異常由来の可能性があり、判定に含めるべきでない疑いがある */
  anomalous: boolean;
}

async function ocrPage(
  ai: InstanceType<typeof GoogleGenAI>,
  modelConfig: ModelConfig,
  pageBuffer: Buffer,
  pageNumber: number
): Promise<{ text: string; inputTokens: number; outputTokens: number; thinkingTokens: number; anomalous: boolean }> {
  const base64Data = pageBuffer.toString('base64');

  const response = await withRetry(
    () =>
      ai.models.generateContent({
        model: modelConfig.modelId,
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
          thinkingConfig: modelConfig.thinkingConfig,
        },
      }),
    RETRY_CONFIGS.gemini
  );

  const text = response.text || '';
  const usageMetadata = response.usageMetadata;

  // Issue #559 silent-failure-hunter指摘: response.text は safetyブロック/zero-candidate等
  // API異常時にも例外を投げず単に undefined を返す (@google/genai getter実装)。空応答を
  // 無言で「OCR誤読」と同一視すると、n=11の少数サンプルでPASS/FAIL判定が異常値に左右されうる。
  let anomalous = false;
  if (!response.text) {
    const candidate = response.candidates?.[0];
    const finishReason = candidate?.finishReason;
    const blockReason = response.promptFeedback?.blockReason;
    if (blockReason || (finishReason && finishReason !== 'STOP')) {
      anomalous = true;
      console.warn(
        `⚠️ [${modelConfig.label}] p${pageNumber}: 空応答検出 (API異常の可能性) ` +
          `finishReason=${finishReason ?? 'none'} blockReason=${blockReason ?? 'none'} — ` +
          `この結果はモデルの読取精度ではなくAPI応答異常が原因の可能性があります`
      );
    }
  }

  return {
    text,
    inputTokens: usageMetadata?.promptTokenCount || 0,
    outputTokens: usageMetadata?.candidatesTokenCount || 0,
    thinkingTokens: usageMetadata?.thoughtsTokenCount || 0,
    anomalous,
  };
}

async function runModel(
  modelConfig: ModelConfig,
  groundTruthPages: PageGroundTruth[],
  masters: ReturnType<typeof buildMasters>
): Promise<PageOcrOutcome[]> {
  const ai = new GoogleGenAI({ vertexai: true, project: PROJECT_ID, location: LOCATION });
  const outcomes: PageOcrOutcome[] = [];

  // fixtureごとにPDFを一度だけ読み込み、ページ抽出は都度行う (groundTruthのpageNumberはfixture内1-based)
  const fixtureBuffers = new Map(MIXED_FAX_PDFS.map((m) => [m.id, readFixture(m.fixture)]));

  for (const gt of groundTruthPages) {
    const pdfBuffer = fixtureBuffers.get(gt.fixtureId);
    if (!pdfBuffer) throw new Error(`fixture buffer not found for ${gt.fixtureId}`);

    const pageBuffer = await extractPdfPage(pdfBuffer, gt.pageNumber - 1);
    const { text, inputTokens, outputTokens, thinkingTokens, anomalous } = await ocrPage(
      ai,
      modelConfig,
      pageBuffer,
      gt.pageNumber
    );

    // functions/src/ocr/ocrProcessor.ts の processDocument() と同じ抽出関数・同じ呼出形
    // (filenameInfo込みのextractOfficeCandidates) を使う。extractAllInformation() は内部で
    // extractOfficeNameEnhanced (filenameInfo非対応) を使うため、本番の事業所抽出とは
    // 別ロジックになってしまい使わない (Issue #559 Codex/comment-analyzer指摘)。
    const filenameInfo = extractFilenameInfo(gt.fileName);
    const documentTypeResult = extractDocumentTypeEnhanced(text, masters.documents);
    const customerResult = extractCustomerCandidates(text, masters.customers);
    const officeResult = extractOfficeCandidates(text, masters.offices, { filenameInfo });

    const docTypeMatch = documentTypeResult.documentType === gt.docType;
    const customerMatch = customerResult.bestMatch?.name === gt.customer;
    const officeMatch = officeResult.bestMatch?.name === gt.office;

    outcomes.push({
      groundTruth: gt,
      inputTokens,
      outputTokens,
      thinkingTokens,
      docTypeMatch,
      customerMatch,
      officeMatch,
      anomalous,
    });

    console.log(
      `  [${modelConfig.label}] ${gt.fixtureId} p${gt.pageNumber}: ` +
        `docType=${docTypeMatch ? '✅' : '❌'} customer=${customerMatch ? '✅' : '❌'} office=${officeMatch ? '✅' : '❌'} ` +
        `(in=${inputTokens}/out=${outputTokens}/thinking=${thinkingTokens})`
    );
    if (!docTypeMatch) {
      console.log(`    docType不一致: expected="${gt.docType}" actual="${documentTypeResult.documentType ?? '(none)'}"`);
    }
    if (!customerMatch) {
      console.log(`    customer不一致: expected="${gt.customer}" actual="${customerResult.bestMatch?.name ?? '(none)'}"`);
    }
    if (!officeMatch) {
      console.log(`    office不一致: expected="${gt.office}" actual="${officeResult.bestMatch?.name ?? '(none)'}"`);
    }
  }

  return outcomes;
}

interface ModelSummary {
  role: ModelRole;
  label: string;
  total: number;
  docTypePass: number;
  customerPass: number;
  officePass: number;
  allPass: number;
  anomalousCount: number;
  totalInput: number;
  totalOutput: number;
  totalThinking: number;
  costUsd: number;
}

function summarize(
  modelConfig: ModelConfig,
  outcomes: PageOcrOutcome[]
): ModelSummary {
  const { role, label, pricing } = modelConfig;
  const total = outcomes.length;
  const docTypePass = outcomes.filter((o) => o.docTypeMatch).length;
  const customerPass = outcomes.filter((o) => o.customerMatch).length;
  const officePass = outcomes.filter((o) => o.officeMatch).length;
  const allPass = outcomes.filter((o) => o.docTypeMatch && o.customerMatch && o.officeMatch).length;
  const anomalousCount = outcomes.filter((o) => o.anomalous).length;

  const totalInput = outcomes.reduce((s, o) => s + o.inputTokens, 0);
  const totalOutput = outcomes.reduce((s, o) => s + o.outputTokens, 0);
  const totalThinking = outcomes.reduce((s, o) => s + o.thinkingTokens, 0);
  const billableOutput = totalOutput + totalThinking;
  const costUsd = (totalInput * pricing.inputPer1MTokens + billableOutput * pricing.outputPer1MTokens) / 1_000_000;

  console.log(`\n=== ${label} ===`);
  console.log(`書類種別 一致率: ${docTypePass}/${total} (${((docTypePass / total) * 100).toFixed(1)}%)`);
  console.log(`顧客     一致率: ${customerPass}/${total} (${((customerPass / total) * 100).toFixed(1)}%)`);
  console.log(`事業所   一致率: ${officePass}/${total} (${((officePass / total) * 100).toFixed(1)}%)`);
  console.log(`全項目一致      : ${allPass}/${total} (${((allPass / total) * 100).toFixed(1)}%)`);
  if (anomalousCount > 0) {
    console.log(`⚠️ API異常疑いの空応答: ${anomalousCount}/${total} 件 (判定に影響している可能性、上記ログのwarning参照)`);
  }
  console.log(`トークン: input=${totalInput} output=${totalOutput} thinking=${totalThinking}`);
  console.log(`概算コスト(本テストのみ): $${costUsd.toFixed(6)}`);

  return { role, label, total, docTypePass, customerPass, officePass, allPass, anomalousCount, totalInput, totalOutput, totalThinking, costUsd };
}

async function main(): Promise<void> {
  const groundTruthPages = expandGroundTruth();
  const masters = buildMasters();

  console.log('=== Gemini 2.5 vs 3.5 Flash OCR比較 (Issue #548) ===');
  console.log(`プロジェクト: ${PROJECT_ID} / リージョン: ${LOCATION}`);
  console.log(`対象ページ数: ${groundTruthPages.length} (${MIXED_FAX_PDFS.map((m) => m.id).join(', ')})`);

  const summaries: ModelSummary[] = [];
  for (const modelConfig of MODEL_CONFIGS) {
    console.log(`\n--- ${modelConfig.label} 実行中... ---`);
    const outcomes = await runModel(modelConfig, groundTruthPages, masters);
    summaries.push(summarize(modelConfig, outcomes));
  }

  // MODEL_CONFIGS の配列順序ではなく role で明示的に取得する (Issue #559 code-simplifier/
  // type-design-analyzer指摘: 配列順への暗黙依存はMODEL_CONFIGS変更時に判定を静かに壊す)。
  const baseline = summaries.find((s) => s.role === 'baseline');
  const migrated = summaries.find((s) => s.role === 'candidate');
  if (!baseline || !migrated) {
    throw new Error(
      `baseline/candidate の role を持つ ModelSummary が揃っていません (summaries: ${summaries.map((s) => s.role).join(',')})`
    );
  }

  console.log('\n=== 判定 (Issue #548 トリガー条件: 3.5の精度が2.5を下回らないこと。書類種別/顧客/事業所の3フィールド、日付は対象外) ===');
  const regressed = migrated.allPass < baseline.allPass;
  console.log(regressed ? '❌ FAIL: 3.5 Flashで精度劣化を検出' : '✅ PASS: 精度劣化なし');
  console.log(`コスト比 (このテストのみ、実運用スケールの参考値ではない): ${(migrated.costUsd / baseline.costUsd).toFixed(2)}倍`);

  // Issue #559 Codex P1指摘: 判定がFAILでもexit codeが0のままだとGitHub Actions上は
  // 緑のままになり、実際には精度劣化を検出していても見た目上パスしたように誤読されうる。
  if (regressed) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('❌ エラー:', err);
  process.exit(1);
});
