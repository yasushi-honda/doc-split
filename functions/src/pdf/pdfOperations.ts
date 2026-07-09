/**
 * PDF編集操作 Cloud Function
 *
 * 機能:
 * - PDF分割（分割位置サジェスト + 実行）
 * - PDF回転（ページ単位）
 * - 分割候補の検出（OCR結果から顧客/書類の変化点を検出）
 *
 * Phase 6D: pdfAnalyzer統合
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { PDFDocument, degrees } from 'pdf-lib';
import { sha256Hex } from '../utils/hash';
import {
  analyzePdf,
  generateSplitSummary,
  PageOcrData,
} from '../utils/pdfAnalyzer';
import type { MasterData } from '../utils/extractors';
import { buildSplitDocumentData } from './splitDocumentBuilder';
import { generateDisplayFileName } from '../../../shared/generateDisplayFileName';
import { timestampToDateString } from '../utils/timestampHelpers';
import { loadMasterData } from '../utils/loadMasterData';
import { sanitizeFilenameForStorage } from '../utils/fileNaming';
import { createSplitProvenance, createRotationProvenance } from './provenance';
import { resolveDetailFields, readDocWithDetail } from '../ocr/documentDetail';
import { mergeRotations } from './rotationMerge';
import { shouldRejectRotateForBackfill } from './rotateGate';
import { randomUUID } from 'node:crypto';
import type { DocumentProvenance } from '../../../shared/types';
import {
  SourceDriftError,
  acquireSourceSnapshot,
  backoffSleep,
  parseGcsUri,
  verifyFinalDrift,
} from './splitSnapshot';

const db = admin.firestore();
const storage = admin.storage();

// ============================================
// 分割候補検出（Phase 6D: pdfAnalyzer統合）
// ============================================

/**
 * 分割候補検出用のページ情報 (Issue #278 で PageOcrResult から SplitPageInput にリネーム)
 *
 * 旧名 PageOcrResult は shared/types.ts の PageOcrResult (PageOcrMeta & SummaryField) および
 * functions/src/ocr/buildPageResult.ts の RawPageOcrResult と structurally incompatible な
 * 3 重定義を形成していた。本 interface は Firestore `documents/{id}.pageResults` を
 * detectSplitPoints が読み出す際の minimum subset で、独自の shape として独立性を明示する。
 */
interface SplitPageInput {
  pageNumber: number;
  text: string;
  detectedDocumentType: string | null;
  detectedCustomerName: string | null;
  detectedOfficeName: string | null;
  matchScore: number;
}

/**
 * detail優先で解決した pageResults を SplitPageInput[] として返す
 * (ADR-0018 Phase D、detectSplitPoints/splitPdf 共用。unknown 経由キャストの一元点)。
 *
 * unknown 経由キャストの根拠: SplitPageInput は保存データに存在しない検出系フィールド
 * (detectedDocumentType 等)を宣言している(実際に永続化される shape は
 * PersistedPageOcrResult 相当で、検出系フィールドを書いた writer は存在しない —
 * git 履歴で確認済み)。下流の pdfAnalyzer は検出系を optional として undefined を許容し
 * text+マスターから再検出するため、宣言型が実データより広い方向の不一致は無害。
 * 従来は DocumentData の any 経由で暗黙に通っていた同じ実態への型付け。
 */
function resolveSplitPageInputs(
  detailData: FirebaseFirestore.DocumentData | undefined,
  parentData: FirebaseFirestore.DocumentData
): SplitPageInput[] {
  return (resolveDetailFields(detailData, parentData).pageResults ??
    []) as unknown as SplitPageInput[];
}

/**
 * 分割候補を検出（強化版 - pdfAnalyzer使用）
 */
