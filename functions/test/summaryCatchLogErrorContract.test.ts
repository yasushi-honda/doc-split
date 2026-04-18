/**
 * summary 経路 catch 句 logError 呼出契約テスト (Issue #266)
 *
 * 目的: ocrProcessor / regenerateSummary の summary 生成失敗 catch 句で、
 * console.error だけでなく logError (errors collection + 通知) が呼ばれ続けることを保証する。
 *
 * 背景 (#178/#209 教訓):
 * Vertex AI のクォータ枯渇・認証失効・暴走系エラーが silently swallow されると、
 * documents は status:processed で完了し「summary が空」としか見えない。
 * 6 ヶ月後のデバッグで原因不明となる silent failure を構造的に防ぐ。
 *
 * 方式: grep-based (静的検証)。`summaryWritePayloadContract.test.ts` (#259) と同方針。
 * console.error メッセージをアンカーに、近傍 (±ANCHOR_WINDOW_LINES 行) の logError 呼出を検知する。
 * メッセージ変更時は test 失敗するが、意図的変更なのでメンテナンス負荷は許容範囲。
 */

import { expect } from 'chai';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * summary 生成失敗 catch 句のアンカー定義。
 * anchor メッセージは console.error(...) 内の固定文字列で、catch 句内に残す前提。
 * console.error を削除して logError のみに移行する場合は本契約の設計見直しが必要。
 */
const SUMMARY_CATCH_ANCHORS = [
  {
    file: 'src/ocr/ocrProcessor.ts',
    anchor: 'Summary generation failed',
    context: 'summaryPromise.catch (best-effort, edge case safety net)',
  },
  {
    file: 'src/ocr/ocrProcessor.ts',
    anchor: 'Failed to generate summary',
    context: 'generateSummary inner catch (main path)',
  },
  {
    file: 'src/ocr/regenerateSummary.ts',
    anchor: 'Failed to generate summary',
    context: 'regenerateSummary rethrow-preceding catch',
  },
] as const;

// catch 句のスコープとして許容する近接ウィンドウ。catch ブロックは通常 3-5 行だが、
// コメント行や空行・多段 await を吸収するため 8 行とする。
const ANCHOR_WINDOW_LINES = 8;

