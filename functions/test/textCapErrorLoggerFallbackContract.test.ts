/**
 * textCap handleAggregateInvariantViolation の errorLogger require 失敗時 fallback 契約テスト
 * (Issue #303、PR #301 silent-failure-hunter HIGH #2 follow-up、PR #319 review 追加強化)
 *
 * 目的: `require('./errorLogger')` が失敗した場合でも errors collection に最低 1 レコード
 * 記録される fallback 経路と、fallback 自体の失敗観測性を静的に lock-in する。bundler/esbuild
 * config 変更や admin.firestore() 初期化 race で dynamic require が壊れた場合、従来実装では
 * console.error のみで observability から消失する silent path が残存していた (#288 item 6 効果の
 * 相殺)。PR #319 review では fallback 内 `.catch(() => {})` による write 失敗の silent 消失
 * (silent-failure-hunter C1) と fire-and-forget による Cloud Functions freeze 時の partial delivery
 * リスク (I2) が指摘され、write reject 時の console.error surface と drainSink push 対称化で解消済。
 *
 * 方式: grep-based (docs/context/test-strategy.md §2.1 参照)。handleAggregateInvariantViolation
 * の catch (loadErr) ブロックを抽出し、以下 6 観点を検証:
 *   (1) loader 失敗時の console.error 先行ログ (rules/error-handling.md §1)
 *   (2) admin.firestore() 直接呼出による fallback 書込経路 (+ errors collection への add 呼出)
 *   (3) write reject 時の .catch((writeErr) => console.error(...)) による失敗 surface (C1)
 *   (4) 外側 catch(fallbackSetupErr) の console.error による setup 失敗の triage 可能化 (I1)
 *   (5) fallback record の schema triage 必須 field (severity/category/status/errorCode 等)
 *   (6) drainSink への write Promise push による主経路との対称化 (I2)
 *   (7) loaderError 構造化 (String(loadErr) 直接代入で [object Object] 情報欠損する regression 防止)
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
const LOADERR_CATCH_ANCHOR = /catch\s*\(\s*loadErr\s*\)\s*/;

// #312: helper が anchor/null 入力を透過して null を返すため、alias wrapper は直接委譲する。
const extractHelperFunctionBody = (source: string): string | null =>
  extractBraceBlock(source, HELPER_BODY_ANCHOR);
const extractLoadErrCatch = (block: string | null): string | null =>
  extractBraceBlock(block, LOADERR_CATCH_ANCHOR, { anchorMode: 'after-match' });