export const detectSplitPoints = onCall(
  {
    region: 'asia-northeast1',
    memory: '512MiB',
  },
  async (request) => {
    // 認証チェック
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const userDoc = await db.doc(`users/${request.auth.uid}`).get();
    if (!userDoc.exists) {
      throw new HttpsError('permission-denied', 'User not in whitelist');
    }

    const { documentId, useEnhanced = true } = request.data;
    console.log(`detectSplitPoints called: documentId=${documentId}, useEnhanced=${useEnhanced}`);

    if (!documentId) {
      throw new HttpsError('invalid-argument', 'documentId is required');
    }

    // ドキュメント取得
    // ADR-0018 Phase D (#3): 親 + detail/main を transactional paired-read で読み、
    // pageResults は detail 優先(親フォールバック付き)で解決する。
    // 切替しないと Phase E 後に分割候補検出が常に0件になる
    const docRef = db.doc(`documents/${documentId}`);
    const [docSnapshot, detailSnapshot] = await readDocWithDetail(db, docRef);

    if (!docSnapshot.exists) {
      console.log(`Document not found: ${documentId}`);
      throw new HttpsError('not-found', 'Document not found');
    }

    const docData = docSnapshot.data()!;
    const pageResults = resolveSplitPageInputs(detailSnapshot.data(), docData);
    console.log(`pageResults count: ${pageResults.length}`);

    if (pageResults.length === 0) {
      console.log('No pageResults, returning empty');
      return { suggestions: [], segments: [], shouldSplit: false };
    }

    // 強化版分析を使用
    if (useEnhanced) {
      const masters: MasterData = await loadMasterData(db, {
        source: 'pdf',
        functionName: 'detectSplitPoints',
      });

      // ページデータを変換
      const pages: PageOcrData[] = pageResults.map((p) => ({
        pageNumber: p.pageNumber,
        text: p.text,
        detectedDocumentType: p.detectedDocumentType,
        detectedCustomerName: p.detectedCustomerName,
        detectedOfficeName: p.detectedOfficeName,
      }));

      // 強化版分析を実行
      console.log('Running analyzePdf...');
      const analysisResult = analyzePdf(pages, masters);
      console.log(`Analysis result: suggestions=${analysisResult.splitSuggestions.length}, segments=${analysisResult.segments.length}, shouldSplit=${analysisResult.shouldSplit}`);
      const summary = generateSplitSummary(analysisResult);

      // Firestoreに保存（undefinedを除外）
      console.log('Saving to Firestore...');
      await docRef.update({
        splitSuggestions: analysisResult.splitSuggestions,
        splitSegments: analysisResult.segments.map((seg) => ({
          id: seg.id,
          startPage: seg.startPage,
          endPage: seg.endPage,
          documentType: seg.documentType,
          customerName: seg.customerName,
          customerId: seg.customerId,
          officeName: seg.officeName,
          suggestedFileName: seg.suggestedFileName.fileName,
          confidence: seg.confidence,
        })),
        shouldSplit: analysisResult.shouldSplit,
        splitReason: analysisResult.splitReason || null,
      });
      console.log('Firestore update complete, returning result');

      return {
        suggestions: analysisResult.splitSuggestions,
        segments: analysisResult.segments,
        shouldSplit: analysisResult.shouldSplit,
        splitReason: analysisResult.splitReason || null,
        summary,
      };
    }

    // レガシー分析（後方互換性のため維持）
    const suggestions: Array<{
      afterPageNumber: number;
      reason: string;
      confidence: number;
      newDocumentType: string | null;
      newCustomerName: string | null;
    }> = [];

    let prevCustomer = pageResults[0]?.detectedCustomerName;
    let prevDocType = pageResults[0]?.detectedDocumentType;

    for (let i = 1; i < pageResults.length; i++) {
      const current = pageResults[i]!;
      const customerChanged =
        current.detectedCustomerName &&
        current.detectedCustomerName !== prevCustomer;
      const docTypeChanged =
        current.detectedDocumentType &&
        current.detectedDocumentType !== prevDocType;

      if (customerChanged) {
        suggestions.push({
          afterPageNumber: i,
          reason: 'new_customer',
          confidence: current.matchScore,
          newDocumentType: current.detectedDocumentType,
          newCustomerName: current.detectedCustomerName,
        });
      } else if (docTypeChanged) {
        suggestions.push({
          afterPageNumber: i,
          reason: 'new_document_type',
          confidence: current.matchScore,
          newDocumentType: current.detectedDocumentType,
          newCustomerName: current.detectedCustomerName,
        });
      }

      if (current.detectedCustomerName) {
        prevCustomer = current.detectedCustomerName;
      }
      if (current.detectedDocumentType) {
        prevDocType = current.detectedDocumentType;
      }
    }

    await docRef.update({ splitSuggestions: suggestions });

    return { suggestions, segments: [], shouldSplit: suggestions.length > 0 };
  }
);

// ============================================
// PDF分割実行
// ============================================

interface SplitSegment {
  startPage: number;
  endPage: number;
  documentType: string;
  customerName: string;
  customerId?: string | null;
  officeName: string;
  officeId?: string | null;
  /** 顧客候補リスト */
  customerCandidates?: Array<{
    id: string;
    name: string;
    score: number;
    isDuplicate: boolean;
    careManagerName?: string;
  }>;
  /** 事業所候補リスト */
  officeCandidates?: Array<{
    id: string;
    name: string;
    score: number;
    isDuplicate: boolean;
  }>;
  /** 手動選択が必要か（顧客） */
  needsManualCustomerSelection?: boolean;
  /** 手動選択が必要か（事業所） */
  needsManualOfficeSelection?: boolean;
  /** 同姓同名の顧客か */
  isDuplicateCustomer?: boolean;
  /** 担当ケアマネ名 */
  careManagerName?: string | null;
}

interface SplitRequest {
  documentId: string;
  splitPoints: number[]; // 分割位置（ページ番号の配列）
  segments: SplitSegment[];
}

/**
 * PDFを分割して新しいドキュメントを作成
 */
// ============================================
// splitPdf 内部: drift 時に cleanup する Storage file の最小 shape
// (Codex Medium 3: ifGenerationMatch precondition で誤削除防止)
// ============================================

interface CleanableStorageFile {
  delete(options?: { ifGenerationMatch?: string | number }): Promise<unknown>;
}

interface AccumulatedSegment {
  newDocRef: FirebaseFirestore.DocumentReference;
  newFile: CleanableStorageFile;
  newFilePath: string;
  fileName: string;
  derivedGeneration: string;
  payload: Record<string, unknown>;
}

async function cleanupAccumulatedStorageFiles(
  accumulated: AccumulatedSegment[],
  stage: string,
  parentDocumentId: string
): Promise<void> {
  if (accumulated.length === 0) return;
  // derivedGeneration が空 = `newFile.save()` 直後・`getMetadata()` 前に失敗した entry。
  // 自分が生成した newDocRef 配下の新規 path のため、他 process が割込む可能性はない
  // (newDocRef.id は fresh random で外部公開前)。precondition なしの delete を使う。
  const results = await Promise.allSettled(
    accumulated.map((item) =>
      item.newFile.delete(
        item.derivedGeneration
          ? { ifGenerationMatch: item.derivedGeneration }
          : undefined
      )
    )
  );
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length > 0) {
    console.error('splitPdf: failed to cleanup some accumulated Storage files', {
      operation: 'splitPdf',
      stage,
      parentDocumentId,
      totalCount: accumulated.length,
      failedCount: failed.length,
      failedPaths: accumulated
        .map((item, idx) =>
          results[idx].status === 'rejected' ? item.newFilePath : null
        )
        .filter((p): p is string => p !== null),
      manualCleanupHint: 'gsutil rm gs://<bucket>/<path> for each failed path',
    });
  }
}

