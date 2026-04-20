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
 *
 * キャッシュ方針:
 * before() で assertBody / helperBody / prodBranch / safeLogErrorArgs を 1 回ずつ抽出し、
 * 各 it は cached 値を参照する。null passthrough は extractBraceBlock / extractParenBlock が
 * `null` 入力を素通しするため、各 it では必要に応じて `expect(cached).to.not.be.null` を
 * 先行し silent PASS を構造防御する (caller 規約 JSDoc 準拠)。
 */

import { expect } from 'chai';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { extractBraceBlock, extractParenBlock } from './helpers/extractBraceBlock';
import { SAFE_LOG_ERROR_CALL } from './helpers/patterns';

const TEXT_CAP_PATH = 'src/utils/textCap.ts';

const ASSERT_BODY_ANCHOR =
  /function\s+assertAggregatePageInvariant\s*\([^)]*\)\s*:\s*void\s*\{/;
const HELPER_BODY_ANCHOR =
  /function\s+handleAggregateInvariantViolation\s*\([^)]*\)\s*:\s*void\s*\{/;
const PROD_BRANCH_ANCHOR =
  /if\s*\(\s*process\.env\.NODE_ENV\s*===\s*['"]production['"]\s*\)\s*\{/;

describe('textCap prod invariant observability contract (#288 item 6)', () => {
  let cachedAssertBody: string | null = null;
  let cachedHelperBody: string | null = null;
  let cachedProdBranch: string | null = null;
  let cachedSafeLogErrorArgs: string | null = null;

  before(() => {
    const absPath = resolve(process.cwd(), TEXT_CAP_PATH);
    expect(existsSync(absPath), `${TEXT_CAP_PATH} が見つからない`).to.be.true;
    const source = readFileSync(absPath, 'utf-8');

    // 抽出キャッシュ。helper 分離の場合は helper 本体、未分離なら assert 本体を探索。
    cachedAssertBody = extractBraceBlock(source, ASSERT_BODY_ANCHOR);
    cachedHelperBody = extractBraceBlock(source, HELPER_BODY_ANCHOR);
    const searchScope = cachedHelperBody || cachedAssertBody;
    cachedProdBranch = extractBraceBlock(searchScope, PROD_BRANCH_ANCHOR);
    cachedSafeLogErrorArgs = extractParenBlock(cachedProdBranch, SAFE_LOG_ERROR_CALL);
  });

  it('assertAggregatePageInvariant 関数定義が存在する (anchor 保護)', () => {
    expect(
      cachedAssertBody,
      'assertAggregatePageInvariant 関数の anchor が消失 — リネームなら本契約更新',
    ).to.not.be.null;
  });

  it('prod 分岐 (process.env.NODE_ENV === "production") が存在する', () => {
    expect(
      cachedProdBranch,
      'prod 分岐が検出されない — silent return に回帰している可能性',
    ).to.not.be.null;
  });

  it('prod 分岐内に safeLogError 呼出が存在する', () => {
    expect(cachedProdBranch, 'prod 分岐が抽出できない — anchor 消失').to.not.be.null;
    expect(cachedProdBranch!).to.match(
      SAFE_LOG_ERROR_CALL,
      'prod 分岐内に safeLogError 呼出が見つからない — silent 回帰',
    );
  });

  it('prod 分岐の safeLogError 引数に source: "ocr" が含まれる', () => {
    expect(cachedSafeLogErrorArgs, 'safeLogError 引数ブロックが抽出できない').to.not.be.null;
    expect(cachedSafeLogErrorArgs!).to.match(/source\s*:\s*['"]ocr['"]/);
  });

  it('prod 分岐の safeLogError 引数に functionName: "capPageResultsAggregate" が含まれる', () => {
    expect(cachedSafeLogErrorArgs, 'safeLogError 引数ブロックが抽出できない').to.not.be.null;
    expect(cachedSafeLogErrorArgs!).to.match(/functionName\s*:\s*['"]capPageResultsAggregate['"]/);
  });

  it('prod 分岐内で throw が発生しない (throw 文がない)', () => {
    // anchor 消失で cachedProdBranch が null のまま to.not.match(...) が silent PASS する経路を防ぐ。
    expect(
      cachedProdBranch,
      'prod 分岐が抽出できない — anchor 消失 (#311 review C1 対応)',
    ).to.not.be.null;
    expect(cachedProdBranch!).to.not.match(
      /\bthrow\s+(?:new\s+)?Error\b/,
      'prod 分岐に throw が残存 — fire-and-forget 方針に違反',
    );
  });

  it('dev 経路では throw が維持されている (assert 本体 or helper 本体に throw が存在)', () => {
    // 両方 null (anchor 消失) の場合は assertion を silent に通過させないため、少なくとも一方は
    // 抽出できていることを先に担保する。null 連結で `"null"` 文字列が混入する false PASS 経路を防ぐ。
    expect(
      cachedAssertBody !== null || cachedHelperBody !== null,
      'assert/helper の両方が抽出できない — anchor 両方消失で throw 検証が silent PASS する',
    ).to.equal(true);
    const combined = `${cachedAssertBody ?? ''}\n${cachedHelperBody ?? ''}`;
    expect(combined).to.match(
      /\bthrow\s+new\s+Error\b/,
      'dev throw が消滅 — 既存 #284 契約が壊れている',
    );
  });

  // Codex second opinion (MED): helper が残ったまま assert が silent return に回帰する
  // パターンを検知するため、assert 本体からの helper 呼出を grep で lock-in。
  it('assertAggregatePageInvariant 本体から handleAggregateInvariantViolation が呼ばれる', () => {
    expect(cachedAssertBody, 'assert 本体が抽出できない — anchor 消失').to.not.be.null;
    expect(cachedAssertBody!).to.match(
      /\bhandleAggregateInvariantViolation\s*\(/,
      'assert 本体から helper 呼出が消失 — silent return 回帰の可能性',
    );
  });

  // silent-failure-hunter S2 + Codex MED: errors collection triage のため documentId 伝搬を
  // lock-in。context?.documentId または documentId キー自体の存在を検証する。
  it('prod 分岐の safeLogError 引数に documentId が含まれる (triage 伝搬)', () => {
    expect(cachedSafeLogErrorArgs, 'safeLogError 引数ブロックが抽出できない').to.not.be.null;
    expect(cachedSafeLogErrorArgs!).to.match(
      /\bdocumentId\b/,
      'safeLogError 引数に documentId が含まれない — 違反 document の特定不可',
    );
  });
});
