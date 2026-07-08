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

test('契約: 親docへの全tx.updateはocrExcerpt 1フィールドのみ (partial update安全性、CLAUDE.md MUST)', () => {
  const matches = [...source.matchAll(/tx\.update\(docRef,\s*\{([\s\S]*?)\}\);/g)];
  assert.ok(matches.length >= 1, 'tx.update(docRef, {...}) が最低1箇所見つかること');
  for (const match of matches) {
    // payload直下の `キー:` パターンを検査(ネストしたbuildOcrExcerpt呼出の引数行は
    // `typeof ...` で始まりキーパターンにマッチしない)
    const keys = [...match[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
    assert.deepEqual(
      keys,
      ['ocrExcerpt'],
      `親update payloadはocrExcerptのみであるべき (検出: ${JSON.stringify(keys)})`
    );
  }
});

test('契約: detail/mainへのtx.updateはstale是正の空文字化/deleteFieldのみ (detailへコンテンツを書き込まない)', () => {
  const matches = [...source.matchAll(/tx\.update\(detailRef,\s*\{([\s\S]*?)\}\);/g)];
  // 空振りvacuous-pass防止 (pr-test-analyzer指摘反映: マッチ0件だとfor文が一度も
  // 走らず契約が無言で消滅する。stale是正パスが存在する限り最低1箇所マッチすべき)
  assert.ok(matches.length >= 1, 'tx.update(detailRef, {...}) が最低1箇所見つかること');
  for (const match of matches) {
    // detail側へのupdateは「ocrResultの空文字化(C1不変条件維持)」と
    // 「pageResultsのFieldValue.delete()」のみを許可
    // (実コンテンツの書込はtx.create経由のbuildDetailPayloadに限定される)
    const lines = match[1].split('\n').filter((l) => l.trim().length > 0);
    for (const line of lines) {
      assert.match(
        line,
        /^\s*(ocrResult:\s*'',?|pageResults:\s*admin\.firestore\.FieldValue\.delete\(\),?)\s*$/,
        `detail updateは ocrResult:'' または pageResults:deleteField のみ許可 (検出行: ${line.trim()})`
      );
    }
  }
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
  // ++/+=/bracket-access加算の全形態を検査 (pr-test-analyzer指摘反映: ++のみだと
  // `counters.x += 1` や `counters[key]++` への書き換えで契約をすり抜ける)
  assert.doesNotMatch(
    txMatch[1],
    /counters(\.\w+|\[)[^;\n]*(\+\+|\+=)/,
    'トランザクションコールバック内でカウンタを加算してはならない(リトライ再実行で二重加算)'
  );
});

test('契約: 対象プロジェクトはdev/kanameone/cocoroの3環境に限定', () => {
  assert.match(
    source,
    /ALLOWED_PROJECT_IDS = \['doc-split-dev', 'docsplit-kanameone', 'docsplit-cocoro'\]/
  );
});