export const splitPdf = onCall(
  {
    region: 'asia-northeast1',
    memory: '1GiB',
    timeoutSeconds: 300,
  },
  async (request) => {
    // 認証チェック
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const userDoc = await db.doc(`users/${request.auth.uid}`).get();
    if (!userDoc.exists) {
      throw new HttpsError('permission-denied', 'User not in whitelist');
    }

    const { documentId, splitPoints, segments } = request.data as SplitRequest;

    if (!documentId || !splitPoints || !segments) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }
    // Codex Low 2: segments の page 範囲を runtime 検証 (UI を信用しすぎない)
    if (!Array.isArray(segments) || segments.length === 0) {
      throw new HttpsError('invalid-argument', 'segments must be a non-empty array');
    }
    // ADR-0018 (Issue #547) Phase B: 子ドキュメントごとに本体set + detail/main setの
    // 2書込になったため、batch内訳は child(本体+detail/main) set × 2N + parent update × 1
    // = 2N+1 ≤ 500 → N ≤ 249 が安全な上限 (Firestore batch.commit() は 500 writes の hard limit)。
    // 実測(kanameone, PR #568): splitInto配列の実データ最大長は17件で249に十分な余裕あり。
    if (segments.length > 249) {
      throw new HttpsError(
        'invalid-argument',
        `segments.length=${segments.length} exceeds Firestore batch write limit (max 249 to allow child + detail/main set per segment + 1 parent update in same commit)`
      );
    }
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (
        typeof seg.startPage !== 'number' ||
        typeof seg.endPage !== 'number' ||
        !Number.isInteger(seg.startPage) ||
        !Number.isInteger(seg.endPage) ||
        seg.startPage < 1 ||
        seg.endPage < seg.startPage
      ) {
        throw new HttpsError(
          'invalid-argument',
          `segments[${i}] has invalid page range: start=${seg.startPage}, end=${seg.endPage}`
        );
      }
    }

    // 元ドキュメント取得
    // ADR-0018 Phase D (#2): 親 + detail/main を transactional paired-read で読む。
    // splitPdf は読んだ pageResults から子doc を実際に生成・commit するため、
    // 「新しい親 + 古い detail」の裂けた組合せ読みは stale 子doc の固定化に直結する
    // (防止根拠は readDocWithDetail の doc comment 参照)
    const docRef = db.doc(`documents/${documentId}`);
    const [docSnapshot, detailSnapshot] = await readDocWithDetail(db, docRef);

    if (!docSnapshot.exists) {
      throw new HttpsError('not-found', 'Document not found');
    }

    const docData = docSnapshot.data()!;
    // 分割元の pageResults は detail 優先で解決し、以降の全用途(セグメント抽出/子doc用
    // ocrResult 生成)で同一ソースを使う
    const sourcePageResults = resolveSplitPageInputs(detailSnapshot.data(), docData);
    const fileUrl = docData.fileUrl as string;

    // Codex Medium 1: gs:// URI parser + bucket mismatch を failed-precondition で abort
    const bucket = storage.bucket();
    let sourceObjectName: string;
    try {
      const parsed = parseGcsUri(fileUrl, bucket.name);
      sourceObjectName = parsed.objectName;
    } catch (err) {
      throw new HttpsError(
        'failed-precondition',
        `Source fileUrl is not a valid gs:// URI in bucket "${bucket.name}": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
    const file = bucket.file(sourceObjectName);

    const MAX_RETRIES = 2; // 合計 3 attempts
    let lastDriftError: SourceDriftError | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // T1: 3-stage metadata-download-metadata snapshot
      // (Codex High 1/H2: download 中の上書きを generation + metageneration 両方で検出)
      // 純粋 orchestration は splitSnapshot.ts に抽出済 (Codex M4 対応の unit test 可能化)
      let buffer: Buffer;
      let sourceSnapshot: {
        generation: string;
        metageneration: string;
        sha256: string;
      };
      try {
        const snap = await acquireSourceSnapshot(file);
        buffer = snap.buffer;
        sourceSnapshot = {
          generation: snap.generation,
          metageneration: snap.metageneration,
          sha256: sha256Hex(buffer),
        };
      } catch (err) {
        if (err instanceof SourceDriftError) {
          console.warn('splitPdf: source drift detected during snapshot acquisition', {
            operation: 'splitPdf',
            stage: 'sourceSnapshot',
            attempt,
            parentDocumentId: documentId,
            before: err.before,
            after: err.after,
          });
          lastDriftError = err;
          if (attempt < MAX_RETRIES) {
            await backoffSleep(attempt);
            continue;
          }
          throw new HttpsError(
            'aborted',
            `splitPdf aborted: source concurrent write detected after ${attempt + 1} attempts (${err.message})`
          );
        }
        throw err;
      }

      // PDF を読み込み
      const pdfDoc = await PDFDocument.load(buffer);

      // Evaluator LOW 3 反映: endPage が実 PDF ページ数を超えると pdf-lib copyPages が
      // raw Error を throw し、Cloud Functions INTERNAL エラーで client に伝播してデバッグ
      // 困難になる。invalid-argument として早期 abort し、原因を明示する。
      const totalSourcePages = pdfDoc.getPageCount();
      const outOfRange = segments.find((s) => s.endPage > totalSourcePages);
      if (outOfRange) {
        throw new HttpsError(
          'invalid-argument',
          `segment endPage=${outOfRange.endPage} exceeds source PDF totalPages=${totalSourcePages}`
        );
      }

      // segments を accumulate (Firestore set はまだ実行しない)
      // Codex High 3: Firestore は最後に batch.commit で原子書込、partial state を消す
      const accumulated: AccumulatedSegment[] = [];

      try {
        for (const segment of segments) {
          const {
            startPage,
            endPage,
            documentType,
            customerName,
            customerId,
            officeName,
            officeId,
            customerCandidates,
            officeCandidates,
            // needsManualCustomerSelection, needsManualOfficeSelection は
            // 分割UIで選択済みのため常に false。
            // isDuplicateCustomer, careManagerName は buildSplitDocumentData(segment) で処理。
          } = segment;

          const newPdf = await PDFDocument.create();
          const pageIndices = Array.from(
            { length: endPage - startPage + 1 },
            (_, i) => startPage - 1 + i
          );
          const copiedPages = await newPdf.copyPages(pdfDoc, pageIndices);
          copiedPages.forEach((page) => newPdf.addPage(page));
          const newPdfBytes = await newPdf.save();

          // Issue #432 PR-B: docId namespace 分離で Storage path 衝突を根治
          const newDocRef = db.collection('documents').doc();
          const timestamp = Date.now();
          const fileName = generateFileName({
            customerName,
            documentType,
            timestamp,
            startPage,
            endPage,
          });
          const newFilePath = `processed/${newDocRef.id}/${fileName}`;
          const newFile = bucket.file(newFilePath);

          // Storage save (失敗は callable error として surface)。
          // pdf-lib の Uint8Array を直接渡し、sha256 と共用して Buffer.from 二重 allocation を回避。
          await newFile.save(newPdfBytes, {
            metadata: { contentType: 'application/pdf' },
          });

          // Codex post-impl review Medium 1 反映: save 直後・metadata 取得前に失敗しても
          // cleanup 対象になるよう、partial entry を即 accumulated に登録する。
          // derivedGeneration / payload は後段で fill in。
          const inflightEntry: AccumulatedSegment = {
            newDocRef,
            newFile,
            newFilePath,
            fileName,
            derivedGeneration: '',
            payload: {},
          };
          accumulated.push(inflightEntry);

          // T2: file.save() 直後に derived* を取得 (GCS は object metadata strongly consistent)
          const [derivedMeta] = await newFile.getMetadata();
          const derivedGeneration = String(derivedMeta.generation ?? '');
          const derivedMetageneration = String(derivedMeta.metageneration ?? '');
          if (!derivedGeneration || !derivedMetageneration) {
            throw new HttpsError(
              'internal',
              `Failed to retrieve derived metadata for ${newFilePath} (gen=${derivedGeneration}, meta=${derivedMetageneration})`
            );
          }
          inflightEntry.derivedGeneration = derivedGeneration;
          const derivedSha256 = sha256Hex(newPdfBytes);

          // 分割後のページ結果を抽出 (ADR-0018 Phase D: detail優先で解決済みのソースを使用)
          const segmentPageResults = sourcePageResults.filter(
            (p: SplitPageInput) =>
              p.pageNumber >= startPage && p.pageNumber <= endPage
          );

          // ocrExtraction スナップショット
          const parentOcrExtraction = docData.ocrExtraction;
          const ocrExtraction = parentOcrExtraction
            ? {
                ...parentOcrExtraction,
                splitFrom: {
                  documentId,
                  pages: { start: startPage, end: endPage },
                },
              }
            : {
                version: 'split-legacy',
                extractedAt: admin.firestore.FieldValue.serverTimestamp(),
                customer: {
                  name: customerName,
                  id: customerId || null,
                  candidates: customerCandidates || [],
                },
                office: {
                  name: officeName,
                  id: officeId || null,
                  candidates: officeCandidates || [],
                },
                documentType: { name: documentType },
                splitFrom: {
                  documentId,
                  pages: { start: startPage, end: endPage },
                },
              };

          // displayFileName 生成 (#178 Stage 2 / #182 fallback)
          const displayFileName = generateDisplayFileName({
            documentType,
            customerName,
            officeName,
            fileDate:
              docData.fileDateFormatted ?? timestampToDateString(docData.fileDate),
          });

          // T2-3: provenance を factory で構築 (10 fields を runtime 検証)
          const provenance = createSplitProvenance({
            sourceGeneration: sourceSnapshot.generation,
            sourceMetageneration: sourceSnapshot.metageneration,
            sourceSha256: sourceSnapshot.sha256,
            sourcePath: sourceObjectName,
            sourceBucket: bucket.name,
            derivedObjectPath: newFilePath,
            derivedGeneration,
            derivedMetageneration,
            derivedSha256,
          });

          const splitDocFields = buildSplitDocumentData(segment);
          const payload: Record<string, unknown> = {
            ...(displayFileName ? { displayFileName } : {}),
            id: newDocRef.id,
            processedAt: admin.firestore.FieldValue.serverTimestamp(),
            fileId: newDocRef.id,
            fileName,
            mimeType: 'application/pdf',
            ocrResult: extractOcrResultForPages(
              sourcePageResults,
              startPage,
              endPage
            ),
            // セグメントから構築したフィールド (careManager/careManagerKey 含む)
            ...splitDocFields,
            // Issue #526レビュー反映 (Codex/code-reviewer/silent-failure-hunter 3件独立指摘):
            // customerConfirmed/officeConfirmedがfalseの場合、確認者情報(confirmedBy/At)を
            // 無条件で書き込むと「未確認なのに確認者がいる」矛盾したデータになる。
            // 既存のocrProcessor.ts通常OCRパス(officeConfirmedBy: null等)と同じ規約に揃える。
            confirmedBy: splitDocFields.customerConfirmed ? (request.auth?.uid || null) : null,
            confirmedAt: splitDocFields.customerConfirmed
              ? admin.firestore.FieldValue.serverTimestamp()
              : null,
            officeConfirmedBy: splitDocFields.officeConfirmed ? (request.auth?.uid || null) : null,
            officeConfirmedAt: splitDocFields.officeConfirmed
              ? admin.firestore.FieldValue.serverTimestamp()
              : null,
            ocrExtraction,
            pageResults: segmentPageResults.map(
              (p: SplitPageInput, index: number) => ({
                ...p,
                pageNumber: index + 1,
                originalPageNumber: p.pageNumber,
              })
            ),
            fileUrl: `gs://${bucket.name}/${newFilePath}`,
            fileDate: docData.fileDate,
            totalPages: endPage - startPage + 1,
            targetPageNumber: 1,
            // Issue #526 PR4: 子ドキュメントをOCR再処理パイプライン(processOCRポーリング)に
            // 乗せるため'pending'で生成する(旧実装は'processed'固定でパイプライン未到達だった)。
            // parentDocumentId(直下)がPR3のpageResults再利用条件を満たすため、フルOCR再実行
            // ではなくconfirmed保護マージのみが実行される想定(processedAtは既に設定済みのため
            // 既存のprocessOCRクエリに追加配線なしで乗る)。
            status: 'pending',
            parentDocumentId: documentId,
            splitFromPages: { start: startPage, end: endPage },
            provenance,
          };

          // payload を完成させ inflightEntry に書込む (push 済なので別に push しない)
          inflightEntry.payload = payload;
        }
      } catch (err) {
        // segment 内 PDF 生成 / Storage save / derived metadata / provenance factory 失敗。
        // 既に accumulate された Storage files を best-effort cleanup する。
        console.error('splitPdf: segment processing failed, cleaning up accumulated', {
          operation: 'splitPdf',
          stage: 'segmentsLoop',
          attempt,
          parentDocumentId: documentId,
          accumulatedCount: accumulated.length,
          totalSegments: segments.length,
          error: err instanceof Error ? err.message : String(err),
        });
        await cleanupAccumulatedStorageFiles(accumulated, 'segmentsLoop', documentId);
        // /review-pr silent-failure-hunter C2 反映: HttpsError 以外を rethrow すると
        // Firebase Functions v2 が INTERNAL に潰すため明示的にラップする。
        // pdf-lib parse error / GCS getMetadata 失敗 / provenance validation 等を
        // 全て internal でラップし、原因 message を client へ伝える。
        if (err instanceof HttpsError) throw err;
        throw new HttpsError(
          'internal',
          `splitPdf segment processing failed at attempt ${attempt}: ${
            err instanceof Error ? err.message : String(err)
          }`,
          {
            stage: 'segmentsLoop',
            parentDocumentId: documentId,
            accumulatedCount: accumulated.length,
          }
        );
      }

      // T3: Final drift check (Codex High 1/H2: generation + metageneration 両方比較)
      try {
        const [finalMeta] = await file.getMetadata();
        verifyFinalDrift(
          {
            generation: sourceSnapshot.generation,
            metageneration: sourceSnapshot.metageneration,
          },
          finalMeta
        );
      } catch (err) {
        if (err instanceof SourceDriftError) {
          console.warn('splitPdf: source drift detected at final check', {
            operation: 'splitPdf',
            stage: 'finalDrift',
            attempt,
            parentDocumentId: documentId,
            before: err.before,
            after: err.after,
            accumulatedCount: accumulated.length,
          });
          await cleanupAccumulatedStorageFiles(
            accumulated,
            'finalDrift',
            documentId
          );
          lastDriftError = err;
          if (attempt < MAX_RETRIES) {
            await backoffSleep(attempt);
            continue;
          }
          throw new HttpsError(
            'aborted',
            `splitPdf aborted: source concurrent write detected after ${attempt + 1} attempts (${err.message})`
          );
        }
        // /review-pr silent-failure-hunter I-6: verifyFinalDrift の "Missing generation"
        // 系 raw Error が INTERNAL に潰れないよう明示ラップ
        if (err instanceof HttpsError) throw err;
        throw new HttpsError(
          'internal',
          `splitPdf final drift check failed at attempt ${attempt}: ${
            err instanceof Error ? err.message : String(err)
          }`,
          { stage: 'finalDrift', parentDocumentId: documentId }
        );
      }

      // T4: Atomic Firestore batch write (Codex High 3 + post-impl High: child + parent
      // を同一 batch にまとめて 1 commit にし、「子作成済み・親未 split」状態を構造的に排除)
      const createdDocIds = accumulated.map((item) => item.newDocRef.id);
      const batch = db.batch();
      for (const item of accumulated) {
        batch.set(item.newDocRef, item.payload);
        // ADR-0018 (Issue #547) Phase B: 子docのocrResult/pageResultsをdetail/mainへ
        // 同一batchでdual-write (MUST: 原子性)。本体からの削除はPhase E。
        batch.set(item.newDocRef.collection('detail').doc('main'), {
          ocrResult: item.payload.ocrResult,
          pageResults: item.payload.pageResults,
        });
      }
      // 元ドキュメントのステータスを更新 (分割済みフラグ) — child set と同一 batch
      batch.update(docRef, {
        splitInto: createdDocIds,
        status: 'split',
        isSplitSource: true,
      });
      try {
        await batch.commit();
      } catch (firestoreErr) {
        console.error(
          'splitPdf: Firestore batch commit failed; cleaning up Storage orphans',
          {
            operation: 'splitPdf',
            stage: 'firestoreBatch',
            attempt,
            parentDocumentId: documentId,
            accumulatedCount: accumulated.length,
            error:
              firestoreErr instanceof Error
                ? firestoreErr.message
                : String(firestoreErr),
          }
        );
        await cleanupAccumulatedStorageFiles(
          accumulated,
          'firestoreBatch',
          documentId
        );
        // /review-pr silent-failure-hunter C1: Firebase Functions v2 は非 HttpsError を
        // INTERNAL (message: "INTERNAL") に潰す。明示的に internal でラップして
        // 原因 message + structured details を client / 監視ログへ surface する。
        throw new HttpsError(
          'internal',
          `splitPdf Firestore batch commit failed (parent=${documentId}, segments=${accumulated.length}): ${
            firestoreErr instanceof Error
              ? firestoreErr.message
              : String(firestoreErr)
          }`,
          {
            stage: 'firestoreBatch',
            parentDocumentId: documentId,
            accumulatedCount: accumulated.length,
          }
        );
      }

      return {
        success: true,
        createdDocuments: createdDocIds,
      };
    }

    // 通常は到達不能 (retry loop 内 throw で 100% return / throw する)。
    // 到達したら retry loop の制御フローが壊れている = bug。
    // /review-pr silent-failure-hunter I-4 反映: 'aborted' は drift retry exhausted を意味し、
    // この時点では「retry loop が return せず throw もせず抜けた」状態のため 'internal' が正確。
    console.error('splitPdf: retry loop exited without explicit throw/return (logic bug)', {
      operation: 'splitPdf',
      stage: 'retryLoopExit',
      parentDocumentId: documentId,
      lastDriftError: lastDriftError?.message ?? null,
    });
    throw new HttpsError(
      'internal',
      `splitPdf: retry loop exited unexpectedly (parent=${documentId}, lastDrift=${
        lastDriftError?.message ?? 'none'
      })`,
      { stage: 'retryLoopExit', parentDocumentId: documentId }
    );
  }
);

