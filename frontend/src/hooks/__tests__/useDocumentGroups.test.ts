/**
 * shouldIncludeInGroupDocuments 単体テスト
 *
 * fetchGroupDocuments()のクライアントサイドフィルタ述語を検証する。
 * 背景: careManager未設定書類のCM未設定グループ集計修正(functions/src/utils/
 * groupAggregation.tsのcanFallbackToUnassigned)により、集計対象がcustomerKey
 * 非空の書類に限定された。フロントエンドのグループ展開クエリが同じ条件を
 * 持たないと、表示件数とグループのcountバッジが食い違う不整合が発生する
 * （/codex review-diff指摘、PR #656で一度発生・修正済み）。
 */

import { describe, it, expect } from 'vitest';
import { shouldIncludeInGroupDocuments } from '../useDocumentGroups';

describe('shouldIncludeInGroupDocuments', () => {
  it('CM未設定グループ + customerKey空文字 → 除外される', () => {
    const result = shouldIncludeInGroupDocuments(
      { status: 'pending', customerKey: '' },
      true
    );

    expect(result).toBe(false);
  });

  it('CM未設定グループ + customerKeyあり → 含まれる', () => {
    const result = shouldIncludeInGroupDocuments(
      { status: 'processed', customerKey: '山田太郎' },
      true
    );

    expect(result).toBe(true);
  });

  it('CM未設定グループでない場合はcustomerKey空文字でも含まれる（ルールはCM未設定グループ限定）', () => {
    const result = shouldIncludeInGroupDocuments(
      { status: 'pending', customerKey: '' },
      false
    );

    expect(result).toBe(true);
  });

  it('status:splitは、CM未設定グループか否かに関わらず除外される', () => {
    expect(
      shouldIncludeInGroupDocuments({ status: 'split', customerKey: '山田太郎' }, true)
    ).toBe(false);
    expect(
      shouldIncludeInGroupDocuments({ status: 'split', customerKey: '山田太郎' }, false)
    ).toBe(false);
  });

  it('customerKeyがundefined（フィールド未設定）でもCM未設定グループなら除外される', () => {
    const result = shouldIncludeInGroupDocuments(
      { status: 'pending' },
      true
    );

    expect(result).toBe(false);
  });
});
