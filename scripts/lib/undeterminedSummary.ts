/**
 * 書類種別が「未判定」の書類を、PII(書類名・利用者名・本文)なしで集計する純粋関数群。
 *
 * count-undetermined-documents.ts(読み取り専用)が使う。入力は数値・真偽・種別だけで、
 * 出力にも文字列の識別子(書類名・利用者名・事業所名・本文)は含まれない(型で保証し、テストで固定)。
 * GitHub Actionsのログは公開されるため、運用スクリプトの出力は件数のみにする。
 */

export interface UndeterminedDocInput {
  /** 処理日時(取込時刻)のエポックms。欠損はnull */
  processedAtMs: number | null;
  /** 人が確認済みか(verified === true) */
  verified: boolean;
  /** 利用者が不明のまま(customerNameが「不明顧客」または欠損) */
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
    increment(summary.mimeTypes, d.mimeType ?? 'unknown');
  }
  return summary;
}
