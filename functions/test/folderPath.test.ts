/**
 * フォルダ階層パス解決(`functions/src/drive/folderPath.ts`)のテスト(ADR-0022)
 */

import { expect } from 'chai';
import {
  resolveFolderSegments,
  FuriganaMissingError,
  CareManagerMissingError,
  CustomerNameMissingError,
  DocumentCategoryMissingError,
  FileDateMissingError,
  FolderPathDocInput,
} from '../src/drive/folderPath';
import type { DriveFolderTemplate } from '../../shared/types';

const KANAME_TEMPLATE: DriveFolderTemplate = [
  { type: 'fixed', value: '北名古屋事業所' },
  { type: 'careManager', format: 'surnameInitialSpaceName' },
  { type: 'customer', format: 'furiganaInitialSpaceName' },
  { type: 'documentCategory' },
  { type: 'date', format: 'YYYY年MM月', onlyForCategories: ['ケアプラン'] },
];

const COCORO_TEMPLATE: DriveFolderTemplate = [
  { type: 'fixed', value: '共有フォルダ' },
  { type: 'careManager', format: 'nameOnly' },
  { type: 'customer', format: 'nameOnly' },
];

function makeDoc(overrides: Partial<FolderPathDocInput> = {}): FolderPathDocInput {
  return {
    careManagerName: '田中太郎',
    customerName: '鈴木花子',
    customerFurigana: 'スズキハナコ',
    documentCategory: 'ケアプラン',
    fileDate: new Date(2026, 6, 20), // 2026-07-20 (month is 0-indexed)
    ...overrides,
  };
}

