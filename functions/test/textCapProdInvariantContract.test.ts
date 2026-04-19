/**
 * textCap assertAggregatePageInvariant の prod observability 格上げ契約テスト (Issue #288 item 6)
 *
 * 目的: prod で silent early return だった invariant 検証を safeLogError emit に格上げした
 * 変更 (#288 item 6) の回帰を grep-based で防止する。
 *
 * 背景 (#288 item 6 / PR #290 silent-failure-hunter S1 CRITICAL):
 * 既存 (#284) の assertAggregatePageInvariant は `process.env.NODE_ENV === 'production'` で
 * early return していたため、Firestore 旧データ由来の discriminated union 違反 (#209 型)
 * が prod で silent に伝播する経路が残っていた。本契約は prod 分岐で safeLogError を
 * 経由して errors collection に記録する shape を lock-in する。
 *
 * 方式選定:
 * assertAggregatePageInvariant 関数本体を brace-nesting で抽出し、production 分岐内の
 * safeLogError 呼出と params (source: 'ocr', functionName: 'capPageResultsAggregate') を
 * 静的検証する。Phase 1 (#276) / #283 (aggregateCapLogErrorContract.test.ts) と同一手法。
 *
 * Phase 3 (Issue #288 item 1) で動的 safeLogError invocation test を追加し、本 grep 契約を
 * runtime 挙動と二段で lock-in する予定。現時点では admin.firestore() top-level 依存のため
 * unit test 環境から safeLogError を runtime 実行するのが不適 (buildPageResult 設計方針参照)。
 */

import { expect } from 'chai';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const TEXT_CAP_PATH = 'src/utils/textCap.ts';

/**
 * assertAggregatePageInvariant 関数本体 (function 宣言直後の `{...}`) を抽出する。
 * anchor 消失/リネーム時は空文字を返し、caller 側で明示失敗させる。
 */
function extractAssertFunctionBody(source: string): string {
  const ANCHOR = /function\s+assertAggregatePageInvariant\s*\([^)]*\)\s*:\s*void\s*\{/;
  const match = source.match(ANCHOR);
  if (!match || match.index === undefined) return '';

  const openBraceIdx = source.indexOf('{', match.index);
  if (openBraceIdx === -1) return '';

  let depth = 0;
  for (let i = openBraceIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(openBraceIdx, i + 1);
      }
    }
  }
  return '';
}

/**
 * handleAggregateInvariantViolation helper 関数本体を抽出する (#288 item 6 で導入)。
 * 実装で helper 分離した場合、prod 分岐はこちらに移る。存在しない場合は空文字を返す。
 */
function extractHelperFunctionBody(source: string): string {
  const ANCHOR = /function\s+handleAggregateInvariantViolation\s*\([^)]*\)\s*:\s*void\s*\{/;
  const match = source.match(ANCHOR);
  if (!match || match.index === undefined) return '';

  const openBraceIdx = source.indexOf('{', match.index);
  if (openBraceIdx === -1) return '';

  let depth = 0;
  for (let i = openBraceIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(openBraceIdx, i + 1);
      }
    }
  }
  return '';
}

/**
 * prod 分岐ブロック (`if (process.env.NODE_ENV === 'production') { ... }`) を抽出。
 * ==='production' と !== 'production' の両形を許容する前方一致。
 */
