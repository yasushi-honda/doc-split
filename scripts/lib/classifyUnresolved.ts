/**
 * 再処理しても未判定・利用者不明のまま残る書類を、PII(書類名・利用者名・本文)なしで、
 * 固定の帯(バケット)に丸めた特徴の件数で分類する純粋関数群。
 *
 * 目的(ADR-0031): 向き補正では解消しなかった書類の原因(認識テキストが少ない、抽出の信頼度が低い、
 * 利用者候補が無い、など)の手がかりを、公開ログに出して良い形(件数のみ)で得る。
 * 値そのもの(テキスト・名前・提案された値)は出さない。出力のキーは、ここで定義した固定語彙だけ。
 */

export type PagesBand = '1' | '2-3' | '4-9' | '10+' | 'unknown';
export type TextLengthBand = '0' | '1-49' | '50-199' | '200-999' | '1000+' | 'external' | 'missing';
export type ConfidenceBand = '0-39' | '40-69' | '70-89' | '90+' | 'none';
export type MatchTypeBucket = 'exact' | 'partial' | 'fuzzy' | 'none' | 'other' | 'missing';
export type CandidateCountBand = 'missing' | '0' | '1' | '2-4' | '5+';

export function pagesBand(value: unknown): PagesBand {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return 'unknown';
  if (value === 1) return '1';
  if (value <= 3) return '2-3';
  if (value <= 9) return '4-9';
  return '10+';
}

/** 認識テキストの長さ(文字数)だけを帯にする。内容は見ない。外部保存(ocrResultUrl)と欠損は別に数える */
export function textLengthBand(text: unknown, hasExternalUrl: boolean): TextLengthBand {
  // 本文が100000文字を超えるとStorageへ退避され、detail/main の本文欄には空文字が書かれる。
  // 外部URLがあれば、長さの帯より先に 'external' に数える(最も長い本文を「本文なし」と読み違えない)
  if (hasExternalUrl) return 'external';
  if (typeof text !== 'string') return 'missing';
  const n = text.length;
  if (n === 0) return '0';
  if (n < 50) return '1-49';
  if (n < 200) return '50-199';
  if (n < 1000) return '200-999';
  return '1000+';
}

export function confidenceBand(value: unknown): ConfidenceBand {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) return 'none';
  if (value < 40) return '0-39';
  if (value < 70) return '40-69';
  if (value < 90) return '70-89';
  return '90+';
}

const KNOWN_MATCH_TYPES: ReadonlySet<string> = new Set(['exact', 'partial', 'fuzzy', 'none']);

/** 一致の種類を固定語彙に丸める。既知でない文字列(名前など)は 'other' にして、出力に出さない */
export function matchTypeBucket(value: unknown): MatchTypeBucket {
  if (typeof value !== 'string' || value === '') return 'missing';
  return KNOWN_MATCH_TYPES.has(value) ? (value as MatchTypeBucket) : 'other';
}

export function candidateCountBand(count: unknown): CandidateCountBand {
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) return 'missing';
  if (count === 0) return '0';
  if (count === 1) return '1';
  if (count <= 4) return '2-4';
  return '5+';
}

export interface FeatureRow {
  pages: PagesBand;
  textLength: TextLengthBand;
  docTypeConfidence: ConfidenceBand;
  docTypeMatch: MatchTypeBucket;
  customerConfidence: ConfidenceBand;
  customerMatch: MatchTypeBucket;
  customerCandidates: CandidateCountBand;
  /** 処理に使った仕組み(paddle/gemini/other/unknown) */
  engine: string;
}

export type FeatureSummary = Record<keyof FeatureRow, Record<string, number>>;

const FEATURE_KEYS: ReadonlyArray<keyof FeatureRow> = [
  'pages',
  'textLength',
  'docTypeConfidence',
  'docTypeMatch',
  'customerConfidence',
  'customerMatch',
  'customerCandidates',
  'engine',
];

/** 特徴ごとに、帯ごとの件数を数える(各特徴の合計は行数に一致する) */
export function summarizeFeatures(rows: FeatureRow[]): FeatureSummary {
  const out = {} as FeatureSummary;
  for (const key of FEATURE_KEYS) out[key] = {};
  for (const r of rows) {
    for (const key of FEATURE_KEYS) {
      const band = r[key];
      out[key][band] = (out[key][band] ?? 0) + 1;
    }
  }
  return out;
}
