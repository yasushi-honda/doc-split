/**
 * 共通設定
 *
 * プロジェクト全体で使用する設定値を一元管理
 */

// GCP設定
export const GCP_CONFIG = {
  /** プロジェクトID */
  projectId: process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '',
  /** リージョン */
  location: 'asia-northeast1',
} as const;

/** OCR Pass1(画像/PDF→テキスト)のエンジン種別 (ADR-0025) */
export type OcrProvider = 'paddle';

/**
 * `OCR_PROVIDER`環境変数を検査し、Pass1エンジン(paddle)を返す (ADR-0025、ADR-0029)。
 *
 * Geminiは緊急用経路も含めて廃止した(ADR-0029)ため、返り値は常に'paddle'。未設定・空・
 * 'paddle'以外(旧緊急経路を意味する'gemini'を含む)は警告を出してpaddleへ倒す。デプロイ側
 * (deploy-functions.yml・deploy-to-project.sh)は'gemini'の宣言をエラーで止めるが、
 * 実行時に古い環境変数が残っていても顧客データを外部AIへ送らない(安全側)。
 * paddleなのに`PADDLE_OCR_URL`が未設定の場合は、paddleOcrClient.tsが確定的にエラーにする。
 * GCPコンソール等からのコピペで混入する前後空白・改行はtrimしてから比較する。
 */
export function parseOcrProvider(envValue: string | undefined): OcrProvider {
  const trimmed = envValue?.trim();
  if (trimmed !== undefined && trimmed !== '' && trimmed !== 'paddle') {
    console.warn(
      `[config] OCR_PROVIDER="${envValue}" is not a supported value (only "paddle" is supported; Gemini was removed, ADR-0029). Using paddle.`
    );
  }
  return 'paddle';
}

/**
 * PaddleOCR Cloud Runサービス(ADR-0025)の呼び出し設定。
 *
 * `serviceUrl`が空なのに`provider==='paddle'`が選択されている場合、paddleOcrClient.ts側で
 * 黙ってGeminiにフォールバックせず確定的にエラーとする(サイレントフォールバックは
 * コスト削減効果を無言で無効化するため)。
 */
export const PADDLE_OCR_CONFIG = {
  provider: parseOcrProvider(process.env.OCR_PROVIDER),
  serviceUrl: process.env.PADDLE_OCR_URL || '',
  /**
   * codex review P2指摘対応: PaddleOCR Cloud Runサービス側の`MAX_PROCESSING_SECONDS`は240秒
   * (`.github/workflows/deploy-paddle-ocr.yml`の`--update-env-vars`実測値)。クライアント側の
   * タイムアウトがこれより短いと、サービス側では正常完了しうるリクエストをクライアントが
   * 先に中断してリトライしてしまう(無駄なリトライ+実質的な失敗確定)。サービス側上限に
   * レスポンス転送分の余裕(10秒)を足した値にする。
   */
  requestTimeoutMs: 250_000,
} as const;

/** 要約生成(regenerateSummary/summaryPass)のプロバイダ設定 (ADR-0027) */
export type SummaryProviderSetting = 'none' | 'sarashina';

/**
 * `SUMMARY_PROVIDER`環境変数から要約生成プロバイダを解決する (ADR-0027 PR3)。
 *
 * 既定は'none'(要約機能なし)。未知値・空値はいずれも'none'にフォールバックする
 * (ADR-0027 主要な設計判断2: デプロイしただけで無言で課金・外部送信が始まらないようにする)。
 * ADR-0027 PR-E: 旧ロールバック値'gemini'は撤去した。残っていても警告つきで'none'に倒れる
 * (安全側)。空値(未設定/空文字/空白のみ)は日常的に発生するため警告せず、
 * 非空の未知値のみ警告する(GCPコンソール等からのコピペ誤りを検知するため)。
 */
export function parseSummaryProvider(envValue: string | undefined): SummaryProviderSetting {
  const trimmed = envValue?.trim();
  if (trimmed === 'sarashina') return 'sarashina';
  if (trimmed !== undefined && trimmed !== '' && trimmed !== 'none') {
    console.warn(
      `[config] SUMMARY_PROVIDER="${envValue}" is not a supported value (expected "none" or "sarashina"). Falling back to none.`
    );
  }
  return 'none';
}

/**
 * Sarashina要約Cloud Runサービス(ADR-0027)の呼び出し設定。
 *
 * リクエストパラメータ(temperature/max_tokens等)はここに含めない。PR2b実機ゲートで
 * 検証済みの値は `sarashinaSummaryRequest.ts` を単一の情報源とし、ドリフトを防ぐ
 * (ハーネス`scripts/lib/sarashinaSummaryVerify.ts`も同モジュールへ委譲する)。
 */
export const SARASHINA_SUMMARY_CONFIG = {
  provider: parseSummaryProvider(process.env.SUMMARY_PROVIDER),
  // GCPコンソール等からのコピペで混入する前後空白をtrimする(他のparseX関数と同じ理由、
  // codex review指摘: 未trimのままだとsarashinaSummaryClient.tsのバリデーションと実使用URLが
  // 不一致になりうる。クライアント側でも再度trimして二重に守る)。
  serviceUrl: (process.env.SARASHINA_SUMMARY_URL ?? '').trim(),
  /**
   * Cloud Run `--timeout=600`より長く設定し、クライアントより先にサーバー側の504を
   * 受け取れるようにする(ADR-0027、PR2bハーネスの`REQUEST_TIMEOUT_MS`と同値)。
   */
  requestTimeoutMs: 620_000,
} as const;
