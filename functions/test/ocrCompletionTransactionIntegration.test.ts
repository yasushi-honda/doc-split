/**
 * applyOcrCompletionTransaction(functions/src/ocr/ocrProcessor.ts) integration テスト
 * (kanameone現場要件「複数顧客FAX複製機能」、GOAL.md AC-b/AC-c、Firestore emulator)
 *
 * OCR(Gemini呼出)・Storageダウンロードを一切含まない最終Firestore書込み専用関数
 * (processDocument()から抽出済み)のため、既にOCR抽出済みの入力を組み立てて直接
 * 呼び出すことで、実プロダクションコードをemulatorのみでend-to-end検証できる。
 * 配線(processDocument()がこの関数を正しい順序・引数で呼ぶこと)は
 * ocrProcessorFaxDuplicationWiringContract.test.tsでソース文字列レベルにlock-in済み。
 *
 * 実行: firebase emulators:exec --only firestore --project ocr-completion-tx-integration-test \
 *         'npm run test:integration'
 */

import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import { cleanupCollections } from './helpers/cleanupEmulator';
import { applyOcrCompletionTransaction, OCR_TX_RETRY_ATTEMPTS } from '../src/ocr/ocrProcessor';
import { OcrRunSupersededError } from '../src/ocr/ocrRunGuard';
import { buildOcrExtractionUpdatePayload } from '../src/ocr/ocrUpdatePayloadBuilder';
import { buildMultiCustomerDetectionFields } from '../../shared/multiCustomerDetection';
import type {
  ArbitratedCustomerExtractionResult,
  ArbitrationProvenance,
  DocumentExtractionResult,
  OfficeExtractionResultWithCandidates,
  DateExtractionResult,
} from '../src/utils/extractors';
import type { RawPageOcrResult } from '../src/ocr/buildPageResult';

const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['documents'];

/**
 * OcrUpdatePayloadInputsはprovenance必須のArbitrated*ExtractionResult型を要求する
 * (ADR-0025 PR2、type-design-analyzer指摘)。本ファイルのFAX複製シナリオは
 * Pass2昇格の有無自体を検証対象にしていないため、既定はexisting(全文ベース採用)にする。
 */
const EXISTING_PROVENANCE: ArbitrationProvenance = { source: 'existing', candidateGrounded: false };

const documentTypeResult: DocumentExtractionResult & { provenance: ArbitrationProvenance } = {
  documentType: '請求書',
  category: null,
  score: 100,
  matchType: 'exact',
  keywords: [],
  provenance: EXISTING_PROVENANCE,
};

const officeResult: OfficeExtractionResultWithCandidates & { provenance: ArbitrationProvenance } = {
  bestMatch: { id: 'office-1', name: 'ケアサポートきらり', score: 100, matchType: 'exact', isDuplicate: false },
  candidates: [{ id: 'office-1', name: 'ケアサポートきらり', score: 100, matchType: 'exact', isDuplicate: false }],
  hasMultipleCandidates: false,
  needsManualSelection: false,
  provenance: EXISTING_PROVENANCE,
};

const dateResult: DateExtractionResult & { provenance: ArbitrationProvenance } = {
  date: new Date('2026-07-01T00:00:00.000Z'),
  formattedDate: '2026-07-01',
  source: 'body',
  pattern: 'test',
  confidence: 90,
  allCandidates: [],
  provenance: EXISTING_PROVENANCE,
};

const pageResults: RawPageOcrResult[] = [
  { text: 'ページ1のOCR結果', truncated: false, pageNumber: 1, inputTokens: 10, outputTokens: 5 },
];

/** exact一致&&非isDuplicateの候補2件(田中太郎/田中花子)を持つcustomerResultを構築する */
function twoExactCandidatesResult(
  needsManualSelection = false,
  provenance: ArbitrationProvenance = EXISTING_PROVENANCE
): ArbitratedCustomerExtractionResult {
  return {
    bestMatch: {
      id: 'cust-a',
      name: '田中太郎',
      score: 100,
      matchType: 'exact',
      isDuplicate: false,
      careManagerName: '五十嵐恵',
    },
    candidates: [
      {
        id: 'cust-a',
        name: '田中太郎',
        score: 100,
        matchType: 'exact',
        isDuplicate: false,
        careManagerName: '五十嵐恵',
      },
      { id: 'cust-b', name: '田中花子', score: 100, matchType: 'exact', isDuplicate: false },
    ],
    hasMultipleCandidates: true,
    needsManualSelection,
    provenance,
  };
}

