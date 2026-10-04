/**
 * ADR-0027 PR4c (AI要約6状態UI) 実機検証用シードスクリプト
 *
 * scripts/seed-issue-1033-contract-ended.js と同様、emulator専用。
 * 全環境がSUMMARY_PROVIDER=noneのため実データが存在しない8 kind
 * (absent/queued/generating/generated/generated-with-failure/failed/unavailable×2)を、Firestoreへ直接
 * summaryState等のフィールドを書き込んで再現する。generateSummaryBatchのclaim処理や
 * regenerateSummaryのonCallパスは通過しない(表示ロジックの検証専用、crossreview指摘反映)。
 *
 * 使用方法:
 *   FIRESTORE_EMULATOR_HOST=localhost:8085 node scripts/seed-adr0027-pr4c-summary-states.js
 */

const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

// codex pass1指摘反映: emulator未接続のまま実Firestoreへ誤投入することを防ぐガード
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (!emulatorHost || !/^(localhost|127\.0\.0\.1):8085$/.test(emulatorHost)) {
  console.error(
    `ERROR: FIRESTORE_EMULATOR_HOST が localhost:8085 (または 127.0.0.1:8085) ではありません (現在値: ${emulatorHost || '未設定'})。` +
      '本番/開発環境への誤投入を防ぐため中断します。'
  );
  process.exit(1);
}

const projectId = process.env.GCLOUD_PROJECT || 'doc-split-dev';
initializeApp({ projectId });
const db = getFirestore();

const CUSTOMER = { id: 'pr4c-cust-summary', name: 'PR4c要約検証太郎' };
const OFFICE = { id: 'office-001', name: 'テスト第一事業所' };

const LONG_OCR_TEXT =
  'これはADR-0027 PR4cの要約表示状態検証用に投入したOCR結果本文です。'.repeat(4);
const SHORT_OCR_TEXT = '短いOCR結果';

function baseDocData(overrides) {
  const now = Timestamp.now();
  return {
    mimeType: 'application/pdf',
    fileUrl: `gs://doc-split-dev-documents/test/${overrides.id}.pdf`,
    customerId: CUSTOMER.id,
    customerName: CUSTOMER.name,
    customerConfirmed: true,
    officeId: OFFICE.id,
    officeName: OFFICE.name,
    officeConfirmed: true,
    documentType: '請求書',
    totalPages: 1,
    status: 'processed',
    verified: false,
    createdAt: now,
    processedAt: now,
    fileDate: now,
    ...overrides,
  };
}

