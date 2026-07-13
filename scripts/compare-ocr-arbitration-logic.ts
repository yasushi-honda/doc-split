#!/usr/bin/env ts-node
/**
 * 既存ロジック(全文抽出のみ) vs 候補抽出+arbitration統合後(GOAL.md OCR突合精度向上
 * ミッション タスクF)のロジックA/B比較スクリプト（dev環境、read-only）。
 *
 * scripts/compare-gemini-ocr-models.ts / compare-gemini-ocr-models-confirmed.ts は
 * 「モデルA/B比較(gemini-2.5-flash vs gemini-3.5-flash)」用で、Issue #548移行検証の
 * ために書かれたもの(モデルは固定し、抽出ロジックは常に同一)。本スクリプトは軸が異なり、
 * 「ロジックA/B比較」を行う: モデルは現行本番設定(GEMINI_CONFIG.modelId)に固定し、
 * (a) baseline = 既存の全文抽出のみ(extractDocumentTypeEnhanced等、タスクD以前の挙動)
 * (b) candidate = 候補抽出(extractOcrCandidates)+arbitration(arbitrateXxx)を統合した
 *     functions/src/ocr/ocrProcessor.ts processDocument()と全く同じ抽出呼出し形
 * の2ロジックを同一OCRテキストに対して実行し、documentType/customerName/officeName/date
 * の4項目全てで精度を比較する（GOAL.md 完了の定義: 4項目とも精度が現行を下回らないこと）。
 *
 * 対象フィクスチャ:
 *   - scripts/seed-dev-data.ts MIXED_FAX_PDFS(複数書類混在FAX、複数ページ)のうち、
 *     日単位まで含む日付ground truthを持つ3segment(「提供月」表記のみで日を含まない
 *     2segmentは日付gate評価不可のため対象外。書類種別/顧客/事業所のみの部分評価は
 *     複雑さ回避のため本ハーネスでは扱わない)
 *   - scripts/fixtures/arbitrationCompareFixtures.ts ARBITRATION_DISTRACTOR_DOCS
 *     (層化抽出の観点「複数人名」「複数日付」の文書内共起+distractorなしの通常ケース
 *     を追加する新規フィクスチャ7件。タスクG(GOAL.md、対象文書数拡大)でN=5→N=10へ拡大)
 *   計10文書。「手書き」原稿は合成PDFでは再現不可のため既知の限界としてGOAL.mdに記録済み。
 *
 * candidate側のみが追加で発生させるコスト(extractOcrCandidates呼出し分のトークン)を
 * 「トークン増分」として可視化するため、共通のページOCR呼出しコストとは分離して集計する
 * (baseline側のinputTokens等は常に0=追加呼出しなしの意)。
 *
 * read-only厳守: Firestore/Storageへの書込は一切行わない(ローカルfixture読込+Vertex AI呼出のみ)。
 *
 * 使用方法:
 *   推奨: GitHub Actions "Run Operations Script" → environment: dev /
 *         script: compare-ocr-arbitration-logic で実行(ADC不要)。
 *   ローカル実行(フォールバック):
 *     gcloud auth application-default login (doc-split-dev環境のアカウントで)
 *     GOOGLE_CLOUD_PROJECT=doc-split-dev npx ts-node scripts/compare-ocr-arbitration-logic.ts
 */

import * as admin from 'firebase-admin';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { GEMINI_CONFIG, GEMINI_PRICING, isThreePointFiveModel } from '../functions/src/utils/config';
import {
  extractDocumentTypeEnhanced,
  extractCustomerCandidates,
  extractOfficeCandidates,
  extractDateEnhanced,
  extractFilenameInfo,
  arbitrateDocumentType,
  arbitrateCustomerName,
  arbitrateOfficeName,
  arbitrateDate,
} from '../functions/src/utils/extractors';
import type { DocumentMaster, CustomerMaster, OfficeMaster } from '../shared/types';
import { MIXED_FAX_PDFS, readFixture, CUSTOMERS, OFFICES, DOC_TYPES, CARE_MANAGERS } from './seed-dev-data';
import { ARBITRATION_DISTRACTOR_DOCS, readArbitrationFixture } from './fixtures/arbitrationCompareFixtures';
import { extractAllPdfPages, ocrPageWithAnomalyDetection, type ModelConfig } from './lib/geminiOcrCompare';
import {
  computeLogicSummaryStats,
  computeLogicMatchRate,
  computeGroundingFailureRate,
  computeOverallLogicPass,
  pct,
  type LogicOutcomeForSummary,
  type LogicSummaryStats,
} from './lib/ocrLogicCompareStats';