/** exact一致&&非isDuplicateの候補3件(GOAL.md現場要件の実例: 利用者3名記載FAX)を持つcustomerResultを構築する */
function threeExactCandidatesResult(): ArbitratedCustomerExtractionResult {
  return {
    bestMatch: { id: 'cust-a', name: '田中太郎', score: 100, matchType: 'exact', isDuplicate: false },
    candidates: [
      { id: 'cust-a', name: '田中太郎', score: 100, matchType: 'exact', isDuplicate: false },
      { id: 'cust-b', name: '田中花子', score: 100, matchType: 'exact', isDuplicate: false },
      { id: 'cust-c', name: '田中一郎', score: 100, matchType: 'exact', isDuplicate: false },
    ],
    hasMultipleCandidates: true,
    needsManualSelection: false,
    provenance: EXISTING_PROVENANCE,
  };
}

function buildExtractionFields(customerResult: ArbitratedCustomerExtractionResult) {
  return buildOcrExtractionUpdatePayload({
    documentTypeResult,
    customerResult,
    officeResult,
    dateResult,
    ocrResultUrl: null,
    totalPages: 1,
    suggestedNewOffice: null,
    modelId: 'test-model',
    extractedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

const OWNERSHIP = { ocrRunId: 'run-1', fileUrl: 'gs://bucket/orig.pdf', mimeType: 'application/pdf' };

async function seedProcessingDoc(
  docId: string,
  overrides: Record<string, unknown> = {}
): Promise<FirebaseFirestore.DocumentReference> {
  const docRef = db.collection('documents').doc(docId);
  await docRef.set({
    status: 'processing',
    ocrRunId: OWNERSHIP.ocrRunId,
    fileUrl: OWNERSHIP.fileUrl,
    mimeType: OWNERSHIP.mimeType,
    fileId: 'gmail-msg-1',
    fileName: 'orig.pdf',
    sourceType: 'gmail',
    messageId: 'gmail-msg-1',
    targetPageNumber: 1,
    ...overrides,
  });
  return docRef;
}

describe('applyOcrCompletionTransaction (複数顧客FAX複製機能 AC-b/AC-c)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('AC-b: flag ON + exact候補2件(customerId重複排除後) → 元doc含め2件生成され、共通distributionId・各customerId・各detail/mainを持つ', async () => {
    const docId = 'orig-doc-1';
    const docRef = await seedProcessingDoc(docId);
    // pass2Promotion(ADR-0025 PR2)の複製伝播をあわせて検証するため、customerNameのみ
    // Pass2候補昇格(source:'candidate')とする(pr-test-analyzer指摘: 複製メンバー間で
    // 同一値になることが未検証だった)。
    const customerResult = twoExactCandidatesResult(false, {
      source: 'candidate',
      candidateGrounded: true,
    });

    await applyOcrCompletionTransaction({
      db,
      docRef,
      docId,
      ownershipExpectation: OWNERSHIP,
      extractionFields: buildExtractionFields(customerResult),
      customerCandidates: customerResult.candidates,
      sameNameCollisionNames: new Set(),
      fileDateFormatted: dateResult.formattedDate ?? undefined,
      savedOcrResult: 'raw ocr text',
      pageResults,
      ocrExcerpt: 'excerpt',
      faxDuplicationEnabled: true,
      multiCustomerDetectionEnabled: false,
      tokenCounts: { inputTokens: 10, outputTokens: 5, thinkingTokens: 0, pagesProcessed: 1 },
    });

    const allDocs = await db.collection('documents').get();
    expect(allDocs.size, '元doc+コピー1件の計2件が生成されること').to.equal(2);

    const docs = allDocs.docs.map((d) => ({ id: d.id, data: d.data() }));

    const distributionIds = new Set(docs.map((d) => d.data.distributionId));
    expect(distributionIds.size, '全メンバーが単一の共通distributionIdを持つこと').to.equal(1);
    expect(Array.from(distributionIds)[0], 'distributionIdは元docのidと一致する(D4)').to.equal(docId);

    const customerIds = docs.map((d) => d.data.customerId).sort();
    expect(customerIds, '各customerIdが割り当てられること(customerId重複排除後の候補と一致)').to.deep.equal([
      'cust-a',
      'cust-b',
    ]);

    for (const d of docs) {
      expect(d.data.customerConfirmed, 'D5: customerConfirmed:true').to.equal(true);
      expect(d.data.confirmedBy, 'D5: confirmedBy:null').to.equal(null);
      expect(d.data.verified, 'D5: verified:false').to.equal(false);
      expect(d.data.needsManualCustomerSelection, '自動配信のため手動選択不要').to.equal(false);
      expect(d.data.isDuplicateCustomer).to.equal(false);
      expect(d.data.status).to.equal('processed');
      // ADR-0025 PR2 / pr-test-analyzer指摘: pass2Promotionは他の抽出結果メタデータ
      // (totalPages等)と同じ汎用spreadで複製されるため、全複製メンバーで同一値になるはず。
      expect(d.data.pass2Promotion, `${d.id}のpass2Promotionが元OCR実行結果と一致すること`).to.deep.equal({
        documentType: false,
        customerName: true,
        officeName: false,
        date: false,
      });

      const detailSnap = await db.doc(`documents/${d.id}/detail/main`).get();
      expect(detailSnap.exists, `${d.id}/detail/mainが存在すること`).to.equal(true);
      expect(detailSnap.data()?.ocrResult).to.equal('raw ocr text');
      expect(detailSnap.data()?.pageResults).to.have.lengthOf(1);
    }

    // D2: Storage実体共有(新規コピーは同一fileUrl/fileId/mimeType/fileNameを引き継ぐ)
    const copy = docs.find((d) => d.id !== docId)!;
    expect(copy.data.fileUrl).to.equal(OWNERSHIP.fileUrl);
    expect(copy.data.fileId).to.equal('gmail-msg-1');
    expect(copy.data.mimeType).to.equal(OWNERSHIP.mimeType);
    expect(copy.data.fileName).to.equal('orig.pdf');
  });

  it('AC-b: flag ON + exact候補3件(GOAL.md現場要件の実例: 利用者3名記載FAX) → 元doc含め3件生成され、共通distributionId・各customerIdを持つ(evaluator指摘: 2件のみのテストでは実例のカーディナリティを網羅できない)', async () => {
    const docId = 'orig-doc-3cand';
    const docRef = await seedProcessingDoc(docId);
    const customerResult = threeExactCandidatesResult();

    await applyOcrCompletionTransaction({
      db,
      docRef,
      docId,
      ownershipExpectation: OWNERSHIP,
      extractionFields: buildExtractionFields(customerResult),
      customerCandidates: customerResult.candidates,
      sameNameCollisionNames: new Set(),
      fileDateFormatted: dateResult.formattedDate ?? undefined,
      savedOcrResult: 'raw ocr text',
      pageResults,
      ocrExcerpt: 'excerpt',
      faxDuplicationEnabled: true,
      multiCustomerDetectionEnabled: false,
      tokenCounts: { inputTokens: 10, outputTokens: 5, thinkingTokens: 0, pagesProcessed: 1 },
    });

    const allDocs = await db.collection('documents').get();
    expect(allDocs.size, '元doc+コピー2件の計3件が生成されること').to.equal(3);

    const docs = allDocs.docs.map((d) => ({ id: d.id, data: d.data() }));

    const distributionIds = new Set(docs.map((d) => d.data.distributionId));
    expect(distributionIds.size, '全メンバーが単一の共通distributionIdを持つこと').to.equal(1);
    expect(Array.from(distributionIds)[0], 'distributionIdは元docのidと一致する(D4)').to.equal(docId);

    const customerIds = docs.map((d) => d.data.customerId).sort();
    expect(customerIds, '3名分の各customerIdが割り当てられること').to.deep.equal(['cust-a', 'cust-b', 'cust-c']);

    for (const d of docs) {
      expect(d.data.customerConfirmed).to.equal(true);
      expect(d.data.status).to.equal('processed');

      const detailSnap = await db.doc(`documents/${d.id}/detail/main`).get();
      expect(detailSnap.exists, `${d.id}/detail/mainが存在すること`).to.equal(true);
    }
  });

  it('AC-b: flag OFFの場合は複製されず1件のまま、needsManualCustomerSelectionは従来通り評価される', async () => {
    const docId = 'orig-doc-2';
    const docRef = await seedProcessingDoc(docId);
    // 候補が拮抗(スコア差0)している状況を想定し、手動選択が必要なケースを再現する
    const customerResult = twoExactCandidatesResult(true);

    await applyOcrCompletionTransaction({
      db,
      docRef,
      docId,
      ownershipExpectation: OWNERSHIP,
      extractionFields: buildExtractionFields(customerResult),
      customerCandidates: customerResult.candidates,
      sameNameCollisionNames: new Set(),
      fileDateFormatted: dateResult.formattedDate ?? undefined,
      savedOcrResult: 'raw ocr text',
      pageResults,
      ocrExcerpt: 'excerpt',
      faxDuplicationEnabled: false,
      multiCustomerDetectionEnabled: false,
      tokenCounts: { inputTokens: 10, outputTokens: 5, thinkingTokens: 0, pagesProcessed: 1 },
    });

    const allDocs = await db.collection('documents').get();
    expect(allDocs.size, 'flag OFF時は複製されず1件のまま').to.equal(1);

    const data = allDocs.docs[0]!.data();
    expect(data.distributionId, 'distributionIdは付与されない').to.equal(undefined);
    expect(data.needsManualCustomerSelection, '従来どおり手動選択フラグが立つ').to.equal(true);
    expect(data.customerId, 'bestMatchの顧客がそのまま採用される').to.equal('cust-a');
  });

  it('AC-c: 既にdistributionIdを持つdoc(複製コピー)を再処理してもcustomerId/customerName/careManagerは不変、再複製も発生しない', async () => {
    const docId = 'copy-doc-1';
    const docRef = await seedProcessingDoc(docId, {
      distributionId: 'orig-doc-1',
      customerId: 'cust-b',
      customerName: '田中花子',
      careManager: null,
      customerConfirmed: true,
      confirmedBy: null,
      confirmedAt: null,
      isDuplicateCustomer: false,
      needsManualCustomerSelection: false,
      verified: false,
    });

    // 再処理時、OCRは再び同じ2名の候補を検出する(現実の再処理シナリオを再現)
    const customerResult = twoExactCandidatesResult();

    await applyOcrCompletionTransaction({
      db,
      docRef,
      docId,
      ownershipExpectation: OWNERSHIP,
      extractionFields: buildExtractionFields(customerResult),
      customerCandidates: customerResult.candidates,
      sameNameCollisionNames: new Set(),
      fileDateFormatted: dateResult.formattedDate ?? undefined,
      savedOcrResult: 'raw ocr text (reprocessed)',
      pageResults,
      ocrExcerpt: 'excerpt',
      faxDuplicationEnabled: true,
      multiCustomerDetectionEnabled: false,
      tokenCounts: { inputTokens: 10, outputTokens: 5, thinkingTokens: 0, pagesProcessed: 1 },
    });

    const allDocs = await db.collection('documents').get();
    expect(allDocs.size, '再複製は発生せず、doc件数は1件のまま(AC-c)').to.equal(1);

    const updated = (await docRef.get()).data()!;
    expect(updated.customerId, 'customerIdが不変であること(confirmedFieldMerge保護)').to.equal('cust-b');
    expect(updated.customerName, 'customerNameが不変であること').to.equal('田中花子');
    expect(updated.careManager, 'careManagerが不変であること').to.equal(null);
    expect(updated.distributionId, 'distributionIdも維持される').to.equal('orig-doc-1');
  });

  it('code-review high指摘(CONFIRMED): 人間がcustomerConfirmed済みの単一顧客docは、再処理でexact候補2件以上検出されても複製されず、確定済み顧客が上書きされない', async () => {
    const docId = 'confirmed-single-customer-doc';
    const docRef = await seedProcessingDoc(docId, {
      customerId: 'cust-human-picked',
      customerName: '人間が選択した顧客',
      careManager: '担当CM',
      customerConfirmed: true,
      confirmedBy: 'admin-uid-1',
      confirmedAt: admin.firestore.Timestamp.now(),
    });

    // 再処理時、OCRはexact&&非isDuplicateの候補を2件検出する(例: fix-stuck-documents.js等の
    // customerConfirmedをクリアしないops script経由での再処理を再現)
    const customerResult = twoExactCandidatesResult();

    await applyOcrCompletionTransaction({
      db,
      docRef,
      docId,
      ownershipExpectation: OWNERSHIP,
      extractionFields: buildExtractionFields(customerResult),
      customerCandidates: customerResult.candidates,
      sameNameCollisionNames: new Set(),
      fileDateFormatted: dateResult.formattedDate ?? undefined,
      savedOcrResult: 'raw ocr text (reprocessed)',
      pageResults,
      ocrExcerpt: 'excerpt',
      faxDuplicationEnabled: true,
      multiCustomerDetectionEnabled: false,
      tokenCounts: { inputTokens: 10, outputTokens: 5, thinkingTokens: 0, pagesProcessed: 1 },
    });

    const allDocs = await db.collection('documents').get();
    expect(allDocs.size, '確定済みdocは複製されず1件のまま').to.equal(1);

    const updated = (await docRef.get()).data()!;
    expect(updated.customerId, '人間が確定した顧客IDが上書きされないこと').to.equal('cust-human-picked');
    expect(updated.customerName).to.equal('人間が選択した顧客');
    expect(updated.confirmedBy, '確定者の監査証跡が消えないこと').to.equal('admin-uid-1');
    expect(updated.distributionId, 'distributionIdは付与されない').to.equal(undefined);
  });
});

