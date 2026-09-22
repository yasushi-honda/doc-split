/**
 * ADR-0027 PR2b: Sarashina要約の品質採点(固有名詞捏造以外)。
 *
 * `shared/summaryFabricationScan.ts`(PR2a)は組織名の捏造検知のみを担当し、数値捏造・
 * 金額混入・cross-entity(対象者取り違え)・カバー率判定はスコープ外として本モジュールへ
 * 委譲する設計になっている(`shared/summaryFabricationScan.ts`冒頭コメント参照)。
 *
 * PR0のPython版(`scripts/fixtures/sarashina-summary-golden/pr0-verification/score.py`)の
 * カバー率判定(`hit数/facts数`の単純な率)・数値捏造検知(`\d{2,}`正規表現)を移植しつつ、
 * 金額混入検知・cross-entity判定は新規設計する。
 *
 * `sourceText`には呼び出し側が`MAX_SUMMARY_INPUT_LENGTH`(=8000、`manifest.maxInputChars`)で
 * 切り詰め済みのテキストを渡す契約とする(PR2aの`scanSummaryForFabrication`と同じ契約。
 * 原典全文を渡すと、モデルが実際には見ていない範囲を「実在扱い」してしまい偽陰性になる)。
 *
 * `normalizeForScore`は`shared/summaryFabricationScan.ts`の`normalizeForFabricationScan`とは
 * 別関数として併存させる(句読点・カンマの扱いが異なる、configVersionの独立性を保つ、
 * 意味論が異なるため混同を防ぐ — 両ファイルのヘッダコメントに相互参照を記載)。
 *
 * `/plan-crossreview`(codex 2パス)での重要な方針転換:
 * - 金額混入検知(`checkAmountProhibition`)は「金額とは何か」の陽性/陰性/境界対照コーパス
 *   なしに合否ゲート(FAIL)にできないという指摘を受け、本モジュール自体はFAIL/WARNの
 *   ポリシーを持たず構造化結果のみを返す。ゲートをWARNとして扱うかFAILとして扱うかは
 *   呼び出し側(`scripts/lib/sarashinaSummaryVerify.ts`)の責務とする。
 * - cross-entity判定(`checkCrossEntity`)は当初「inconclusiveでもpassed:true」という設計
 *   だったが、「対象者取り違えを構造的に緑判定しうる」と指摘され、`PASS`/`FAIL`/
 *   `NOT_EVALUATED`の3値`verdict`へ変更した。`NOT_EVALUATED`は呼び出し側が「全ゲートPASS」
 *   の集計から除外する(gateVerdictのnull→NOT_EVALUATED契約と同じ考え方)。
 *
 * 既知の限界(カバー率・数値捏造・金額・cross-entityそれぞれに複数件、事前に洗い出し済み。
 * PR2a同様、正規表現+構造ヒューリスティックという設計そのものの限界に起因し、形態素解析は
 * 依存コストの観点からPR2a・PR2b時点では不採用と判断済み)は各関数の直前コメントに記載する。
 */

import { fnv1aHex } from '../../shared/summaryFabricationScan';

// ============================================================================
// 正規化(score.pyの`norm()`を移植。カンマ除去のみ意図的に差分化)
// ============================================================================

/**
 * PR0 Python版`norm()`からの差分:
 * 1. NFKC正規化を追加(Python版は暗黙にこれをしていないが、JSの`[0-9]`はASCIIのみで
 *    全角数字にマッチしない。NFKCを入れないと全角数字の金額・数値が金額/数値捏造ゲートを
 *    バイパスする事故につながるため必須とする)。
 * 2. カンマ除去を「3桁区切りのみ」に限定する(Python版は全カンマ・読点を無条件除去するため、
 *    「単位数396、577」のような文が「396577」という原典に存在しない6桁数値へ偶然結合し、
 *    数値捏造の偽陽性を生みうる。3桁区切り限定なら`12,480`→`12480`の意図は保ったまま
 *    この事故を避けられる)。
 */
export function normalizeForScore(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/<\/?s>|<\/?think>/g, '')
    .replace(/(?<=[0-9])[,，](?=[0-9]{3}(?![0-9]))/g, '')
    .replace(/\s+/g, '')
    .replace(/令和8年/g, '')
    .replace(/R8/g, '')
    .replace(/要介護度/g, '要介護');
}

// ============================================================================
// spec(meta.jsonの1docエントリ相当)
// ============================================================================

export type FixtureRole = 'coverage' | 'numeric' | 'cross-entity' | 'fabrication';

export interface SummaryScoreSpec {
  facts: readonly string[];
  mustCover: readonly string[];
  optionalFacts: readonly string[];
  minCoveredFacts: number | null;
  mustNotContainAmount?: boolean;
  crossEntityPairs?: readonly (readonly [string, string])[];
  role?: FixtureRole;
}