/** scripts/compare-gemini-ocr-models.ts と同じ意図の誤課金防止ガード */
const ALLOWED_PROJECT_ID = 'doc-split-dev';
const LOCATION = 'asia-northeast1';

const PROJECT_ID =
  process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || '';

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

// functions/src/ocr/ocrProcessor.ts はモジュールスコープで admin.firestore()/admin.storage() を
// 呼ぶため、admin.initializeApp() より前に静的importすると FirebaseAppError(no-app) になる
// (scripts/verify-candidate-extraction-document-level.ts と同じ制約)。initializeApp後に動的importする。
admin.initializeApp({ projectId: PROJECT_ID });

/**
 * 現行本番設定と同一のモデル/thinkingConfigを使う単一ModelConfig(モデルは固定し
 * ロジックのみを比較するため、ModelConfig.role/pricingは本スクリプトの集計処理では
 * 参照しない。ocrPageWithAnomalyDetection呼出しに必要な形を満たすためだけに用意する)。
 */
const PRODUCTION_MODEL_CONFIG: ModelConfig = {
  role: 'baseline',
  label: `${GEMINI_CONFIG.modelId}(本番相当)`,
  modelId: GEMINI_CONFIG.modelId,
  thinkingConfig: isThreePointFiveModel(GEMINI_CONFIG.modelId)
    ? { thinkingLevel: ThinkingLevel.LOW }
    : { thinkingBudget: GEMINI_CONFIG.ocrThinkingBudget },
  pricing: GEMINI_PRICING,
};

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

interface DocUnit {
  docId: string;
  readPdf: () => Buffer;
  /** undefined = PDF全ページを対象とする(distractorフィクスチャ用) */
  pageIndices?: number[];
  fileName: string;
  docType: string;
  customer: string;
  office: string;
  /** YYYY/MM/DD形式。本ハーネスの対象文書は全てgate評価可能な日付を持つ(GOAL.md参照) */
  expectedDate: string;
}

/**
 * MIXED_FAX_PDFSのdateLabel自由記述からのground truth(手動転記、パースロジックの
 * バグリスクを避けるため意図的にパースしない)。「提供月」表記(日を含まない)のsegmentは
 * nullとし、buildDocUnits()で除外する。
 */
const MIXED_SEGMENT_EXPECTED_DATE: Record<string, Array<string | null>> = {
  'seed-doc-pending-mixed-01': ['2026/06/01', null, '2026/06/10'],
  'seed-doc-pending-mixed-02': ['2026/06/15', null],
};

function buildDocUnits(): DocUnit[] {
  const segmentUnits: DocUnit[] = [];
  for (const mixed of MIXED_FAX_PDFS) {
    const expectedDates = MIXED_SEGMENT_EXPECTED_DATE[mixed.id];
    if (!expectedDates || expectedDates.length !== mixed.segments.length) {
      throw new Error(`MIXED_SEGMENT_EXPECTED_DATE が ${mixed.id} のsegment数と一致しません`);
    }
    let cursor = 0;
    mixed.segments.forEach((seg, idx) => {
      const pageIndices = Array.from({ length: seg.pages }, (_, i) => cursor + i);
      cursor += seg.pages;
      const expectedDate = expectedDates[idx];
      if (expectedDate === null) return; // 日を含まない表記は対象外(上部doc comment参照)
      segmentUnits.push({
        docId: `${mixed.id}:seg${idx}`,
        readPdf: () => readFixture(mixed.fixture),
        pageIndices,
        fileName: mixed.fileName,
        docType: seg.docType,
        customer: seg.customer,
        office: seg.office,
        expectedDate,
      });
    });
  }

  const distractorUnits: DocUnit[] = ARBITRATION_DISTRACTOR_DOCS.map((d) => ({
    docId: d.id,
    readPdf: () => readArbitrationFixture(d.fixture),
    fileName: d.fileName,
    docType: d.docType,
    customer: d.customer,
    office: d.office,
    expectedDate: d.expectedDate,
  }));

  return [...segmentUnits, ...distractorUnits];
}

