import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  normalizeForScore,
  evaluateCoverage,
  validateCoverageSpec,
  parseFixtureMeta,
  aggregateCoverage,
  scanNumericFabrication,
  findAmountMentions,
  checkAmountProhibition,
  checkCrossEntity,
  analyzeOutputShape,
  scoreSummary,
  SUMMARY_SCORE_CONFIG_VERSION,
  type SummaryScoreSpec,
  type FixtureRole,
} from './sarashinaSummaryScore';

const META_PATH = path.join(__dirname, '..', 'fixtures', 'sarashina-summary-golden', 'docs', 'meta.json');
const DOCS_DIR = path.join(__dirname, '..', 'fixtures', 'sarashina-summary-golden', 'docs');

function loadMeta(): Record<string, SummaryScoreSpec> {
  return parseFixtureMeta(JSON.parse(fs.readFileSync(META_PATH, 'utf-8')));
}

function loadSource(docId: string): string {
  return fs.readFileSync(path.join(DOCS_DIR, `${docId}.txt`), 'utf-8');
}

const EMPTY_SPEC: SummaryScoreSpec = {
  facts: [],
  mustCover: [],
  optionalFacts: [],
  minCoveredFacts: null,
};

// ---------------------------------------------------------------------------
// normalizeForScore
// ---------------------------------------------------------------------------

test('normalizeForScore: NFKCで全角数字を半角化する', () => {
  assert.equal(normalizeForScore('１２，４８０円'), '12,480円'.replace(',', ''));
});

test('normalizeForScore: </s>・<think>タグを除去する', () => {
  assert.equal(normalizeForScore('要約です</s>'), '要約です');
  assert.equal(normalizeForScore('<think>考え中</think>結果'), '考え中結果');
});

test('normalizeForScore: 読点(、)は3桁区切りカンマとして除去しない(Python版の全カンマ除去との意図的な差分)', () => {
  // Python版score.pyの`norm()`は全カンマ・読点を無条件除去するため、
  // 「単位数396、577」(読点区切りの別々の数値の列挙)が「396577」という原典に存在しない
  // 6桁数値へ偶然結合し、数値捏造の偽陽性を生みうる。本実装は半角/全角カンマ(,/，)の
  // 3桁区切りパターンのみを対象にし、読点(、)は数値結合対象から除外する。
  const r = normalizeForScore('単位数396、577円');
  assert.equal(r, '単位数396、577円'); // 空白除去以外は変化しない(読点はそのまま残る)
  assert.ok(!r.includes('396577'));
});

test('normalizeForScore: 3桁区切りカンマは除去する', () => {
  assert.equal(normalizeForScore('12,480円'), '12480円');
});

test('normalizeForScore: 空白・改行を除去する', () => {
  assert.equal(normalizeForScore('利用者 太郎\n様'), '利用者太郎様');
});

test('normalizeForScore: 令和8年・R8を除去する', () => {
  assert.equal(normalizeForScore('令和8年9月'), '9月');
  assert.equal(normalizeForScore('R8年'), '年');
});

test('normalizeForScore: 要介護度を要介護に統一する', () => {
  assert.equal(normalizeForScore('要介護度3'), '要介護3');
});

// ---------------------------------------------------------------------------
// evaluateCoverage
// ---------------------------------------------------------------------------

test('evaluateCoverage: mustCover欠落を個別に報告する', () => {
  const spec: SummaryScoreSpec = {
    facts: ['星野みなと', '9月18日', '週3回'],
    mustCover: ['星野みなと', '9月18日'],
    optionalFacts: ['週3回'],
    minCoveredFacts: 2,
  };
  const r = evaluateCoverage('担当は星野みなと様。訪問看護を実施。', spec);
  assert.deepEqual(r.missingMustCover, ['9月18日']);
  assert.equal(r.mustCoverSatisfied, false);
  assert.equal(r.passed, false);
});

