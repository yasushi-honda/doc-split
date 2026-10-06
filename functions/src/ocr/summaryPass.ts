/**
 * 要約生成のディスパッチャー(ADR-0027)。生成はSarashina(自前ホスト)のみ。
 *
 * PR-E: 要約のGemini経路(旧`SUMMARY_PROVIDER=gemini`ロールバック運用)を撤去した。
 * 要約からGeminiへ到達できないことは`geminiSdkImportAllowlistContract.test.ts`が固定する。
 */

import { capPageText, MAX_SUMMARY_LENGTH } from '../utils/textCap';
import type { SummaryField } from '../../../shared/types';
import { buildSummaryPrompt, MIN_OCR_LENGTH_FOR_SUMMARY, MAX_SUMMARY_INPUT_LENGTH } from './summaryPromptBuilder';
import {
  summarizeWithSarashina,
  SarashinaSummaryError,
  type SarashinaSummaryDeps,
} from './sarashinaSummaryClient';

export type SummaryPassProvider = 'sarashina';

export interface SummaryPassResult {
  provider: SummaryPassProvider;
  summary: SummaryField;
  /** 常に'stop'(finish_reasonが'stop'以外ならクライアント層でthrow済み)。 */
  finishReason: 'stop';
  /**
   * 実際にモデルへ送信した原文(8,000文字への切詰め、context超過時の再短縮を反映した後の値)。
   * 捏造スキャン・英字混入スキャンの「原文に存在するか」の比較対象は、元のOCR全文ではなく
   * この値でなければならない(再短縮後に送っていない部分の語を許してしまうため、PR-C)。
   */
  sentText: string;
}

export interface SummaryPassDeps {
  sarashina?: SarashinaSummaryDeps;
}

/**
 * llama.cppサーバー(`tools/server/server-context.cpp`、gh api経由でソース確認済み、
 * 2026-09-26)が返すcontext超過エラーメッセージから prompt token数・context size を
 * 抽出する。2種の文言("input (N tokens) is larger than the max context size (M tokens)"
 * / "request (N tokens) exceeds the available context size (M tokens)")いずれにも
 * マッチする。抽出できない場合は短縮再送をせず、そのままthrowする(安全側)。
 */
const CONTEXT_EXCEEDED_TOKENS_PATTERN = /\((\d+)\s*tokens?\)[^(]*\((\d+)\s*tokens?\)/i;

function parseContextExceededTokens(message: string): { promptTokens: number; ctxSize: number } | null {
  const match = CONTEXT_EXCEEDED_TOKENS_PATTERN.exec(message);
  if (!match) return null;
  const promptTokens = Number(match[1]);
  const ctxSize = Number(match[2]);
  if (!Number.isFinite(promptTokens) || !Number.isFinite(ctxSize) || promptTokens <= 0 || ctxSize <= 0) return null;
  return { promptTokens, ctxSize };
}

/** 文字数ベースの近似縮小のため、トークン比から計算した値よりさらに10%小さく切り詰める安全マージン。 */
const CONTEXT_SHRINK_SAFETY_MARGIN = 0.9;

function shrinkOcrResultForRetry(ocrResult: string, promptTokens: number, ctxSize: number): string {
  const ratio = Math.min((ctxSize / promptTokens) * CONTEXT_SHRINK_SAFETY_MARGIN, 1);
  const targetLength = Math.max(0, Math.floor(ocrResult.length * ratio));
  return ocrResult.slice(0, targetLength);
}

/** プロンプトへ実際に入る原文(`buildSummaryPrompt`と同じ`MAX_SUMMARY_INPUT_LENGTH`での切詰め)。 */
function truncateForSummaryInput(ocrResult: string): string {
  return ocrResult.length > MAX_SUMMARY_INPUT_LENGTH ? ocrResult.slice(0, MAX_SUMMARY_INPUT_LENGTH) : ocrResult;
}

/**
 * Sarashinaへ要約を依頼する。400 `exceed_context_size_error`を受けた場合、生成前拒否
 * (二重推論にならない)であることを利用して、エラーメッセージのトークン数から入力を
 * 縮小し**1回だけ**再送する(decision-maker決定、2026-09-26)。2回目も超過した場合、
 * またはメッセージからトークン数を抽出できない場合はそのままthrowする。
 *
 * **縮小は「実際に送信したテキスト」基準で計算する**(pr-review-toolkit code-reviewer
 * H1指摘、実バグとして修正): `buildSummaryPrompt`は`ocrResult`を`MAX_SUMMARY_INPUT_LENGTH`
 * (8000文字)へ切り詰めてから送るため、エラーが報告するトークン数もこの切り詰め後テキスト
 * のもの。縮小比を`ocrResult`全体の長さに適用すると、8000文字を大きく超える文書では
 * 縮小後も依然8000文字を超えたままとなり、`buildSummaryPrompt`が再度同じ先頭8000文字へ
 * 切り詰めるため2回目が1回目と完全に同一内容になり、再送が無意味になる(再現確認済み)。
 */
async function callSarashinaWithContextRetry(
  ocrResult: string,
  documentType: string,
  deps?: SarashinaSummaryDeps
): Promise<{ text: string; sentText: string }> {
  try {
    const prompt = buildSummaryPrompt(ocrResult, documentType);
    const result = await summarizeWithSarashina(prompt, deps);
    return { text: result.text, sentText: truncateForSummaryInput(ocrResult) };
  } catch (err) {
    if (!(err instanceof SarashinaSummaryError) || err.kind !== 'contextExceeded') throw err;

    const tokens = parseContextExceededTokens(err.message);
    if (!tokens) throw err;

    const sentText = truncateForSummaryInput(ocrResult);
    const shrunkOcrResult = shrinkOcrResultForRetry(sentText, tokens.promptTokens, tokens.ctxSize);
    if (shrunkOcrResult.length === 0 || shrunkOcrResult.length >= sentText.length) throw err;

    const retryPrompt = buildSummaryPrompt(shrunkOcrResult, documentType);
    const retryResult = await summarizeWithSarashina(retryPrompt, deps);
    return { text: retryResult.text, sentText: truncateForSummaryInput(shrunkOcrResult) };
  }
}

/**
 * OCR結果からSarashinaで要約を生成する。
 *
 * 短文ガード(`ocrResult.length < MIN_OCR_LENGTH_FOR_SUMMARY`)を安全網として適用する
 * (`none`の扱いは呼び出し元の責務)。
 */
export async function generateSummaryForProvider(
  ocrResult: string,
  documentType: string,
  provider: SummaryPassProvider,
  deps?: SummaryPassDeps
): Promise<SummaryPassResult> {
  if (ocrResult.length < MIN_OCR_LENGTH_FOR_SUMMARY) {
    throw new Error(
      `generateSummaryForProvider: ocrResult must be at least ${MIN_OCR_LENGTH_FOR_SUMMARY} chars (actual=${ocrResult.length})`
    );
  }

  const { text, sentText } = await callSarashinaWithContextRetry(ocrResult, documentType, deps?.sarashina);
  const summary = capPageText(text, MAX_SUMMARY_LENGTH);
  return { provider, summary, finishReason: 'stop', sentText };
}
