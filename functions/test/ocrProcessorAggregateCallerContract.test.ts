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
import { extractBraceBlock } from './helpers/extractBraceBlock';

const OCR_PROCESSOR_PATH = 'src/ocr/ocrProcessor.ts';

// 制御フロー近接性 lock-in (#302 codex Low 1): capPageResultsAggregate 呼出 → catch ブロックを
// 1 anchor で束ね、別所の catch ブロックや不整合な順序に回帰した場合に fail させる。
// anchor 末尾は `catch (e) ` で終わり、そこから startAfterAnchor で最初の `{` を拾う。
//
// 前提: ocrProcessor.ts 内で capPageResultsAggregate を参照する try/catch は 1 箇所のみ。
// 将来 2 つ目が追加された場合、source.match() は最初のマッチを返すため、本 anchor は
// 先行 try/catch を拾う。意図したブロックが検証されなくなる silent 誤検知リスクあり。
// 2 つ目が追加される時は本 anchor を processDocument 固有の文脈 (例: pendingInvariantLogs 宣言)
// 直後に narrow する必要がある。
const CAP_AGG_CATCH_ANCHOR =
  /try\s*\{[\s\S]*?capPageResultsAggregate\s*\([\s\S]*?\}\s*catch\s*\(\s*\w+\s*\)\s*/;

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
    // capPageResultsAggregate 呼出 → catch ブロックを 1 anchor で束ねて抽出する。
    // 別の catch ブロックや順序の回帰があれば anchor マッチ自体が失敗する (#302 codex Low 1)。
    const catchBlock = extractBraceBlock(source, CAP_AGG_CATCH_ANCHOR, {
      startAfterAnchor: true,
    });
    expect(catchBlock, 'capPageResultsAggregate 呼出直後の catch ブロックが抽出できない').to.not.equal(
      '',
    );
    expect(catchBlock).to.match(
      /\bsafeLogError\s*\(/,
      'catch 内で safeLogError 呼出が見つからない — dev throw が silent に失われる',
    );
    expect(catchBlock).to.match(
      /source\s*:\s*['"]ocr['"]/,
      'catch 内 safeLogError に source: "ocr" が含まれない',
    );
    // 命名規則: 既存 `:aggregateCap` (正常系 truncation summary) と区別する suffix。
    // 既知 invariant は `:aggregateCap:invariant`、予期外エラーは `:aggregateCap:unexpected` に分類。
    expect(catchBlock).to.match(
      /aggregateCap:invariant/,
      'catch 内 safeLogError の functionName に :aggregateCap:invariant suffix が現れない — 既知 invariant triage 不能',
    );
    expect(catchBlock).to.match(
      /aggregateCap:unexpected/,
      'catch 内 safeLogError の functionName に :aggregateCap:unexpected suffix が現れない — 予期外エラーが既知 invariant と混線',
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
