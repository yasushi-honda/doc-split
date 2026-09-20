/**
 * 検索クエリの日付語抽出 (Issue #984 段階2a)
 *
 * 日付語（年・年月・年月日）は search_index のトークンではなく、documents.fileDate の
 * 範囲クエリで答える。search_index に日付トークンを持たせると `2026` 等が全書類の
 * postings を抱えて 1MiB 上限に達するため（ADR-0026）。
 *
 * - 日付語は正規化**前**の生の語（空白区切り）から判定する。normalizeForSearch は
 *   ハイフンを削除するため、正規化後では `2026-09-20` が日付として認識できない。
 * - 境界は UTC 暦日。documents.fileDate は UTC 00:00 で保存される (kanameone 実測 99.5%)。
 * - 年は 2000〜2099 に限定する。tokenizer の isExcludedToken の日付形と必ず一致させること
 *   （不一致だと、索引から除外された年が範囲検索にも載らず 0 件になる）。
 */

import { convertFullWidthToHalfWidth } from '../utils/textNormalizer';

/** fileDate の UTC 範囲 [startMs, endMs) */
export interface DateRangeMs {
  startMs: number;
  endMs: number;
}

export interface ExtractedDateFilters {
  /** 日付語の共通部分 (AND)。日付語なし、または共通部分が空のとき null */
  dateRange: DateRangeMs | null;
  /** 日付語が存在し、共通部分が空 (例: "2025 2026") のとき true。結果は 0 件 */
  isEmptyRange: boolean;
  /** 日付語を除いた語を元の順序で空白結合したもの。索引検索に渡す */
  remainingQuery: string;
}

/** 認識する年の範囲 (tokenizer.ts の isExcludedToken と一致させる) */
const YEAR = '(20\\d{2})';
const MONTH_DAY = '(\\d{1,2})';

const YEAR_RE = new RegExp(`^${YEAR}年?$`);
const YEAR_MONTH_RE = new RegExp(`^${YEAR}(?:[-/]${MONTH_DAY}|年${MONTH_DAY}月)$`);
const YEAR_MONTH_DAY_RE = new RegExp(
  `^${YEAR}(?:[-/]${MONTH_DAY}[-/]${MONTH_DAY}|年${MONTH_DAY}月${MONTH_DAY}日)$`
);

/** 1 語を日付範囲に変換する。日付語でない（不正な月日を含む）場合は null */
function parseDateWord(word: string): DateRangeMs | null {
  const ymd = YEAR_MONTH_DAY_RE.exec(word);
  if (ymd) {
    // group 1=年, 2/3=区切り形式の月/日, 4/5=「年月日」形式の月/日
    const year = Number(ymd[1]);
    const month = Number(ymd[2] ?? ymd[4]);
    const day = Number(ymd[3] ?? ymd[5]);
    const start = Date.UTC(year, month - 1, day);
    const d = new Date(start);
    // 13 月や 2/30 等はロールオーバーするため、往復して一致しないものは不正とみなす
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
      return null;
    }
    return { startMs: start, endMs: Date.UTC(year, month - 1, day + 1) };
  }

  const ym = YEAR_MONTH_RE.exec(word);
  if (ym) {
    const year = Number(ym[1]);
    const month = Number(ym[2] ?? ym[3]);
    if (month < 1 || month > 12) return null;
    return { startMs: Date.UTC(year, month - 1, 1), endMs: Date.UTC(year, month, 1) };
  }

  const y = YEAR_RE.exec(word);
  if (y) {
    const year = Number(y[1]);
    return { startMs: Date.UTC(year, 0, 1), endMs: Date.UTC(year + 1, 0, 1) };
  }

  return null;
}

/**
 * 生のクエリから日付語を抽出し、fileDate の UTC 範囲と残りの語を返す。
 */
export function extractDateFilters(rawQuery: string): ExtractedDateFilters {
  const words = (rawQuery ?? '').split(/[\s　]+/).filter((w) => w.length > 0);

  const remaining: string[] = [];
  let startMs = -Infinity;
  let endMs = Infinity;
  let hasDateWord = false;

  for (const word of words) {
    const range = parseDateWord(convertFullWidthToHalfWidth(word));
    if (!range) {
      remaining.push(word);
      continue;
    }
    hasDateWord = true;
    startMs = Math.max(startMs, range.startMs);
    endMs = Math.min(endMs, range.endMs);
  }

  const remainingQuery = remaining.join(' ');
  if (!hasDateWord) {
    return { dateRange: null, isEmptyRange: false, remainingQuery };
  }
  if (startMs >= endMs) {
    return { dateRange: null, isEmptyRange: true, remainingQuery };
  }
  return { dateRange: { startMs, endMs }, isEmptyRange: false, remainingQuery };
}
