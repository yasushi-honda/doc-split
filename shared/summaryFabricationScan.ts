/**
 * 要約の固有名詞捏造検知(ADR-0027 PR2a)
 *
 * frontend/functions 双方から参照される可能性があるため shared/ に配置(PaddleOCR系の
 * `shared/customerIdentity.ts` と同じ配置方針)。Firestore/Admin SDK 非依存の純粋関数。
 * PR2時点では呼び出し元が存在しない(dead code)。PR4の `generateSummaryBatch` が
 * `summaryPass()` 後の捏造スキャンステップとして呼ぶ想定(ADR-0027アーキテクチャ概要参照)。
 *
 * 設計の経緯(PR0検証スクリプト `scripts/fixtures/sarashina-summary-golden/pr0-verification/
 * scan_entity_fabrication.py` からの移植 + 精度改善):
 *
 * PR0のPython版は正規表現 `[一-龠ぁ-んァ-ヶー・]{2,12}(?:事業所|...)` のみで判定しており、
 * PR0結果JSON(28run)に対して28run中13runで誤検出(false positive)を出していた
 * (実測・再現確認済み、`scripts/fixtures/sarashina-summary-golden/pr0-fabrication-expected.json`
 * に期待値として固定)。誤検出の内訳は大きく2種類:
 *
 * 1. 地の文巻き込み(16件): 正規表現の文字クラスがgreedyすぎて助詞・動詞を含む地の文まで
 *    マッチしてしまう(例: 「サービス内容は通所リハビリ」「具体的な利用者名や事業所」)。
 *    実際には「事業所名（省略）」のような正直な回答や、一般的なサービス種別の言及に過ぎない。
 * 2. 再結合(3件、D3 run3): 原典の括弧書き略記(「訪問看護（水無月）」)をモデルが自然な語順
 *    (「水無月訪問看護」)へ組み替えたもの。固有名詞の核(`水無月`)も種別語(`訪問看護`)も
 *    原典に実在するため、実在しない情報の創作(捏造)とは性質が異なる第3のカテゴリ。
 *
 * 本実装は4段階の判定で上記を解消する:
 *   ① 左文脈抽出 → ② verbatim判定(地の文巻き込みの大半を解消)
 *   → ③ 助詞トリム(残りの地の文巻き込みを解消) → ④ 再結合判定(fabricated/recombinedの分離)
 *
 * `/plan-crossreview`(codex High指摘)で「再結合判定を原典中の前後30文字以内の近接一致で
 * 行うと、無関係な地名・人名+種別語の偶然の近接一致による真の捏造もrecombined(既定WARN)
 * としてゲートを通してしまう」と指摘された。そのため④は「原典中に `{suffix}（{core}）`
 * (全角/半角括弧)という完全一致の括弧書き略記パターンが実在するか」という限定的な構文
 * 変換のみを許容する判定にしている。曖昧な近接一致はfabricated側に倒す。
 *
 * `sourceText` には呼び出し側が既に切り詰め済みのテキスト(`MAX_SUMMARY_INPUT_LENGTH`
 * 適用後)を渡す契約とする。本関数は切り詰めを行わない — 原典全文を渡すと、モデルが
 * 実際には見ていない切り詰め後より後ろの語を「実在扱い」してしまい偽陰性(検出漏れ)に
 * なるため(PR2詳細設計「6a」節、D3が9,940文字 > MAX_SUMMARY_INPUT_LENGTH=8000の教訓)。
 *
 * 数値捏造・金額混入・cross-entity(対象者取り違え)判定はスコープ外
 * (`scripts/lib/sarashinaSummaryScore.ts` が担当、意味論が異なるため混ぜない)。
 *
 * 既知の限界(PR2a実装時、対照コーパステストで発見): ③助詞トリムは`lastIndexOf`ベースの
 * 単純な文字列一致のため、1文字助詞(「も」「が」「を」等)が固有名詞の先頭1文字と偶然一致
 * する場合(例: 「もみじ整形外科」の「も」)、意図せず固有名詞の一部までトリムしてしまう
 * ことがある(「もみじ整形外科」→core「みじ」)。PR0結果28run全件では実際にこの衝突は
 * 発生していない(コーパス回帰テストで確認済み)が、将来この限界に起因する偽陽性/偽陰性が
 * 実運用で確認された場合は、助詞トリムを形態素解析ベースへ置き換えるか、1文字助詞を
 * 「前後が両方とも名前構成文字で自然に連結する場合は除外する」等の追加ロジックで
 * 対応すること(形態素解析自体は依存コストの観点からPR2a時点では不採用と判断済み)。
 */

