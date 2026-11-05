/**
 * 時間窓ごとの割合(未判定率など)を集計・表示するための純粋関数群(PIIなし、件数と割合のみ)。
 *
 * 目的(ADR-0031): 向き補正を反映した時刻の前後で、未判定の率が変わったかを比べる。件数が少ないと
 * 割合は大きく振れるため、95%信頼区間(ウィルソン)を併記して、小さな差を過大に読まない。
 */

const JST_OFFSET_MS = 9 * 3_600_000;

/** JSTの「YYYY-MM-DDTHH:mm」をUTCのミリ秒に変換する。形式違い・存在しない日時はnull(別の日時に黙って丸めない) */
export function parseJstDateTime(value: string | undefined): number | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (h > 23 || mi > 59) return null;
  const utc = Date.UTC(y, mo - 1, d, h, mi);
  const back = new Date(utc);
  // 2/30のような存在しない日付は、Date.UTCが繰り上げるため、往復で一致を確認して弾く
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return utc - JST_OFFSET_MS;
}

export interface TimeRange {
  startMs: number;
  endMs: number;
}

/** [startMs, endMs) を、stepMs幅で区切る。最後の区間はendMsで切る。不正な入力は空 */
export function timeRanges(startMs: number, endMs: number, stepMs: number): TimeRange[] {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !Number.isFinite(stepMs) || stepMs <= 0 || endMs <= startMs) return [];
  const out: TimeRange[] = [];
  for (let s = startMs; s < endMs; s += stepMs) out.push({ startMs: s, endMs: Math.min(s + stepMs, endMs) });
  return out;
}

/** 割合 k/n の95%信頼区間(ウィルソン)。nが0以下、kが範囲外ならnull */
export function wilsonInterval(k: number, n: number): { lower: number; upper: number } | null {
  if (!Number.isFinite(k) || !Number.isFinite(n) || n <= 0 || k < 0 || k > n) return null;
  const z = 1.96;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { lower: Math.max(0, center - half), upper: Math.min(1, center + half) };
}

/** 「8.0% [4.1–15.0]」の形(割合と、95%信頼区間のパーセント)。分母0は'-' */
export function formatRate(k: number, n: number): string {
  const ci = wilsonInterval(k, n);
  if (!ci) return '-';
  return `${((k / n) * 100).toFixed(1)}% [${(ci.lower * 100).toFixed(1)}–${(ci.upper * 100).toFixed(1)}]`;
}
