/**
 * scripts/ の documents 本体書込みから ocrResult/pageResults を除外する契約
 * (ADR-0018 Phase E, Issue #547)
 *
 * Phase Eで本体からこれら2フィールドを削除しても、seedデータ投入や履歴インポートの
 * たびに本体へ再度書き込まれてしまうと egress 削減効果が維持できない
 * (functions/test/parentDocOcrFieldWriteExclusionContract.test.ts と同じ趣旨の
 * scripts版)。dual-write停止(PR-E1)対象の書込み箇所2つについて、本体書込みブロックに
 * 値としての ocrResult キーが含まれないことをlock-inする。
 *
 * detail/mainへの書込みは対象外(そちらは値を書き続ける、変更なし)。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const scriptsDir = resolve(__dirname, '..');

const importHistoricalGmailSrc = readFileSync(
  resolve(scriptsDir, 'import-historical-gmail.js'),
  'utf-8'
);
const seedDevDataSrc = readFileSync(resolve(scriptsDir, 'seed-dev-data.ts'), 'utf-8');

/** anchor開始位置からanchor終了位置までの区間を切り出す(scriptsにはextractBraceBlock相当のヘルパーがないため簡易実装) */
function sliceBetween(source: string, startAnchor: string, endAnchor: string): string {
  const startIdx = source.indexOf(startAnchor);
  const endIdx = source.indexOf(endAnchor);
  assert.ok(startIdx !== -1, `startAnchor not found: ${startAnchor}`);
  assert.ok(endIdx !== -1, `endAnchor not found: ${endAnchor}`);
  assert.ok(endIdx > startIdx, `endAnchor must appear after startAnchor`);
  return source.slice(startIdx, endIdx);
}

test('import-historical-gmail.js: documents本体set()ブロックにocrResultキーが値として含まれない', () => {
  const block = sliceBetween(
    importHistoricalGmailSrc,
    "transaction.set(docRef, {",
    "transaction.set(docRef.collection('detail')"
  );
  assert.doesNotMatch(block, /ocrResult:/);
});

test('import-historical-gmail.js: detail/main側にはocrResultが引き続き初期化される (dual-write自体は継続)', () => {
  assert.match(
    importHistoricalGmailSrc,
    /transaction\.set\(docRef\.collection\('detail'\)\.doc\('main'\), \{\s*\n\s*ocrResult: ''/
  );
});

test('seed-dev-data.ts: 本体書込みはocrResultを除いたparentDataを使う (processed/error + pending の2箇所)', () => {
  const matches = seedDevDataSrc.match(/const \{ ocrResult, \.\.\.parentData \} = d\.data;/g);
  assert.notEqual(matches, null, 'ocrResult分離パターン(const { ocrResult, ...parentData } = d.data;)が見つかりません');
  assert.equal(
    matches!.length,
    2,
    'processed/error書類投入とpending書類投入の2箇所でocrResult分離パターンが必要です'
  );
});

test('seed-dev-data.ts: 本体への書込みに parentData を使い d.data を直接使わない (processed/error + pending)', () => {
  assert.match(seedDevDataSrc, /\{ ref, data: parentData \}/);
  assert.match(seedDevDataSrc, /pendingWrites\.push\(\{ ref, data: parentData \}\);/);
  assert.doesNotMatch(seedDevDataSrc, /\{ ref, data: d\.data \}/);
});
