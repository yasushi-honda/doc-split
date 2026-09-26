/**
 * summaryPass.ts: generateSummaryForProvider テスト (ADR-0027 PR3)
 *
 * gemini経路はDI(geminiSummarize)で差し替え、admin初期化なしでテストできることを
 * 確認する。sarashina経路はsummarizeWithSarashinaのDI(fetchImpl)を通して検証する。
 */

import { expect } from 'chai';
import { generateSummaryForProvider } from '../src/ocr/summaryPass';
import type { SarashinaSummaryDeps } from '../src/ocr/sarashinaSummaryClient';
import { buildSummaryPrompt, MIN_OCR_LENGTH_FOR_SUMMARY } from '../src/ocr/summaryPromptBuilder';
import type { SummaryField } from '../../shared/types';

const CONFIG = { serviceUrl: 'https://sarashina-summary.example.run.app', requestTimeoutMs: 1000 };
const LONG_ENOUGH_OCR = 'あ'.repeat(MIN_OCR_LENGTH_FOR_SUMMARY);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function successBody(content: string, finishReason = 'stop') {
  return { choices: [{ message: { content }, finish_reason: finishReason }], model: 'sarashina2.2-3b-instruct-v0.1-Q8_0' };
}

function withNoDelay(deps: Partial<SarashinaSummaryDeps>): SarashinaSummaryDeps {
  return {
    config: CONFIG,
    getAuthHeaders: async () => ({ Authorization: 'Bearer test-id-token' }),
    retry: { attempts: 2, baseDelayMs: 0 },
    ...deps,
  };
}

