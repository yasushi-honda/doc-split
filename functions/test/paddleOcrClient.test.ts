/**
 * paddleOcrClient.ts: ocrWithPaddle テスト (ADR-0025 PR5)
 *
 * fetch/認証をdeps経由でmockし、実ネットワーク・実IDトークン取得を発生させない。
 * リトライ判定・タイムアウト変換・fail-loud挙動・ステータス別リトライ分類を検証する。
 */

import { expect } from 'chai';
import { ocrWithPaddle, type PaddleOcrDeps } from '../src/ocr/paddleOcrClient';

const CONFIG = { serviceUrl: 'https://paddle-ocr.example.run.app', requestTimeoutMs: 1000 };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const FAST_RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 1,
  maxDelayMs: 5,
  backoffMultiplier: 1,
};

function withNoDelay(deps: Partial<PaddleOcrDeps>): PaddleOcrDeps {
  return {
    config: CONFIG,
    getAuthHeaders: async () => ({ Authorization: 'Bearer test-id-token' }),
    retryConfig: FAST_RETRY_CONFIG,
    ...deps,
  };
}

describe('paddleOcrClient: ocrWithPaddle (ADR-0025 PR5)', () => {
  it('PADDLE_OCR_URL未設定時はGeminiへフォールバックせず即座にエラーとなる(ネットワーク呼出し無し)', async () => {
    let fetchCalled = false;
    const deps: PaddleOcrDeps = {
      config: { serviceUrl: '', requestTimeoutMs: 1000 },
      fetchImpl: (async () => {
        fetchCalled = true;
        throw new Error('should not be called');
      }) as typeof fetch,
    };

    try {
      await ocrWithPaddle(Buffer.from('x'), 'image/png', 1, deps);
      expect.fail('エラーがthrowされるべき');
    } catch (err) {
      expect((err as Error).message).to.include('PADDLE_OCR_URL');
    }
    expect(fetchCalled, 'サービスURL未設定時はfetchを呼び出してはならない').to.equal(false);
  });

  it('成功時はtext/engine/modelVersion/processingMsを転記し、トークン数は全て0を返す', async () => {
    const deps = withNoDelay({
      fetchImpl: (async (input, init) => {
        expect(String(input)).to.equal(`${CONFIG.serviceUrl}/ocr`);
        expect((init?.headers as Record<string, string>).Authorization).to.equal(
          'Bearer test-id-token'
        );
        expect((init?.headers as Record<string, string>)['Content-Type']).to.equal(
          'application/pdf'
        );
        return jsonResponse(200, {
          text: '1ページ目',
          pages: ['1ページ目'],
          pageCount: 1,
          engine: 'paddleocr',
          modelVersion: 'PP-OCRv6_medium/det:abc/rec:def',
          lang: 'japan',
          renderDpi: 200,
          processingMs: 1234,
        });
      }) as typeof fetch,
    });

    const result = await ocrWithPaddle(Buffer.from('pdf-bytes'), 'application/pdf', 1, deps);

    expect(result.text).to.equal('1ページ目');
    expect(result.engine).to.equal('paddleocr');
    expect(result.modelVersion).to.equal('PP-OCRv6_medium/det:abc/rec:def');
    expect(result.processingMs).to.equal(1234);
    expect(result.inputTokens).to.equal(0);
    expect(result.outputTokens).to.equal(0);
    expect(result.thinkingTokens).to.equal(0);
  });

  it('AbortSignal.timeout()由来のタイムアウトはリトライ対象になり、最終的に失敗する', async () => {
    let callCount = 0;
    const deps = withNoDelay({
      fetchImpl: (async () => {
        callCount++;
        const timeoutError = new DOMException('The operation was aborted', 'TimeoutError');
        throw timeoutError;
      }) as typeof fetch,
    });

    try {
      await ocrWithPaddle(Buffer.from('x'), 'image/png', 1, deps);
      expect.fail('エラーがthrowされるべき');
    } catch (err) {
      expect((err as Error & { code?: string }).code).to.equal('ETIMEDOUT');
    }
    // RETRY_CONFIGS.paddleOcr: maxRetries=3 → 初回+3リトライ=計4回呼び出される
    expect(callCount).to.equal(4);
  });

  it('403(IAM不備)は即座にfail-loudし、リトライしない', async () => {
    let callCount = 0;
    const deps = withNoDelay({
      fetchImpl: (async () => {
        callCount++;
        return jsonResponse(403, { error: { code: 'PERMISSION_DENIED', message: 'forbidden' } });
      }) as typeof fetch,
    });

    try {
      await ocrWithPaddle(Buffer.from('x'), 'image/png', 1, deps);
      expect.fail('エラーがthrowされるべき');
    } catch (err) {
      expect((err as Error & { status?: number }).status).to.equal(403);
    }
    expect(callCount, '403はリトライ対象外のため1回のみ呼び出されるべき').to.equal(1);
  });

  it('400(EMPTY_BODY)は即座にfail-loudし、リトライしない', async () => {
    let callCount = 0;
    const deps = withNoDelay({
      fetchImpl: (async () => {
        callCount++;
        return jsonResponse(400, { error: { code: 'EMPTY_BODY', message: 'empty' } });
      }) as typeof fetch,
    });

    try {
      await ocrWithPaddle(Buffer.from('x'), 'image/png', 1, deps);
      expect.fail('エラーがthrowされるべき');
    } catch (err) {
      expect((err as Error & { status?: number }).status).to.equal(400);
    }
    expect(callCount).to.equal(1);
  });

  it('413(PAYLOAD_TOO_LARGE)は即座にfail-loudし、リトライしない', async () => {
    let callCount = 0;
    const deps = withNoDelay({
      fetchImpl: (async () => {
        callCount++;
        return jsonResponse(413, { error: { code: 'PAYLOAD_TOO_LARGE', message: 'too large' } });
      }) as typeof fetch,
    });

    try {
      await ocrWithPaddle(Buffer.from('x'), 'image/png', 1, deps);
      expect.fail('エラーがthrowされるべき');
    } catch (err) {
      expect((err as Error & { status?: number }).status).to.equal(413);
    }
    expect(callCount).to.equal(1);
  });

  it('429はリトライ対象になり、リトライ後に成功すれば結果を返す', async () => {
    let callCount = 0;
    const deps = withNoDelay({
      fetchImpl: (async () => {
        callCount++;
        if (callCount < 2) {
          return jsonResponse(429, { error: { code: 'RESOURCE_EXHAUSTED', message: 'busy' } });
        }
        return jsonResponse(200, {
          text: 'retried-ok',
          engine: 'paddleocr',
          modelVersion: 'PP-OCRv6_medium/det:abc/rec:def',
          processingMs: 500,
        });
      }) as typeof fetch,
    });

    const result = await ocrWithPaddle(Buffer.from('x'), 'image/png', 1, deps);
    expect(result.text).to.equal('retried-ok');
    expect(callCount).to.equal(2);
  });

  it('5xx(OCR_ENGINE_ERROR)はリトライ対象になる', async () => {
    let callCount = 0;
    const deps = withNoDelay({
      fetchImpl: (async () => {
        callCount++;
        if (callCount < 2) {
          return jsonResponse(500, { error: { code: 'OCR_ENGINE_ERROR', message: 'crashed' } });
        }
        return jsonResponse(200, {
          text: 'recovered',
          engine: 'paddleocr',
          modelVersion: 'PP-OCRv6_medium/det:abc/rec:def',
          processingMs: 500,
        });
      }) as typeof fetch,
    });

    const result = await ocrWithPaddle(Buffer.from('x'), 'image/png', 1, deps);
    expect(result.text).to.equal('recovered');
    expect(callCount).to.equal(2);
  });
});
