/**
 * OCR処理共通モジュール
 *
 * processOCR（ポーリング）から使用。processOCROnCreateは廃止（ADR-0010）。
 */

import * as admin from 'firebase-admin';
import { VertexAI } from '@google-cloud/vertexai';
import { PDFDocument } from 'pdf-lib';
import { withRetry, RETRY_CONFIGS, isTransientError, is429Error } from '../utils/retry';
import { logError, safeLogError } from '../utils/errorLogger';
import { getRateLimiter } from '../utils/rateLimiter';
import { GCP_CONFIG, GEMINI_CONFIG } from '../utils/config';
import {
  extractDocumentTypeEnhanced,
  extractCustomerCandidates,
  extractOfficeCandidates,
  extractDateEnhanced,
  extractFilenameInfo,
  normalizeForMatching,
} from '../utils/extractors';
import { generateDisplayFileName } from '../utils/displayFileNameGenerator';
import { sanitizeCustomerMasters, sanitizeOfficeMasters, sanitizeDocumentMasters } from '../utils/sanitizeMasterData';
import { buildSummaryFields } from './summaryRequestBuilder';
import { generateSummaryCore, MIN_OCR_LENGTH_FOR_SUMMARY } from './summaryGenerator';
import {
  capPageText,
  capPageResultsAggregate,
  MAX_PAGE_TEXT_LENGTH,
} from '../utils/textCap';
import type { SummaryField } from '../../../shared/types';

const db = admin.firestore();
const storage = admin.storage();

// Vertex AI設定
const PROJECT_ID = GCP_CONFIG.projectId;
const LOCATION = GCP_CONFIG.location;
const MODEL_ID = GEMINI_CONFIG.modelId;

// 定数
const OCR_RESULT_MAX_LENGTH = 100000;
// Vertex AI暴走時の出力トークン上限（Issue #205）。8192tokens ≈ 25K chars Japanese、通常OCRには十分
const GEMINI_MAX_OUTPUT_TOKENS = GEMINI_CONFIG.maxOutputTokens;

/**
 * ページ単位OCR結果 (Issue #258 で discriminated union 化)
 *
 * SummaryField (text/truncated/originalLength) + OCR メタ (pageNumber/inputTokens/outputTokens) の合成。
 * 不変条件: truncated=true ⟹ originalLength 必須（型レベル保証）。
 * truncated=false の場合 page.originalLength は型に存在しない（access で tsc エラー）。
 */
export type PageOcrResult = SummaryField & {
  pageNumber: number;
  inputTokens: number;
  outputTokens: number;
};

