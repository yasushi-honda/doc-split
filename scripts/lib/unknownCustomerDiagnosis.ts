/**
 * 「利用者が不明(customerName='不明顧客')」の書類を、PII(書類名・利用者名・本文)なしで診断する純粋関数群。
 *
 * 背景(ADR-0031): 先方の画面には「不明利用者・未判定・選択待ち」の書類が9件以上あったが、
 * count-undetermined-documents(processedAt>=since かつ documentType=='未判定')では11/4分が4件だった。
 * 食い違いの原因が「集計条件の取りこぼし」(処理日時が窓外、書類種別が空欄、状態がprocessedでない等)か、
 * 「その後の処理・削除」かを切り分けるため、条件を外した件数を出す。
 *
 * 画面の「選択待ち」バッジは、顧客未確定(frontendのisCustomerConfirmedの反転: customerConfirmedがあれば
 * その値、無ければneedsManualCustomerSelection、どちらも無ければ確定済み)、事業所未確定(officeConfirmedが
 * falseかつofficeCandidatesあり)、同姓同名のいずれかで出る。`verified`(人が確認済み)や`status`には
 * 依存しない。このため「選択待ち」を確認済み・状態と切り離して数える(isSelectionWaiting)。
 * 同姓同名は顧客マスターとの照合が要るため、この診断には含めない(選択待ちの件数は、画面より少なく出うる)。
 *
 * 出力のキーは日付と固定語彙のみ。書類種別・状態は値そのものではなく、固定のバケットにして出す
 * (自由文字列が公開ログに出ないようにする)。
 */

import { jstDateKey } from './undeterminedSummary';

export type DocTypeBucket = 'undetermined' | 'empty' | 'other';

export interface DiagnosisDocInput {
  /** 状態(bucketStatusで正規化済み) */
  status: string;
  docTypeBucket: DocTypeBucket;
  processedAtMs: number | null;
  createdAtMs: number | null;
  /** customerConfirmedの真偽。欠損はnull */
  customerConfirmed: boolean | null;
  /** needsManualCustomerSelectionの真偽。欠損はnull(customerConfirmedが無いデータの選択待ち判定に使う) */
  needsManualCustomerSelection: boolean | null;
  /** 事業所未確定(officeConfirmed===falseかつofficeCandidatesが1件以上)。画面の選択待ちに含まれる */
  officeUnconfirmed: boolean;
  verified: boolean;
  /** 分割で作られた子書類か(parentDocumentIdあり) */
  isSplitChild: boolean;
}

export interface DiagnosisSummary {
  /** 窓の内側(処理日時、無ければ作成日時、両方無ければ日付なし)に入った件数 */
  inWindow: number;
  noDate: number;
  excludedByWindow: number;
  byStatus: Record<string, number>;
  byDocType: Record<string, number>;
  byCustomerConfirmed: Record<string, number>;
  verified: number;
  splitChildren: number;
  /** 画面の「選択待ち」(顧客未確定)に当たる件数。確認済み・状態に依存しない */
  selectionWaiting: number;
  waitingByStatus: Record<string, number>;
  waitingByVerified: Record<string, number>;
  waitingByDocType: Record<string, number>;
  /** 選択待ちかつ書類種別が「未判定」(先方の画面に並んでいた集団)。確認済み・状態を問わない */
  selectionWaitingUndetermined: number;
  /** 選択待ち×未判定の内訳: 人が確認済みか(true/false)・状態 */
  waitingUndeterminedByVerified: Record<string, number>;
  waitingUndeterminedByStatus: Record<string, number>;
  /** 選択待ちかつ書類種別が空欄(画面では「未判定」と出る可能性がある別集団) */
  selectionWaitingDocTypeEmpty: number;
  /** 顧客は確定済みだが事業所未確定で選択待ちになっている件数(顧客だけを見ると取りこぼす集団) */
  officeOnlySelectionWaiting: number;
  /** 前回の集計(count-undetermined-documents)の条件を、選択待ちと独立に数えた件数: processed・未判定・人の確認なし・処理日時あり */
  previousS0Candidates: number;
  processedCreatedDayMismatch: number;
  byProcessedDay: Record<string, number>;
  byCreatedDay: Record<string, number>;
}

const KNOWN_STATUSES: ReadonlySet<string> = new Set(['pending', 'processing', 'processed', 'error', 'split']);

export function bucketDocumentType(value: unknown): DocTypeBucket {
  if (value === null || value === undefined) return 'empty';
  if (typeof value === 'string') {
    const t = value.trim();
    if (t === '') return 'empty';
    return t === '未判定' ? 'undetermined' : 'other';
  }
  return 'other';
}

/** 状態を既知の値に丸める。欠損・空は'missing'、既知でない値は'other'(自由文字列を出さない) */
export function bucketStatus(value: unknown): string {
  if (typeof value !== 'string' || value === '') return 'missing';
  return KNOWN_STATUSES.has(value) ? value : 'other';
}