describe('applyOcrCompletionTransaction (複数人記載検出 PR-A、multiCustomerDetectionEnabledの消去挙動)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('flag ONで検出済みのdocをflag OFFで再処理すると、古いmultiCustomerDetected/multiCustomerCountが消去される(codex review P1指摘対応)', async () => {
    const docId = 'stale-detection-doc';
    const docRef = await seedProcessingDoc(docId, {
      multiCustomerDetected: true,
      multiCustomerCount: 2,
    });

    const customerResult = twoExactCandidatesResult();

    await applyOcrCompletionTransaction({
      db,
      docRef,
      docId,
      ownershipExpectation: OWNERSHIP,
      extractionFields: buildExtractionFields(customerResult),
      customerCandidates: customerResult.candidates,
      sameNameCollisionNames: new Set(),
      fileDateFormatted: dateResult.formattedDate ?? undefined,
      savedOcrResult: 'raw ocr text (reprocessed after flag off)',
      pageResults,
      ocrExcerpt: 'excerpt',
      faxDuplicationEnabled: false,
      multiCustomerDetectionEnabled: false,
      tokenCounts: { inputTokens: 10, outputTokens: 5, thinkingTokens: 0, pagesProcessed: 1 },
    });

    const updated = (await docRef.get()).data()!;
    expect('multiCustomerDetected' in updated, '古い検出フラグがdeleteFieldで消去されること').to.equal(false);
    expect('multiCustomerCount' in updated, '古い検出人数がdeleteFieldで消去されること').to.equal(false);
  });

  it('flag ONのまま再処理される場合、multiCustomerDetected/multiCustomerCountは最新のOCR結果で上書きされる(消去ロジックは発火しない)', async () => {
    const docId = 'still-on-doc';
    const docRef = await seedProcessingDoc(docId, {
      multiCustomerDetected: true,
      multiCustomerCount: 2,
    });

    // 再処理でexact候補が1件のみに変わったケース(前回2件検出→今回は1件のみ)
    const customerResult: ArbitratedCustomerExtractionResult = {
      bestMatch: { id: 'cust-a', name: '田中太郎', score: 100, matchType: 'exact', isDuplicate: false },
      candidates: [{ id: 'cust-a', name: '田中太郎', score: 100, matchType: 'exact', isDuplicate: false }],
      hasMultipleCandidates: false,
      needsManualSelection: false,
      provenance: EXISTING_PROVENANCE,
    };
    // multiCustomerFieldsの計算・マージはapplyOcrCompletionTransaction()の責務ではなく
    // 呼出元(ocrProcessor.tsのprocessDocument())が行う設計(PR-A)。本testはprocessDocument()
    // を経由しないため、実際の呼出元と同じ手順を明示的に再現する。
    const multiCustomerFields = buildMultiCustomerDetectionFields(
      customerResult.candidates.map((c) => ({
        customerId: c.id,
        customerName: c.name,
        score: c.score,
        matchType: c.matchType,
        isDuplicate: c.isDuplicate,
      })),
      new Set(),
      true
    );

    await applyOcrCompletionTransaction({
      db,
      docRef,
      docId,
      ownershipExpectation: OWNERSHIP,
      extractionFields: { ...buildExtractionFields(customerResult), ...multiCustomerFields },
      customerCandidates: customerResult.candidates,
      sameNameCollisionNames: new Set(),
      fileDateFormatted: dateResult.formattedDate ?? undefined,
      savedOcrResult: 'raw ocr text (reprocessed, still flag on)',
      pageResults,
      ocrExcerpt: 'excerpt',
      faxDuplicationEnabled: false,
      multiCustomerDetectionEnabled: true,
      tokenCounts: { inputTokens: 10, outputTokens: 5, thinkingTokens: 0, pagesProcessed: 1 },
    });

    const updated = (await docRef.get()).data()!;
    expect(updated.multiCustomerDetected, '最新のOCR結果(候補1件)に基づきfalseへ更新される').to.equal(false);
    expect(updated.multiCustomerCount, '最新の候補数(1件)へ更新される').to.equal(1);
  });

  it('flag OFFかつdocが元々multiCustomerDetectedを持たない場合、余計な消去書込みは発生しない(freshDataにフィールドが無ければcleanupは空)', async () => {
    const docId = 'never-detected-doc';
    const docRef = await seedProcessingDoc(docId);

    const customerResult: ArbitratedCustomerExtractionResult = {
      bestMatch: { id: 'cust-a', name: '田中太郎', score: 100, matchType: 'exact', isDuplicate: false },
      candidates: [{ id: 'cust-a', name: '田中太郎', score: 100, matchType: 'exact', isDuplicate: false }],
      hasMultipleCandidates: false,
      needsManualSelection: false,
      provenance: EXISTING_PROVENANCE,
    };

    await applyOcrCompletionTransaction({
      db,
      docRef,
      docId,
      ownershipExpectation: OWNERSHIP,
      extractionFields: buildExtractionFields(customerResult),
      customerCandidates: customerResult.candidates,
      sameNameCollisionNames: new Set(),
      fileDateFormatted: dateResult.formattedDate ?? undefined,
      savedOcrResult: 'raw ocr text',
      pageResults,
      ocrExcerpt: 'excerpt',
      faxDuplicationEnabled: false,
      multiCustomerDetectionEnabled: false,
      tokenCounts: { inputTokens: 10, outputTokens: 5, thinkingTokens: 0, pagesProcessed: 1 },
    });

    const updated = (await docRef.get()).data()!;
    expect('multiCustomerDetected' in updated, 'キー自体が書き込まれないこと(cocoro/devの挙動不変)').to.equal(false);
    expect('multiCustomerCount' in updated).to.equal(false);
  });
});

