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
import { applyOcrCompletionTransaction } from '../src/ocr/ocrProcessor';
import { buildOcrExtractionUpdatePayload } from '../src/ocr/ocrUpdatePayloadBuilder';
import type {
  CustomerExtractionResult,
  DocumentExtractionResult,
  OfficeExtractionResultWithCandidates,
  DateExtractionResult,
} from '../src/utils/extractors';
import type { RawPageOcrResult } from '../src/ocr/buildPageResult';

const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['documents'];

const documentTypeResult: DocumentExtractionResult = {
  documentType: '請求書',
  category: null,
  score: 100,
  matchType: 'exact',
  keywords: [],
};

const officeResult: OfficeExtractionResultWithCandidates = {
  bestMatch: { id: 'office-1', name: 'ケアサポートきらり', score: 100, matchType: 'exact', isDuplicate: false },
  candidates: [{ id: 'office-1', name: 'ケアサポートきらり', score: 100, matchType: 'exact', isDuplicate: false }],
  hasMultipleCandidates: false,
  needsManualSelection: false,
};

const dateResult: DateExtractionResult = {
  date: new Date('2026-07-01T00:00:00.000Z'),
  formattedDate: '2026-07-01',
  source: 'body',
  pattern: 'test',
  confidence: 90,
  allCandidates: [],
};

const pageResults: RawPageOcrResult[] = [
  { text: 'ページ1のOCR結果', truncated: false, pageNumber: 1, inputTokens: 10, outputTokens: 5 },
];

/** exact一致&&非isDuplicateの候補2件(田中太郎/田中花子)を持つcustomerResultを構築する */
function twoExactCandidatesResult(needsManualSelection = false): CustomerExtractionResult {
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
  };
}

/** exact一致&&非isDuplicateの候補3件(GOAL.md現場要件の実例: 利用者3名記載FAX)を持つcustomerResultを構築する */
function threeExactCandidatesResult(): CustomerExtractionResult {
  return {
    bestMatch: { id: 'cust-a', name: '田中太郎', score: 100, matchType: 'exact', isDuplicate: false },
    candidates: [
      { id: 'cust-a', name: '田中太郎', score: 100, matchType: 'exact', isDuplicate: false },
      { id: 'cust-b', name: '田中花子', score: 100, matchType: 'exact', isDuplicate: false },
      { id: 'cust-c', name: '田中一郎', score: 100, matchType: 'exact', isDuplicate: false },
    ],
    hasMultipleCandidates: true,
    needsManualSelection: false,
  };
}

function buildExtractionFields(customerResult: CustomerExtractionResult) {
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
    const customerResult = twoExactCandidatesResult();

    await applyOcrCompletionTransaction({
      db,
      docRef,
      docId,
      ownershipExpectation: OWNERSHIP,
      extractionFields: buildExtractionFields(customerResult),
      customerCandidates: customerResult.candidates,
      fileDateFormatted: dateResult.formattedDate ?? undefined,
      savedOcrResult: 'raw ocr text',
      pageResults,
      ocrExcerpt: 'excerpt',
      faxDuplicationEnabled: true,
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
      fileDateFormatted: dateResult.formattedDate ?? undefined,
      savedOcrResult: 'raw ocr text',
      pageResults,
      ocrExcerpt: 'excerpt',
      faxDuplicationEnabled: true,
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
      fileDateFormatted: dateResult.formattedDate ?? undefined,
      savedOcrResult: 'raw ocr text',
      pageResults,
      ocrExcerpt: 'excerpt',
      faxDuplicationEnabled: false,
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
      fileDateFormatted: dateResult.formattedDate ?? undefined,
      savedOcrResult: 'raw ocr text (reprocessed)',
      pageResults,
      ocrExcerpt: 'excerpt',
      faxDuplicationEnabled: true,
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
      fileDateFormatted: dateResult.formattedDate ?? undefined,
      savedOcrResult: 'raw ocr text (reprocessed)',
      pageResults,
      ocrExcerpt: 'excerpt',
      faxDuplicationEnabled: true,
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
