/**
 * OCR実行の所有権(ocrRunId)・入力世代(fileUrl/mimeType)検証 (Issue #540)
 *
 * processOCRのポーリング間隔(1分)より処理時間(最大540秒)の方が長いため、単一ドキュメントに
 * 対して「先行するOCR実行がまだ完了していない間に、reprocess等で新しい実行が始まる」
 * 状況が起こりうる。この時、先行実行が古い抽出結果で後発実行の結果を上書きしないよう、
 * ocrProcessor.ts の最終Firestore transaction内で本モジュールの純粋関数を使い、
 * 「自分がまだ正当な実行の所有者か」「処理開始時点からfileUrl/mimeTypeが変わっていないか」
 * を検証する。
 *
 * #539 (splitPdf) の lastUpdateTime precondition方式は採用しない: confirmed保護マージ
 * (#526 D2)はユーザーの確認編集を処理完了時に取り込む設計であり、lastUpdateTimeを
 * precondition化すると無関係な編集のたびに正当なOCR完了までblockされてしまう
 * (Codexセカンドオピニオンで指摘、design上の理由がある選択)。
 */

/** Firestoreから読み直した最新ドキュメントの関連フィールド(型は未検証のunknownで受ける) */
export interface OcrRunFreshState {
  status?: unknown;
  ocrRunId?: unknown;
  fileUrl?: unknown;
  mimeType?: unknown;
}

/** この実行が処理開始時点で保持していた所有権トークンと入力世代 */
export interface OcrRunExpectation {
  ocrRunId: string;
  fileUrl: string;
  mimeType: string;
}

export type OcrRunOwnershipReason =
  | 'run-id-mismatch'
  | 'status-mismatch'
  | 'file-url-drift'
  | 'mime-type-drift';

export type OcrRunOwnershipResult =
  | { ok: true }
  | { ok: false; reason: OcrRunOwnershipReason };

/**
 * 判定順序はログ集計・テストの契約: ocrRunId → status → fileUrl → mimeType。
 * 複数不一致が同時に起きた場合も常に同じreasonが返る。
 */
export function evaluateOcrRunOwnership(
  fresh: OcrRunFreshState,
  expected: OcrRunExpectation
): OcrRunOwnershipResult {
  if (fresh.ocrRunId !== expected.ocrRunId) {
    return { ok: false, reason: 'run-id-mismatch' };
  }
  if (fresh.status !== 'processing') {
    return { ok: false, reason: 'status-mismatch' };
  }
  if (fresh.fileUrl !== expected.fileUrl) {
    return { ok: false, reason: 'file-url-drift' };
  }
  if (fresh.mimeType !== expected.mimeType) {
    return { ok: false, reason: 'mime-type-drift' };
  }
  return { ok: true };
}

/** supersededされた実行が完了時点までに実際に消費していたGemini使用量(コスト可視性維持のため) */
export interface OcrRunTokenUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  pagesProcessed: number;
}

/**
 * evaluateOcrRunOwnership()がng判定を返した際にthrowするマーカーエラー。
 * splitSnapshot.ts の SourceDriftError と同じ instanceof 判定パターン: caller
 * (processOCR.ts)はこのエラーを「実行が別のrunに引き継がれた正常な結果」として扱い、
 * retryCount消費やstatus:'error'化を行わない。
 */
export class OcrRunSupersededError extends Error {
  constructor(
    message: string,
    public readonly docId: string,
    public readonly reason: OcrRunOwnershipReason,
    public readonly tokenUsage?: OcrRunTokenUsage
  ) {
    super(message);
    this.name = 'OcrRunSupersededError';
  }
}

/** applySupersededOutcome()が更新するstatsの最小部分集合(processOCR.tsのProcessingStatsが構造的に満たす) */
export interface OcrRunSupersededStats {
  pagesProcessed: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalThinkingTokens: number;
  superseded: number;
}

/**
 * OcrRunSupersededError捕捉時のstats反映(Issue #540)。
 *
 * retryCountは消費せずsupersededカウンタのみ増やす。既に消費済みのGemini使用量
 * (error.tokenUsage、superseded runでも実際にAPIコストは発生している)は、
 * trackGeminiUsageでのコスト計上から漏れないようstatsへ加算する。
 *
 * processOCR.tsのonSchedule handler内に閉じたロジックだと直接テストできない
 * (admin.firestore()がモジュールtop-levelで評価されるため単体テストからimportできない)。
 * side-effect-freeな本モジュールに切り出すことでunit testから直接保護する
 * (/review-pr pr-test-analyzer指摘反映)。
 */
export function applySupersededOutcome(
  stats: OcrRunSupersededStats,
  error: { tokenUsage?: OcrRunTokenUsage }
): void {
  stats.superseded++;
  if (error.tokenUsage) {
    stats.pagesProcessed += error.tokenUsage.pagesProcessed;
    stats.totalInputTokens += error.tokenUsage.inputTokens;
    stats.totalOutputTokens += error.tokenUsage.outputTokens;
    stats.totalThinkingTokens += error.tokenUsage.thinkingTokens;
  }
}
