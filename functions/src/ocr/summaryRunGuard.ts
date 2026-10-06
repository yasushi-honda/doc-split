/**
 * 要約生成の所有権(summaryRunId)・実行分類・バックフィル防止判定 (ADR-0027 PR4)
 *
 * `ocrRunGuard.ts`と同じ設計: firebase-adminを一切importしないside-effect-freeモジュール
 * とし、単体テストがadmin初期化なしで直接importできるようにする。
 *
 * 要約は`generateSummaryBatch`(スケジュール実行、逐次claim)と`regenerateSummary`
 * (手動onCall)の2経路から書き込まれうるため、OCRの単一経路(processOCR)より
 * 所有権検証の対象が広い: `summaryRunId`(この実行が自分がclaimしたものか)に加え、
 * `ocrRunId`(claim後にreprocess等で新しいOCR実行が始まり、要約対象のOCR結果が
 * 差し替わっていないか)も検証する。
 */

import { SarashinaSummaryError } from './sarashinaSummaryClient';
import { classifySummaryError, type SummaryErrorClassification } from './summaryErrorClassification';
import { MIN_OCR_LENGTH_FOR_SUMMARY } from './summaryPromptBuilder';
import { SARASHINA_SUMMARY_CONFIG, type SummaryProviderSetting } from '../utils/config';

/** バッチ1tickあたりのclaim試行上限。stuck rescueがこれに達したdocを恒久エラーへ倒す。 */
export const MAX_SUMMARY_ATTEMPTS = 3;

/** `generateSummaryBatch`(onSchedule)のtimeoutSeconds。他の派生定数の基準値。 */
export const SUMMARY_BATCH_TIMEOUT_SECONDS = 1800;

/** バッチ1tickで取得する文書数の上限(処理保証数ではなく取得上限)。 */
export const SUMMARY_BATCH_LIMIT = 20;

/**
 * 1文書のclaimが最悪どれだけ時間を消費しうるかの見積り(ms、codex review P1指摘反映)。
 *
 * `generateSummaryForProvider`(`summaryPass.ts`の`callSarashinaWithContextRetry`)は
 * `contextExceeded`(400)を受けた場合、入力を縮小して**もう1回**Sarashinaへリクエストする
 * (ADR-0027 PR3知見7)。したがって1件のclaimは最悪`requestTimeoutMs`(620秒)の
 * リクエストを**2回**実行しうる。1回分だけを見積もると、ソフトデッドライン直前で
 * claimした文書がこの2回目のリクエストの途中で関数タイムアウト(1800秒)を超えて
 * ハードキルされうる(修正前の実際のバグ、当初は1回分のみで計算していた)。
 */
export const SUMMARY_WORST_CASE_CLAIM_DURATION_MS = SARASHINA_SUMMARY_CONFIG.requestTimeoutMs * 2;

/**
 * バッチのソフトデッドライン(ms): この時刻を過ぎたら新規のclaimを開始せず、残りは次tickへ
 * 委ねる。
 *
 * PR-C(手動・非同期化)で、関数タイムアウトから逆算した約380秒から**120秒**へ短縮した。
 * 手動依頼は「実行中のtickの終了」を待つため(実行中の定期起動はSchedulerがスキップする)、
 * tickが長いほど依頼から処理開始までの待ち時間が伸びる。120秒なら、tickは最長でも
 * 「120秒 + 最後に始めた1件分(p95 約241秒、最悪は`SUMMARY_WORST_CASE_CLAIM_DURATION_MS`)」で
 * 終わる。1件が最悪ケース(context-exceeded再送を含む2リクエスト)に達しても関数タイムアウト
 * (1800秒)を超えないこと(旧設計の不変条件)は、より厳しい値になったことで満たされ続ける
 * (`summaryRunGuard.test.ts`で固定)。
 */
export const SUMMARY_BATCH_SOFT_DEADLINE_MS = 120_000;

/**
 * stuck rescueの閾値(ms): 関数タイムアウト(1800s)+5分マージン(`processOCR.ts`の
 * `STUCK_PROCESSING_THRESHOLD_MS`と同じ方式)。
 *
 * 【不変条件】必ず`SUMMARY_BATCH_TIMEOUT_SECONDS*1000`より大きくなければならない。
 * claimの所有者(バッチtickまたは手動onCall)が生きている限りは正当に処理中でありうるため、
 * 「1リクエストの典型時間(実測約204秒)」ではなく「claim所有者が確実に死んでいると言える
 * 時間(=関数の最大生存時間)」を基準にする。
 */
export const SUMMARY_STUCK_THRESHOLD_MS = SUMMARY_BATCH_TIMEOUT_SECONDS * 1000 + 5 * 60 * 1000;

/** Firestoreから読み直した最新ドキュメントの関連フィールド(型は未検証のunknownで受ける) */
export interface SummaryRunFreshState {
  summaryState?: unknown;
  summaryRunId?: unknown;
  ocrRunId?: unknown;
}

/** この実行がclaim時点で保持していた所有権トークンと、対象とするOCR実行のトークン */
export interface SummaryRunExpectation {
  summaryRunId: string;
  /** claim時点のocrRunId。ocrRunIdを持たない文書(手動claimでOCR完了検証が不要な場合)はnull。 */
  ocrRunId: string | null;
}

