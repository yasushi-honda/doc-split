/**
 * sarashinaSummaryClient.ts: summarizeWithSarashina テスト (ADR-0027 PR3)
 *
 * fetch/認証をdeps経由でmockし、実ネットワーク・実IDトークン取得を発生させない。
 * paddleOcrClient.test.tsと同じDIパターン(jsonResponse/withNoDelay)を踏襲しつつ、
 * ADR-0027設計判断8(timeout/504はその場でリトライしない)固有の分類を検証する。
 */

import { expect } from 'chai';
import {
  summarizeWithSarashina,
  SarashinaSummaryError,
  type SarashinaSummaryDeps,
} from '../src/ocr/sarashinaSummaryClient';

const CONFIG = { serviceUrl: 'https://sarashina-summary.example.run.app', requestTimeoutMs: 1000 };
const ENDPOINT = `${CONFIG.serviceUrl}/v1/chat/completions`;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** attempts=2 (初回+1回リトライ)、待機なしでテストを高速化する。 */
const FAST_RETRY = { attempts: 2, baseDelayMs: 0 };

function withNoDelay(deps: Partial<SarashinaSummaryDeps>): SarashinaSummaryDeps {
  return {
    config: CONFIG,
    getAuthHeaders: async () => ({ Authorization: 'Bearer test-id-token' }),
    retry: FAST_RETRY,
    ...deps,
  };
}

function successBody(content: string, finishReason = 'stop', model: string | null = 'sarashina2.2-3b-instruct-v0.1-Q8_0') {
  return { choices: [{ message: { content }, finish_reason: finishReason }], model };
}

