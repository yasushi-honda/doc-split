/**
 * generateDisplayFileName テスト（フロントエンド版）
 *
 * #178 Stage 3: メタ編集時の displayFileName 再生成
 * functions側と同一ロジックのため、基本的なケースのみ確認
 */

import { describe, it, expect } from 'vitest';
import { generateDisplayFileName } from '../generateDisplayFileName';

describe('generateDisplayFileName (#178 Stage 3)', () => {
  it('全メタ情報が揃っている場合、書類名_事業所_日付_顧客名.pdf を生成', () => {
    const result = generateDisplayFileName({
      documentType: '介護保険証',
      customerName: '田中太郎',
      officeName: 'デイサービスさくら',
      fileDate: '2026/03/15',
    });
    expect(result).toBe('介護保険証_デイサービスさくら_20260315_田中太郎.pdf');
  });

  it('一部のメタ情報のみの場合は該当部分のみで構成', () => {
    const result = generateDisplayFileName({
      documentType: '介護保険証',
      customerName: '田中太郎',
    });
    expect(result).toBe('介護保険証_田中太郎.pdf');
  });

  it('全てデフォルト値の場合はnullを返す', () => {
    const result = generateDisplayFileName({
      documentType: '未判定',
      customerName: '不明顧客',
    });
    expect(result).toBeNull();
  });

  it('全てundefinedの場合はnullを返す', () => {
    expect(generateDisplayFileName({})).toBeNull();
  });

  it('日付がハイフン区切りでも正規化される', () => {
    const result = generateDisplayFileName({ documentType: '介護保険証', fileDate: '2026-03-15' });
    expect(result).toBe('介護保険証_20260315.pdf');
  });

  it('日付のみの場合は識別不能なためnullを返す', () => {
    const result = generateDisplayFileName({
      documentType: '未判定',
      customerName: '不明顧客',
      fileDate: '2026/03/15',
    });
    expect(result).toBeNull();
  });

  it('8文字未満の日付文字列は無視される', () => {
    const result = generateDisplayFileName({ documentType: '介護保険証', fileDate: '202603' });
    expect(result).toBe('介護保険証.pdf');
  });
});
