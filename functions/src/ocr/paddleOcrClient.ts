/**
 * PaddleOCR Cloud Runサービス(ADR-0025、`services/paddle-ocr/`)のHTTPクライアント。
 *
 * `buildPageResult.ts`と同じ規約: firebase-adminをimportしない純粋モジュールとし、
 * 単体テストから直接importしてもadmin初期化エラーが発生しないようにする。
 *
 * 認証はIDトークン(APIキー不使用)。Cloud Functions v2の実行環境では
 * google-auth-libraryがメタデータサーバー経由で自動的に資格情報を解決する
 * (`docs/context/gcp-migration-scope.md`のWorkload Identity方針と整合)。
 * `audience`はCloud RunサービスのベースURL(パス無し・末尾スラッシュ無し)。
 */

import { GoogleAuth } from 'google-auth-library';
import { withRetry, RETRY_CONFIGS, type RetryConfig } from '../utils/retry';
import { PADDLE_OCR_CONFIG } from '../utils/config';

/** ocrWithGeminiと同一shape(inputTokens/outputTokens/thinkingTokens)を維持しつつ、
 * プロバイダ来歴(engine/modelVersion)と処理時間(processingMs)を追加で保持する。
 * これを捨てるとPaddle移行後は監査上Geminiと誤記録され、実コストも不可視になるため
 * 呼出元(ocrProcessor.ts)がocrExtraction.version相当のフィールドへ転記する。
 */
export interface PaddleOcrResult {
  text: string;
  /** PaddleOCRはLLMではないため常に0(呼出元のコスト集計との型互換のため同一shapeを維持)。 */
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  engine: string;
  modelVersion: string;
  processingMs: number;
}

interface PaddleOcrErrorPayload {
  error?: { code?: string; message?: string };
}

/** テスト時にHTTPクライアント/認証/設定をinjectできるようにする依存注入口。 */
export interface PaddleOcrDeps {
  fetchImpl?: typeof fetch;
  getAuthHeaders?: (audience: string) => Promise<Record<string, string>>;
  config?: { serviceUrl: string; requestTimeoutMs: number };
  /** テスト時にRETRY_CONFIGS.paddleOcrの実待機(backoff)を回避するためのinject口。 */
  retryConfig?: RetryConfig;
}

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
 * PaddleOCR Cloud Runサービスの`POST /ocr`へリクエストし、OCR結果を返す。
 *
 * `PADDLE_OCR_CONFIG.serviceUrl`が空の場合、Geminiへのサイレントフォールバックはせず
 * fail-loudする(設定不備でコスト削減効果が無言で無効化されるのを防ぐ)。
 *
 * リトライ判定は既存の`isTransientError`(status 429/500/502/503/504のみ対象)を
 * そのまま利用する。403(IAM不備、`roles/run.invoker`未付与)・400/413/415/422
 * (入力不正・サイズ超過・PaddleOCR側の入力データ問題、`services/paddle-ocr/README.md`
 * のエラーコード表参照)はTRANSIENT_STATUS_CODESに含まれないため自動的に非リトライ
 * (即座にfail-loud)になる。
 */
export async function ocrWithPaddle(
  buffer: Buffer,
  mimeType: string,
  pageNumber?: number,
  deps: PaddleOcrDeps = {}
): Promise<PaddleOcrResult> {
  const { serviceUrl, requestTimeoutMs } = deps.config ?? PADDLE_OCR_CONFIG;
  if (!serviceUrl) {
    throw new Error(
      'OCR_PROVIDER=paddle ですが PADDLE_OCR_URL が未設定です。Geminiへの暗黙のフォールバックはしません(設定不備を隠蔽しないため)。'
    );
  }

  const audience = serviceUrl.replace(/\/+$/, '');
  const endpoint = `${audience}/ocr`;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const getAuthHeaders = deps.getAuthHeaders ?? getDefaultAuthHeaders;

  return withRetry(async () => {
    const authHeaders = await getAuthHeaders(audience);

    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': mimeType },
        body: buffer,
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch (err) {
      // AbortSignal.timeout()由来の中断はDOMException(name==='TimeoutError')として
      // 投げられる(Node 20実測確認済み)。isTransientError()のTRANSIENT_ERROR_CODES
      // ('ETIMEDOUT'含む)に載せるため変換する。
      if (err instanceof Error && err.name === 'TimeoutError') {
        const timeoutError = new Error(
          `PaddleOCR request timed out after ${requestTimeoutMs}ms (page ${pageNumber ?? 1})`
        ) as Error & { code: string };
        timeoutError.code = 'ETIMEDOUT';
        throw timeoutError;
      }
      throw err;
    }

    if (!response.ok) {
      const payload: PaddleOcrErrorPayload = await response.json().catch(() => ({}));
      const message = [
        `PaddleOCR request failed: ${response.status}`,
        payload.error?.code,
        payload.error?.message,
      ]
        .filter(Boolean)
        .join(' ');
      const httpError = new Error(message) as Error & { status: number };
      httpError.status = response.status;
      throw httpError;
    }

    const json = (await response.json()) as {
      text: string;
      engine: string;
      modelVersion: string;
      processingMs: number;
    };

    return {
      text: json.text,
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      engine: json.engine,
      modelVersion: json.modelVersion,
      processingMs: json.processingMs,
    };
  }, deps.retryConfig ?? RETRY_CONFIGS.paddleOcr);
}