test('evaluateCoverage: optionalFactsは率算入のみで合否には影響しない', () => {
  const spec: SummaryScoreSpec = {
    facts: ['星野みなと', '週3回'],
    mustCover: ['星野みなと'],
    optionalFacts: ['週3回'],
    minCoveredFacts: 1,
  };
  const r = evaluateCoverage('担当は星野みなと様。', spec);
  assert.equal(r.mustCoverSatisfied, true);
  assert.equal(r.passed, true);
  assert.equal(r.coveredCount, 1);
  assert.equal(r.totalCount, 2);
});

test('evaluateCoverage: facts=[]では0除算せずcoverageRatioはnull・passedはtrue(D10相当)', () => {
  const r = evaluateCoverage('特に変わったことはなし。', EMPTY_SPEC);
  assert.equal(r.applicable, false);
  assert.equal(r.coverageRatio, null);
  assert.equal(r.passed, true);
});

test('evaluateCoverage: minCoveredFactsとの比較は整数比較(境界値=ちょうど・1つ不足)', () => {
  const spec: SummaryScoreSpec = {
    facts: ['A', 'B', 'C'],
    mustCover: [],
    optionalFacts: ['A', 'B', 'C'],
    minCoveredFacts: 2,
  };
  const exact = evaluateCoverage('AとBが記載', spec);
  assert.equal(exact.coveredCount, 2);
  assert.equal(exact.minCoveredSatisfied, true);
  const short = evaluateCoverage('Aのみ記載', spec);
  assert.equal(short.coveredCount, 1);
  assert.equal(short.minCoveredSatisfied, false);
});

test('evaluateCoverage: minCoveredFacts=nullはvacuous true', () => {
  const spec: SummaryScoreSpec = { facts: ['A'], mustCover: [], optionalFacts: ['A'], minCoveredFacts: null };
  const r = evaluateCoverage('何もない', spec);
  assert.equal(r.minCoveredSatisfied, true);
});

// ---------------------------------------------------------------------------
// validateCoverageSpec(D1〜D10全件、および故意に壊したspec)
// ---------------------------------------------------------------------------

test('validateCoverageSpec: docs/meta.json のD1〜D10全件が不変条件に違反しない', () => {
  const meta = loadMeta();
  const allErrors: string[] = [];
  for (const [docId, spec] of Object.entries(meta)) {
    allErrors.push(...validateCoverageSpec(docId, spec));
  }
  assert.deepEqual(allErrors, []);
});

test('validateCoverageSpec: mustCoverとoptionalFactsが重複していれば検出する', () => {
  const spec: SummaryScoreSpec = { facts: ['A'], mustCover: ['A'], optionalFacts: ['A'], minCoveredFacts: 1 };
  const errs = validateCoverageSpec('X', spec);
  assert.ok(errs.some((e) => e.includes('mustCoverとoptionalFacts')));
});

test('validateCoverageSpec: facts が mustCover∪optionalFacts と一致しなければ検出する', () => {
  const spec: SummaryScoreSpec = { facts: ['A', 'B'], mustCover: ['A'], optionalFacts: [], minCoveredFacts: 1 };
  const errs = validateCoverageSpec('X', spec);
  assert.ok(errs.some((e) => e.includes('facts')));
});

test('validateCoverageSpec: facts=[]なのにminCoveredFactsがnullでなければ検出する', () => {
  const spec: SummaryScoreSpec = { facts: [], mustCover: [], optionalFacts: [], minCoveredFacts: 0 };
  const errs = validateCoverageSpec('X', spec);
  assert.ok(errs.some((e) => e.includes('minCoveredFactsはnullである')));
});

test('validateCoverageSpec: minCoveredFactsがmustCover件数未満なら検出する', () => {
  const spec: SummaryScoreSpec = { facts: ['A', 'B'], mustCover: ['A', 'B'], optionalFacts: [], minCoveredFacts: 1 };
  const errs = validateCoverageSpec('X', spec);
  assert.ok(errs.some((e) => e.includes('mustCover件数')));
});

