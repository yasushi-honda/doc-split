/**
 * textCap handleAggregateInvariantViolation の drainSink 契約テスト
 * (Issue #297 + #293 統合対応、#304 naming refactor で `pendingLogs` → `drainSink`)
 *
 * 目的: `void safeLogError(...)` fire-and-forget を `context.drainSink` array に push する
 * 形へ変更した回帰を防止する。caller (ocrProcessor.ts) が `await Promise.allSettled(drainSink)`
 * で drain し、Cloud Functions handler 終了前の flush を保証する設計を静的に lock-in する。
 *
 * 方式: grep-based (docs/context/test-strategy.md §2.1 参照)。prod 分岐内で (1) 戻り値束縛,
 * (2) context?.drainSink.push, (3) 未渡し時の void fallback の 3 要素を検証。
 * 将来委譲: 動的 safeLogError invocation test は Issue #299 で追加予定。
 */

import { expect } from 'chai';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { extractBraceBlock } from './helpers/extractBraceBlock';

const TEXT_CAP_PATH = 'src/utils/textCap.ts';

const HELPER_BODY_ANCHOR =
  /function\s+handleAggregateInvariantViolation\s*\([^)]*\)\s*:\s*void\s*\{/;
const PROD_BRANCH_ANCHOR =
  /if\s*\(\s*process\.env\.NODE_ENV\s*===\s*['"]production['"]\s*\)\s*\{/;

const extractHelperFunctionBody = (source: string) =>
  extractBraceBlock(source, HELPER_BODY_ANCHOR);
const extractProdBranch = (block: string) =>
  extractBraceBlock(block, PROD_BRANCH_ANCHOR);

describe('textCap drainSink contract (#297 + #293, #304 rename)', () => {
  let source = '';

  before(() => {
    const absPath = resolve(process.cwd(), TEXT_CAP_PATH);
    expect(existsSync(absPath), `${TEXT_CAP_PATH} が見つからない`).to.be.true;
    source = readFileSync(absPath, 'utf-8');
  });

  it('AggregateInvariantContext に drainSink?: Promise<void>[] フィールドが存在する (#304)', () => {
    // signature 変更 regression 検知: fire-and-forget 廃止対応で必須のフィールド。
    // #304 naming: `pendingLogs` → `drainSink` へリネーム済。旧名に逆戻りしたら fail させる。
    expect(source).to.match(
      /drainSink\?\s*:\s*Promise\s*<\s*void\s*>\s*\[\s*\]/,
      'AggregateInvariantContext に drainSink?: Promise<void>[] が見つからない — #304 naming が消失',
    );
  });

  it('AggregateInvariantContext に旧 pendingLogs フィールドが存在しない (#304 rename regression guard)', () => {
    // #304 リネーム回帰防止: interface 定義ブロックを抽出し、そのブロック内に pendingLogs が
    // 残存していないことを検証する。JSDoc/コメント内の移行メモ (`pendingLogs` → `drainSink`) は
    // interface block の外側にあるため false positive にならない。
    const interfaceBlock = extractBraceBlock(
      source,
      /export\s+interface\s+AggregateInvariantContext\s*\{/,
    );
    expect(
      interfaceBlock,
      'AggregateInvariantContext interface block が抽出できない — anchor 消失',
    ).to.not.equal('');
    expect(interfaceBlock).to.not.match(
      /\bpendingLogs\b/,
      'AggregateInvariantContext に旧名 pendingLogs が残存 — #304 rename が不完全',
    );
  });

  it('prod 分岐内で safeLogError の戻り値が変数束縛されている (void 直叩きではない)', () => {
    const helperBody = extractHelperFunctionBody(source);
    const prodBranch = extractProdBranch(helperBody);
    expect(prodBranch, 'handleAggregateInvariantViolation の prod 分岐が抽出できない').to.not.equal(
      '',
    );
    // `const <var> = safeLogError(...)` または `let <var> = safeLogError(...)` の形を検査。
    // fire-and-forget 直書き `void safeLogError(` に regression した場合に fail させる。
    expect(prodBranch).to.match(
      /(?:const|let)\s+\w+\s*=\s*safeLogError\s*\(/,
      'safeLogError の戻り値が変数束縛されていない — fire-and-forget に回帰している可能性',
    );
  });

  it('prod 分岐内で context?.drainSink への push 呼出が存在する', () => {
    const helperBody = extractHelperFunctionBody(source);
    const prodBranch = extractProdBranch(helperBody);
    expect(prodBranch, 'prod 分岐が抽出できない — anchor 消失').to.not.equal('');
    expect(prodBranch).to.match(
      /context\?\.drainSink[\s\S]*?\.push\s*\(/,
      'context?.drainSink への push 呼出が見つからない — drain 経路が欠損',
    );
  });

  it('drainSink 未渡し時の fallback (void 形) が存在する (後方互換維持)', () => {
    const helperBody = extractHelperFunctionBody(source);
    const prodBranch = extractProdBranch(helperBody);
    expect(prodBranch, 'prod 分岐が抽出できない — anchor 消失').to.not.equal('');
    // legacy caller (drainSink 未渡し) では intentionally fire-and-forget を維持する。
    // `void logPromise;` は完了保証ではなく「意図的に discard」を明示するマーカー。
    expect(prodBranch).to.match(
      /\bvoid\s+\w+\s*;?/,
      'drainSink 未渡し時の void fallback が見つからない — 後方互換が壊れている可能性',
    );
  });

  it('prod 分岐に直接 `void safeLogError(` 形が残っていない (regression guard)', () => {
    const helperBody = extractHelperFunctionBody(source);
    const prodBranch = extractProdBranch(helperBody);
    // anchor 消失で prodBranch が空文字のまま to.not.match(...) が silent PASS する経路を防ぐ。
    expect(prodBranch, 'prod 分岐が抽出できない — anchor 消失 (#311 review C2 対応)').to.not.equal(
      '',
    );
    expect(prodBranch).to.not.match(
      /\bvoid\s+safeLogError\s*\(/,
      'void safeLogError( 直叩きが残存 — fire-and-forget 回帰、#297 対応が崩れている',
    );
  });
});
