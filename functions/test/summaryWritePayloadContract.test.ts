/**
 * summary 書込経路 caller-side 契約テスト (Issue #255 + #259)
 *
 * 目的: ocrProcessor / regenerateSummary の Firestore 書込呼出で 3 要素を同時保持することを
 * lock-in する: (1) `summary: buildSummaryFields(...)` (新 discriminated union, #215),
 * (2) `summaryTruncated: FieldValue.delete()` (旧フラット削除), (3) `summaryOriginalLength:
 * FieldValue.delete()`。#259: builder bypass (object literal 直書込) / .set() / .create() /
 * merge:true 等のバイパス経路も検知対象。
 *
 * 背景 (#178 教訓): 派生フィールドの一括書込が壊れると FE 表示が崩れる。旧フィールド delete
 * 忘れで Firestore に残留し後方互換読込に無限依存するリスクを防ぐ。
 *
 * 方式: grep-based (docs/context/test-strategy.md §2.1 参照)。
 *
 * 既知の grep limitation (#262 で明示 lock-in、本 test 下方の `describe.skip`
 * セクション 'grep limitation (known false-positive/negative)' を参照):
 *   - コメント内 `// summary: { ... }` + 近傍 `.update(` → false positive
 *   - 文字列リテラル内 `'summary: {'` + 近傍 `.update(` → false positive
 *   - 型注釈 `{ summary: { t: string } }` + 近傍 `.update(` → false positive
 *   - 深いネスト `.update({ meta: { inner: { summary: {} } } })` → false positive
 *   - quoted key `"summary": {` → 現在 false (正) だが将来 lock-in
 *   - CJK prefix `担当者summary: {` → `\b` が CJK-ASCII 境界で成立、限定的 false positive
 *
 * sinon spy 昇格条件 (上記いずれかが実害を生んだ場合):
 *   1. 本番 caller で false positive/negative が実際に観測された
 *   2. false positive 回避のため grep pattern を過度に複雑化する必要が出た
 *   3. proxyquire / module rewriter 等の周辺 infra が整った (#299 と併走)
 *
 * それまでは grep-based contract を恒久保持する (低コスト・高速・可読性優位)。
 */

import { expect } from 'chai';
import { existsSync, readdirSync, readFileSync } from 'fs';
import type { Dirent } from 'fs';
import { join, resolve } from 'path';

