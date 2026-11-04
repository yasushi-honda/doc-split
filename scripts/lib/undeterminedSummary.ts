/**
 * 書類種別が「未判定」の書類を、PII(書類名・利用者名・本文)なしで集計する純粋関数群。
 *
 * count-undetermined-documents.ts(読み取り専用)が使う。入力は数値・真偽・種別だけで、
 * 出力にも文字列の識別子(書類名・利用者名・事業所名・本文)は含まれない(型で保証し、テストで固定)。
 * GitHub Actionsのログは公開されるため、運用スクリプトの出力は件数のみにする。
 *
 * 出力のキーに自由文字列が入る唯一の経路だったmimeType(Gmail添付のContent-Typeは送信者が任意に
 * 決められる)は、許可リストで正規化し、それ以外は'other'にまとめる(normalizeMimeType)。
 */

import { CUSTOMER_INVALID_SENTINELS } from '../../shared/customerIdentity';

export interface UndeterminedDocInput {
  /** 処理日時(取込時刻)のエポックms。欠損はnull */
  processedAtMs: number | null;
  /** 人が確認済みか(verified === true) */
  verified: boolean;
  /** 利用者が不明のまま(customerNameが共有のsentinel「未判定」「不明顧客」・空・欠損) */
  customerUnknown: boolean;
  totalPages: number | null;
  mimeType: string | null;
  /** 複数利用者FAXの複製(ADR-0024)に属するか */
  hasDistributionId: boolean;
}

export interface DayCounts {
  total: number;
  /** 再処理の対象になりうる件数(未確認かつ利用者不明) */
  reprocessTargets: number;
}

export interface UndeterminedSummary {
  total: number;
  verified: number;
  unverified: number;
  /** 未確認かつ利用者不明(再処理の対象候補) */
  reprocessTargets: number;
  withDistributionId: number;
  byDay: Record<string, DayCounts>;
  pagesBand: Record<string, number>;
  mimeTypes: Record<string, number>;
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** エポックmsをJSTの暦日(YYYY-MM-DD)にする */
export function jstDateKey(ms: number): string {
  return new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** ページ数を帯に分ける(inspect-ocr-volume-statsと同じ帯)。不正値はunknown */
export function pageBand(pages: number | null): string {
  if (pages === null || !Number.isFinite(pages) || pages < 1) return 'unknown';
  if (pages === 1) return '1';
  if (pages <= 20) return '2-20';
  if (pages <= 50) return '21-50';
  return '51+';
}

const MIME_ALLOWLIST: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/gif',
]);

/**
 * MIMEタイプを許可リストで正規化する。パラメータ(; charset=...)は除き小文字にそろえ、許可リスト外は
 * 'other'、欠損・空は'unknown'。自由文字列(個人名など)が公開ログに出ないようにするための丸め。
 */
export function normalizeMimeType(mime: string | null): string {
  if (!mime) return 'unknown';
  const base = mime.split(';')[0].trim().toLowerCase();
  if (!base) return 'unknown';
  return MIME_ALLOWLIST.has(base) ? base : 'other';
}

/**
 * 利用者が不明のままか。共有のsentinel(未判定・不明顧客)・空・欠損・文字列以外は不明とみなす
 * (shared/customerIdentity.tsのCUSTOMER_INVALID_SENTINELSと同じ定義)。
 */
export function isCustomerUnknown(name: unknown): boolean {
  if (typeof name !== 'string' || name.trim() === '') return true;
  return CUSTOMER_INVALID_SENTINELS.has(name);
}

/**
 * --since の値(YYYY-MM-DD、JST)をJST 0時のエポックmsにする。欠落・形式違い・存在しない日付
 * (2月30日のような繰り上がり)・別フラグは null。
 */
export function parseSinceArg(value: string | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00+09:00`);
  if (Number.isNaN(ms)) return null;
  // 2月30日などはDate.parseが翌月へ繰り上げるため、往復して同じ日付に戻ることを確認する
  return jstDateKey(ms) === value ? ms : null;
}

export interface DayRange {
  /** JSTの暦日(YYYY-MM-DD) */
  day: string;
  startMs: number;
  /** 終了(含まない) */
  endMs: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** sinceMs(JST 0時)から、nowMsを含む日までの日別の[開始, 終了)。JSTは夏時間がなく24時間刻みで暦日と一致する */
export function jstDayRanges(sinceMs: number, nowMs: number): DayRange[] {
  const ranges: DayRange[] = [];
  for (let start = sinceMs; start <= nowMs; start += DAY_MS) {
    ranges.push({ day: jstDateKey(start), startMs: start, endMs: start + DAY_MS });
  }
  return ranges;
}

function increment(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

export function summarizeUndetermined(docs: UndeterminedDocInput[]): UndeterminedSummary {
  const summary: UndeterminedSummary = {
    total: 0,
    verified: 0,
    unverified: 0,
    reprocessTargets: 0,
    withDistributionId: 0,
    byDay: {},
    pagesBand: {},
    mimeTypes: {},
  };

  for (const d of docs) {
    summary.total += 1;
    if (d.verified) summary.verified += 1;
    else summary.unverified += 1;
    const isTarget = !d.verified && d.customerUnknown;
    if (isTarget) summary.reprocessTargets += 1;
    if (d.hasDistributionId) summary.withDistributionId += 1;

    const day = d.processedAtMs === null ? 'unknown' : jstDateKey(d.processedAtMs);
    const counts = (summary.byDay[day] ??= { total: 0, reprocessTargets: 0 });
    counts.total += 1;
    if (isTarget) counts.reprocessTargets += 1;

    increment(summary.pagesBand, pageBand(d.totalPages));
    increment(summary.mimeTypes, normalizeMimeType(d.mimeType));
  }
  return summary;
}
