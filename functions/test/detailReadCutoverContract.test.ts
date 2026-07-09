/**
 * Functions 読者の detail/main 切替 配線契約テスト (ADR-0018 Phase D PR-D2, Issue #547)
 *
 * ocrProcessorDetailDualWriteContract.test.ts と同じ grep-based 契約パターン。
 * 「4読者すべてが resolveDetailFields (detail優先+親フォールバック) 経由で
 * ocrResult/pageResults を読み、paired-read は readDocWithDetail (read-only
 * transaction) に統一されている」配線をソース文字列レベルで lock-in する。
 *
 * 1読者でも切替が漏れると、Phase E (親からの実フィールド削除) 後にその読者が
 * 空データを受け取り、silent な機能停止 (分割候補0件/要約不可/再利用不成立) が起きる。
 */

import { expect } from 'chai';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf-8');

const documentDetailSrc = read('src/ocr/documentDetail.ts');
const getOcrTextSrc = read('src/ocr/getOcrText.ts');
const regenerateSummarySrc = read('src/ocr/regenerateSummary.ts');
const ocrProcessorSrc = read('src/ocr/ocrProcessor.ts');
const pdfOperationsSrc = read('src/pdf/pdfOperations.ts');

describe('detail/main 読者切替 配線契約 (ADR-0018 Phase D PR-D2)', () => {
  it('readDocWithDetail: read-only transaction の tx.getAll で親+detailを同一スナップショット読みする', () => {
    // 非トランザクション db.getAll() は複数doc間のスナップショット一貫性を公式保証しない
    // (code-review 4/5系統の独立指摘)。paired-read は必ず readOnly transaction 経由
    expect(documentDetailSrc).to.match(/db\.runTransaction\(/);
    expect(documentDetailSrc).to.match(/tx\.getAll\(docRef, detailRef/);
    expect(documentDetailSrc).to.match(/\{ readOnly: true \}/);
  });

  it('detail 読取パスの pin: サブコレクション/doc ID の typo は親フォールバックが Phase E まで隠蔽するため文字列レベルで固定 (pr-test-analyzer Critical反映)', () => {
    // write 側契約 (ocrProcessorDetailDualWriteContract) と同じパス pin を read 側にも張る。
    // パスがズレても detail 読取は undefined → 親フォールバックで全環境正常動作し、
    // Phase E (親フィールド削除) の瞬間に silent 一斉停止する — この誤配線を merge 前に落とす
    expect(documentDetailSrc).to.match(/docRef\.collection\('detail'\)\.doc\('main'\)/);
    expect(ocrProcessorSrc).to.match(/documents\/\$\{docId\}\/detail\/main/);
  });

  it('getOcrText: readDocWithDetail + fieldMask(重量フィールド転送抑止) + resolveDetailFields (ADR #5)', () => {
    expect(getOcrTextSrc).to.match(
      /readDocWithDetail\(db, docRef, \[\s*'ocrResult',\s*'ocrResultUrl',\s*\]\)/
    );
    expect(getOcrTextSrc).to.match(/resolveDetailFields\(detailSnap\.data\(\), data\)/);
  });

  it('regenerateSummary: readDocWithDetail + fieldMask + resolveDetailFields (ADR #6)', () => {
    expect(regenerateSummarySrc).to.match(
      /readDocWithDetail\(db, docRef, \[\s*'ocrResult',\s*'documentType',\s*\]\)/
    );
    expect(regenerateSummarySrc).to.match(/resolveDetailFields\(detailSnap\.data\(\), docData\)/);
  });

  it('ocrProcessor: detail read は parentDocumentId ゲート付き + fieldMask + detail優先解決 (ADR #1)', () => {
    // 非分割doc(大多数)に重量 detail read と新規失敗点を持ち込まないゲート
    expect(ocrProcessorSrc).to.match(
      /if \(typeof docData\.parentDocumentId === 'string' && docData\.parentDocumentId\) \{/
    );
    expect(ocrProcessorSrc).to.match(/fieldMask: \['pageResults'\]/);
    expect(ocrProcessorSrc).to.match(
      /const existingPageResults: RawPageOcrResult\[\] \| undefined = resolveDetailFields\(/
    );
    // 旧経路 (docData.pageResults 直読み) が reuse 判定に残っていないこと
    expect(ocrProcessorSrc).to.not.match(/const existingPageResults = docData\.pageResults/);
  });

  it('pdfOperations: detectSplitPoints / splitPdf とも readDocWithDetail + resolveSplitPageInputs (ADR #2,#3)', () => {
    const pairedReadCount = [...pdfOperationsSrc.matchAll(/readDocWithDetail\(db, docRef\)/g)]
      .length;
    expect(pairedReadCount, 'detectSplitPoints と splitPdf の2箇所').to.equal(2);
    const resolveCount = [...pdfOperationsSrc.matchAll(/resolveSplitPageInputs\(detailSnapshot\.data\(\), docData\)/g)]
      .length;
    expect(resolveCount, '両読者とも共通アクセサで解決').to.equal(2);
    // 旧経路 (docData.pageResults 直読み) が残っていないこと
    expect(pdfOperationsSrc).to.not.match(/docData\.pageResults/);
  });

  it('Phase E 前提ゲート(部分): 本PRの4読者ソースに親 ocrResult/pageResults の直読みが残っていない', () => {
    // getOcrText/regenerateSummary の親 ocrResult 直読み(`data.ocrResult` / `docData.ocrResult`)が
    // resolveDetailFields 経由に置き換わっていること。
    // (ocrResultUrl は Phase E 後も親に残る offload ポインタのため対象外)
    expect(getOcrTextSrc).to.not.match(/data\.ocrResult as string/);
    expect(regenerateSummarySrc).to.not.match(/docData\.ocrResult as string/);
  });

  it('非トランザクション db.getAll の paired-read が読者に存在しない (snapshot一貫性の偽装防止)', () => {
    // 単一refの db.getAll(fieldMask付き) は許可(ocrProcessor のゲート付きdetail read)。
    // 親+detail の2ref同時 db.getAll は snapshot 保証がないため禁止
    for (const src of [getOcrTextSrc, regenerateSummarySrc, ocrProcessorSrc, pdfOperationsSrc]) {
      expect(src).to.not.match(/db\.getAll\(docRef, detailRef\)/);
    }
  });
});
