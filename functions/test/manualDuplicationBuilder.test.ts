/**
 * manualDuplicationBuilder テスト(ADR-0032: 複数名FAXの手動複製ボタン)
 *
 * buildManualDuplicateDocData / planManualDuplication / buildManualDuplicateDocId は
 * Firestore/Storage副作用を持たない純粋関数のため、faxDuplication.test.ts と同じ規約で
 * ユニットテストする(emulator不要)。
 *
 * 出力項目の期待値は「許可リスト方式」を担保するため全項目を列挙する
 * (`Object.keys` の完全一致で、想定外の項目が混入していないことも検証する)。
 * 氏名・事業所名はすべて架空の値(実データは使わない)。
 */

import { expect } from 'chai';
import type { FieldValue } from 'firebase-admin/firestore';
import {
  MANUAL_DUPLICATION_MAX_GROUP_SIZE,
  buildManualDuplicateDocData,
  buildManualDuplicateDocId,
  parseOcrRunId,
  planManualDuplication,
  type BuildManualDuplicateInput,
} from '../src/documents/manualDuplicationBuilder';

// Firestore の FieldValue.serverTimestamp() の代わりに使う識別用センチネル
const SERVER_TS = { __sentinel: 'serverTimestamp' } as unknown as FieldValue;

/** 元の書類(Firestoreから読んだ想定)。許可リスト対象・対象外の項目を網羅的に含める */
function fullSource(): Record<string, unknown> {
  const fileDate = { seconds: 1793836800, nanoseconds: 0 }; // 2026-11-05 00:00:00 UTC
  return {
    // --- 許可リスト対象(引き継ぐ) ---
    id: 'src1',
    fileId: 'file-1',
    fileName: 'fax-20261105.pdf',
    mimeType: 'application/pdf',
    fileUrl: 'gs://bucket/original/fax-20261105.pdf',
    targetPageNumber: 1,
    sourceType: 'gmail',
    messageId: 'msg-1',
    totalPages: 3,
    ocrExcerpt: 'OCR抜粋テキスト',
    documentType: '提供票',
    documentTypeConfirmed: false,
    category: '介護',
    officeName: 'テスト事業所',
    officeId: 'office-1',
    officeConfirmed: true,
    officeConfirmedBy: 'staff-1',
    officeConfirmedAt: { seconds: 1793900000, nanoseconds: 0 },
    officeCandidates: [
      { officeId: 'office-1', officeName: 'テスト事業所', shortName: null, isDuplicate: false, score: 100, matchType: 'exact' },
    ],
    suggestedNewOffice: null,
    fileDate,
    fileDateFormatted: '2026/11/05',
    ocrExtraction: { version: 'PP-OCRv6_medium', customer: { suggestedValue: 'テスト太郎', suggestedId: 'c-src', confidence: 100, matchType: 'exact' } },
    extractionScores: { documentType: 90, customerName: 100, officeName: 95, date: 100 },
    extractionDetails: { documentMatchType: 'exact', documentKeywords: ['提供票'], customerMatchType: 'exact', officeMatchType: 'exact', datePattern: 'ymd', dateSource: 'body' },
    pass2Promotion: { documentType: false, customer: false, office: false, date: false },
    ocrResultUrl: 'gs://bucket/ocr-results/src1/run-a.txt',

    // --- 許可リスト対象外(元の書類の状態。複製に写してはならない) ---
    customerId: 'c-src',
    customerName: 'テスト太郎',
    careManager: '担当甲',
    customerConfirmed: true,
    confirmedBy: 'staff-9',
    confirmedAt: { seconds: 1793900001, nanoseconds: 0 },
    isDuplicateCustomer: true,
    needsManualCustomerSelection: true,
    allCustomerCandidates: 'テスト太郎,テスト花子',
    customerCandidates: [{ customerId: 'c-src', customerName: 'テスト太郎', isDuplicate: false, score: 100, matchType: 'exact', careManagerName: '担当甲' }],
    multiCustomerDetected: true,
    multiCustomerCount: 2,
    verified: true,
    verifiedBy: 'staff-9',
    verifiedAt: { seconds: 1793900002, nanoseconds: 0 },
    driveExportStatus: 'success',
    driveFileId: 'drive-1',
    driveExportedAt: { seconds: 1793900003, nanoseconds: 0 },
    driveExportError: null,
    driveExportRunId: 'run-d',
    driveExportErrorKind: null,
    isSplitSource: false,
    splitInto: ['x'],
    parentDocumentId: 'parent-1',
    splitFromPages: { start: 1, end: 2 },
    provenance: { sourceSha256: 'abc' },
    provenanceBackfill: { backfilledAt: 'x' },
    provenanceOrigin: { origin: 'genesis' },
    summary: { text: '要約', state: 'done' },
    summaryState: 'done',
    summaryRunId: 'run-s',
    summaryProvider: 'sarashina',
    summaryError: 'エラー文',
    summaryErrorKind: 'timeout',
    summaryAttemptCount: 2,
    summaryStateUpdatedAt: { seconds: 1793900004, nanoseconds: 0 },
    summaryManualRequestedAt: { seconds: 1793900005, nanoseconds: 0 },
    splitSuggestions: [{ afterPageNumber: 1, reason: 'manual', confidence: 100 }],
    pageRotations: [{ pageNumber: 1, rotation: 90 }],
    ocrResult: '旧形式の本体の全文',
    pageResults: [{ pageNumber: 1, text: 'p1' }],
    customerKey: 'テスト太郎',
    officeKey: 'テスト事業所',
    documentTypeKey: '提供票',
    careManagerKey: '担当甲',
    distributionId: 'src1',
    displayFileName: '提供票_テスト事業所_20261105_テスト太郎.pdf',
    ocrRunId: 'run-a',
    retryCount: 2,
    status: 'processed',
    processedAt: { seconds: 1793800000, nanoseconds: 0 },
    updatedAt: { seconds: 1793800001, nanoseconds: 0 },
  };
}

