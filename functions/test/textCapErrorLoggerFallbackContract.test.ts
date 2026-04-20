/**
 * textCap handleAggregateInvariantViolation の errorLogger require 失敗時 fallback 契約テスト
 * (Issue #303、PR #301 silent-failure-hunter HIGH #2 follow-up)
 *
 * 目的: `require('./errorLogger')` が失敗した場合でも errors collection に最低 1 レコード
 * 記録される fallback 経路を静的に lock-in する。bundler/esbuild config 変更や admin.firestore()
 * 初期化 race で dynamic require が壊れた場合、従来実装では console.error のみで observability
 * から消失する silent path が残存していた (#288 item 6 効果の相殺)。
 *
 * 方式: grep-based (docs/context/test-strategy.md §2.1 参照)。handleAggregateInvariantViolation
 * の catch (loadErr) ブロックを抽出し、以下 4 要素を検証:
 *   (1) admin.firestore() 直接呼出による fallback 書込
 *   (2) errors collection への add 呼出
 *   (3) 書込失敗時の silent swallow (二重失敗時にプロセス継続)
 *   (4) 既存 console.error の保持 (fallback 失敗時の最低限ログ)
 *
 * 将来委譲: 動的 invocation test (bundler mock で require 失敗を模擬して fallback 書込を verify)
 * は Issue #299 の runtime test 整備で追加予定。
 */

import { expect } from 'chai';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { extractBraceBlock } from './helpers/extractBraceBlock';

const TEXT_CAP_PATH = 'src/utils/textCap.ts';

const HELPER_BODY_ANCHOR =
  /function\s+handleAggregateInvariantViolation\s*\([^)]*\)\s*:\s*void\s*\{/;
// catch (loadErr) { ... } ブロック anchor。catch 引数名は loadErr に固定 (既存実装整合)。
const LOADERR_CATCH_ANCHOR = /catch\s*\(\s*loadErr\s*\)\s*/;

const extractHelperFunctionBody = (source: string) =>
  extractBraceBlock(source, HELPER_BODY_ANCHOR);
const extractLoadErrCatch = (block: string) =>
  extractBraceBlock(block, LOADERR_CATCH_ANCHOR, { startAfterAnchor: true });

describe('textCap errorLogger require failure fallback contract (#303)', () => {
  let source = '';

  before(() => {
    const absPath = resolve(process.cwd(), TEXT_CAP_PATH);
    expect(existsSync(absPath), `${TEXT_CAP_PATH} が見つからない`).to.be.true;
    source = readFileSync(absPath, 'utf-8');
  });

  it('handleAggregateInvariantViolation の catch (loadErr) ブロックが抽出できる (anchor 保護)', () => {
    const helperBody = extractHelperFunctionBody(source);
    expect(helperBody, 'handleAggregateInvariantViolation 関数本体が抽出できない').to.not.equal('');
    const catchBlock = extractLoadErrCatch(helperBody);
    expect(catchBlock, 'catch (loadErr) ブロックが抽出できない — anchor 消失').to.not.equal('');
  });

  it('既存 console.error による fallback 失敗時の最低限ログが保持されている (AC-11)', () => {
    const helperBody = extractHelperFunctionBody(source);
    const catchBlock = extractLoadErrCatch(helperBody);
    expect(catchBlock, 'catch (loadErr) ブロックが抽出できない').to.not.equal('');
    // console.error の消失で silent 化する regression を防ぐ。fallback 成否に関わらず最低限の
    // ローカルログは残す (rules/error-handling.md §1: 最低限のconsole.error はtry-catch外で先に実行)。
    expect(catchBlock).to.match(
      /console\.error\s*\(/,
      'catch (loadErr) 内の console.error が消失 — fallback 失敗時の最低限ログが残らない',
    );
  });

  it('catch (loadErr) 内で admin.firestore() が呼ばれている (fallback 書込経路)', () => {
    const helperBody = extractHelperFunctionBody(source);
    const catchBlock = extractLoadErrCatch(helperBody);
    expect(catchBlock, 'catch (loadErr) ブロックが抽出できない').to.not.equal('');
    // `require('firebase-admin')` から admin.firestore() を呼ぶパターンを検出。
    // require 呼出経由 + 直接 import どちらのパターンでも `admin.firestore()` 形でマッチする想定。
    expect(catchBlock).to.match(
      /admin\.firestore\s*\(\s*\)/,
      'catch (loadErr) 内で admin.firestore() 呼出が見つからない — fallback 書込経路が欠損',
    );
  });

  it('catch (loadErr) 内で errors collection への add 呼出がある (errors 書込先)', () => {
    const helperBody = extractHelperFunctionBody(source);
    const catchBlock = extractLoadErrCatch(helperBody);
    expect(catchBlock, 'catch (loadErr) ブロックが抽出できない').to.not.equal('');
    // `.collection('errors')` + `.add(` の両方を同一ブロック内で検証。
    // collection 名 drift (例: `error_logs` 等) への回帰を防ぐ。
    expect(catchBlock).to.match(
      /\.collection\s*\(\s*['"]errors['"]\s*\)/,
      'catch (loadErr) 内で errors collection への書込先が特定されていない',
    );
    expect(catchBlock).to.match(
      /\.add\s*\(/,
      'catch (loadErr) 内で .add( 呼出が見つからない — errors collection への書込が欠損',
    );
  });

  it('catch (loadErr) 内で fallback 書込失敗時の silent swallow パターンが存在する (AC-7)', () => {
    const helperBody = extractHelperFunctionBody(source);
    const catchBlock = extractLoadErrCatch(helperBody);
    expect(catchBlock, 'catch (loadErr) ブロックが抽出できない').to.not.equal('');
    // 二重失敗時のプロセス継続保証:
    //   Pattern A: `.add({...}).catch(...)` で add Promise の reject を silent swallow
    //   Pattern B: `try { admin.firestore()...add() } catch { ... }` で synchronous require 失敗
    //              含めて ブロック全体を try/catch で囲む
    // どちらかのパターンが存在すれば AC-7 を満たす。
    const hasPromiseCatch = /\.add\s*\([\s\S]*?\)\s*\.catch\s*\(/.test(catchBlock);
    const hasNestedTryCatch = /try\s*\{[\s\S]*?admin\.firestore[\s\S]*?\}\s*catch/.test(catchBlock);
    expect(
      hasPromiseCatch || hasNestedTryCatch,
      'fallback 書込の silent swallow パターンが見つからない — 二重失敗時にプロセスが throw する可能性',
    ).to.be.true;
  });
});
