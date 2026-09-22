/**
 * PR0結果コーパス回帰テスト (ADR-0027 PR2a)
 *
 * `shared/summaryFabricationScan.ts` をPR0結果JSON(28run、
 * `scripts/fixtures/sarashina-summary-golden/pr0-verification/results/*.json`)へ実行し、
 * `scripts/fixtures/sarashina-summary-golden/pr0-fabrication-expected.json` に固定した
 * 期待値と完全一致することを検証する。
 *
 * このテストの目的(`/plan-crossreview` codex High指摘反映): PR2詳細設計では当初
 * 「4段階アルゴリズムで誤検出13→0を確認済み」と記載していたが、これはコードとして
 * 未実装の設計提案に過ぎず、確認済みの事実ではなかった(実際に旧正規表現版を再実行すると
 * 今も13件誤検出する)。本テストにより「実装後に同じ28runへ通した結果が期待値と一致する」
 * ことを機械的に固定し、将来アルゴリズムを変更した際の意図しない退行(誤検出の再発、
 * 逆に真陽性の見逃し)を検知する。
 *
 * `functions/test/paddleOcrArbitrationRegression.test.ts` が
 * `scripts/fixtures/paddle-ocr-golden/` を直接読む前例を踏襲する(参照元: Explore調査)。
 */

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { scanSummaryForFabrication } from '../../shared/summaryFabricationScan';

