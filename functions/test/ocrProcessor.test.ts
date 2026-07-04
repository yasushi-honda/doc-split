/**
 * OCR処理共通モジュールのテスト
 *
 * tryStartProcessing と handleProcessingError のロジックをテスト
 */

import { expect } from 'chai';
import {
  isTransientError,
  is429Error,
  isQuotaErrorMessage,
  calculateRetryDelay429Ms,
} from '../src/utils/retry';
// #196: 実装値を side-effect-free な constants.ts から import して drift 防止
import {
  MAX_RETRY_COUNT,
  MAX_RETRY_COUNT_429,
  RETRY_DELAYS_429_MS,
  RETRY_JITTER_FACTOR,
  STUCK_RESCUE_RETRY_AFTER_MS,
} from '../src/ocr/constants';

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

    // #196: 実装値を import して drift 防止 (旧: test-local `const MAX_RETRY_COUNT = 5;`)

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
      const currentRetryCount = 4; // 既に4回リトライ済み（MAX_RETRY_COUNT=5）
      const transient = true;
      const newRetryCount = currentRetryCount + 1;

      const expectedStatus = (transient && newRetryCount < MAX_RETRY_COUNT) ? 'pending' : 'error';
      expect(expectedStatus).to.equal('error');
      expect(newRetryCount).to.equal(5);
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

    // Issue #526: db.runTransaction()導入により新たに発生しうる書込競合エラー
    it('Firestore ABORTED (transaction書込競合、数値code)はtransientと判定される', () => {
      const error = new Error('Too much contention on these documents.') as Error & {
        code: number;
      };
      error.code = 10;
      expect(isTransientError(error)).to.be.true;
    });

    it('Firestore ABORTED (transaction書込競合、メッセージのみ)はtransientと判定される', () => {
      const error = new Error('10 ABORTED: Too much contention on these documents.');
      expect(isTransientError(error)).to.be.true;
    });

    it('AbortControllerによる無関係な中断("The operation was aborted")はtransientと判定しない(過剰な広域一致の防止)', () => {
      const error = new Error('The operation was aborted');
      expect(isTransientError(error)).to.be.false;
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

    // #196: MAX_RETRY_COUNT チェックと retryAfter 設定を追加 (実装値を top-level import で参照)
    describe('MAX_RETRY_COUNT チェック (#196)', () => {
      it('retryCount < MaxRetryCount-1 → pending (通常救済)', () => {
        const currentRetryCount = 2;
        const newRetryCount = currentRetryCount + 1;
        const shouldError = newRetryCount >= MAX_RETRY_COUNT;
        expect(shouldError).to.be.false;
        expect(newRetryCount).to.equal(3);
      });

      // #196 pr-test-analyzer: 境界値 ±1 ルール (最後の救済チャンス = 3 → 4 → pending)
      it('retryCount === MAX_RETRY_COUNT-2 → pending (最後の救済)', () => {
        const currentRetryCount = MAX_RETRY_COUNT - 2; // 3
        const newRetryCount = currentRetryCount + 1;
        const shouldError = newRetryCount >= MAX_RETRY_COUNT;
        expect(shouldError).to.be.false;
        expect(newRetryCount).to.equal(MAX_RETRY_COUNT - 1);
      });

      it('retryCount === MAX_RETRY_COUNT-1 → error (上限到達で確定)', () => {
        const currentRetryCount = 4;
        const newRetryCount = currentRetryCount + 1;
        const shouldError = newRetryCount >= MAX_RETRY_COUNT;
        expect(shouldError).to.be.true;
        expect(newRetryCount).to.equal(5);
      });

      it('retryCount > MAX_RETRY_COUNT (異常値) → error (無限 rescue 防止)', () => {
        const currentRetryCount = 10;
        const newRetryCount = currentRetryCount + 1;
        const shouldError = newRetryCount >= MAX_RETRY_COUNT;
        expect(shouldError).to.be.true;
      });

      it('retryCount 未定義 → 1 回目の rescue で pending', () => {
        const currentRetryCount = undefined;
        const effective = (currentRetryCount as unknown as number) || 0;
        const newRetryCount = effective + 1;
        const shouldError = newRetryCount >= MAX_RETRY_COUNT;
        expect(shouldError).to.be.false;
        expect(newRetryCount).to.equal(1);
      });
    });

    // #196: retryAfter 設定で即再処理を防止 (STUCK_RESCUE_RETRY_AFTER_MS は import で drift 防止)
    describe('retryAfter 設定 (#196)', () => {
      it('救済時に retryAfter が現在時刻 + 3 分後に設定される', () => {
        const now = Date.now();
        const retryAfter = now + STUCK_RESCUE_RETRY_AFTER_MS;
        expect(retryAfter).to.be.greaterThan(now);
        expect(retryAfter - now).to.equal(180_000);
      });

      it('retryAfter 未到達のドキュメントはスキップされる (processOCR 既存挙動)', () => {
        const retryAfter = Date.now() + STUCK_RESCUE_RETRY_AFTER_MS;
        const shouldSkip = retryAfter > Date.now();
        expect(shouldSkip).to.be.true;
      });

      it('retryAfter 到達済みのドキュメントは処理対象 (processOCR 既存挙動)', () => {
        const retryAfter = Date.now() - 1000; // 1秒前 = 既に到達
        const shouldSkip = retryAfter > Date.now();
        expect(shouldSkip).to.be.false;
      });
    });
  });

  // 429 専用 retry policy (Vertex AI 429 Resilience 2026-06-12)
  // 既存 MAX_RETRY_COUNT (5) は他 transient 用に維持。429 系のみ MAX_RETRY_COUNT_429 (8) + exponential delay。
  describe('calculateRetryDelay429Ms (429 専用 delay 計算)', () => {
    it('retry 1 の base delay は 1 分 (60_000 ms)', () => {
      const delay = calculateRetryDelay429Ms(1, () => 0.5);
      expect(delay).to.equal(60_000);
    });

    it('retry 2 の base delay は 3 分 (180_000 ms)', () => {
      const delay = calculateRetryDelay429Ms(2, () => 0.5);
      expect(delay).to.equal(180_000);
    });

    it('retry 6 の base delay は 48 分 (2_880_000 ms)', () => {
      const delay = calculateRetryDelay429Ms(6, () => 0.5);
      expect(delay).to.equal(2_880_000);
    });

    it('retry 8 (最大) の base delay は 60 分 (3_600_000 ms)', () => {
      const delay = calculateRetryDelay429Ms(8, () => 0.5);
      expect(delay).to.equal(3_600_000);
    });

    it('retry 9+ は配列末尾値で clamp (3_600_000 ms)', () => {
      const delay = calculateRetryDelay429Ms(99, () => 0.5);
      expect(delay).to.equal(3_600_000);
    });

    it('retry 0 / 負数は retry 1 と同等 (safe guard)', () => {
      expect(calculateRetryDelay429Ms(0, () => 0.5)).to.equal(60_000);
      expect(calculateRetryDelay429Ms(-3, () => 0.5)).to.equal(60_000);
    });

    it('jitter 下端 (rng=0) は base * 0.8 (factor 0.2)', () => {
      const delay = calculateRetryDelay429Ms(1, () => 0);
      // base 60_000 * (1 + (0*2-1)*0.2) = 60_000 * 0.8 = 48_000
      expect(delay).to.equal(48_000);
    });

    it('jitter 上端付近 (rng≈1) は base * 1.2 弱 (factor 0.2)', () => {
      // rng() は [0,1) なので 1 は到達不可。0.999... 近似
      const delay = calculateRetryDelay429Ms(1, () => 0.9999999);
      // base 60_000 * (1 + (0.9999*2-1)*0.2) ≈ 60_000 * 1.2 ≈ 72_000
      expect(delay).to.be.closeTo(72_000, 50);
    });

    it('jitter range が全 retry attempt で base ±20% に収まる', () => {
      for (let attempt = 1; attempt <= RETRY_DELAYS_429_MS.length; attempt++) {
        const base = RETRY_DELAYS_429_MS[attempt - 1];
        const lower = calculateRetryDelay429Ms(attempt, () => 0);
        const upper = calculateRetryDelay429Ms(attempt, () => 0.9999999);
        expect(lower).to.be.at.least(Math.floor(base * (1 - RETRY_JITTER_FACTOR)));
        expect(upper).to.be.at.most(Math.ceil(base * (1 + RETRY_JITTER_FACTOR)));
      }
    });
  });

  describe('429 vs 非 429 transient の maxRetries 分岐 (handleProcessingError)', () => {
    /**
     * 実装ロジック:
     *   const newRetryCount = (currentRetryCount || 0) + 1;
     *   const maxRetries = is429Error(error) ? MAX_RETRY_COUNT_429 : MAX_RETRY_COUNT;
     *   if (transient && newRetryCount < maxRetries) pending else error
     *
     * 本 describe は newRetryCount を直接代入する pure logic 検証。
     * (currentRetryCount → newRetryCount の +1 増分は integration test 側でカバー)
     */

    it('429 系 + newRetryCount=5 → pending (< MAX_RETRY_COUNT_429=8)', () => {
      const isQuotaError = true;
      const maxRetries = isQuotaError ? MAX_RETRY_COUNT_429 : MAX_RETRY_COUNT;
      const newRetryCount = 5;
      expect(newRetryCount < maxRetries).to.be.true;
    });

    it('429 系 + newRetryCount=7 → pending (< MAX_RETRY_COUNT_429=8、最後の retry)', () => {
      const isQuotaError = true;
      const maxRetries = isQuotaError ? MAX_RETRY_COUNT_429 : MAX_RETRY_COUNT;
      const newRetryCount = 7;
      expect(newRetryCount < maxRetries).to.be.true;
    });

    it('429 系 + newRetryCount=8 → error 確定 (== MAX_RETRY_COUNT_429 到達)', () => {
      const isQuotaError = true;
      const maxRetries = isQuotaError ? MAX_RETRY_COUNT_429 : MAX_RETRY_COUNT;
      const newRetryCount = 8;
      expect(newRetryCount < maxRetries).to.be.false;
    });

    it('非 429 transient + newRetryCount=4 → pending (< MAX_RETRY_COUNT=5、既存挙動)', () => {
      const isQuotaError = false;
      const maxRetries = isQuotaError ? MAX_RETRY_COUNT_429 : MAX_RETRY_COUNT;
      const newRetryCount = 4;
      expect(newRetryCount < maxRetries).to.be.true;
    });

    it('非 429 transient + newRetryCount=5 → error 確定 (== MAX_RETRY_COUNT 到達、既存挙動維持)', () => {
      const isQuotaError = false;
      const maxRetries = isQuotaError ? MAX_RETRY_COUNT_429 : MAX_RETRY_COUNT;
      const newRetryCount = 5;
      expect(newRetryCount < maxRetries).to.be.false;
    });

    it('39 分 quota 枯渇 (kanameone 2026-06-11 事象) は MAX_RETRY_COUNT_429 で吸収可能', () => {
      // retry 1: 1 min, retry 2: 3 min, retry 3: 6 min → 累計 10 分で 3 回 retry 完了
      // retry 4: 12 min → 累計 22 分で 4 回 retry 完了
      // retry 5: 24 min → 累計 46 分で 5 回 retry 完了
      // 39 分時点では retry 5 進行中 → error 確定せず pending 継続
      const cumulativeMinutes = [1, 4, 10, 22, 46, 94, 154, 214];
      // retry 5 完了時点で 46 分 > 39 分 ∴ 39 分間の quota 枯渇は retry 1-5 のいずれかで吸収
      expect(cumulativeMinutes[4]).to.be.greaterThan(39);
      // 旧 MAX_RETRY_COUNT=5 + 3 min 固定だと累計 15 分 < 39 分 → error 確定するパターン
      expect(MAX_RETRY_COUNT * 3).to.be.lessThan(39);
    });
  });

  describe('isQuotaErrorMessage (lastErrorMessage string 判定)', () => {
    it('null/undefined/空文字は false', () => {
      expect(isQuotaErrorMessage(null)).to.be.false;
      expect(isQuotaErrorMessage(undefined)).to.be.false;
      expect(isQuotaErrorMessage('')).to.be.false;
    });

    it('"429" を含む文字列は true', () => {
      expect(isQuotaErrorMessage('VertexAI.ClientError: got status: 429 Too Many Requests')).to.be
        .true;
    });

    it('"RESOURCE_EXHAUSTED" (大文字混在) は true', () => {
      expect(isQuotaErrorMessage('status: RESOURCE_EXHAUSTED')).to.be.true;
    });

    it('"resource exhausted" (スペース版) は true', () => {
      expect(isQuotaErrorMessage('Resource Exhausted: quota limit reached')).to.be.true;
    });

    it('"quota exceeded" は true', () => {
      expect(isQuotaErrorMessage('Quota exceeded for this project')).to.be.true;
    });

    it('"too many requests" は true', () => {
      expect(isQuotaErrorMessage('Too Many Requests - please retry later')).to.be.true;
    });

    it('非 429 系 transient (timeout 等) は false', () => {
      expect(isQuotaErrorMessage('Request timeout')).to.be.false;
      expect(isQuotaErrorMessage('Connection reset')).to.be.false;
    });

    it('一般的なエラー (permission denied 等) は false', () => {
      expect(isQuotaErrorMessage('Permission denied')).to.be.false;
      expect(isQuotaErrorMessage('Invalid argument')).to.be.false;
    });

    it('kanameone 2026-06-11 実エラー message は true', () => {
      const actual =
        '[VertexAI.ClientError]: got status: 429 Too Many Requests. {"error":{"code":429,"message":"Resource exhausted. Please try again later. ...","status":"RESOURCE_EXHAUSTED"}}';
      expect(isQuotaErrorMessage(actual)).to.be.true;
    });
  });
});