// summary 書込 3 要素を検出するパターン。
// `admin.firestore.FieldValue.delete()` と `FieldValue.delete()` の両表記を許容。
const BUILD_SUMMARY_FIELDS_CALL = /summary:\s*buildSummaryFields\s*\(/;
const SUMMARY_TRUNCATED_DELETE =
  /summaryTruncated:\s*(?:admin\.firestore\.)?FieldValue\.delete\s*\(\s*\)/;
const SUMMARY_ORIGINAL_LENGTH_DELETE =
  /summaryOriginalLength:\s*(?:admin\.firestore\.)?FieldValue\.delete\s*\(\s*\)/;

// #259: 直接書込パターン検知 (buildSummaryFields 経由しない anti-pattern)。
// `\b` で word boundary を強制し `commentSummary: {` / `errorSummary: {` の suffix 一致誤検知を排除。
const SUMMARY_DIRECT_WRITE_LITERAL = /\bsummary\s*:\s*\{/;

// #259: `.update()` だけでなく `.set()` / `.create()` も Firestore 書込として扱う。
// `set({...}, { merge: true })` で派生フィールド整合をバイパスする経路を検知対象に含める。
const FIRESTORE_WRITE_CALL = /\.(?:update|set|create)\s*\(/;

// #178 教訓: 派生フィールド 3 要素は同一 update() ブロック内で書き込む必要がある。
// 本契約に含める caller ファイル。新規 caller 追加時は手動追記すること。
const WRITE_PAYLOAD_CALLERS = [
  'src/ocr/ocrProcessor.ts',
  'src/ocr/regenerateSummary.ts',
] as const;

// 同一 update() ブロック近接性の検証ウィンドウ。ocrProcessor の update は spread 含む
// 大ブロック (~20 行)、regenerateSummary は ~4 行。30 行で両 caller を吸収。
const ADJACENCY_WINDOW_LINES = 30;

/**
 * 全 patterns が同一 ADJACENCY_WINDOW_LINES 行以内に共存するかをスライディングウィンドウで判定する汎用ヘルパ。
 * `hasThreeElementsAdjacent` と `hasDirectSummaryWrite` の共通ロジックを抽出し、コピペドリフトを防ぐ。
 *
 * 防御: patterns が空配列なら `Array.prototype.every` の vacuous truth で常に true となり、
 * 全 source を caller として誤分類する silent failure になる。明示的に throw して阻止。
 */
/**
 * readFileSync を purpose 付きでラップし、per-file 失敗時の診断を強化する (#262 silent-failure-hunter IMP-1)。
 *
 * EACCES / EISDIR / EMFILE / TOCTOU race で suite 全体が落ちる場合、どのファイル・どの用途で
 * 失敗したかをエラーメッセージから即時特定できるようにする。
 */
function readFileWithContext(absPath: string, purpose: string): string {
  try {
    return readFileSync(absPath, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? 'UNKNOWN';
    throw new Error(`[${purpose}] readFileSync failed for ${absPath} (code=${code}): ${(err as Error).message}`);
  }
}

/**
 * walk() で symlink を skip する。broken symlink / 循環 symlink で stack overflow や
 * generic crash を起こさない (#262 silent-failure-hunter IMP-2)。
 */
function shouldWalkInto(entry: Dirent): boolean {
  // symlink は isDirectory() / isFile() を辿ろうとするが、broken 時は ENOENT で落ちる。
  // テスト fixture の性質上 symlink は想定しないため一括 skip で安全側に倒す。
  return !entry.isSymbolicLink() && entry.isDirectory();
}

function hasPatternsAdjacent(source: string, ...patterns: RegExp[]): boolean {
  if (patterns.length === 0) {
    throw new Error(
      'hasPatternsAdjacent requires at least one pattern (vacuous true would silently match all sources).'
    );
  }
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const window = lines.slice(i, i + ADJACENCY_WINDOW_LINES).join('\n');
    if (patterns.every((p) => p.test(window))) return true;
  }
  return false;
}

// 3 要素 (buildSummaryFields / summaryTruncated.delete / summaryOriginalLength.delete) が
// 同一 update() ブロック内 (ADJACENCY_WINDOW_LINES 行以内) に共存するかを検証。
// ファイル全体で 3 要素が散在する false positive (review-pr Critical 指摘) を防ぐ。
function hasThreeElementsAdjacent(source: string): boolean {
  return hasPatternsAdjacent(
    source,
    BUILD_SUMMARY_FIELDS_CALL,
    SUMMARY_TRUNCATED_DELETE,
    SUMMARY_ORIGINAL_LENGTH_DELETE
  );
}

// #259: 直接書込パターン (`summary: { ... }` object literal) を Firestore 書込呼出 (`.update`/`.set`/`.create`)
// の近傍で検知。型定義 `interface Foo { summary: { text: string } }` などは書込呼出を伴わないため誤検知しない。
// パターン側 `SUMMARY_DIRECT_WRITE_LITERAL` の `\b` 境界は `commentSummary:` / `errorSummary:` の
// suffix 一致誤検知を防ぐため必須 (regex 簡素化名目で外すと caller 数契約が膨張する)。
function hasDirectSummaryWrite(source: string): boolean {
  return hasPatternsAdjacent(source, FIRESTORE_WRITE_CALL, SUMMARY_DIRECT_WRITE_LITERAL);
}

describe('summary write-payload contract (#255)', () => {
  // silent-failure-hunter 指摘対応: パス実在を describe 評価時に明示的に確認。
  // 旧来は readFileSync の ENOENT で suite 起動失敗となり「テスト未実行」が
  // 「ファイル不在 = caller 削除/リネーム」のシグナルとして埋もれていた。
  before(() => {
    for (const relPath of WRITE_PAYLOAD_CALLERS) {
      const absPath = resolve(process.cwd(), relPath);
      if (!existsSync(absPath)) {
        throw new Error(
          `WRITE_PAYLOAD_CALLERS に登録された ${relPath} が存在しない。` +
            `caller がリネーム/削除された場合は本契約の見直しが必要。`
        );
      }
    }
  });

  for (const relPath of WRITE_PAYLOAD_CALLERS) {
    describe(relPath, () => {
      const absPath = resolve(process.cwd(), relPath);
      const source = readFileWithContext(absPath, `caller-source:${relPath}`);

      it('`summary: buildSummaryFields(...)` の新形式書込が存在する', () => {
        expect(source).to.match(BUILD_SUMMARY_FIELDS_CALL);
      });

      it('`summaryTruncated: FieldValue.delete()` で旧フィールドを削除する', () => {
        expect(source).to.match(SUMMARY_TRUNCATED_DELETE);
      });

      it('`summaryOriginalLength: FieldValue.delete()` で旧フィールドを削除する', () => {
        expect(source).to.match(SUMMARY_ORIGINAL_LENGTH_DELETE);
      });

      // review-pr Critical 指摘対応: 3 要素がファイル内に分散していないこと
      // (同一 update() ブロックでの隣接性) を保証。
      it(`3 要素が同一 update() ブロック近接 (≤${ADJACENCY_WINDOW_LINES} 行) に共存する`, () => {
        expect(hasThreeElementsAdjacent(source)).to.equal(
          true,
          '3 要素が散在している。同一 update() で書き込まれていない可能性あり (#178 違反)'
        );
      });
    });
  }

  describe('caller 追加検知 (noUnused contract)', () => {
    // summary 書込パターンを持つファイルが WRITE_PAYLOAD_CALLERS と完全一致するか identity で検証。
    // count のみだと「rename + 新規追加」で count 維持されたまま identity が乖離する silent drift を見逃す。
    // #259: `buildSummaryFields` 経由 OR 直接 object literal 書込の OR 集合で検知し、
    // anti-pattern による「テストは緑、本番は静かに壊れる」を防ぐ。診断メッセージは
    // viaBuilder / viaDirect を区別し失敗時の原因究明を即時化する。
    it('summary 書込 caller の identity が WRITE_PAYLOAD_CALLERS と一致する', () => {
      // #262: symlink は shouldWalkInto で skip し、broken/循環 symlink 由来の crash を回避
      const walk = (dir: string): string[] =>
        readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
          const full = join(dir, entry.name);
          if (shouldWalkInto(entry)) return walk(full);
          if (entry.isFile() && entry.name.endsWith('.ts')) return [full];
          return [];
        });
      const srcRoot = resolve(process.cwd(), 'src');
      const tsFiles = walk(srcRoot);
      const detected = tsFiles
        .map((f) => {
          const s = readFileWithContext(f, 'caller-scan');
          return {
            file: f,
            viaBuilder: BUILD_SUMMARY_FIELDS_CALL.test(s),
            viaDirect: hasDirectSummaryWrite(s),
          };
        })
        .filter((c) => c.viaBuilder || c.viaDirect);

      const actualSorted = detected.map((c) => c.file).sort();
      const expectedSorted = WRITE_PAYLOAD_CALLERS.map((p) => resolve(process.cwd(), p)).sort();

      const diagnosticDetail = detected
        .map((c) => `  ${c.file} (viaBuilder=${c.viaBuilder}, viaDirect=${c.viaDirect})`)
        .join('\n');
      expect(actualSorted).to.deep.equal(
        expectedSorted,
        `summary 書込 caller の identity が WRITE_PAYLOAD_CALLERS と乖離。\n` +
          `expected:\n${expectedSorted.map((f) => `  ${f}`).join('\n')}\n` +
          `actual:\n${diagnosticDetail || '  (none)'}`
      );
    });
  });

  // #259 follow-up: 検知ロジック自体の単体テスト。fixture 文字列で正常系/異常系を網羅。
  // 本検知が緩むと caller 追加検知テスト (#255) が黙って素通りするため、
  // regex 改変・window 縮小・OR 合成変更時の安全網として正常系・型定義除外・word boundary・
  // ADJACENCY_WINDOW_LINES 境界を lock-in する。
  describe('hasDirectSummaryWrite detection logic (#259)', () => {
    it('positive: `.update({ summary: { ... } })` 直接書込を検知する', () => {
      const fixture = `
        await ref.update({
          summary: { text: 'foo', truncated: false },
          updatedAt: now,
        });
      `;
      expect(hasDirectSummaryWrite(fixture)).to.equal(true);
    });

    it('positive: Transaction 形式 `tx.update(docRef, { summary: { ... } })` も検知する', () => {
      const fixture = `
        tx.update(docRef, {
          summary: { text: 'bar', truncated: true, originalLength: 100 },
        });
      `;
      expect(hasDirectSummaryWrite(fixture)).to.equal(true);
    });

    // C1 (review-pr Critical): `.set({...}, { merge: true })` で派生フィールド整合をバイパスする
    // 経路を検知できないと #178 教訓の根幹 (FE↔BE 整合崩壊) が silent fail する。
    it('positive: `.set({ summary }, { merge: true })` バイパスを検知する', () => {
      const fixture = `await ref.set({ summary: { text: 'foo' } }, { merge: true });`;
      expect(hasDirectSummaryWrite(fixture)).to.equal(true);
    });

    it('positive: `.create({ summary })` バイパスを検知する', () => {
      const fixture = `await ref.create({ summary: { text: 'foo' } });`;
      expect(hasDirectSummaryWrite(fixture)).to.equal(true);
    });

    it('positive: `batch.update(docRef, { summary })` バイパスを検知する', () => {
      const fixture = `batch.update(docRef, { summary: { text: 'foo' } });`;
      expect(hasDirectSummaryWrite(fixture)).to.equal(true);
    });

    it('negative: summary 書込のない write call は検知しない', () => {
      const fixture = `
        await ref.update({
          status: 'completed',
          updatedAt: now,
        });
      `;
      expect(hasDirectSummaryWrite(fixture)).to.equal(false);
    });

    it('negative: TypeScript 型定義中の summary フィールドは検知しない', () => {
      const fixture = `
        interface Foo {
          summary: { text: string; truncated: boolean };
        }
      `;
      expect(hasDirectSummaryWrite(fixture)).to.equal(false);
    });

    // word boundary `\b` で suffix 一致誤検知を排除する不変条件を lock-in。
    // この境界が外れると `commentSummary: {` / `errorSummary: {` 等を持つ無関係ファイルが
    // 誤って caller として計上され、契約テストが沈黙誤検知する。
    it('negative: `commentSummary: { ... }` は word boundary により write call 内でも検知しない', () => {
      const fixture = `
        await ref.update({
          commentSummary: { text: 'foo' },
          errorSummary: { code: 1 },
        });
      `;
      expect(hasDirectSummaryWrite(fixture)).to.equal(false);
    });
  });

  // I1 (silent-failure-hunter IMP-3): ADJACENCY_WINDOW_LINES の値が変更されたり
  // slice の off-by-one が混入した時に静かに通り抜ける silent failure を防ぐ境界 lock-in。
  describe('hasPatternsAdjacent ウィンドウ境界 (#259)', () => {
    it(`正の境界: ${ADJACENCY_WINDOW_LINES - 1} 行間隔は同一ウィンドウとみなす`, () => {
      const padding = '  // pad\n'.repeat(ADJACENCY_WINDOW_LINES - 2);
      const fixture = `await ref.update({\n${padding}  summary: { text: 'x' }\n});`;
      expect(hasDirectSummaryWrite(fixture)).to.equal(true);
    });

    it(`負の境界: ${ADJACENCY_WINDOW_LINES + 5} 行以上の間隔は別ウィンドウとして扱う`, () => {
      const gap = '\n'.repeat(ADJACENCY_WINDOW_LINES + 5);
      const fixture = `await ref.update({});${gap}const x = { summary: { text: 'y' } };`;
      expect(hasDirectSummaryWrite(fixture)).to.equal(false);
    });

    it('単一行に両 pattern が同居しても検知する', () => {
      expect(hasDirectSummaryWrite(`ref.update({summary:{text:'x'}});`)).to.equal(true);
    });
  });

  // I2 (pr-test-analyzer Important): hasThreeElementsAdjacent を hasPatternsAdjacent 経由化した
  // リファクタの回帰保護。実 caller のみに依存すると共通関数バグが両方向に波及した時に検知できない。
  describe('hasThreeElementsAdjacent regression (#259 共通化保護)', () => {
    it('positive: 3 要素隣接 fixture を検知する', () => {
      const fixture = `
        await ref.update({
          summary: buildSummaryFields(s),
          summaryTruncated: admin.firestore.FieldValue.delete(),
          summaryOriginalLength: admin.firestore.FieldValue.delete(),
        });
      `;
      expect(hasThreeElementsAdjacent(fixture)).to.equal(true);
    });

    it(`negative: 3 要素が ${ADJACENCY_WINDOW_LINES + 5} 行超に散在する場合は検知しない`, () => {
      const gap = '\n'.repeat(ADJACENCY_WINDOW_LINES + 5);
      const fixture =
        `summary: buildSummaryFields(s),${gap}` +
        `summaryTruncated: admin.firestore.FieldValue.delete(),${gap}` +
        `summaryOriginalLength: admin.firestore.FieldValue.delete(),`;
      expect(hasThreeElementsAdjacent(fixture)).to.equal(false);
    });

    it('negative: 2 要素のみ隣接 (3 要素 AND 合成の確認) で検知しない', () => {
      const fixture = `
        await ref.update({
          summary: buildSummaryFields(s),
          summaryTruncated: admin.firestore.FieldValue.delete(),
        });
      `;
      expect(hasThreeElementsAdjacent(fixture)).to.equal(false);
    });
  });

  // CRIT-1 (silent-failure-hunter): hasPatternsAdjacent の vacuous-truth 防御を契約として固定化。
  describe('hasPatternsAdjacent 防御 (#259)', () => {
    it('patterns が空配列なら throw して silent universal-true を阻止する', () => {
      expect(() => hasPatternsAdjacent('any source')).to.throw(/at least one pattern/);
    });

    it('1 pattern のみでも正常動作する', () => {
      expect(hasPatternsAdjacent('foo bar baz', /foo/)).to.equal(true);
      expect(hasPatternsAdjacent('foo bar baz', /qux/)).to.equal(false);
    });
  });

  // #262: grep-based 検知の既知 limitation を明示 lock-in する。skip で「意図された false positive」を
  // 固定化し、将来 pattern を厳格化した際の retro-test として機能させる。
  // sinon spy 昇格時に skip を外して実検知を確認する (本 describe がその時点で落ちるなら契約改善成功)。
  // 「false positive = 検知してしまう」「false negative = 検知漏れ」を明確に区別してコメント。
  describe.skip('grep limitation (known false-positive/negative) #262', () => {
    it('[FALSE POSITIVE] コメント内 `// summary: { ... }` + 近傍 `.update(` を検知してしまう', () => {
      const fixture = `
        // TODO: summary: { text, truncated } を廃止予定
        await ref.update({ status: 'done' });
      `;
      // 実装上 `summary: {` はコメント内にあっても grep に拾われる。将来 sinon spy 化で解消。
      expect(hasDirectSummaryWrite(fixture)).to.equal(false); // 理想、現状は true
    });

    it('[FALSE POSITIVE] 文字列リテラル内 `\'summary: {\'` + 近傍 `.update(` を検知してしまう', () => {
      const fixture = `
        const template = 'summary: { text, truncated }';
        await ref.update({ note: template });
      `;
      expect(hasDirectSummaryWrite(fixture)).to.equal(false); // 理想、現状は true
    });

    it('[FALSE POSITIVE] 型注釈中 `{ summary: { t: string } }` + 近傍 `.update(` を検知してしまう', () => {
      const fixture = `
        function apply(payload: { summary: { text: string } }) {
          return ref.update({ noop: true });
        }
      `;
      expect(hasDirectSummaryWrite(fixture)).to.equal(false); // 理想、現状は true
    });

    it('[FALSE POSITIVE] 深いネスト `.update({ meta: { inner: { summary: { ... } } } })` を検知してしまう', () => {
      // 本契約は「summary 書込」を直書込と見做すが、inner nested の summary は別 concern。
      const fixture = `
        await ref.update({ meta: { inner: { summary: { text: 'x' } } } });
      `;
      expect(hasDirectSummaryWrite(fixture)).to.equal(false); // 理想、現状は true
    });

    it('[FUTURE LOCK-IN] quoted key `"summary": {` を検知する契約 (現在 false、将来必要)', () => {
      // 現在の regex `\bsummary\s*:` は quote を許容しないため false。JSON 由来書込導入時に true 化が必要。
      const fixture = `await ref.update({ "summary": { text: 'x' } });`;
      expect(hasDirectSummaryWrite(fixture)).to.equal(true); // 将来、現状は false
    });

    it('[UNICODE] CJK prefix `担当者summary: {` を `\\b` 境界で成立させない契約 (現在 true、要改善)', () => {
      // `\b` は ASCII 境界で発火するが、CJK-ASCII 境界で成立するため `担当者summary:` が誤検知される。
      const fixture = `
        await ref.update({ 担当者summary: { text: 'x' } });
      `;
      expect(hasDirectSummaryWrite(fixture)).to.equal(false); // 理想、現状は true
    });
  });
});
