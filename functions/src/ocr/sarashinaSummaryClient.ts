/**
 * Sarashina要約Cloud Runサービス(ADR-0027)のHTTPクライアント。
 *
 * `paddleOcrClient.ts`と同じ規約: firebase-adminをimportしない純粋モジュールとし、
 * 単体テストから直接importしてもadmin初期化エラーが発生しないようにする。
 * PR3時点ではdead code(呼び出し元なし)。
 *
 * ADR-0027 主要な設計判断8: Cloud Run timeoutを跨いだ場合、コンテナ側の処理は
 * 継続しうる(実測: 約2分40秒間429で新規リクエストが拒否され続けた)。timeout/504は
 * 「サーバーが生成を継続している可能性がある」失敗のため、その場ではリトライしない
 * (`withRetry`(`utils/retry.ts`)の`isTransientError`は504/timeoutをリトライ対象に
 * 含めるため意図的に使わず、`withBackoffRetry`を`kind==='transient'`のみリトライする
 * 述語で使う)。plan-crossreview反映: 「再送すると二重推論を否定できない失敗は
 * 全てtimeout扱い」とし、`cause.code`が明確に「接続確立前」を示す場合のみtransient
 * として1回リトライする。未知のエラーコードはtransient側へ広げない(安全側)。
 */

import { GoogleAuth } from 'google-auth-library';
import { withBackoffRetry } from '../utils/retry';
import { SARASHINA_SUMMARY_CONFIG } from '../utils/config';
import { buildSarashinaChatRequestBody, normalizeSarashinaContent } from './sarashinaSummaryRequest';

export type SarashinaSummaryErrorKind =
  | 'config'
  | 'timeout'
  | 'transient'
  | 'permanent'
  | 'contextExceeded'
  | 'incomplete';

/**
 * `status`ではなく`httpStatus`という名前にする(`utils/retry.ts`の`isTransientError`が
 * `.status`/`.code`/メッセージ中の"timeout"を読んでtransient判定してしまう誤読を防ぐ、
 * PR4で`classifySummaryError`に渡る際の安全策)。
 */
export class SarashinaSummaryError extends Error {
  readonly kind: SarashinaSummaryErrorKind;
  readonly httpStatus?: number;
  readonly errorType?: string;

  constructor(message: string, kind: SarashinaSummaryErrorKind, opts?: { httpStatus?: number; errorType?: string }) {
    super(message);
    this.name = 'SarashinaSummaryError';
    this.kind = kind;
    this.httpStatus = opts?.httpStatus;
    this.errorType = opts?.errorType;
  }
}

export interface SarashinaSummaryResult {
  text: string;
  finishReason: 'stop';
  model: string | null;
}

/** テスト時にHTTPクライアント/認証/設定/リトライ挙動をinjectできるようにする依存注入口。 */
export interface SarashinaSummaryDeps {
  fetchImpl?: typeof fetch;
  getAuthHeaders?: (audience: string) => Promise<Record<string, string>>;
  config?: { serviceUrl: string; requestTimeoutMs: number };
  /** attempts: 総試行回数(初回+リトライ)。既定2(初回+1回リトライ、ADR-0027 設計判断8)。 */
  retry?: { attempts: number; baseDelayMs: number };
}

const DEFAULT_RETRY_ATTEMPTS = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 2000;

let cachedAuth: GoogleAuth | undefined;
function getDefaultAuth(): GoogleAuth {
  if (!cachedAuth) cachedAuth = new GoogleAuth();
  return cachedAuth;
}

async function getDefaultAuthHeaders(audience: string): Promise<Record<string, string>> {
  const client = await getDefaultAuth().getIdTokenClient(audience);
  return (await client.getRequestHeaders()) as Record<string, string>;
}

