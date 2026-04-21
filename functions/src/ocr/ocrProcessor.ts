/**
 * OCR処理共通モジュール
 *
 * processOCR（ポーリング）から使用。processOCROnCreateは廃止（ADR-0010）。
 */

import * as admin from 'firebase-admin';
import { VertexAI } from '@google-cloud/vertexai';
import { PDFDocument } from 'pdf-lib';
import { withRetry, RETRY_CONFIGS, isTransientError, is429Error } from '../utils/retry';
import { safeLogError } from '../utils/errorLogger';
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
import { generateDisplayFileName } from '../../../shared/generateDisplayFileName';
import { loadMasterData } from '../utils/loadMasterData';
import { buildSummaryFields } from './summaryRequestBuilder';
import { generateSummaryCore, MIN_OCR_LENGTH_FOR_SUMMARY } from './summaryGenerator';
import {
  capPageResultsAggregate,
} from '../utils/textCap';
import type { SummaryField } from '../../../shared/types';
import { buildPageResult, type RawPageOcrResult } from './buildPageResult';

// #267: buildPageResult / 型は ./buildPageResult モジュールに移設。
// #278: 型名 PageOcrResult → RawPageOcrResult にリネーム (shared/types.ts の post-processed
// PageOcrResult との 3 重定義衝突を解消)。ocrProcessor からは re-export のみ行い、import の
// 入口を 1 つに保つ。
export { buildPageResult, type RawPageOcrResult };

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

  let pageResults: RawPageOcrResult[] = [];
  let totalPages = 1;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

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

  // aggregate cap (Issue #205): per-page後にも合計サイズで二段防御。
  const beforeAggregateChars = pageResults.reduce((sum, p) => sum + p.text.length, 0);
  // #288 item 6: invariant violation の errors collection triage のため docId を伝搬。
  // #297 (Codex HIGH): pendingInvariantLogs を渡して fire-and-forget を廃止、後段で drain する。
  // #304 naming: context field 名は drainSink (pendingLogs からリネーム)。caller ローカル変数名は
  //   drain 責務を明示する従来命名 pendingInvariantLogs を維持。
  // #293 (silent-failure-hunter S2): dev 環境での invariant throw を caller で捕捉し、
  //   rules/error-handling.md §1「状態復旧 > ログ記録」に従って他ページ処理を継続する。
  //   pageResults は cap 前のまま pass-through (per-page cap 適用済で暴走リスクなし)。
  //   prod 分岐は handleAggregateInvariantViolation 内で safeLogError emit するため throw しない。
  const pendingInvariantLogs: Promise<void>[] = [];
  try {
    pageResults = capPageResultsAggregate(pageResults, {
      documentId: docId,
      drainSink: pendingInvariantLogs,
    });
  } catch (err) {
    const baseError = err instanceof Error ? err : new Error(String(err));
    // catch boundary は広いため、既知 invariant (textCap.ts handleAggregateInvariantViolation 由来) と
    // 予期外エラー (TypeError 等の実装バグ) を suffix で分類して triage を容易にする。
    const isKnownInvariant = baseError.message.startsWith(
      'capPageResultsAggregate invariant violation:',
    );
    const suffix = isKnownInvariant ? 'aggregateCap:invariant' : 'aggregateCap:unexpected';
    // errors collection triage 文脈: pages 件数と合計 chars を message に含めて原因特定を容易に。
    const enriched = new Error(
      `${baseError.message} (pages=${pageResults.length}, totalChars=${beforeAggregateChars})`,
    );
    if (baseError.stack) enriched.stack = baseError.stack;
    await safeLogError({
      error: enriched,
      source: 'ocr',
      functionName: `${functionName}:${suffix}`,
      documentId: docId,
    });
  }
  // #297: invariant violation の safeLogError Firestore 書込を Cloud Functions handler 終了前に flush。
  // safeLogError 自体は reject しない設計 (errorLogger.ts:141-151) だが、将来 reject 経路が
  // 追加された場合に silent にならないよう rejected 件数を防御的に監視する。
  if (pendingInvariantLogs.length > 0) {
    const settled = await Promise.allSettled(pendingInvariantLogs);
    const rejected = settled.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    if (rejected.length > 0) {
      console.error(
        `[ocrProcessor] ${rejected.length}/${settled.length} invariant log(s) rejected for doc ${docId}:`,
        rejected.map((r) => r.reason),
      );
    }
  }
  const afterAggregateChars = pageResults.reduce((sum, p) => sum + p.text.length, 0);
  if (afterAggregateChars < beforeAggregateChars) {
    // #283: 集約サマリの observability を console.warn → safeLogError に格上げ。
    // warn level は Cloud Logging alert に拾われにくく、#209 型実害 (Vertex AI 暴走
    // 1.1M chars) の再発を運用側が認知できない silent failure 経路を塞ぐ。
    // safeLogError 内部の logError が console.error も出すため重複 warn は置かない。
    // per-page 粒度の可視性は textCap.capPageResultsAggregate 内部 console.warn でカバー。
    await safeLogError({
      error: new Error(
        `[OCR] Aggregate pageResults truncated: ${beforeAggregateChars} → ${afterAggregateChars} chars`
      ),
      source: 'ocr',
      functionName: `${functionName}:aggregateCap`,
      documentId: docId,
    });
  }

  // OCR結果を結合
  const ocrResult = pageResults
    .map((p) => `--- Page ${p.pageNumber} ---\n${p.text}`)
    .join('\n\n');

  // マスターデータ取得（要約生成と並列実行）
  // Issue #266: 通常は generateSummary 内部 catch で吸収されるため本 catch には到達しない。
  // inner catch の regression や Promise 化されていない throw 経路に対する二重防御として残置。
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

  const { documents, customers, offices } = await loadMasterData(db, {
    source: 'ocr',
    functionName: 'ocrProcessor',
  });

  // 情報抽出（強化版エクストラクター使用）
  const documentTypeResult = extractDocumentTypeEnhanced(ocrResult, documents);
  const customerResult = extractCustomerCandidates(ocrResult, customers);

  // ファイル名から事業所情報を抽出
  const fileName = docData.fileName as string | undefined;
  const filenameInfo = fileName ? extractFilenameInfo(fileName) : undefined;
  console.log(`Filename info: ${JSON.stringify(filenameInfo)}`);

  // 事業所候補抽出
  const officeResult = extractOfficeCandidates(ocrResult, offices, { filenameInfo });

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

  // dateMarker は型崩れしていても undefined に正規化済み (sanitizeDocumentMasters)
  const matchedDoc = documents.find((d) => d.name === documentTypeResult.documentType);
  const dateMarker = matchedDoc?.dateMarker;
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

// MAX_RETRY_COUNT は side-effect-free な constants.ts から re-export (#196)。
// ここを直接 const として定義すると test 側 import で admin.firestore() top-level 実行が走る。
export { MAX_RETRY_COUNT } from './constants';
import { MAX_RETRY_COUNT } from './constants';

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

  await safeLogError({
    error,
    source: 'ocr',
    functionName,
    documentId: docId,
  });
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
