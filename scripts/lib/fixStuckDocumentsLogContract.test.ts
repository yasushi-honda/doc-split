/**
 * fix-stuck-documents.js のログ出力の契約テスト
 *
 * このスクリプトは GitHub Actions(run-ops-script.yml)経由で実行され、リポジトリは公開(PUBLIC)のため、
 * 標準出力はそのまま公開ログに残る。顧客の書類名(例: 要配慮個人情報にあたりうる書類名)を出力してはならない。
 * 実行時I/Oを伴わず、ソース文字列レベルで「書類名を出力しない」を固定する(backfillScriptContract.test.ts と同型)。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../fix-stuck-documents.js'), 'utf-8');

/** console.log/warn/error(...) の引数部分を、テンプレートリテラル内の入れ子も含めて抽出する。 */
function consoleCalls(src: string): string[] {
  return [...src.matchAll(/console\.(?:log|warn|error|info)\(([\s\S]*?)\);/g)].map((m) => m[1]);
}

test('契約: console出力にfileName(書類名)を含めない(公開Actionsログへの顧客情報漏えい防止)', () => {
  const calls = consoleCalls(source);
  assert.ok(calls.length >= 5, 'console出力が複数見つかること(空振りvacuous-pass防止)');
  for (const call of calls) {
    assert.ok(!/fileName/.test(call), `console出力にfileNameが含まれている: ${call.trim()}`);
  }
});

test('契約: 1件ごとのログは書類IDとステータスを出力する(対象の特定に必要な最小限)', () => {
  const resetDocBody = source.slice(source.indexOf('async function resetDoc'), source.indexOf('async function runSingle'));
  assert.match(resetDocBody, /console\.log\(`[^`]*\$\{docRef\.id\}[^`]*\$\{data\.status\}[^`]*`\)/);
});

test('契約: dataオブジェクト全体や他の識別情報(customerName等)をconsole出力しない', () => {
  for (const call of consoleCalls(source)) {
    assert.ok(!/customerName|officeName|careManager|JSON\.stringify\(data\)/.test(call), `不要な識別情報の出力: ${call.trim()}`);
    assert.ok(!/\$\{data\}/.test(call), `dataオブジェクト全体の出力: ${call.trim()}`);
  }
});