describe('textCap errorLogger require failure fallback contract (#303 + #319 review)', () => {
  let source = '';

  before(() => {
    const absPath = resolve(process.cwd(), TEXT_CAP_PATH);
    expect(existsSync(absPath), `${TEXT_CAP_PATH} が見つからない`).to.be.true;
    source = readFileSync(absPath, 'utf-8');
  });

  it('handleAggregateInvariantViolation の catch (loadErr) ブロックが抽出できる (anchor 保護)', () => {
    const helperBody = extractHelperFunctionBody(source);
    expect(helperBody, 'handleAggregateInvariantViolation 関数本体が抽出できない').to.not.be.null;
    const catchBlock = extractLoadErrCatch(helperBody);
    expect(catchBlock, 'catch (loadErr) ブロックが抽出できない — anchor 消失').to.not.be.null;
  });

  it('loader 失敗時の先行 console.error が保持される (AC-11, rules/error-handling.md §1)', () => {
    const helperBody = extractHelperFunctionBody(source);
    const catchBlock = extractLoadErrCatch(helperBody);
    expect(catchBlock, 'catch (loadErr) ブロックが抽出できない').to.not.be.null;
    // Cloud Logging alert grep 契約: `[textCap] failed to load errorLogger` prefix を lock-in。
    // prefix drift (例: 英語化、モジュール名変更) は operational alert を壊すため regression 検知。
    expect(catchBlock!).to.match(
      /console\.error\s*\(\s*['"]\[textCap\]\s+failed\s+to\s+load\s+errorLogger/,
      'catch (loadErr) 冒頭の先行 console.error が消失 or prefix drift — Cloud Logging alert が壊れる',
    );
  });

  it('catch (loadErr) 内で admin.firestore() が呼ばれている (fallback 書込経路)', () => {
    const helperBody = extractHelperFunctionBody(source);
    const catchBlock = extractLoadErrCatch(helperBody);
    expect(catchBlock, 'catch (loadErr) ブロックが抽出できない').to.not.be.null;
    expect(catchBlock!).to.match(
      /admin\.firestore\s*\(\s*\)/,
      'catch (loadErr) 内で admin.firestore() 呼出が見つからない — fallback 書込経路が欠損',
    );
  });

  it('catch (loadErr) 内で errors collection への add 呼出がある (errors 書込先)', () => {
    const helperBody = extractHelperFunctionBody(source);
    const catchBlock = extractLoadErrCatch(helperBody);
    expect(catchBlock, 'catch (loadErr) ブロックが抽出できない').to.not.be.null;
    expect(catchBlock!).to.match(
      /\.collection\s*\(\s*['"]errors['"]\s*\)/,
      'catch (loadErr) 内で errors collection への書込先が特定されていない',
    );
    expect(catchBlock!).to.match(
      /\.add\s*\(/,
      'catch (loadErr) 内で .add( 呼出が見つからない — errors collection への書込が欠損',
    );
  });

  it('write reject 時の .catch handler で console.error により失敗を surface (#319 review C1)', () => {
    const helperBody = extractHelperFunctionBody(source);
    const catchBlock = extractLoadErrCatch(helperBody);
    expect(catchBlock, 'catch (loadErr) ブロックが抽出できない').to.not.be.null;
    // `.catch(() => {})` による完全 silent swallow (PERMISSION_DENIED / RESOURCE_EXHAUSTED /
    // UNAVAILABLE / INVALID_ARGUMENT 等の operational signal が消失する regression) を防ぐ。
    // .add(...).catch の handler body 内に console.error が存在することを lock-in。
    const addCatchMatch = catchBlock!.match(
      /\.add\s*\([\s\S]*?\)[\s\S]*?\.catch\s*\(\s*(?:\([^)]*\)|[^=]+)\s*=>\s*\{([\s\S]*?)\}\s*\)/,
    );
    expect(
      addCatchMatch,
      '.add().catch() handler が抽出できない — Promise chain が壊れている可能性',
    ).to.not.be.null;
    const handlerBody = addCatchMatch![1];
    expect(handlerBody).to.match(
      /console\.error\s*\(/,
      '.add().catch() handler 内の console.error が消失 — write 失敗 (PERMISSION_DENIED 等) が silent 化',
    );
    // surface メッセージの prefix を lock-in (Cloud Logging alert grep の安定性)。
    expect(handlerBody).to.match(
      /\[textCap\]\s+fallback\s+errors-collection\s+write\s+also\s+failed/,
      'write 失敗 console.error の prefix が消失 or drift — loader 失敗との区別が効かない',
    );
  });

  it('外側 catch(fallbackSetupErr) で setup 失敗も console.error で surface (#319 review I1)', () => {
    const helperBody = extractHelperFunctionBody(source);
    const catchBlock = extractLoadErrCatch(helperBody);
    expect(catchBlock, 'catch (loadErr) ブロックが抽出できない').to.not.be.null;
    // 外側 try/catch: `try { admin.firestore()... } catch (fallbackSetupErr) { ... }`。
    // bare `catch {}` による silent swallow regression を防ぐ (require('firebase-admin') /
    // admin.firestore() / FieldValue 同期失敗の区別可能化)。
    const outerCatchMatch = catchBlock!.match(/\}\s*catch\s*\(\s*(\w+)\s*\)\s*\{([\s\S]*?)\}\s*$/);
    expect(outerCatchMatch, '外側 catch(...) block が抽出できない').to.not.be.null;
    expect(outerCatchMatch![1]).to.not.equal(
      '',
      '外側 catch に引数がない (bare catch{}) — setup 失敗が silent 化',
    );
    const outerBody = outerCatchMatch![2];
    expect(outerBody).to.match(
      /console\.error\s*\(/,
      '外側 catch(fallbackSetupErr) に console.error がない — admin load / firestore init 失敗が silent 化',
    );
    expect(outerBody).to.match(
      /\[textCap\]\s+fallback\s+setup\s+itself\s+failed/,
      '外側 catch の console.error prefix が消失 or drift — loader 失敗・write 失敗・setup 失敗の区別が壊れる',
    );
  });

  it('fallback record に triage 必須 field が含まれる (#319 review I2: schema lock-in)', () => {
    const helperBody = extractHelperFunctionBody(source);
    const catchBlock = extractLoadErrCatch(helperBody);
    expect(catchBlock, 'catch (loadErr) ブロックが抽出できない').to.not.be.null;
    // errors collection triage dashboard が集計に使う key field を lock-in。
    expect(catchBlock!).to.match(/status\s*:\s*['"]pending['"]/, 'status: pending 欠落 — triage queue invisible');
    expect(catchBlock!).to.match(/severity\s*:\s*['"]critical['"]/, 'severity: critical drift');
    expect(catchBlock!).to.match(/category\s*:\s*['"]fatal['"]/, 'category: fatal drift');
    expect(catchBlock!).to.match(/source\s*:\s*['"]ocr['"]/, 'source: ocr drift');
    expect(catchBlock!).to.match(
      /functionName\s*:\s*['"]capPageResultsAggregate:loaderFailed['"]/,
      'functionName suffix drift — triage filter 壊れ',
    );
    expect(catchBlock!).to.match(/errorCode\s*:\s*['"]LOADER_FAILED['"]/, 'errorCode drift');
    expect(catchBlock!).to.match(
      /documentId\s*:\s*context\?\.documentId\s*\?\?\s*null/,
      'documentId 正規化 `?? null` が消失 — undefined で Firestore 書込 reject or document 紐付け不可',
    );
  });

  it('loaderError が構造化され String(loadErr) 直接代入されていない (#319 review I3)', () => {
    const helperBody = extractHelperFunctionBody(source);
    const catchBlock = extractLoadErrCatch(helperBody);
    expect(catchBlock, 'catch (loadErr) ブロックが抽出できない').to.not.be.null;
    // String(loadErr) 直接代入は Error 以外の throw で `[object Object]` になる silent 情報欠損、
    // FirebaseAppError.code 等の triage 重要フィールド drop の原因となる。
    // instanceof Error ブランチで name/message/code を抽出する形へ regression しないよう lock-in。
    expect(catchBlock!).to.match(
      /loadErr\s+instanceof\s+Error/,
      'instanceof Error 分岐が消失 — String(loadErr) 直代入 regression で triage 情報欠損',
    );
    expect(catchBlock!).to.not.match(
      /loaderError\s*:\s*String\s*\(\s*loadErr\s*\)/,
      'loaderError: String(loadErr) 直代入に回帰 — [object Object] silent 情報欠損が再発',
    );
  });

  it('fallback write Promise が drainSink に push される (#319 review I2: 対称化)', () => {
    const helperBody = extractHelperFunctionBody(source);
    const catchBlock = extractLoadErrCatch(helperBody);
    expect(catchBlock, 'catch (loadErr) ブロックが抽出できない').to.not.be.null;
    // 主経路 (safeLogError) と対称に fallback も drainSink に push して drain 保証。
    // fire-and-forget 非対称性 (Cloud Functions freeze 時の partial delivery) に回帰しないよう lock-in。
    expect(catchBlock!).to.match(
      /context\?\.drainSink[\s\S]*?\.push\s*\(/,
      'fallback 内で drainSink.push() が消失 — fire-and-forget 非対称性に回帰 (Cloud Functions freeze 時 partial delivery リスク)',
    );
    // .then(() => undefined) で Promise<void> に正規化されていること (drainSink の型整合)。
    expect(catchBlock!).to.match(
      /\.then\s*\(\s*\(\s*\)\s*=>\s*undefined\s*\)/,
      '.then(() => undefined) による Promise<void> 正規化が消失 — drainSink 型整合が壊れる',
    );
  });
});
