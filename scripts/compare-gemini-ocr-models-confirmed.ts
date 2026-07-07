#!/usr/bin/env ts-node
/**
 * Gemini 2.5 Flash vs 3.5 Flash OCR精度+コスト比較スクリプト（confirmed replay方式、read-only、Issue #548）
 *
 * scripts/compare-gemini-ocr-models.ts（dev環境の合成フィクスチャ、正解ラベル付き2ファイル・
 * 11ページ）はCodexセカンドオピニオンで「n=11は実運用判断の統計的根拠として不十分」と指摘された
 * (rule of threeで劣化率上限27%までしか保証しない)。
 *
 * 本スクリプトは、kanameone/cocoro本番環境に存在する「確定済み文書」
 * (customerConfirmed && officeConfirmed && documentTypeConfirmed が true、
 * functions/src/ocr/confirmedFieldMerge.ts参照)を活用する。これらは既に人間検証済み
 * (またはOCR高確信度自己判定済み)のcustomerName/officeName/documentTypeをFirestore上に
 * 持っているため、新規ラベリングコストなしで大規模・実データでの精度検証ができる。
 *
 * **ground truthの限定(Codex review指摘反映)**: customerConfirmed/officeConfirmedはOCR自身の
 * 高確信度自己判定でもtrueになりうる(confirmedFieldMerge.ts参照)。現行gemini-2.5-flash由来の
 * 自己判定値をground truthに使うと、baseline(2.5)に有利なラベルリークになる。そのため
 * customer/officeは`confirmedBy`/`officeConfirmedBy`が非nullの、真に人間が確定した文書のみを
 * 対象とする(documentTypeConfirmedはユーザー選択専用で自己判定シグナルを持たないため対象外の
 * フィルタ不要)。
 *
 * サンプリングした文書の元PDFを2.5-flash/3.5-flash両方で再OCRし、
 * functions/src/utils/extractors.ts の抽出関数で書類種別/顧客/事業所を抽出、
 * 確定値と突合する（ocrProcessor.ts の processDocument() と同じ「全ページ結合テキストに対して
 * 抽出を1回実行」という文書単位の評価方式を踏襲。confirmed文書は既に分割済みの単一文書であり、
 * compare-gemini-ocr-models.ts のようなページ単位の複数文書混在フィクスチャではないため）。
 *
 * read-only厳守: Firestore/Storageへの書込は一切行わない。マスターデータ読込は
 * functions/src/utils/loadMasterData.ts を再利用せず、本スクリプト内に最小限の読込専用実装を
 * 持つ（loadMasterDataはsanitize drop発生時にNODE_ENV=production等でFirestoreへの
 * safeLogError書込を試みる分岐を持つため、read-only保証を書込非依存で担保するために意図的に
 * 独立実装とする）。
 *
 * 個人情報保護: 個別文書の突合結果(氏名・事業所名等)はログ/artifactいずれにも出力しない。
 * 出力するのは集計値のみ(一致率・トークン数・コスト・p50/p95/p99レイテンシ・リトライ率・失敗率)。
 * 不一致が発生した場合も「件数」のみを記録し、doc IDや期待値/実際値は出力しない。深掘り調査が
 * 必要な場合はdecision-makerがkanameone環境に直接アクセスして個別確認する運用とする。
 * **Codex review指摘反映**: functions/src/utils/retry.ts の withRetry/withRetryResult は
 * リトライ時に `lastError.message` をそのままconsole.logするため、Storageパス(元アップロード
 * ファイル名を含みうる、sanitizeFilenameForStorage()は日本語等を除去しない)が漏洩する経路が
 * あった。本スクリプトでは共通retryを使わず、エラーメッセージを一切ログ出力しない
 * withSilentRetry() を独自実装する。
 *
 * 使用方法:
 *   推奨: GitHub Actions "Run Operations Script" → environment: kanameone /
 *         script: compare-gemini-ocr-models-confirmed --limit 30 (pilot)
 *         script: compare-gemini-ocr-models-confirmed --limit 300 (本実行)
 *   ローカル実行（フォールバック）:
 *     gcloud auth application-default login (kanameone環境の管理者アカウントで)
 *     GOOGLE_CLOUD_PROJECT=docsplit-kanameone STORAGE_BUCKET=docsplit-kanameone.firebasestorage.app \
 *       npx ts-node scripts/compare-gemini-ocr-models-confirmed.ts --limit 30
 */