/**
 * `SARASHINA_SUMMARY_URL`がhttps絶対URLかどうかを検証する。空文字・`<TBD>`等の
 * プレースホルダ・http(非https)は全て`config`エラーとして通信前に弾く
 * (plan-crossreview Medium指摘反映: 空文字のみのチェックでは不十分)。
 */
function isHttpsAbsoluteUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * fetchエラーの`cause`チェーン(最大5階層)から文字列の`code`を探す。undiciの
 * `TypeError: fetch failed`は`cause`(あるいはさらにネストした`cause.cause`)に
 * 実際のsocketエラー(`ECONNREFUSED`等)を持つことがある。
 */
function extractCauseCode(err: unknown): string | undefined {
  let current: unknown = err;
  for (let i = 0; i < 5 && current; i++) {
    if (typeof current === 'object' && current !== null) {
      const code = (current as { code?: unknown }).code;
      if (typeof code === 'string') return code;
      current = (current as { cause?: unknown }).cause;
      continue;
    }
    break;
  }
  return undefined;
}

/** 「接続確立前」に失敗したことが明確なコードのみ(サービスが未到達なのが明らかなため1回リトライ可)。 */
const PRE_CONNECTION_ERROR_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);

function classifyNetworkError(err: unknown): SarashinaSummaryError {
  if (err instanceof Error && err.name === 'TimeoutError') {
    return new SarashinaSummaryError('Sarashina request timed out (client-side AbortSignal)', 'timeout');
  }
  const code = extractCauseCode(err);
  if (code !== undefined && PRE_CONNECTION_ERROR_CODES.has(code)) {
    return new SarashinaSummaryError(`Sarashina network error before connection established: ${code}`, 'transient');
  }
  // 接続後の失敗(ECONNRESET等)・cause不在・未知のコードは、サーバーが生成を継続している
  // 可能性を否定できないため安全側でtimeout扱いにする(再送しない)。
  const detail = err instanceof Error ? err.message : String(err);
  return new SarashinaSummaryError(`Sarashina network error (treated as timeout, retry unsafe): ${detail}`, 'timeout');
}

interface SarashinaErrorPayload {
  error?: { code?: number; message?: string; type?: string };
}

interface ChatCompletionResponseShape {
  choices?: { message?: { content?: unknown }; finish_reason?: string }[];
  model?: string;
}

/**
 * Sarashina Cloud Runサービスの`POST /v1/chat/completions`へリクエストし、要約テキストを返す。
 *
 * `SARASHINA_SUMMARY_CONFIG.serviceUrl`が空/不正の場合、Geminiへのサイレントフォールバックは
 * せずfail-loudする(paddleOcrClient.tsと同じ方針)。
 */