function extractProdBranch(block: string): string {
  const ANCHOR = /if\s*\(\s*process\.env\.NODE_ENV\s*===\s*['"]production['"]\s*\)\s*\{/;
  const match = block.match(ANCHOR);
  if (!match || match.index === undefined) return '';

  const openBraceIdx = block.indexOf('{', match.index);
  if (openBraceIdx === -1) return '';

  let depth = 0;
  for (let i = openBraceIdx; i < block.length; i++) {
    const ch = block[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return block.slice(openBraceIdx, i + 1);
      }
    }
  }
  return '';
}

/**
 * safeLogError 呼出の引数ブロック (括弧内) を抽出。
 * aggregateCapLogErrorContract.test.ts の同名 helper と同一仕様。
 */
function extractSafeLogErrorArgs(block: string): string {
  const match = block.match(/\bsafeLogError\s*\(/);
  if (!match || match.index === undefined) return '';

  const openParenIdx = block.indexOf('(', match.index);
  if (openParenIdx === -1) return '';

  let depth = 0;
  for (let i = openParenIdx; i < block.length; i++) {
    const ch = block[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        return block.slice(openParenIdx, i + 1);
      }
    }
  }
  return '';
}

describe('textCap prod invariant observability contract (#288 item 6)', () => {
  let source = '';

  before(() => {
    const absPath = resolve(process.cwd(), TEXT_CAP_PATH);
    expect(existsSync(absPath), `${TEXT_CAP_PATH} が見つからない`).to.be.true;
    source = readFileSync(absPath, 'utf-8');
  });

  it('assertAggregatePageInvariant 関数定義が存在する (anchor 保護)', () => {
    const body = extractAssertFunctionBody(source);
    expect(body, 'assertAggregatePageInvariant 関数の anchor が消失 — リネームなら本契約更新').to
      .not.equal('');
  });

  it('prod 分岐 (process.env.NODE_ENV === "production") が存在する', () => {
    // helper 分離の場合は helper 本体、未分離なら assert 本体を探索。
    const assertBody = extractAssertFunctionBody(source);
    const helperBody = extractHelperFunctionBody(source);
    const searchScope = helperBody || assertBody;
    const prodBranch = extractProdBranch(searchScope);
    expect(prodBranch, 'prod 分岐が検出されない — silent return に回帰している可能性').to.not.equal(
      '',
    );
  });

  it('prod 分岐内に safeLogError 呼出が存在する', () => {
    const assertBody = extractAssertFunctionBody(source);
    const helperBody = extractHelperFunctionBody(source);
    const searchScope = helperBody || assertBody;
    const prodBranch = extractProdBranch(searchScope);
    expect(prodBranch).to.match(
      /\bsafeLogError\s*\(/,
      'prod 分岐内に safeLogError 呼出が見つからない — silent 回帰',
    );
  });

  it('prod 分岐の safeLogError 引数に source: "ocr" が含まれる', () => {
    const assertBody = extractAssertFunctionBody(source);
    const helperBody = extractHelperFunctionBody(source);
    const searchScope = helperBody || assertBody;
    const prodBranch = extractProdBranch(searchScope);
    const args = extractSafeLogErrorArgs(prodBranch);
    expect(args, 'safeLogError 引数ブロックが抽出できない').to.not.equal('');
    expect(args).to.match(/source\s*:\s*['"]ocr['"]/);
  });

  it('prod 分岐の safeLogError 引数に functionName: "capPageResultsAggregate" が含まれる', () => {
    const assertBody = extractAssertFunctionBody(source);
    const helperBody = extractHelperFunctionBody(source);
    const searchScope = helperBody || assertBody;
    const prodBranch = extractProdBranch(searchScope);
    const args = extractSafeLogErrorArgs(prodBranch);
    expect(args).to.match(/functionName\s*:\s*['"]capPageResultsAggregate['"]/);
  });

  it('prod 分岐内で throw が発生しない (throw 文がない)', () => {
    const assertBody = extractAssertFunctionBody(source);
    const helperBody = extractHelperFunctionBody(source);
    const searchScope = helperBody || assertBody;
    const prodBranch = extractProdBranch(searchScope);
    expect(prodBranch).to.not.match(
      /\bthrow\s+(?:new\s+)?Error\b/,
      'prod 分岐に throw が残存 — fire-and-forget 方針に違反',
    );
  });

  it('dev 経路では throw が維持されている (assert 本体 or helper 本体に throw が存在)', () => {
    const assertBody = extractAssertFunctionBody(source);
    const helperBody = extractHelperFunctionBody(source);
    const combined = `${assertBody}\n${helperBody}`;
    expect(combined).to.match(
      /\bthrow\s+new\s+Error\b/,
      'dev throw が消滅 — 既存 #284 契約が壊れている',
    );
  });

  // Codex second opinion (MED): helper が残ったまま assert が silent return に回帰する
  // パターンを検知するため、assert 本体からの helper 呼出を grep で lock-in。
  it('assertAggregatePageInvariant 本体から handleAggregateInvariantViolation が呼ばれる', () => {
    const assertBody = extractAssertFunctionBody(source);
    expect(assertBody).to.match(
      /\bhandleAggregateInvariantViolation\s*\(/,
      'assert 本体から helper 呼出が消失 — silent return 回帰の可能性',
    );
  });

  // silent-failure-hunter S2 + Codex MED: errors collection triage のため documentId 伝搬を
  // lock-in。context?.documentId または documentId キー自体の存在を検証する。
  it('prod 分岐の safeLogError 引数に documentId が含まれる (triage 伝搬)', () => {
    const assertBody = extractAssertFunctionBody(source);
    const helperBody = extractHelperFunctionBody(source);
    const searchScope = helperBody || assertBody;
    const prodBranch = extractProdBranch(searchScope);
    const args = extractSafeLogErrorArgs(prodBranch);
    expect(args).to.match(
      /\bdocumentId\b/,
      'safeLogError 引数に documentId が含まれない — 違反 document の特定不可',
    );
  });
});
