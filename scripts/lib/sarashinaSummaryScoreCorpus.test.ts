/**
 * PR0結果コーパス回帰テスト (ADR-0027 PR2b)
 *
 * `scripts/lib/sarashinaSummaryScore.ts`(scoreSummary)をPR0結果JSON(28run、
 * `scripts/fixtures/sarashina-summary-golden/pr0-verification/results/*.json`)へ実行し、
 * `scripts/fixtures/sarashina-summary-golden/pr0-score-expected.json` に固定した期待値と
 * 完全一致することを検証する。
 *
 * `functions/test/sarashinaSummaryScanCorpus.test.ts`(PR2a、固有名詞捏造スキャナの同種
 * 回帰テスト)と同じ設計(PR0結果全件を実装後のロジックへ通し、期待値ファイルとの突合で
 * 将来の意図しない退行を検知する)。配置は`sarashinaSummaryScore.ts`自体と同じ
 * `scripts/lib/`(shared/配下ではなくscripts専用ロジックのため、CI glob `scripts/lib/*.test.ts`
 * が対象)。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseFixtureMeta, scoreSummary, SUMMARY_SCORE_CONFIG_VERSION, type SummaryScoreSpec } from './sarashinaSummaryScore';

const GOLDEN_DIR = path.join(__dirname, '..', 'fixtures', 'sarashina-summary-golden');
const DOCS_DIR = path.join(GOLDEN_DIR, 'docs');
const RESULTS_DIR = path.join(GOLDEN_DIR, 'pr0-verification', 'results');
const MANIFEST_PATH = path.join(GOLDEN_DIR, 'manifest.json');
const EXPECTED_PATH = path.join(GOLDEN_DIR, 'pr0-score-expected.json');

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8')) as { maxInputChars: number };
const meta: Record<string, SummaryScoreSpec> = parseFixtureMeta(
  JSON.parse(fs.readFileSync(path.join(DOCS_DIR, 'meta.json'), 'utf-8'))
);

function sourceTextFor(docId: string): string {
  return fs.readFileSync(path.join(DOCS_DIR, `${docId}.txt`), 'utf-8').slice(0, manifest.maxInputChars);
}

interface ExpectedRunScore {
  resultFile: string;
  doc: string;
  run: number;
  coverage: {
    applicable: boolean;
    mustCoverSatisfied: boolean;
    minCoveredSatisfied: boolean;
    coveredCount: number;
    totalCount: number;
    missingFacts: string[];
    missingMustCover: string[];
  };
  numeric: { fabricatedCount: number; findings: { value: string; rule: string }[] };
  amount: { applicable: boolean; mentions: string[] };
  crossEntity: { applicable: boolean; verdict: string; findings: { person: string; org: string }[] };
  output: { anomalies: string[] };
  blocking: string[];
  warnings: string[];
  passed: boolean;
}

interface ExpectedFile {
  summaryScoreConfigVersion: string;
  runsScanned: number;
  summary: { passed: number; blocked: number; warned: number; blockingReasonCounts: Record<string, number> };
  runs: ExpectedRunScore[];
}

interface Pr0ResultRun {
  doc?: string;
  run?: number;
  text?: string;
}
interface Pr0ResultFile {
  runs?: Pr0ResultRun[];
}

function actualRunScore(resultFile: string, run: Pr0ResultRun): ExpectedRunScore {
  const docId = run.doc as string;
  const spec = meta[docId];
  assert.ok(spec, `meta.jsonにdoc"${docId}"が見つかりません`);
  const src = sourceTextFor(docId);
  const result = scoreSummary(run.text as string, src, spec);
  return {
    resultFile,
    doc: docId,
    run: run.run as number,
    coverage: {
      applicable: result.coverage.applicable,
      mustCoverSatisfied: result.coverage.mustCoverSatisfied,
      minCoveredSatisfied: result.coverage.minCoveredSatisfied,
      coveredCount: result.coverage.coveredCount,
      totalCount: result.coverage.totalCount,
      missingFacts: result.coverage.missingFacts,
      missingMustCover: result.coverage.missingMustCover,
    },
    numeric: {
      fabricatedCount: result.numeric.fabricatedCount,
      findings: result.numeric.findings.map((f) => ({ value: f.value, rule: f.rule })),
    },
    amount: { applicable: result.amount.applicable, mentions: result.amount.mentions.map((m) => m.text) },
    crossEntity: {
      applicable: result.crossEntity.applicable,
      verdict: result.crossEntity.verdict,
      findings: result.crossEntity.findings.map((f) => ({ person: f.person, org: f.org })),
    },
    output: { anomalies: result.output.anomalies },
    blocking: result.blocking,
    warnings: result.warnings,
    passed: result.passed,
  };
}

test('sarashinaSummaryScoreCorpus: 期待値ファイル自体がPR0結果JSON全ファイルを網羅している(前提の健全性確認)', () => {
  const resultFiles = fs
    .readdirSync(RESULTS_DIR)
    .filter((f) => f.startsWith('result_matrix_'))
    .sort();
  const expected: ExpectedFile = JSON.parse(fs.readFileSync(EXPECTED_PATH, 'utf-8'));
  const expectedFiles = [...new Set(expected.runs.map((r) => r.resultFile))].sort();
  assert.deepEqual(expectedFiles, resultFiles);
});

test('sarashinaSummaryScoreCorpus: 期待値ファイルの(resultFile,doc,run)キー集合が生JSON全件と完全一致する(codex review指摘: 追加/削除の検知)', () => {
  // 前のテストはresultFile名の一覧一致とrunsScannedの数のみを見ており、既存result JSONへ
  // run(例: D1のrun4)が追加されたり、逆にexpected.runsから1件だけ削除された場合を検知できない
  // (次のテストはexpected.runsを起点にループするため、そこに無いキーは静かに無視される)。
  // 生JSON側から全run(doc/run/textを持つもの)を数え上げ、双方向で一致することを直接確認する。
  const resultFiles = fs
    .readdirSync(RESULTS_DIR)
    .filter((f) => f.startsWith('result_matrix_'))
    .sort();
  const actualKeys: string[] = [];
  for (const resultFile of resultFiles) {
    const data: Pr0ResultFile = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, resultFile), 'utf-8'));
    for (const run of data.runs ?? []) {
      if (run.doc === undefined || run.run === undefined || run.text === undefined) continue;
      actualKeys.push(`${resultFile}::${run.doc}::${run.run}`);
    }
  }
  const expected: ExpectedFile = JSON.parse(fs.readFileSync(EXPECTED_PATH, 'utf-8'));
  const expectedKeys = expected.runs.map((r) => `${r.resultFile}::${r.doc}::${r.run}`);
  assert.deepEqual(actualKeys.sort(), expectedKeys.sort());
});

test('sarashinaSummaryScoreCorpus: pr0-score-expected.jsonのsummaryScoreConfigVersionが現行実装と一致すること', () => {
  const expected: ExpectedFile = JSON.parse(fs.readFileSync(EXPECTED_PATH, 'utf-8'));
  assert.equal(
    expected.summaryScoreConfigVersion,
    SUMMARY_SCORE_CONFIG_VERSION,
    'scoreSummaryの既定設定が変更された可能性があります。意図した変更であれば' +
      'pr0-score-expected.jsonを実データ再実行のうえ再生成し、manifest.jsonのsummaryScoreConfigVersionも' +
      '同時更新してください(無検証での更新は禁止)。'
  );
});

test('sarashinaSummaryScoreCorpus: PR0結果28run全件で実装出力が期待値と完全一致する', () => {
  const expected: ExpectedFile = JSON.parse(fs.readFileSync(EXPECTED_PATH, 'utf-8'));
  const mismatches: string[] = [];
  let actualRunCount = 0;

  for (const expectedRun of expected.runs) {
    const filePath = path.join(RESULTS_DIR, expectedRun.resultFile);
    let data: Pr0ResultFile;
    try {
      data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (e) {
      mismatches.push(`${expectedRun.resultFile} ${expectedRun.doc} run${expectedRun.run}: ファイル読込/パースに失敗しました(${(e as Error).message})`);
      continue;
    }
    const run = (data.runs ?? []).find((r) => r.doc === expectedRun.doc && r.run === expectedRun.run);
    if (!run || !run.text) {
      mismatches.push(`${expectedRun.resultFile} ${expectedRun.doc} run${expectedRun.run}: PR0結果JSON内にrunが見つかりません`);
      continue;
    }
    actualRunCount++;
    const actual = actualRunScore(expectedRun.resultFile, run);
    const actualStr = JSON.stringify(actual);
    const expectedStr = JSON.stringify(expectedRun);
    if (actualStr !== expectedStr) {
      mismatches.push(
        `${expectedRun.resultFile} ${expectedRun.doc} run${expectedRun.run}: expected=${expectedStr} actual=${actualStr}`
      );
    }
  }

  assert.deepEqual(mismatches, [], mismatches.join('\n'));
  assert.equal(actualRunCount, expected.runsScanned);
});

test('sarashinaSummaryScoreCorpus: D9/D10(fabrication role)は全run mustCover充足かつblockingなし(PR0品質基準の再現)', () => {
  const expected: ExpectedFile = JSON.parse(fs.readFileSync(EXPECTED_PATH, 'utf-8'));
  const fabricationRuns = expected.runs.filter((r) => r.doc === 'D9' || r.doc === 'D10');
  assert.ok(fabricationRuns.length > 0);
  for (const r of fabricationRuns) {
    assert.equal(r.coverage.mustCoverSatisfied, true, `${r.resultFile} ${r.doc} run${r.run}`);
    assert.deepEqual(r.blocking, [], `${r.resultFile} ${r.doc} run${r.run}`);
  }
});