/**
 * meta.jsonの不変条件を検証する(実装ミス・fixture編集ミスをCIで即検知する目的)。
 * 違反があればhuman-readableな文字列配列を返す(空配列=健全)。
 */
export function validateCoverageSpec(docId: string, spec: SummaryScoreSpec): string[] {
  const errors: string[] = [];
  const mustCoverSet = new Set(spec.mustCover);
  const optionalSet = new Set(spec.optionalFacts);
  const factsSet = new Set(spec.facts);

  if (mustCoverSet.size !== spec.mustCover.length) {
    errors.push(`${docId}: mustCoverに重複があります`);
  }
  if (optionalSet.size !== spec.optionalFacts.length) {
    errors.push(`${docId}: optionalFactsに重複があります`);
  }
  if (factsSet.size !== spec.facts.length) {
    errors.push(`${docId}: factsに重複があります`);
  }
  for (const f of spec.mustCover) {
    if (optionalSet.has(f)) errors.push(`${docId}: "${f}"がmustCoverとoptionalFactsの両方に含まれています`);
  }
  const union = new Set([...spec.mustCover, ...spec.optionalFacts]);
  if (union.size !== factsSet.size || [...union].some((f) => !factsSet.has(f))) {
    errors.push(`${docId}: facts が mustCover∪optionalFacts と一致しません`);
  }
  if (spec.facts.some((f) => f.length === 0)) {
    errors.push(`${docId}: factsに空文字列が含まれています`);
  }
  const factsEmpty = spec.facts.length === 0;
  if (factsEmpty && spec.minCoveredFacts !== null) {
    errors.push(`${docId}: facts=[]のときminCoveredFactsはnullである必要があります`);
  }
  if (!factsEmpty && spec.minCoveredFacts === null) {
    errors.push(`${docId}: factsが非空のときminCoveredFactsはnullにできません`);
  }
  if (spec.minCoveredFacts !== null) {
    if (spec.minCoveredFacts < spec.mustCover.length) {
      errors.push(`${docId}: minCoveredFacts(${spec.minCoveredFacts})がmustCover件数(${spec.mustCover.length})未満です`);
    }
    if (spec.minCoveredFacts > spec.facts.length) {
      errors.push(`${docId}: minCoveredFacts(${spec.minCoveredFacts})がfacts件数(${spec.facts.length})を超えています`);
    }
  }
  if (spec.role !== undefined) {
    const validRoles: FixtureRole[] = ['coverage', 'numeric', 'cross-entity', 'fabrication'];
    if (!validRoles.includes(spec.role)) {
      errors.push(`${docId}: role"${spec.role}"は不正な値です(coverage/numeric/cross-entity/fabricationのいずれか)`);
    }
  }
  if (spec.crossEntityPairs !== undefined) {
    for (const pair of spec.crossEntityPairs) {
      if (pair.length !== 2) errors.push(`${docId}: crossEntityPairsの要素は[person, org]の2要素タプルである必要があります`);
    }
  }
  return errors;
}

/** meta.jsonの生JSON(snake_case)を`SummaryScoreSpec`(camelCase)へ変換する。 */
export function parseFixtureMeta(raw: unknown): Record<string, SummaryScoreSpec> {
  const obj = raw as Record<string, Record<string, unknown>>;
  const result: Record<string, SummaryScoreSpec> = {};
  for (const [docId, entry] of Object.entries(obj)) {
    result[docId] = {
      facts: (entry.facts as string[]) ?? [],
      mustCover: (entry.mustCover as string[]) ?? [],
      optionalFacts: (entry.optionalFacts as string[]) ?? [],
      minCoveredFacts: (entry.minCoveredFacts as number | null) ?? null,
      mustNotContainAmount: entry.must_not_contain_amount as boolean | undefined,
      crossEntityPairs: entry.cross_entity_pairs as [string, string][] | undefined,
      role: entry.role as FixtureRole | undefined,
    };
  }
  return result;
}

// ============================================================================
// ①カバー率判定
// ============================================================================

/**
 * 既知の限界(カバー率):
 * 1. 部分一致のため、否定文脈(「〜の記載はない」)でも偶然ヒットしうる。
 * 2. 元号除去(`令和8年`→``)により、D7の「令和8年9月」がD2の「令和8年8月」等、無関係な
 *    月と混同されうる(日付factが事実上無条件充足に近づく)。
 * 3. 短いfact(「2割」等)は他文脈での偶然一致がありうる。
 * 4. 氏名の部分表記(「誠一様」「立花様」)は非対応(完全な姓名表記のみヒット)。
 * 5. 言い換えは`要介護度`→`要介護`の1件のみ対応、他の表現ゆれ(「介護度3」等)は非対応。
 * 6. D5〜D8の`mustCover`はPR0未実行のためfactsをそのまま暫定採用した値であり、PR2b初回
 *    実機実行の結果を踏まえ確定させる運用(`meta.json`の`_note`参照)。
 */