test('validateCoverageSpec: roleが不正な値なら検出する', () => {
  const spec: SummaryScoreSpec = { facts: [], mustCover: [], optionalFacts: [], minCoveredFacts: null, role: 'bogus' as FixtureRole };
  const errs = validateCoverageSpec('X', spec);
  assert.ok(errs.some((e) => e.includes('role')));
});

// ---------------------------------------------------------------------------
// aggregateCoverage
// ---------------------------------------------------------------------------

test('aggregateCoverage: role=fabricationとapplicable=falseを既定で除外する', () => {
  const inputs = [
    { docId: 'D1', role: 'coverage' as FixtureRole, coverage: evaluateCoverage('AB', { facts: ['A', 'B'], mustCover: ['A', 'B'], optionalFacts: [], minCoveredFacts: 2 }) },
    { docId: 'D9', role: 'fabrication' as FixtureRole, coverage: evaluateCoverage('', { facts: ['X'], mustCover: [], optionalFacts: ['X'], minCoveredFacts: 0 }) },
    { docId: 'D10', role: 'fabrication' as FixtureRole, coverage: evaluateCoverage('', EMPTY_SPEC) },
  ];
  const agg = aggregateCoverage(inputs);
  assert.deepEqual(agg.includedDocIds, ['D1']);
  assert.deepEqual(agg.excludedDocIds, ['D9', 'D10']);
});

test('aggregateCoverage: 整数交差乗算で85%境界を判定する(17/20=85%ちょうどでpass、16/20でfail)', () => {
  const makeCoverage = (covered: number, total: number) => ({
    applicable: true,
    coveredFacts: [],
    missingFacts: [],
    missingMustCover: [],
    mustCoverSatisfied: true,
    coveredCount: covered,
    totalCount: total,
    coverageRatio: covered / total,
    minCoveredFacts: null,
    minCoveredSatisfied: true,
    passed: true,
  });
  const pass = aggregateCoverage([{ docId: 'X', role: 'coverage' as FixtureRole, coverage: makeCoverage(17, 20) }]);
  assert.equal(pass.passed, true);
  const fail = aggregateCoverage([{ docId: 'X', role: 'coverage' as FixtureRole, coverage: makeCoverage(16, 20) }]);
  assert.equal(fail.passed, false);
});

test('aggregateCoverage: 対象母集団が0件ならfalse(空のPASS化を許さない)', () => {
  const agg = aggregateCoverage([]);
  assert.equal(agg.passed, false);
  assert.equal(agg.ratio, null);
});

// ---------------------------------------------------------------------------
// scanNumericFabrication
// ---------------------------------------------------------------------------

test('scanNumericFabrication: 原典に実在する数値は検出しない', () => {
  const r = scanNumericFabrication('利用料16,051円', '利用者負担額（1割）：16,051円');
  assert.equal(r.fabricatedCount, 0);
});

test('scanNumericFabrication: 原典に存在しない数値は捏造として検出する', () => {
  const r = scanNumericFabrication('給付対象費用999,999円', '利用者負担額（1割）：16,051円');
  assert.equal(r.fabricatedCount, 1);
  assert.equal(r.findings[0].value, '999999');
});

test('scanNumericFabrication: 【既知の限界】1桁の捏造(週2回→週3回)は既定では検出しない', () => {
  const r = scanNumericFabrication('週3回訪問', '週2回訪問の予定。');
  assert.equal(r.fabricatedCount, 0);
});

test('scanNumericFabrication: criticalNumericPatternsで要介護の1桁差し替えを検出する', () => {
  const r = scanNumericFabrication('要介護5と認定', '要介護：3と認定されています。');
  assert.equal(r.fabricatedCount, 1);
  assert.equal(r.findings[0].rule, 'critical:kaigo-level');
});

test('scanNumericFabrication: criticalNumericPatternsは原典側の区切り記号(コロン等)を許容する', () => {
  const r = scanNumericFabrication('要介護3と認定', '要介護：3と認定されています。');
  assert.equal(r.fabricatedCount, 0);
});