interface DocPairOutcome {
  baseline: LogicOutcomeForSummary;
  candidate: LogicOutcomeForSummary;
  /** 共通のページOCR呼出し(baseline/candidate両ロジックが同じOCRテキストを参照するため1回のみ) */
  sharedOcr: { inputTokens: number; outputTokens: number; thinkingTokens: number };
}

/**
 * 1文書を処理する。ページOCRはbaseline/candidate間で共有する(両ロジックとも同一の
 * OCR結果テキストに対して抽出/arbitrationを行うだけで、OCR呼出し自体はロジック差の
 * 対象外のため)。extractOcrCandidatesは呼出元(main)がadmin.initializeApp()後に
 * 動的importしたものを受け取る。
 */
async function processDocUnit(
  unit: DocUnit,
  ai: InstanceType<typeof GoogleGenAI>,
  extractOcrCandidatesFn: typeof import('../functions/src/ocr/ocrProcessor').extractOcrCandidates,
  masters: { documents: DocumentMaster[]; customers: CustomerMaster[]; offices: OfficeMaster[] }
): Promise<DocPairOutcome | null> {
  const pdfBuffer = unit.readPdf();
  const allPageBuffers = await extractAllPdfPages(pdfBuffer);
  const pageIndices = unit.pageIndices ?? allPageBuffers.map((_, i) => i);
  const selectedBuffers = pageIndices.map((i) => allPageBuffers[i]);

  const pageRawTexts: string[] = [];
  const pageJoinTexts: string[] = [];
  let ocrInput = 0;
  let ocrOutput = 0;
  let ocrThinking = 0;
  for (let i = 0; i < selectedBuffers.length; i++) {
    const r = await ocrPageWithAnomalyDetection(ai, PRODUCTION_MODEL_CONFIG, selectedBuffers[i], i + 1);
    if (r.anomalous) {
      console.warn(`  ⚠️ ${unit.docId}: p${i + 1}で異常応答検出、この文書はスキップ`);
      return null;
    }
    pageRawTexts.push(r.text);
    pageJoinTexts.push(`--- Page ${i + 1} ---\n${r.text}`);
    ocrInput += r.inputTokens;
    ocrOutput += r.outputTokens;
    ocrThinking += r.thinkingTokens;
  }

  // functions/src/ocr/ocrProcessor.ts processDocument() と同じ結合フォーマット
  const ocrResult = pageJoinTexts.join('\n\n');
  const firstPageText = pageRawTexts.length > 0 ? pageRawTexts[0] : undefined;
  const filenameInfo = extractFilenameInfo(unit.fileName);

  // baseline: 既存の全文抽出のみ(タスクD以前の挙動)
  const baselineDocType = extractDocumentTypeEnhanced(ocrResult, masters.documents);
  const baselineCustomer = extractCustomerCandidates(ocrResult, masters.customers);
  const baselineOffice = extractOfficeCandidates(ocrResult, masters.offices, { filenameInfo });
  const baselineMatchedDoc = masters.documents.find((d) => d.name === baselineDocType.documentType);
  const baselineDateResult = extractDateEnhanced(ocrResult, baselineMatchedDoc?.dateMarker, firstPageText);

  // candidate: 候補抽出+arbitration統合後(functions/src/ocr/ocrProcessor.ts processDocument()
  // タスクD実装と全く同じ呼出形。baselineの抽出結果をそのままarbitrate*の第1引数に渡す)
  const candidates = await extractOcrCandidatesFn(ocrResult);
  const candDocType = arbitrateDocumentType(baselineDocType, candidates.documentTypeCandidate, masters.documents, ocrResult);
  const candCustomer = arbitrateCustomerName(baselineCustomer, candidates.customerNameCandidate, masters.customers, ocrResult);
  const candOffice = arbitrateOfficeName(baselineOffice, candidates.officeNameCandidate, masters.offices, ocrResult, {
    filenameInfo,
  });
  const candMatchedDoc = masters.documents.find((d) => d.name === candDocType.documentType);
  const candDateBase = extractDateEnhanced(ocrResult, candMatchedDoc?.dateMarker, firstPageText);
  const candDateResult = arbitrateDate(candDateBase, candidates.dateCandidate, ocrResult);

  const candidateValues = [
    candidates.documentTypeCandidate,
    candidates.customerNameCandidate,
    candidates.officeNameCandidate,
    candidates.dateCandidate,
  ];
  const groundedFlags = [
    candDocType.provenance.candidateGrounded,
    candCustomer.provenance.candidateGrounded,
    candOffice.provenance.candidateGrounded,
    candDateResult.provenance.candidateGrounded,
  ];
  let nonNullCandidateCount = 0;
  let groundedCandidateCount = 0;
  candidateValues.forEach((v, i) => {
    if (v !== null) {
      nonNullCandidateCount++;
      if (groundedFlags[i]) groundedCandidateCount++;
    }
  });

  const baseline: LogicOutcomeForSummary = {
    success: true,
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    docTypeMatch: baselineDocType.documentType === unit.docType,
    customerMatch: baselineCustomer.bestMatch?.name === unit.customer,
    officeMatch: baselineOffice.bestMatch?.name === unit.office,
    dateMatch: baselineDateResult.formattedDate === unit.expectedDate,
    groundedCandidateCount: 0,
    nonNullCandidateCount: 0,
  };
  const candidate: LogicOutcomeForSummary = {
    success: true,
    inputTokens: candidates.inputTokens,
    outputTokens: candidates.outputTokens,
    thinkingTokens: candidates.thinkingTokens,
    docTypeMatch: candDocType.documentType === unit.docType,
    customerMatch: candCustomer.bestMatch?.name === unit.customer,
    officeMatch: candOffice.bestMatch?.name === unit.office,
    dateMatch: candDateResult.formattedDate === unit.expectedDate,
    groundedCandidateCount,
    nonNullCandidateCount,
  };

  console.log(
    `  [${unit.docId}] baseline: docType=${baseline.docTypeMatch ? '✅' : '❌'} customer=${baseline.customerMatch ? '✅' : '❌'} ` +
      `office=${baseline.officeMatch ? '✅' : '❌'} date=${baseline.dateMatch ? '✅' : '❌'} / ` +
      `candidate: docType=${candidate.docTypeMatch ? '✅' : '❌'} customer=${candidate.customerMatch ? '✅' : '❌'} ` +
      `office=${candidate.officeMatch ? '✅' : '❌'} date=${candidate.dateMatch ? '✅' : '❌'}`
  );

  return {
    baseline,
    candidate,
    sharedOcr: { inputTokens: ocrInput, outputTokens: ocrOutput, thinkingTokens: ocrThinking },
  };
}

