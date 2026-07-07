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

import { ThinkingLevel, type ThinkingConfig } from '@google/genai';
import { PDFDocument } from 'pdf-lib';

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
 * 同一PDFから先頭totalPages件のページを抽出する(呼出元がFirestore等の外部値をtotalPagesに
 * 渡す場合、実PDFの実ページ数と一致する保証は呼出元の責任。不一致(totalPagesが実ページ数を
 * 超える)場合はcopyPagesがrange errorでthrowする)。extractPdfPage()をページ数分呼ぶと`PDFDocument.load()`
 * (PDF全体のパース)がページ数だけ繰り返されるため、1文書を複数モデルで処理する場合は
 * 全ページを一度だけロードして抽出するここのバッチ版を使う(code-review指摘: N=300規模で
 * 2モデル分の冗長パースはCPU浪費)。
 */
export async function extractAllPdfPages(pdfBuffer: Buffer, totalPages: number): Promise<Buffer[]> {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
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