export async function summarizeWithSarashina(
  prompt: string,
  deps: SarashinaSummaryDeps = {}
): Promise<SarashinaSummaryResult> {
  const { serviceUrl: rawServiceUrl, requestTimeoutMs } = deps.config ?? SARASHINA_SUMMARY_CONFIG;
  // codex review指摘: `new URL()`は前後空白を許容してパースに成功するため、バリデーションを
  // 未trimの生値で行いendpoint構築だけtrimすると、逆に「バリデーションのみ通過し実使用は
  // 壊れる」不整合が起きる。validate/useとも同じtrim済み文字列を使う。
  const serviceUrl = rawServiceUrl.trim();
  if (!isHttpsAbsoluteUrl(serviceUrl)) {
    throw new SarashinaSummaryError(
      `SUMMARY_PROVIDER=sarashina ですが SARASHINA_SUMMARY_URL が未設定またはhttps絶対URLではありません(値: ${JSON.stringify(rawServiceUrl)})。Geminiへの暗黙のフォールバックはしません。`,
      'config'
    );
  }

  const audience = serviceUrl.replace(/\/+$/, '');
  const endpoint = `${audience}/v1/chat/completions`;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const getAuthHeaders = deps.getAuthHeaders ?? getDefaultAuthHeaders;
  const { attempts, baseDelayMs } = deps.retry ?? {
    attempts: DEFAULT_RETRY_ATTEMPTS,
    baseDelayMs: DEFAULT_RETRY_BASE_DELAY_MS,
  };

  return withBackoffRetry(
    async () => {
      let authHeaders: Record<string, string>;
      try {
        authHeaders = await getAuthHeaders(audience);
      } catch (err) {
        throw new SarashinaSummaryError(
          `Sarashina IDトークン取得に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
          'transient'
        );
      }

      const requestBody = buildSarashinaChatRequestBody(prompt);

      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(requestTimeoutMs),
        });
      } catch (err) {
        throw classifyNetworkError(err);
      }

      if (response.status === 504) {
        throw new SarashinaSummaryError('Sarashina request timed out (504)', 'timeout', { httpStatus: 504 });
      }

      if (!response.ok) {
        const payload: SarashinaErrorPayload = await response.json().catch(() => ({}));
        const errorType = payload.error?.type;
        // raw bodyやpromptはmessageに含めない(plan-crossreview Medium: PII非露出、
        // 上流がrequest内容をechoする場合の漏洩防止)。type/codeのみ採用する。
        const messageParts: (string | number | undefined)[] = [
          `Sarashina request failed: ${response.status}`,
          errorType,
          payload.error?.code,
        ];

        if (response.status === 400 && errorType === 'exceed_context_size_error') {
          // exceed_context_size_errorのmessageはllama.cpp側が生成する定型文
          // ("request (N tokens) exceeds the available context size (M tokens), ...")で
          // プロンプト内容のechoではない(tools/server/server-context.cpp、gh api経由で
          // ソース確認済み、2026-09-26)。summaryPass.tsの短縮再送がこのトークン数を
          // 抽出して使うため、このエラー種別に限りmessageを含める。
          messageParts.push(payload.error?.message);
          const message = messageParts.filter((v) => v !== undefined && v !== null).join(' ');
          throw new SarashinaSummaryError(message, 'contextExceeded', { httpStatus: 400, errorType });
        }

        const message = messageParts.filter((v) => v !== undefined && v !== null).join(' ');
        if (response.status === 429 || (response.status >= 500 && response.status <= 503)) {
          throw new SarashinaSummaryError(message, 'transient', { httpStatus: response.status, errorType });
        }
        throw new SarashinaSummaryError(message, 'permanent', { httpStatus: response.status, errorType });
      }

      let parsed: ChatCompletionResponseShape;
      try {
        parsed = JSON.parse(await response.text());
      } catch {
        throw new SarashinaSummaryError('Sarashina response was not valid JSON', 'permanent', {
          httpStatus: response.status,
        });
      }

      const choice = parsed.choices?.[0];
      const rawContent = choice?.message?.content;
      if (typeof rawContent !== 'string') {
        throw new SarashinaSummaryError(
          'Sarashina response missing choices[0].message.content (schema mismatch)',
          'permanent',
          { httpStatus: response.status }
        );
      }

      const text = normalizeSarashinaContent(rawContent);
      if (!text) {
        throw new SarashinaSummaryError('Sarashina response content was empty after normalization', 'permanent', {
          httpStatus: response.status,
        });
      }

      const finishReason = choice?.finish_reason;
      if (finishReason !== 'stop') {
        // finish_reason:'length'(出力上限で途中切れ)を成功として保存させない
        // (plan-crossreview High反映)。それ以外の未知値はpermanentとして扱う。
        throw new SarashinaSummaryError(
          `Sarashina response finish_reason was "${finishReason ?? 'undefined'}" (expected "stop")`,
          finishReason === 'length' ? 'incomplete' : 'permanent',
          { httpStatus: response.status }
        );
      }

      return { text, finishReason: 'stop', model: parsed.model ?? null };
    },
    attempts,
    baseDelayMs,
    (err) => err instanceof SarashinaSummaryError && err.kind === 'transient'
  );
}