function summarize(label: string, stats: LogicSummaryStats): void {
  console.log(`\n=== ${label} ===`);
  console.log(
    `対象文書数: ${stats.totalDocs} (成功 ${stats.succeededDocs} / 失敗 ${stats.failedDocs}、失敗率 ${pct(stats.failedDocs, stats.totalDocs)}%)`
  );
  console.log(`書類種別 一致率: ${stats.docTypePass}/${stats.succeededDocs} (${pct(stats.docTypePass, stats.succeededDocs)}%)`);
  console.log(`顧客     一致率: ${stats.customerPass}/${stats.succeededDocs} (${pct(stats.customerPass, stats.succeededDocs)}%)`);
  console.log(`事業所   一致率: ${stats.officePass}/${stats.succeededDocs} (${pct(stats.officePass, stats.succeededDocs)}%)`);
  console.log(`日付     一致率: ${stats.datePass}/${stats.succeededDocs} (${pct(stats.datePass, stats.succeededDocs)}%)`);
  console.log(`4項目全一致     : ${stats.allFourPass}/${stats.succeededDocs} (${pct(stats.allFourPass, stats.succeededDocs)}%)`);
  console.log(
    `候補抽出grounding失敗率: ${(computeGroundingFailureRate(stats) * 100).toFixed(1)}% ` +
      `(非null候補${stats.nonNullCandidateCount}件中${stats.nonNullCandidateCount - stats.groundedCandidateCount}件not-grounded)`
  );
  console.log(`候補抽出トークン増分: input=${stats.totalInput} output=${stats.totalOutput} thinking=${stats.totalThinking}`);
  console.log(`候補抽出概算コスト増分: $${stats.costUsd.toFixed(6)}`);
}