/** OCR処理結果 */
export interface OcrProcessingResult {
  pagesProcessed: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * 排他制御付きでドキュメントの処理を開始
 * 既に処理中の場合はnullを返す
 */
export async function tryStartProcessing(docId: string): Promise<boolean> {
  const docRef = db.doc(`documents/${docId}`);

  try {
    const success = await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(docRef);

      if (!doc.exists) {
        console.log(`Document ${docId} not found`);
        return false;
      }

      const status = doc.data()?.status;

      // pending以外は処理しない（既に処理中または完了）
      if (status !== 'pending') {
        console.log(`Document ${docId} is not pending (status: ${status}), skipping`);
        return false;
      }

      // processingに更新
      transaction.update(docRef, {
        status: 'processing',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return true;
    });

    return success;
  } catch (error) {
    console.error(`Failed to start processing ${docId}:`, error);
    return false;
  }
}

/**
 * ドキュメントをOCR処理（コアロジック）
 */
export async function processDocument(
  docId: string,
  docData: FirebaseFirestore.DocumentData,
  functionName: string
): Promise<OcrProcessingResult> {
  console.log(`Processing document: ${docId}`);

  // ファイル取得
  const fileUrl = docData.fileUrl as string;
  const bucket = storage.bucket();
  const filePath = fileUrl.replace(`gs://${bucket.name}/`, '');
  const file = bucket.file(filePath);

  const [buffer] = await withRetry(
    () => file.download(),
    RETRY_CONFIGS.storage
  );
  const mimeType = docData.mimeType as string;

  let pageResults: PageOcrResult[] = [];
  let totalPages = 1;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const buildPageResult = (
    result: { text: string; inputTokens: number; outputTokens: number },
    pageNumber: number,
    label: string
  ): PageOcrResult => {
    const capped = capPageText(result.text);
    if (capped.truncated) {
      console.warn(`[OCR] ${label} text truncated: ${capped.originalLength} → ${capped.text.length} chars (cap=${MAX_PAGE_TEXT_LENGTH})`);
    }
    // #258: `...capped` で discriminated union の不変条件 (truncated tag + originalLength) が caller に伝播。
    return {
      ...capped,
      pageNumber,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };
  };

  if (mimeType === 'application/pdf') {
    const pdfDoc = await PDFDocument.load(buffer);
    totalPages = pdfDoc.getPageCount();

    console.log(`PDF has ${totalPages} pages`);

    for (let i = 0; i < totalPages; i++) {
      const pageNumber = i + 1;
      console.log(`Processing page ${pageNumber}/${totalPages}`);

      const pageBuffer = await extractPdfPage(buffer, i);
      const result = await ocrWithGemini(pageBuffer, 'application/pdf', pageNumber);

      pageResults.push(buildPageResult(result, pageNumber, `Page ${pageNumber}/${totalPages}`));

      totalInputTokens += result.inputTokens;
      totalOutputTokens += result.outputTokens;
    }
  } else {
    const result = await ocrWithGemini(buffer, mimeType);
    pageResults.push(buildPageResult(result, 1, 'Image'));
    totalInputTokens = result.inputTokens;
    totalOutputTokens = result.outputTokens;
  }

  // aggregate cap (Issue #205): per-page後にも合計サイズで二段防御。#264 follow-up: 型レベル不変条件は textCap.ts 内コメント参照。
  const beforeAggregateChars = pageResults.reduce((sum, p) => sum + p.text.length, 0);
  pageResults = capPageResultsAggregate(pageResults);
  const afterAggregateChars = pageResults.reduce((sum, p) => sum + p.text.length, 0);
  if (afterAggregateChars < beforeAggregateChars) {
    console.warn(`[OCR] Aggregate pageResults truncated: ${beforeAggregateChars} → ${afterAggregateChars} chars`);
  }

  // OCR結果を結合
  const ocrResult = pageResults
    .map((p) => `--- Page ${p.pageNumber} ---\n${p.text}`)
    .join('\n\n');

  // マスターデータ取得（要約生成と並列実行）
  // Issue #266: generateSummary 内部 catch で empty 返却するため本 catch は通常 dead code だが、
  // 将来の signature 変更で throw 経路が生じた場合の edge case safety net として残置。
  // safeLogError 経由で silent failure を防ぎ、errors collection から検知可能にする。
  const summaryPromise = generateSummary(ocrResult, '', { docId, functionName }).catch(
    async (err) => {
      console.error('Summary generation failed:', err);
      await safeLogError({
        error: err instanceof Error ? err : new Error(String(err)),
        source: 'ocr',
        functionName: `${functionName}:summaryPromise`,
        documentId: docId,
      });
      return { text: '', truncated: false } satisfies SummaryField;
    }
  );

  // マスターデータ取得
  const [documentMasters, customerMasters, officeMasters] = await Promise.all([
    db.collection('masters/documents/items').get(),
    db.collection('masters/customers/items').get(),
    db.collection('masters/offices/items').get(),
  ]);

  // マスターデータを型付きで変換
  const docMasterData = sanitizeDocumentMasters(documentMasters.docs.map((d) => ({
    id: d.id,
    name: d.data().name as string,
    category: d.data().category as string | undefined,
    keywords: d.data().keywords as string[] | undefined,
    aliases: d.data().aliases as string[] | undefined,
  })));

  const custMasterData = sanitizeCustomerMasters(customerMasters.docs.map((d) => ({
    id: d.id,
    name: d.data().name as string,
    furigana: d.data().furigana as string | undefined,
    isDuplicate: d.data().isDuplicate as boolean | undefined,
    careManagerName: d.data().careManagerName as string | undefined,
    aliases: d.data().aliases as string[] | undefined,
  })));

  const officeMasterData = sanitizeOfficeMasters(officeMasters.docs.map((d) => ({
    id: d.id,
    name: d.data().name as string,
    shortName: d.data().shortName as string | undefined,
    isDuplicate: d.data().isDuplicate as boolean | undefined,
    aliases: d.data().aliases as string[] | undefined,
  })));

  // 情報抽出（強化版エクストラクター使用）
  const documentTypeResult = extractDocumentTypeEnhanced(ocrResult, docMasterData);
  const customerResult = extractCustomerCandidates(ocrResult, custMasterData);

  // ファイル名から事業所情報を抽出
  const fileName = docData.fileName as string | undefined;
  const filenameInfo = fileName ? extractFilenameInfo(fileName) : undefined;
  console.log(`Filename info: ${JSON.stringify(filenameInfo)}`);

  // 事業所候補抽出
  const officeResult = extractOfficeCandidates(ocrResult, officeMasterData, { filenameInfo });

  // ファイル名からの事業所登録提案
  let suggestedNewOffice: string | null = null;
  if (filenameInfo?.prefixType === 'office_name' && filenameInfo.normalizedPrefix) {
    const ocrTextNormalized = normalizeForMatching(ocrResult);
    const existsInOcrText = ocrTextNormalized.includes(filenameInfo.normalizedPrefix);
    const noGoodMatch = !officeResult.bestMatch || officeResult.bestMatch.score < 80;

    if (existsInOcrText && noGoodMatch) {
      suggestedNewOffice = filenameInfo.prefix;
      console.log(`Suggested new office from filename: ${suggestedNewOffice}`);
    }
  }

  // 日付抽出（1ページ目を優先）
  const matchedDocMaster = documentMasters.docs.find((d) => d.data().name === documentTypeResult.documentType);
  const dateMarker = matchedDocMaster?.data().dateMarker as string | undefined;
  const firstPageText = pageResults.length > 0 ? pageResults[0]?.text : undefined;
  const dateResult = extractDateEnhanced(ocrResult, dateMarker, firstPageText);

  // OCR結果が長い場合はCloud Storageに保存
  let ocrResultUrl: string | null = null;
  let savedOcrResult = ocrResult;

  if (ocrResult.length > OCR_RESULT_MAX_LENGTH) {
    ocrResultUrl = await saveOcrResult(docId, ocrResult);
    savedOcrResult = '';
  }

  // 顧客候補リスト（最大5件）
  const customerCandidateNames = customerResult.candidates
    .slice(0, 5)
    .map((c) => c.name);

  // 要約生成を待機
  const summary = await summaryPromise;

  // displayFileName 生成 (#178 Stage 1)
  // デフォルト値（未判定/不明顧客）は渡さない。generateDisplayFileNameが除外するが、
  // 日付だけで「20260315.pdf」のような識別不能な名前を防ぐため
  const displayFileName = generateDisplayFileName({
    documentType: documentTypeResult.documentType || undefined,
    customerName: customerResult.bestMatch?.name || undefined,
    officeName: officeResult.bestMatch?.name || undefined,
    fileDate: dateResult.formattedDate ?? undefined,
  });

  // ドキュメント更新
  // Issue #215: summary を discriminated union ネスト型で書き込み、
  // 旧フラット3フィールド (summaryTruncated / summaryOriginalLength) は削除。
  // 旧 summary (string型) は新 summary (object型) で上書きされる。
  await db.doc(`documents/${docId}`).update({
    ...(displayFileName ? { displayFileName } : {}),
    ocrResult: savedOcrResult,
    ocrResultUrl: ocrResultUrl ?? null,
    summary: buildSummaryFields(summary),
    summaryTruncated: admin.firestore.FieldValue.delete(),
    summaryOriginalLength: admin.firestore.FieldValue.delete(),
    pageResults,
    documentType: documentTypeResult.documentType || '未判定',
    customerName: customerResult.bestMatch?.name || '不明顧客',
    customerId: customerResult.bestMatch?.id ?? null,
    careManager: customerResult.bestMatch?.careManagerName ?? null,
    officeName: officeResult.bestMatch?.name || '未判定',
    officeId: officeResult.bestMatch?.id ?? null,
    fileDate: dateResult.date ?? null,
    fileDateFormatted: dateResult.formattedDate ?? null,
    isDuplicateCustomer: customerResult.bestMatch?.isDuplicate || false,
    needsManualCustomerSelection: customerResult.needsManualSelection ?? false,
    customerConfirmed: !customerResult.needsManualSelection,
    confirmedBy: null,
    confirmedAt: null,
    allCustomerCandidates: customerCandidateNames.join(','),
    customerCandidates: customerResult.candidates.slice(0, 5).map((c) => ({
      customerId: c.id ?? null,
      customerName: c.name ?? '',
      isDuplicate: c.isDuplicate || false,
      score: c.score ?? 0,
      matchType: c.matchType ?? 'none',
      careManagerName: c.careManagerName ?? null,
    })),
    officeConfirmed: !officeResult.needsManualSelection,
    officeConfirmedBy: null,
    officeConfirmedAt: null,
    officeCandidates: officeResult.candidates.slice(0, 5).map((o) => ({
      officeId: o.id ?? null,
      officeName: o.name ?? '',
      shortName: o.shortName ?? null,
      isDuplicate: o.isDuplicate || false,
      score: o.score ?? 0,
      matchType: o.matchType ?? 'none',
    })),
    suggestedNewOffice: suggestedNewOffice ?? null,
    totalPages,
    category: documentTypeResult.category ?? null,
    status: 'processed',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    extractionScores: {
      documentType: documentTypeResult.score ?? 0,
      customerName: customerResult.bestMatch?.score ?? 0,
      officeName: officeResult.bestMatch?.score ?? 0,
      date: dateResult.confidence ?? 0,
    },
    extractionDetails: {
      documentMatchType: documentTypeResult.matchType ?? 'none',
      documentKeywords: documentTypeResult.keywords ?? [],
      customerMatchType: customerResult.bestMatch?.matchType ?? 'none',
      officeMatchType: officeResult.bestMatch?.matchType ?? 'none',
      datePattern: dateResult.pattern ?? null,
      dateSource: dateResult.source ?? null,
    },
    ocrExtraction: {
      version: MODEL_ID,
      extractedAt: admin.firestore.FieldValue.serverTimestamp(),
      customer: {
        suggestedValue: customerResult.bestMatch?.name || '不明顧客',
        suggestedId: customerResult.bestMatch?.id ?? null,
        confidence: customerResult.bestMatch?.score ?? 0,
        matchType: customerResult.bestMatch?.matchType ?? 'none',
      },
      office: {
        suggestedValue: officeResult.bestMatch?.name || '未判定',
        suggestedId: officeResult.bestMatch?.id ?? null,
        confidence: officeResult.bestMatch?.score ?? 0,
        matchType: officeResult.bestMatch?.matchType ?? 'none',
      },
      documentType: {
        suggestedValue: documentTypeResult.documentType || '未判定',
        suggestedId: null,
        confidence: documentTypeResult.score ?? 0,
        matchType: documentTypeResult.matchType ?? 'none',
      },
    },
  });

  console.log(`Document ${docId} processed: ${documentTypeResult.documentType}, ${customerResult.bestMatch?.name || '不明'}`);

  return {
    pagesProcessed: totalPages,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
  };
}

/** リトライ上限 */
const MAX_RETRY_COUNT = 5;

/**
 * エラー時の処理
 *
 * transientエラー（429等）の場合はstatus:pendingに戻して自動リトライ。
 * リトライ上限（MAX_RETRY_COUNT）超過時のみstatus:errorに設定。
 */
export async function handleProcessingError(
  docId: string,
  error: Error,
  functionName: string
): Promise<void> {
  console.error(`Error processing document ${docId}:`, error.message);

  const transient = isTransientError(error);

  // ステータス更新を最優先（トランザクションでretryCountをアトミックに管理）
  try {
    const docRef = db.doc(`documents/${docId}`);
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(docRef);
      const currentRetryCount = (doc.data()?.retryCount as number) || 0;
      const newRetryCount = currentRetryCount + 1;

      if (transient && newRetryCount < MAX_RETRY_COUNT) {
        // transientエラーかつ上限未満 → pendingに戻して自動リトライ
        // 429/RESOURCE_EXHAUSTEDは3分、その他transientは1分待機
        const isQuotaError = is429Error(error);
        const retryAfterMs = isQuotaError ? 3 * 60 * 1000 : 1 * 60 * 1000;
        console.log(`Transient error for ${docId}, retrying (${newRetryCount}/${MAX_RETRY_COUNT}), retryAfter: ${retryAfterMs / 1000}s (quota: ${isQuotaError})`);
        tx.update(docRef, {
          status: 'pending',
          retryCount: newRetryCount,
          retryAfter: admin.firestore.Timestamp.fromMillis(Date.now() + retryAfterMs),
          lastErrorMessage: error.message.slice(0, 500),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        // 非transientエラーまたはリトライ上限超過 → error確定
        console.error(`Fatal/max-retry error for ${docId} (retryCount: ${newRetryCount}, transient: ${transient})`);
        tx.update(docRef, {
          status: 'error',
          retryCount: newRetryCount,
          lastErrorMessage: error.message.slice(0, 500),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    });
  } catch (updateErr) {
    console.error(`Failed to update document ${docId} status:`, updateErr);
    // トランザクション失敗時のフォールバック
    try {
      await db.doc(`documents/${docId}`).update({
        status: 'error',
        lastErrorMessage: error.message.slice(0, 500),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (fallbackErr) {
      console.error(`Fallback update also failed for ${docId}:`, fallbackErr);
    }
  }

  try {
    await logError({
      error,
      source: 'ocr',
      functionName,
      documentId: docId,
    });
  } catch (logErr) {
    console.error(`Failed to log error for document ${docId}:`, logErr);
  }
}

/**
 * PDFから単一ページを抽出
 */
async function extractPdfPage(pdfBuffer: Buffer, pageIndex: number): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const newPdf = await PDFDocument.create();
  const [copiedPage] = await newPdf.copyPages(pdfDoc, [pageIndex]);
  newPdf.addPage(copiedPage);
  const pdfBytes = await newPdf.save();
  return Buffer.from(pdfBytes);
}

/**
 * Gemini 2.5 FlashでOCR処理
 */
async function ocrWithGemini(
  buffer: Buffer,
  mimeType: string,
  pageNumber?: number
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const rateLimiter = getRateLimiter();
  await rateLimiter.acquire();

  const vertexai = new VertexAI({ project: PROJECT_ID, location: LOCATION });
  const model = vertexai.getGenerativeModel({ model: MODEL_ID });

  const base64Data = buffer.toString('base64');

  const prompt = `
この画像/PDFの内容をOCRしてください。

【指示】
- テキストをそのまま正確に抽出してください
- 表がある場合は、構造を保ってテキスト化してください
- 手書き文字も可能な限り読み取ってください
- 読み取れない部分は[判読不能]と記載してください
- 余計な説明は不要です。抽出したテキストのみを出力してください
${pageNumber ? `\nこれは${pageNumber}ページ目です。` : ''}
`;

  const response = await withRetry(
    async () => {
      return await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: base64Data,
                },
              },
              { text: prompt },
            ],
          },
        ],
        // Issue #205: ハルシネーション/暴走による1.1M chars応答を防止する根本対策
        generationConfig: {
          maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
        },
      });
    },
    RETRY_CONFIGS.gemini
  );

  const result = response.response;
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';

  const usageMetadata = result.usageMetadata;
  const inputTokens = usageMetadata?.promptTokenCount || 0;
  const outputTokens = usageMetadata?.candidatesTokenCount || 0;

  console.log(`OCR completed: ${text.length} chars, tokens: ${inputTokens}/${outputTokens}`);

  return { text, inputTokens, outputTokens };
}

