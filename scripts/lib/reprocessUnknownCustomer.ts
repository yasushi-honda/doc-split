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
  docTypeBucket: DocTypeBucket;
}

/**
 * 再処理の対象の決め方。
 * - unknown-customer(既定): 利用者が不明な書類(書類種別は問わない)
 * - undetermined: 書類種別が「未判定」の書類(利用者が確定済みのものも含む)
 */
export type ReprocessMode = 'unknown-customer' | 'undetermined';

/**
 * 再処理してよい状態か(窓は別)。選定時と、書き込み直前のトランザクション内の再確認の両方で使う。
 * 取得後に人が確認済みにした・利用者が確定した・書類種別が判定された・状態が変わった書類を、
 * 再処理しないための条件。
 */
export function isReprocessEligible(
  d: Pick<TargetCandidate, 'status' | 'verified' | 'customerUnknown' | 'docTypeBucket'>,
  mode: ReprocessMode = 'unknown-customer',
): boolean {
  if (d.status !== 'processed' || d.verified) return false;
  return mode === 'undetermined' ? d.docTypeBucket === 'undetermined' : d.customerUnknown;
}

/**
 * 再処理の対象IDを返す。窓(sinceMs以降の処理日時)の内側・processed・人の確認なし・利用者不明の書類。
 * untilMs(排他的な上限)を指定すると、処理日時がそれ以降の書類は除く(月ごとの再処理用)。
 * 処理日時の昇順(同時刻はID順)。limitが正の有限数なら先頭からlimit件に切る(カナリア用)。
 * limitが0以下・NaNは「全件」(誤って0件にしないため)。
 */
export function selectReprocessTargets(
  docs: TargetCandidate[],
  sinceMs: number,
  limit?: number,
  mode: ReprocessMode = 'unknown-customer',
  untilMs?: number,
): string[] {
  const selected = docs
    .filter(
      (d) =>
        isReprocessEligible(d, mode) &&
        d.processedAtMs !== null &&
        d.processedAtMs >= sinceMs &&
        (untilMs === undefined || d.processedAtMs < untilMs),
    )
    .sort((a, b) => (a.processedAtMs as number) - (b.processedAtMs as number) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((d) => d.id);
  return typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? selected.slice(0, Math.floor(limit)) : selected;
}

export interface BeforeState {
  docTypeBucket: DocTypeBucket;
  /** 再処理前に利用者が不明だったか(「利用者が不明でなくなった」を、元から確定済みの書類で水増ししないため) */
  customerUnknown: boolean;
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
  /** 処理済みのうち、元は利用者が確定済みだったのに、再処理で不明に戻った件数(確定値が再OCRで失われた副作用) */
  customerLost: number;
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
    customerLost: 0,
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
    const custRes = b.customerUnknown && !a.customerUnknown;
    const docRes = b.docTypeBucket === 'undetermined' && a.docTypeBucket !== 'undetermined';
    if (custRes) s.customerResolved += 1;
    if (!b.customerUnknown && a.customerUnknown) s.customerLost += 1;
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
 * 1=リセットの失敗・処理エラー・見つからない書類・利用者を失った書類がある。未完了と他の問題が重なれば2(未完了を優先して知らせる)。
 */
export function exitCodeFor(s: TransitionSummary, failedResets: number): number {
  if (s.notFinished > 0) return 2;
  if (failedResets > 0 || s.error > 0 || s.missing > 0 || s.customerLost > 0) return 1;
  return 0;
}

/**
 * processOCRの実測の処理能力(1分あたりの書類数)。コード上の上限は1分5件(BATCH_SIZE=5)だが、
 * 実測は遅い: 10月分75件のうち67件が40分(約1.7件/分)、11月分47件が約25分(約1.9件/分)。
 * 余裕を見て1.5件/分で見積もる。
 */
const OCR_QUEUE_PER_MINUTE = 1.5;

/**
 * count件の再処理が、待機時間(分)の内に終わる見込みか。再処理した書類は古いprocessedAtのまま
 * pendingへ戻るため、新しく届く書類より先に処理される(その間、新規の処理が遅れる)。見込みを超える
 * 件数を書き込んでしまうと、待機が切れて集計が不完全になるため、書き込みの前に判定する。
 */
export function fitsInWaitWindow(count: number, waitMinutes: number): boolean {
  if (!Number.isFinite(waitMinutes) || waitMinutes <= 0) return false;
  return count <= Math.floor(waitMinutes * OCR_QUEUE_PER_MINUTE);
}

/** count件の再処理で、新しく届く書類の処理が遅れる見込み(分、切り上げ) */
export function estimatedDelayMinutes(count: number): number {
  return count <= 0 ? 0 : Math.ceil(count / OCR_QUEUE_PER_MINUTE);
}

export type OcrEngineBucket = 'paddle' | 'gemini' | 'other' | 'unknown';

/** 書類を処理したOCRの仕組み(ocrExtraction.version)を、固定語彙に丸める。自由文字列は出力に出さない */
export function ocrEngineBucket(version: unknown): OcrEngineBucket {
  // OCRを実行しなかった書類は、versionに文字どおり'unknown'が書かれる。第3の仕組み(other)と読み違えない
  if (typeof version !== 'string' || version.trim() === '' || version.trim() === 'unknown') return 'unknown';
  if (/gemini/i.test(version)) return 'gemini';
  if (/pp-?ocr/i.test(version)) return 'paddle';
  return 'other';
}