import { GoogleGenAI } from '@google/genai';
import * as admin from 'firebase-admin';
import { isTransientError, RETRY_CONFIGS, type RetryConfig } from '../functions/src/utils/retry';
import { GEMINI_CONFIG } from '../functions/src/utils/config';
import {
  extractDocumentTypeEnhanced,
  extractCustomerCandidates,
  extractOfficeCandidates,
  extractFilenameInfo,
  type DocumentMaster,
  type CustomerMaster,
  type OfficeMaster,
} from '../functions/src/utils/extractors';
import {
  sanitizeCustomerMasters,
  sanitizeDocumentMasters,
  sanitizeOfficeMasters,
} from '../functions/src/utils/sanitizeMasterData';
import { MASTER_PATHS } from '../functions/src/utils/masterPaths';
import {
  BASELINE_MODEL_CONFIG,
  CANDIDATE_MODEL_CONFIG,
  buildOcrPrompt,
  extractAllPdfPages,
  type ModelConfig,
  type ModelRole,
} from './lib/geminiOcrCompare';

/**
 * confirmed文書が実運用規模で存在する本番クライアント環境のみ許可する
 * (compare-gemini-ocr-models.ts の ALLOWED_PROJECT_ID ガードの逆パターン: dev環境の
 * seedフィクスチャにはconfirmed文書が十分な規模で存在しないため dev は明示的に拒否する)。
 */
const ALLOWED_PROJECT_IDS = ['docsplit-kanameone', 'docsplit-cocoro'];
const LOCATION = 'asia-northeast1';
/** Vertex AIレート制限を踏まえた保守的な同時実行数 */
const CONCURRENCY = 5;
const DEFAULT_LIMIT = 30;
/**
 * confirmedBy/officeConfirmedBy による人間確定フィルタで一部が弾かれる前提で、
 * Firestoreクエリ自体は目標件数の3倍を上限にサンプリングする(Codex review指摘反映)。
 * 大きすぎる無制限headroomによるread coストを避けるため上限をキャップする。
 */
const SAMPLE_HEADROOM_MULTIPLIER = 3;
const SAMPLE_HEADROOM_CAP = 2000;

const PROJECT_ID =
  process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || '';
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || '';

if (!PROJECT_ID) {
  console.error('GOOGLE_CLOUD_PROJECT (または FIREBASE_PROJECT_ID) を設定してください');
  process.exit(1);
}

if (!ALLOWED_PROJECT_IDS.includes(PROJECT_ID)) {
  console.error(
    `❌ このスクリプトは ${ALLOWED_PROJECT_IDS.join('/')} 専用です (指定されたプロジェクト: ${PROJECT_ID})。` +
      '確定済み文書(customerConfirmed/officeConfirmed/documentTypeConfirmed)を実運用規模で持つ' +
      '本番クライアント環境でのみ意味を成す検証のため、他環境では実行できません。'
  );
  process.exit(1);
}

if (!STORAGE_BUCKET) {
  // CLAUDE.md「Storageバケット名」: projectIdからの推測は禁止(.appspot.com/.firebasestorage.app混在)。
  // scripts/clients/<env>.env の STORAGE_BUCKET を明示的に渡す必要がある(Codex review指摘反映、
  // import-historical-gmail.js等の既存スクリプトと同じパターン)。
  console.error('STORAGE_BUCKET 環境変数が必要です (例: docsplit-kanameone.firebasestorage.app)');
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID, storageBucket: STORAGE_BUCKET });
}
const db = admin.firestore();
const storage = admin.storage();

/**
 * エラーの種別のみを個人情報漏洩なくログ出力するためのヘルパー。
 *
 * GCS/Firestore SDKのエラーメッセージは対象オブジェクトのパス(例: "No such object:
 * bucket/original/xxxx_田中太郎様_請求書.pdf")を含むことがある。fileUrl/storagePathは
 * functions/src/utils/fileNaming.ts の sanitizeFilenameForStorage() が元のアップロード/
 * 添付ファイル名から禁止文字を置換するのみで日本語文字等はそのまま残すため、氏名を含む
 * 元ファイル名がストレージパスに埋め込まれている可能性がある。エラーメッセージを生のまま
 * ログ出力しないよう、種別・コードのみを抽出する。
 */
