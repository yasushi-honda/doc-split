/**
 * テキスト正規化ユーティリティのテスト
 */

import { expect } from 'chai';
import {
  convertFullWidthToHalfWidth,
  normalizeTextEnhanced,
  normalizeForMatching,
  normalizeCustomerNameForMatching,
  convertEraToWesternYear,
  extractDateCandidates,
  selectMostReasonableDate,
  formatDateString,
} from '../src/utils/textNormalizer';

describe('convertFullWidthToHalfWidth', () => {
  it('全角数字を半角に変換', () => {
    expect(convertFullWidthToHalfWidth('０１２３４５６７８９')).to.equal('0123456789');
  });

  it('全角英字を半角に変換', () => {
    expect(convertFullWidthToHalfWidth('ＡＢＣａｂｃ')).to.equal('ABCabc');
  });

  it('全角記号を半角に変換', () => {
    expect(convertFullWidthToHalfWidth('２０２５／０１／１８')).to.equal('2025/01/18');
  });

  it('空文字列を処理', () => {
    expect(convertFullWidthToHalfWidth('')).to.equal('');
  });

  it('混在文字列を処理', () => {
    expect(convertFullWidthToHalfWidth('令和７年１月')).to.equal('令和7年1月');
  });
});

describe('normalizeTextEnhanced', () => {
  it('空白を正規化', () => {
    expect(normalizeTextEnhanced('テスト　　文字列')).to.equal('テスト 文字列');
  });

  it('全角半角混在を処理', () => {
    const result = normalizeTextEnhanced('２０２５年　１月　１８日');
    expect(result).to.equal('2025年 1月 18日');
  });
});

describe('normalizeForMatching', () => {
  it('空白を除去', () => {
    expect(normalizeForMatching('山田 太郎')).to.equal('山田太郎');
  });

  it('句読点を除去', () => {
    expect(normalizeForMatching('株式会社・テスト')).to.equal('株式会社テスト');
  });

  it('小文字化', () => {
    expect(normalizeForMatching('ABC会社')).to.equal('abc会社');
  });
});

describe('normalizeCustomerNameForMatching (Issue #812)', () => {
  it('異体字(旧字体)を新字体に正規化してから通常のマッチング正規化を適用する', () => {
    // 渡邉→渡辺、古澤→古沢(GAIJI_MAP)。normalizeForMatchingと同じ結果になる
    expect(normalizeCustomerNameForMatching('渡邉花子')).to.equal(normalizeForMatching('渡辺花子'));
    expect(normalizeCustomerNameForMatching('古澤太郎')).to.equal(normalizeForMatching('古沢太郎'));
  });

  it('新字体で登録済みの名前と異体字表記の名前が同一の正規化結果になる(症状の再現確認)', () => {
    const registered = normalizeCustomerNameForMatching('渡辺花子'); // マスタ登録済み(新字体)
    const ocrOriginal = normalizeCustomerNameForMatching('渡邉花子'); // FAX原文(異体字)
    expect(ocrOriginal).to.equal(registered);
  });

  it('通常のnormalizeForMatchingの処理(全半角統一・空白除去・小文字化)も維持する', () => {
    expect(normalizeCustomerNameForMatching('渡邉 花子')).to.equal('渡辺花子');
    expect(normalizeCustomerNameForMatching('ABC渡邉')).to.equal('abc渡辺');
  });

  it('空文字列は空文字列を返す', () => {
    expect(normalizeCustomerNameForMatching('')).to.equal('');
  });

  it('異体字を含まない文字列はnormalizeForMatchingと同じ結果になる(非回帰)', () => {
    expect(normalizeCustomerNameForMatching('鈴木一郎')).to.equal(normalizeForMatching('鈴木一郎'));
  });
});