// ============================================
// PDF回転
// ============================================

/**
 * rotation 関連 helper (RotationDegrees / normalizeRotation / normalizeRotationOrFallback / mergeRotations) は
 * test 環境で Firebase admin 初期化なしで import できるよう `rotationMerge.ts` に分離。
 * pr-test-analyzer Critical 反映 (mergeRotations の unit test 追加のための切出)。
 */
// import は file 冒頭の import block で実施: import { mergeRotations } from './rotationMerge';

/**
 * `e instanceof Error ? e.message : String(e)` の 3 行 boilerplate を 1 行で書くための helper。
 * M1 (quality): rotatePdfPages の 5 連 try-catch error wrap を簡素化。
 */
function unwrapErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface RotateRequest {
  documentId: string;
  rotations: Array<{
    pageNumber: number;
    degrees: 90 | 180 | 270;
  }>;
}

/**
 * PDFページを回転 (Issue #445 PR-D3: ADR-0016 MUST 3 準拠)
 *
 * 設計原則:
 * - in-place 編集禁止: rotation 結果は必ず新 canonical path `processed/{docId}/rotations/{rotationId}.pdf` に書込
 * - source 5 fields + createdAt (audit 1) は base provenance から完全保持、derived 4 fields のみ更新
 * - 旧 object は callable 内で削除しない (削除は番号認可付き destructive migration / deleteDocument 経路のみ)
 * - orphan rollback: Storage save 成功後の任意の失敗で新 path object を delete (自己生成・未 commit の例外)
 * - 入力 validation: 空配列 / 同ページ重複 / pageNumber 範囲外を early abort
 * - legacy provenance 無し doc は failed-precondition で reject (PR-D4 backfill 完了後に再 rotation 可)
 * - concurrent write 検出: Firestore transaction で optimistic locking (開始時 updateTime 比較)
 */
