#!/usr/bin/env ts-node
/**
 * Gemini 2.5 Flash vs 3.5 Flash OCR精度+コスト比較スクリプト（read-only、Issue #548）
 *
 * dev環境のseedフィクスチャ（scripts/seed-dev-data.ts の MIXED_FAX_PDFS、正解ラベル付き
 * 2ファイル・5segment・計11ページ）を両モデルでページ単位OCRし、extractors.ts の実突合
 * ロジック（extractAllInformation）で書類種別/顧客/事業所の抽出精度を比較する。
 *
 * Issue #548 の必須トリガー条件「dev seedでの2.5 vs 3.5 A/B PASS」（3.5移行で精度が
 * 劣化しないこと）を検証するための唯一の残工程。Firestore/Storageへの書込は一切行わない
 * （ローカルfixture読込 + Vertex AI呼出のみ）。
 *
 * 使用方法:
 *   GOOGLE_CLOUD_PROJECT=doc-split-dev npx ts-node scripts/compare-gemini-ocr-models.ts
 *
 * 前提: Vertex AI (Gemini) 呼出権限を持つGCP認証(ADC)が必要。
 *   ローカル: gcloud auth application-default login (doc-split-dev環境のアカウントで)
 *   注意: 本スクリプトはCLAUDE.md「運用スクリプトはGitHub Actions経由」の対象外
 *   （Firestore/Storageを触らずVertex AI呼出のみのため、既存run-ops-script.ymlの
 *   スコープと異なる。ローカルADCでの単発実行を想定）。
 */

import { GoogleGenAI, ThinkingLevel, type ThinkingConfig } from '@google/genai';
import { PDFDocument } from 'pdf-lib';
import { withRetry, RETRY_CONFIGS } from '../functions/src/utils/retry';
import { extractAllInformation } from '../functions/src/utils/extractors';
import type { DocumentMaster, CustomerMaster, OfficeMaster } from '../shared/types';
import { MIXED_FAX_PDFS, readFixture, CUSTOMERS, OFFICES, DOC_TYPES, CARE_MANAGERS } from './seed-dev-data';

const PROJECT_ID =
  process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || '';
const LOCATION = 'asia-northeast1';

if (!PROJECT_ID) {
  console.error('GOOGLE_CLOUD_PROJECT (または FIREBASE_PROJECT_ID) を設定してください');
  process.exit(1);
}

// functions/src/utils/config.ts の GEMINI_CONFIG.maxOutputTokens と同値 (Issue #205踏襲)
const MAX_OUTPUT_TOKENS = 8192;

interface ModelConfig {
  label: string;
  modelId: string;
  thinkingConfig: ThinkingConfig;
  pricing: { inputPer1MTokens: number; outputPer1MTokens: number };
}

/** 比較対象モデル定義。2.5は現行本番設定、3.5はIssue #548移行予定設定。単価は公式サイト確認済み(2026-07-06)。 */
const MODEL_CONFIGS: ModelConfig[] = [
  {
    label: 'gemini-2.5-flash(現行)',
    modelId: 'gemini-2.5-flash',
    thinkingConfig: { thinkingBudget: 0 },
    pricing: { inputPer1MTokens: 0.3, outputPer1MTokens: 2.5 },
  },
  {
    label: 'gemini-3.5-flash(移行予定)',
    modelId: 'gemini-3.5-flash',
    thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    pricing: { inputPer1MTokens: 1.5, outputPer1MTokens: 9.0 },
  },
];

// functions/src/ocr/ocrProcessor.ts の OCR プロンプトと同一 (比較条件を揃えるため)
const OCR_PROMPT = `
この画像/PDFの内容をOCRしてください。

【指示】
- テキストをそのまま正確に抽出してください
- 表がある場合は、構造を保ってテキスト化してください
- 手書き文字も可能な限り読み取ってください
- 読み取れない部分は[判読不能]と記載してください
- 余計な説明は不要です。抽出したテキストのみを出力してください
`;

interface PageGroundTruth {
  fixtureId: string;
  /** fixture内の1-basedページ番号 */
  pageNumber: number;
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
}

async function ocrPage(
  ai: InstanceType<typeof GoogleGenAI>,
  modelConfig: ModelConfig,
  pageBuffer: Buffer
): Promise<{ text: string; inputTokens: number; outputTokens: number; thinkingTokens: number }> {
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
              { text: OCR_PROMPT },
            ],
          },
        ],
        config: {
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          thinkingConfig: modelConfig.thinkingConfig,
        },
      }),
    RETRY_CONFIGS.gemini
  );

  const text = response.text || '';
  const usageMetadata = response.usageMetadata;
  return {
    text,
    inputTokens: usageMetadata?.promptTokenCount || 0,
    outputTokens: usageMetadata?.candidatesTokenCount || 0,
    thinkingTokens: usageMetadata?.thoughtsTokenCount || 0,
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
    const { text, inputTokens, outputTokens, thinkingTokens } = await ocrPage(ai, modelConfig, pageBuffer);

    const info = extractAllInformation(text, masters, {});
    const docTypeMatch = info.document.documentType === gt.docType;
    const customerMatch = info.customer.bestMatch?.name === gt.customer;
    const officeMatch = info.office.officeName === gt.office;

    outcomes.push({ groundTruth: gt, inputTokens, outputTokens, thinkingTokens, docTypeMatch, customerMatch, officeMatch });

    console.log(
      `  [${modelConfig.label}] ${gt.fixtureId} p${gt.pageNumber}: ` +
        `docType=${docTypeMatch ? '✅' : '❌'} customer=${customerMatch ? '✅' : '❌'} office=${officeMatch ? '✅' : '❌'} ` +
        `(in=${inputTokens}/out=${outputTokens}/thinking=${thinkingTokens})`
    );
  }

  return outcomes;
}

interface ModelSummary {
  label: string;
  total: number;
  docTypePass: number;
  customerPass: number;
  officePass: number;
  allPass: number;
  totalInput: number;
  totalOutput: number;
  totalThinking: number;
  costUsd: number;
}

function summarize(
  label: string,
  outcomes: PageOcrOutcome[],
  pricing: { inputPer1MTokens: number; outputPer1MTokens: number }
): ModelSummary {
  const total = outcomes.length;
  const docTypePass = outcomes.filter((o) => o.docTypeMatch).length;
  const customerPass = outcomes.filter((o) => o.customerMatch).length;
  const officePass = outcomes.filter((o) => o.officeMatch).length;
  const allPass = outcomes.filter((o) => o.docTypeMatch && o.customerMatch && o.officeMatch).length;

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
  console.log(`トークン: input=${totalInput} output=${totalOutput} thinking=${totalThinking}`);
  console.log(`概算コスト(本テストのみ): $${costUsd.toFixed(6)}`);

  return { label, total, docTypePass, customerPass, officePass, allPass, totalInput, totalOutput, totalThinking, costUsd };
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
    summaries.push(summarize(modelConfig.label, outcomes, modelConfig.pricing));
  }

  const [baseline, migrated] = summaries;
  console.log('\n=== 判定 (Issue #548 トリガー条件: 3.5の精度が2.5を下回らないこと) ===');
  const regressed = migrated.allPass < baseline.allPass;
  console.log(regressed ? '❌ FAIL: 3.5 Flashで精度劣化を検出' : '✅ PASS: 精度劣化なし');
  console.log(`コスト比 (このテストのみ、実運用スケールの参考値ではない): ${(migrated.costUsd / baseline.costUsd).toFixed(2)}倍`);
}

main().catch((err) => {
  console.error('❌ エラー:', err);
  process.exit(1);
});
