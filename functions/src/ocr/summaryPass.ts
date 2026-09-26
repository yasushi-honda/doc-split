/**
 * 要約生成のprovider別ディスパッチャー(ADR-0027)。
 *
 * PR3時点ではdead code(呼び出し元なし、L1既定`none`)。PR4で`generateSummaryBatch`・
 * `regenerateSummary.ts`の呼び出し元が配線される。
 *
 * gemini経路は既定でlazy require経由で`generateSummaryCore(`をリテラル呼び出しする
 * (`summaryBuilderCallerContract.test.ts`のCORE_DELEGATE_PATTERNがgrepでこの呼び出しを
 * 検出するため、DI関数参照のみでは検知されない)。`summaryGenerator.ts`はimport経路で
 * `admin.firestore()`を呼ぶrateLimiterに依存するため、静的importせずrequireで遅延読込し、
 * gemini経路を使わないテスト(sarashina経路のみ実行するテスト)がadmin初期化なしで動くよう
 * にする(`utils/textCap.ts`/`utils/loadMasterData.ts`と同じlazy requireパターン)。
 */

import { capPageText, MAX_SUMMARY_LENGTH } from '../utils/textCap';
import type { SummaryField } from '../../../shared/types';
import { buildSummaryPrompt, MIN_OCR_LENGTH_FOR_SUMMARY } from './summaryPromptBuilder';
import {
  summarizeWithSarashina,
  SarashinaSummaryError,
  type SarashinaSummaryDeps,
} from './sarashinaSummaryClient';

export type SummaryPassProvider = 'sarashina' | 'gemini';

export interface SummaryPassResult {
  provider: SummaryPassProvider;
  summary: SummaryField;
  /** sarashina経路は常に'stop'(finish_reasonが'stop'以外ならクライアント層でthrow済み)。gemini経路は未計測のためnull。 */
  finishReason: 'stop' | null;
}

export interface SummaryPassDeps {
  sarashina?: SarashinaSummaryDeps;
  /** テスト時にGemini経路を差し替える注入口。既定は`generateSummaryCore`への委譲(lazy require)。 */
  geminiSummarize?: (ocrResult: string, documentType: string) => Promise<SummaryField>;
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

function requireSummaryGenerator(): typeof import('./summaryGenerator') {
  return require('./summaryGenerator') as typeof import('./summaryGenerator');
}

async function callGemini(
  ocrResult: string,
  documentType: string,
  deps?: SummaryPassDeps
): Promise<SummaryField> {
  if (deps?.geminiSummarize) return deps.geminiSummarize(ocrResult, documentType);
  const { generateSummaryCore } = requireSummaryGenerator();
  return generateSummaryCore(ocrResult, documentType);
}

/**
 * Sarashinaへ要約を依頼する。400 `exceed_context_size_error`を受けた場合、生成前拒否
 * (二重推論にならない)であることを利用して、エラーメッセージのトークン数から入力を
 * 縮小し**1回だけ**再送する(decision-maker決定、2026-09-26)。2回目も超過した場合、
 * またはメッセージからトークン数を抽出できない場合はそのままthrowする。
 */
async function callSarashinaWithContextRetry(
  ocrResult: string,
  documentType: string,
  deps?: SarashinaSummaryDeps
): Promise<string> {
  try {
    const prompt = buildSummaryPrompt(ocrResult, documentType);
    const result = await summarizeWithSarashina(prompt, deps);
    return result.text;
  } catch (err) {
    if (!(err instanceof SarashinaSummaryError) || err.kind !== 'contextExceeded') throw err;

    const tokens = parseContextExceededTokens(err.message);
    if (!tokens) throw err;

    const shrunkOcrResult = shrinkOcrResultForRetry(ocrResult, tokens.promptTokens, tokens.ctxSize);
    if (shrunkOcrResult.length === 0 || shrunkOcrResult.length >= ocrResult.length) throw err;

    const retryPrompt = buildSummaryPrompt(shrunkOcrResult, documentType);
    const retryResult = await summarizeWithSarashina(retryPrompt, deps);
    return retryResult.text;
  }
}

/**
 * OCR結果から指定providerで要約を生成する。
 *
 * 短文ガード(`ocrResult.length < MIN_OCR_LENGTH_FOR_SUMMARY`)は`generateSummaryCore`と
 * 同じ閾値・同じ安全網として両providerに共通適用する(`none`の扱いは呼び出し元の責務)。
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

  if (provider === 'gemini') {
    const summary = await callGemini(ocrResult, documentType, deps);
    return { provider, summary, finishReason: null };
  }

  const text = await callSarashinaWithContextRetry(ocrResult, documentType, deps?.sarashina);
  const summary = capPageText(text, MAX_SUMMARY_LENGTH);
  return { provider, summary, finishReason: 'stop' };
}