export const rotatePdfPages = onCall(
  {
    region: 'asia-northeast1',
    memory: '512MiB',
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const userDoc = await db.doc(`users/${request.auth.uid}`).get();
    if (!userDoc.exists) {
      throw new HttpsError('permission-denied', 'User not in whitelist');
    }

    const { documentId, rotations } = request.data as RotateRequest;
    console.log('rotatePdfPages called:', { documentId, rotations });

    // AC13: 入力 validation
    if (!documentId || !rotations) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }
    if (!Array.isArray(rotations) || rotations.length === 0) {
      throw new HttpsError('invalid-argument', 'rotations must be a non-empty array');
    }
    const pageNumbers = rotations.map((r) => r.pageNumber);
    if (new Set(pageNumbers).size !== pageNumbers.length) {
      throw new HttpsError('invalid-argument', 'rotations contain duplicate pageNumber entries');
    }
    // PDF download 前に input shape を validate (bandwidth 節約 + early failure)。
    for (const r of rotations) {
      if (!Number.isInteger(r.pageNumber) || r.pageNumber < 1) {
        throw new HttpsError(
          'invalid-argument',
          `rotations[].pageNumber must be a positive integer, got ${r.pageNumber}`
        );
      }
      if (r.degrees !== 90 && r.degrees !== 180 && r.degrees !== 270) {
        throw new HttpsError(
          'invalid-argument',
          `rotations[].degrees must be one of 90 / 180 / 270, got ${r.degrees}`
        );
      }
    }

    // Step 1: 開始時 snapshot 取得 + legacy provenance guard
    const docRef = db.doc(`documents/${documentId}`);
    const startSnapshot = await docRef.get();
    if (!startSnapshot.exists) {
      throw new HttpsError('not-found', 'Document not found');
    }
    const startData = startSnapshot.data()!;

    // AC12: legacy provenance 無し doc は reject (PR-D4 backfill 完了後に再 rotation 可能)
    const baseProvenance = startData.provenance as DocumentProvenance | undefined;
    if (!baseProvenance) {
      console.warn('rotatePdfPages: legacy doc without provenance, rejecting', {
        operation: 'rotatePdfPages',
        stage: 'provenance_check',
        documentId,
      });
      throw new HttpsError(
        'failed-precondition',
        'Document is missing provenance fields; backfill required (Issue #445 PR-D4) before rotation'
      );
    }

    // PR-D4 BF12/BF13 (ADR-0016 MUST 3 拡張): backfilled doc は confidence 'derived-bytes-verified'
    // のみ rotate 許可。malformed (null 含む) や低信頼度 confidence は failed-precondition で reject。
    // 壊れた legacy bytes を正規 rotation 経路で昇格させる経路を構造的に閉鎖する (Codex 7th Critical 6)。
    const backfillRejection = shouldRejectRotateForBackfill(startData.provenanceBackfill);
    if (backfillRejection != null) {
      console.warn('rotatePdfPages: backfill confidence guard rejected', {
        operation: 'rotatePdfPages',
        stage: 'backfill_confidence_check',
        documentId,
        rejection: backfillRejection,
      });
      throw new HttpsError('failed-precondition', backfillRejection);
    }
    const startUpdateTime = startSnapshot.updateTime;
    const fileUrl = startData.fileUrl as string;
    if (!fileUrl) {
      throw new HttpsError('failed-precondition', 'Document has no fileUrl');
    }

    // Step 2: 親 PDF identity 整合性検証 + download
    // Codex 2nd MEDIUM: fileUrl と baseProvenance.derivedObjectPath の一致検証で identity drift を防ぐ。
    // Issue #432 root cause 再発リスク (stale fileUrl で別 object を rotate しつつ provenance source を保持 →
    // silent provenance corruption) を構造的に排除。
    const bucket = storage.bucket();
    let filePath: string;
    try {
      const parsed = parseGcsUri(fileUrl, bucket.name);
      filePath = parsed.objectName;
    } catch (parseErr) {
      throw new HttpsError(
        'failed-precondition',
        `Source fileUrl is not a valid gs:// URI in bucket "${bucket.name}": ${unwrapErrorMessage(parseErr)}`
      );
    }
    if (filePath !== baseProvenance.derivedObjectPath) {
      throw new HttpsError(
        'failed-precondition',
        `fileUrl path "${filePath}" does not match provenance.derivedObjectPath "${baseProvenance.derivedObjectPath}"; identity drift detected (Issue #432 root cause prevention)`
      );
    }
    const file = bucket.file(filePath);
    let buffer: Buffer;
    try {
      [buffer] = await file.download();
    } catch (downloadErr) {
      throw new HttpsError('internal', `PDF download failed: ${unwrapErrorMessage(downloadErr)}`);
    }
    console.log('Downloaded PDF, size:', buffer.length);

    // Codex 2nd MEDIUM (続き): download 後 buffer の sha256 を provenance.derivedSha256 と照合。
    // 不一致 = identity drift (parseGcsUri は path だけ、ここで bytes identity も検証)。
    const sourceSha256 = sha256Hex(buffer);
    if (sourceSha256 !== baseProvenance.derivedSha256.toLowerCase()) {
      throw new HttpsError(
        'failed-precondition',
        `Source PDF sha256 "${sourceSha256}" does not match provenance.derivedSha256 "${baseProvenance.derivedSha256}"; bytes identity drift detected (Issue #432 root cause prevention)`
      );
    }

    // Step 3: PDF load + rotation (page 範囲 validation 込)
    let newPdfBytes: Buffer;
    try {
      const pdfDoc = await PDFDocument.load(buffer);
      const pageCount = pdfDoc.getPageCount();
      for (const { pageNumber, degrees: deg } of rotations) {
        if (pageNumber < 1 || pageNumber > pageCount) {
          throw new HttpsError(
            'invalid-argument',
            `pageNumber ${pageNumber} out of range (PDF has ${pageCount} pages)`
          );
        }
        const page = pdfDoc.getPage(pageNumber - 1);
        const currentRotation = page.getRotation().angle;
        const newRotation = (currentRotation + deg) % 360;
        page.setRotation(degrees(newRotation));
      }
      newPdfBytes = Buffer.from(await pdfDoc.save());
    } catch (rotateErr) {
      if (rotateErr instanceof HttpsError) throw rotateErr;
      throw new HttpsError('internal', `PDF rotation failed: ${unwrapErrorMessage(rotateErr)}`);
    }
    console.log('PDF rotated in memory, size:', newPdfBytes.length);

    // Step 4: 新 canonical path に save (ADR-0016 MUST 3 / AC4)
    const rotationId = randomUUID();
    const newObjectPath = `processed/${documentId}/rotations/${rotationId}.pdf`;
    const newFile = bucket.file(newObjectPath);
    try {
      await newFile.save(newPdfBytes, {
        metadata: {
          contentType: 'application/pdf',
          cacheControl: 'no-cache, no-store, must-revalidate',
        },
        // Codex HIGH 3: ifGenerationMatch: 0 = "object 不存在" precondition (UUID 衝突防止ダブルセーフティ)
        preconditionOpts: { ifGenerationMatch: 0 },
      });
    } catch (saveErr) {
      throw new HttpsError('internal', `Storage save failed: ${unwrapErrorMessage(saveErr)}`);
    }
    console.log('PDF uploaded to new canonical path:', newObjectPath);

    // Step 5: 新 object metadata + derivedSha256
    let derivedGeneration = '';
    let derivedMetageneration = '';
    try {
      const [metadata] = await newFile.getMetadata();
      derivedGeneration = String(metadata.generation ?? '');
      derivedMetageneration = String(metadata.metageneration ?? '');
      if (!derivedGeneration || !derivedMetageneration) {
        throw new Error(
          `metadata.generation=${derivedGeneration}, metageneration=${derivedMetageneration}`
        );
      }
    } catch (metaErr) {
      await rollbackOrphanRotation(newFile, newObjectPath, documentId, derivedGeneration);
      throw new HttpsError('internal', `getMetadata failed: ${unwrapErrorMessage(metaErr)}`);
    }
    const derivedSha256 = sha256Hex(newPdfBytes);

    // Step 6: rotation provenance 構築 (source 5 + createdAt 不変、derived 4 更新)
    let newProvenance: DocumentProvenance;
    try {
      newProvenance = createRotationProvenance({
        base: baseProvenance,
        newDerived: {
          derivedObjectPath: newObjectPath,
          derivedGeneration,
          derivedMetageneration,
          derivedSha256,
        },
      });
    } catch (provErr) {
      await rollbackOrphanRotation(newFile, newObjectPath, documentId, derivedGeneration);
      throw new HttpsError('internal', `provenance build failed: ${unwrapErrorMessage(provErr)}`);
    }

    // Step 7: Firestore optimistic locking via lastUpdateTime precondition (AC5 / AC10)
    // EFF-M2 修正: runTransaction を撤廃し docRef.update(payload, { lastUpdateTime }) 単発に変更。
    // 利点: (a) tx callback 内 throw が SDK 自動 retry を triggering する懸念を排除
    //       (b) 同一 doc を 2 回 get する無駄を削減 (pre-tx get の startUpdateTime を直接 precondition に使用)
    //       (c) Firestore backend 側で TOCTOU race-free な atomic precondition check + update
    // precondition mismatch は backend が FAILED_PRECONDITION code で reject、それを HttpsError('aborted') に wrap
    const newFileUrl = `gs://${bucket.name}/${newObjectPath}`;
    const existingRotations =
      (startData.pageRotations as Array<{ pageNumber: number; rotation: number }> | undefined) || [];
    const updatedRotations = mergeRotations(documentId, existingRotations, rotations);

    try {
      if (!startUpdateTime) {
        throw new HttpsError(
          'failed-precondition',
          'Document has no updateTime; cannot enforce optimistic locking'
        );
      }
      await docRef.update(
        {
          fileUrl: newFileUrl,
          pageRotations: updatedRotations,
          rotatedAt: admin.firestore.FieldValue.serverTimestamp(),
          provenance: newProvenance,
        },
        { lastUpdateTime: startUpdateTime }
      );
    } catch (commitErr) {
      const rollbackResult = await rollbackOrphanRotation(
        newFile,
        newObjectPath,
        documentId,
        derivedGeneration
      );
      // silent-failure-hunter CRITICAL 2 反映: rollback 失敗時は HttpsError details に flag を含め、
      // client/Sentry 側で「Firestore 失敗 + Storage orphan 残存」の複合状態を可視化。
      const rollbackDetails =
        rollbackResult.ok === false
          ? { rollbackFailed: true, orphanObjectPath: newObjectPath }
          : undefined;
      if (commitErr instanceof HttpsError) {
        if (rollbackDetails) {
          throw new HttpsError(commitErr.code, commitErr.message, rollbackDetails);
        }
        throw commitErr;
      }
      // Firestore precondition mismatch (NOT_FOUND / FAILED_PRECONDITION 等) を concurrent write として扱う。
      // Evaluator CRITICAL Q1: Firestore admin SDK の Error.code は @grpc/grpc-js 内部実装で
      // 公式 API 約束ではない (SDK バージョンアップで number → string 変動リスクあり)。
      // 堅牢化のため 3 系統 OR 判定: (a) gRPC 数値 code (b) Cloud Functions 文字列 code (c) error.message string fallback
      const errCode =
        commitErr instanceof Error && 'code' in commitErr
          ? (commitErr as { code: number | string }).code
          : undefined;
      const errMessage = unwrapErrorMessage(commitErr);
      const isPreconditionFailure =
        // (a) gRPC 数値 code
        errCode === 9 || // FAILED_PRECONDITION
        errCode === 5 || // NOT_FOUND
        // (b) Cloud Functions 文字列 code
        errCode === 'failed-precondition' ||
        errCode === 'not-found' ||
        // (c) error.message string fallback (SDK 型変動への防御)
        /FAILED_PRECONDITION|NOT_FOUND|precondition|no document to update/i.test(errMessage);
      if (isPreconditionFailure) {
        throw new HttpsError(
          'aborted',
          `Concurrent write detected during rotation (document updateTime drift): ${errMessage}`,
          rollbackDetails
        );
      }
      throw new HttpsError(
        'internal',
        `Firestore commit failed: ${errMessage}`,
        rollbackDetails
      );
    }
    console.log('Firestore updated atomically with new provenance');

    return { success: true };
  }
);

