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
 *   ① 左文脈抽出 → ② 助詞トリム(地の文巻き込みを解消、core確定)
 *   → ③ verbatim判定(トリム後core+suffix全体の完全一致のみ見る) → ④ 再結合判定
 *      (fabricated/recombinedの分離)
 * これは「core+suffix」(名前が先、種別語が後)の順序を前提にしている。加えて
 * `PREFIX_CAPABLE_SUFFIXES`(「株式会社」「有限会社」)の語彙のみ、①〜③と対称的な
 * 右方向のパス(`extractRightContext`/`trimParticlesFromPrefix`)を並行実行し、
 * 「suffix+core」(「株式会社みずほ」のようなプレフィックス表記)の順序も検出する
 * (codex review 4回目指摘、P2。実務ではこちらの順序の方が一般的)。
 *
 * `/plan-crossreview`(codex High指摘)で「再結合判定を原典中の前後30文字以内の近接一致で
 * 行うと、無関係な地名・人名+種別語の偶然の近接一致による真の捏造もrecombined(既定WARN)
 * としてゲートを通してしまう」と指摘された。そのため④は「原典中に `{suffix}（{core}）`
 * という完全一致の括弧書き略記パターンが実在するか」という限定的な構文変換のみを許容する
 * 判定にしている。曖昧な近接一致はfabricated側に倒す。
 *
 * `codex review`(PR2a実装後、P2指摘)で「②③の当初の順序(verbatim判定を先に行い、左文脈の
 * 右詰め部分列のいずれかがsourceにverbatim一致すれば検出しない、という設計)だと、実在する
 * 組織名`青葉クリニック`の前に捏造プレフィックス`新`を付けた`新青葉クリニック`が、部分列
 * `青葉クリニック`だけでverbatim一致してしまい検出されずバイパスされる」と指摘された。
 * これを受け、②助詞トリムを先に行いcoreを確定させたうえで、③verbatim判定はトリム後の
 * `core+suffix`全体の完全一致のみを見る設計に変更した(部分列を試す探索は行わない)。
 *
 * `sourceText` には呼び出し側が既に切り詰め済みのテキスト(`MAX_SUMMARY_INPUT_LENGTH`
 * 適用後)を渡す契約とする。本関数は切り詰めを行わない — 原典全文を渡すと、モデルが
 * 実際には見ていない切り詰め後より後ろの語を「実在扱い」してしまい偽陰性(検出漏れ)に
 * なるため(`scripts/fixtures/sarashina-summary-golden/docs/meta.json`のD3
 * `chars=9940`が`MAX_SUMMARY_INPUT_LENGTH=8000`〔`functions/src/ocr/summaryPromptBuilder.ts`〕
 * を超える実例、comment-analyzer指摘反映: 当初ADR-0027を参照先としていたが該当記述が
 * 存在せず、実在するfixtureデータへ差し替えた)。
 *
 * 数値捏造・金額混入・cross-entity(対象者取り違え)判定はスコープ外
 * (別モジュールが担当する想定、PR2b`scripts/lib/sarashinaSummaryScore.ts`として実装予定・
 * 本PR時点では未着手、意味論が異なるため本スキャナには混ぜない、comment-analyzer指摘反映)。
 *
 * 既知の限界(1はPR2a実装時の対照コーパステストで発見、2・3はcodex review 2回目、
 * 4は5回目で追加発見。いずれもdecision-maker確認済み、2026-09-22: 実データでの
 * 発生実績なし・形態素解析不採用の判断を優先し、これ以上の精緻化は行わない):
 *
 * 1. ②助詞トリムは`lastIndexOf`ベースの単純な文字列一致のため、1文字助詞
 *    (「も」「が」「を」等)が固有名詞の先頭1文字と偶然一致する場合
 *    (例: 「もみじ整形外科」の「も」)、意図せず固有名詞の一部までトリムしてしまう
 *    ことがある(「もみじ整形外科」→core「みじ」)。
 * 2. 組織名自体が助詞と同じ文字列を内部に含む場合(「さくらの里クリニック」の「の」)、
 *    捏造プレフィックス付きの偽名(「新さくらの里クリニック」)に対してもトリムが
 *    誤発動し、トリム後のcore(「里」)がsourceの部分文字列に一致してしまうことで
 *    捏造検出をすり抜けうる(codex review 2回目指摘、P2)。
 * 3. `maxLeftContext`(既定16文字)を超える捏造プレフィックス+長い実在組織名の組み合わせ
 *    では、抽出ウィンドウの外にプレフィックスがはみ出し、ウィンドウ内のcoreがsourceの
 *    実在名と完全一致してしまうことで捏造検出をすり抜けうる(codex review 2回目指摘、P2)。
 * 4. プレフィックス形(`PREFIX_CAPABLE_SUFFIXES`、「株式会社」「有限会社」)の企業名の
 *    先頭1文字が助詞と偶然一致する場合(「株式会社のぞみ」の「の」)、`trimParticlesFromPrefix`
 *    が空文字までトリムしgenericCore判定で除外してしまい、捏造企業名の検出をすり抜けうる
 *    (codex review 5回目指摘、P2)。上記2と構造的に同一の限界(境界が助詞の1文字と
 *    偶然一致するケース)が、4回目修正で追加した右方向のトリムロジックにも対称的に存在する。
 *
 * これら1〜4はいずれもPR0結果28run全件では実際に発生していない(コーパス回帰テストで
 * 確認済み)理論的な攻撃パターンであり、正規表現+文脈判定という設計そのものの限界に
 * 起因する(捏造プレフィックスの完全性検証には形態素解析または構文木ベースの解析が必要)。
 * 将来この限界に起因する偽陰性が実運用で確認された場合は、助詞トリムを形態素解析ベースへ
 * 置き換えるなど、より根本的な再設計を検討すること(形態素解析自体は依存コストの観点から
 * PR2a時点では不採用と判断済み)。本スキャナはPR4で捏造検知の唯一の安全装置ではなく、
 * 複数の防御層の1つとして機能する設計であることに留意する(ADR-0027参照)。
 *
 * 解消済みの既知の問題(履歴、comment-analyzer指摘反映: 上記1〜4「今も残る設計限界」とは
 * 性質が異なるため節を分離。実際に本番run/gate runで発生し修正済みのバグの記録):
 * a. ADR-0027 PR2b実機ゲート本番run(2026-09-22)で、助詞リストに「に対して」が未収録
 *    だったため実在組織名に「対して」が連結した状態で捏造判定されていた(D2run2)。
 *    「に関して」「によれば」等と同じ設計方針で複合語として追加し解消。
 * b. ADR-0027 PR2bステップ8全10doc×3run正式gate run再実行(2026-09-22)で、助詞リストに
 *    指示語「当該」が未収録だったため、事業所名不明と正直に回答する健全な出力
 *    (「当該事業所」)が捏造判定されていた(D9run2)。単体助詞として追加し解消。
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
 * `DEFAULT_ORG_SUFFIXES`のうち、名前の後ろ(suffix)だけでなく前(prefix)にも現れる語彙
 * (codex review 4回目指摘、P2): 「株式会社」「有限会社」は実務では「株式会社みずほ」の
 * ようにプレフィックス表記される方が一般的だが、①〜③の判定は一貫して「core+suffix」
 * (名前が先、種別語が後)の順序のみを前提にしており、プレフィックス表記の捏造企業名が
 * 検出をすり抜けていた(左文脈が空文字列になりgenericCore判定で候補にすら入らないため)。
 * `scanSummaryForFabrication`はこの語彙についてのみ、右方向(`extractRightContext`)の
 * 追加パスで「suffix+core」順の候補も生成する。他の語彙(クリニック・訪問看護等)は
 * プレフィックスとして使われる日本語表現が存在しないため対象外。
 */
