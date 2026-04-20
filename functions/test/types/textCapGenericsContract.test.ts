/**
 * capPageResultsAggregate の generics 型契約テスト (Issue #294)
 *
 * 目的: `<T extends SummaryField>` 制約と戻り値型 `CappedAggregatePage<T>[]` の型レベル契約を
 * lock-in する (narrow 型 T を渡しても戻り値の SummaryField 部は union に広がり、caller は
 * narrowing なしで originalLength にアクセスできない)。
 *
 * 背景: #284 の `as T` cast 排除で戻り値を SummaryField フル union に戻す設計に変更した
 * 不変条件を型レベルで lock-in する。
 *
 * 方式: `@ts-expect-error` 型契約 test (docs/context/test-strategy.md §2.2 参照)。
 *
 * 将来委譲: 現時点で委譲先なし (#284 cast 排除後の generics 制約保護は型レベル保護が本質
 *          のため恒久 contract として保持)
 */

import { expect } from 'chai';
import { capPageResultsAggregate, type CappedAggregatePage } from '../../src/utils/textCap';
import type { SummaryField } from '../../../shared/types';

describe('capPageResultsAggregate generics 型契約 (#294)', () => {
  it('narrow 型 T (truncated=true 固定 + meta) を受け入れる (<T extends SummaryField> 制約)', () => {
    type NarrowTruncatedPage = {
      text: string;
      truncated: true;
      originalLength: number;
      pageNumber: number;
    };
    const pages: NarrowTruncatedPage[] = [
      { text: 'short', truncated: true, originalLength: 1_000, pageNumber: 1 },
    ];
    const result = capPageResultsAggregate(pages);
    expect(result).to.have.length(1);
    expect(result[0]?.pageNumber).to.equal(1);
  });

  it('戻り値の truncated は boolean union — narrow なしで originalLength 参照は禁止', () => {
    type NarrowPage = {
      text: string;
      truncated: true;
      originalLength: number;
      pageNumber: number;
    };
    const pages: NarrowPage[] = [
      { text: 'short', truncated: true, originalLength: 1_000, pageNumber: 1 },
    ];
    const result: CappedAggregatePage<NarrowPage>[] = capPageResultsAggregate(pages);
    const first = result[0];
    if (!first) throw new Error('unreachable');

    // narrow しない参照は discriminated union で tsc エラーになる契約。
    // 戻り値は {pageNumber} & SummaryField = (truncated:false なら originalLength なし) union。
    // @ts-expect-error: SummaryField union member に truncated=false variant があり、narrow 前の originalLength access は禁止
    void first.originalLength;

    // narrow 後は OK (truncated=true branch でのみ originalLength が型上存在)。
    if (first.truncated) {
      expect(first.originalLength).to.be.a('number');
    }
  });

  it('SummaryField 型への truncated=false + originalLength 代入は tsc エラー (#258 #264 不変条件)', () => {
    // SummaryField discriminated union は truncated=false なら originalLength キー自体が
    // 型に存在してはならない。Firestore 旧データ由来の混入を as unknown as なしで代入できない契約。
    const invalid: SummaryField = {
      text: 'short',
      truncated: false,
      // @ts-expect-error: truncated=false variant に originalLength キーは型として禁止
      originalLength: 999,
    };
    expect(invalid.text).to.equal('short');
  });

  it('narrow=false input では originalLength を含めない', () => {
    type NarrowFalsePage = {
      text: string;
      truncated: false;
      pageNumber: number;
    };
    const pages: NarrowFalsePage[] = [
      { text: 'short', truncated: false, pageNumber: 1 },
    ];
    const result = capPageResultsAggregate(pages);
    const first = result[0];
    if (!first) throw new Error('unreachable');

    // 戻り値 truncated は boolean union なので、false variant narrow では originalLength キーなし。
    if (!first.truncated) {
      expect(Object.prototype.hasOwnProperty.call(first, 'originalLength')).to.be.false;
    }
  });

  it('CappedAggregatePage<T> は T の meta を保持し SummaryField フル union に戻る', () => {
    type PageWithMeta = {
      text: string;
      truncated: false;
      pageNumber: number;
      inputTokens: number;
    };
    const pages: PageWithMeta[] = [
      { text: 'a', truncated: false, pageNumber: 1, inputTokens: 100 },
    ];
    const result: CappedAggregatePage<PageWithMeta>[] = capPageResultsAggregate(pages);
    const first = result[0];
    if (!first) throw new Error('unreachable');
    // meta (pageNumber, inputTokens) は Omit から除外されず保持される。
    expect(first.pageNumber).to.equal(1);
    expect(first.inputTokens).to.equal(100);
    // SummaryField 部は boolean union として戻り値に現れる。
    expect(typeof first.truncated).to.equal('boolean');
  });
});