// logError / safeLogError 呼出の検知パターン。`await logError(` / `await safeLogError(` 等を許容。
// Issue #266 simplify 指摘対応: catch 句の重複削減で safeLogError ラッパ経由の呼出を許容。
const LOG_ERROR_CALL = /\b(?:safeLogError|logError)\s*\(/;

/**
 * アンカーメッセージの各 occurrence について、ANCHOR_WINDOW_LINES 行以内に
 * logError 呼出が存在するかを全件検証する。
 *
 * 防御: occurrence が 0 件なら「アンカー不在 = catch 句リネーム/削除」として明示失敗させる。
 * 単純な `some` 検証だと occurrence 0 件でも vacuous true で PASS する silent failure を防ぐ。
 */
function everyAnchorHasLogErrorNearby(source: string, anchor: string): {
  ok: boolean;
  occurrenceCount: number;
  missingLines: number[];
} {
  const lines = source.split('\n');
  const anchorIndices = lines
    .map((line, idx) => ({ line, idx }))
    .filter(({ line }) => line.includes(anchor))
    .map(({ idx }) => idx);

  const missingLines: number[] = [];
  for (const idx of anchorIndices) {
    const start = Math.max(0, idx - ANCHOR_WINDOW_LINES);
    const end = Math.min(lines.length, idx + ANCHOR_WINDOW_LINES + 1);
    const window = lines.slice(start, end).join('\n');
    if (!LOG_ERROR_CALL.test(window)) {
      missingLines.push(idx + 1); // 1-based for error messages
    }
  }

  return {
    ok: anchorIndices.length > 0 && missingLines.length === 0,
    occurrenceCount: anchorIndices.length,
    missingLines,
  };
}

describe('summary catch logError contract (#266)', () => {
  // パス実在を describe 評価時に明示確認 (#259 同パターン)。
  // readFileSync の ENOENT で suite 起動失敗が「caller 削除/リネーム」のシグナルとして
  // 埋もれるのを防ぐ。
  before(() => {
    for (const { file } of SUMMARY_CATCH_ANCHORS) {
      const absPath = resolve(process.cwd(), file);
      if (!existsSync(absPath)) {
        throw new Error(
          `SUMMARY_CATCH_ANCHORS に登録された ${file} が存在しない。` +
            `caller がリネーム/削除された場合は本契約の見直しが必要。`
        );
      }
    }
  });

  for (const { file, anchor, context } of SUMMARY_CATCH_ANCHORS) {
    describe(`${file} (${context})`, () => {
      const absPath = resolve(process.cwd(), file);
      const source = readFileSync(absPath, 'utf-8');

      it(`アンカー '${anchor}' が console.error 内に存在する`, () => {
        expect(source).to.include(anchor);
      });

      it(`アンカー '${anchor}' の各 occurrence 近傍 (±${ANCHOR_WINDOW_LINES} 行) に logError 呼出がある`, () => {
        const result = everyAnchorHasLogErrorNearby(source, anchor);

        expect(result.occurrenceCount).to.be.greaterThan(
          0,
          `アンカー '${anchor}' が ${file} に見つからない (0 occurrence)。` +
            `catch 句の console.error メッセージが変更された可能性あり。`
        );

        expect(result.ok).to.equal(
          true,
          `アンカー '${anchor}' の近傍に logError 呼出が見つからない。` +
            `行番号 (1-based): ${result.missingLines.join(', ')}。` +
            `catch 句で silent failure を起こしている可能性あり (#178/#209 違反)。`
        );
      });
    });
  }

  describe('everyAnchorHasLogErrorNearby detection logic', () => {
    it('positive: catch 句直後に logError 呼出がある場合は PASS', () => {
      const fixture = `
try {
  await doThing();
} catch (err) {
  console.error('Operation failed:', err);
  logError({ error: err, source: 'ocr', functionName: 'doThing' });
}
      `;
      const result = everyAnchorHasLogErrorNearby(fixture, 'Operation failed');
      expect(result.ok).to.equal(true);
      expect(result.occurrenceCount).to.equal(1);
    });

    it('negative: catch 句内に logError がなければ FAIL (silent failure 検知)', () => {
      const fixture = `
try {
  await doThing();
} catch (err) {
  console.error('Operation failed:', err);
  return defaultValue;
}
      `;
      const result = everyAnchorHasLogErrorNearby(fixture, 'Operation failed');
      expect(result.ok).to.equal(false);
      expect(result.occurrenceCount).to.equal(1);
      expect(result.missingLines).to.have.lengthOf(1);
    });

    it('negative: アンカー不在は 0 occurrence として FAIL (vacuous true 防御)', () => {
      const fixture = `const x = 1;`;
      const result = everyAnchorHasLogErrorNearby(fixture, 'NonExistentAnchor');
      expect(result.ok).to.equal(false);
      expect(result.occurrenceCount).to.equal(0);
    });

    it('positive: ANCHOR_WINDOW_LINES 境界内 (8 行先) の logError は検知する', () => {
      const fixture = [
        `console.error('Msg:', err);`,
        `  line1`,
        `  line2`,
        `  line3`,
        `  line4`,
        `  line5`,
        `  line6`,
        `  line7`,
        `  logError({ error: err });`, // 8 行先 (idx=8)、ANCHOR_WINDOW_LINES=8 で window=[0..8+1) 境界内
      ].join('\n');
      const result = everyAnchorHasLogErrorNearby(fixture, 'Msg:');
      expect(result.ok).to.equal(true);
    });

    it('negative: ANCHOR_WINDOW_LINES 境界超過 (10 行先) の logError は検知しない', () => {
      const fixture = [
        `console.error('Msg:', err);`,
        `  line1`,
        `  line2`,
        `  line3`,
        `  line4`,
        `  line5`,
        `  line6`,
        `  line7`,
        `  line8`,
        `  line9`,
        `  logError({ error: err });`, // 10 行先、ANCHOR_WINDOW_LINES=8 境界超過
      ].join('\n');
      const result = everyAnchorHasLogErrorNearby(fixture, 'Msg:');
      expect(result.ok).to.equal(false);
    });

    it('negative: 複数 occurrence のうち 1 件でも logError 不在なら FAIL', () => {
      // 1 回目 (line 0): 近傍に logError あり → OK
      // 2 回目 (line 13): 近傍 8 行以内に logError なし → FAIL 寄与
      // ANCHOR_WINDOW_LINES=8 を超える距離を確保するため filler 11 行挿入
      const fixture = [
        `console.error('Msg:', err);`, // line 0
        `logError({ error: err });`, // line 1 (1 回目近傍)
        `filler 1`,
        `filler 2`,
        `filler 3`,
        `filler 4`,
        `filler 5`,
        `filler 6`,
        `filler 7`,
        `filler 8`,
        `filler 9`,
        `filler 10`,
        `filler 11`,
        `console.error('Msg:', err);`, // line 13 (2 回目、logError 不在)
        `return defaultValue;`,
      ].join('\n');
      const result = everyAnchorHasLogErrorNearby(fixture, 'Msg:');
      expect(result.ok).to.equal(false);
      expect(result.occurrenceCount).to.equal(2);
      expect(result.missingLines).to.deep.equal([14]); // 1-based line number of 2 回目
    });
  });
});