function input(overrides: Partial<BuildManualDuplicateInput> = {}): BuildManualDuplicateInput {
  return {
    source: fullSource(),
    newDocId: 'src1_dup_c-new',
    target: { customerId: 'c-new', customerName: 'テスト花子', careManagerName: '担当乙' },
    distributionId: 'src1',
    confirmedByUid: 'uid-operator',
    ocrResultUrl: 'gs://bucket/ocr-results/src1_dup_c-new/run-a.txt',
    serverTimestamp: SERVER_TS,
    ...overrides,
  };
}

describe('buildManualDuplicateDocId (決定的ID)', () => {
  it('{元docId}_dup_{customerId} の形になる', () => {
    expect(buildManualDuplicateDocId('src1', 'c-new')).to.equal('src1_dup_c-new');
  });
});

describe('buildManualDuplicateDocData (複製の中身: 許可リスト方式)', () => {
  it('全項目の期待値が一致する(想定外の項目が混入していない)', () => {
    const result = buildManualDuplicateDocData(input());
    const src = fullSource();

    expect(result).to.deep.equal({
      // 新規
      id: 'src1_dup_c-new',
      status: 'processed',
      processedAt: SERVER_TS,
      updatedAt: SERVER_TS,
      displayFileName: '提供票_テスト事業所_20261105_テスト花子.pdf',
      // 元の書類から引き継ぐ(PDFの実体は共有)
      fileId: src.fileId,
      fileName: src.fileName,
      mimeType: src.mimeType,
      fileUrl: src.fileUrl,
      targetPageNumber: src.targetPageNumber,
      sourceType: src.sourceType,
      messageId: src.messageId,
      totalPages: src.totalPages,
      ocrExcerpt: src.ocrExcerpt,
      documentType: src.documentType,
      documentTypeConfirmed: src.documentTypeConfirmed,
      category: src.category,
      officeName: src.officeName,
      officeId: src.officeId,
      officeConfirmed: src.officeConfirmed,
      officeConfirmedBy: src.officeConfirmedBy,
      officeConfirmedAt: src.officeConfirmedAt,
      officeCandidates: src.officeCandidates,
      suggestedNewOffice: src.suggestedNewOffice,
      fileDate: src.fileDate,
      fileDateFormatted: src.fileDateFormatted,
      ocrExtraction: src.ocrExtraction,
      extractionScores: src.extractionScores,
      extractionDetails: src.extractionDetails,
      pass2Promotion: src.pass2Promotion,
      // 複製専用のOCR全文
      ocrResultUrl: 'gs://bucket/ocr-results/src1_dup_c-new/run-a.txt',
      // 利用者(確定済み・確認は未)
      customerId: 'c-new',
      customerName: 'テスト花子',
      careManager: '担当乙',
      isDuplicateCustomer: false,
      needsManualCustomerSelection: false,
      customerConfirmed: true,
      confirmedBy: 'uid-operator',
      confirmedAt: SERVER_TS,
      verified: false,
      verifiedBy: null,
      verifiedAt: null,
      distributionId: 'src1',
    });
  });

  it('processedAt が入っている(未設定だと一覧の processedAt 降順取得から消える)', () => {
    expect(buildManualDuplicateDocData(input())).to.have.property('processedAt', SERVER_TS);
  });

  it('totalPages が入っている', () => {
    expect(buildManualDuplicateDocData(input())).to.have.property('totalPages', 3);
  });

  it('未確認で初期化され、元の確認状態を引き継がない(verified:false / verifiedBy:null / verifiedAt:null)', () => {
    const result = buildManualDuplicateDocData(input());
    expect(result.verified).to.equal(false);
    expect(result.verifiedBy).to.equal(null);
    expect(result.verifiedAt).to.equal(null);
  });

  it('confirmedBy は実行者の uid、confirmedAt はサーバー時刻(自動複製の null とは異なる)', () => {
    const result = buildManualDuplicateDocData(input({ confirmedByUid: 'uid-x' }));
    expect(result.confirmedBy).to.equal('uid-x');
    expect(result.confirmedAt).to.equal(SERVER_TS);
  });

  it('Drive出力系・分割系・曖昧さ・provenance・要約・集計キーを写さない', () => {
    const result = buildManualDuplicateDocData(input());
    const forbidden = [
      'driveExportStatus', 'driveFileId', 'driveExportedAt', 'driveExportError', 'driveExportRunId', 'driveExportErrorKind',
      'isSplitSource', 'splitInto', 'parentDocumentId', 'splitFromPages', 'splitSuggestions', 'pageRotations',
      'provenance', 'provenanceBackfill', 'provenanceOrigin',
      'multiCustomerDetected', 'multiCustomerCount', 'customerCandidates', 'allCustomerCandidates',
      'summary', 'summaryState', 'summaryRunId', 'summaryProvider',
      'summaryError', 'summaryErrorKind', 'summaryAttemptCount', 'summaryStateUpdatedAt', 'summaryManualRequestedAt',
      'customerKey', 'officeKey', 'documentTypeKey', 'careManagerKey',
      'ocrRunId', 'retryCount', 'ocrResult', 'pageResults',
    ];
    for (const key of forbidden) {
      expect(result, key).to.not.have.property(key);
    }
  });

  it('元の書類の利用者(customerId/customerName/careManager)を写さず、選んだ利用者で上書きする', () => {
    const result = buildManualDuplicateDocData(input());
    expect(result.customerId).to.equal('c-new');
    expect(result.customerName).to.equal('テスト花子');
    expect(result.careManager).to.equal('担当乙');
  });

  it('担当CMがマスターに無い場合、careManager は null', () => {
    const result = buildManualDuplicateDocData(
      input({ target: { customerId: 'c-new', customerName: 'テスト花子', careManagerName: null } })
    );
    expect(result.careManager).to.equal(null);
  });

  it('元の書類に無い任意項目はキー自体を作らない(Firestoreは undefined を拒否する)', () => {
    const source = fullSource();
    delete source.sourceType;
    delete source.messageId;
    delete source.category;
    delete source.ocrExcerpt;
    delete source.fileDateFormatted;
    const result = buildManualDuplicateDocData(input({ source }));
    for (const key of ['sourceType', 'messageId', 'category', 'ocrExcerpt', 'fileDateFormatted']) {
      expect(result, key).to.not.have.property(key);
    }
    expect(Object.values(result).every((v) => v !== undefined)).to.equal(true);
  });

  it('OCR全文が無い書類(ocrResultUrl: undefined)では ocrResultUrl のキーを作らない', () => {
    const result = buildManualDuplicateDocData(input({ ocrResultUrl: undefined }));
    expect(result).to.not.have.property('ocrResultUrl');
  });

  it('displayFileName は選んだ利用者名で作り直す(元の利用者名を含まない)', () => {
    const result = buildManualDuplicateDocData(input());
    expect(result.displayFileName).to.contain('テスト花子');
    expect(result.displayFileName).to.not.contain('テスト太郎');
  });

  it('fileDateFormatted が無ければ fileDate(Timestamp)から日付を作る', () => {
    const source = fullSource();
    delete source.fileDateFormatted;
    // UTC 03:00 は JST(12:00)でも UTC(03:00)でも 11/05 になる(Date#getDate はプロセスのTZ依存のため、日付がずれない時刻を選ぶ)
    source.fileDate = { seconds: Date.UTC(2026, 10, 5, 3, 0, 0) / 1000, nanoseconds: 0 };
    const result = buildManualDuplicateDocData(input({ source }));
    expect(result.displayFileName).to.equal('提供票_テスト事業所_20261105_テスト花子.pdf');
  });

  it('日付を手で直した書類は、保存済みの fileDateFormatted(古いOCR日付)でなく fileDate から displayFileName を作る', () => {
    // 手編集(useDocumentEdit)は fileDate しか更新しない。fileDateFormatted を優先すると、複製側の
    // fileDate は新しい日付なのに、Driveに出る displayFileName だけ古い日付になる。
    const source = fullSource();
    source.fileDateFormatted = '2026/11/05'; // OCRが読んだ(誤った)日付
    // 職員が 2026/11/10 に直した(JSTの0時 = 前日15:00 UTC)
    source.fileDate = { seconds: Date.UTC(2026, 10, 9, 15, 0, 0) / 1000, nanoseconds: 0 };
    const result = buildManualDuplicateDocData(input({ source }));
    expect(result.displayFileName).to.equal('提供票_テスト事業所_20261110_テスト花子.pdf');
  });

  it('fileDate を日本時間で整形する(サーバーのTZ(UTC)で整形すると、JST 0時の日付が前日になる)', () => {
    const source = fullSource();
    delete source.fileDateFormatted;
    source.fileDate = { seconds: Date.UTC(2026, 10, 9, 15, 0, 0) / 1000, nanoseconds: 0 }; // 11/10 00:00 JST
    const result = buildManualDuplicateDocData(input({ source }));
    expect(result.displayFileName).to.contain('20261110');
  });

  it('fileDate が無い書類は、保存済みの fileDateFormatted から作る', () => {
    const source = fullSource();
    delete source.fileDate;
    source.fileDateFormatted = '2026/11/05';
    const result = buildManualDuplicateDocData(input({ source }));
    expect(result.displayFileName).to.equal('提供票_テスト事業所_20261105_テスト花子.pdf');
  });

  it('有効なメタ情報が無い書類では displayFileName のキーを作らない', () => {
    const source = fullSource();
    source.documentType = '未判定';
    source.officeName = '未判定';
    delete source.fileDate;
    delete source.fileDateFormatted;
    const result = buildManualDuplicateDocData(
      input({ source, target: { customerId: 'c-new', customerName: '不明顧客', careManagerName: null } })
    );
    expect(result).to.not.have.property('displayFileName');
  });

  it('元の source オブジェクトを変更しない', () => {
    const source = fullSource();
    const before = JSON.stringify(source);
    buildManualDuplicateDocData(input({ source }));
    expect(JSON.stringify(source)).to.equal(before);
  });
});