test('scanNumericFabrication: criticalNumericPatternsで負担割合(N割)の差し替えを検出する', () => {
  const r = scanNumericFabrication('負担割合3割', '負担割合は2割です。');
  assert.equal(r.fabricatedCount, 1);
  assert.equal(r.findings[0].rule, 'critical:burden-ratio');
});

test('scanNumericFabrication: 【既知の限界】matchMode既定(substring)では部分一致の捏造(2,480円)を検出しない', () => {
  const r = scanNumericFabrication('請求額2,480円', '請求額は12,480円です。');
  assert.equal(r.fabricatedCount, 0);
});

test('scanNumericFabrication: matchMode="token"にすると部分一致の捏造を検出できる', () => {
  const r = scanNumericFabrication('請求額2,480円', '請求額は12,480円です。', { matchMode: 'token' });
  assert.equal(r.fabricatedCount, 1);
});

test('scanNumericFabrication: 全角数字も検知対象になる(NFKC正規化)', () => {
  const r = scanNumericFabrication('金額９９９円', '金額は500円です。');
  assert.equal(r.fabricatedCount, 1);
  assert.equal(r.findings[0].value, '999');
});

// ---------------------------------------------------------------------------
// findAmountMentions / checkAmountProhibition
// ---------------------------------------------------------------------------

test('findAmountMentions: アラビア数字・漢数字・¥記号・単価表現を検知する', () => {
  assert.equal(findAmountMentions('1,000円').length, 1);
  assert.equal(findAmountMentions('金5万円也').length, 1);
  assert.equal(findAmountMentions('¥1,000').length, 1);
  assert.equal(findAmountMentions('単価10.14円換算').length, 1);
});

test('findAmountMentions: 円滑・円満等の同形異義語は検知しない', () => {
  assert.equal(findAmountMentions('連携は円滑です。').length, 0);
  assert.equal(findAmountMentions('家庭は円満です。').length, 0);
});

test('findAmountMentions: 「金額: (省略)」のような正直な回答は検知しない(D9/D10実出力の再現)', () => {
  assert.equal(findAmountMentions('・金額: 合計金額（省略）').length, 0);
  assert.equal(findAmountMentions('・金額: (合計金額や自己負担額などの記載なし)').length, 0);
});

test('checkAmountProhibition: must_not_contain_amount対象外の文書はapplicable:falseで常にpass', () => {
  const spec: SummaryScoreSpec = { ...EMPTY_SPEC, mustNotContainAmount: undefined };
  const r = checkAmountProhibition('金額は1,000円です。', spec);
  assert.equal(r.applicable, false);
  assert.equal(r.passed, true);
});

test('checkAmountProhibition: must_not_contain_amount対象で金額が混入していれば検出する', () => {
  const spec: SummaryScoreSpec = { ...EMPTY_SPEC, mustNotContainAmount: true };
  const r = checkAmountProhibition('金額は1,000円です。', spec);
  assert.equal(r.applicable, true);
  assert.equal(r.passed, false);
  assert.equal(r.mentions.length, 1);
});

test('checkAmountProhibition: D5実データで原典由来の金額が存在しないことを確認する', () => {
  const meta = loadMeta();
  const r = checkAmountProhibition('・利用者: 宮下 譲。ひまわり訪問介護。特記事項なし。', meta['D5']);
  assert.equal(r.applicable, true);
  assert.equal(r.passed, true);
});

// ---------------------------------------------------------------------------
// checkCrossEntity(D8実データ)
// ---------------------------------------------------------------------------

test('checkCrossEntity: pairsが空ならapplicable:falseでNOT_EVALUATED', () => {
  const r = checkCrossEntity('何か', EMPTY_SPEC);
  assert.equal(r.applicable, false);
  assert.equal(r.verdict, 'NOT_EVALUATED');
});

test('checkCrossEntity: 正ペア(人物1名+対応する事業所)はPASS', () => {
  const meta = loadMeta();
  const r = checkCrossEntity(
    '・重要な日付: 立花 誠一様の次回受診9月26日(青葉クリニック)、立花 文子様は10月2日',
    meta['D8']
  );
  assert.equal(r.verdict, 'PASS');
  assert.deepEqual(r.consistentPairs, [{ person: '立花 誠一', org: '青葉クリニック' }]);
});

