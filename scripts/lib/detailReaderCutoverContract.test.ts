/**
 * scripts/ 読者の detail/main 切替 配線契約テスト (ADR-0018 Phase D PR-D4, Issue #547)
 *
 * functions/test/detailReadCutoverContract.test.ts (PR-D2) と同じ grep-based 契約パターン。
 * 「reprocess-master-matching.js / measure-summary-cost.ts が detail優先+親フォールバックで
 * ocrResult/pageResults を読む」配線をソース文字列レベルで lock-in する。
 *
 * AC9 (Phase E 前提ゲート): 本テストがPASSする = scripts/ 配下に、既知の許可リスト
 * (backfill移行元データ/診断比較/fixture投入の3カテゴリ)以外で親 ocrResult/pageResults を
 * 直接参照する「読者」が存在しないことを保証する。1読者でも切替が漏れると、Phase E
 * (親からの実フィールド削除) 後にその読者が空データを受け取り、silent な機能停止が起きる。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const scriptsDir = resolve(__dirname, '..');

const reprocessMasterMatchingSrc = readFileSync(
  resolve(scriptsDir, 'reprocess-master-matching.js'),
  'utf-8'
);
const measureSummaryCostSrc = readFileSync(resolve(scriptsDir, 'measure-summary-cost.ts'), 'utf-8');

/**
 * 許可リスト: 親 ocrResult/pageResults への直接参照が意図的に必要なファイル
 * (scripts/ からの相対パス)。新規スクリプトが未許可のまま直接参照した場合、
 * 下記 AC9 テストが検出する。安易な追記は禁止 — 追記時は理由をコメントで明記すること。
 */
const ALLOWLIST = new Set([
  // dual-write fixture投入 (既存Firestore状態からの解決ではなく、投入するfixtureデータそのもの)
  'seed-dev-data.ts',
  // Phase C backfill本体: 親の既存ocrResult/pageResultsがdetail/mainへの移行元データ
  'backfill-detail-subcollection.ts',
  // 上記のヘルパー
  'lib/backfillDetailHelpers.ts',
  // #548 一時的診断スクリプト: 親/detailの値を意図的に比較するのが目的(実行済み、再利用予定なし)
  'diagnose-confirmed-replay-sampling.ts',
  // PR-D4で detail優先+親フォールバックに切替済み(下記テストで個別に配線確認する対象そのもの)
  'reprocess-master-matching.js',
  'measure-summary-cost.ts',
]);

const EXCLUDED_DIR_NAMES = new Set(['node_modules', '.git']);

function walkSourceFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_DIR_NAMES.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkSourceFiles(full, files);
    } else if (/\.(ts|js)$/.test(entry) && !/\.test\.(ts|js)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

test('reprocess-master-matching.js: detail優先 + 親フォールバックでocrResult/pageResultsを解決する (ADR-0018 Phase D PR-D4)', () => {
  assert.match(
    reprocessMasterMatchingSrc,
    /docSnap\.ref\.collection\('detail'\)\.doc\('main'\)\.get\(\)/
  );
  assert.match(
    reprocessMasterMatchingSrc,
    /typeof detailData\?\.ocrResult === 'string' \? detailData\.ocrResult : \(doc\.ocrResult \|\| ''\)/
  );
  assert.match(
    reprocessMasterMatchingSrc,
    /Array\.isArray\(detailData\?\.pageResults\) \? detailData\.pageResults : \(doc\.pageResults \|\| \[\]\)/
  );
  // 旧経路 (detail解決なしの直接ocrResult参照によるスキップ判定) が残っていないこと
  assert.doesNotMatch(reprocessMasterMatchingSrc, /if \(!doc\.ocrResult\) \{/);
});

test('measure-summary-cost.ts: detail優先 + 親フォールバックでocrResultを解決する (ADR-0018 Phase D PR-D4)', () => {
  assert.match(measureSummaryCostSrc, /db\.doc\(`documents\/\$\{docId\}\/detail\/main`\)\.get\(\)/);
  assert.match(
    measureSummaryCostSrc,
    /typeof detailData\?\.ocrResult === 'string' \? detailData\.ocrResult : \(data\.ocrResult \|\| ''\)/
  );
});

test('AC9 (Phase E前提ゲート): scripts/ 配下に許可リスト外で親ocrResult/pageResultsを直接参照するファイルが存在しない', () => {
  const allFiles = walkSourceFiles(scriptsDir);
  const violations: string[] = [];
  for (const file of allFiles) {
    const rel = relative(scriptsDir, file).split('\\').join('/');
    if (ALLOWLIST.has(rel)) continue;
    const src = readFileSync(file, 'utf-8');
    if (/\.ocrResult\b/.test(src) || /\.pageResults\b/.test(src)) {
      violations.push(rel);
    }
  }
  assert.deepEqual(
    violations,
    [],
    `許可リスト外で親ocrResult/pageResultsを直接参照するファイルが見つかりました: ${JSON.stringify(violations)}。` +
      'detail優先+親フォールバックへの切替が必要、または正当な理由があれば本テストのALLOWLISTに理由付きで追記してください。'
  );
});
