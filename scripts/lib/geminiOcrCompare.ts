/**
 * Gemini 2.5 Flash vs 3.5 Flash OCR比較の共通ロジック (Issue #548)
 *
 * scripts/compare-gemini-ocr-models.ts (dev環境の合成フィクスチャ) と
 * scripts/compare-gemini-ocr-models-confirmed.ts (kanameone/cocoro confirmed replay方式) の
 * 両方が使う、モデル定義・プロンプト構築・PDFページ抽出を一元管理する。
 *
 * プロンプト文言・ページ抽出ロジックは functions/src/ocr/ocrProcessor.ts の対応箇所
 * (`prompt` 変数 / `extractPdfPage`) と同一だが、ocrProcessor.ts 側は非exportのため
 * ここに複製する。乖離を防ぐため、本番プロンプトを変更する場合は本ファイルも同期すること。
 *
 * OCR呼出自体(リトライ挙動・異常検知の扱い)は2スクリプトで意図的に異なる
 * (dev版=n=11の少数サンプルで即失敗させたい / confirmed版=N=300規模で1文書の失敗が
 * 全体を止めないようにしたい) ため、本モジュールでは共通化しない。
 */

import { GoogleGenAI, ThinkingLevel, type ThinkingConfig } from '@google/genai';
import { PDFDocument } from 'pdf-lib';
import { withRetry, RETRY_CONFIGS } from '../../functions/src/utils/retry';
import { GEMINI_CONFIG } from '../../functions/src/utils/config';

export type ModelRole = 'baseline' | 'candidate';

export interface ModelConfig {
  role: ModelRole;
  label: string;
  modelId: string;
  thinkingConfig: ThinkingConfig;
  pricing: { inputPer1MTokens: number; outputPer1MTokens: number };
}

/**
 * 比較対象モデル定義。2.5は現行既定値(GEMINI_OCR_THINKING_BUDGET未設定時のデフォルト、
 * functions/src/utils/config.ts GEMINI_CONFIG.ocrThinkingBudget参照)、3.5はIssue #548
 * 移行予定設定(thinking完全無効化不可のため最小のlow)。
 * 単価は Vertex AI Gemini API 公式料金ページ(https://cloud.google.com/vertex-ai/generative-ai/pricing)
 * で確認済み(2026-07-06、gemini-2.5-flash/gemini-3.5-flash、functions/src/utils/config.ts の
 * GEMINI_PRICING_BY_MODEL と同期)。
 */
export const BASELINE_MODEL_CONFIG: ModelConfig = {
  role: 'baseline',
  label: 'gemini-2.5-flash(現行)',
  modelId: 'gemini-2.5-flash',
  thinkingConfig: { thinkingBudget: 0 },
  pricing: { inputPer1MTokens: 0.3, outputPer1MTokens: 2.5 },
};

export const CANDIDATE_MODEL_CONFIG: ModelConfig = {
  role: 'candidate',
  label: 'gemini-3.5-flash(移行予定)',
  modelId: 'gemini-3.5-flash',
  thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
  pricing: { inputPer1MTokens: 1.5, outputPer1MTokens: 9.0 },
};

/**
 * 配列としての反復が必要な呼出元(compare-gemini-ocr-models.tsのforループ等)向け。
 * baseline/candidateの解決には配列の.find()ではなくBASELINE_MODEL_CONFIG/
 * CANDIDATE_MODEL_CONFIGを直接参照すること(code-review指摘: 配列+.find()+型キャストの
 * 組合せはMODEL_CONFIGS変更時に安全に壊れない)。
 */
export const MODEL_CONFIGS: ModelConfig[] = [BASELINE_MODEL_CONFIG, CANDIDATE_MODEL_CONFIG];

/**
 * functions/src/ocr/ocrProcessor.ts の OCR プロンプトと同一(pageNumberありのケースのみ、
 * 本比較スクリプトは常にページ単位呼出のため)。本番はページ番号なしの単一画像呼出も
 * サポートするが(`${pageNumber ? ... : ''}`)、本比較スクリプトはPDF文書のみを対象とし
 * 常にページ番号を渡すため、その分岐は含めない。
 */
export function buildOcrPrompt(pageNumber: number): string {
  return `
この画像/PDFの内容をOCRしてください。

【指示】
- テキストをそのまま正確に抽出してください
- 表がある場合は、構造を保ってテキスト化してください
- 手書き文字も可能な限り読み取ってください
- 読み取れない部分は[判読不能]と記載してください
- 余計な説明は不要です。抽出したテキストのみを出力してください

これは${pageNumber}ページ目です。
`;
}