test('checkCrossEntity: セグメント内で人物1名+誤った事業所はFAIL(取り違え検出)', () => {
  const meta = loadMeta();
  const r = checkCrossEntity('・立花 誠一様は10月2日にさくらい整形外科を受診予定', meta['D8']);
  assert.equal(r.verdict, 'FAIL');
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].person, '立花 誠一');
  assert.equal(r.findings[0].org, 'さくらい整形外科');
  assert.deepEqual(r.findings[0].expectedPersons, ['立花 文子']);
});

test('checkCrossEntity: 改行区切り(箇条書き記号なし)の複数文でも取り違えを検出する(codex review指摘、2回目)', () => {
  // normalizeForScoreが\s+除去で\r/\nを先に消してしまうため、改行がセグメント境界として
  // 機能しないバグがあった(・/。等の記号が無い普通の改行区切り文では全文が1セグメントに
  // 結合され、取り違えがあってもambiguousSegments扱いのNOT_EVALUATEDに落ちていた)。
  const meta = loadMeta();
  const r = checkCrossEntity('立花 誠一様はさくらい整形外科を受診\n立花 文子様は青葉クリニックを受診', meta['D8']);
  assert.equal(r.verdict, 'FAIL');
  assert.equal(r.findings.length, 2);
});

test('checkCrossEntity: 改行区切りの正ペアはPASSする(改行修正の健全性確認)', () => {
  const meta = loadMeta();
  const r = checkCrossEntity('立花 誠一様は青葉クリニックを受診\n立花 文子様はさくらい整形外科を受診', meta['D8']);
  assert.equal(r.verdict, 'PASS');
  assert.equal(r.consistentPairs.length, 2);
});

test('checkCrossEntity: 括弧付き列挙の節分割でも取り違えを検出する(scope:clause)', () => {
  const meta = loadMeta();
  const r = checkCrossEntity(
    '・関係者: 立花 誠一様(さくらい整形外科)、立花 文子様(青葉クリニック)',
    meta['D8']
  );
  assert.equal(r.verdict, 'FAIL');
  assert.equal(r.findings.length, 2);
  assert.ok(r.findings.every((f) => f.scope === 'clause'));
});

test('checkCrossEntity: v2形式の関係者列挙行(複数人物同一行)はNOT_EVALUATEDで誤検出しない', () => {
  const meta = loadMeta();
  const r = checkCrossEntity(
    '・関係者: 立花 誠一様、立花 文子様、みどりヶ丘訪問看護ステーション、青葉クリニック、さくらい整形外科',
    meta['D8']
  );
  assert.equal(r.verdict, 'NOT_EVALUATED');
  assert.equal(r.findings.length, 0);
  assert.ok(r.ambiguousSegments > 0);
});

test('checkCrossEntity: 事業所名のみで人物が一度も同節に出なければNOT_EVALUATED(inconclusive)', () => {
  const meta = loadMeta();
  const r = checkCrossEntity('・担当医療機関: 青葉クリニック', meta['D8']);
  assert.equal(r.verdict, 'NOT_EVALUATED');
  assert.equal(r.unattributedOrgMentions, 1);
});

test('checkCrossEntity: NOT_EVALUATEDはPASSと区別される(3値判定、codex review指摘の回帰テスト)', () => {
  const meta = loadMeta();
  const inconclusive = checkCrossEntity('・担当医療機関: 青葉クリニック', meta['D8']);
  const genuinePass = checkCrossEntity('・立花 誠一様は青葉クリニックを受診。', meta['D8']);
  assert.notEqual(inconclusive.verdict, genuinePass.verdict);
  assert.equal(inconclusive.verdict, 'NOT_EVALUATED');
  assert.equal(genuinePass.verdict, 'PASS');
});

// ---------------------------------------------------------------------------
// analyzeOutputShape
// ---------------------------------------------------------------------------

