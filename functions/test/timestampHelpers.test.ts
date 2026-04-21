/**
 * timestampHelpers (Firestore Timestamp 変換) の単体テスト。
 * backfill / 本番 pdfOperations 両系列で使うため backfillDisplayFileName から独立。
 */

import { expect } from 'chai';
import { timestampToDateString } from '../src/utils/timestampHelpers';

describe('timestampToDateString', () => {
  it('Timestampオブジェクト（seconds/nanoseconds）を YYYY/MM/DD 文字列に変換', () => {
    // 2026-03-16 00:00:00 UTC → ローカルTZで解釈
    const ts = { seconds: 1773619200, nanoseconds: 0 };
    const result = timestampToDateString(ts);
    // UTCで2026-03-16。ローカルTZにより日付が変わりうるため、フォーマットのみ検証
    expect(result).to.match(/^\d{4}\/\d{2}\/\d{2}$/);
  });

  it('null の場合は undefined を返す', () => {
    expect(timestampToDateString(null)).to.be.undefined;
  });

  it('undefined の場合は undefined を返す', () => {
    expect(timestampToDateString(undefined)).to.be.undefined;
  });

  it('seconds が 0 の場合は undefined を返す（無効な日付）', () => {
    const ts = { seconds: 0, nanoseconds: 0 };
    expect(timestampToDateString(ts)).to.be.undefined;
  });

  it('toDate メソッドを持つ Timestamp インスタンスも変換可能', () => {
    // 2026-01-15 00:00:00 UTC（TZずれなし確認用に15日を使用）
    const ts = {
      seconds: 1768435200,
      nanoseconds: 0,
      toDate: () => new Date(1768435200 * 1000),
    };
    expect(timestampToDateString(ts)).to.equal('2026/01/15');
  });
});
