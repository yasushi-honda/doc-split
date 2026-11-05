/**
 * 向き補正あり・なしのペア比較(ab-orientation-compare)の純粋ロジック。PIIは扱わない(真偽値・比率・件数のみ)。
 */

export type Cell = 'both' | 'onOnly' | 'offOnly' | 'neither';

export interface PairRow {
  /** 補正なし1回目で書類種別が判定できたか */
  off1: boolean;
  /** 補正なし2回目(同一条件の再実行。ゆらぎの測定用) */
  off2: boolean;
  /** 補正あり */
  on: boolean;
  /** 補正なしの認識テキストの、かな・漢字の割合 */
  offJpRatio: number;
  /** 補正ありの認識テキストの、かな・漢字の割合 */
  onJpRatio: number;
}

export interface PairSummary {
  total: number;
  both: number;
  onOnly: number;
  offOnly: number;
  neither: number;
  /** 補正なし2回で判定結果が食い違った件数(OCR自体のゆらぎ) */
  noiseDisagree: number;
  offJpBands: Record<string, number>;
  onJpBands: Record<string, number>;
}

/** null・空・空白のみ・「未判定」は、判定できていないものとして扱う */
export function isDetermined(documentType: string | null | undefined): boolean {
  if (typeof documentType !== 'string') return false;
  const t = documentType.trim();
  return t !== '' && t !== '未判定';
}

export function cellOf(offDetermined: boolean, onDetermined: boolean): Cell {
  if (offDetermined && onDetermined) return 'both';
  if (!offDetermined && onDetermined) return 'onOnly';
  if (offDetermined && !onDetermined) return 'offOnly';
  return 'neither';
}

/** 空白を除いた文字のうち、ひらがな・カタカナ・漢字の割合。空は0 */
export function japaneseRatio(text: string): number {
  const chars = Array.from(text.replace(/\s/g, ''));
  if (chars.length === 0) return 0;
  const jp = chars.filter((c) => /[぀-ヿ㐀-䶿一-鿿]/.test(c)).length;
  return jp / chars.length;
}

export function japaneseRatioBand(ratio: number): string {
  if (!Number.isFinite(ratio)) return 'unknown';
  if (ratio < 0.1) return '<10%';
  if (ratio < 0.3) return '10-29%';
  if (ratio < 0.6) return '30-59%';
  return '60%+';
}

export function summarizePairs(rows: PairRow[]): PairSummary {
  const s: PairSummary = {
    total: rows.length,
    both: 0,
    onOnly: 0,
    offOnly: 0,
    neither: 0,
    noiseDisagree: 0,
    offJpBands: {},
    onJpBands: {},
  };
  for (const r of rows) {
    s[cellOf(r.off1, r.on)] += 1;
    if (r.off1 !== r.off2) s.noiseDisagree += 1;
    const ob = japaneseRatioBand(r.offJpRatio);
    const nb = japaneseRatioBand(r.onJpRatio);
    s.offJpBands[ob] = (s.offJpBands[ob] ?? 0) + 1;
    s.onJpBands[nb] = (s.onJpBands[nb] ?? 0) + 1;
  }
  return s;
}
