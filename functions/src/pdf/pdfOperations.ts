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
import * as crypto from 'crypto';
import { PDFDocument, degrees } from 'pdf-lib';
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
import { canSafelyDeleteStorageFile } from '../storage/storageDeletionGuard';
import { createSplitProvenance } from './provenance';
import {
  SourceDriftError,
  acquireSourceSnapshot,
  backoffSleep,
  parseGcsUri,
  verifyFinalDrift,
  verifySnapshotConsistency,
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
    const docRef = db.doc(`documents/${documentId}`);
    const docSnapshot = await docRef.get();

    if (!docSnapshot.exists) {
      console.log(`Document not found: ${documentId}`);
      throw new HttpsError('not-found', 'Document not found');
    }

    const docData = docSnapshot.data()!;
    const pageResults: SplitPageInput[] = docData.pageResults || [];
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
  const results = await Promise.allSettled(
    accumulated.map((item) =>
      item.newFile.delete({ ifGenerationMatch: item.derivedGeneration })
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
    const docRef = db.doc(`documents/${documentId}`);
    const docSnapshot = await docRef.get();

    if (!docSnapshot.exists) {
      throw new HttpsError('not-found', 'Document not found');
    }

    const docData = docSnapshot.data()!;
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
        const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
        sourceSnapshot = {
          generation: snap.generation,
          metageneration: snap.metageneration,
          sha256,
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

          // Storage save (失敗は callable error として surface)
          await newFile.save(Buffer.from(newPdfBytes), {
            metadata: { contentType: 'application/pdf' },
          });

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
          const derivedSha256 = crypto
            .createHash('sha256')
            .update(Buffer.from(newPdfBytes))
            .digest('hex');

          // 分割後のページ結果を抽出
          const segmentPageResults = (docData.pageResults || []).filter(
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

          // T4: provenance を factory で構築 (10 fields を runtime 検証)
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
              docData.pageResults || [],
              startPage,
              endPage
            ),
            // セグメントから構築したフィールド (careManager/careManagerKey 含む)
            ...splitDocFields,
            confirmedBy: request.auth?.uid || null,
            confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
            officeConfirmedBy: request.auth?.uid || null,
            officeConfirmedAt: admin.firestore.FieldValue.serverTimestamp(),
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
            status: 'processed',
            parentDocumentId: documentId,
            splitFromPages: { start: startPage, end: endPage },
            provenance,
          };

          accumulated.push({
            newDocRef,
            newFile,
            newFilePath,
            fileName,
            derivedGeneration,
            payload,
          });
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
        throw err;
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
        throw err;
      }

      // T4: Atomic Firestore batch write (Codex High 3: partial state を消す)
      const batch = db.batch();
      for (const item of accumulated) {
        batch.set(item.newDocRef, item.payload);
      }
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
        const wrapped = new Error(
          `splitPdf: Firestore batch commit failed (parent=${documentId}, segments=${accumulated.length})`
        ) as Error & { cause?: unknown };
        wrapped.cause = firestoreErr;
        throw wrapped;
      }

      const createdDocIds = accumulated.map((item) => item.newDocRef.id);

      // 元ドキュメントのステータスを更新 (分割済みフラグ)
      await docRef.update({
        splitInto: createdDocIds,
        status: 'split',
        isSplitSource: true,
      });

      return {
        success: true,
        createdDocuments: createdDocIds,
      };
    }

    // 全 attempts drift で失敗 (上記 throw でほぼ到達しないが安全網)
    throw new HttpsError(
      'aborted',
      `splitPdf aborted: source concurrent write detected (${
        lastDriftError?.message ?? 'unknown drift'
      })`
    );
  }
);

// ============================================
// PDF回転
// ============================================

interface RotateRequest {
  documentId: string;
  rotations: Array<{
    pageNumber: number;
    degrees: 90 | 180 | 270;
  }>;
}

/**
 * PDFページを回転
 */