/** 捏造疑いの固有名詞の分類。`fabricated` のみが「呼び出し側がブロックすべき」対象。
 * `recombined` は原典の言い換えであり捏造ではないが、監査のため記録する。 */
export type FabricationKind = 'fabricated' | 'recombined';

export interface FabricationFinding {
  kind: FabricationKind;
  /** 検出された名称(core + suffix、正規化後) */
  name: string;
  /** suffixを除いた左側の名前部分(助詞トリム後) */
  core: string;
  /** マッチしたORG_SUFFIX語彙 */
  suffix: string;
  /** 正規化後summaryText内での開始位置(UIハイライト・ログ用) */
  start: number;
  /** 正規化後summaryText内での終了位置(exclusive) */
  end: number;
}

export interface FabricationScanResult {
  findings: FabricationFinding[];
  /** kind==='fabricated' の件数。呼び出し側のブロック判定はこれだけを見ればよい */
  fabricatedCount: number;
  /** kind==='recombined' の件数(監査用、ブロック対象ではない) */
  recombinedCount: number;
  /** 使用した設定のハッシュ。ログに残すことで「どの版の判定基準で判定したか」を後から追跡できる */
  configVersion: string;
}

export interface FabricationScanOptions {
  orgSuffixes?: readonly string[];
  particles?: readonly string[];
  genericCores?: readonly string[];
  /** ①左文脈抽出で遡る最大文字数。既定16 */
  maxLeftContext?: number;
}

/**
 * 施設・事業所・医療機関を示す語彙(PR0のPython版 `ORG_SUFFIX` を踏襲、
 * D8の「さくらい整形外科」等を拾えるよう拡張suffixを追加)。
 */
export const DEFAULT_ORG_SUFFIXES: readonly string[] = [
  '株式会社',
  '有限会社',
  '事業所',
  'ステーション',
  'センター',
  'クリニック',
  '医院',
  '病院',
  '診療所',
  '居宅介護支援',
  '訪問介護',
  '訪問看護',
  'デイサービス',
  '通所介護',
  '通所リハビリ',
  '整形外科',
  '内科',
  '薬局',
  '老人保健施設',
  'グループホーム',
  'ホーム',
];

/**
 * 左文脈を切り詰める助詞・機能語(③助詞トリムで使用)。地の文の巻き込みを解消するための
 * 区切り位置候補。長い語を先に置き、部分一致による誤トリムを避ける。
 */
export const DEFAULT_PARTICLES: readonly string[] = [
  'については',
  'に関して',
  'によれば',
  'において',
  '向けに',
  'ならびに',
  'および',
  'または',
  'という',
  'による',
  'という点',
  'ため',
  'まで',
  'など',
  'には',
  'では',
  'とは',
  'から',
  'より',
  'にて',
  'にも',
  'にて',
  'へは',
  'にて',
  'した',
  'する',
  'した際',
  'は',
  'が',
  'を',
  'に',
  'で',
  'と',
  'の',
  'も',
  'や',
  'へ',
];

/**
 * トリム後coreが以下いずれかに該当する場合、それ単体では固有名詞として不十分と判定し
 * 検出しない(③助詞トリムで使用)。「サービス内容は通所リハビリ」等、種別語そのものが
 * suffixとして再度マッチしてしまうケースや、明らかな汎用語の巻き込みを解消する。
 */
export const DEFAULT_GENERIC_CORES: readonly string[] = [
  '',
  '内容',
  'サービス内容',
  '利用者名',
  '具体的な利用者名',
  '具体的な利用者名や',
  '週間',
  '月曜日から日曜日までの',
  '・短期入所生活介護・',
  '訪問介護・',
];

const DEFAULT_MAX_LEFT_CONTEXT = 16;