describe('planManualDuplication (重複防止・人数上限)', () => {
  const base = {
    sourceDocId: 'src1',
    sourceCustomerId: 'c-src',
    existingGroupMembers: [] as Array<{ docId: string; customerId: string | null | undefined }>,
    existingDeterministicIds: new Set<string>(),
  };

  it('上限は 5 名', () => {
    expect(MANUAL_DUPLICATION_MAX_GROUP_SIZE).to.equal(5);
  });

  it('1名の複製: toCreate に入る', () => {
    const r = planManualDuplication({ ...base, requestedCustomerIds: ['c-a'] });
    expect(r).to.deep.equal({ ok: true, toCreate: ['c-a'], skipped: [] });
  });

  it('依頼順を保って複数名を作る', () => {
    const r = planManualDuplication({ ...base, requestedCustomerIds: ['c-b', 'c-a'] });
    expect(r).to.deep.equal({ ok: true, toCreate: ['c-b', 'c-a'], skipped: [] });
  });

  it('依頼内の重複 customerId は1件にまとめる', () => {
    const r = planManualDuplication({ ...base, requestedCustomerIds: ['c-a', 'c-a'] });
    expect(r).to.deep.equal({ ok: true, toCreate: ['c-a'], skipped: [] });
  });

  describe('入力の検証(異常系)', () => {
    it('空配列は invalid-argument', () => {
      const r = planManualDuplication({ ...base, requestedCustomerIds: [] });
      expect(r).to.deep.include({ ok: false, code: 'invalid-argument', reason: 'empty-request' });
    });

    it('空文字の customerId は invalid-argument', () => {
      const r = planManualDuplication({ ...base, requestedCustomerIds: ['c-a', ''] });
      expect(r).to.deep.include({ ok: false, code: 'invalid-argument', reason: 'invalid-customer-id' });
    });

    it('文字列でない customerId は invalid-argument', () => {
      const r = planManualDuplication({
        ...base,
        requestedCustomerIds: ['c-a', null as unknown as string],
      });
      expect(r).to.deep.include({ ok: false, code: 'invalid-argument', reason: 'invalid-customer-id' });
    });

    it('空白だけの customerId は invalid-argument', () => {
      const r = planManualDuplication({ ...base, requestedCustomerIds: ['  '] });
      expect(r).to.deep.include({ ok: false, code: 'invalid-argument', reason: 'invalid-customer-id' });
    });

    it('配列でなく文字列が渡されたら invalid-argument(1文字ずつの配列として扱わない)', () => {
      const r = planManualDuplication({ ...base, requestedCustomerIds: 'c-a' });
      expect(r).to.deep.include({ ok: false, code: 'invalid-argument', reason: 'empty-request' });
    });

    it('4名までの上限は、重複を除いた人数で判定する(重複を含めて5件でも、実際は4名ならOK)', () => {
      const r = planManualDuplication({ ...base, requestedCustomerIds: ['a', 'a', 'b', 'c', 'd'] });
      expect(r).to.deep.equal({ ok: true, toCreate: ['a', 'b', 'c', 'd'], skipped: [] });
    });

    it('パス区切り(/)を含む customerId は invalid-argument(Firestoreのドキュメントパスを壊す)', () => {
      const r = planManualDuplication({ ...base, requestedCustomerIds: ['a/../b'] });
      expect(r).to.deep.include({ ok: false, code: 'invalid-argument', reason: 'invalid-customer-id' });
    });

    it('配列でない入力は invalid-argument', () => {
      const r = planManualDuplication({
        ...base,
        requestedCustomerIds: undefined as unknown as string[],
      });
      expect(r).to.deep.include({ ok: false, code: 'invalid-argument', reason: 'empty-request' });
    });

    it('元の書類と同じ利用者を含むと invalid-argument', () => {
      const r = planManualDuplication({ ...base, requestedCustomerIds: ['c-a', 'c-src'] });
      expect(r).to.deep.include({ ok: false, code: 'invalid-argument', reason: 'same-as-source' });
    });

    it('1回の依頼は(重複を除いて)4名まで: 5名目は too-many-requested', () => {
      const r = planManualDuplication({ ...base, requestedCustomerIds: ['a', 'b', 'c', 'd', 'e'] });
      expect(r).to.deep.include({ ok: false, code: 'invalid-argument', reason: 'too-many-requested' });
    });
  });

  describe('グループ合計の上限(境界値: 5名ちょうどはOK、6名目は拒否)', () => {
    it('元の書類のみ + 4名追加 = 5名ちょうど → OK', () => {
      const r = planManualDuplication({ ...base, requestedCustomerIds: ['a', 'b', 'c', 'd'] });
      expect(r).to.deep.equal({ ok: true, toCreate: ['a', 'b', 'c', 'd'], skipped: [] });
    });

    it('既存の兄弟1件 + 4名追加 = 6名 → failed-precondition', () => {
      const r = planManualDuplication({
        ...base,
        existingGroupMembers: [{ docId: 'sib1', customerId: 'c-x' }],
        requestedCustomerIds: ['a', 'b', 'c', 'd'],
      });
      expect(r).to.deep.include({ ok: false, code: 'failed-precondition', reason: 'group-limit-exceeded' });
    });

    it('元の書類 + 既存2件 + 2名追加 = 5名ちょうど → OK', () => {
      const r = planManualDuplication({
        ...base,
        existingGroupMembers: [
          { docId: 'src1', customerId: 'c-src' },
          { docId: 'sib1', customerId: 'c-x' },
          { docId: 'sib2', customerId: 'c-y' },
        ],
        requestedCustomerIds: ['a', 'b'],
      });
      expect(r).to.deep.equal({ ok: true, toCreate: ['a', 'b'], skipped: [] });
    });

    it('元の書類 + 既存2件 + 3名追加 = 6名 → failed-precondition(回数を分けても5名を超えない)', () => {
      const r = planManualDuplication({
        ...base,
        existingGroupMembers: [
          { docId: 'src1', customerId: 'c-src' },
          { docId: 'sib1', customerId: 'c-x' },
          { docId: 'sib2', customerId: 'c-y' },
        ],
        requestedCustomerIds: ['a', 'b', 'c'],
      });
      expect(r).to.deep.include({ ok: false, code: 'failed-precondition', reason: 'group-limit-exceeded' });
    });

    it('元の書類が兄弟一覧に含まれていても二重に数えない', () => {
      // src1 が含まれる場合と含まれない場合で同じ結果になる
      const withSource = planManualDuplication({
        ...base,
        existingGroupMembers: [
          { docId: 'src1', customerId: 'c-src' },
          { docId: 'sib1', customerId: 'c-x' },
        ],
        requestedCustomerIds: ['a', 'b', 'c'],
      });
      const withoutSource = planManualDuplication({
        ...base,
        existingGroupMembers: [{ docId: 'sib1', customerId: 'c-x' }],
        requestedCustomerIds: ['a', 'b', 'c'],
      });
      expect(withSource).to.deep.equal(withoutSource);
      expect(withSource).to.deep.equal({ ok: true, toCreate: ['a', 'b', 'c'], skipped: [] });
    });

    it('作成済み(skipped)の分は人数に数えない', () => {
      const r = planManualDuplication({
        ...base,
        existingGroupMembers: [
          { docId: 'src1', customerId: 'c-src' },
          { docId: 'sib1', customerId: 'a' },
          { docId: 'sib2', customerId: 'b' },
          { docId: 'sib3', customerId: 'c' },
          { docId: 'sib4', customerId: 'd' },
        ],
        requestedCustomerIds: ['a', 'b'],
      });
      expect(r).to.deep.equal({
        ok: true,
        toCreate: [],
        skipped: [
          { customerId: 'a', reason: 'already-in-group' },
          { customerId: 'b', reason: 'already-in-group' },
        ],
      });
    });
  });

  describe('重複の防止(冪等)', () => {
    it('決定的IDのdocが既にある利用者は skipped(already-exists)', () => {
      const r = planManualDuplication({
        ...base,
        existingDeterministicIds: new Set(['src1_dup_a']),
        requestedCustomerIds: ['a', 'b'],
      });
      expect(r).to.deep.equal({
        ok: true,
        toCreate: ['b'],
        skipped: [{ customerId: 'a', reason: 'already-exists' }],
      });
    });

    it('同じ配信グループに同じ customerId の書類が既にあれば skipped(already-in-group)(以前の自動複製の分を含む)', () => {
      const r = planManualDuplication({
        ...base,
        existingGroupMembers: [{ docId: 'old-auto-copy', customerId: 'a' }],
        requestedCustomerIds: ['a', 'b'],
      });
      expect(r).to.deep.equal({
        ok: true,
        toCreate: ['b'],
        skipped: [{ customerId: 'a', reason: 'already-in-group' }],
      });
    });

    it('同じ入力を2回計画しても、2回目は全件 skipped で toCreate が空(冪等)', () => {
      const first = planManualDuplication({ ...base, requestedCustomerIds: ['a', 'b'] });
      expect(first).to.deep.include({ ok: true });
      const created = (first as { toCreate: string[] }).toCreate;

      const second = planManualDuplication({
        ...base,
        existingDeterministicIds: new Set(created.map((c) => buildManualDuplicateDocId('src1', c))),
        existingGroupMembers: created.map((c) => ({ docId: buildManualDuplicateDocId('src1', c), customerId: c })),
        requestedCustomerIds: ['a', 'b'],
      });
      expect(second).to.deep.equal({
        ok: true,
        toCreate: [],
        skipped: [
          { customerId: 'a', reason: 'already-exists' },
          { customerId: 'b', reason: 'already-exists' },
        ],
      });
    });

    it('複製後に利用者を変更しても、決定的IDが残っていれば元の利用者用は作り直せない(作成履歴としてのID)', () => {
      // sib の customerId は 'z' に変更されているが、ID は a 用のまま
      const r = planManualDuplication({
        ...base,
        existingDeterministicIds: new Set(['src1_dup_a']),
        existingGroupMembers: [{ docId: 'src1_dup_a', customerId: 'z' }],
        requestedCustomerIds: ['a'],
      });
      expect(r).to.deep.equal({
        ok: true,
        toCreate: [],
        skipped: [{ customerId: 'a', reason: 'already-exists' }],
      });
    });

    it('customerId の無い兄弟(未設定・null)は人数には数えるが利用者の重複判定には使わない', () => {
      const r = planManualDuplication({
        ...base,
        existingGroupMembers: [
          { docId: 'sib1', customerId: null },
          { docId: 'sib2', customerId: undefined },
        ],
        requestedCustomerIds: ['a', 'b'],
      });
      expect(r).to.deep.equal({ ok: true, toCreate: ['a', 'b'], skipped: [] });
    });
  });
});

describe('parseOcrRunId (OCR全文URLから ocrRunId を取り出す)', () => {
  it('gs://bucket/ocr-results/{docId}/{ocrRunId}.txt から ocrRunId を取り出す', () => {
    expect(parseOcrRunId('gs://test-bucket/ocr-results/src1/run-a.txt')).to.equal('run-a');
  });

  it('拡張子が無くても、最後の区切り以降を返す', () => {
    expect(parseOcrRunId('gs://test-bucket/ocr-results/src1/run-b')).to.equal('run-b');
  });

  it('末尾が区切りの場合・空文字は null(解釈できない)', () => {
    expect(parseOcrRunId('gs://test-bucket/ocr-results/src1/')).to.equal(null);
    expect(parseOcrRunId('')).to.equal(null);
  });
});