async function main() {
  console.log('🚀 ADR-0027 PR4c検証用シードデータ作成開始');
  console.log(`プロジェクト: ${projectId}\n`);

  await db.collection('masters/customers/items').doc(CUSTOMER.id).set({
    name: CUSTOMER.name,
    furigana: 'ピーアールヨンシーヨウヤクケンショウタロウ',
    isDuplicate: false,
    isContractEnded: false,
  });
  console.log('✅ 顧客マスター1件作成');

  const docs = [
    // kind=6 absent: summaryStateフィールド自体が無い(SUMMARY_PROVIDER=none環境の現行挙動)。
    // codex pass1指摘反映: 親のocrResultは空にし、documents/{id}/detail/main.ocrResult側へ
    // 100字以上の本文を置く(Storageオフロード相当のresolveDetailFields()経由読込パターン)。
    // deriveSummaryDisplayStateの呼び出し側が誤ってdocument.ocrResultを直接参照する実装ミスを
    // 検出できるようにするため。
    {
      id: 'pr4c-absent-detail-offload',
      data: baseDocData({
        id: 'pr4c-absent-detail-offload',
        fileName: 'E2E_PR4c_absent_detail-offload.pdf',
      }),
      detail: { ocrResult: LONG_OCR_TEXT },
    },
    // kind=3 queued: summaryState==='pending'
    {
      id: 'pr4c-queued',
      data: baseDocData({
        id: 'pr4c-queued',
        fileName: 'E2E_PR4c_queued.pdf',
        ocrResult: LONG_OCR_TEXT,
        summaryState: 'pending',
        summaryAttemptCount: 0,
        // 手動依頼の印(summaryManualRequestedAt): 受付案内の表示とポーリング10秒の対象
        summaryManualRequestedAt: Timestamp.now(),
      }),
    },
    // kind=3 queued(再生成依頼中): 要約ありでpending。旧要約を薄く保持して見せ続ける
    {
      id: 'pr4c-regenerate-queued',
      data: baseDocData({
        id: 'pr4c-regenerate-queued',
        fileName: 'E2E_PR4c_regenerate_queued.pdf',
        ocrResult: LONG_OCR_TEXT,
        summary: { text: 'PR4c検証用の旧要約テキストです。', truncated: false },
        summaryState: 'pending',
        summaryManualRequestedAt: Timestamp.now(),
      }),
    },
    // kind=2b generated-with-failure: 要約ありで再作成が失敗(error)。旧要約+失敗併記
    {
      id: 'pr4c-generated-with-failure',
      data: baseDocData({
        id: 'pr4c-generated-with-failure',
        fileName: 'E2E_PR4c_generated_with_failure.pdf',
        ocrResult: LONG_OCR_TEXT,
        summary: { text: 'PR4c検証用の旧要約テキストです。', truncated: false },
        summaryState: 'error',
        summaryErrorKind: 'fabrication_suspected',
        summaryError: 'Fabrication scanner detected 1 suspect name(s)',
        summaryAttemptCount: 3,
      }),
    },
    // kind=2b' generated-with-failure(skipped): 再生成がskippedになった(原文の読込失敗・allowlist外等)。
    // 旧要約は温存されるが「生成済み」には見せず、固定の理由文を併記する(codex review P2指摘)
    {
      id: 'pr4c-generated-skipped-rerun',
      data: baseDocData({
        id: 'pr4c-generated-skipped-rerun',
        fileName: 'E2E_PR4c_generated_skipped_rerun.pdf',
        ocrResult: LONG_OCR_TEXT,
        summary: { text: 'PR4c検証用の旧要約テキストです。', truncated: false },
        summaryState: 'skipped',
      }),
    },
    // kind=6 absent(skipped・理由つき): 要約なしで依頼がskippedになった(allowlist外・読込失敗・OCR未完了)。
    // 理由を伝えつつ「AI要約を生成」ボタンを残す(silent-failure-hunter H1指摘)
    {
      id: 'pr4c-absent-skipped-request',
      data: baseDocData({
        id: 'pr4c-absent-skipped-request',
        fileName: 'E2E_PR4c_absent_skipped_request.pdf',
        ocrResult: LONG_OCR_TEXT,
        summaryState: 'skipped',
      }),
    },
    // kind=6 absent(ocrResultUrlオフロード): detail側ocrResult='' + 親ocrResultUrl(ADR-0018、10万字超)
    {
      id: 'pr4c-absent-ocr-url-offload',
      data: baseDocData({
        id: 'pr4c-absent-ocr-url-offload',
        fileName: 'E2E_PR4c_absent_ocr-url-offload.pdf',
        ocrResultUrl: 'gs://doc-split-dev-documents/ocr/pr4c-absent-ocr-url-offload.txt',
      }),
      detail: { ocrResult: '' },
    },
    // kind=2 generated(オフロード): 要約あり。OCR全文が手元にないため8,000字注記が常に出る
    {
      id: 'pr4c-generated-offload',
      data: baseDocData({
        id: 'pr4c-generated-offload',
        fileName: 'E2E_PR4c_generated_offload.pdf',
        ocrResultUrl: 'gs://doc-split-dev-documents/ocr/pr4c-generated-offload.txt',
        summary: { text: 'PR4c検証用のオフロード文書の要約テキストです。', truncated: false },
        summaryState: 'done',
      }),
      detail: { ocrResult: '' },
    },
    // kind=1 generating: summaryState==='processing'(バッチclaim中を模擬)
    {
      id: 'pr4c-generating',
      data: baseDocData({
        id: 'pr4c-generating',
        fileName: 'E2E_PR4c_generating.pdf',
        ocrResult: LONG_OCR_TEXT,
        summaryState: 'processing',
        summaryRunId: 'pr4c-seed-run-id',
        summaryStateUpdatedAt: Timestamp.now(),
        summaryAttemptCount: 1,
      }),
    },
    // kind=2 generated: summary.textあり、summaryState==='done'
    {
      id: 'pr4c-generated',
      data: baseDocData({
        id: 'pr4c-generated',
        fileName: 'E2E_PR4c_generated.pdf',
        ocrResult: LONG_OCR_TEXT,
        summary: { text: 'PR4c検証用の生成済み要約テキストです。', truncated: false },
        summaryState: 'done',
        summaryProvider: 'sarashina',
        summaryAttemptCount: 1,
      }),
    },
    // kind=4 failed(fabrication_suspected): summaryState==='error'
    {
      id: 'pr4c-failed-fabrication',
      data: baseDocData({
        id: 'pr4c-failed-fabrication',
        fileName: 'E2E_PR4c_failed_fabrication.pdf',
        ocrResult: LONG_OCR_TEXT,
        summaryState: 'error',
        summaryErrorKind: 'fabrication_suspected',
        summaryError: 'Fabrication scanner detected 1 suspect name(s)',
        summaryAttemptCount: 3,
      }),
    },
    // kind=5 unavailable(明示skipped): summaryState==='skipped'
    {
      id: 'pr4c-skipped',
      data: baseDocData({
        id: 'pr4c-skipped',
        fileName: 'E2E_PR4c_skipped.pdf',
        ocrResult: SHORT_OCR_TEXT,
        summaryState: 'skipped',
      }),
    },
    // kind=5 unavailable(OCR結果が短いだけ、summaryStateフィールド無し): L1=none環境の現行挙動
    {
      id: 'pr4c-short-no-summary-state',
      data: baseDocData({
        id: 'pr4c-short-no-summary-state',
        fileName: 'E2E_PR4c_short.pdf',
        ocrResult: SHORT_OCR_TEXT,
      }),
    },
    // kind=6 absent(codex review P2指摘反映): Sarashina L2ゲートのallowlist除外でも
    // OCR結果が十分(100字以上)ならsummaryState==='skipped'であってもunavailableにせず、
    // 既存のregenerateSummary手動生成経路(Sarashina L2ゲートとは独立)を維持することを確認する
    {
      id: 'pr4c-skipped-allowlist-long-ocr',
      data: baseDocData({
        id: 'pr4c-skipped-allowlist-long-ocr',
        fileName: 'E2E_PR4c_skipped_allowlist_long_ocr.pdf',
        ocrResult: LONG_OCR_TEXT,
        summaryState: 'skipped',
      }),
    },
  ];

  for (const { id, data, detail } of docs) {
    const docRef = db.collection('documents').doc(id);
    await docRef.set(data);
    if (detail) {
      await docRef.collection('detail').doc('main').set(detail);
    }
  }
  console.log(`✅ 書類${docs.length}件作成(absent/queued/regenerate-queued/generating/generated/generated-with-failure/offload×2/failed/skipped/short/skipped-allowlist-long-ocr)`);

  console.log('\n✅ ADR-0027 PR4c検証用シードデータ作成完了');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('エラー:', err);
    process.exit(1);
  });