const PREFIX_CAPABLE_SUFFIXES: ReadonlySet<string> = new Set(['株式会社', '有限会社']);

/**
 * 左文脈を切り詰める助詞・機能語(②助詞トリムで使用)。地の文の巻き込みを解消するための
 * 区切り位置候補。`trimParticles`が使用前に長さ降順へソートするため、この配列自体の
 * 記述順は任意でよい(code-reviewer/pr-test-analyzer指摘、複数経路で同時検出: 当初は
 * 配列の記述順自体に「長い語を先に置く」不変条件を求めていたが、手動維持は破綻しやすく
 * 実際に`した際`が`した`より後・`という点`が`という`より後にあるなど不変条件に違反した
 * 状態でコミットされていた。ソート責務を呼び出し側からロジック側へ移し、配列の記述順に
 * 依存しない設計へ修正した)。
 */
export const DEFAULT_PARTICLES: readonly string[] = [
  '当該',
  'については',
  'に対して',
  'に関して',
  'によれば',
  'において',
  '向けに',
  'ならびに',
  'および',
  'または',
  'という点',
  'という',
  'による',
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
  'へは',
  'した際',
  'した',
  'する',
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
 * 検出しない(②助詞トリムで使用)。「サービス内容は通所リハビリ」等、種別語そのものが
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
 * `scripts/lib/sarashinaSummaryGoldenDrift.test.ts`がこの値を`manifest.json`の
 * `fabricationScanConfigVersion`と直接突合する。`DEFAULT_ORG_SUFFIXES`/`DEFAULT_PARTICLES`/
 * `DEFAULT_GENERIC_CORES`/`DEFAULT_MAX_LEFT_CONTEXT`のいずれかを変更するとこのハッシュ値が
 * 変わるため、`manifest.json`の`fabricationScanConfigVersion`を同時更新しないとCIが赤くなる
 * (comment-analyzer指摘、意図的な設計: 判定基準を変更したらD9/D10相当の固有名詞捏造テストを
 * 再実行して品質を再検証すべき、というREADME記載の運用ルールを機械的に強制する)。 */
/** ADR-0027 PR2bで`scripts/lib/sarashinaSummaryScore.ts`からも再利用するためexportする
 * (同種のconfigVersion管理を1実装に統一し、pr-review-toolkit code-reviewer等が指摘する
 * DRY違反を未然に防ぐ、Plan agent設計プランD-5)。 */
export function fnv1aHex(input: string): string {
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
 * 名前構成文字(漢字/ひらがな/カタカナ/ー/々/英数)。区切り文字はこれに該当しない。
 * 「々」(踊り字)は「佐々木」等の日本語人名・組織名に頻出するため含める(codex review
 * 2回目指摘、P2: 「々」がNAME_CHARに含まれていないと「佐々木クリニック」のような実在名で
 * 左文脈抽出が「々」の手前で止まり、捏造プレフィックスの検出漏れを招く)。
 * 「・」(中黒)は区切り文字として扱う(NAME_CHARに含めない) — PaddleOCR/Sarashina実データの
 * 検証で「訪問介護・通所介護・短期入所生活介護・訪問看護」のような中黒区切りのサービス種別
 * 列挙や、「・訪問看護報告書は」のような箇条書き記号を左文脈抽出が飲み込んでしまい、
 * 新たな誤検出を生む実例を確認したため(PR2a実装時、28run再検証で発見)。
 */
const NAME_CHAR = /[一-龠ぁ-んァ-ヶー々a-zA-Z0-9]/;

/**
 * 正規化: NFKC → 前後の空白除去 → 特殊トークン除去 → 改行を含む空白の除去。
 * summaryText/sourceText 両方に適用する。
 * `</s>` はllama.cppのEOSトークンがそのまま出力に混入する既知の事象への対処
 * (ADR-0027「PR2a実装知見」節参照)。exportして呼び出し側(PR4の書込前正規化)が同じ実装を使えるようにする。
 *
 * 改行除去(codex review指摘、P2): 当初`[ \t]+`のみを対象にしており改行`\n`/`\r`を
 * 除去していなかった。PaddleOCRのレイアウト都合でページ・行境界に実在の組織名が分断される
 * (例: OCR結果中で「青葉\nクリニック」のように改行を挟む)ケースで、sourceText側の改行が
 * 残ったままverbatim判定・再結合判定の文字列比較(source.includes)を行うと一致せず、
 * 実在する組織名を誤ってfabricatedと判定する偽陽性を招く。summaryText/sourceText両方に
 * 同じ正規化を適用するため、改行除去による一貫性の崩れは生じない。
 */
export function normalizeForFabricationScan(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/<\/s>|<s>|<think>|<\/think>/g, '')
    .replace(/[ \t\r\n]+/g, '')
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
    // frontend/tsconfig.json の noUncheckedIndexedAccess 下では text[i] が
    // string | undefined になるため、常にstringを返すcharAt()を使う
    // (ループ条件でstart>0を保証済みのため範囲外アクセスにはならない)。
    const ch = text.charAt(start - 1);
    if (!NAME_CHAR.test(ch)) break;
    start--;
    count++;
  }
  return text.slice(start, suffixStart);
}