export const rotatePdfPages = onCall(
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

    const { documentId, rotations } = request.data as RotateRequest;
    console.log('rotatePdfPages called:', { documentId, rotations });

    if (!documentId || !rotations) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    // ドキュメント取得
    const docRef = db.doc(`documents/${documentId}`);
    const docSnapshot = await docRef.get();

    if (!docSnapshot.exists) {
      throw new HttpsError('not-found', 'Document not found');
    }

    const docData = docSnapshot.data()!;
    const fileUrl = docData.fileUrl as string;
    console.log('Processing file:', fileUrl);

    // PDFファイルをダウンロード
    const bucket = storage.bucket();
    const filePath = fileUrl.replace(`gs://${bucket.name}/`, '');
    const file = bucket.file(filePath);
    const [buffer] = await file.download();
    console.log('Downloaded PDF, size:', buffer.length);

    // PDFを読み込み
    const pdfDoc = await PDFDocument.load(buffer);
    console.log('PDF loaded, pages:', pdfDoc.getPageCount());

    // 各ページを回転
    for (const { pageNumber, degrees: deg } of rotations) {
      if (pageNumber < 1 || pageNumber > pdfDoc.getPageCount()) {
        console.error(`Invalid page number: ${pageNumber}, total pages: ${pdfDoc.getPageCount()}`);
        continue;
      }
      const page = pdfDoc.getPage(pageNumber - 1); // 0-indexed
      const currentRotation = page.getRotation().angle;
      const newRotation = (currentRotation + deg) % 360;
      console.log(`Page ${pageNumber}: current rotation ${currentRotation}, adding ${deg}, new rotation ${newRotation}`);
      page.setRotation(degrees(newRotation));
      // 検証
      const afterRotation = page.getRotation().angle;
      console.log(`Page ${pageNumber}: rotation after setRotation: ${afterRotation}`);
    }

    // 保存
    const newPdfBytes = await pdfDoc.save();
    console.log('PDF saved in memory, size:', newPdfBytes.length);

    // 元のファイルサイズを記録
    const originalSize = buffer.length;
    console.log('Original file size:', originalSize, 'New file size:', newPdfBytes.length);

    // CDNキャッシュを完全に回避するため、新しいパスに保存
    const timestamp = Date.now();
    const newFilePath = filePath.replace(/\.pdf$/i, `_r${timestamp}.pdf`);
    const newFile = bucket.file(newFilePath);

    await newFile.save(Buffer.from(newPdfBytes), {
      metadata: {
        contentType: 'application/pdf',
        cacheControl: 'no-cache, no-store, must-revalidate',
      },
    });
    console.log('PDF uploaded to new path:', newFilePath);

    // Issue #432 PR-A safety net: 同 fileUrl 共有 doc 検出時は旧 file delete を skip。
    // safety net query 失敗時は fail-closed (delete しない) で構造化エラーログを残す。
    let canDelete = false;
    let sharingDocCountUpTo2 = 0;
    try {
      const guardResult = await canSafelyDeleteStorageFile(db, fileUrl, documentId);
      canDelete = guardResult.canDelete;
      sharingDocCountUpTo2 = guardResult.sharingDocCountUpTo2;
    } catch (guardErr) {
      console.error('Storage safety-net query failed; skipping delete (fail-closed)', {
        skippedStorageDelete: true,
        skipReason: 'safetyNetQueryFailed',
        operation: 'rotatePdfPages',
        documentId,
        fileUrl,
        error: guardErr instanceof Error ? guardErr.message : String(guardErr),
      });
      canDelete = false;
    }

    if (!canDelete) {
      console.warn('Skipped storage delete: shared fileUrl detected', {
        skippedStorageDelete: true,
        skipReason: 'sharedFileUrl',
        operation: 'rotatePdfPages',
        documentId,
        fileUrl,
        sharingDocCountUpTo2,
      });
    } else {
      // delete 失敗は許容 (旧 file 既に存在しない等のケースあり)。
      // ただし silent failure 回避のため severity warn + 構造化ログで観測可能化。
      try {
        await file.delete();
        console.log('Old file deleted:', filePath);
      } catch (deleteErr) {
        console.warn('Old file delete attempt failed (root cause not classified)', {
          operation: 'rotatePdfPages',
          stage: 'storageDelete',
          documentId,
          fileUrl,
          filePath,
          error: deleteErr instanceof Error ? deleteErr.message : String(deleteErr),
        });
      }
    }

    // 新しいファイルURLを構築
    const newFileUrl = `gs://${bucket.name}/${newFilePath}`;
    console.log('New file URL:', newFileUrl);

    // 回転情報をFirestoreに記録
    const existingRotations = docData.pageRotations || [];
    const updatedRotations = [...existingRotations];

    for (const { pageNumber, degrees: deg } of rotations) {
      const existing = updatedRotations.find(
        (r: { pageNumber: number }) => r.pageNumber === pageNumber
      );
      if (existing) {
        existing.rotation = ((existing.rotation + deg) % 360) as 0 | 90 | 180 | 270;
      } else {
        updatedRotations.push({ pageNumber, rotation: deg as 0 | 90 | 180 | 270 });
      }
    }

    await docRef.update({
      fileUrl: newFileUrl, // 新しいファイルURLに更新
      pageRotations: updatedRotations,
      rotatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log('Firestore updated');

    return { success: true };
  }
);

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