export interface CoverageResult {
  applicable: boolean;
  coveredFacts: string[];
  missingFacts: string[];
  missingMustCover: string[];
  mustCoverSatisfied: boolean;
  coveredCount: number;
  totalCount: number;
  coverageRatio: number | null;
  minCoveredFacts: number | null;
  minCoveredSatisfied: boolean;
  passed: boolean;
}

export function evaluateCoverage(summaryText: string, spec: SummaryScoreSpec): CoverageResult {
  const normalizedSummary = normalizeForScore(summaryText);
  const hit = (fact: string): boolean => normalizedSummary.includes(normalizeForScore(fact));

  const coveredFacts = spec.facts.filter(hit);
  const missingFacts = spec.facts.filter((f) => !hit(f));
  const missingMustCover = spec.mustCover.filter((f) => !hit(f));
  const totalCount = spec.facts.length;
  const applicable = totalCount > 0;
  const coverageRatio = applicable ? coveredFacts.length / totalCount : null;
  const minCoveredSatisfied =
    spec.minCoveredFacts === null ? true : coveredFacts.length >= spec.minCoveredFacts;
  const mustCoverSatisfied = missingMustCover.length === 0;

  return {
    applicable,
    coveredFacts,
    missingFacts,
    missingMustCover,
    mustCoverSatisfied,
    coveredCount: coveredFacts.length,
    totalCount,
    coverageRatio,
    minCoveredFacts: spec.minCoveredFacts,
    minCoveredSatisfied,
    passed: mustCoverSatisfied && minCoveredSatisfied,
  };
}

export interface CoverageAggregateInput {
  docId: string;
  role: FixtureRole;
  coverage: CoverageResult;
}

export interface CoverageAggregateResult {
  coveredTotal: number;
  factsTotal: number;
  ratio: number | null;
  thresholdPercent: number;
  passed: boolean;
  includedDocIds: string[];
  excludedDocIds: string[];
}

const DEFAULT_AGGREGATE_EXCLUDE_ROLES: readonly FixtureRole[] = ['fabrication'];
const DEFAULT_AGGREGATE_THRESHOLD_PERCENT = 85;

export function aggregateCoverage(
  inputs: readonly CoverageAggregateInput[],
  options?: { thresholdPercent?: number; excludeRoles?: readonly FixtureRole[] }
): CoverageAggregateResult {
  const thresholdPercent = options?.thresholdPercent ?? DEFAULT_AGGREGATE_THRESHOLD_PERCENT;
  const excludeRoles = new Set(options?.excludeRoles ?? DEFAULT_AGGREGATE_EXCLUDE_ROLES);

  const included = inputs.filter((i) => !excludeRoles.has(i.role) && i.coverage.applicable);
  const excluded = inputs.filter((i) => excludeRoles.has(i.role) || !i.coverage.applicable);

  const coveredTotal = included.reduce((sum, i) => sum + i.coverage.coveredCount, 0);
  const factsTotal = included.reduce((sum, i) => sum + i.coverage.totalCount, 0);
  const ratio = factsTotal > 0 ? coveredTotal / factsTotal : null;
  // 丸め誤差を避けるため整数の交差乗算で判定する(浮動小数比較はしない)。
  const passed = factsTotal > 0 && coveredTotal * 100 >= thresholdPercent * factsTotal;

  return {
    coveredTotal,
    factsTotal,
    ratio,
    thresholdPercent,
    passed,
    includedDocIds: included.map((i) => i.docId),
    excludedDocIds: excluded.map((i) => i.docId),
  };
}

// ============================================================================
// ②数値捏造検知(score.pyの`\d{2,}`方式を移植)
// ============================================================================

export interface CriticalNumericPattern {
  id: string;
  label: string;
  digitPattern: string;
  sourceGapChars: number;
}

const DEFAULT_CRITICAL_NUMERIC_PATTERNS: readonly CriticalNumericPattern[] = [
  { id: 'kaigo-level', label: '要介護', digitPattern: '[0-9]', sourceGapChars: 4 },
  { id: 'shien-level', label: '要支援', digitPattern: '[0-9]', sourceGapChars: 4 },
  { id: 'burden-ratio', label: '', digitPattern: '[0-9]割', sourceGapChars: 0 },
];

export type NumericMatchMode = 'substring' | 'token';