const DOCS_DIR = path.join(__dirname, '..', '..', 'scripts', 'fixtures', 'sarashina-summary-golden', 'docs');
const RESULTS_DIR = path.join(
  __dirname,
  '..',
  '..',
  'scripts',
  'fixtures',
  'sarashina-summary-golden',
  'pr0-verification',
  'results'
);
const EXPECTED_PATH = path.join(
  __dirname,
  '..',
  '..',
  'scripts',
  'fixtures',
  'sarashina-summary-golden',
  'pr0-fabrication-expected.json'
);
const MANIFEST_PATH = path.join(
  __dirname,
  '..',
  '..',
  'scripts',
  'fixtures',
  'sarashina-summary-golden',
  'manifest.json'
);
// ハードコードせず manifest.json から読む(silent-failure-hunter指摘: 独立した8000のハード
// コード値だと、本番MAX_SUMMARY_INPUT_LENGTHが変更されてもこのテストだけ気づかず緑のまま
// 残り、scripts/lib/sarashinaSummaryGoldenDrift.test.tsが検知するドリフトと単一のsource of
// truthを共有できていなかった)。
const MAX_INPUT_CHARS: number = (JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8')) as { maxInputChars: number })
  .maxInputChars;

interface ExpectedFinding {
  kind: string;
  name: string;
}

interface ExpectedRun {
  resultFile: string;
  doc: string;
  run: number;
  findings: ExpectedFinding[];
}

interface ExpectedFile {
  runsScanned: number;
  summary: { fabricated: number; recombined: number };
  runs: ExpectedRun[];
}

interface Pr0ResultRun {
  doc?: string;
  run?: number;
  text?: string;
}

interface Pr0ResultFile {
  runs?: Pr0ResultRun[];
}

/** 本番`summaryPromptBuilder.ts`の切り詰め処理(`...(以下省略)`付与)は完全には再現しない
 * 単純スライス。`scanSummaryForFabrication`のverbatim/再結合判定は末尾に付与される定型文
 * `...(以下省略)`の有無に依存しないため実害はないが、バイト単位で本番と同一の入力ではない
 * ことに留意(comment-analyzer指摘)。 */
function sourceTextFor(docId: string): string {
  return fs.readFileSync(path.join(DOCS_DIR, `${docId}.txt`), 'utf-8').slice(0, MAX_INPUT_CHARS);
}

describe('sarashinaSummaryScanCorpus: PR0結果28run回帰', () => {
  const expected: ExpectedFile = JSON.parse(fs.readFileSync(EXPECTED_PATH, 'utf-8'));

  it('期待値ファイル自体がPR0結果JSON全ファイルを網羅している(前提の健全性確認)', () => {
    const resultFiles = fs
      .readdirSync(RESULTS_DIR)
      .filter((f) => f.startsWith('result_matrix_'))
      .sort();
    const expectedFiles = [...new Set(expected.runs.map((r) => r.resultFile))].sort();
    expect(expectedFiles).to.deep.equal(resultFiles);
  });

  it(`28run全件で実装出力が期待値(fabricated=${0}, recombined=${3})と完全一致する`, () => {
    let actualRunCount = 0;
    let actualFabricated = 0;
    let actualRecombined = 0;
    const mismatches: string[] = [];

    for (const expectedRun of expected.runs) {
      // ファイル読込/パース/ソース読込の失敗も、run未検出と同じくmismatchesへ集約する
      // (silent-failure-hunter指摘: 無防備なreadFileSync/JSON.parseが1件でも失敗すると
      // 未捕捉例外でループ全体が打ち切られ、「全mismatchsを1回のpassでまとめて提示する」
      // という本テストの設計意図が壊れていた)。
      const filePath = path.join(RESULTS_DIR, expectedRun.resultFile);
      let data: Pr0ResultFile;
      let src: string;
      try {
        data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        src = sourceTextFor(expectedRun.doc);
      } catch (e) {
        mismatches.push(
          `${expectedRun.resultFile} ${expectedRun.doc} run${expectedRun.run}: ` +
            `ファイル読込/パースに失敗しました(${(e as Error).message})`
        );
        continue;
      }
      const run = (data.runs ?? []).find(
        (r) => r.doc === expectedRun.doc && r.run === expectedRun.run
      );
      if (!run || !run.text) {
        mismatches.push(
          `${expectedRun.resultFile} ${expectedRun.doc} run${expectedRun.run}: PR0結果JSON内にrunが見つかりません`
        );
        continue;
      }
      actualRunCount++;
      const result = scanSummaryForFabrication(run.text, src);
      actualFabricated += result.fabricatedCount;
      actualRecombined += result.recombinedCount;

      const actualFindings = result.findings
        .map((f) => ({ kind: f.kind, name: f.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const expectedFindings = [...expectedRun.findings].sort((a, b) => a.name.localeCompare(b.name));
      if (JSON.stringify(actualFindings) !== JSON.stringify(expectedFindings)) {
        mismatches.push(
          `${expectedRun.resultFile} ${expectedRun.doc} run${expectedRun.run}: ` +
            `expected=${JSON.stringify(expectedFindings)} actual=${JSON.stringify(actualFindings)}`
        );
      }
    }

    expect(mismatches, mismatches.join('\n')).to.deep.equal([]);
    expect(actualRunCount).to.equal(expected.runsScanned);
    expect(actualFabricated).to.equal(expected.summary.fabricated);
    expect(actualRecombined).to.equal(expected.summary.recombined);
  });

  it('D9(捏造誘発fixture)8回全てで捏造0件(PR0品質基準実験の再現)', () => {
    const d9Runs = expected.runs.filter((r) => r.doc === 'D9');
    expect(d9Runs.length).to.equal(8);
    for (const r of d9Runs) {
      expect(r.findings, `${r.resultFile} D9 run${r.run}`).to.deep.equal([]);
    }
  });

  it('D3 run3の再結合3件はrecombinedであり、fabricatedにはならない(捏造としてブロックしない)', () => {
    const d3run3 = expected.runs.find(
      (r) => r.doc === 'D3' && r.run === 3 && r.resultFile.includes('d1d4')
    );
    expect(d3run3, 'D3 run3 (d1d4結果ファイル) が見つかりません').to.not.equal(undefined);
    expect(d3run3!.findings.length).to.equal(3);
    expect(d3run3!.findings.every((f) => f.kind === 'recombined')).to.equal(true);
  });
});
