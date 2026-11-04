/**
 * 「利用者が不明(customerName='不明顧客')」の書類を、PII(書類名・利用者名・本文)なしで診断する純粋関数群。
 *
 * 背景(ADR-0031): 先方の画面には「不明利用者・未判定・選択待ち」の書類が9件以上あったが、
 * count-undetermined-documents(processedAt>=since かつ documentType=='未判定')では11/4分が4件だった。
 * 食い違いの原因が「集計条件の取りこぼし」(処理日時が窓外、書類種別が空欄、状態がprocessedでない等)か、
 * 「その後の処理・削除」かを切り分けるため、条件を外した件数を出す。
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
  /** 画面の「不明利用者・未判定・選択待ち」に当たる組み合わせ: processed・未判定・顧客未確定・人の確認なし */
  screenPatternStrict: number;
  /** 上と同じだが書類種別が空欄(画面では「未判定」と出る可能性がある別集団) */
  screenPatternDocTypeEmpty: number;
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
    screenPatternStrict: 0,
    screenPatternDocTypeEmpty: 0,
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

    const unconfirmed = d.customerConfirmed !== true && !d.verified && d.status === 'processed';
    if (unconfirmed && d.docTypeBucket === 'undetermined') s.screenPatternStrict += 1;
    if (unconfirmed && d.docTypeBucket === 'empty') s.screenPatternDocTypeEmpty += 1;

    const pDay = d.processedAtMs === null ? 'none' : jstDateKey(d.processedAtMs);
    const cDay = d.createdAtMs === null ? 'none' : jstDateKey(d.createdAtMs);
    increment(s.byProcessedDay, pDay);
    increment(s.byCreatedDay, cDay);
    if (pDay !== cDay) s.processedCreatedDayMismatch += 1;
  }
  return s;
}
