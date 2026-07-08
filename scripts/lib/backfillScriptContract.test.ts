/**
 * backfill-detail-subcollection.ts の配線契約テスト (Issue #547 ADR-0018 Phase C)
 *
 * functions/test/ocrProcessorDetailDualWriteContract.test.ts と同じ grep-based
 * 契約パターン。実行時I/Oを伴わずソース文字列レベルで安全条件を lock-in する。
 *
 * 特に「親docへのpartial updateがocrExcerpt 1フィールドのみ」は、グローバル
 * CLAUDE.md MUST『DBにPartial Updateする関数を追加/変更 → テストに「更新対象外
 * フィールドの値が変化しないこと」を含める』への対応 (review D4指摘反映)。
 * 将来 tx.update payload にフィールドが追加/typoで混入すると本テストが FAIL する。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../backfill-detail-subcollection.ts'), 'utf-8');

test('契約: 親docへのtx.updateはocrExcerpt 1フィールドのみ (partial update安全性、CLAUDE.md MUST)', () => {
  const match = source.match(/tx\.update\(docRef,\s*\{([\s\S]*?)\}\);/);
  assert.ok(match, 'tx.update(docRef, {...}) が見つかること');
  const payloadBody = match[1];
  // payload直下のキーがocrExcerptのみであること(ネストしたbuildOcrExcerpt呼出の引数は
  // 括弧内のため、トップレベルの `キー:` パターンで検査する)
  const topLevelKeys = payloadBody.match(/^\s{8}(\w+):/gm) ?? [];
  assert.deepEqual(
    topLevelKeys.map((k) => k.trim().replace(':', '')),
    ['ocrExcerpt'],
    `親update payloadはocrExcerptのみであるべき (検出: ${JSON.stringify(topLevelKeys)})`
  );
});

test('契約: detail/mainへの書込はtx.create (上書き不可能なAPI選択、並行dual-writeとの競合安全性)', () => {
  assert.match(source, /tx\.create\(detailRef,\s*buildDetailPayload\(data\)\)/);
  // tx.set(detailRef, ...) が存在しないこと(createなら既存docに対して失敗するが、
  // setだと並行再処理が作った新しいdetail/mainを古い親データで上書きしてしまう)
  assert.doesNotMatch(source, /tx\.set\(detailRef/);
});

test('契約: ocrExcerpt算出は本番と同一の共有ヘルパーbuildOcrExcerptをimportして使う', () => {
  assert.match(source, /import \{ buildOcrExcerpt \} from '\.\.\/functions\/src\/ocr\/ocrExcerpt'/);
  assert.match(source, /ocrExcerpt: buildOcrExcerpt\(/);
});

test('契約: カウンタ加算はrunTransactionコールバックの外で行う (リトライ時の二重加算防止、review A1)', () => {
  // トランザクションコールバック本体を抽出し、counters加算が含まれないことを確認
  const txMatch = source.match(/db\.runTransaction<BackfillOutcome>\(async \(tx\) => \{([\s\S]*?)\n    \}\);/);
  assert.ok(txMatch, 'db.runTransaction<BackfillOutcome> コールバックが見つかること');
  assert.doesNotMatch(
    txMatch[1],
    /counters\.\w+\+\+/,
    'トランザクションコールバック内でカウンタを加算してはならない(competitor再実行で二重加算)'
  );
});

test('契約: 対象プロジェクトはdev/kanameone/cocoroの3環境に限定', () => {
  assert.match(
    source,
    /ALLOWED_PROJECT_IDS = \['doc-split-dev', 'docsplit-kanameone', 'docsplit-cocoro'\]/
  );
});
