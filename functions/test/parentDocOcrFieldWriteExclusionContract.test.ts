/**
 * documents/{docId} 本体への値書込みから ocrResult/pageResults を除外する契約
 * (ADR-0018 Phase E, Issue #547)
 *
 * Phase Eで本体からこれら2フィールドを削除しても、新規処理・再処理のたびに本体へ
 * 再度書き込まれてしまうと egress 削減効果が維持できない(Codexセカンドオピニオンで
 * ocrProcessor.ts の dual-write 実装を指摘、impl-plan 段階で dual-write 停止(PR-E1)を
 * Phase Eスコープへ前倒し統合)。dual-write停止対象の書込み箇所について、本体書込み
 * ブロックに値としての ocrResult/pageResults キーが含まれないことをlock-inする。
 *
 * detail/mainへの書込みは対象外(そちらは値を書き続ける、変更なし)。`deleteField()`
 * による親クリア(getReprocessClearFields()等)も対象外 — 値の書込みではなく、Phase E
 * 完了前の親フォールバック防止策として維持する(Codexレビュー指摘、frontend側は
 * reprocessDetailClearContract.test.ts が別途lock-inする)。
 *
 * splitPdf(pdfOperations.ts)は splitPdfDetailDualWriteContract.test.ts でカバー済み。
 */

import { expect } from 'chai';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { extractBraceBlock } from './helpers/extractBraceBlock';

function readSource(relativePath: string): string {
  const path = resolve(__dirname, '..', relativePath);
  if (!existsSync(path)) {
    throw new Error(`Source file not found: ${relativePath}`);
  }
  return readFileSync(path, 'utf-8');
}

describe('本体documents書込みからのocrResult/pageResults除外契約 (ADR-0018 Phase E)', () => {
  it('ocrUpdatePayloadBuilder.ts: OcrExtractionUpdateFields型はocrResult/pageResultsフィールドを持たない', () => {
    const source = readSource('src/ocr/ocrUpdatePayloadBuilder.ts');
    const block = extractBraceBlock(source, /export interface OcrExtractionUpdateFields \{/);
    expect(block, 'OcrExtractionUpdateFields block must be found').to.not.be.null;
    expect(block).to.not.match(/^\s*ocrResult:/m);
    expect(block).to.not.match(/^\s*pageResults:/m);
  });

  it('ocrUpdatePayloadBuilder.ts: OcrUpdatePayloadInputs型もocrResult/pageResultsを受け取らない (入力からも排除)', () => {
    const source = readSource('src/ocr/ocrUpdatePayloadBuilder.ts');
    const block = extractBraceBlock(source, /export interface OcrUpdatePayloadInputs \{/);
    expect(block, 'OcrUpdatePayloadInputs block must be found').to.not.be.null;
    expect(block).to.not.match(/^\s*savedOcrResult:/m);
    expect(block).to.not.match(/^\s*pageResults:/m);
  });

  it('checkGmailAttachments.ts: documents本体set()ブロックにocrResultキーが値として含まれない', () => {
    const source = readSource('src/gmail/checkGmailAttachments.ts');
    const block = extractBraceBlock(source, /transaction\.set\(docRef, \{/);
    expect(block, 'documents本体set block must be found').to.not.be.null;
    expect(block).to.not.match(/ocrResult:/);
  });

  it('uploadPdf.ts: documents本体set()ブロックにocrResultキーが値として含まれない', () => {
    const source = readSource('src/upload/uploadPdf.ts');
    const block = extractBraceBlock(source, /transaction\.set\(docRef, \{/);
    expect(block, 'documents本体set block must be found').to.not.be.null;
    expect(block).to.not.match(/ocrResult:/);
  });

  it('checkGmailAttachments.ts / uploadPdf.ts: detail/main側にはocrResultが引き続き初期化される (dual-write自体は継続)', () => {
    for (const relPath of ['src/gmail/checkGmailAttachments.ts', 'src/upload/uploadPdf.ts']) {
      const source = readSource(relPath);
      const block = extractBraceBlock(
        source,
        /transaction\.set\(docRef\.collection\('detail'\)\.doc\('main'\), \{/
      );
      expect(block, `${relPath}: detail/main set block must be found`).to.not.be.null;
      expect(block).to.match(/ocrResult:\s*''/);
    }
  });
});