/**
 * Rotation で自己生成した新 path object を rollback delete する。
 *
 * ADR-0016 MUST 3 「callable 内での旧 path 削除を行わない」の **例外**:
 * 本関数は callable 内で生成し未 commit のため他 doc が参照していない
 * orphan を対象とする (rotation の自己責任範囲)。
 *
 * 戻り値:
 *   - { ok: true }            : delete 成功
 *   - { ok: false, error }    : delete 失敗 (warn log 出力済)
 *
 * silent-failure-hunter CRITICAL 2 反映: rollback 失敗を caller に通知して
 * HttpsError details に rollbackFailed flag を含められるようにする。
 * delete 失敗時の error は HttpsError として throw せず、caller の元エラーを保持する。
 */
type RollbackResult = { ok: true } | { ok: false; error: string };

async function rollbackOrphanRotation(
  newFile: CleanableStorageFile,
  newObjectPath: string,
  documentId: string,
  derivedGeneration: string
): Promise<RollbackResult> {
  try {
    await newFile.delete(
      derivedGeneration ? { ifGenerationMatch: derivedGeneration } : undefined
    );
    console.log('rotatePdfPages: rolled back orphan rotation object', {
      operation: 'rotatePdfPages',
      stage: 'orphan_rollback',
      documentId,
      newObjectPath,
    });
    return { ok: true };
  } catch (deleteErr) {
    const errMsg = deleteErr instanceof Error ? deleteErr.message : String(deleteErr);
    console.warn(
      'rotatePdfPages: failed to rollback orphan rotation object (manual cleanup hint)',
      {
        operation: 'rotatePdfPages',
        stage: 'orphan_rollback',
        documentId,
        newObjectPath,
        manualCleanupHint: `gsutil rm gs://<bucket>/${newObjectPath}`,
        error: errMsg,
      }
    );
    return { ok: false, error: errMsg };
  }
}