function describeErrorSafely(err: unknown): string {
  if (err instanceof Error) {
    const withCode = err as Error & { code?: string | number; status?: number };
    const code = withCode.code ?? withCode.status;
    return code !== undefined ? `${err.constructor.name}(code=${code})` : err.constructor.name;
  }
  return typeof err;
}

type SilentRetryResult<T> = { success: true; data: T; attempts: number } | { success: false; error: Error; attempts: number };

/**
 * functions/src/utils/retry.ts の withRetry/withRetryResult と同じ exponential backoff だが、
 * リトライ中に `lastError.message` を一切ログ出力しない(Codex review指摘反映、PII漏洩対策)。
 * isTransientError() は純粋関数のため安全に再利用する。
 */
async function withSilentRetry<T>(fn: () => Promise<T>, config: RetryConfig): Promise<SilentRetryResult<T>> {
  let delay = config.initialDelayMs;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= config.maxRetries + 1; attempt++) {
    try {
      const data = await fn();
      return { success: true, data, attempts: attempt };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt > config.maxRetries || !isTransientError(error)) {
        return { success: false, error: lastError, attempts: attempt };
      }
      // 個人情報保護のためエラー内容はログに出さない(件数・待機時間のみ)
      console.log(`[withSilentRetry] attempt ${attempt}/${config.maxRetries + 1} failed, retrying in ${delay}ms`);
      await new Promise((resolve) => setTimeout(resolve, Math.min(delay, config.maxDelayMs)));
      delay *= config.backoffMultiplier;
    }
  }
  return { success: false, error: lastError ?? new Error('Retry failed'), attempts: config.maxRetries + 1 };
}

function getLimitArg(): number {
  const idx = process.argv.indexOf('--limit');
  if (idx === -1) return DEFAULT_LIMIT;
  const value = Number(process.argv[idx + 1]);
  if (!Number.isFinite(value) || value <= 0) {
    console.error('--limit には正の整数を指定してください');
    process.exit(1);
  }
  return Math.floor(value);
}

/**
 * マスターデータ読込 (read-only、functions/src/utils/loadMasterData.ts の書込分岐を避けるため独立実装)。
 * sanitize*Masters は純粋関数のため安全に再利用する。drop発生時は console.warn のみ(Firestore書込なし)。
 */
async function loadMastersReadOnly(): Promise<{
  documents: DocumentMaster[];
  customers: CustomerMaster[];
  offices: OfficeMaster[];
}> {
  const [documentSnap, customerSnap, officeSnap] = await Promise.all([
    db.collection(MASTER_PATHS.documents).get(),
    db.collection(MASTER_PATHS.customers).get(),
    db.collection(MASTER_PATHS.offices).get(),
  ]);

  const documentRaw: DocumentMaster[] = documentSnap.docs.map((d) => ({
    id: d.id,
    name: d.data().name as string,
    category: d.data().category as string | undefined,
    keywords: d.data().keywords as string[] | undefined,
    aliases: d.data().aliases as string[] | undefined,
    dateMarker: d.data().dateMarker as string | undefined,
  }));
  const customerRaw: CustomerMaster[] = customerSnap.docs.map((d) => ({
    id: d.id,
    name: d.data().name as string,
    furigana: d.data().furigana as string | undefined,
    isDuplicate: d.data().isDuplicate as boolean | undefined,
    careManagerName: d.data().careManagerName as string | undefined,
    aliases: d.data().aliases as string[] | undefined,
  }));
  const officeRaw: OfficeMaster[] = officeSnap.docs.map((d) => ({
    id: d.id,
    name: d.data().name as string,
    shortName: d.data().shortName as string | undefined,
    isDuplicate: d.data().isDuplicate as boolean | undefined,
    aliases: d.data().aliases as string[] | undefined,
  }));

  const documentResult = sanitizeDocumentMasters(documentRaw);
  const customerResult = sanitizeCustomerMasters(customerRaw);
  const officeResult = sanitizeOfficeMasters(officeRaw);

  const droppedTotal =
    documentResult.droppedIds.length + customerResult.droppedIds.length + officeResult.droppedIds.length;
  if (droppedTotal > 0) {
    console.warn(
      `[loadMastersReadOnly] sanitize drop: documents=${documentResult.droppedIds.length} ` +
        `customers=${customerResult.droppedIds.length} offices=${officeResult.droppedIds.length} ` +
        '(read-only測定スクリプトのためFirestoreへのログ書込は行わない)'
    );
  }

  return { documents: documentResult.items, customers: customerResult.items, offices: officeResult.items };
}