describe('generateSummaryForProvider (ADR-0027 PR3)', () => {
  it('ocrResultがMIN_OCR_LENGTH_FOR_SUMMARY未満なら通信前にthrowする(gemini/sarashinaどちらも共通)', async () => {
    let called = false;
    await Promise.all(
      (['gemini', 'sarashina'] as const).map(async (provider) => {
        try {
          await generateSummaryForProvider('短い', '書類', provider, {
            geminiSummarize: async () => {
              called = true;
              return { text: 'x', truncated: false };
            },
            sarashina: withNoDelay({
              fetchImpl: (async () => {
                called = true;
                throw new Error('should not be called');
              }) as typeof fetch,
            }),
          });
          expect.fail('エラーがthrowされるべき');
        } catch (err) {
          expect((err as Error).message).to.include(String(MIN_OCR_LENGTH_FOR_SUMMARY));
        }
      })
    );
    expect(called, '短文ガードで弾かれるため呼び出し関数に到達してはならない').to.equal(false);
  });

  describe('gemini経路', () => {
    it('geminiSummarize(DI)へ委譲し、finishReasonはnull・summaryはそのまま返す(admin初期化不要)', async () => {
      let calledWith: [string, string] | null = null;
      const injected: SummaryField = { text: '生成された要約', truncated: false };
      const result = await generateSummaryForProvider(LONG_ENOUGH_OCR, '請求書', 'gemini', {
        geminiSummarize: async (ocrResult, documentType) => {
          calledWith = [ocrResult, documentType];
          return injected;
        },
      });
      expect(calledWith).to.deep.equal([LONG_ENOUGH_OCR, '請求書']);
      expect(result).to.deep.equal({ provider: 'gemini', summary: injected, finishReason: null });
    });
  });

  describe('sarashina経路', () => {
    it('buildSummaryPromptで組み立てたプロンプトを送信し、成功時はcapPageText適用済みのsummaryとfinishReason:"stop"を返す', async () => {
      let sentContent: string | null = null;
      const result = await generateSummaryForProvider(LONG_ENOUGH_OCR, '請求書', 'sarashina', {
        sarashina: withNoDelay({
          fetchImpl: (async (_input, init) => {
            const body = JSON.parse(String(init?.body));
            sentContent = body.messages[0].content;
            return jsonResponse(200, successBody('要約結果'));
          }) as typeof fetch,
        }),
      });
      expect(sentContent).to.equal(buildSummaryPrompt(LONG_ENOUGH_OCR, '請求書'));
      expect(result.provider).to.equal('sarashina');
      expect(result.finishReason).to.equal('stop');
      expect(result.summary).to.deep.equal({ text: '要約結果', truncated: false });
    });

    it('30,000文字を超える応答はcapPageTextでtruncated:trueになる', async () => {
      const longText = 'a'.repeat(30_001);
      const result = await generateSummaryForProvider(LONG_ENOUGH_OCR, '書類', 'sarashina', {
        sarashina: withNoDelay({
          fetchImpl: (async () => jsonResponse(200, successBody(longText))) as typeof fetch,
        }),
      });
      expect(result.summary.truncated).to.equal(true);
      if (result.summary.truncated) {
        expect(result.summary.originalLength).to.equal(30_001);
        expect(result.summary.text.length).to.equal(30_000);
      }
    });

    it('finish_reason:"length"(途中切れ)はエラーとしてそのまま伝播する(成功として保存させない)', async () => {
      try {
        await generateSummaryForProvider(LONG_ENOUGH_OCR, '書類', 'sarashina', {
          sarashina: withNoDelay({
            fetchImpl: (async () => jsonResponse(200, successBody('途中で切れた', 'length'))) as typeof fetch,
          }),
        });
        expect.fail('エラーがthrowされるべき');
      } catch (err) {
        expect((err as Error).name).to.equal('SarashinaSummaryError');
        expect((err as { kind?: string }).kind).to.equal('incomplete');
      }
    });

    describe('context超過時の短縮再送(decision-maker決定、2026-09-26)', () => {
      it('1回目がexceed_context_size_error、2回目(短縮後)が成功なら、短縮されたプロンプトで再送し結果を返す', async () => {
        let calls = 0;
        const sentContents: string[] = [];
        const result = await generateSummaryForProvider(LONG_ENOUGH_OCR, '書類', 'sarashina', {
          sarashina: withNoDelay({
            fetchImpl: (async (_input, init) => {
              calls++;
              const body = JSON.parse(String(init?.body));
              sentContents.push(body.messages[0].content);
              if (calls === 1) {
                return jsonResponse(400, {
                  error: {
                    code: 400,
                    message: `request (${MIN_OCR_LENGTH_FOR_SUMMARY + 200} tokens) exceeds the available context size (${MIN_OCR_LENGTH_FOR_SUMMARY} tokens), try increasing it`,
                    type: 'exceed_context_size_error',
                  },
                });
              }
              return jsonResponse(200, successBody('短縮後の要約'));
            }) as typeof fetch,
          }),
        });
        expect(calls, '生成前拒否(400)からの1回だけの短縮再送のため2回のみ').to.equal(2);
        expect(sentContents[1]!.length).to.be.lessThan(sentContents[0]!.length, '2回目は短縮されたプロンプトであること');
        expect(result.provider).to.equal('sarashina');
        expect(result.summary).to.deep.equal({ text: '短縮後の要約', truncated: false });
      });

      it('2回目もexceed_context_size_errorなら、短縮再送を打ち切りエラーをそのままthrowする(2回のみ試行)', async () => {
        let calls = 0;
        try {
          await generateSummaryForProvider(LONG_ENOUGH_OCR, '書類', 'sarashina', {
            sarashina: withNoDelay({
              fetchImpl: (async () => {
                calls++;
                return jsonResponse(400, {
                  error: {
                    code: 400,
                    message: `request (${MIN_OCR_LENGTH_FOR_SUMMARY + 200} tokens) exceeds the available context size (${MIN_OCR_LENGTH_FOR_SUMMARY} tokens), try increasing it`,
                    type: 'exceed_context_size_error',
                  },
                });
              }) as typeof fetch,
            }),
          });
          expect.fail('エラーがthrowされるべき');
        } catch (err) {
          expect((err as { kind?: string }).kind).to.equal('contextExceeded');
        }
        expect(calls).to.equal(2);
      });

      it('エラーメッセージがトークン数を含まない(想定外の形状)場合は短縮せず1回のみ試行してthrowする', async () => {
        let calls = 0;
        try {
          await generateSummaryForProvider(LONG_ENOUGH_OCR, '書類', 'sarashina', {
            sarashina: withNoDelay({
              fetchImpl: (async () => {
                calls++;
                return jsonResponse(400, {
                  error: { code: 400, message: 'context size exceeded', type: 'exceed_context_size_error' },
                });
              }) as typeof fetch,
            }),
          });
          expect.fail('エラーがthrowされるべき');
        } catch (err) {
          expect((err as { kind?: string }).kind).to.equal('contextExceeded');
        }
        expect(calls, 'メッセージからトークン数を抽出できない場合は再送しない').to.equal(1);
      });
    });

    it('context超過以外のエラー(permanent)は再送せずそのままthrowする', async () => {
      let calls = 0;
      try {
        await generateSummaryForProvider(LONG_ENOUGH_OCR, '書類', 'sarashina', {
          sarashina: withNoDelay({
            fetchImpl: (async () => {
              calls++;
              return jsonResponse(400, { error: { code: 400, message: 'bad request', type: 'invalid_request_error' } });
            }) as typeof fetch,
          }),
        });
        expect.fail('エラーがthrowされるべき');
      } catch (err) {
        expect((err as { kind?: string }).kind).to.equal('permanent');
      }
      expect(calls).to.equal(1);
    });
  });
});
