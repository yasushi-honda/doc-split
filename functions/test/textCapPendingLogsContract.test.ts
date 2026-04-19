/**
 * textCap handleAggregateInvariantViolation の pendingLogs drain 対応契約テスト
 * (Issue #297 + #293 統合対応)
 *
 * 目的: `void safeLogError(...)` fire-and-forget を `context.pendingLogs` array に push する
 * 形へ変更した回帰を grep-based で防止する。caller (ocrProcessor.ts) が
 * `await Promise.allSettled(pendingLogs)` で drain することで Cloud Functions handler
 * 終了前の flush を保証する設計を静的に lock-in する。
 *
 * 方式選定:
 * handleAggregateInvariantViolation 本体を brace-nesting で抽出し、production 分岐内で:
 *   1. safeLogError の戻り値を変数束縛 (fire-and-forget `void` 直叩きではない)
 *   2. context?.pendingLogs への push 呼出が存在
 *   3. pendingLogs 未渡し時の fallback (void logPromise or ?.push 形) で後方互換維持
 * を grep 検証する。
 *
 * 動的 safeLogError invocation test は Issue #299 で追加予定。
 */

import { expect } from 'chai';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const TEXT_CAP_PATH = 'src/utils/textCap.ts';

/**
 * handleAggregateInvariantViolation 関数本体 (`{...}`) を抽出する。
 * anchor 消失/リネーム時は空文字を返し、caller 側で明示失敗させる。
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

describe('textCap pendingLogs drain contract (#297 + #293)', () => {
  let source = '';

  before(() => {
    const absPath = resolve(process.cwd(), TEXT_CAP_PATH);
    expect(existsSync(absPath), `${TEXT_CAP_PATH} が見つからない`).to.be.true;
    source = readFileSync(absPath, 'utf-8');
  });

  it('AggregateInvariantContext に pendingLogs?: Promise<void>[] フィールドが存在する', () => {
    // signature 変更 regression 検知: fire-and-forget 廃止対応で必須のフィールド。
    expect(source).to.match(
      /pendingLogs\?\s*:\s*Promise\s*<\s*void\s*>\s*\[\s*\]/,
      'AggregateInvariantContext に pendingLogs?: Promise<void>[] が見つからない — #297 設計変更が消失',
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

  it('prod 分岐内で context?.pendingLogs への push 呼出が存在する', () => {
    const helperBody = extractHelperFunctionBody(source);
    const prodBranch = extractProdBranch(helperBody);
    expect(prodBranch).to.match(
      /context\?\.pendingLogs[\s\S]*?\.push\s*\(/,
      'context?.pendingLogs への push 呼出が見つからない — drain 経路が欠損',
    );
  });

  it('pendingLogs 未渡し時の fallback (void 形) が存在する (後方互換維持)', () => {
    const helperBody = extractHelperFunctionBody(source);
    const prodBranch = extractProdBranch(helperBody);
    // legacy caller (pendingLogs 未渡し) では intentionally fire-and-forget を維持する。
    // `void logPromise;` は完了保証ではなく「意図的に discard」を明示するマーカー。
    expect(prodBranch).to.match(
      /\bvoid\s+\w+\s*;?/,
      'pendingLogs 未渡し時の void fallback が見つからない — 後方互換が壊れている可能性',
    );
  });

  it('prod 分岐に直接 `void safeLogError(` 形が残っていない (regression guard)', () => {
    const helperBody = extractHelperFunctionBody(source);
    const prodBranch = extractProdBranch(helperBody);
    expect(prodBranch).to.not.match(
      /\bvoid\s+safeLogError\s*\(/,
      'void safeLogError( 直叩きが残存 — fire-and-forget 回帰、#297 対応が崩れている',
    );
  });
});
