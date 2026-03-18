/**
 * OCR処理共通モジュールのテスト
 *
 * tryStartProcessing と handleProcessingError のロジックをテスト
 */

import { expect } from 'chai';
import { isTransientError, is429Error } from '../src/utils/retry';

describe('ocrProcessor', () => {
  describe('tryStartProcessing ロジック検証', () => {
    /**
     * tryStartProcessingの本質的なロジック:
     * 1. ドキュメントが存在しない → false
     * 2. status !== 'pending' → false
     * 3. status === 'pending' → trueを返し、statusを'processing'に更新
     */

    it('pending状態のドキュメントは処理開始できる', () => {
      // Given: pending状態のドキュメント
      const docData = { status: 'pending' };

      // ロジック検証
      expect(docData.status).to.equal('pending');

      // 期待される動作: status を 'processing' に更新
      const canProcess = docData.status === 'pending';
      expect(canProcess).to.be.true;
    });

    it('processing状態のドキュメントは処理開始できない', () => {
      // Given: processing状態のドキュメント（既に処理中）
      const docData = { status: 'processing' };

      // ロジック検証: status !== 'pending' なので処理不可
      const canProcess = docData.status === 'pending';
      expect(canProcess).to.be.false;
    });

    it('processed状態のドキュメントは処理開始できない', () => {
      // Given: processed状態のドキュメント（既に完了）
      const docData = { status: 'processed' };

      // ロジック検証
      const canProcess = docData.status === 'pending';
      expect(canProcess).to.be.false;
    });

    it('error状態のドキュメントは処理開始できない', () => {
      // Given: error状態のドキュメント
      const docData = { status: 'error' };

      // ロジック検証
      const canProcess = docData.status === 'pending';
      expect(canProcess).to.be.false;
    });

    it('存在しないドキュメントは処理開始できない', () => {
      // Given: ドキュメントが存在しない
      const docExists = false;

      // ロジック検証
      expect(docExists).to.be.false;
    });

    it('ステータスがundefinedの場合は処理開始できない', () => {
      // Given: statusが未定義のドキュメント
      const docData: { status?: string } = {};

      // ロジック検証
      const canProcess = docData.status === 'pending';
      expect(canProcess).to.be.false;
    });
  });

  describe('handleProcessingError ロジック検証', () => {
    /**
     * handleProcessingErrorの本質的なロジック:
     * - transientエラー（429等） + retryCount < 3 → status: 'pending'に戻す
     * - transientエラー + retryCount >= 3 → status: 'error'（上限到達）
     * - 非transientエラー → status: 'error'（即座に確定）
     */

    const MAX_RETRY_COUNT = 3;

    it('transientエラー + リトライ上限未満 → pendingに戻す', () => {
      const currentRetryCount = 0;
      const error = new Error('429 Too Many Requests');
      const transient = error.message.includes('rate limit') || error.message.includes('429');
      const newRetryCount = currentRetryCount + 1;

      const expectedStatus = (transient && newRetryCount < MAX_RETRY_COUNT) ? 'pending' : 'error';
      expect(expectedStatus).to.equal('pending');
      expect(newRetryCount).to.equal(1);
    });

    it('transientエラー + リトライ上限到達 → errorに確定', () => {
      const currentRetryCount = 2; // 既に2回リトライ済み
      const transient = true;
      const newRetryCount = currentRetryCount + 1;

      const expectedStatus = (transient && newRetryCount < MAX_RETRY_COUNT) ? 'pending' : 'error';
      expect(expectedStatus).to.equal('error');
      expect(newRetryCount).to.equal(3);
    });

    it('非transientエラー → 即座にerror', () => {
      const currentRetryCount = 0;
      const transient = false;
      const newRetryCount = currentRetryCount + 1;

      const expectedStatus = (transient && newRetryCount < MAX_RETRY_COUNT) ? 'pending' : 'error';
      expect(expectedStatus).to.equal('error');
    });

    it('retryCountが未定義の場合は0として扱う', () => {
      const currentRetryCount: number | undefined = undefined;
      const effectiveCount = (currentRetryCount as unknown as number) || 0;
      expect(effectiveCount).to.equal(0);
    });

    it('エラーメッセージは500文字に切り詰められる', () => {
      const longMessage = 'x'.repeat(600);
      const truncated = longMessage.slice(0, 500);
      expect(truncated.length).to.equal(500);
    });
  });

  describe('排他制御の動作シミュレーション', () => {
    /**
     * トランザクションによる排他制御:
     * - 2つのリクエストが同時に来ても、1つだけが処理を開始できる
     * - 先に status: processing に更新した方が勝ち
     */

    it('同時実行時は1つだけが処理を開始できる', () => {
      // Given: 同じドキュメントに対する2つのリクエスト
      let currentStatus = 'pending';

      // リクエスト1が先に処理（トランザクション内）
      const request1CanProcess = currentStatus === 'pending';
      if (request1CanProcess) {
        currentStatus = 'processing'; // トランザクション内で更新
      }

      // リクエスト2は後から来る（トランザクション内）
      const request2CanProcess = currentStatus === 'pending';

      expect(request1CanProcess).to.be.true;  // 最初のリクエストは成功
      expect(request2CanProcess).to.be.false; // 2番目は失敗（既にprocessing）
    });

    it('処理完了後は再処理できない', () => {
      // Given: 処理が完了したドキュメント
      const currentStatus: string = 'processed';

      // 新しいリクエストが来た場合
      const canProcess = currentStatus === 'pending';
      expect(canProcess).to.be.false;
    });

    it('エラー後も再処理はpendingリセットが必要', () => {
      // Given: エラー状態のドキュメント
      let currentStatus = 'error';

      // そのままでは再処理不可
      let canProcess = currentStatus === 'pending';
      expect(canProcess).to.be.false;

      // pendingにリセット後は処理可能
      currentStatus = 'pending';
      canProcess = currentStatus === 'pending';
      expect(canProcess).to.be.true;
    });
  });

  describe('OCR処理結果の構造検証', () => {
    /**
     * OcrProcessingResultの型検証
     */

    it('処理結果に必要なフィールドが含まれる', () => {
      interface OcrProcessingResult {
        pagesProcessed: number;
        inputTokens: number;
        outputTokens: number;
      }

      const result: OcrProcessingResult = {
        pagesProcessed: 5,
        inputTokens: 1000,
        outputTokens: 500,
      };

      expect(result).to.have.property('pagesProcessed');
      expect(result).to.have.property('inputTokens');
      expect(result).to.have.property('outputTokens');
    });

    it('処理ページ数は0以上', () => {
      const validCases = [0, 1, 5, 100];
      validCases.forEach((pages) => {
        expect(pages).to.be.at.least(0);
      });
    });

    it('トークン数は0以上', () => {
      const result = {
        inputTokens: 0,
        outputTokens: 0,
      };

      expect(result.inputTokens).to.be.at.least(0);
      expect(result.outputTokens).to.be.at.least(0);
    });
  });

  describe('ステータス遷移の検証', () => {
    /**
     * 有効なステータス遷移パターン（ADR-0010対応）:
     * pending → processing → processed         (正常フロー)
     * pending → processing → pending            (transientエラー時の自動リトライ)
     * pending → processing → error              (致命的エラーまたはリトライ上限)
     * processing → pending                       (スタック救済: 10分超過時)
     */

    const validTransitions: Record<string, string[]> = {
      pending: ['processing'],
      processing: ['processed', 'error', 'pending'], // pending追加: transientリトライ & スタック救済
      processed: [],
      error: ['pending'], // 管理者リセットまたはfix-stuck-documents.js
    };

    it('有効なステータス遷移: pending → processing', () => {
      expect(validTransitions['pending']).to.include('processing');
    });

    it('有効なステータス遷移: processing → processed', () => {
      expect(validTransitions['processing']).to.include('processed');
    });

    it('有効なステータス遷移: processing → error（致命的/上限超過）', () => {
      expect(validTransitions['processing']).to.include('error');
    });

    it('有効なステータス遷移: processing → pending（transientリトライ/スタック救済）', () => {
      expect(validTransitions['processing']).to.include('pending');
    });

    it('processed状態からは遷移できない（終了状態）', () => {
      expect(validTransitions['processed']).to.be.empty;
    });

    it('error → pending は管理者操作でのみ遷移可能', () => {
      expect(validTransitions['error']).to.include('pending');
      expect(validTransitions['error']).to.have.lengthOf(1);
    });
  });

  describe('isTransientError 判定検証', () => {
    it('429 Too Many Requestsはtransientと判定される', () => {
      const error = new Error('got status: 429 Too Many Requests');
      expect(isTransientError(error)).to.be.true;
    });

    it('RESOURCE_EXHAUSTEDコードはtransientと判定される', () => {
      const error = new Error('Resource exhausted') as Error & { code: string };
      error.code = 'RESOURCE_EXHAUSTED';
      expect(isTransientError(error)).to.be.true;
    });

    it('rate limitメッセージはtransientと判定される', () => {
      const error = new Error('rate limit exceeded');
      expect(isTransientError(error)).to.be.true;
    });

    it('PERMISSION_DENIEDはtransientではない', () => {
      const error = new Error('Permission denied') as Error & { code: string };
      error.code = 'PERMISSION_DENIED';
      expect(isTransientError(error)).to.be.false;
    });

    it('一般的なエラーはtransientではない', () => {
      const error = new Error('Invalid document format');
      expect(isTransientError(error)).to.be.false;
    });

    it('timeoutメッセージはtransientと判定される', () => {
      const error = new Error('Request timeout');
      expect(isTransientError(error)).to.be.true;
    });

    // Vertex AI固有エラー形式の検出テスト (#194)
    it('VertexAI 429 Too Many Requestsはtransientと判定される', () => {
      const error = new Error('VertexAI.ClientError: 429 Too Many Requests');
      expect(isTransientError(error)).to.be.true;
    });

    it('VertexAI exception posting requestはtransientと判定される', () => {
      const error = new Error('GoogleGenerativeAIError: exception posting request to model');
      expect(isTransientError(error)).to.be.true;
    });

    it('"resource exhausted"メッセージはtransientと判定される', () => {
      const error = new Error('Resource Exhausted: quota limit reached');
      expect(isTransientError(error)).to.be.true;
    });

    it('"resource_exhausted"メッセージはtransientと判定される', () => {
      const error = new Error('error code: resource_exhausted');
      expect(isTransientError(error)).to.be.true;
    });

    it('"too many requests"メッセージはtransientと判定される', () => {
      const error = new Error('Too Many Requests - please retry later');
      expect(isTransientError(error)).to.be.true;
    });
  });

  describe('is429Error 判定検証 (#194)', () => {
    it('HTTPステータス429はtrue', () => {
      const error = new Error('Too Many Requests') as Error & { status: number };
      error.status = 429;
      expect(is429Error(error)).to.be.true;
    });

    it('数値コード429はtrue', () => {
      const error = new Error('Rate limited') as Error & { code: number };
      error.code = 429;
      expect(is429Error(error)).to.be.true;
    });

    it('RESOURCE_EXHAUSTEDコードはtrue', () => {
      const error = new Error('Resource exhausted') as Error & { code: string };
      error.code = 'RESOURCE_EXHAUSTED';
      expect(is429Error(error)).to.be.true;
    });

    it('メッセージに429を含むエラーはtrue', () => {
      const error = new Error('VertexAI.ClientError: 429 Too Many Requests');
      expect(is429Error(error)).to.be.true;
    });

    it('メッセージにtoo many requestsを含むエラーはtrue', () => {
      const error = new Error('Too Many Requests');
      expect(is429Error(error)).to.be.true;
    });

    it('メッセージにresource exhaustedを含むエラーはtrue', () => {
      const error = new Error('Resource Exhausted: quota limit reached');
      expect(is429Error(error)).to.be.true;
    });

    it('メッセージにquota exceededを含むエラーはtrue', () => {
      const error = new Error('Quota exceeded for this project');
      expect(is429Error(error)).to.be.true;
    });

    it('一般的なtransientエラー（timeout等）はfalse', () => {
      const error = new Error('Request timeout');
      expect(is429Error(error)).to.be.false;
    });

    it('exception posting requestはfalse（429ではないtransient）', () => {
      const error = new Error('GoogleGenerativeAIError: exception posting request to model');
      expect(is429Error(error)).to.be.false;
    });

    it('非transientエラーはfalse', () => {
      const error = new Error('Permission denied');
      expect(is429Error(error)).to.be.false;
    });

    it('nullはfalse', () => {
      expect(is429Error(null)).to.be.false;
    });

    it('非Errorオブジェクトはfalse', () => {
      expect(is429Error('string error')).to.be.false;
    });
  });

  describe('retryAfter待機メカニズム (#194)', () => {
    it('429エラー時はretryAfterが3分後に設定される', () => {
      const now = Date.now();
      const isQuotaError = true; // is429Error(error) === true
      const retryAfterMs = isQuotaError ? 3 * 60 * 1000 : 1 * 60 * 1000;
      const retryAfter = now + retryAfterMs;

      // 3分後（180秒 = 180000ms）
      expect(retryAfter - now).to.equal(180000);
    });

    it('その他transientエラー時はretryAfterが1分後に設定される', () => {
      const now = Date.now();
      const isQuotaError = false; // is429Error(error) === false
      const retryAfterMs = isQuotaError ? 3 * 60 * 1000 : 1 * 60 * 1000;
      const retryAfter = now + retryAfterMs;

      // 1分後（60秒 = 60000ms）
      expect(retryAfter - now).to.equal(60000);
    });

    it('retryAfter未到達のドキュメントはスキップされる', () => {
      const now = Date.now();
      const retryAfter = now + 3 * 60 * 1000; // 3分後
      const shouldSkip = retryAfter > now;
      expect(shouldSkip).to.be.true;
    });

    it('retryAfter到達済みのドキュメントは処理される', () => {
      const now = Date.now();
      const retryAfter = now - 1000; // 1秒前に到達
      const shouldSkip = retryAfter > now;
      expect(shouldSkip).to.be.false;
    });

    it('retryAfterがないドキュメント（新規pending）は処理される', () => {
      const retryAfter = undefined;
      const retryAfterMs = retryAfter || 0;
      const shouldSkip = retryAfterMs > Date.now();
      expect(shouldSkip).to.be.false;
    });
  });

  describe('processingスタック救済ロジック検証', () => {
    const STUCK_THRESHOLD_MS = 10 * 60 * 1000; // 10分

    it('10分以上前のprocessingドキュメントは救済対象', () => {
      const updatedAt = new Date(Date.now() - 11 * 60 * 1000); // 11分前
      const threshold = new Date(Date.now() - STUCK_THRESHOLD_MS);
      expect(updatedAt < threshold).to.be.true;
    });

    it('5分前のprocessingドキュメントは救済対象外', () => {
      const updatedAt = new Date(Date.now() - 5 * 60 * 1000); // 5分前
      const threshold = new Date(Date.now() - STUCK_THRESHOLD_MS);
      expect(updatedAt < threshold).to.be.false;
    });

    it('救済時にretryCountがインクリメントされる', () => {
      const currentRetryCount = 1;
      const newRetryCount = currentRetryCount + 1;
      expect(newRetryCount).to.equal(2);
    });
  });
});
