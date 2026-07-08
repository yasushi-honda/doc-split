/**
 * ocrProcessor.ts の detail/main dual-write 配線契約テスト (ADR-0018 Phase B, Issue #547)
 *
 * `db.runTransaction` 内で本体update + `detail/main` set が単一transactionにまとまって
 * いること、および `ocrExcerpt` の算出・書込配線をソース文字列レベルでlock-inする
 * (docs/context/test-strategy.md §2.1 のgrep-based契約パターン踏襲、
 * ocrProcessorConfirmedFieldWiringContract.test.ts が同種の前例)。
 *
 * 原子性(ADR MUST)の検証観点: 本体update/detail set が同一 `db.runTransaction(...)` の
 * コールバック内にあること(2回の独立書込ではないこと)を anchor 位置の前後関係で確認する。
 */

import { expect } from 'chai';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { extractBraceBlock } from './helpers/extractBraceBlock';

describe('ocrProcessor detail/main dual-write contract (ADR-0018 Phase B)', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/ocr/ocrProcessor.ts'),
    'utf-8'
  );

  it('ocrExcerptは共有ヘルパーbuildOcrExcerpt経由で算出される (Phase C backfillと同一実装の保証)', () => {
    // Phase C (Issue #547) でインライン実装を ocrExcerpt.ts へ抽出。placeholder文言・
    // 200字切詰めの振る舞い自体は ocrExcerpt.test.ts が unit test でlock-inし、
    // 本契約は「本番書込パスが必ず共有ヘルパーを通る」配線のみを保証する
    // (backfillスクリプトが同ヘルパーをimportすることで算出式の乖離を構造的に防ぐ)。
    expect(source).to.match(/import \{ buildOcrExcerpt \} from '\.\/ocrExcerpt'/);
    expect(source).to.match(/const ocrExcerpt = buildOcrExcerpt\(ocrResult,\s*ocrResultUrl\)/);
  });

  it('tx.update(docRef, ...) のペイロードに ocrExcerpt が含まれる', () => {
    const txUpdateBlock = extractBraceBlock(
      source,
      /tx\.update\(docRef,\s*/,
      { anchorMode: 'after-match' }
    );
    expect(txUpdateBlock, 'tx.update(docRef, ...) block must be found').to.not
      .be.null;
    expect(txUpdateBlock).to.match(/\bocrExcerpt\s*,/);
  });

  it('tx.set(docRef.collection(\'detail\').doc(\'main\'), ...) が存在し ocrResult/pageResults を含む', () => {
    const detailSetBlock = extractBraceBlock(
      source,
      /tx\.set\(\s*docRef\.collection\('detail'\)\.doc\('main'\),\s*/,
      { anchorMode: 'after-match' }
    );
    expect(detailSetBlock, 'detail/main tx.set(...) block must be found').to
      .not.be.null;
    expect(detailSetBlock).to.match(/ocrResult:\s*savedOcrResult/);
    expect(detailSetBlock).to.match(/\bpageResults\s*,/);
  });

  it('detail/main への tx.set は db.runTransaction コールバック内 (本体updateと同一transaction) にある', () => {
    const txStartIdx = source.indexOf('await db.runTransaction(async (tx) => {');
    const detailSetIdx = source.indexOf(
      "tx.set(docRef.collection('detail').doc('main'),"
    );
    const txEndIdx = source.indexOf('});', detailSetIdx);
    expect(txStartIdx).to.be.greaterThan(-1);
    expect(detailSetIdx).to.be.greaterThan(txStartIdx);
    expect(txEndIdx).to.be.greaterThan(detailSetIdx);
  });
});
