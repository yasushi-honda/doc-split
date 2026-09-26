/**
 * Sarashina要約Cloud Run(ADR-0027)向けリクエスト形状の単一の情報源。
 *
 * PR2b実機ゲートハーネス(`scripts/lib/sarashinaSummaryVerify.ts`)が全ゲートPASSを確認した
 * リクエストbody(`buildChatRequestBody`)と同一の形を、本番client(PR3
 * `sarashinaSummaryClient.ts`)とハーネスの両方がここへ委譲することで共有する。
 * body定義を2箇所に重複させないことで、本番とハーネスの検証結果がドリフトすることを
 * 構造的に防ぐ(plan-crossreview #10反映)。
 *
 * import文ゼロ契約(`sarashinaSummaryRequestIsolationContract.test.ts`): scripts配下
 * (CommonJS、google-auth-library等の依存を持たない)から安全に委譲できるようにするため、
 * summaryPromptBuilder.ts と同じく本モジュールは admin/認証ライブラリ等への依存を一切持たない。
 */

/** PR2b実機ゲートで検証済みのmax_tokens(Dockerfileの`LLAMA_ARG_N_PREDICT=1024`と同値)。 */
export const SARASHINA_SUMMARY_MAX_TOKENS = 1024;

/** PR2b実機ゲートで検証済みのtemperature。 */
export const SARASHINA_SUMMARY_TEMPERATURE = 0.2;

export interface SarashinaChatRequestBody {
  messages: { role: 'user'; content: string }[];
  max_tokens: number;
  temperature: number;
  cache_prompt: false;
  /** PR0(`bench.py`)と同一のリクエスト形状にするための互換フィールド。Sarashinaでは無視される
   * (Qwen系のthinking出力を抑制する目的でPR0が全モデル共通で送っていたもの)。 */
  chat_template_kwargs: { enable_thinking: false };
}

/**
 * Sarashina Cloud Runへの `POST /v1/chat/completions` リクエストbodyを組み立てる。
 *
 * 既定値(max_tokens=1024, temperature=0.2)はPR2b実機ゲートで全ゲートPASSを確認した値
 * (`scripts/fixtures/sarashina-summary-golden/`)。`opts`はPR3の短縮再送(context超過時に
 * max_tokensを変えずプロンプトのみ縮める想定のため通常は未使用)・将来のテスト専用に残す。
 */
export function buildSarashinaChatRequestBody(
  prompt: string,
  opts?: { maxTokens?: number; temperature?: number }
): SarashinaChatRequestBody {
  return {
    messages: [{ role: 'user', content: prompt }],
    max_tokens: opts?.maxTokens ?? SARASHINA_SUMMARY_MAX_TOKENS,
    temperature: opts?.temperature ?? SARASHINA_SUMMARY_TEMPERATURE,
    cache_prompt: false,
    chat_template_kwargs: { enable_thinking: false },
  };
}

/**
 * Sarashinaの生応答から末尾のEOSトークン(`</s>`、連続含む)と前後の空白を除去する。
 *
 * PR2bハーネスは全runで末尾`</s>`を観測しWARN(`output-sanity`)扱いのまま素通りしていたが、
 * 本番の保存値には残さない。文中(末尾以外)の`</s>`は推測で削除すると実文章を破壊する
 * リスクがあるため対象外とする(plan-crossreview Low反映)。
 */
export function normalizeSarashinaContent(raw: string): string {
  return raw.trim().replace(/(?:\s*<\/s>)+\s*$/, '').trim();
}
