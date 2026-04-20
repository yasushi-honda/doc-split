/**
 * textCap assertAggregatePageInvariant の prod observability 格上げ契約テスト (Issue #288 item 6)
 *
 * 目的: prod で silent early return だった invariant 検証を safeLogError emit に格上げした
 * 変更 (#288 item 6) の回帰を静的検証で防止する。
 *
 * 背景: 既存 (#284) の assertAggregatePageInvariant は prod で early return していたため、
 * Firestore 旧データ由来の discriminated union 違反 (#209 型) が silent に伝播する経路が
 * 残っていた (PR #290 silent-failure-hunter S1 CRITICAL)。
 *
 * 方式: grep-based (docs/context/test-strategy.md §2.1 参照)。prod 分岐内の safeLogError 呼出と
 * params (source: 'ocr', functionName: 'capPageResultsAggregate') の存在を静的検証する。
 * 将来委譲: Phase 3 (#288 item 1) で動的 safeLogError invocation test と二段で lock-in 予定。
 */

import { expect } from 'chai';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { extractBraceBlock, extractParenBlock } from './helpers/extractBraceBlock';

const TEXT_CAP_PATH = 'src/utils/textCap.ts';

const ASSERT_BODY_ANCHOR =
  /function\s+assertAggregatePageInvariant\s*\([^)]*\)\s*:\s*void\s*\{/;
const HELPER_BODY_ANCHOR =
  /function\s+handleAggregateInvariantViolation\s*\([^)]*\)\s*:\s*void\s*\{/;
const PROD_BRANCH_ANCHOR =
  /if\s*\(\s*process\.env\.NODE_ENV\s*===\s*['"]production['"]\s*\)\s*\{/;
const SAFE_LOG_ERROR_CALL = /\bsafeLogError\s*\(/;

const extractAssertFunctionBody = (source: string) =>
  extractBraceBlock(source, ASSERT_BODY_ANCHOR);
const extractHelperFunctionBody = (source: string) =>
  extractBraceBlock(source, HELPER_BODY_ANCHOR);
const extractProdBranch = (block: string) =>
  extractBraceBlock(block, PROD_BRANCH_ANCHOR);
const extractSafeLogErrorArgs = (block: string) =>
  extractParenBlock(block, SAFE_LOG_ERROR_CALL);

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
    // anchor 消失で prodBranch が空文字のまま to.not.match(...) が silent PASS する経路を防ぐ。
    expect(prodBranch, 'prod 分岐が抽出できない — anchor 消失 (#311 review C1 対応)').to.not.equal(
      '',
    );
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
