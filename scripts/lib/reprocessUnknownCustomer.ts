/**
 * 利用者不明(customerName='不明顧客')の書類を再処理し、結果を件数だけで測る純粋関数群。
 *
 * 目的(ADR-0031): ページ向き補正の入った新しい版で再処理したとき、利用者不明・書類種別「未判定」が
 * 解消する書類がどれだけあるかを、書類名・利用者名・ID・本文を出さずに測る。出力のキーは固定語彙のみ。
 *
 * 対象は、人が確認済み(verified)でない書類に限る。人の確認の結果が再処理で消える可能性があるため
 * (decision-makerの方針)、確認済みの書類は触らない。
 */

import type { DocTypeBucket } from './unknownCustomerDiagnosis';

export interface TargetCandidate {
  id: string;
  /** bucketStatusで正規化済みの状態 */
  status: string;
  verified: boolean;
  processedAtMs: number | null;
  /** 利用者名が不明(isCustomerUnknown) */
  customerUnknown: boolean;
}

/**
 * 再処理してよい状態か(窓は別)。選定時と、書き込み直前のトランザクション内の再確認の両方で使う。
 * 取得後に人が確認済みにした・利用者が確定した・状態が変わった書類を、再処理しないための条件。
 */
export function isReprocessEligible(d: Pick<TargetCandidate, 'status' | 'verified' | 'customerUnknown'>): boolean {
  return d.status === 'processed' && !d.verified && d.customerUnknown;
}

/**
 * 再処理の対象IDを返す。窓(sinceMs以降の処理日時)の内側・processed・人の確認なし・利用者不明の書類。
 * 処理日時の昇順(同時刻はID順)。limitが正の有限数なら先頭からlimit件に切る(カナリア用)。
 * limitが0以下・NaNは「全件」(誤って0件にしないため)。
 */
export function selectReprocessTargets(docs: TargetCandidate[], sinceMs: number, limit?: number): string[] {
  const selected = docs
    .filter((d) => isReprocessEligible(d) && d.processedAtMs !== null && d.processedAtMs >= sinceMs)
    .sort((a, b) => (a.processedAtMs as number) - (b.processedAtMs as number) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((d) => d.id);
  return typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? selected.slice(0, Math.floor(limit)) : selected;
}

export interface BeforeState {
  docTypeBucket: DocTypeBucket;
}

export interface AfterState {
  status: string;
  customerUnknown: boolean;
  docTypeBucket: DocTypeBucket;
}

export interface TransitionSummary {
  total: number;
  /** 再処理後も未完了(pending・processingなど) */
  notFinished: number;
  /** 再処理後にerror */
  error: number;
  /** 再処理後の書類が見つからない */
  missing: number;
  /** 処理済みのうち、利用者が不明でなくなった件数 */
  customerResolved: number;
  /** 処理済みのうち、書類種別が「未判定」でなくなった件数(再処理前に未判定だったものに限る) */
  docTypeResolved: number;
  /** 利用者または書類種別のどちらかが解消した件数(重複なし) */
  improved: number;
  /** 変化なし */
  unchanged: number;
  /** 書類種別が判定済み→未判定に戻った(利用者の解消がない場合) */
  worsened: number;
}

/** 再処理の前後の状態から、遷移を件数だけで集計する。IDは集計に使うだけで、結果に含めない。 */
export function summarizeTransitions(before: Map<string, BeforeState>, after: Map<string, AfterState>): TransitionSummary {
  const s: TransitionSummary = {
    total: before.size,
    notFinished: 0,
    error: 0,
    missing: 0,
    customerResolved: 0,
    docTypeResolved: 0,
    improved: 0,
    unchanged: 0,
    worsened: 0,
  };
  for (const [id, b] of before) {
    const a = after.get(id);
    if (!a) {
      s.missing += 1;
      continue;
    }
    if (a.status === 'error') {
      s.error += 1;
      continue;
    }
    if (a.status !== 'processed') {
      s.notFinished += 1;
      continue;
    }
    const custRes = !a.customerUnknown;
    const docRes = b.docTypeBucket === 'undetermined' && a.docTypeBucket !== 'undetermined';
    if (custRes) s.customerResolved += 1;
    if (docRes) s.docTypeResolved += 1;
    if (custRes || docRes) {
      s.improved += 1;
    } else if (b.docTypeBucket !== 'undetermined' && a.docTypeBucket === 'undetermined') {
      s.worsened += 1;
    } else {
      s.unchanged += 1;
    }
  }
  return s;
}

/**
 * 実行の終了コード。0=すべて完了。2=未完了が残った(部分的な結果。成功と誤読させない)。
 * 1=リセットの失敗・処理エラー・見つからない書類がある。未完了と他の問題が重なれば2(未完了を優先して知らせる)。
 */
export function exitCodeFor(s: TransitionSummary, failedResets: number): number {
  if (s.notFinished > 0) return 2;
  if (failedResets > 0 || s.error > 0 || s.missing > 0) return 1;
  return 0;
}