/**
 * OCR結果からAI要約を生成 (Issue #209, Issue #214, #258, #266)
 *
 * Precondition: core の `generateSummaryCore` は `length < MIN_OCR_LENGTH_FOR_SUMMARY` を許容しない。
 * 本 helper はその precondition を先に消化し、短文時は empty SummaryField を返して後続処理を継続する。
 * Vertex AI エラーは catch → empty 返却で best-effort (呼出元 `summaryPromise` の `.catch(empty)` と二重防御)。
 * Issue #266: catch 句で logError 呼出を追加し、silent failure を防ぐ。
 * @returns SummaryField - text(切り詰め後summary), truncated(切り詰めフラグ), originalLength(truncated=true 時のみ)
 */
async function generateSummary(
  ocrResult: string,
  documentType: string,
  logContext: { docId: string; functionName: string }
): Promise<SummaryField> {
  if (!ocrResult || ocrResult.length < MIN_OCR_LENGTH_FOR_SUMMARY) {
    return { text: '', truncated: false };
  }
  try {
    return await generateSummaryCore(ocrResult, documentType);
  } catch (error) {
    console.error('Failed to generate summary:', error);
    await safeLogError({
      error: error instanceof Error ? error : new Error(String(error)),
      source: 'ocr',
      functionName: `${logContext.functionName}:generateSummary`,
      documentId: logContext.docId,
    });
    return { text: '', truncated: false };
  }
}

/**
 * 長いOCR結果をCloud Storageに保存
 */
async function saveOcrResult(docId: string, ocrResult: string): Promise<string> {
  const bucket = storage.bucket();
  const file = bucket.file(`ocr-results/${docId}.txt`);

  await withRetry(
    () =>
      file.save(ocrResult, {
        contentType: 'text/plain; charset=utf-8',
        metadata: {
          documentId: docId,
          createdAt: new Date().toISOString(),
        },
      }),
    RETRY_CONFIGS.storage
  );

  return `gs://${bucket.name}/ocr-results/${docId}.txt`;
}
