/**
 * ocrExcerpt.ts: buildOcrExcerpt テスト (Issue #547 ADR-0018 Phase C)
 *
 * 本ヘルパーは ocrProcessor.ts (本番書込) と backfill スクリプト (Phase C) と
 * parity 検証 (--verify) の3者で共有される。算出式が変わると backfill 済み既存doc と
 * 新規doc の ocrExcerpt に乖離が生じ、検証フェーズで偽の不一致が発生するため、
 * 契約として振る舞いを lock-in する。
 */

import { expect } from 'chai';
import {
  buildOcrExcerpt,
  OCR_EXCERPT_MAX_LENGTH,
  OCR_EXCERPT_OFFLOADED_PLACEHOLDER,
} from '../src/ocr/ocrExcerpt';

describe('ocrExcerpt: buildOcrExcerpt (Issue #547 Phase C)', () => {
  it('通常のOCR結果は先頭200字を返す', () => {
    const long = 'あ'.repeat(500);
    const result = buildOcrExcerpt(long, null);
    expect(result).to.equal('あ'.repeat(OCR_EXCERPT_MAX_LENGTH));
    expect(result.length).to.equal(200);
  });

  it('200字以下のOCR結果はそのまま返す', () => {
    expect(buildOcrExcerpt('短いテキスト', null)).to.equal('短いテキスト');
  });

  it('空文字列は空文字列を返す', () => {
    expect(buildOcrExcerpt('', null)).to.equal('');
  });

  it('ちょうど200字は全文を返す(境界値)', () => {
    const exact = 'x'.repeat(200);
    expect(buildOcrExcerpt(exact, null)).to.equal(exact);
  });

  it('201字は200字に切り詰める(境界値+1)', () => {
    const over = 'x'.repeat(201);
    expect(buildOcrExcerpt(over, null)).to.have.lengthOf(200);
  });

  it('Storage offload済み(ocrResultUrlセット)はplaceholder文言を返す', () => {
    const result = buildOcrExcerpt('', 'gs://bucket/ocr-results/doc123.txt');
    expect(result).to.equal(OCR_EXCERPT_OFFLOADED_PLACEHOLDER);
    expect(result).to.equal('（OCR結果はCloud Storageに保存されています）');
  });

  it('ocrResultUrlがセットされていればocrResultの内容は無視される', () => {
    expect(buildOcrExcerpt('本文あり', 'gs://bucket/x.txt')).to.equal(
      OCR_EXCERPT_OFFLOADED_PLACEHOLDER
    );
  });

  it('ocrResultUrlがundefined/nullの場合は通常の抜粋動作(既存docのフィールド不在互換)', () => {
    expect(buildOcrExcerpt('テキスト', undefined)).to.equal('テキスト');
    expect(buildOcrExcerpt('テキスト', null)).to.equal('テキスト');
  });

  it('ocrResultUrlが空文字列の場合は通常の抜粋動作(falsy扱い、ocrProcessor従来挙動と同一)', () => {
    expect(buildOcrExcerpt('テキスト', '')).to.equal('テキスト');
  });
});