interface SampledDoc {
  id: string;
  fileName: string;
  fileUrl: string;
  totalPages: number;
  confirmedDocumentType: string;
  confirmedCustomerName: string;
  confirmedOfficeName: string;
}

/**
 * 確定済み文書をサンプリングする。orderBy('__name__') は measure-field-byte-sizes.js と同じ
 * 前例パターン: documents の doc ID は db.collection('documents').doc() による Firestore
 * auto-ID (ランダム文字列、functions/src/upload/uploadPdf.ts:203 等で確認済み) のため、
 * ID順ソート+limitは真の乱数生成器なしで妥当な疑似ランダムサンプルになる。
 *
 * customerConfirmedBy/officeConfirmedByが非nullの(真に人間が確定した)文書のみを対象とする
 * (Codex review指摘反映、上部doc comment参照)。documentTypeConfirmedはユーザー選択専用の
 * ため追加フィルタ不要(confirmedFieldMerge.ts参照)。
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** totalPagesが正の整数でない(欠損/0/負数/非数値)場合は1にフォールバックする */
function toValidTotalPages(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 1;
}

async function sampleConfirmedDocuments(limit: number): Promise<SampledDoc[]> {
  const queryLimit = Math.min(limit * SAMPLE_HEADROOM_MULTIPLIER, SAMPLE_HEADROOM_CAP);
  const snap = await db
    .collection('documents')
    .where('status', '==', 'processed')
    .where('customerConfirmed', '==', true)
    .where('officeConfirmed', '==', true)
    .where('documentTypeConfirmed', '==', true)
    .orderBy('__name__')
    .limit(queryLimit)
    .get();

  const humanConfirmedOnly = snap.docs.filter((d) => {
    const data = d.data();
    return data.confirmedBy != null && data.officeConfirmedBy != null;
  });

  // ground truth 3フィールドが有効な非空文字列でない文書は突合不能なため除外する
  // (confirmedフラグがtrueでもデータドリフトで欠損しているケースを想定した防御)
  const withValidGroundTruth: SampledDoc[] = [];
  let skippedInvalidGroundTruth = 0;
  for (const d of humanConfirmedOnly) {
    const data = d.data();
    if (
      !isNonEmptyString(data.fileName) ||
      !isNonEmptyString(data.fileUrl) ||
      !isNonEmptyString(data.documentType) ||
      !isNonEmptyString(data.customerName) ||
      !isNonEmptyString(data.officeName)
    ) {
      skippedInvalidGroundTruth++;
      continue;
    }
    withValidGroundTruth.push({
      id: d.id,
      fileName: data.fileName,
      fileUrl: data.fileUrl,
      totalPages: toValidTotalPages(data.totalPages),
      confirmedDocumentType: data.documentType,
      confirmedCustomerName: data.customerName,
      confirmedOfficeName: data.officeName,
    });
    if (withValidGroundTruth.length >= limit) break;
  }
  if (skippedInvalidGroundTruth > 0) {
    console.warn(`[sampleConfirmedDocuments] ground truthフィールド欠損のため${skippedInvalidGroundTruth}件を除外`);
  }

  return withValidGroundTruth;
}

/** read-only: file.download() のみ、書込・削除は行わない */
async function downloadOriginalPdf(fileUrl: string): Promise<Buffer> {
  const bucket = storage.bucket();
  const filePath = fileUrl.replace(`gs://${bucket.name}/`, '');
  const file = bucket.file(filePath);
  const result = await withSilentRetry(() => file.download(), RETRY_CONFIGS.storage);
  if (!result.success) {
    throw result.error;
  }
  return result.data[0];
}

/** 同時実行数を制限しつつ全アイテムを処理する (外部ライブラリ非依存の軽量実装) */
async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function runner(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runner()));
  return results;
}

interface PageOcrCallResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  anomalous: boolean;
  retried: boolean;
}

