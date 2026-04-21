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

  it('seconds=0 (epoch 1970-01-01) を有効な日付として扱う (#346)', () => {
    // 旧仕様では `!ts.seconds` で silent null だったが、0 は有効な Timestamp 値。
    // UTC epoch をローカル TZ 解釈するため、正規表現でフォーマットのみ検証する。
    const ts = { seconds: 0, nanoseconds: 0 };
    const result = timestampToDateString(ts);
    expect(result).to.match(/^\d{4}\/\d{2}\/\d{2}$/);
  });

  it('seconds が undefined の場合は undefined を返す (#346)', () => {
    // `typeof ts.seconds !== 'number'` guard の lock-in。
    const ts = { nanoseconds: 0 } as unknown as { seconds: number; nanoseconds: number };
    expect(timestampToDateString(ts)).to.be.undefined;
  });

  it('seconds が string の場合は undefined を返す (#346)', () => {
    const ts = { seconds: '1773619200', nanoseconds: 0 } as unknown as { seconds: number; nanoseconds: number };
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