describe('convertEraToWesternYear', () => {
  it('令和を西暦に変換', () => {
    expect(convertEraToWesternYear('令和', 7)).to.equal(2025);
    expect(convertEraToWesternYear('R', 7)).to.equal(2025);
    expect(convertEraToWesternYear('r', 1)).to.equal(2019);
  });

  it('平成を西暦に変換', () => {
    expect(convertEraToWesternYear('平成', 31)).to.equal(2019);
    expect(convertEraToWesternYear('H', 1)).to.equal(1989);
  });

  it('昭和を西暦に変換', () => {
    expect(convertEraToWesternYear('昭和', 64)).to.equal(1989);
    expect(convertEraToWesternYear('S', 1)).to.equal(1926);
  });

  it('大正を西暦に変換', () => {
    expect(convertEraToWesternYear('大正', 15)).to.equal(1926);
    expect(convertEraToWesternYear('T', 1)).to.equal(1912);
  });

  it('無効な元号は-1を返す', () => {
    expect(convertEraToWesternYear('', 1)).to.equal(-1);
    expect(convertEraToWesternYear('X', 1)).to.equal(-1);
    expect(convertEraToWesternYear('令和', 0)).to.equal(-1);
  });
});

describe('extractDateCandidates', () => {
  it('令和年月分パターンを抽出', () => {
    const candidates = extractDateCandidates('令和7年5月分の請求書');
    expect(candidates.length).to.be.greaterThan(0);
    expect(candidates[0]!.pattern).to.equal('令和年月分');
    expect(candidates[0]!.date.getFullYear()).to.equal(2025);
    expect(candidates[0]!.date.getMonth()).to.equal(4); // 0-indexed
  });

  it('令和年月日パターンを抽出', () => {
    const candidates = extractDateCandidates('令和7年1月18日発行');
    expect(candidates.length).to.be.greaterThan(0);
    expect(candidates[0]!.date.getFullYear()).to.equal(2025);
    expect(candidates[0]!.date.getDate()).to.equal(18);
  });

  it('西暦パターンを抽出', () => {
    const candidates = extractDateCandidates('2025年1月18日');
    expect(candidates.length).to.be.greaterThan(0);
    expect(candidates[0]!.pattern).to.equal('西暦年月日');
  });

  it('スラッシュ形式を抽出', () => {
    const candidates = extractDateCandidates('発行日: 2025/01/18');
    expect(candidates.length).to.be.greaterThan(0);
    expect(candidates[0]!.pattern).to.equal('西暦スラッシュ');
  });

  it('複数の日付を抽出', () => {
    const candidates = extractDateCandidates('発行日: 2025/01/18 有効期限: 2025/12/31');
    expect(candidates.length).to.equal(2);
  });

  it('平成パターンを抽出', () => {
    const candidates = extractDateCandidates('平成31年4月30日');
    expect(candidates.length).to.be.greaterThan(0);
    expect(candidates[0]!.date.getFullYear()).to.equal(2019);
  });

  it('空文字列は空配列を返す', () => {
    expect(extractDateCandidates('')).to.deep.equal([]);
  });

  it('日付がないテキストは空配列を返す', () => {
    expect(extractDateCandidates('これは日付のないテキストです')).to.deep.equal([]);
  });
});

describe('selectMostReasonableDate', () => {
  it('単一候補はそのまま返す', () => {
    const candidates = extractDateCandidates('2025年1月18日');
    const result = selectMostReasonableDate(candidates);
    expect(result).to.not.be.null;
    expect(result!.date.getFullYear()).to.equal(2025);
  });

  it('複数候補から信頼度の高いものを選択', () => {
    const candidates = extractDateCandidates('令和7年5月分 2025/05/01');
    const result = selectMostReasonableDate(candidates);
    expect(result).to.not.be.null;
    // 令和年月分パターンの方が信頼度が高い
    expect(result!.pattern).to.equal('令和年月分');
  });

  it('マーカー指定で周辺の日付を優先', () => {
    const text = '作成日: 2025/01/01 発行日: 2025/01/18';
    const candidates = extractDateCandidates(text);
    const result = selectMostReasonableDate(candidates, '発行日', text);
    expect(result).to.not.be.null;
    expect(result!.date.getDate()).to.equal(18);
  });

  it('空配列はnullを返す', () => {
    expect(selectMostReasonableDate([])).to.be.null;
  });
});

describe('formatDateString', () => {
  it('日付をYYYY/MM/DD形式にフォーマット', () => {
    expect(formatDateString(2025, 1, 18)).to.equal('2025/01/18');
    expect(formatDateString(2025, 12, 5)).to.equal('2025/12/05');
  });
});
