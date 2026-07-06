/**
 * OCR処理共通モジュール
 *
 * processOCR（ポーリング）から使用。processOCROnCreateは廃止（ADR-0010）。
 */

import * as admin from 'firebase-admin';
import { PDFDocument } from 'pdf-lib';
import {
  withRetry,
  RETRY_CONFIGS,
  isTransientError,
  is429Error,
  calculateRetryDelay429Ms,
} from '../utils/retry';
import { safeLogError } from '../utils/errorLogger';
import { getRateLimiter } from '../utils/rateLimiter';
import { GCP_CONFIG, GEMINI_CONFIG, isThreePointFiveModel } from '../utils/config';
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
import {
  capPageResultsAggregate,
} from '../utils/textCap';
import { buildPageResult, type RawPageOcrResult } from './buildPageResult';
import { buildOcrExtractionUpdatePayload } from './ocrUpdatePayloadBuilder';
import { validatePageResultsForReuse } from './pageResultsReuse';
import { applyConfirmedFieldProtection } from './confirmedFieldMerge';

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
// Issue #548: gemini-3.5-flashはthinkingBudget非対応でthinkingLevel方式のみサポートのため、
// generateContent呼び出し時のthinkingConfig形式をモデル別に分岐する。
const IS_35_MODEL = isThreePointFiveModel(MODEL_ID);

// 定数
const OCR_RESULT_MAX_LENGTH = 100000;
// Vertex AI暴走時の出力トークン上限（Issue #205）。8192tokens ≈ 25K chars Japanese、通常OCRには十分
const GEMINI_MAX_OUTPUT_TOKENS = GEMINI_CONFIG.maxOutputTokens;

/** OCR処理結果 */
export interface OcrProcessingResult {
  pagesProcessed: number;
  inputTokens: number;
  outputTokens: number;
  /** Issue #546: usageMetadata.thoughtsTokenCount の合計。output単価で課金されるがコスト内訳可視化のため分離 */
  thinkingTokens: number;
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

  // Issue #526 D3: 分割子ドキュメント(#445で確立済みのparentDocumentIdを持つ)が
  // 親から継承した有効なpageResultsを持つ場合、ページOCRを再実行せず再利用する(コスト削減)。
  const existingPageResults = docData.pageResults as RawPageOcrResult[] | undefined;
  const reuseCheck = validatePageResultsForReuse(existingPageResults, docData.parentDocumentId);

  let pageResults: RawPageOcrResult[] = [];
  let totalPages = 1;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalThinkingTokens = 0;

