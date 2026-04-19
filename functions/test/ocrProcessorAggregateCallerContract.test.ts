/**
 * ocrProcessor aggregate caller try/catch + pendingLogs drain 契約テスト
 * (Issue #293 + #297 統合対応)
 *
 * 目的: processDocument 内 capPageResultsAggregate 呼出周辺に:
 *   1. try/catch で dev invariant throw を捕捉 → safeLogError で errors collection 記録
 *   2. pendingInvariantLogs array を渡して fire-and-forget を廃止 (#297)
 *   3. `await Promise.allSettled(pendingInvariantLogs)` による flush 保証
 * を追加した設計を grep-based で lock-in する。
 *
 * 方式選定:
 * ocrProcessor.ts のソース全体から capPageResultsAggregate 呼出周辺ブロック
 * (try { ... } catch { ... } ... Promise.allSettled) を抽出し、必須要素の存在を
 * grep で検証する。
 *
 * 動的 runtime test による caller throw 捕捉挙動の verify は Issue #299 で追加予定。
 */

import { expect } from 'chai';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const OCR_PROCESSOR_PATH = 'src/ocr/ocrProcessor.ts';

describe('ocrProcessor aggregate caller wrapper contract (#293 + #297)', () => {
  let source = '';

  before(() => {
    const absPath = resolve(process.cwd(), OCR_PROCESSOR_PATH);
    expect(existsSync(absPath), `${OCR_PROCESSOR_PATH} が見つからない`).to.be.true;
    source = readFileSync(absPath, 'utf-8');
  });

  it('pendingInvariantLogs: Promise<void>[] の宣言が存在する (#297)', () => {
    // caller 側で pendingLogs array を生成して textCap に渡す起点。
    // 変数名が変わった場合はリネームに応じて本契約を更新すること。
    expect(source).to.match(
      /const\s+pendingInvariantLogs\s*:\s*Promise\s*<\s*void\s*>\s*\[\s*\]\s*=\s*\[\s*\]/,
      'pendingInvariantLogs 配列の宣言が見つからない — #297 drain 経路が欠損',
    );
  });

  it('capPageResultsAggregate 呼出が try ブロック内にある (#293)', () => {
    // `try { ... capPageResultsAggregate(...) ... }` の形を検証。
    // try/catch を剥がして plain call に回帰した場合に fail させる。
    expect(source).to.match(
      /try\s*\{[\s\S]*?capPageResultsAggregate\s*\([\s\S]*?\}\s*catch\s*\(/,
      'capPageResultsAggregate 呼出が try/catch に包まれていない — dev throw 捕捉が欠損',
    );
  });

  it('capPageResultsAggregate 呼出時に pendingLogs を渡している (#297)', () => {
    // `capPageResultsAggregate(..., { ..., pendingLogs: pendingInvariantLogs })` 形を検証。
    expect(source).to.match(
      /capPageResultsAggregate\s*\([\s\S]*?pendingLogs\s*:\s*pendingInvariantLogs/,
      'capPageResultsAggregate 呼出で pendingLogs が渡されていない — fire-and-forget に回帰',
    );
  });

  it('catch ブロック内に safeLogError 呼出が存在する (#293 errors collection 記録)', () => {
    // try/catch 直後の catch ブロック本体を抽出して内部の safeLogError を検証。
    const TRY_ANCHOR = /try\s*\{[\s\S]*?capPageResultsAggregate\s*\([\s\S]*?\}\s*catch\s*\(\s*\w+\s*\)\s*\{/;
    const match = source.match(TRY_ANCHOR);
    expect(match, 'try/catch ブロックの anchor が抽出できない').to.not.be.null;

    if (!match || match.index === undefined) return;
    const catchOpenIdx = source.indexOf('{', match.index + match[0].length - 1);
    if (catchOpenIdx === -1) return;

    let depth = 0;
    let catchEnd = -1;
    for (let i = catchOpenIdx; i < source.length; i++) {
      const ch = source[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          catchEnd = i + 1;
          break;
        }
      }
    }
    expect(catchEnd, 'catch ブロック終端が検出できない').to.be.greaterThan(catchOpenIdx);
    const catchBlock = source.slice(catchOpenIdx, catchEnd);
    expect(catchBlock).to.match(
      /\bsafeLogError\s*\(/,
      'catch 内で safeLogError 呼出が見つからない — dev throw が silent に失われる',
    );
    expect(catchBlock).to.match(
      /source\s*:\s*['"]ocr['"]/,
      'catch 内 safeLogError に source: "ocr" が含まれない',
    );
    // 命名規則: 既存 `:aggregateCap` (正常系 truncation summary) と区別する `:aggregateCap:invariant` suffix。
    expect(catchBlock).to.match(
      /functionName\s*:[\s\S]*?aggregateCap:invariant/,
      'catch 内 safeLogError の functionName が :aggregateCap:invariant suffix を含まない — 正常系と区別不能',
    );
    expect(catchBlock).to.match(
      /documentId\s*:\s*docId/,
      'catch 内 safeLogError に documentId: docId が含まれない — triage 不能',
    );
  });

  it('try/catch 直後に await Promise.allSettled(pendingInvariantLogs) が存在する (#297 flush)', () => {
    // drain 欠損で fire-and-forget 回帰を防ぐ。変数名が変わった場合は pendingInvariantLogs
    // のリネームに追従すること。
    expect(source).to.match(
      /await\s+Promise\.allSettled\s*\(\s*pendingInvariantLogs\s*\)/,
      'await Promise.allSettled(pendingInvariantLogs) が見つからない — drain 欠損',
    );
  });
});