/** functions/src/ocr/ocrProcessor.ts の extractPdfPage と同ロジック */
export async function extractPdfPage(pdfBuffer: Buffer, pageIndex: number): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const newPdf = await PDFDocument.create();
  const [copiedPage] = await newPdf.copyPages(pdfDoc, [pageIndex]);
  newPdf.addPage(copiedPage);
  const pdfBytes = await newPdf.save();
  return Buffer.from(pdfBytes);
}

/**
 * 同一PDFの全ページを抽出する。ページ数はロード済みPDFの`getPageCount()`から取得する
 * (functions/src/ocr/ocrProcessor.ts の processDocument() と同じ方式。review-pr指摘反映:
 * 以前はFirestore保存済みのtotalPagesフィールドを呼出元から受け取っていたが、保存値と
 * 実PDFの実ページ数がドリフトしている場合(欠損/更新漏れ等)、複数ページ文書がwarningなく
 * 一部ページのみOCRされ精度測定が静かに歪むリスクがあった。実PDFから直接取得することで
 * このドリフト依存を排除する)。extractPdfPage()をページ数分呼ぶと`PDFDocument.load()`
 * (PDF全体のパース)がページ数だけ繰り返されるため、1文書を複数モデルで処理する場合は
 * 全ページを一度だけロードして抽出するここのバッチ版を使う(code-review指摘: N=300規模で
 * 2モデル分の冗長パースはCPU浪費)。
 */
export async function extractAllPdfPages(pdfBuffer: Buffer): Promise<Buffer[]> {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const totalPages = pdfDoc.getPageCount();
  const pages: Buffer[] = [];
  for (let i = 0; i < totalPages; i++) {
    const newPdf = await PDFDocument.create();
    const [copiedPage] = await newPdf.copyPages(pdfDoc, [i]);
    newPdf.addPage(copiedPage);
    const pdfBytes = await newPdf.save();
    pages.push(Buffer.from(pdfBytes));
  }
  return pages;
}

export interface OcrPageResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  /** true の場合、空応答がsafetyブロック等のAPI異常由来の可能性があり、判定に含めるべきでない疑いがある */
  anomalous: boolean;
}

/**
 * ページ単位OCR呼出し + 異常応答検知(safetyブロック/zero-candidate等)。
 * scripts/spike-candidate-extraction.ts の ocrPageVerbatim() と
 * scripts/verify-candidate-extraction-document-level.ts の同名関数で重複していた
 * 実装を一元化(/safe-refactor DRY違反指摘反映)。response.text は safetyブロック/
 * zero-candidate等API異常時にも例外を投げず単に undefined を返すため(@google/genai
 * getter実装)、空応答を無言で「OCR誤読」と同一視しないよう finishReason/blockReason を検査する。
 *
 * compare-gemini-ocr-models.ts の ocrPage() は本関数と統合していない(同ファイル冒頭の
 * コメント通り、n=11の少数サンプルで即失敗させたい設計のため意図的にリトライ/異常検知の
 * 扱いを独自実装している)。
 */
export async function ocrPageWithAnomalyDetection(
  ai: InstanceType<typeof GoogleGenAI>,
  modelConfig: ModelConfig,
  pageBuffer: Buffer,
  pageNumber: number
): Promise<OcrPageResult> {
  const base64Data = pageBuffer.toString('base64');

  const response = await withRetry(
    () =>
      ai.models.generateContent({
        model: modelConfig.modelId,
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType: 'application/pdf', data: base64Data } },
              { text: buildOcrPrompt(pageNumber) },
            ],
          },
        ],
        config: {
          maxOutputTokens: GEMINI_CONFIG.maxOutputTokens,
          thinkingConfig: modelConfig.thinkingConfig,
        },
      }),
    RETRY_CONFIGS.gemini
  );

  const text = response.text || '';
  const usageMetadata = response.usageMetadata;

  let anomalous = false;
  if (!response.text) {
    const candidate = response.candidates?.[0];
    const finishReason = candidate?.finishReason;
    const blockReason = response.promptFeedback?.blockReason;
    if (blockReason || (finishReason && finishReason !== 'STOP')) {
      anomalous = true;
      console.warn(
        `⚠️ [${modelConfig.label}] p${pageNumber}: 空応答検出 (API異常の可能性) ` +
          `finishReason=${finishReason ?? 'none'} blockReason=${blockReason ?? 'none'}`
      );
    }
  }

  return {
    text,
    inputTokens: usageMetadata?.promptTokenCount || 0,
    outputTokens: usageMetadata?.candidatesTokenCount || 0,
    thinkingTokens: usageMetadata?.thoughtsTokenCount || 0,
    anomalous,
  };
}
