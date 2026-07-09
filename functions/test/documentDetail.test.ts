/**
 * resolveDetailFields (ADR-0018 Phase D dual-read解決) の単体テスト
 */

import { expect } from 'chai';
import { resolveDetailFields } from '../src/ocr/documentDetail';

describe('resolveDetailFields (ADR-0018 Phase D)', () => {
  it('detail優先: detailに両フィールドがあれば親の値は使わない', () => {
    const r = resolveDetailFields(
      { ocrResult: 'detail-text', pageResults: [{ pageNumber: 1 }] },
      { ocrResult: 'parent-text', pageResults: [{ pageNumber: 99 }] }
    );
    expect(r.ocrResult).to.equal('detail-text');
    expect(r.pageResults).to.deep.equal([{ pageNumber: 1 }]);
  });

  it('親フォールバック: detail不在(undefined)なら親の値を使う', () => {
    const r = resolveDetailFields(undefined, {
      ocrResult: 'parent-text',
      pageResults: [{ pageNumber: 2 }],
    });
    expect(r.ocrResult).to.equal('parent-text');
    expect(r.pageResults).to.deep.equal([{ pageNumber: 2 }]);
  });

  it('フィールド単位フォールバック: FEクリア後(detail存在・フィールド不在)は親を参照', () => {
    // PR-D1 (#598) のreprocess-clearはdetailのocrResult/pageResultsをdeleteFieldで消す
    const r = resolveDetailFields({}, { ocrResult: 'parent-text', pageResults: [] });
    expect(r.ocrResult).to.equal('parent-text');
    expect(r.pageResults).to.deep.equal([]);
  });

  it("detailのocrResult=''は有効値(Storage offload済み): 親へフォールバックしない", () => {
    const r = resolveDetailFields(
      { ocrResult: '' },
      { ocrResult: 'stale-parent-text' }
    );
    expect(r.ocrResult).to.equal('');
  });

  it('両方欠落: フィールドはundefined(捏造しない)', () => {
    const r = resolveDetailFields(undefined, {});
    expect(r.ocrResult).to.be.undefined;
    expect(r.pageResults).to.be.undefined;
  });

  it('型不正(非string/非array)は採用せずフォールバック→両方不正ならundefined', () => {
    const r = resolveDetailFields(
      { ocrResult: 123, pageResults: 'not-array' },
      { ocrResult: null, pageResults: { bad: true } }
    );
    expect(r.ocrResult).to.be.undefined;
    expect(r.pageResults).to.be.undefined;
  });

  it('空配列のpageResultsは有効値: 親へフォールバックしない', () => {
    const r = resolveDetailFields(
      { pageResults: [] },
      { pageResults: [{ pageNumber: 1 }] }
    );
    expect(r.pageResults).to.deep.equal([]);
  });
});