/** 顧客が選択待ちか。画面のisCustomerConfirmed(frontend/src/hooks/useProcessingHistory.ts)の反転と同じ */
export function isCustomerSelectionWaiting(d: {
  customerConfirmed: boolean | null;
  needsManualCustomerSelection: boolean | null;
}): boolean {
  if (d.customerConfirmed !== null) return !d.customerConfirmed;
  if (d.needsManualCustomerSelection !== null) return d.needsManualCustomerSelection;
  return false; // どちらも欠損は確定済み扱い(画面と同じ)
}

/** 画面の「選択待ち」バッジ(顧客未確定 または 事業所未確定)。同姓同名は含まない */
export function isSelectionWaiting(d: {
  customerConfirmed: boolean | null;
  needsManualCustomerSelection: boolean | null;
  officeUnconfirmed: boolean;
}): boolean {
  return isCustomerSelectionWaiting(d) || d.officeUnconfirmed;
}

function increment(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

export function summarizeDiagnosis(docs: DiagnosisDocInput[], sinceMs: number): DiagnosisSummary {
  const s: DiagnosisSummary = {
    inWindow: 0,
    noDate: 0,
    excludedByWindow: 0,
    byStatus: {},
    byDocType: {},
    byCustomerConfirmed: {},
    verified: 0,
    splitChildren: 0,
    selectionWaiting: 0,
    waitingByStatus: {},
    waitingByVerified: {},
    waitingByDocType: {},
    selectionWaitingUndetermined: 0,
    waitingUndeterminedByVerified: {},
    waitingUndeterminedByStatus: {},
    selectionWaitingDocTypeEmpty: 0,
    officeOnlySelectionWaiting: 0,
    previousS0Candidates: 0,
    processedCreatedDayMismatch: 0,
    byProcessedDay: {},
    byCreatedDay: {},
  };

  for (const d of docs) {
    // 窓の判定: 処理日時を優先、無ければ作成日時、両方無ければ日付なし(常に含める)
    const basis = d.processedAtMs ?? d.createdAtMs;
    if (basis === null) {
      s.noDate += 1;
    } else if (basis < sinceMs) {
      s.excludedByWindow += 1;
      continue;
    }
    s.inWindow += 1;

    increment(s.byStatus, d.status);
    increment(s.byDocType, d.docTypeBucket);
    increment(s.byCustomerConfirmed, d.customerConfirmed === null ? 'missing' : String(d.customerConfirmed));
    if (d.verified) s.verified += 1;
    if (d.isSplitChild) s.splitChildren += 1;

    if (isSelectionWaiting(d)) {
      s.selectionWaiting += 1;
      increment(s.waitingByStatus, d.status);
      increment(s.waitingByVerified, String(d.verified));
      increment(s.waitingByDocType, d.docTypeBucket);
      if (d.docTypeBucket === 'undetermined') {
        s.selectionWaitingUndetermined += 1;
        increment(s.waitingUndeterminedByVerified, String(d.verified));
        increment(s.waitingUndeterminedByStatus, d.status);
      }
      if (d.docTypeBucket === 'empty') s.selectionWaitingDocTypeEmpty += 1;
      if (!isCustomerSelectionWaiting(d) && d.officeUnconfirmed) s.officeOnlySelectionWaiting += 1;
    }
    // 前回の集計の条件(選択待ちに依存しない): processedAtで絞るため、処理日時なしは対象外
    if (d.status === 'processed' && d.docTypeBucket === 'undetermined' && !d.verified && d.processedAtMs !== null) {
      s.previousS0Candidates += 1;
    }

    const pDay = d.processedAtMs === null ? 'none' : jstDateKey(d.processedAtMs);
    const cDay = d.createdAtMs === null ? 'none' : jstDateKey(d.createdAtMs);
    increment(s.byProcessedDay, pDay);
    increment(s.byCreatedDay, cDay);
    if (pDay !== cDay) s.processedCreatedDayMismatch += 1;
  }
  return s;
}

export interface DailyRateRow {
  day: string;
  /** その日に処理された書類(processed)の全体件数 */
  total: number;
  /** うち利用者不明(窓の中のbyProcessedDay) */
  unknown: number;
  /** 利用者不明の率。分母0は'-' */
  rate: string;
}

/**
 * 日別の「processed全体」と「利用者不明」から、利用者不明の率の行を作る。日付(YYYY-MM-DD)のみを対象にし、
 * 日付なし('none')は除く。日付の昇順。利用者不明だけある日(全体の集計に無い日)も出す。
 */
export function dailyRateRows(totalByDay: Record<string, number>, unknownByDay: Record<string, number>): DailyRateRow[] {
  const days = new Set<string>();
  for (const k of [...Object.keys(totalByDay), ...Object.keys(unknownByDay)]) if (/^\d{4}-\d{2}-\d{2}$/.test(k)) days.add(k);
  return [...days].sort().map((day) => {
    const total = totalByDay[day] ?? 0;
    const unknown = unknownByDay[day] ?? 0;
    return { day, total, unknown, rate: total > 0 ? `${((unknown / total) * 100).toFixed(1)}%` : '-' };
  });
}