export const DEFAULT_FABRICATION_SCAN_CONFIG: Required<FabricationScanOptions> = {
  orgSuffixes: DEFAULT_ORG_SUFFIXES,
  particles: DEFAULT_PARTICLES,
  genericCores: DEFAULT_GENERIC_CORES,
  maxLeftContext: DEFAULT_MAX_LEFT_CONTEXT,
};

/** `DEFAULT_FABRICATION_SCAN_CONFIG` の正規化JSONを元にした簡易ハッシュ(FNV-1a、依存ゼロ)。
 * ドリフトガード契約テストがこの値を直接参照する。 */
function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export const FABRICATION_SCAN_CONFIG_VERSION: string = fnv1aHex(
  JSON.stringify(DEFAULT_FABRICATION_SCAN_CONFIG)
);

/**
 * 名前構成文字(漢字/ひらがな/カタカナ/ー/英数)。区切り文字はこれに該当しない。
 * 「・」(中黒)は区切り文字として扱う(NAME_CHARに含めない) — PaddleOCR/Sarashina実データの
 * 検証で「訪問介護・通所介護・短期入所生活介護・訪問看護」のような中黒区切りのサービス種別
 * 列挙や、「・訪問看護報告書は」のような箇条書き記号を左文脈抽出が飲み込んでしまい、
 * 新たな誤検出を生む実例を確認したため(PR2a実装時、28run再検証で発見)。
 */
const NAME_CHAR = /[一-龠ぁ-んァ-ヶーa-zA-Z0-9]/;

/**
 * 正規化: NFKC → 前後の空白除去 → 特殊トークン除去。summaryText/sourceText 両方に適用する。
 * `</s>` はllama.cppのEOSトークンがそのまま出力に混入する既知の事象への対処
 * (PR2詳細設計「6a」節参照)。exportして呼び出し側(PR4の書込前正規化)が同じ実装を使えるようにする。
 */
export function normalizeForFabricationScan(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/<\/s>|<s>|<think>|<\/think>/g, '')
    .replace(/[ \t]+/g, '')
    .trim();
}

interface RawMatch {
  suffix: string;
  suffixStart: number;
  suffixEnd: number;
}

function findOrgSuffixMatches(text: string, orgSuffixes: readonly string[]): RawMatch[] {
  const matches: RawMatch[] = [];
  // 長いsuffixを先に試す(「訪問看護」と「デイサービス」等、部分文字列関係にある語彙はないが
  // 将来の拡張に備え安全側にソートする)。
  const sorted = [...orgSuffixes].sort((a, b) => b.length - a.length);
  for (const suffix of sorted) {
    let fromIndex = 0;
    while (fromIndex <= text.length) {
      const idx = text.indexOf(suffix, fromIndex);
      if (idx === -1) break;
      matches.push({ suffix, suffixStart: idx, suffixEnd: idx + suffix.length });
      fromIndex = idx + 1;
    }
  }
  matches.sort((a, b) => a.suffixStart - b.suffixStart || b.suffixEnd - a.suffixEnd);
  return matches;
}

/** ①左文脈抽出: suffix出現位置から左へ最大maxLeftContext文字、名前構成文字が続く限り遡る。 */
function extractLeftContext(text: string, suffixStart: number, maxLeftContext: number): string {
  let start = suffixStart;
  let count = 0;
  while (start > 0 && count < maxLeftContext) {
    const ch = text[start - 1];
    if (!NAME_CHAR.test(ch)) break;
    start--;
    count++;
  }
  return text.slice(start, suffixStart);
}

/**
 * ②verbatim判定: 左文脈の右詰め部分列のいずれかがsuffixと連結してsourceにそのまま含まれるか。
 * `cut === leftContext.length`(candidateがsuffix単体になるケース)は除外する — suffix自体は
 * 常にsourceに含まれうる語彙(「訪問看護」等の一般語)であり、これを含めるとleft contextが
 * 何であってもverbatim判定が常にtrueになってしまい判定が無意味化するバグを防ぐ。
 */
function isVerbatimInSource(leftContext: string, suffix: string, source: string): boolean {
  for (let cut = 0; cut < leftContext.length; cut++) {
    const candidate = leftContext.slice(cut) + suffix;
    if (candidate.length > 0 && source.includes(candidate)) return true;
  }
  return false;
}