async function main(): Promise<void> {
  console.log('=== OCR突合ロジックA/B比較 (GOAL.md OCR突合精度向上ミッション タスクF) ===');
  console.log(`プロジェクト: ${PROJECT_ID} / リージョン: ${LOCATION} / モデル: ${PRODUCTION_MODEL_CONFIG.modelId}`);
  console.log('baseline=既存全文抽出のみ / candidate=候補抽出+arbitration統合後(タスクD実装)');

  // functions/src/ocr/ocrProcessor.ts はモジュールスコープでadmin.firestore()を呼ぶため、
  // admin.initializeApp()後の動的importが必須(scripts/verify-candidate-extraction-document-level.ts
  // と同じ制約、上部import文の直後コメント参照)。
  const { extractOcrCandidates } = await import('../functions/src/ocr/ocrProcessor');

  const masters = buildMasters();
  const units = buildDocUnits();
  console.log(`対象文書数: ${units.length} (${units.map((u) => u.docId).join(', ')})`);

  const ai = new GoogleGenAI({ vertexai: true, project: PROJECT_ID, location: LOCATION });

  const pairResults: DocPairOutcome[] = [];
  let skippedAnomalousCount = 0;
  for (const unit of units) {
    const result = await processDocUnit(unit, ai, extractOcrCandidates, masters);
    if (result === null) {
      skippedAnomalousCount++;
      continue;
    }
    pairResults.push(result);
  }

  if (pairResults.length === 0) {
    console.error('❌ 処理できた文書が1件もありませんでした(全件が異常応答でスキップ)');
    process.exit(1);
  }
  if (skippedAnomalousCount > 0) {
    console.log(`\n⚠️ ${skippedAnomalousCount}/${units.length} 文書が異常応答のためスキップされました`);
  }

  const sharedOcrTotal = pairResults.reduce(
    (s, r) => ({
      inputTokens: s.inputTokens + r.sharedOcr.inputTokens,
      outputTokens: s.outputTokens + r.sharedOcr.outputTokens,
      thinkingTokens: s.thinkingTokens + r.sharedOcr.thinkingTokens,
    }),
    { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 }
  );
  console.log(
    `\n共通ページOCR呼出し(baseline/candidate共通、参考値): ` +
      `input=${sharedOcrTotal.inputTokens} output=${sharedOcrTotal.outputTokens} thinking=${sharedOcrTotal.thinkingTokens}`
  );

  const baselineStats = computeLogicSummaryStats(
    PRODUCTION_MODEL_CONFIG.pricing,
    pairResults.map((r) => r.baseline)
  );
  const candidateStats = computeLogicSummaryStats(
    PRODUCTION_MODEL_CONFIG.pricing,
    pairResults.map((r) => r.candidate)
  );

  summarize('baseline (既存全文抽出のみ)', baselineStats);
  summarize('candidate (候補抽出+arbitration統合後)', candidateStats);

  const baselineRate = computeLogicMatchRate(baselineStats);
  const candidateRate = computeLogicMatchRate(candidateStats);
  const regressed = candidateRate < baselineRate;
  const baselineFailureRateExceeded = baselineStats.failedDocs > baselineStats.totalDocs * 0.1;
  const candidateFailureRateExceeded = candidateStats.failedDocs > candidateStats.totalDocs * 0.1;
  const overallPass = computeOverallLogicPass({ regressed, baselineFailureRateExceeded, candidateFailureRateExceeded });

  console.log('\n=== 判定 (GOAL.md 完了の定義: 4項目とも精度が現行を下回らないこと) ===');
  console.log(
    `4項目全一致率: baseline=${(baselineRate * 100).toFixed(1)}% candidate=${(candidateRate * 100).toFixed(1)}%`
  );
  console.log(
    `候補抽出grounding失敗率: ${(computeGroundingFailureRate(candidateStats) * 100).toFixed(1)}%`
  );
  console.log(
    overallPass
      ? '✅ PASS: 精度劣化なし、失敗率ゲートも許容範囲内'
      : '❌ FAIL: 精度劣化または失敗率ゲート超過を検出(詳細は上記ログ参照)'
  );
  console.log(
    `注意: 対象文書数はN=${pairResults.length}と少数のため、本判定はdev環境での一次スクリーニングに留まる ` +
      '(タスクG本実行、タスクH kanameone confirmed-replay検証で追加検証する)'
  );

  if (!overallPass) {
    process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error('❌ エラー:', err);
    process.exit(1);
  });