/**
 * API呼出が最終的に失敗した場合(リトライ上限到達)は throw する。呼出元
 * processDocumentWithModel() の try/catch が文書単位の失敗として集計するため、
 * ここで「空文字+anomalous」のような偽の成功値を返してはならない
 * (Codex review指摘反映: 以前は success:true のまま集計され、10%失敗gateが機能せず
 * 両モデルが同程度に異常終了した場合に「精度劣化なし」と誤判定されるリスクがあった)。
 * anomalous は「APIは成功したが空応答/safetyブロック等の疑いがある」ケース専用に残す。
 */
async function ocrPage(
  ai: InstanceType<typeof GoogleGenAI>,
  modelConfig: ModelConfig,
  pageBuffer: Buffer,
  pageNumber: number
): Promise<PageOcrCallResult> {
  const base64Data = pageBuffer.toString('base64');

  const result = await withSilentRetry(
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

  if (!result.success) {
    throw result.error;
  }

  const response = result.data;
  const text = response.text || '';
  const usageMetadata = response.usageMetadata;

  // compare-gemini-ocr-models.ts と同じ判定: 空応答は safetyブロック等のAPI異常の可能性がある
  let anomalous = false;
  if (!response.text) {
    const candidate = response.candidates?.[0];
    const finishReason = candidate?.finishReason;
    const blockReason = response.promptFeedback?.blockReason;
    if (blockReason || (finishReason && finishReason !== 'STOP')) {
      anomalous = true;
    }
  }

  return {
    text,
    inputTokens: usageMetadata?.promptTokenCount || 0,
    outputTokens: usageMetadata?.candidatesTokenCount || 0,
    thinkingTokens: usageMetadata?.thoughtsTokenCount || 0,
    anomalous,
    retried: result.attempts > 1,
  };
}

interface DocOcrOutcome {
  success: boolean;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  elapsedMs: number;
  docTypeMatch: boolean;
  customerMatch: boolean;
  officeMatch: boolean;
  anomalousPages: number;
  hadRetry: boolean;
}

/**
 * 1文書を指定モデルで再OCRし、確定値と突合する。個人情報(氏名等)を含む中間結果は
 * この関数の戻り値にも含めない(bool一致フラグのみ)。ページOCRが最終的に失敗した場合は
 * ocrPage()がthrowし、ここでcatchして文書単位の失敗(success:false)として扱う。
 *
 * pageBuffersは呼出元(processOneDocument)が1文書につき1回だけ抽出したものを渡す
 * (code-review指摘反映: 以前はモデルごとにPDF全体を再パースしており、2モデル分で
 * 冗長なCPU消費が発生していた)。
 */
async function processDocumentWithModel(
  ai: InstanceType<typeof GoogleGenAI>,
  modelConfig: ModelConfig,
  sampled: SampledDoc,
  pageBuffers: Buffer[],
  masters: { documents: DocumentMaster[]; customers: CustomerMaster[]; offices: OfficeMaster[] }
): Promise<DocOcrOutcome> {
  const start = Date.now();
  const pageTexts: string[] = [];
  let totalInput = 0;
  let totalOutput = 0;
  let totalThinking = 0;
  let anomalousPages = 0;
  let hadRetry = false;

  try {
    for (let i = 0; i < pageBuffers.length; i++) {
      const outcome = await ocrPage(ai, modelConfig, pageBuffers[i], i + 1);
      pageTexts.push(outcome.text);
      totalInput += outcome.inputTokens;
      totalOutput += outcome.outputTokens;
      totalThinking += outcome.thinkingTokens;
      if (outcome.anomalous) anomalousPages++;
      if (outcome.retried) hadRetry = true;
    }

    const combinedText = pageTexts.map((t, idx) => `--- Page ${idx + 1} ---\n${t}`).join('\n\n');
    const filenameInfo = extractFilenameInfo(sampled.fileName);
    const documentTypeResult = extractDocumentTypeEnhanced(combinedText, masters.documents);
    const customerResult = extractCustomerCandidates(combinedText, masters.customers);
    const officeResult = extractOfficeCandidates(combinedText, masters.offices, { filenameInfo });

    return {
      success: true,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      thinkingTokens: totalThinking,
      elapsedMs: Date.now() - start,
      docTypeMatch: documentTypeResult.documentType === sampled.confirmedDocumentType,
      customerMatch: customerResult.bestMatch?.name === sampled.confirmedCustomerName,
      officeMatch: officeResult.bestMatch?.name === sampled.confirmedOfficeName,
      anomalousPages,
      hadRetry,
    };
  } catch (err) {
    // 1文書の失敗で全体を止めない。失敗件数として集計する(doc ID等はログに出さない)。
    console.warn(`[processDocumentWithModel] 1文書の処理に失敗 (${modelConfig.label}): ${describeErrorSafely(err)}`);
    return {
      success: false,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      thinkingTokens: totalThinking,
      elapsedMs: Date.now() - start,
      docTypeMatch: false,
      customerMatch: false,
      officeMatch: false,
      anomalousPages,
      hadRetry,
    };
  }
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(sortedValues.length - 1, Math.ceil((p / 100) * sortedValues.length) - 1);
  return sortedValues[Math.max(0, idx)];
}

interface ModelSummary {
  role: ModelRole;
  label: string;
  totalDocs: number;
  succeededDocs: number;
  failedDocs: number;
  docTypePass: number;
  customerPass: number;
  officePass: number;
  allPass: number;
  anomalousPageCount: number;
  retriedDocCount: number;
  totalInput: number;
  totalOutput: number;
  totalThinking: number;
  costUsd: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

function summarize(modelConfig: ModelConfig, outcomes: DocOcrOutcome[]): ModelSummary {
  const { role, label, pricing } = modelConfig;
  const totalDocs = outcomes.length;
  const succeeded = outcomes.filter((o) => o.success);
  const failedDocs = totalDocs - succeeded.length;

  const docTypePass = succeeded.filter((o) => o.docTypeMatch).length;
  const customerPass = succeeded.filter((o) => o.customerMatch).length;
  const officePass = succeeded.filter((o) => o.officeMatch).length;
  const allPass = succeeded.filter((o) => o.docTypeMatch && o.customerMatch && o.officeMatch).length;
  const anomalousPageCount = outcomes.reduce((s, o) => s + o.anomalousPages, 0);
  const retriedDocCount = outcomes.filter((o) => o.hadRetry).length;

  const totalInput = outcomes.reduce((s, o) => s + o.inputTokens, 0);
  const totalOutput = outcomes.reduce((s, o) => s + o.outputTokens, 0);
  const totalThinking = outcomes.reduce((s, o) => s + o.thinkingTokens, 0);
  const billableOutput = totalOutput + totalThinking;
  const costUsd = (totalInput * pricing.inputPer1MTokens + billableOutput * pricing.outputPer1MTokens) / 1_000_000;

  const sortedMs = outcomes.map((o) => o.elapsedMs).sort((a, b) => a - b);

  const summary: ModelSummary = {
    role,
    label,
    totalDocs,
    succeededDocs: succeeded.length,
    failedDocs,
    docTypePass,
    customerPass,
    officePass,
    allPass,
    anomalousPageCount,
    retriedDocCount,
    totalInput,
    totalOutput,
    totalThinking,
    costUsd,
    p50Ms: percentile(sortedMs, 50),
    p95Ms: percentile(sortedMs, 95),
    p99Ms: percentile(sortedMs, 99),
  };

  console.log(`\n=== ${label} ===`);
  console.log(`対象文書数: ${totalDocs} (成功 ${succeeded.length} / 失敗 ${failedDocs}、失敗率 ${pct(failedDocs, totalDocs)}%)`);
  console.log(`書類種別 一致率: ${docTypePass}/${succeeded.length} (${pct(docTypePass, succeeded.length)}%)`);
  console.log(`顧客     一致率: ${customerPass}/${succeeded.length} (${pct(customerPass, succeeded.length)}%)`);
  console.log(`事業所   一致率: ${officePass}/${succeeded.length} (${pct(officePass, succeeded.length)}%)`);
  console.log(`全項目一致      : ${allPass}/${succeeded.length} (${pct(allPass, succeeded.length)}%)`);
  console.log(`API異常疑いページ数: ${anomalousPageCount}`);
  console.log(`リトライ発生文書数: ${retriedDocCount}/${totalDocs} (${pct(retriedDocCount, totalDocs)}%)`);
  console.log(`トークン: input=${totalInput} output=${totalOutput} thinking=${totalThinking}`);
  console.log(`概算コスト: $${costUsd.toFixed(4)}`);
  console.log(`文書あたり処理時間: p50=${summary.p50Ms}ms p95=${summary.p95Ms}ms p99=${summary.p99Ms}ms`);

  return summary;
}

function pct(n: number, total: number): string {
  if (total === 0) return '0.0';
  return ((n / total) * 100).toFixed(1);
}

interface DocPairResult {
  baseline: DocOcrOutcome;
  candidate: DocOcrOutcome;
}

/**
 * 1文書について、ダウンロード→両モデルでの処理→バッファ破棄までを1単位として扱う。
 * (Codex review指摘反映: 以前はN件全PDFを一括ダウンロードして保持していたため、
 * N=300規模でGitHub Actions runnerのメモリを圧迫するリスクがあった。文書単位で
 * バッファのスコープを閉じることでrunner側のGCに任せられる。)
 *
 * aiは呼出元(main)で1回だけ生成したものを再利用する(code-review指摘反映:
 * GoogleGenAIクライアントはstateless設定オブジェクトのため、文書×モデルごとに毎回
 * 新規生成するのはN=300規模で無駄なCPU/初期化コスト。モデル選択はgenerateContent呼出時の
 * modelIdパラメータで行うためクライアント自体はbaseline/candidateで共有できる、
 * review-pr指摘反映: 完全に同一引数で構築される2インスタンスは冗長だったため1個に統一)。
 * baseline/candidateの2モデル呼出は互いに独立(同一pageBuffersを読むだけで状態を共有しない)
 * のためPromise.allで並行実行し、1文書あたりの処理時間を半減させる。
 */
async function processOneDocument(
  doc: SampledDoc,
  ai: InstanceType<typeof GoogleGenAI>,
  masters: { documents: DocumentMaster[]; customers: CustomerMaster[]; offices: OfficeMaster[] }
): Promise<DocPairResult | null> {
  let pdfBuffer: Buffer;
  let pageBuffers: Buffer[];
  try {
    pdfBuffer = await downloadOriginalPdf(doc.fileUrl);
    pageBuffers = await extractAllPdfPages(pdfBuffer, doc.totalPages);
  } catch (err) {
    console.warn(`[processOneDocument] PDF取得/ページ抽出失敗 (1件スキップ): ${describeErrorSafely(err)}`);
    return null;
  }

  const [baseline, candidate] = await Promise.all([
    processDocumentWithModel(ai, BASELINE_MODEL_CONFIG, doc, pageBuffers, masters),
    processDocumentWithModel(ai, CANDIDATE_MODEL_CONFIG, doc, pageBuffers, masters),
  ]);

  return { baseline, candidate };
}

async function main(): Promise<void> {
  const limit = getLimitArg();

  console.log('=== Gemini 2.5 vs 3.5 Flash OCR比較 (confirmed replay方式, Issue #548) ===');
  console.log(`プロジェクト: ${PROJECT_ID} / リージョン: ${LOCATION} / サンプル数上限: ${limit}`);
  console.log('個人情報(氏名・事業所名等)はログに一切出力しません。集計値のみを出力します。');
  console.log('顧客/事業所は人間確定(confirmedBy/officeConfirmedBy非null)の文書のみを対象とします。');

  const [sampled, masters] = await Promise.all([sampleConfirmedDocuments(limit), loadMastersReadOnly()]);

  if (sampled.length === 0) {
    console.error(
      '❌ 対象文書が見つかりませんでした (status=processed かつ customerConfirmed/officeConfirmed/' +
        'documentTypeConfirmedが全てtrue、かつconfirmedBy/officeConfirmedByが非null)'
    );
    process.exit(1);
  }
  console.log(`サンプリングした文書数: ${sampled.length}`);

  // 実行全体で1個だけ生成し使い回す(理由はprocessOneDocument()のJSDoc参照)。
  const ai = new GoogleGenAI({ vertexai: true, project: PROJECT_ID, location: LOCATION });

  console.log('\n--- 文書ごとに処理中 (ダウンロード→2.5-flash/3.5-flash並行実行→バッファ破棄) ---');
  const results = await runWithConcurrency(sampled, CONCURRENCY, (doc) => processOneDocument(doc, ai, masters));
  const validResults = results.filter((r): r is DocPairResult => r !== null);

  // review-pr指摘反映: PDF取得/ページ抽出失敗(processOneDocumentがnullを返す)はvalidResultsから
  // 除外されるため、summarize()の失敗率ゲートには一切現れない。サンプル全体に対する比率で
  // 別途ゲートする(モデル分岐前の共通失敗のため、baseline/candidate個別ではなくsampled基準)。
  const downloadFailedCount = sampled.length - validResults.length;
  const downloadFailureRateExceeded = downloadFailedCount > sampled.length * 0.1;

  console.log(`処理成功: ${validResults.length}/${sampled.length} (PDF取得/ページ抽出失敗分を除く)`);
  if (downloadFailureRateExceeded) {
    console.log(`⚠️ PDF取得/ページ抽出の失敗率が10%を超過: ${downloadFailedCount}/${sampled.length}`);
  }
  if (validResults.length === 0) {
    console.error('❌ 処理できた文書が1件もありませんでした');
    process.exit(1);
  }

  const baseline = summarize(
    BASELINE_MODEL_CONFIG,
    validResults.map((r) => r.baseline)
  );
  const migrated = summarize(
    CANDIDATE_MODEL_CONFIG,
    validResults.map((r) => r.candidate)
  );

  console.log('\n=== 判定 (Issue #548 トリガー条件: 3.5の精度が2.5を下回らないこと。書類種別/顧客/事業所の3フィールド、日付は対象外) ===');
  console.log(
    '(dateフィールドはconfirmed相当のground truthがFirestore上に存在しないため、' +
      'compare-gemini-ocr-models.tsと同様に本検証でも対象外)'
  );
  // code-review指摘反映: 絶対件数(allPass)ではなく成功文書中の一致率で比較する。
  // モデルごとに失敗件数(succeededDocs)が異なりうるため、件数比較だと片方が失敗多めなだけで
  // 誤って「精度劣化」と判定されうる(例: baseline 300成功/250一致=83.3% vs
  // candidate 271成功/240一致=88.6%は実質candidateの方が高精度だが、240<250で誤FAILしていた)。
  const baselineRate = baseline.succeededDocs > 0 ? baseline.allPass / baseline.succeededDocs : 0;
  const candidateRate = migrated.succeededDocs > 0 ? migrated.allPass / migrated.succeededDocs : 0;
  const regressed = candidateRate < baselineRate;
  console.log(
    `全項目一致率: baseline(2.5)=${(baselineRate * 100).toFixed(1)}% candidate(3.5)=${(candidateRate * 100).toFixed(1)}%`
  );
  console.log(`コスト比 (N=${validResults.length}件): ${(migrated.costUsd / baseline.costUsd).toFixed(2)}倍`);

  // Codex review指摘反映: API失敗(success:false)が正しくfailedDocsに集計されるようになったため、
  // baseline/candidate双方の失敗率を個別にチェックする(片方だけ異常終了した場合を検知するため)。
  const baselineFailureRateExceeded = baseline.failedDocs > baseline.totalDocs * 0.1;
  const candidateFailureRateExceeded = migrated.failedDocs > migrated.totalDocs * 0.1;
  if (baselineFailureRateExceeded) {
    console.log(`⚠️ baseline(2.5-flash)の失敗率が10%を超過: ${baseline.failedDocs}/${baseline.totalDocs}`);
  }
  if (candidateFailureRateExceeded) {
    console.log(`⚠️ candidate(3.5-flash)の失敗率が10%を超過: ${migrated.failedDocs}/${migrated.totalDocs}`);
  }

  // review-pr指摘反映: 以前はregressedのみでヘッドラインを表示しており、失敗率ゲート超過時も
  // 「✅ PASS」と表示されてしまい、下の⚠️行を見落とすと誤って安全と判断しうる状態だった。
  // 全ゲートを反映した単一の総合判定行にする。
  const overallPass = !regressed && !baselineFailureRateExceeded && !candidateFailureRateExceeded && !downloadFailureRateExceeded;
  console.log(
    overallPass
      ? '✅ PASS: 精度劣化なし、失敗率ゲートも全て許容範囲内'
      : '❌ FAIL: 精度劣化または失敗率ゲート超過を検出(詳細は上記⚠️行を参照)'
  );

  if (!overallPass) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  // fatal error: 個人情報保護のため生のエラーメッセージはログに出さない (describeErrorSafely参照)
  console.error('❌ エラー:', describeErrorSafely(err));
  process.exit(1);
});