test('analyzeOutputShape: thinking漏れ・EOSトークン・短すぎ・長すぎを検出する', () => {
  // 30文字未満は同時にtoo-shortも検出されるため、thinking-leak単体を見る場合は30文字以上にする
  assert.deepEqual(
    analyzeOutputShape('<think>考え中です、これは十分長い思考過程のダミーテキストです</think>結果の本文もここに続けて30文字を超えるようにする').anomalies,
    ['thinking-leak']
  );
  assert.deepEqual(analyzeOutputShape('結果です。'.repeat(6) + '</s>').anomalies, ['eos-token']);
  assert.deepEqual(analyzeOutputShape('短い').anomalies, ['too-short']);
  assert.deepEqual(analyzeOutputShape('あ'.repeat(901)).anomalies, ['too-long']);
});

test('analyzeOutputShape: 正常な出力は異常なし', () => {
  const r = analyzeOutputShape('・書類種別: FAX送付状\n・利用者: 星野みなと様\n・日付: 9月18日');
  assert.deepEqual(r.anomalies, []);
});

// ---------------------------------------------------------------------------
// scoreSummary(合成)
// ---------------------------------------------------------------------------

test('scoreSummary: mustCover未充足はblockingに入りpassed:falseになる', () => {
  const spec: SummaryScoreSpec = { facts: ['A'], mustCover: ['A'], optionalFacts: [], minCoveredFacts: 1 };
  const r = scoreSummary('何もない要約', 'Aが記載された原典', spec);
  assert.equal(r.passed, false);
  assert.ok(r.blocking.some((b) => b.includes('カバー率')));
});

test('scoreSummary: 金額混入はblockingではなくwarningsに入る(FAILゲート化しない)', () => {
  const spec: SummaryScoreSpec = { ...EMPTY_SPEC, mustNotContainAmount: true };
  // 数値捏造ゲートを誤って巻き込まないよう、原典にも同じ数値を含めておく(金額判定のみを分離検証)
  const r = scoreSummary('金額は1,000円です。', '本文中に1000という数値が登場する。', spec);
  assert.equal(r.passed, true); // blockingに入らないためpassedはtrueのまま
  assert.ok(r.warnings.some((w) => w.includes('金額混入')));
});

test('scoreSummary: cross-entity取り違え(FAIL)はblockingに入る', () => {
  const meta = loadMeta();
  const r = scoreSummary(
    '・立花 誠一様は10月2日にさくらい整形外科を受診予定',
    loadSource('D8'),
    meta['D8']
  );
  assert.equal(r.passed, false);
  assert.ok(r.blocking.some((b) => b.includes('cross-entity取り違え')));
});

test('scoreSummary: cross-entity NOT_EVALUATEDはblockingに入らずwarningsのみ', () => {
  const meta = loadMeta();
  const r = scoreSummary('・担当医療機関: 青葉クリニック。氏名の記載なし。', loadSource('D8'), meta['D8']);
  assert.ok(!r.blocking.some((b) => b.includes('cross-entity')));
  assert.ok(r.warnings.some((w) => w.includes('cross-entity')));
});

// ---------------------------------------------------------------------------
// SUMMARY_SCORE_CONFIG_VERSION
// ---------------------------------------------------------------------------

test('SUMMARY_SCORE_CONFIG_VERSION: optionsを省略した場合、既定configのハッシュと一致する', () => {
  const spec: SummaryScoreSpec = { ...EMPTY_SPEC };
  const r = scoreSummary('', '', spec);
  assert.equal(r.configVersion, SUMMARY_SCORE_CONFIG_VERSION);
});

test('SUMMARY_SCORE_CONFIG_VERSION: optionsを変更するとconfigVersionが変わる', () => {
  const spec: SummaryScoreSpec = { ...EMPTY_SPEC };
  const r = scoreSummary('', '', spec, { numeric: { minDigits: 3 } });
  assert.notEqual(r.configVersion, SUMMARY_SCORE_CONFIG_VERSION);
});
