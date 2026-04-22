/**
 * evaluateReimportDecision unit test (Issue #375)
 *
 * Gmail 添付ファイルの hash 重複 + isSplitSource=true 再取り込み判定 pure helper のテスト。
 * production (checkGmailAttachments.ts) と integration test
 * (gmailAttachmentIntegration.test.ts) が共有する helper の全分岐を lock-in する。
 *
 * 方針: helper は純粋関数なので Firestore emulator 不要 (unit test)。
 * 既存の integration test は I/O を含む契約として別途保持 (#200 AC4)。
 */

import { expect } from 'chai';
import {
  evaluateReimportDecision,
  resolveExistingLogData,
} from '../src/gmail/reimportPolicy';

describe('evaluateReimportDecision (#375 pure helper)', () => {
  describe('verdict="new" (hash 未登録)', () => {
    it('両方 empty → new / fileUrl=null', () => {
      const decision = evaluateReimportDecision({
        existingGmailLogData: null,
        existingUploadLogData: null,
        relatedDocsData: [],
      });
      expect(decision).to.deep.equal({ verdict: 'new', fileUrl: null });
    });

    it('両方 empty + relatedDocsData 非空 (理論上起こらない) → new で lock-in (防御)', () => {
      // 両方 empty なら caller は relatedDocs query をしないが、helper 単体としては
      // log 両方 null のとき relatedDocsData を読まず new を返す契約を lock-in する。
      const decision = evaluateReimportDecision({
        existingGmailLogData: null,
        existingUploadLogData: null,
        relatedDocsData: [{ isSplitSource: false }],
      });
      expect(decision.verdict).to.equal('new');
      expect(decision.fileUrl).to.equal(null);
    });
  });

  describe('verdict="skip" (重複 + アクティブ doc あり / fileUrl 欠損)', () => {
    it('gmailLog あり + fileUrl 欠損 → skip / fileUrl=null (legacy record 後方互換)', () => {
      const decision = evaluateReimportDecision({
        existingGmailLogData: {},
        existingUploadLogData: null,
        relatedDocsData: [],
      });
      expect(decision).to.deep.equal({ verdict: 'skip', fileUrl: null });
    });

    it('uploadLog あり + fileUrl 欠損 → skip / fileUrl=null', () => {
      const decision = evaluateReimportDecision({
        existingGmailLogData: null,
        existingUploadLogData: {},
        relatedDocsData: [],
      });
      expect(decision).to.deep.equal({ verdict: 'skip', fileUrl: null });
    });

    it('gmailLog + fileUrl あり + アクティブ doc (isSplitSource 未設定) あり → skip', () => {
      const fileUrl = 'gs://bucket/original/1700_a.pdf';
      const decision = evaluateReimportDecision({
        existingGmailLogData: { fileUrl },
        existingUploadLogData: null,
        relatedDocsData: [{}, { isSplitSource: true }],
      });
      expect(decision).to.deep.equal({ verdict: 'skip', fileUrl });
    });

    it('gmailLog + fileUrl あり + アクティブ doc (isSplitSource=false 明示) あり → skip', () => {
      const fileUrl = 'gs://bucket/original/1700_b.pdf';
      const decision = evaluateReimportDecision({
        existingGmailLogData: { fileUrl },
        existingUploadLogData: null,
        relatedDocsData: [{ isSplitSource: false }],
      });
      expect(decision).to.deep.equal({ verdict: 'skip', fileUrl });
    });
  });

  describe('verdict="reimport" (全て split source または関連 doc ゼロ)', () => {
    it('gmailLog + fileUrl あり + 全 doc isSplitSource=true → reimport', () => {
      const fileUrl = 'gs://bucket/original/1700_all_split.pdf';
      const decision = evaluateReimportDecision({
        existingGmailLogData: { fileUrl },
        existingUploadLogData: null,
        relatedDocsData: [
          { isSplitSource: true },
          { isSplitSource: true },
        ],
      });
      expect(decision).to.deep.equal({ verdict: 'reimport', fileUrl });
    });

    it('gmailLog + fileUrl あり + 関連 doc 0 件 (全削除後) → reimport', () => {
      const fileUrl = 'gs://bucket/original/1700_no_docs.pdf';
      const decision = evaluateReimportDecision({
        existingGmailLogData: { fileUrl },
        existingUploadLogData: null,
        relatedDocsData: [],
      });
      expect(decision).to.deep.equal({ verdict: 'reimport', fileUrl });
    });

    it('uploadLog + fileUrl あり + 全 doc isSplitSource=true → reimport', () => {
      const fileUrl = 'gs://bucket/uploaded/uploaded.pdf';
      const decision = evaluateReimportDecision({
        existingGmailLogData: null,
        existingUploadLogData: { fileUrl },
        relatedDocsData: [{ isSplitSource: true }],
      });
      expect(decision).to.deep.equal({ verdict: 'reimport', fileUrl });
    });
  });

  describe('resolveExistingLogData (優先順位 helper、production/test/内部の 3 重管理防止)', () => {
    it('両方 null → null', () => {
      expect(resolveExistingLogData(null, null)).to.equal(null);
    });

    it('gmailLog のみ → gmailLog', () => {
      const gmail = { fileUrl: 'gs://bucket/a.pdf' };
      expect(resolveExistingLogData(gmail, null)).to.equal(gmail);
    });

    it('uploadLog のみ → uploadLog', () => {
      const upload = { fileUrl: 'gs://bucket/b.pdf' };
      expect(resolveExistingLogData(null, upload)).to.equal(upload);
    });

    it('両方あり → gmailLog 優先 (uploadLog は返さない、同一参照)', () => {
      const gmail = { fileUrl: 'gs://bucket/gmail.pdf' };
      const upload = { fileUrl: 'gs://bucket/upload.pdf' };
      const resolved = resolveExistingLogData(gmail, upload);
      expect(resolved).to.equal(gmail);
      expect(resolved).to.not.equal(upload);
    });
  });

  describe('AC4 bundle: gmailLogs 優先 (source:294-296 lock-in)', () => {
    it('gmailLog と uploadLog 両方に hash 一致 + 別 fileUrl → gmailLog 側 fileUrl を返す', () => {
      // PR #374 pr-test-analyzer rating 7 指摘: source は !existingGmailLog.empty 判定で
      // gmailLog を優先採用する。両方ヒットしたときに uploadLog 側 fileUrl が silent に
      // 使われる regression を防ぐ契約。
      const gmailUrl = 'gs://bucket/original/from-gmail.pdf';
      const uploadUrl = 'gs://bucket/uploaded/from-upload.pdf';

      const decision = evaluateReimportDecision({
        existingGmailLogData: { fileUrl: gmailUrl },
        existingUploadLogData: { fileUrl: uploadUrl },
        relatedDocsData: [{ isSplitSource: true }],
      });

      // reimport 時は gmailLog 側 fileUrl
      expect(decision.verdict).to.equal('reimport');
      expect(decision.fileUrl).to.equal(gmailUrl);
      expect(decision.fileUrl).to.not.equal(uploadUrl);
    });

    it('gmailLog fileUrl 欠損 + uploadLog fileUrl あり + 両方 hash 一致 → skip (gmailLog 優先 / fileUrl 欠損)', () => {
      // gmailLog 優先は fileUrl 有無に関わらず適用される。gmailLog を優先した結果
      // fileUrl 欠損なら skip (legacy 互換)。uploadLog 側 fileUrl に「降格」しない。
      const decision = evaluateReimportDecision({
        existingGmailLogData: {},
        existingUploadLogData: { fileUrl: 'gs://bucket/uploaded/fallback.pdf' },
        relatedDocsData: [],
      });
      expect(decision).to.deep.equal({ verdict: 'skip', fileUrl: null });
    });

    it('gmailLog と uploadLog 両方に hash 一致 + 同 fileUrl + アクティブ doc あり → skip', () => {
      const fileUrl = 'gs://bucket/original/same-url.pdf';
      const decision = evaluateReimportDecision({
        existingGmailLogData: { fileUrl },
        existingUploadLogData: { fileUrl },
        relatedDocsData: [{}],
      });
      expect(decision).to.deep.equal({ verdict: 'skip', fileUrl });
    });
  });
});