  if (reuseCheck.reusable && existingPageResults) {
    console.log(
      `Reusing existing pageResults for ${docId} (${existingPageResults.length} pages), skipping page OCR`
    );
    pageResults = existingPageResults;
    totalPages = existingPageResults.length;
  } else {
    if (!reuseCheck.reusable && existingPageResults && existingPageResults.length > 0) {
      console.log(`pageResults reuse skipped for ${docId}: ${reuseCheck.reason}`);
    }

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
        totalThinkingTokens += result.thinkingTokens;
      }
    } else {
      const result = await ocrWithGemini(buffer, mimeType);
      pageResults.push(buildPageResult(result, 1, 'Image'));
      totalInputTokens = result.inputTokens;
      totalOutputTokens = result.outputTokens;
      totalThinkingTokens = result.thinkingTokens;
    }
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

  // マスターデータ取得
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

  // Issue #526 D1: 抽出結果の集約ロジックは ocrUpdatePayloadBuilder.ts の純粋関数に
  // 切り出し済み(挙動不変、ユニットテストで契約をlock-in)。displayFileNameはここでは
  // 生成しない(Issue #526 D2: confirmed保護マージ後の最終メタから生成する順序に変更)。
  const extractionFields = buildOcrExtractionUpdatePayload({
    documentTypeResult,
    customerResult,
    officeResult,
    dateResult,
    savedOcrResult,
    ocrResultUrl,
    pageResults,
    totalPages,
    suggestedNewOffice,
    modelId: MODEL_ID,
    extractedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Issue #526 D2: confirmed保護マージはFirestore transaction内で最新ドキュメントを
  // 読み直してから行う。OCR/抽出処理は数秒〜数十秒かかるため、docData(呼出時点の
  // スナップショット)をそのまま使うと、処理中にユーザーが編集した内容と競合する
  // stale snapshot問題が起きる(Issue #526本文の設計要件)。
  const docRef = db.doc(`documents/${docId}`);

  await db.runTransaction(async (tx) => {
    const freshSnap = await tx.get(docRef);
    // tryStartProcessing() (本ファイル78行目付近) と同じ存在チェックパターン。
    // ドキュメントが処理中に削除されると tx.update() は NOT_FOUND を投げるが、
    // ここで明示的に検知することで handleProcessingError() の lastErrorMessage に
    // 原因不明な NOT_FOUND ではなく具体的な状況が残る(silent-failure-hunter指摘)。
    if (!freshSnap.exists) {
      throw new Error(
        `Document ${docId} was deleted during OCR processing, aborting confirmed-merge update`
      );
    }
    const freshData = freshSnap.data()!;

    const merged = applyConfirmedFieldProtection(extractionFields, {
      customerConfirmed: freshData.customerConfirmed,
      officeConfirmed: freshData.officeConfirmed,
      documentTypeConfirmed: freshData.documentTypeConfirmed,
      customerName: freshData.customerName,
      customerId: freshData.customerId,
      careManager: freshData.careManager,
      isDuplicateCustomer: freshData.isDuplicateCustomer,
      needsManualCustomerSelection: freshData.needsManualCustomerSelection,
      confirmedBy: freshData.confirmedBy,
      confirmedAt: freshData.confirmedAt,
      officeName: freshData.officeName,
      officeId: freshData.officeId,
      officeConfirmedBy: freshData.officeConfirmedBy,
      officeConfirmedAt: freshData.officeConfirmedAt,
      documentType: freshData.documentType,
      category: freshData.category,
    });

    // displayFileName 生成 (#178 Stage 1、Issue #526 D2でマージ後の最終メタから生成)
    // 「未判定」「不明顧客」等のデフォルト値・日付のみでの識別不能な名前生成の抑制は
    // generateDisplayFileName内部で行うため、ここでは merged の値をそのまま渡す。
    const displayFileName = generateDisplayFileName({
      documentType: merged.documentType,
      customerName: merged.customerName,
      officeName: merged.officeName,
      fileDate: dateResult.formattedDate ?? undefined,
    });

    // ドキュメント更新
    // Issue #548-B1: 要約は自動生成しない (regenerateSummary onCall 経由の手動生成のみ)。
    // OCR再実行のたびに summary を無効化することで、documentType/customerName/officeName等が
    // 更新されたのに古い内容の要約が残存する不整合 (429自動rescue・fix-stuck-documents.js等、
    // getReprocessClearFields()を経由しない再処理経路でも発生しうる) を構造的に防ぐ。
    // summary/summaryTruncated/summaryOriginalLengthの3フィールドを同時削除する。
    // 後2者はIssue #215以前の旧フラット形式の残骸クリーンアップ(前方互換とは無関係)。
    tx.update(docRef, {
      ...merged,
      ...(displayFileName ? { displayFileName } : {}),
      summary: admin.firestore.FieldValue.delete(),
      summaryTruncated: admin.firestore.FieldValue.delete(),
      summaryOriginalLength: admin.firestore.FieldValue.delete(),
      status: 'processed',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(
      `Document ${docId} processed: ${merged.documentType}, ${merged.customerName}`
    );
  });

  return {
    pagesProcessed: totalPages,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    thinkingTokens: totalThinkingTokens,
  };
}

// MAX_RETRY_COUNT は side-effect-free な constants.ts から re-export (#196)。
// ここを直接 const として定義すると test 側 import で admin.firestore() top-level 実行が走る。
export { MAX_RETRY_COUNT } from './constants';
import { MAX_RETRY_COUNT, MAX_RETRY_COUNT_429 } from './constants';

/**
 * エラー時の処理
 *
 * transient エラー (429 等) の場合は status:pending に戻して自動リトライ。
 * - 429/RESOURCE_EXHAUSTED 系: MAX_RETRY_COUNT_429 (8) + exponential delay + jitter
 *   (Vertex AI quota 数十分〜数時間の枯渇を吸収、kanameone 2026-06-11 事象予防)
 * - その他 transient (network/timeout 等): MAX_RETRY_COUNT (5) + 1 分 delay (既存挙動維持)
 *
 * リトライ上限超過 or 非 transient エラーは status:error 確定。
 */
export async function handleProcessingError(
  docId: string,
  error: Error,
  functionName: string
): Promise<void> {
  console.error(`Error processing document ${docId}:`, error.message);

  const transient = isTransientError(error);
  const isQuotaError = is429Error(error);
  const maxRetries = isQuotaError ? MAX_RETRY_COUNT_429 : MAX_RETRY_COUNT;

  // ステータス更新を最優先（トランザクションでretryCountをアトミックに管理）
  try {
    const docRef = db.doc(`documents/${docId}`);
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(docRef);
      const currentRetryCount = (doc.data()?.retryCount as number) || 0;
      const newRetryCount = currentRetryCount + 1;

      if (transient && newRetryCount < maxRetries) {
        // transientエラーかつ上限未満 → pendingに戻して自動リトライ
        const retryAfterMs = isQuotaError
          ? calculateRetryDelay429Ms(newRetryCount)
          : 1 * 60 * 1000;
        console.log(
          `Transient error for ${docId}, retrying (${newRetryCount}/${maxRetries}), ` +
            `retryAfter: ${Math.round(retryAfterMs / 1000)}s (quota: ${isQuotaError})`
        );
        tx.update(docRef, {
          status: 'pending',
          retryCount: newRetryCount,
          retryAfter: admin.firestore.Timestamp.fromMillis(Date.now() + retryAfterMs),
          lastErrorMessage: error.message.slice(0, 500),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        // 非transientエラーまたはリトライ上限超過 → error確定
        console.error(
          `Fatal/max-retry error for ${docId} (retryCount: ${newRetryCount}/${maxRetries}, ` +
            `transient: ${transient}, quota: ${isQuotaError})`
        );
        // retryAfter は直前 retry で書き込まれた値が残存しうる → delete で一貫性確保
        // (rescueStuckProcessingDocs の fatal 分岐 #196 と同じパターン)
        tx.update(docRef, {
          status: 'error',
          retryCount: newRetryCount,
          retryAfter: admin.firestore.FieldValue.delete(),
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
): Promise<{ text: string; inputTokens: number; outputTokens: number; thinkingTokens: number }> {
  const rateLimiter = getRateLimiter();
  await rateLimiter.acquire();

  // @google/genai はESM専用パッケージのため、CJSビルドのこのファイルからは
  // 静的importでなく動的importで読み込む(TS1479回避)。
  const { GoogleGenAI, ThinkingLevel } = await import('@google/genai');
  const ai = new GoogleGenAI({ vertexai: true, project: PROJECT_ID, location: LOCATION });

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
      return await ai.models.generateContent({
        model: MODEL_ID,
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
        config: {
          // Issue #205: ハルシネーション/暴走による1.1M chars応答を防止する根本対策
          maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
          // Issue #546: OCR転記はテキストの正確な書き起こしのみで推論を要さないため、
          // thinkingを最小化しコストを削減する。gemini-2.5-flashはthinkingBudget方式
          // (既定0、GEMINI_OCR_THINKING_BUDGET環境変数でfeature flag化、GEMINI_CONFIG参照)。
          // Issue #548: gemini-3.5-flashはthinkingBudget非対応でthinkingLevel方式のみサポートのため、
          // A/Bテストharness(PR #559、実機3回PASS・精度劣化なし)で実証済みのthinkingLevel.LOWを使用する。
          // ロールバックは`GEMINI_MODEL_ID=gemini-2.5-flash`設定+functions再deployのみ(コード変更不要)。
          thinkingConfig: IS_35_MODEL
            ? { thinkingLevel: ThinkingLevel.LOW }
            : { thinkingBudget: GEMINI_CONFIG.ocrThinkingBudget },
        },
      });
    },
    RETRY_CONFIGS.gemini
  );

  const text = response.text || '';

  const usageMetadata = response.usageMetadata;
  const inputTokens = usageMetadata?.promptTokenCount || 0;
  const outputTokens = usageMetadata?.candidatesTokenCount || 0;
  // Issue #546: thinkingはデフォルト有効(dynamic)でoutput単価課金だが従来未計測だった。
  const thinkingTokens = usageMetadata?.thoughtsTokenCount || 0;

  console.log(
    `OCR completed: ${text.length} chars, tokens: ${inputTokens}/${outputTokens} (thinking: ${thinkingTokens})`
  );

  return { text, inputTokens, outputTokens, thinkingTokens };
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