// `mergeRotations` は `./rotationMerge` から import 済 (Firebase admin 初期化なしで test import 可能化)

// ============================================
// ヘルパー関数
// ============================================

/**
 * 表示用ファイル名を生成する。
 *
 * Issue #432 PR-B 以降、衝突回避の責務は持たない (Storage path は呼び出し側で
 * `processed/{docId}/{fileName}` 形式に namespace 化することで一意性を保証)。
 *
 * @param timestamp 表示用 date 部分の生成にのみ使用 (`{YYYYMMDD}` プレフィックス)。
 *   Issue #432 後続 PR (PR-D 候補) で caller 修正を経て削除予定。
 */
function generateFileName(params: {
  customerName: string;
  documentType: string;
  /** @deprecated Issue #432 後続 PR で削除予定。表示用 date 部分の生成にのみ使用。 */
  timestamp: number;
  startPage: number;
  endPage: number;
}): string {
  const { customerName, documentType, timestamp, startPage, endPage } = params;
  const date = new Date(timestamp);
  const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  const sanitizedCustomer = sanitizeFilenameForStorage(customerName || '不明顧客');
  const sanitizedDocType = sanitizeFilenameForStorage(documentType || '不明文書');
  const pageRange = startPage === endPage ? `p${startPage}` : `p${startPage}-${endPage}`;

  return `${dateStr}_${sanitizedCustomer}_${sanitizedDocType}_${pageRange}.pdf`;
}

function extractOcrResultForPages(
  pageResults: SplitPageInput[],
  startPage: number,
  endPage: number
): string {
  return pageResults
    .filter((p) => p.pageNumber >= startPage && p.pageNumber <= endPage)
    .map((p) => `--- Page ${p.pageNumber} ---\n${p.text}`)
    .join('\n\n');
}