export interface NumericScanOptions {
  minDigits?: number;
  matchMode?: NumericMatchMode;
  criticalNumericPatterns?: readonly CriticalNumericPattern[];
}

export interface NumericFinding {
  value: string;
  start: number;
  end: number;
  context: string;
  rule: 'digit-run' | `critical:${string}`;
}

export interface NumericFabricationResult {
  findings: NumericFinding[];
  fabricatedCount: number;
  scannedCount: number;
  passed: boolean;
}

/**
 * 既知の限界(数値捏造):
 * 1. 1桁の捏造(「週2回」→「週3回」等)は`minDigits=2`の既定では検出しない
 *    (`criticalNumericPatterns`で要介護/要支援/N割のみ補う)。
 * 2. 既定の`matchMode:'substring'`では、原典`12,480`に対し要約`2,480円`のような部分文字列の
 *    捏造を検知しない(`matchMode:'token'`でより厳格化できるが、未知の出力での誤検出増加
 *    リスクを避け既定はPR0互換のsubstringとする)。
 * 3. カンマ正規化がPython版(全カンマ除去)と意図的に異なる(§正規化コメント参照)。
 * 4. NFKC正規化の副作用で丸数字(①②③)が`123`へ展開され、原典と出現順が異なると
 *    偽陽性になりうる。それでもNFKC自体は全角数字による金額/数値ゲートのバイパス防止の
 *    ため必須とする。
 * 5. 日付の妥当性(9月31日等)・小計と合計の整合・単位の取り違えは対象外(意味検証はしない)。
 * 6. `sourceText`は呼び出し側が切り詰め済みのものを渡す契約(本関数は切り詰めを行わない)。
 */