describe('summarizeWithSarashina (ADR-0027 PR3)', () => {
  describe('config エラー(通信なし)', () => {
    it('URL未設定時はfetchを呼び出さずconfigエラーになる', async () => {
      let fetchCalled = false;
      const deps: SarashinaSummaryDeps = {
        config: { serviceUrl: '', requestTimeoutMs: 1000 },
        fetchImpl: (async () => {
          fetchCalled = true;
          throw new Error('should not be called');
        }) as typeof fetch,
      };
      try {
        await summarizeWithSarashina('プロンプト', deps);
        expect.fail('エラーがthrowされるべき');
      } catch (err) {
        expect(err).to.be.instanceOf(SarashinaSummaryError);
        expect((err as SarashinaSummaryError).kind).to.equal('config');
      }
      expect(fetchCalled).to.equal(false);
    });

    it('プレースホルダ値("<TBD>")はhttps絶対URLでないためconfigエラーになる(fetch未呼出)', async () => {
      let fetchCalled = false;
      const deps: SarashinaSummaryDeps = {
        config: { serviceUrl: '<TBD>', requestTimeoutMs: 1000 },
        fetchImpl: (async () => {
          fetchCalled = true;
          throw new Error('should not be called');
        }) as typeof fetch,
      };
      try {
        await summarizeWithSarashina('プロンプト', deps);
        expect.fail('エラーがthrowされるべき');
      } catch (err) {
        expect((err as SarashinaSummaryError).kind).to.equal('config');
      }
      expect(fetchCalled).to.equal(false);
    });

    it('http(非https)URLもconfigエラーになる(fetch未呼出)', async () => {
      const deps: SarashinaSummaryDeps = {
        config: { serviceUrl: 'http://sarashina-summary.example.run.app', requestTimeoutMs: 1000 },
        fetchImpl: (async () => {
          throw new Error('should not be called');
        }) as typeof fetch,
      };
      try {
        await summarizeWithSarashina('プロンプト', deps);
        expect.fail('エラーがthrowされるべき');
      } catch (err) {
        expect((err as SarashinaSummaryError).kind).to.equal('config');
      }
    });
  });

  describe('リクエスト形状', () => {
    it('エンドポイント・認証ヘッダー・bodyがPR2b検証済み形状と一致する(末尾スラッシュ除去含む)', async () => {
      const deps = withNoDelay({
        config: { serviceUrl: 'https://sarashina-summary.example.run.app/', requestTimeoutMs: 1000 },
        getAuthHeaders: async (audience) => {
          expect(audience).to.equal('https://sarashina-summary.example.run.app');
          return { Authorization: 'Bearer test-id-token' };
        },
        fetchImpl: (async (input, init) => {
          expect(String(input)).to.equal(ENDPOINT);
          expect((init?.headers as Record<string, string>).Authorization).to.equal('Bearer test-id-token');
          expect((init?.headers as Record<string, string>)['Content-Type']).to.equal('application/json');
          const body = JSON.parse(String(init?.body));
          expect(body).to.deep.equal({
            messages: [{ role: 'user', content: 'プロンプト本文' }],
            max_tokens: 1024,
            temperature: 0.2,
            cache_prompt: false,
            chat_template_kwargs: { enable_thinking: false },
          });
          return jsonResponse(200, successBody('要約結果'));
        }) as typeof fetch,
      });
      const result = await summarizeWithSarashina('プロンプト本文', deps);
      expect(result.text).to.equal('要約結果');
      expect(result.finishReason).to.equal('stop');
      expect(result.model).to.equal('sarashina2.2-3b-instruct-v0.1-Q8_0');
    });

    it('IDトークン取得失敗はtransient扱いで1回リトライされる', async () => {
      let authCalls = 0;
      let fetchCalls = 0;
      const deps = withNoDelay({
        getAuthHeaders: async () => {
          authCalls++;
          if (authCalls === 1) throw new Error('metadata server unavailable');
          return { Authorization: 'Bearer test-id-token' };
        },
        fetchImpl: (async () => {
          fetchCalls++;
          return jsonResponse(200, successBody('ok'));
        }) as typeof fetch,
      });
      const result = await summarizeWithSarashina('p', deps);
      expect(result.text).to.equal('ok');
      expect(authCalls).to.equal(2);
      expect(fetchCalls).to.equal(1);
    });
  });

  describe('timeout/504(その場でリトライしない、ADR-0027 設計判断8)', () => {
    it('AbortSignal timeout(TimeoutError)はkind:timeoutで1回のみ試行される', async () => {
      let calls = 0;
      const deps = withNoDelay({
        fetchImpl: (async () => {
          calls++;
          throw new DOMException('The operation was aborted', 'TimeoutError');
        }) as typeof fetch,
      });
      try {
        await summarizeWithSarashina('p', deps);
        expect.fail('エラーがthrowされるべき');
      } catch (err) {
        expect((err as SarashinaSummaryError).kind).to.equal('timeout');
      }
      expect(calls, '二重推論防止のためリトライしない').to.equal(1);
    });

    it('504はkind:timeoutで1回のみ試行される(サーバーが生成継続中の可能性があるため再送しない)', async () => {
      let calls = 0;
      const deps = withNoDelay({
        fetchImpl: (async () => {
          calls++;
          return new Response('Gateway Timeout', { status: 504 });
        }) as typeof fetch,
      });
      try {
        await summarizeWithSarashina('p', deps);
        expect.fail('エラーがthrowされるべき');
      } catch (err) {
        expect((err as SarashinaSummaryError).kind).to.equal('timeout');
        expect((err as SarashinaSummaryError).httpStatus).to.equal(504);
      }
      expect(calls).to.equal(1);
    });

    it('接続後のネットワーク失敗(ECONNRESET)はkind:timeoutで1回のみ試行される(サーバー到達可否を判断できないため)', async () => {
      let calls = 0;
      const deps = withNoDelay({
        fetchImpl: (async () => {
          calls++;
          const err = new TypeError('fetch failed');
          (err as unknown as { cause: unknown }).cause = Object.assign(new Error('socket hang up'), {
            code: 'ECONNRESET',
          });
          throw err;
        }) as typeof fetch,
      });
      try {
        await summarizeWithSarashina('p', deps);
        expect.fail('エラーがthrowされるべき');
      } catch (err) {
        expect((err as SarashinaSummaryError).kind).to.equal('timeout');
      }
      expect(calls).to.equal(1);
    });

    it('cause情報が全く無い未知のネットワーク失敗も安全側でkind:timeout扱いになる(未知のエラーコードをtransientへ広げない)', async () => {
      let calls = 0;
      const deps = withNoDelay({
        fetchImpl: (async () => {
          calls++;
          throw new TypeError('fetch failed');
        }) as typeof fetch,
      });
      try {
        await summarizeWithSarashina('p', deps);
        expect.fail('エラーがthrowされるべき');
      } catch (err) {
        expect((err as SarashinaSummaryError).kind).to.equal('timeout');
      }
      expect(calls).to.equal(1);
    });
  });

  describe('接続確立前のネットワーク失敗(transient、1回リトライ)', () => {
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']) {
      it(`${code}はkind:transientとして1回リトライされ、成功すれば結果を返す`, async () => {
        let calls = 0;
        const deps = withNoDelay({
          fetchImpl: (async () => {
            calls++;
            if (calls === 1) {
              const err = new TypeError('fetch failed');
              (err as unknown as { cause: unknown }).cause = Object.assign(new Error(code), { code });
              throw err;
            }
            return jsonResponse(200, successBody('ok'));
          }) as typeof fetch,
        });
        const result = await summarizeWithSarashina('p', deps);
        expect(result.text).to.equal('ok');
        expect(calls).to.equal(2);
      });
    }

    it('nested cause(cause.cause.code)も検出できる', async () => {
      let calls = 0;
      const deps = withNoDelay({
        fetchImpl: (async () => {
          calls++;
          if (calls === 1) {
            const inner = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
            const outer = new TypeError('fetch failed');
            (outer as unknown as { cause: unknown }).cause = { cause: inner };
            throw outer;
          }
          return jsonResponse(200, successBody('ok'));
        }) as typeof fetch,
      });
      const result = await summarizeWithSarashina('p', deps);
      expect(result.text).to.equal('ok');
      expect(calls).to.equal(2);
    });
  });

  describe('429/500/502/503(transient、1回リトライ)', () => {
    for (const status of [429, 500, 502, 503]) {
      it(`${status}は1回リトライされ、成功すれば結果を返す`, async () => {
        let calls = 0;
        const deps = withNoDelay({
          fetchImpl: (async () => {
            calls++;
            if (calls === 1) return new Response('', { status });
            return jsonResponse(200, successBody('ok'));
          }) as typeof fetch,
        });
        const result = await summarizeWithSarashina('p', deps);
        expect(result.text).to.equal('ok');
        expect(calls).to.equal(2);
      });
    }

    it('429がリトライ上限を超えると2回試行のうえkind:transientでthrowする', async () => {
      let calls = 0;
      const deps = withNoDelay({
        fetchImpl: (async () => {
          calls++;
          return new Response('', { status: 429 });
        }) as typeof fetch,
      });
      try {
        await summarizeWithSarashina('p', deps);
        expect.fail('エラーがthrowされるべき');
      } catch (err) {
        expect((err as SarashinaSummaryError).kind).to.equal('transient');
        expect((err as SarashinaSummaryError).httpStatus).to.equal(429);
      }
      expect(calls).to.equal(2);
    });
  });

  describe('400 (context超過 / その他)', () => {
    it('error.type === "exceed_context_size_error" はkind:contextExceededで1回のみ試行(clientはリトライしない、短縮再送は呼び出し側の責務)', async () => {
      let calls = 0;
      const deps = withNoDelay({
        fetchImpl: (async () => {
          calls++;
          return jsonResponse(400, {
            error: { code: 400, message: 'the request exceeds the available context size', type: 'exceed_context_size_error' },
          });
        }) as typeof fetch,
      });
      try {
        await summarizeWithSarashina('p', deps);
        expect.fail('エラーがthrowされるべき');
      } catch (err) {
        expect((err as SarashinaSummaryError).kind).to.equal('contextExceeded');
        expect((err as SarashinaSummaryError).httpStatus).to.equal(400);
        expect((err as SarashinaSummaryError).errorType).to.equal('exceed_context_size_error');
      }
      expect(calls).to.equal(1);
    });

    it('exceed_context_size_errorはmessageにllama.cpp生成の定型文(トークン数)を含む(summaryPass.tsの短縮再送が抽出するため)', async () => {
      const deps = withNoDelay({
        fetchImpl: (async () =>
          jsonResponse(400, {
            error: {
              code: 400,
              message: 'request (300 tokens) exceeds the available context size (100 tokens), try increasing it',
              type: 'exceed_context_size_error',
            },
          })) as typeof fetch,
      });
      try {
        await summarizeWithSarashina('p', deps);
        expect.fail('エラーがthrowされるべき');
      } catch (err) {
        expect((err as Error).message).to.include('300 tokens');
        expect((err as Error).message).to.include('100 tokens');
      }
    });

    it('exceed_context_size_error以外のエラーはmessageに元のerror.messageを含めない(PII非露出、他エラー種別は形状未確認のため保守的に除外)', async () => {
      const deps = withNoDelay({
        fetchImpl: (async () =>
          jsonResponse(400, {
            error: { code: 400, message: 'super secret upstream echo of request body', type: 'invalid_request_error' },
          })) as typeof fetch,
      });
      try {
        await summarizeWithSarashina('p', deps);
        expect.fail('エラーがthrowされるべき');
      } catch (err) {
        expect((err as Error).message).to.not.include('super secret upstream echo of request body');
      }
    });

    it('context超過以外の400(invalid_request_error等)はkind:permanentで1回のみ試行', async () => {
      let calls = 0;
      const deps = withNoDelay({
        fetchImpl: (async () => {
          calls++;
          return jsonResponse(400, { error: { code: 400, message: 'bad request', type: 'invalid_request_error' } });
        }) as typeof fetch,
      });
      try {
        await summarizeWithSarashina('p', deps);
        expect.fail('エラーがthrowされるべき');
      } catch (err) {
        expect((err as SarashinaSummaryError).kind).to.equal('permanent');
      }
      expect(calls).to.equal(1);
    });
  });

  describe('401/403/その他(permanent、1回のみ試行)', () => {
    for (const status of [401, 403, 418]) {
      it(`${status}はkind:permanentで1回のみ試行(再認証・再送はしない)`, async () => {
        let calls = 0;
        const deps = withNoDelay({
          fetchImpl: (async () => {
            calls++;
            return new Response('', { status });
          }) as typeof fetch,
        });
        try {
          await summarizeWithSarashina('p', deps);
          expect.fail('エラーがthrowされるべき');
        } catch (err) {
          expect((err as SarashinaSummaryError).kind).to.equal('permanent');
          expect((err as SarashinaSummaryError).httpStatus).to.equal(status);
        }
        expect(calls).to.equal(1);
      });
    }
  });

  describe('200だがschema不正・空文字(permanent)', () => {
    it('不正なJSON本文はkind:permanent', async () => {
      const deps = withNoDelay({
        fetchImpl: (async () => new Response('not json', { status: 200 })) as typeof fetch,
      });
      try {
        await summarizeWithSarashina('p', deps);
        expect.fail('エラーがthrowされるべき');
      } catch (err) {
        expect((err as SarashinaSummaryError).kind).to.equal('permanent');
      }
    });

    it('choices[0].message.content欠落はkind:permanent(silent-failure防止)', async () => {
      const deps = withNoDelay({
        fetchImpl: (async () => jsonResponse(200, { choices: [{ message: {}, finish_reason: 'stop' }] })) as typeof fetch,
      });
      try {
        await summarizeWithSarashina('p', deps);
        expect.fail('エラーがthrowされるべき');
      } catch (err) {
        expect((err as SarashinaSummaryError).kind).to.equal('permanent');
      }
    });

    it('正規化後に空文字("</s>"のみ等)はkind:permanent', async () => {
      const deps = withNoDelay({
        fetchImpl: (async () => jsonResponse(200, successBody('  </s>  '))) as typeof fetch,
      });
      try {
        await summarizeWithSarashina('p', deps);
        expect.fail('エラーがthrowされるべき');
      } catch (err) {
        expect((err as SarashinaSummaryError).kind).to.equal('permanent');
      }
    });

    it('末尾の</s>は正規化(除去)されてから返る', async () => {
      const deps = withNoDelay({
        fetchImpl: (async () => jsonResponse(200, successBody('要約本文</s>'))) as typeof fetch,
      });
      const result = await summarizeWithSarashina('p', deps);
      expect(result.text).to.equal('要約本文');
    });
  });

  describe('finish_reason(ADR-0027 PR3、途中切れの要約を成功扱いにしない)', () => {
    it('finish_reason:"length"(出力上限で途中切れ)はkind:incompleteで返す(成功として保存させない)', async () => {
      const deps = withNoDelay({
        fetchImpl: (async () => jsonResponse(200, successBody('途中で切れた要約', 'length'))) as typeof fetch,
      });
      try {
        await summarizeWithSarashina('p', deps);
        expect.fail('エラーがthrowされるべき');
      } catch (err) {
        expect((err as SarashinaSummaryError).kind).to.equal('incomplete');
      }
    });

    it('finish_reason欠落・未知値はkind:permanent', async () => {
      const deps = withNoDelay({
        fetchImpl: (async () => jsonResponse(200, successBody('要約', 'content_filter'))) as typeof fetch,
      });
      try {
        await summarizeWithSarashina('p', deps);
        expect.fail('エラーがthrowされるべき');
      } catch (err) {
        expect((err as SarashinaSummaryError).kind).to.equal('permanent');
      }
    });
  });

  describe('エラーメッセージ・型 (PII非露出、isTransientError誤読防止)', () => {
    it('エラーmessageにプロンプト本文を含めない', async () => {
      const deps = withNoDelay({
        fetchImpl: (async () => new Response('', { status: 400 })) as typeof fetch,
      });
      try {
        await summarizeWithSarashina('個人情報を含む秘密のプロンプト本文', deps);
        expect.fail('エラーがthrowされるべき');
      } catch (err) {
        expect((err as Error).message).to.not.include('個人情報を含む秘密のプロンプト本文');
      }
    });

    it('SarashinaSummaryErrorは`status`プロパティを持たない(httpStatusのみ、utils/retry.tsのisTransientErrorによる誤読を防ぐ)', async () => {
      const deps = withNoDelay({
        fetchImpl: (async () => new Response('', { status: 400 })) as typeof fetch,
      });
      try {
        await summarizeWithSarashina('p', deps);
        expect.fail('エラーがthrowされるべき');
      } catch (err) {
        expect(err).to.not.have.property('status');
        expect((err as SarashinaSummaryError).httpStatus).to.equal(400);
      }
    });
  });
});