describe('resolveFolderSegments', () => {
  it('かなめテンプレート: ケアプランは事業所/ケアマネ/利用者/カテゴリ/年月の5階層を解決する', () => {
    const result = resolveFolderSegments(makeDoc(), KANAME_TEMPLATE);
    expect(result).to.deep.equal([
      '北名古屋事業所',
      '田 田中太郎',
      'ス　鈴木花子',
      'ケアプラン',
      '2026年07月',
    ]);
  });

  it('かなめテンプレート: ケアプラン以外は年月階層を持たない(4階層)', () => {
    const result = resolveFolderSegments(
      makeDoc({ documentCategory: '医療費' }),
      KANAME_TEMPLATE
    );
    expect(result).to.deep.equal(['北名古屋事業所', '田 田中太郎', 'ス　鈴木花子', '医療費']);
  });

  it('cocoroテンプレート: nameOnlyは頭文字なしでそのまま氏名を使う(3階層)', () => {
    const result = resolveFolderSegments(makeDoc(), COCORO_TEMPLATE);
    expect(result).to.deep.equal(['共有フォルダ', '田中太郎', '鈴木花子']);
  });

  it('フリガナ欠損 + furiganaFallback未指定(デフォルトstop)はFuriganaMissingErrorをthrowする', () => {
    const doc = makeDoc({ customerFurigana: undefined });
    expect(() => resolveFolderSegments(doc, KANAME_TEMPLATE)).to.throw(
      FuriganaMissingError,
      /鈴木花子/
    );
  });

  it('フリガナが空文字列の場合もstop扱いでFuriganaMissingErrorをthrowする', () => {
    const doc = makeDoc({ customerFurigana: '' });
    expect(() => resolveFolderSegments(doc, KANAME_TEMPLATE)).to.throw(FuriganaMissingError);
  });

  it('フリガナが空白のみの場合もstop扱いでFuriganaMissingErrorをthrowする', () => {
    const doc = makeDoc({ customerFurigana: '   ' });
    expect(() => resolveFolderSegments(doc, KANAME_TEMPLATE)).to.throw(FuriganaMissingError);
  });

  it('フリガナ欠損 + furiganaFallback:useNameInitialは氏名の頭文字で代替する', () => {
    const doc = makeDoc({ customerFurigana: undefined });
    const result = resolveFolderSegments(doc, KANAME_TEMPLATE, {
      furiganaFallback: 'useNameInitial',
    });
    expect(result[2]).to.equal('鈴　鈴木花子');
  });

  it('separator: full明示指定はcareManagerセグメントでも全角スペースを使う', () => {
    const template: DriveFolderTemplate = [
      { type: 'careManager', format: 'surnameInitialSpaceName', separator: 'full' },
    ];
    const result = resolveFolderSegments(makeDoc(), template);
    expect(result).to.deep.equal(['田　田中太郎']);
  });

  it('separator: half明示指定はcustomerセグメントでも半角スペースを使う', () => {
    const template: DriveFolderTemplate = [
      { type: 'customer', format: 'furiganaInitialSpaceName', separator: 'half' },
    ];
    const result = resolveFolderSegments(makeDoc(), template);
    expect(result).to.deep.equal(['ス 鈴木花子']);
  });

  it('空のテンプレートは空配列を返す', () => {
    expect(resolveFolderSegments(makeDoc(), [])).to.deep.equal([]);
  });

  it('fixedセグメントはdocの値に関わらず常に同じ文字列を返す', () => {
    const template: DriveFolderTemplate = [{ type: 'fixed', value: '固定フォルダ' }];
    expect(resolveFolderSegments(makeDoc(), template)).to.deep.equal(['固定フォルダ']);
  });

  it('careManagerNameが空文字の場合はCareManagerMissingErrorをthrowする', () => {
    const doc = makeDoc({ careManagerName: '' });
    expect(() => resolveFolderSegments(doc, KANAME_TEMPLATE)).to.throw(CareManagerMissingError);
  });

  it('careManagerNameが空白のみの場合もCareManagerMissingErrorをthrowする', () => {
    const doc = makeDoc({ careManagerName: '   ' });
    expect(() => resolveFolderSegments(doc, KANAME_TEMPLATE)).to.throw(CareManagerMissingError);
  });

  it('careManagerNameが空でもnameOnly形式で同様にCareManagerMissingErrorをthrowする', () => {
    const doc = makeDoc({ careManagerName: '' });
    expect(() => resolveFolderSegments(doc, COCORO_TEMPLATE)).to.throw(CareManagerMissingError);
  });

  it('careManagerNameが先頭空白+実データの場合はガードを通過するがtrim済みの値からフォルダ名が生成される(code-review xhigh指摘#5対応)', () => {
    const doc = makeDoc({ careManagerName: ' 田中太郎' });
    expect(() => resolveFolderSegments(doc, KANAME_TEMPLATE)).to.not.throw();
    const result = resolveFolderSegments(doc, KANAME_TEMPLATE);
    // 頭文字が空白ではなく"田"になっていること(untrimmedのままだと頭文字が空白になる)
    expect(result[1]).to.equal('田 田中太郎');
  });

  it('careManagerNameが先頭空白+実データの場合、nameOnly形式でもtrim済みの値を返す', () => {
    const doc = makeDoc({ careManagerName: ' 田中太郎' });
    const result = resolveFolderSegments(doc, COCORO_TEMPLATE);
    expect(result[1]).to.equal('田中太郎');
  });

  it('customerNameが空文字の場合はCustomerNameMissingErrorをthrowする', () => {
    const doc = makeDoc({ customerName: '' });
    expect(() => resolveFolderSegments(doc, KANAME_TEMPLATE)).to.throw(CustomerNameMissingError);
  });

  it('customerNameが空白のみの場合もCustomerNameMissingErrorをthrowする', () => {
    const doc = makeDoc({ customerName: '   ' });
    expect(() => resolveFolderSegments(doc, KANAME_TEMPLATE)).to.throw(CustomerNameMissingError);
  });

  it('customerNameが空でもnameOnly形式で同様にCustomerNameMissingErrorをthrowする(code-review xhigh指摘#6対応)', () => {
    const doc = makeDoc({ customerName: '' });
    expect(() => resolveFolderSegments(doc, COCORO_TEMPLATE)).to.throw(CustomerNameMissingError);
  });

  it('documentCategoryが空文字の場合はDocumentCategoryMissingErrorをthrowする', () => {
    const doc = makeDoc({ documentCategory: '' });
    const template: DriveFolderTemplate = [{ type: 'documentCategory' }];
    expect(() => resolveFolderSegments(doc, template)).to.throw(DocumentCategoryMissingError);
  });

  it('documentCategoryが空白のみの場合もDocumentCategoryMissingErrorをthrowする', () => {
    const doc = makeDoc({ documentCategory: '  ' });
    const template: DriveFolderTemplate = [{ type: 'documentCategory' }];
    expect(() => resolveFolderSegments(doc, template)).to.throw(DocumentCategoryMissingError);
  });

  it('fileDateがnullでもdateセグメントが対象外カテゴリならエラーにならない(セグメント自体を持たない)', () => {
    const doc = makeDoc({ documentCategory: '医療費', fileDate: null });
    const result = resolveFolderSegments(doc, KANAME_TEMPLATE);
    expect(result).to.deep.equal(['北名古屋事業所', '田 田中太郎', 'ス　鈴木花子', '医療費']);
  });

  it('fileDateがnullでdateセグメントが対象カテゴリの場合はFileDateMissingErrorをthrowする', () => {
    const doc = makeDoc({ documentCategory: 'ケアプラン', fileDate: null });
    expect(() => resolveFolderSegments(doc, KANAME_TEMPLATE)).to.throw(FileDateMissingError);
  });
});
