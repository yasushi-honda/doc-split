/**
 * summary 書込経路 caller-side 契約テスト (Issue #255)
 *
 * 目的: ocrProcessor / regenerateSummary の Firestore update() 呼出で、
 * 以下 3 要素が同時に含まれ続けることを保証する:
 *   1. `summary: buildSummaryFields(...)` — 新 discriminated union ネスト書込 (#215)
 *   2. `summaryTruncated: FieldValue.delete()` — 旧フラットフィールドの削除
 *   3. `summaryOriginalLength: FieldValue.delete()` — 旧フラットフィールドの削除
 *
 * 背景 (#178 教訓):
 * 派生フィールドの一括書込が壊れると FE 表示が崩れる。#215 で新形式への移行
 * + 旧フィールド delete を徹底したが、将来のリファクタで delete 忘れが起きると
 * Firestore に旧フィールドが残留し、後方互換読込に無限依存するリスクがある。
 *
 * 方式: grep-based (静的検証)。`summaryBuilderCallerContract.test.ts` (#214)
 * と同じ方針。false negative 発生時に sinon spy へ昇格。
 */

import { expect } from 'chai';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

// summary 書込 3 要素を検出するパターン。
// `admin.firestore.FieldValue.delete()` と `FieldValue.delete()` の両表記を許容。
const BUILD_SUMMARY_FIELDS_CALL = /summary:\s*buildSummaryFields\s*\(/;
const SUMMARY_TRUNCATED_DELETE =
  /summaryTruncated:\s*(?:admin\.firestore\.)?FieldValue\.delete\s*\(\s*\)/;
const SUMMARY_ORIGINAL_LENGTH_DELETE =
  /summaryOriginalLength:\s*(?:admin\.firestore\.)?FieldValue\.delete\s*\(\s*\)/;

// #259: 直接書込パターン検知 (buildSummaryFields 経由しない anti-pattern)。
// `summary: { text, truncated, originalLength }` のような object literal 直書きを検出する。
// ADJACENCY_WINDOW_LINES 内に `.update(` があるときのみ検知し、型定義などの誤検知を抑制。
// `\b` で word boundary を強制し `commentSummary: {` / `errorSummary: {` の suffix 一致誤検知を排除。
const SUMMARY_DIRECT_WRITE_LITERAL = /\bsummary\s*:\s*\{/;
const UPDATE_CALL = /\.update\s*\(/;

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
 * 全 patterns が同一 ADJACENCY_WINDOW_LINES 行以内に共存するかをスライディングウィンドウで判定。
 * 同パターンの契約検知 (3 要素 / 直接書込 / 将来拡張) を 1 関数に集約し、コピペドリフトを防ぐ。
 */
function hasPatternsAdjacent(source: string, ...patterns: RegExp[]): boolean {
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

// #259: 直接書込パターン (`summary: { ... }` object literal) を `.update(` 近傍で検知。
// 型定義 `interface Foo { summary: { text: string } }` などは update 呼び出しを伴わないため
// 誤検知しない。同一 ADJACENCY_WINDOW_LINES 内に両方が存在することを必須とする。
function hasDirectSummaryWriteInUpdate(source: string): boolean {
  return hasPatternsAdjacent(source, UPDATE_CALL, SUMMARY_DIRECT_WRITE_LITERAL);
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
      const source = readFileSync(absPath, 'utf-8');

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
      it('3 要素が同一 update() ブロック近接 (≤30 行) に共存する', () => {
        expect(hasThreeElementsAdjacent(source)).to.equal(
          true,
          '3 要素が散在している。同一 update() で書き込まれていない可能性あり (#178 違反)'
        );
      });
    });
  }

  describe('caller 追加検知 (noUnused contract)', () => {
    // 新しく `documents/{id}.summary` を update する箇所ができた場合の検知手段として、
    // summary 書込パターン (buildSummaryFields 経由 OR 直接 object literal 書込) を
    // 持つファイルが WRITE_PAYLOAD_CALLERS 以外にないか確認。
    // 既知の caller が increase すれば本テストの expected が更新必要 = 意図的な変更検知。
    // #259: `buildSummaryFields` を経由しない直接書込 anti-pattern も OR 集合で検知する。
    it('summary 書込 caller 数が期待値と一致する', () => {
      const walk = (dir: string): string[] =>
        readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) return walk(full);
          if (entry.isFile() && entry.name.endsWith('.ts')) return [full];
          return [];
        });
      const srcRoot = resolve(process.cwd(), 'src');
      const tsFiles = walk(srcRoot);
      const callers = tsFiles.filter((f) => {
        const s = readFileSync(f, 'utf-8');
        return BUILD_SUMMARY_FIELDS_CALL.test(s) || hasDirectSummaryWriteInUpdate(s);
      });
      expect(callers).to.have.lengthOf(
        WRITE_PAYLOAD_CALLERS.length,
        `summary 書込 caller が想定外。現在の caller: ${callers.join(', ')}`
      );
    });
  });

  // #259 follow-up: 検知ロジック自体の単体テスト。fixture 文字列で正常系/異常系を網羅。
  // 本ロジックは contract 全体の信頼性の核なので、grep-based テストの限界
  // (false negative 発生時に sinon spy へ昇格) を意識して挙動を固定化する。
  describe('hasDirectSummaryWriteInUpdate detection logic (#259)', () => {
    it('positive: `.update({ summary: { ... } })` 直接書込を検知する', () => {
      const fixture = `
        await ref.update({
          summary: { text: 'foo', truncated: false },
          updatedAt: now,
        });
      `;
      expect(hasDirectSummaryWriteInUpdate(fixture)).to.equal(true);
    });

    it('positive: Transaction 形式 `tx.update(docRef, { summary: { ... } })` も検知する', () => {
      const fixture = `
        tx.update(docRef, {
          summary: { text: 'bar', truncated: true, originalLength: 100 },
        });
      `;
      expect(hasDirectSummaryWriteInUpdate(fixture)).to.equal(true);
    });

    it('negative: summary 書込のない update は false', () => {
      const fixture = `
        await ref.update({
          status: 'completed',
          updatedAt: now,
        });
      `;
      expect(hasDirectSummaryWriteInUpdate(fixture)).to.equal(false);
    });

    it('negative: 型定義 `interface Foo { summary: { text } }` は update 外で false', () => {
      const fixture = `
        interface Foo {
          summary: { text: string; truncated: boolean };
        }
      `;
      expect(hasDirectSummaryWriteInUpdate(fixture)).to.equal(false);
    });

    // word boundary `\b` で suffix 一致誤検知を排除する不変条件を lock-in。
    // この境界が外れると `commentSummary: {` / `errorSummary: {` 等を持つ無関係ファイルが
    // 誤って caller として計上され、契約テストが沈黙誤検知する。
    it('negative: `commentSummary: { ... }` は word boundary により update 内でも false', () => {
      const fixture = `
        await ref.update({
          commentSummary: { text: 'foo' },
          errorSummary: { code: 1 },
        });
      `;
      expect(hasDirectSummaryWriteInUpdate(fixture)).to.equal(false);
    });
  });
});
