/**
 * splitPdf の detail/main dual-write + segments 上限249 契約テスト
 * (ADR-0018 Phase B〜E, Issue #547)
 *
 * batch内訳が child(本体+detail/main) set × 2N + parent update × 1 = 2N+1 ≤ 500 と
 * なるよう、上限が249であること、および子docごとの detail/main batch.set 配線を
 * ソース文字列レベルでlock-inする(splitPdfPayloadContract.test.ts と同形式)。
 *
 * Phase E (dual-write停止): item.payload は親batch.setとdetail batch.setの両方の
 * ソースとして共有されているため、親には ocrResult/pageResults を除いた parentPayload
 * を書く。detail batch.set は元の item.payload から値を取る(変更なし)。
 */

import { expect } from 'chai';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { extractBraceBlock } from './helpers/extractBraceBlock';

const SOURCE_PATH = 'src/pdf/pdfOperations.ts';

let sourceText = '';

describe('splitPdf detail/main dual-write contract (ADR-0018 Phase B)', () => {
  before(() => {
    const path = resolve(__dirname, '..', SOURCE_PATH);
    if (!existsSync(path)) {
      throw new Error(`Source file not found: ${SOURCE_PATH}`);
    }
    sourceText = readFileSync(path, 'utf-8');
  });

  it('segments.length 上限は249 (2N+1<=500、child set + detail/main set の2書込)', () => {
    expect(sourceText).to.match(/if \(segments\.length > 249\) \{/);
    expect(sourceText).to.match(
      /segments\.length=\$\{segments\.length\} exceeds Firestore batch write limit \(max 249/
    );
  });

  it('旧上限499の判定は残存しない (回帰防止)', () => {
    expect(sourceText).to.not.match(/segments\.length > 499/);
  });

  it('batch内で子docごとに detail/main へ batch.set し ocrResult/pageResults をミラーする', () => {
    const loopBlock = extractBraceBlock(
      sourceText,
      /for \(const item of accumulated\) \{/,
      { anchorMode: 'from-start' }
    );
    expect(loopBlock, 'accumulated batch.set loop block must be found').to.not
      .be.null;
    expect(loopBlock).to.match(/batch\.set\(item\.newDocRef,\s*parentPayload\)/);
    expect(loopBlock).to.match(
      /batch\.set\(\s*item\.newDocRef\.collection\('detail'\)\.doc\('main'\),/
    );
    expect(loopBlock).to.match(/ocrResult:\s*item\.payload\.ocrResult/);
    expect(loopBlock).to.match(/pageResults:\s*item\.payload\.pageResults/);
  });

  it('Phase E: 親batch.setにはocrResult/pageResultsを含まないparentPayloadを使う(値as-is漏れ防止)', () => {
    const loopBlock = extractBraceBlock(
      sourceText,
      /for \(const item of accumulated\) \{/,
      { anchorMode: 'from-start' }
    );
    expect(loopBlock, 'accumulated batch.set loop block must be found').to.not
      .be.null;
    expect(loopBlock).to.match(/const parentPayload = \{ \.\.\.item\.payload \};/);
    expect(loopBlock).to.match(/delete parentPayload\.ocrResult;/);
    expect(loopBlock).to.match(/delete parentPayload\.pageResults;/);
  });

  it('detail/main への batch.set は親 docRef.update と同一 batch (T4) 内にある', () => {
    const loopIdx = sourceText.indexOf('for (const item of accumulated) {');
    const detailSetIdx = sourceText.indexOf(
      "batch.set(item.newDocRef.collection('detail').doc('main'),"
    );
    const parentUpdateIdx = sourceText.indexOf('batch.update(docRef, {');
    const commitIdx = sourceText.indexOf('await batch.commit();');
    expect(loopIdx).to.be.greaterThan(-1);
    expect(detailSetIdx, 'detail/main batch.set call site must be found').to
      .be.greaterThan(loopIdx);
    expect(parentUpdateIdx).to.be.greaterThan(detailSetIdx);
    expect(commitIdx).to.be.greaterThan(parentUpdateIdx);
  });
});