/**
 * ②助詞トリム: 左文脈を助詞・機能語の最後の出現位置で切り、coreを得る。
 * `particles`は長い語から先に評価する(`した際`を`した`より先に、`という点`を`という`より
 * 先に切らないと、短い語が先にマッチして長い語の残り(`際`/`点`)がcoreへ混入する)。
 * この関数自身が長さ降順にソートしてから使うため、`particles`引数(`DEFAULT_PARTICLES`)の
 * 記述順そのものには依存しない(code-reviewer/pr-test-analyzer指摘: 呼び出し側の手動ソート
 * 維持に頼る設計は破綻しやすく、実際に不変条件違反がコミットされていた教訓を反映)。
 */
function trimParticles(leftContext: string, particles: readonly string[]): string {
  const sortedParticles = [...particles].filter((p) => p.length > 0).sort((a, b) => b.length - a.length);
  let core = leftContext;
  let changed = true;
  while (changed) {
    changed = false;
    for (const particle of sortedParticles) {
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
 * 法人格プレフィックス語彙(`PREFIX_CAPABLE_SUFFIXES`)専用: 「株式会社みずほ」のように
 * suffixが名前の前に来るパターンを検出するため、suffix終端から右へ最大maxLeftContext文字
 * (①左文脈抽出と対称の予算)を、名前構成文字が続く限り読み進める(codex review 4回目指摘、
 * P2: 「株式会社みずほ」「有限会社みずほ」のような、実務でより一般的なプレフィックス表記の
 * 捏造企業名が、①〜③の左文脈ベースの判定だけでは一切検出できずすり抜けていた。suffixの
 * 左に何もない=空文字列としてgenericCore判定され候補にすらならないため)。
 */
function extractRightContext(text: string, suffixEnd: number, maxLength: number): string {
  let end = suffixEnd;
  let count = 0;
  while (end < text.length && count < maxLength) {
    // extractLeftContextと同じ理由(noUncheckedIndexedAccess対策)でcharAt()を使う。
    const ch = text.charAt(end);
    if (!NAME_CHAR.test(ch)) break;
    end++;
    count++;
  }
  return text.slice(suffixEnd, end);
}

/**
 * `trimParticles`(②助詞トリム)の左右対称版。プレフィックス形では助詞・機能語は名前の
 * *後ろ*に続く(「株式会社みずほが担当」の「が」)ため、最初に出現した助詞の手前までを
 * core候補として残す(`trimParticles`が最後の出現位置の後ろを残すのと対称)。
 */
function trimParticlesFromPrefix(rightContext: string, particles: readonly string[]): string {
  const sortedParticles = [...particles].filter((p) => p.length > 0).sort((a, b) => b.length - a.length);
  let core = rightContext;
  let changed = true;
  while (changed) {
    changed = false;
    for (const particle of sortedParticles) {
      const idx = core.indexOf(particle);
      if (idx !== -1) {
        const candidate = core.slice(0, idx);
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
 * ④再結合判定(順序上は③verbatim判定の後): 原典中に `{suffix}（{core}）` という完全一致の括弧書き略記パターンが
 * 実在するかのみを見る限定判定(codex指摘反映、近接30文字判定は不採用)。
 * `source`は呼び出し元(`scanSummaryForFabrication`)で`normalizeForFabricationScan`
 * (NFKC正規化)を通した後の値のみを受け取る契約のため、全角括弧`（）`は既に半角`()`へ
 * 正規化済みで、半角パターンのみを見れば足りる(pr-test-analyzer指摘: 当初は全角/半角
 * 両方のパターンを見ていたが、全角分岐は正規化後には到達不能なデッドコードだった)。
 */
function isRecombinedFromSource(core: string, suffix: string, source: string): boolean {
  if (core.length === 0) return false;
  return source.includes(`${suffix}(${core})`);
}

interface Candidate {
  start: number;
  end: number;
  core: string;
  suffix: string;
  /** 'core-suffix' = 通常の「core+suffix」順(「みずほクリニック」)。
   *  'suffix-core' = プレフィックス語彙の「suffix+core」順(「株式会社みずほ」、PREFIX_CAPABLE_SUFFIXES参照)。 */
  order: 'core-suffix' | 'suffix-core';
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

  const rawMatchesAll = findOrgSuffixMatches(normalizedSummary, config.orgSuffixes);
  const genericCoreSet = new Set(config.genericCores);
  const orgSuffixSet = new Set(config.orgSuffixes);

  // suffix語彙同士が包含関係(「グループホーム」⊃「ホーム」)の場合、包含されるsuffixの
  // マッチを候補生成より前に除去する(codex review 4回目指摘、P2)。当初は候補(Candidate)
  // レベルの包含除去(下記「最長スパン優先」)しか行っておらず、外側のsuffix(グループホーム)
  // がgenericCore判定(coreが空文字)で候補にすら入らない場合、内側のsuffix(ホーム)だけが
  // 生き残り「グループ」を捏造coreとして誤検出していた(「利用先はグループホームです」で
  // 実際に再現確認)。suffix自体の包含関係はconfig(語彙)の構造に起因する問題であり、
  // 左文脈確定より前の段階で解消するのが正しい。
  const rawMatches = rawMatchesAll.filter(
    (m) =>
      !rawMatchesAll.some(
        (other) =>
          other !== m && other.suffixStart <= m.suffixStart && m.suffixEnd <= other.suffixEnd
      )
  );

  const candidates: Candidate[] = [];
  for (const match of rawMatches) {
    const leftContext = extractLeftContext(normalizedSummary, match.suffixStart, config.maxLeftContext);

    // ②助詞トリム: leftContextを助詞境界で切りcoreを得る。core空/汎用語なら検出しない
    const core = trimParticles(leftContext, config.particles);
    if (genericCoreSet.has(core)) continue;
    // coreがそれ自体ORG_SUFFIX語彙と一致する場合も汎用語として検出しない(codex review
    // 3回目指摘、P2): 「訪問看護ステーションが担当」(suffix=ステーション、core=訪問看護)
    // のような、固有名詞を伴わない一般的なサービス種別の連結表現は捏造ではなく、単に
    // 事業所名が読み取れない場合の正当な要約表現である。coreが別のORG_SUFFIX語彙(この
    // 例では「訪問看護」自体がORG_SUFFIXES配列に含まれる)と一致する場合はこれに該当する
    // とみなし、検出対象から除外する。
    if (orgSuffixSet.has(core)) continue;

    // ③verbatim判定: トリム後のcore全体+suffixが原典にそのまま存在するなら検出しない
    // (codex review指摘、P2: 部分列を試す設計だと捏造プレフィックス「新青葉クリニック」の
    // 「青葉クリニック」部分だけがverbatim一致してバイパスされてしまうため、トリム済みの
    // core全体での完全一致のみを見る。部分列探索は行わない)。
    if (normalizedSource.includes(core + match.suffix)) continue;

    const start = match.suffixStart - core.length;
    candidates.push({ start, end: match.suffixEnd, core, suffix: match.suffix, order: 'core-suffix' });
  }

  // プレフィックス形(「株式会社みずほ」)の検出(codex review 4回目指摘、P2、
  // PREFIX_CAPABLE_SUFFIXES参照)。suffix終端から右方向にcoreを探す点以外は
  // 上記の左文脈ループと対称のロジック(②助詞トリム相当・orgSuffix自体除外・③verbatim判定)。
  for (const match of rawMatches) {
    if (!PREFIX_CAPABLE_SUFFIXES.has(match.suffix)) continue;

    const rightContext = extractRightContext(normalizedSummary, match.suffixEnd, config.maxLeftContext);
    const core = trimParticlesFromPrefix(rightContext, config.particles);
    if (genericCoreSet.has(core)) continue;
    if (orgSuffixSet.has(core)) continue;
    if (normalizedSource.includes(match.suffix + core)) continue;

    const end = match.suffixEnd + core.length;
    candidates.push({ start: match.suffixStart, end, core, suffix: match.suffix, order: 'suffix-core' });
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
      name: c.order === 'suffix-core' ? c.suffix + c.core : c.core + c.suffix,
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