/** ③助詞トリム: 左文脈を助詞・機能語の最後の出現位置で切り、coreを得る。 */
function trimParticles(leftContext: string, particles: readonly string[]): string {
  let core = leftContext;
  // 助詞は長い語を先に評価(部分一致による誤トリム防止のため呼び出し側でソート済みの配列を使う)。
  let changed = true;
  while (changed) {
    changed = false;
    for (const particle of particles) {
      if (particle.length === 0) continue;
      const idx = core.lastIndexOf(particle);
      if (idx !== -1) {
        const candidate = core.slice(idx + particle.length);
        if (candidate.length < core.length) {
          core = candidate;
          changed = true;
        }
      }
    }
  }
  return core;
}

/**
 * ④再結合判定: 原典中に `{suffix}（{core}）` または `{suffix}({core})` という完全一致の
 * 括弧書き略記パターンが実在するかのみを見る限定判定(codex指摘反映、近接30文字判定は不採用)。
 */
function isRecombinedFromSource(core: string, suffix: string, source: string): boolean {
  if (core.length === 0) return false;
  const fullwidth = `${suffix}（${core}）`;
  const halfwidth = `${suffix}(${core})`;
  return source.includes(fullwidth) || source.includes(halfwidth);
}

interface Candidate {
  start: number;
  end: number;
  core: string;
  suffix: string;
}

export function scanSummaryForFabrication(
  summaryText: string,
  sourceText: string,
  options?: FabricationScanOptions
): FabricationScanResult {
  const config: Required<FabricationScanOptions> = {
    orgSuffixes: options?.orgSuffixes ?? DEFAULT_FABRICATION_SCAN_CONFIG.orgSuffixes,
    particles: options?.particles ?? DEFAULT_FABRICATION_SCAN_CONFIG.particles,
    genericCores: options?.genericCores ?? DEFAULT_FABRICATION_SCAN_CONFIG.genericCores,
    maxLeftContext: options?.maxLeftContext ?? DEFAULT_FABRICATION_SCAN_CONFIG.maxLeftContext,
  };
  const configVersion =
    options === undefined
      ? FABRICATION_SCAN_CONFIG_VERSION
      : fnv1aHex(JSON.stringify(config));

  const normalizedSummary = normalizeForFabricationScan(summaryText);
  const normalizedSource = normalizeForFabricationScan(sourceText);

  const rawMatches = findOrgSuffixMatches(normalizedSummary, config.orgSuffixes);
  const genericCoreSet = new Set(config.genericCores);

  const candidates: Candidate[] = [];
  for (const match of rawMatches) {
    const leftContext = extractLeftContext(normalizedSummary, match.suffixStart, config.maxLeftContext);

    // ②verbatim判定: 原典にそのまま存在するなら検出しない
    if (isVerbatimInSource(leftContext, match.suffix, normalizedSource)) continue;

    // ③助詞トリム: core空/汎用語なら検出しない
    const core = trimParticles(leftContext, config.particles);
    if (genericCoreSet.has(core)) continue;
    // トリム後も原典にverbatimで存在するなら(助詞境界を跨いだverbatim一致)検出しない
    if (isVerbatimInSource(core, match.suffix, normalizedSource)) continue;

    const start = match.suffixStart - core.length;
    candidates.push({ start, end: match.suffixEnd, core, suffix: match.suffix });
  }

  // 最長スパン優先で入れ子候補を除去(「みずほ訪問看護」⊂「みずほ訪問看護ステーション」)
  candidates.sort((a, b) => a.start - b.start || b.end - a.end);
  const deduped: Candidate[] = [];
  for (const c of candidates) {
    const containedInPrevious = deduped.some((prev) => prev.start <= c.start && c.end <= prev.end);
    if (!containedInPrevious) deduped.push(c);
  }

  const findings: FabricationFinding[] = deduped.map((c) => {
    const kind: FabricationKind = isRecombinedFromSource(c.core, c.suffix, normalizedSource)
      ? 'recombined'
      : 'fabricated';
    return {
      kind,
      name: c.core + c.suffix,
      core: c.core,
      suffix: c.suffix,
      start: c.start,
      end: c.end,
    };
  });

  return {
    findings,
    fabricatedCount: findings.filter((f) => f.kind === 'fabricated').length,
    recombinedCount: findings.filter((f) => f.kind === 'recombined').length,
    configVersion,
  };
}
