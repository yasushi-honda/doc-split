/**
 * getDisplayFileName テスト
 *
 * #178: displayFileName フォールバックロジック
 */

import { describe, it, expect } from 'vitest';
import { getDisplayFileName } from '../getDisplayFileName';

describe('getDisplayFileName (#178)', () => {
  it('displayFileName が設定されている場合はそちらを返す', () => {
    const doc = { fileName: 'original.pdf', displayFileName: '介護保険証_デイサービス_20260315_田中太郎.pdf' };
    expect(getDisplayFileName(doc)).toBe('介護保険証_デイサービス_20260315_田中太郎.pdf');
  });

  it('displayFileName が未設定の場合は fileName にフォールバック', () => {
    const doc = { fileName: 'original.pdf' };
    expect(getDisplayFileName(doc)).toBe('original.pdf');
  });

  it('displayFileName が空文字の場合は fileName にフォールバック', () => {
    const doc = { fileName: 'original.pdf', displayFileName: '' };
    expect(getDisplayFileName(doc)).toBe('original.pdf');
  });

  it('displayFileName が undefined の場合は fileName にフォールバック', () => {
    const doc = { fileName: 'original.pdf', displayFileName: undefined };
    expect(getDisplayFileName(doc)).toBe('original.pdf');
  });
});