describe('applyOcrCompletionTransaction (Issue #957: runTransaction自体の一時的失敗をwithBackoffRetryで防御)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  /**
   * runTransactionだけを差し替えたfirestoreラッパ。failTxCallIndices回目のtxは実dbへ
   * 委譲せず合成エラーを投げる。driveFolderClaimIntegration.test.tsのmakeFailingCommitFirestore
   * (Issue #954で確立済みのテストパターン)をOCR側にも適用する(Issue #957)。
   */
  function makeFailingCommitFirestore(
    realDb: admin.firestore.Firestore,
    failTxCallIndices: readonly number[],
    errorCode = 14
  ): { firestore: admin.firestore.Firestore; getTxCallCount: () => number } {
    let txCalls = 0;
    const firestore = {
      collection: (path: string) => realDb.collection(path),
      doc: (path: string) => realDb.doc(path),
      runTransaction: async (updateFn: (tx: admin.firestore.Transaction) => Promise<unknown>) => {
        txCalls++;
        if (failTxCallIndices.includes(txCalls)) {
          const err = new Error(`simulated Firestore transaction failure (call #${txCalls})`) as Error & {
            code: number;
          };
          err.code = errorCode;
          throw err;
        }
        return realDb.runTransaction(updateFn);
      },
    } as unknown as admin.firestore.Firestore;
    return { firestore, getTxCallCount: () => txCalls };
  }

  /** 複製・複数人記載検出を伴わない最小構成の入力(単一doc更新パスのみを対象にする)。 */
  function minimalCompletionInput(
    targetDb: admin.firestore.Firestore,
    docRef: FirebaseFirestore.DocumentReference,
    docId: string
  ) {
    const customerResult = twoExactCandidatesResult(true); // needsManualSelection:true → 複製なし
    return {
      db: targetDb,
      docRef,
      docId,
      ownershipExpectation: OWNERSHIP,
      extractionFields: buildExtractionFields(customerResult),
      customerCandidates: customerResult.candidates,
      sameNameCollisionNames: new Set<string>(),
      fileDateFormatted: dateResult.formattedDate ?? undefined,
      savedOcrResult: 'raw ocr text',
      pageResults,
      ocrExcerpt: 'excerpt',
      faxDuplicationEnabled: false,
      multiCustomerDetectionEnabled: false,
      tokenCounts: { inputTokens: 10, outputTokens: 5, thinkingTokens: 0, pagesProcessed: 1 },
    };
  }

  it('1回だけtransientエラー(code 14)で失敗しても2回目でリトライ成功し、docが更新される', async () => {
    const docId = 'tx-957-retry-success';
    const docRef = await seedProcessingDoc(docId);
    const { firestore: failingDb, getTxCallCount } = makeFailingCommitFirestore(db, [1]);

    await applyOcrCompletionTransaction(minimalCompletionInput(failingDb, docRef, docId));

    expect(getTxCallCount(), 'リトライにより2回呼ばれるはず').to.equal(2);
    const updated = (await docRef.get()).data()!;
    expect(updated.status).to.equal('processed');
  });

  it(`全attempts(OCR_TX_RETRY_ATTEMPTS=${OCR_TX_RETRY_ATTEMPTS})失敗すると、docは更新されないままエラーがthrowされる`, async () => {
    const docId = 'tx-957-retry-exhausted';
    const docRef = await seedProcessingDoc(docId);
    const { firestore: failingDb, getTxCallCount } = makeFailingCommitFirestore(
      db,
      Array.from({ length: OCR_TX_RETRY_ATTEMPTS }, (_, i) => i + 1)
    );

    try {
      await applyOcrCompletionTransaction(minimalCompletionInput(failingDb, docRef, docId));
      expect.fail('全attempts失敗時はthrowされるはず');
    } catch (error) {
      expect((error as Error).message).to.include('simulated Firestore transaction failure');
    }
    expect(getTxCallCount(), `${OCR_TX_RETRY_ATTEMPTS}回とも失敗するはず`).to.equal(OCR_TX_RETRY_ATTEMPTS);

    const after = (await docRef.get()).data()!;
    expect(after.status, 'transaction全滅時はstatusが更新されないまま(processing)残る').to.equal('processing');
  });

  it('非transientコード(例: 7=PERMISSION_DENIED)は1回で諦めリトライされない', async () => {
    const docId = 'tx-957-non-retryable';
    const docRef = await seedProcessingDoc(docId);
    const { firestore: failingDb, getTxCallCount } = makeFailingCommitFirestore(db, [1], 7);

    try {
      await applyOcrCompletionTransaction(minimalCompletionInput(failingDb, docRef, docId));
      expect.fail('非transientエラーはリトライされずthrowされるはず');
    } catch (error) {
      expect((error as Error).message).to.include('simulated Firestore transaction failure');
    }
    expect(getTxCallCount(), '非transientは即座に諦めるため1回のみ').to.equal(1);
  });

  it('所有権喪失(OcrRunSupersededError)はtransaction本体からthrowされたエラーのため.codeを持たずリトライされない(fable-reviewセカンドオピニオン指摘の回帰防止)', async () => {
    const docId = 'tx-957-superseded-no-retry';
    // ownershipExpectation(OWNERSHIP.ocrRunId='run-1')と不一致にして所有権喪失を再現する
    const docRef = await seedProcessingDoc(docId, { ocrRunId: 'different-run' });

    let txCalls = 0;
    const countingDb = {
      collection: (path: string) => db.collection(path),
      doc: (path: string) => db.doc(path),
      runTransaction: async (updateFn: (tx: admin.firestore.Transaction) => Promise<unknown>) => {
        txCalls++;
        return db.runTransaction(updateFn);
      },
    } as unknown as admin.firestore.Firestore;

    try {
      await applyOcrCompletionTransaction(minimalCompletionInput(countingDb, docRef, docId));
      expect.fail('所有権喪失時はOcrRunSupersededErrorがthrowされるはず');
    } catch (error) {
      expect(error).to.be.instanceOf(OcrRunSupersededError);
    }
    expect(txCalls, 'アプリケーションレベルのthrow(.codeなし)はリトライ対象外のため1回のみ実行されるはず').to.equal(1);
  });

  /**
   * runTransactionだけを差し替えたfirestoreラッパ。failOnCallIndex回目のtxは実dbへ実際に
   * 委譲し(書込みは成功する)、その直後にクライアント側にのみgRPC transientコード
   * (既定14=UNAVAILABLE)を持つ合成エラーを投げる。「サーバー側は成功したがクライアントには
   * 失敗として返る」ambiguous commitを再現する(driveFolderClaimIntegration.test.tsの
   * makeAmbiguousCommitFirestoreと同方針)。
   *
   * pr-test-analyzer/Evaluator/fable-reviewの3者が独立に収束指摘: FAX複製分岐
   * (distributionPlan.shouldDuplicate)は`db.collection('documents').doc()`で毎回新規の
   * ランダムIDを採番するため、driveFolderClaim.tsのattemptId自己ブロックのような
   * 冪等性ガードを持たない。ambiguous commit後の再実行時にこの分岐がどう振る舞うかを
   * 直接検証する(下のit参照)。
   */
  function makeAmbiguousCommitFirestore(
    realDb: admin.firestore.Firestore,
    failOnCallIndex: number,
    errorCode = 14
  ): { firestore: admin.firestore.Firestore; getTxCallCount: () => number } {
    let txCalls = 0;
    const firestore = {
      collection: (path: string) => realDb.collection(path),
      doc: (path: string) => realDb.doc(path),
      runTransaction: async (updateFn: (tx: admin.firestore.Transaction) => Promise<unknown>) => {
        txCalls++;
        const result = await realDb.runTransaction(updateFn);
        if (txCalls === failOnCallIndex) {
          const err = new Error('simulated ambiguous commit (server succeeded, client sees failure)') as Error & {
            code: number;
          };
          err.code = errorCode;
          throw err;
        }
        return result;
      },
    } as unknown as admin.firestore.Firestore;
    return { firestore, getTxCallCount: () => txCalls };
  }

  it('FAX複製分岐でambiguous commit(サーバー側は成功したがクライアントには失敗が返る)後、リトライはOcrRunSupersededError(status-mismatch)で即座に諦め、かつ1回目のcommit結果(重複なし・正しいcustomerId)は破壊されない', async () => {
    // fable-reviewセカンドオピニオン(codex代替)M2で判明した実際の挙動: 1回目のcommitで
    // status:'processed'に書き換わるため、2回目の再実行時は`evaluateOcrRunOwnership`が
    // `fresh.status !== 'processing'`によりstatus-mismatchと判定し、FAX複製の分岐判定
    // (shouldDuplicate)に到達する前にOcrRunSupersededErrorをthrowする(実装時点の想定
    // 「2回目はshouldDuplicate:falseの非複製分岐に倒れる」は誤りだった。実測により訂正)。
    // OcrRunSupersededErrorは.codeを持たないためisRetryableFirestoreErrorがfalseを返し
    // 即座に諦める(リトライされない)。呼出元processOCR.tsはこれを異常ではなく正常な
    // supersedeとして扱う(compensateDeleteOnFailure/shouldSkipCompensatingDeleteが
    // status==='processed'&&ocrRunId一致を検知し削除しない、ocrResultCleanup.ts参照)ため、
    // 1回目の正しいcommit結果(重複なし・customerId正常)がそのまま最終状態として残る。
    const docId = 'tx-957-fax-ambiguous-commit';
    const docRef = await seedProcessingDoc(docId);
    const customerResult = twoExactCandidatesResult(false);
    const { firestore: ambiguousDb, getTxCallCount } = makeAmbiguousCommitFirestore(db, 1);

    try {
      await applyOcrCompletionTransaction({
        db: ambiguousDb,
        docRef,
        docId,
        ownershipExpectation: OWNERSHIP,
        extractionFields: buildExtractionFields(customerResult),
        customerCandidates: customerResult.candidates,
        sameNameCollisionNames: new Set(),
        fileDateFormatted: dateResult.formattedDate ?? undefined,
        savedOcrResult: 'raw ocr text',
        pageResults,
        ocrExcerpt: 'excerpt',
        faxDuplicationEnabled: true,
        multiCustomerDetectionEnabled: false,
        tokenCounts: { inputTokens: 10, outputTokens: 5, thinkingTokens: 0, pagesProcessed: 1 },
      });
      expect.fail('2回目はstatus-mismatchによりOcrRunSupersededErrorがthrowされるはず');
    } catch (error) {
      expect(error).to.be.instanceOf(OcrRunSupersededError);
      expect((error as OcrRunSupersededError).reason).to.equal('status-mismatch');
    }

    expect(
      getTxCallCount(),
      '1回目は実際にcommitされた上でクライアントには失敗が返り、withBackoffRetryが2回目を実行するが、' +
        'status-mismatchは.codeを持たずリトライ対象外のためここで諦めるはず'
    ).to.equal(2);

    const allDocs = await db.collection('documents').get();
    expect(allDocs.size, '2回目はOcrRunSupersededErrorで書込み前に中断するため、重複コピーが作られないこと').to.equal(
      2
    );

    const docs = allDocs.docs.map((d) => ({ id: d.id, data: d.data() }));
    const original = docs.find((d) => d.id === docId)!;
    const copy = docs.find((d) => d.id !== docId)!;

    expect(original.data.distributionId, 'distributionIdは1回目のcommit結果のまま維持される').to.equal(docId);
    expect(original.data.customerId, '1回目のcommit結果のcustomerIdが破壊されないこと').to.equal('cust-a');
    expect(original.data.customerConfirmed).to.equal(true);
    expect(original.data.status, '1回目のcommit結果のstatusが破壊されないこと').to.equal('processed');
    expect(copy.data.customerId, '1回目で作成された複製コピーが破壊・重複作成されないこと').to.equal('cust-b');

    const detailSnap = await db.doc(`documents/${docId}/detail/main`).get();
    expect(detailSnap.exists, '1回目のcommit結果のdetail/mainが破壊されないこと').to.equal(true);
  });
});