export type SummaryRunOwnershipReason = 'run-id-mismatch' | 'state-mismatch' | 'ocr-generation-drift';

export type SummaryRunOwnershipResult = { ok: true } | { ok: false; reason: SummaryRunOwnershipReason };

/**
 * 判定順序はログ集計・テストの契約: summaryRunId → summaryState → ocrRunId。
 * `ocrRunGuard.ts`の`evaluateOcrRunOwnership`と同じ固定順ポリシー。
 */
export function evaluateSummaryRunOwnership(
  fresh: SummaryRunFreshState,
  expected: SummaryRunExpectation
): SummaryRunOwnershipResult {
  if (fresh.summaryRunId !== expected.summaryRunId) {
    return { ok: false, reason: 'run-id-mismatch' };
  }
  if (fresh.summaryState !== 'processing') {
    return { ok: false, reason: 'state-mismatch' };
  }
  const freshOcrRunId = fresh.ocrRunId ?? null;
  if (freshOcrRunId !== expected.ocrRunId) {
    return { ok: false, reason: 'ocr-generation-drift' };
  }
  return { ok: true };
}

/**
 * evaluateSummaryRunOwnership()がng判定を返した際にthrowするマーカーエラー。
 * `OcrRunSupersededError`と同じinstanceof判定パターン: caller側はこれを
 * 「別の実行に引き継がれた正常なsupersede」として扱い、attemptCount消費や
 * `summaryState:'error'`化を行わない。
 */
export class SummarySupersededError extends Error {
  constructor(
    message: string,
    public readonly docId: string,
    public readonly reason: SummaryRunOwnershipReason
  ) {
    super(message);
    this.name = 'SummarySupersededError';
  }
}

export type SummaryFailureOutcome =
  // Sarashinaのtimeout: Cloud Run timeout後もコンテナ側が処理を継続しうるため、その場では
  // 再送しない(二重推論防止)。summaryStateはprocessingのまま残しstuck rescueに委ねる。
  | { action: 'leave-processing-stop-batch' }
  // Sarashinaのconfig(サービスURL不正等): 実行環境の設定不備のためattemptを消費せず中断する。
  | { action: 'abort-batch-config' }
  | { action: 'retry-or-error'; kind: 'quota' | 'transient'; stopBatch: boolean }
  | { action: 'error'; kind: 'unknown' };

/**
 * 要約生成失敗を分類する。`SarashinaSummaryError`を先に判定してから既存の
 * `classifySummaryError`(Sarashina以外の例外の受け皿)へフォールバックする(ADR-0027 PR3知見10(b)の
 * 申し送り通り: `classifySummaryError`は`SarashinaSummaryError`の`httpStatus`フィールドを
 * 認識せず、誤って`unknown`に落ちてしまうため、instanceof判定を先に行う必要がある)。
 */
export function classifySummaryFailure(err: unknown): SummaryFailureOutcome {
  if (err instanceof SarashinaSummaryError) {
    switch (err.kind) {
      case 'timeout':
        return { action: 'leave-processing-stop-batch' };
      case 'config':
        return { action: 'abort-batch-config' };
      case 'transient':
        return { action: 'retry-or-error', kind: 'transient', stopBatch: true };
      case 'permanent':
      case 'incomplete':
      case 'contextExceeded':
        // 固定のSummaryErrorKind値集合には'permanent'/'incomplete'/'contextExceeded'に
        // 対応する専用値がないため'unknown'に丸める。詳細はsummaryError(診断文字列)へ残す。
        return { action: 'error', kind: 'unknown' };
    }
  }

  const classification: SummaryErrorClassification = classifySummaryError(err);
  switch (classification) {
    case 'quota':
      return { action: 'retry-or-error', kind: 'quota', stopBatch: false };
    case 'transient':
      return { action: 'retry-or-error', kind: 'transient', stopBatch: false };
    default:
      return { action: 'error', kind: 'unknown' };
  }
}

export type OcrCompletionSummaryDecision = { kind: 'absent' } | { kind: 'set'; state: 'pending' | 'skipped' };

/**
 * OCR完了時に`summaryState`をどう扱うかを決定する(バックフィル防止の中核、
 * ADR-0027「主要な設計判断4」)。
 *
 * 要約は「手動を基本、自動は見送り」(PR-C、2026-10-04決定)のため、既定では
 * `summaryState`フィールド自体を書かない(`kind:'absent'`)。次のいずれかで'absent'になる:
 * - L1(`SUMMARY_PROVIDER`)が'none'
 * - `autoEnabled`(`settings/features.autoSummaryOnOcr === true`)が偽
 *
 * これにより、後日L1を'sarashina'へ切り替えても、切替前に完了していた文書が
 * まとめて「バックフィル」されることはなく、自動生成を再開するかどうかは設定で選べる。
 */
export function decideOcrCompletionSummaryState(
  l1: SummaryProviderSetting,
  ocrLength: number,
  autoEnabled: boolean
): OcrCompletionSummaryDecision {
  if (l1 === 'none' || !autoEnabled) {
    return { kind: 'absent' };
  }
  return { kind: 'set', state: ocrLength >= MIN_OCR_LENGTH_FOR_SUMMARY ? 'pending' : 'skipped' };
}