export function scanNumericFabrication(
  summaryText: string,
  sourceText: string,
  options?: NumericScanOptions
): NumericFabricationResult {
  const minDigits = options?.minDigits ?? 2;
  const matchMode = options?.matchMode ?? 'substring';
  const criticalPatterns = options?.criticalNumericPatterns ?? DEFAULT_CRITICAL_NUMERIC_PATTERNS;

  const ns = normalizeForScore(summaryText);
  const nsrc = normalizeForScore(sourceText);
  const findings: NumericFinding[] = [];
  const seen = new Set<string>();
  let scannedCount = 0;

  const sourceTokenSet =
    matchMode === 'token' ? new Set(nsrc.match(new RegExp(`[0-9]{${minDigits},}`, 'g')) ?? []) : null;

  const digitRunRe = new RegExp(`[0-9]{${minDigits},}`, 'g');
  for (const m of ns.matchAll(digitRunRe)) {
    scannedCount++;
    const value = m[0];
    if (seen.has(value)) continue;
    seen.add(value);
    const exists = matchMode === 'token' ? (sourceTokenSet as Set<string>).has(value) : nsrc.includes(value);
    if (!exists) {
      const start = m.index ?? 0;
      const end = start + value.length;
      findings.push({
        value,
        start,
        end,
        context: ns.slice(Math.max(0, start - 12), end + 12),
        rule: 'digit-run',
      });
    }
  }

  for (const pattern of criticalPatterns) {
    const re = new RegExp(escapeRegExp(pattern.label) + pattern.digitPattern, 'g');
    for (const m of ns.matchAll(re)) {
      scannedCount++;
      const digit = m[0].slice(pattern.label.length);
      const sourceRe = new RegExp(
        `${escapeRegExp(pattern.label)}[^0-9]{0,${pattern.sourceGapChars}}${escapeRegExp(digit)}`
      );
      if (!sourceRe.test(nsrc)) {
        const start = m.index ?? 0;
        const end = start + m[0].length;
        findings.push({
          value: m[0],
          start,
          end,
          context: ns.slice(Math.max(0, start - 12), end + 12),
          rule: `critical:${pattern.id}`,
        });
      }
    }
  }

  return {
    findings,
    fabricatedCount: findings.length,
    scannedCount,
    passed: findings.length === 0,
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================================
// ③金額混入検知(新規設計)
// ============================================================================

const ARABIC_AMOUNT = '[0-9]+(?:\\.[0-9]+)?(?:[兆億万千百]+)?';
const KANJI_AMOUNT = '[〇零一二三四五六七八九十百千万億壱弐参伍拾]+';
// 「円」の同形異義語(円滑・円満等)を除外する(正規化後は空白除去済みのため、直後の文字を
// 見るだけで足りる。PR2aで指摘された「正規化後に到達不能なデッドコード」を作らないよう、
// 空白許容パターンは持たない)。
const YEN_HOMOGRAPH_EXCLUDE_CHARS = new Set(['滑', '満', '形', '柱', '周', '筒', '盤', '安', '高', '卓', '陣']);

export interface AmountScanOptions {
  yenHomographExcludeChars?: ReadonlySet<string>;
}

export interface AmountMention {
  text: string;
  digits: string | null;
  start: number;
  end: number;
  kind: 'arabic' | 'kanji' | 'symbol';
}

/**
 * 既知の限界(金額):
 * 1. 単位を省略した金額(「金額: 36,366」円なしの表記)は非検知(`scanNumericFabrication`が
 *    数値そのものの捏造は相補的に拾う)。
 * 2. 「円」の同形異義語除外はリスト方式のため、リスト外の未知語には偽陽性の余地が残る。
 * 3. 語彙表現(「無料」「自己負担なし」「数万円規模」の一部)は非対応。
 * 4. 漢数字は簡易対応のみ(「金五万円也」は拾うが「参萬圓」等の旧字混在は不完全)。
 * 5. 単価表現(「10.14円換算」)も金額として拾う(禁止対象外の文書では実害なし)。
 */
export function findAmountMentions(text: string, options?: AmountScanOptions): AmountMention[] {
  const excludeChars = options?.yenHomographExcludeChars ?? YEN_HOMOGRAPH_EXCLUDE_CHARS;
  const normalized = normalizeForScore(text);
  const mentions: AmountMention[] = [];

  const yenRe = new RegExp(`(?:${ARABIC_AMOUNT}|${KANJI_AMOUNT})[円圓]`, 'g');
  for (const m of normalized.matchAll(yenRe)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const nextChar = normalized.charAt(end);
    if (excludeChars.has(nextChar)) continue;
    const digitsMatch = m[0].match(/[0-9][0-9.]*/);
    mentions.push({
      text: m[0],
      digits: digitsMatch ? digitsMatch[0] : null,
      start,
      end,
      kind: /^[0-9]/.test(m[0]) ? 'arabic' : 'kanji',
    });
  }

  const symbolRe = new RegExp(`¥${ARABIC_AMOUNT}`, 'g');
  for (const m of normalized.matchAll(symbolRe)) {
    const start = m.index ?? 0;
    const digitsMatch = m[0].match(/[0-9][0-9.]*/);
    mentions.push({
      text: m[0],
      digits: digitsMatch ? digitsMatch[0] : null,
      start,
      end: start + m[0].length,
      kind: 'symbol',
    });
  }

  mentions.sort((a, b) => a.start - b.start);
  return mentions;
}

export interface AmountProhibitionResult {
  applicable: boolean;
  mentions: AmountMention[];
  passed: boolean;
}

/**
 * 構造化結果のみを返す(FAIL/WARNのポリシーは持たない、モジュール冒頭コメント参照)。
 */
export function checkAmountProhibition(
  summaryText: string,
  spec: SummaryScoreSpec,
  options?: AmountScanOptions
): AmountProhibitionResult {
  const applicable = spec.mustNotContainAmount === true;
  if (!applicable) {
    return { applicable: false, mentions: [], passed: true };
  }
  const mentions = findAmountMentions(summaryText, options);
  return { applicable: true, mentions, passed: mentions.length === 0 };
}

// ============================================================================
// ④cross-entity(対象者取り違え)判定
// ============================================================================

/**
 * codex review指摘(P2、2回目): 改行はセグメント区切りとして機能しない設計ミスがあった
 * (`normalizeForScore`が`\s+`除去で`\r`/`\n`を先に消してしまうため、`split()`時点で
 * この正規表現の`[\r\n]+`枝は既にマッチ対象が存在しないdead codeだった)。改行分割は
 * `checkCrossEntity`側で正規化前に行う(下記参照)ため、本正規表現からは除外する。
 */
const SEGMENT_DELIMITER_RE = /・|。|;|；/;
const CLAUSE_DELIMITER_RE = /[、,，]/;

export type CrossEntityVerdict = 'PASS' | 'FAIL' | 'NOT_EVALUATED';

export interface CrossEntityFinding {
  person: string;
  org: string;
  expectedPersons: string[];
  scope: 'segment' | 'clause';
  segmentIndex: number;
  segmentText: string;
}

export interface CrossEntityOptions {
  segmentDelimiter?: RegExp;
  clauseDelimiter?: RegExp;
}

export interface CrossEntityResult {
  applicable: boolean;
  findings: CrossEntityFinding[];
  consistentPairs: { person: string; org: string }[];
  evaluatedAttributions: number;
  ambiguousSegments: number;
  unattributedOrgMentions: number;
  verdict: CrossEntityVerdict;
}

interface Occurrence {
  value: string;
  start: number;
  end: number;
}

/** 長い語彙を先に試し、包含される短い語彙の出現は捨てる(最長一致優先)。 */
function findOccurrences(text: string, vocab: readonly string[]): Occurrence[] {
  const sorted = [...vocab].sort((a, b) => b.length - a.length);
  const raw: Occurrence[] = [];
  for (const term of sorted) {
    let fromIndex = 0;
    while (fromIndex <= text.length) {
      const idx = text.indexOf(term, fromIndex);
      if (idx === -1) break;
      raw.push({ value: term, start: idx, end: idx + term.length });
      fromIndex = idx + 1;
    }
  }
  raw.sort((a, b) => a.start - b.start || b.end - a.end);
  const deduped: Occurrence[] = [];
  for (const c of raw) {
    const contained = deduped.some((p) => p.start <= c.start && c.end <= p.end);
    if (!contained) deduped.push(c);
  }
  return deduped;
}

/**
 * 既知の限界(cross-entity):
 * 1. v2プロンプトの「関係者」列挙行(複数人物が同一行に並ぶ)は判定不能として明示的に
 *    スキップする(誤検出ゼロを優先する設計判断)。
 * 2. 検知不能(inconclusive)の場合は`verdict:'NOT_EVALUATED'`とし、`PASS`集計へは含めない
 *    (`/plan-crossreview` codex High指摘反映: 「inconclusiveでもpassed:true」は取り違えを
 *    構造的に緑判定しうるため、3値判定へ変更した)。
 * 3. 多人数セグメント内で、読点が人物と事業所を実際には分断していないケース(「立花誠一様は、
 *    さくらい整形外科を受診」)は、読点で節分割した結果その節に人物がいなくなり検知漏れうる。
 * 4. 氏名の部分表記(「誠一様」)・同姓(「立花」のみ)への対応はできない。
 * 5. 語彙は`cross_entity_pairs`で明示された組み合わせに限定される。共通事業所名との
 *    誤結合は対象外(`shared/summaryFabricationScan.ts`の捏造検知の領分)。
 * 6. 否定・比較文脈(「Aではなく B」)は考慮しない。
 * 7. 正ペアが要約に一切現れない(欠落)ことはカバー率側の責務であり、本関数の対象外。
 * 8. 句読点も箇条書き記号もない1行出力では全体が1セグメントになりinconclusiveになりやすい。
 */
export function checkCrossEntity(
  summaryText: string,
  spec: SummaryScoreSpec,
  options?: CrossEntityOptions
): CrossEntityResult {
  const pairs = spec.crossEntityPairs ?? [];
  if (pairs.length === 0) {
    return {
      applicable: false,
      findings: [],
      consistentPairs: [],
      evaluatedAttributions: 0,
      ambiguousSegments: 0,
      unattributedOrgMentions: 0,
      verdict: 'NOT_EVALUATED',
    };
  }

  const segmentDelimiter = options?.segmentDelimiter ?? SEGMENT_DELIMITER_RE;
  const clauseDelimiter = options?.clauseDelimiter ?? CLAUSE_DELIMITER_RE;

  // 検索対象(summaryText)はnormalizeForScoreで空白除去済みのため、語彙側も同じ正規化を
  // 適用してから比較する(修正前は「立花 誠一」(半角スペース入り)のまま検索しており、
  // 空白除去済みの「立花誠一様」に対して一致せず、全件unattributedになるバグがあった)。
  // 報告(findings/consistentPairs)にはdecision-maker可読性のため元表記を残す。
  const normVocab = (s: string): string => normalizeForScore(s);
  const origByNorm = new Map<string, string>();
  for (const [person, org] of pairs) {
    origByNorm.set(normVocab(person), person);
    origByNorm.set(normVocab(org), org);
  }
  const personVocab = [...new Set(pairs.map((p) => normVocab(p[0])))];
  const orgVocab = [...new Set(pairs.map((p) => normVocab(p[1])))];
  const personToOrgs = new Map<string, Set<string>>();
  const orgToPersons = new Map<string, Set<string>>();
  for (const [personRaw, orgRaw] of pairs) {
    const person = normVocab(personRaw);
    const org = normVocab(orgRaw);
    if (!personToOrgs.has(person)) personToOrgs.set(person, new Set());
    personToOrgs.get(person)!.add(org);
    if (!orgToPersons.has(org)) orgToPersons.set(org, new Set());
    orgToPersons.get(org)!.add(person);
  }

  const findings: CrossEntityFinding[] = [];
  const consistentPairs: { person: string; org: string }[] = [];
  let evaluatedAttributions = 0;
  let ambiguousSegments = 0;
  let unattributedOrgMentions = 0;
  let totalOrgMentions = 0;

  const attribute = (
    person: string,
    orgHits: Occurrence[],
    scope: 'segment' | 'clause',
    segmentIndex: number,
    segmentText: string
  ): void => {
    for (const orgHit of orgHits) {
      const org = orgHit.value;
      evaluatedAttributions++;
      const personOrig = origByNorm.get(person) ?? person;
      const orgOrig = origByNorm.get(org) ?? org;
      if (personToOrgs.get(person)?.has(org)) {
        consistentPairs.push({ person: personOrig, org: orgOrig });
      } else {
        findings.push({
          person: personOrig,
          org: orgOrig,
          expectedPersons: [...(orgToPersons.get(org) ?? [])].map((p) => origByNorm.get(p) ?? p),
          scope,
          segmentIndex,
          segmentText: segmentText.slice(0, 80),
        });
      }
    }
  };

  // codex review指摘(P2、2回目): 改行を正規化(空白除去)より先に分割の境界として使う。
  // `normalizeForScore(summaryText)`をまるごと正規化してから`[\r\n]+`込みの正規表現で
  // split()すると、`\r`/`\n`は既に除去済みのため改行はセグメント境界として機能しない
  // (通常の改行区切り箇条書き・プレーンな複数文が1セグメントに結合され、取り違えが
  // ambiguousSegments扱いのNOT_EVALUATEDに落ちて検知漏れになっていた)。行ごとに
  // normalizeForScoreを適用してから`segmentDelimiter`(・/。/;/；)でさらに分割する。
  const segments = summaryText
    .split(/\r\n|\r|\n/)
    .flatMap((line) => normalizeForScore(line).split(segmentDelimiter))
    .filter((s) => s.length > 0);

  segments.forEach((segment, i) => {
    const orgHits = findOccurrences(segment, orgVocab);
    if (orgHits.length === 0) return;
    totalOrgMentions += orgHits.length;
    const personHits = findOccurrences(segment, personVocab);

    if (personHits.length === 0) {
      unattributedOrgMentions += orgHits.length;
      return;
    }
    const distinctPersons = [...new Set(personHits.map((p) => p.value))];
    if (distinctPersons.length === 1) {
      attribute(distinctPersons[0], orgHits, 'segment', i, segment);
      return;
    }

    // 多人数セグメント: 節(読点等)へ分割し、同一節に人物がちょうど1名の場合のみ帰属する。
    const clauses = segment.split(clauseDelimiter).filter((c) => c.length > 0);
    for (const clause of clauses) {
      const clauseOrgHits = findOccurrences(clause, orgVocab);
      if (clauseOrgHits.length === 0) continue;
      const clausePersonHits = [...new Set(findOccurrences(clause, personVocab).map((p) => p.value))];
      if (clausePersonHits.length !== 1) {
        ambiguousSegments++;
        continue;
      }
      attribute(clausePersonHits[0], clauseOrgHits, 'clause', i, clause);
    }
  });

  const inconclusive = evaluatedAttributions === 0 && totalOrgMentions > 0;
  const verdict: CrossEntityVerdict =
    findings.length > 0 ? 'FAIL' : inconclusive ? 'NOT_EVALUATED' : 'PASS';

  return {
    applicable: true,
    findings,
    consistentPairs,
    evaluatedAttributions,
    ambiguousSegments,
    unattributedOrgMentions,
    verdict,
  };
}

// ============================================================================
// ⑤出力形状(score.pyの`flags`相当)
// ============================================================================

export type OutputAnomaly = 'thinking-leak' | 'eos-token' | 'too-short' | 'too-long';

export interface OutputShapeOptions {
  minChars?: number;
  maxChars?: number;
}

export interface OutputShapeResult {
  chars: number;
  lines: number;
  anomalies: OutputAnomaly[];
}

/** 正規化前の生テキストに適用する(`<think>`等を正規化で消してしまわないため)。 */
export function analyzeOutputShape(rawText: string, options?: OutputShapeOptions): OutputShapeResult {
  const minChars = options?.minChars ?? 30;
  const maxChars = options?.maxChars ?? 900;
  const trimmed = rawText.trim();
  const lines = trimmed.split('\n').filter((l) => l.trim().length > 0).length;
  const anomalies: OutputAnomaly[] = [];
  if (/<think>|<\/think>|Thinking Process/.test(rawText)) anomalies.push('thinking-leak');
  if (rawText.includes('</s>')) anomalies.push('eos-token');
  if (trimmed.length < minChars) anomalies.push('too-short');
  if (trimmed.length > maxChars) anomalies.push('too-long');
  return { chars: trimmed.length, lines, anomalies };
}

// ============================================================================
// 合成
// ============================================================================

export interface SummaryScoreOptions {
  numeric?: NumericScanOptions;
  amount?: AmountScanOptions;
  crossEntity?: CrossEntityOptions;
  outputShape?: OutputShapeOptions;
  aggregateThresholdPercent?: number;
}

export interface SummaryScoreResult {
  coverage: CoverageResult;
  numeric: NumericFabricationResult;
  amount: AmountProhibitionResult;
  crossEntity: CrossEntityResult;
  output: OutputShapeResult;
  blocking: string[];
  warnings: string[];
  passed: boolean;
  configVersion: string;
}

export const DEFAULT_SUMMARY_SCORE_CONFIG = {
  minDigits: 2,
  matchMode: 'substring' as NumericMatchMode,
  criticalNumericPatterns: DEFAULT_CRITICAL_NUMERIC_PATTERNS,
  yenHomographExcludeChars: [...YEN_HOMOGRAPH_EXCLUDE_CHARS].sort(),
  aggregateThresholdPercent: DEFAULT_AGGREGATE_THRESHOLD_PERCENT,
};

export const SUMMARY_SCORE_CONFIG_VERSION: string = fnv1aHex(JSON.stringify(DEFAULT_SUMMARY_SCORE_CONFIG));

/**
 * 個々の判定(コード)を合成し、blocking(不合格理由)/warnings(非ブロック事項)を
 * 組み立てる。金額混入は本関数でも常にwarnings扱い(FAILにはしない、モジュール冒頭コメント
 * 参照)。cross-entityは`verdict:'FAIL'`のみblockingに含め、`NOT_EVALUATED`はwarningsに
 * 「検知不能だった」旨を記録する(「静かな緑」を作らない)。
 */
export function scoreSummary(
  summaryText: string,
  sourceText: string,
  spec: SummaryScoreSpec,
  options?: SummaryScoreOptions
): SummaryScoreResult {
  const configVersion =
    options === undefined
      ? SUMMARY_SCORE_CONFIG_VERSION
      : fnv1aHex(
          JSON.stringify({
            minDigits: options.numeric?.minDigits ?? DEFAULT_SUMMARY_SCORE_CONFIG.minDigits,
            matchMode: options.numeric?.matchMode ?? DEFAULT_SUMMARY_SCORE_CONFIG.matchMode,
            criticalNumericPatterns:
              options.numeric?.criticalNumericPatterns ?? DEFAULT_SUMMARY_SCORE_CONFIG.criticalNumericPatterns,
            yenHomographExcludeChars: options.amount?.yenHomographExcludeChars
              ? [...options.amount.yenHomographExcludeChars].sort()
              : DEFAULT_SUMMARY_SCORE_CONFIG.yenHomographExcludeChars,
            aggregateThresholdPercent:
              options.aggregateThresholdPercent ?? DEFAULT_SUMMARY_SCORE_CONFIG.aggregateThresholdPercent,
          })
        );

  const coverage = evaluateCoverage(summaryText, spec);
  const numeric = scanNumericFabrication(summaryText, sourceText, options?.numeric);
  const amount = checkAmountProhibition(summaryText, spec, options?.amount);
  const crossEntity = checkCrossEntity(summaryText, spec, options?.crossEntity);
  const output = analyzeOutputShape(summaryText, options?.outputShape);

  const blocking: string[] = [];
  const warnings: string[] = [];

  if (!coverage.mustCoverSatisfied) {
    blocking.push(`カバー率: mustCover未充足(${coverage.missingMustCover.join('、')})`);
  }
  if (!coverage.minCoveredSatisfied) {
    blocking.push(`カバー率: minCoveredFacts未達(${coverage.coveredCount}/${coverage.minCoveredFacts})`);
  }
  if (!numeric.passed) {
    blocking.push(`数値捏造: ${numeric.fabricatedCount}件(${numeric.findings.map((f) => f.value).join('、')})`);
  }
  if (amount.applicable && !amount.passed) {
    warnings.push(`金額混入(WARN、FAILゲート化は対照コーパス整備後に検討): ${amount.mentions.map((m) => m.text).join('、')}`);
  }
  if (crossEntity.verdict === 'FAIL') {
    blocking.push(
      `cross-entity取り違え: ${crossEntity.findings.map((f) => `${f.person}⇔${f.org}`).join('、')}`
    );
  } else if (crossEntity.verdict === 'NOT_EVALUATED' && crossEntity.applicable) {
    warnings.push('cross-entity: 判定不能(列挙行中心の出力等)。人手レビュー推奨');
  }
  if (output.anomalies.includes('thinking-leak')) {
    blocking.push('出力形状: thinking漏れ');
  }
  for (const a of output.anomalies) {
    if (a !== 'thinking-leak') warnings.push(`出力形状: ${a}`);
  }

  return {
    coverage,
    numeric,
    amount,
    crossEntity,
    output,
    blocking,
    warnings,
    passed: blocking.length === 0,
    configVersion,
  };
}
