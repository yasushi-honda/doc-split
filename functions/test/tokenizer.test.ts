/**
 * トークナイザーテスト
 */

import { expect } from 'chai';
import {
  normalizeForSearch,
  generateBigrams,
  generateKeywords,
  generateDateTokens,
  generateDateTokensFromString,
  generateDocumentTokens,
  tokenizeQuery,
  generateTokenId,
  generateTokensHash,
  FIELD_WEIGHTS,
} from '../src/utils/tokenizer';

describe('normalizeForSearch', () => {
  it('全角文字を半角に変換する', () => {
    expect(normalizeForSearch('１２３ＡＢＣ')).to.equal('123abc');
  });

  it('空白を正規化する', () => {
    expect(normalizeForSearch('田中　太郎')).to.equal('田中 太郎');
    expect(normalizeForSearch('田中  太郎')).to.equal('田中 太郎');
  });

  it('句読点をスペースに変換する', () => {
    expect(normalizeForSearch('東京、大阪、名古屋')).to.equal('東京 大阪 名古屋');
  });

  it('ハイフン・長音を除去する', () => {
    expect(normalizeForSearch('ケアマネージャー')).to.equal('ケアマネジャ');
  });

  it('小文字に変換する', () => {
    expect(normalizeForSearch('ABC')).to.equal('abc');
  });

  it('空文字列を処理する', () => {
    expect(normalizeForSearch('')).to.equal('');
  });
});

describe('generateBigrams', () => {
  it('bi-gramを生成する', () => {
    const bigrams = generateBigrams('田中太郎');
    expect(bigrams).to.include('田中');
    expect(bigrams).to.include('中太');
    expect(bigrams).to.include('太郎');
  });

  it('空白を無視してbi-gramを生成する', () => {
    const bigrams = generateBigrams('田中 太郎');
    expect(bigrams).to.include('田中');
    expect(bigrams).to.include('中太');
  });

  it('重複を除去する', () => {
    const bigrams = generateBigrams('ああああ');
    expect(bigrams).to.deep.equal(['ああ']);
  });

  it('短いテキストは空配列を返す', () => {
    expect(generateBigrams('あ')).to.deep.equal([]);
    expect(generateBigrams('')).to.deep.equal([]);
  });
});

describe('generateKeywords', () => {
  it('スペース区切りでキーワードを抽出する', () => {
    const keywords = generateKeywords('東京 大阪 名古屋');
    expect(keywords).to.include('東京');
    expect(keywords).to.include('大阪');
    expect(keywords).to.include('名古屋');
  });

  it('短い単語を除外する', () => {
    const keywords = generateKeywords('a 東京 b');
    expect(keywords).to.not.include('a');
    expect(keywords).to.not.include('b');
    expect(keywords).to.include('東京');
  });

  it('重複を除去する', () => {
    const keywords = generateKeywords('東京 東京 大阪');
    expect(keywords.filter(k => k === '東京').length).to.equal(1);
  });
});

describe('generateDateTokens', () => {
  it('日付トークンを生成する', () => {
    const date = new Date(2024, 0, 15);  // 2024-01-15
    const tokens = generateDateTokens(date);
    expect(tokens).to.include('2024');
    expect(tokens).to.include('2024-01');
    expect(tokens).to.include('2024-01-15');
  });

  it('nullの場合は空配列を返す', () => {
    expect(generateDateTokens(null)).to.deep.equal([]);
  });

  it('無効な日付の場合は空配列を返す', () => {
    expect(generateDateTokens(new Date('invalid'))).to.deep.equal([]);
  });
});

describe('generateDateTokensFromString', () => {
  it('YYYY/MM/DD形式を解析する', () => {
    const tokens = generateDateTokensFromString('2024/01/15');
    expect(tokens).to.include('2024');
    expect(tokens).to.include('2024-01');
    expect(tokens).to.include('2024-01-15');
  });

  it('YYYY-MM-DD形式を解析する', () => {
    const tokens = generateDateTokensFromString('2024-01-15');
    expect(tokens).to.include('2024-01-15');
  });

  it('YYYY年MM月DD日形式を解析する', () => {
    const tokens = generateDateTokensFromString('2024年1月15日');
    expect(tokens).to.include('2024-01-15');
  });

  it('不正な形式の場合は空配列を返す', () => {
    expect(generateDateTokensFromString('invalid')).to.deep.equal([]);
    expect(generateDateTokensFromString(null)).to.deep.equal([]);
  });
});

describe('generateDocumentTokens', () => {
  it('顧客名からトークンを生成する', () => {
    const tokens = generateDocumentTokens({ customerName: '田中太郎' });
    expect(tokens.some(t => t.field === 'customer')).to.be.true;
    expect(tokens.some(t => t.token === '田中')).to.be.true;
    expect(tokens.some(t => t.weight === FIELD_WEIGHTS.customer)).to.be.true;
  });

  it('事業所名からトークンを生成する', () => {
    const tokens = generateDocumentTokens({ officeName: '北名古屋市' });
    expect(tokens.some(t => t.field === 'office')).to.be.true;
    expect(tokens.some(t => t.weight === FIELD_WEIGHTS.office)).to.be.true;
  });

  it('書類種別からトークンを生成する', () => {
    const tokens = generateDocumentTokens({ documentType: '介護保険被保険者証' });
    expect(tokens.some(t => t.field === 'documentType')).to.be.true;
  });

  it('日付からトークンを生成する', () => {
    const tokens = generateDocumentTokens({ fileDate: new Date(2024, 0, 15) });
    expect(tokens.some(t => t.field === 'date')).to.be.true;
    expect(tokens.some(t => t.token === '2024-01-15')).to.be.true;
  });

  it('ファイル名からトークンを生成する（拡張子除去）', () => {
    const tokens = generateDocumentTokens({ fileName: '田中太郎_介護保険.pdf' });
    expect(tokens.some(t => t.field === 'fileName')).to.be.true;
    expect(tokens.some(t => t.token.includes('pdf'))).to.be.false;
  });

  it('複数フィールドからトークンを生成する', () => {
    const tokens = generateDocumentTokens({
      customerName: '田中太郎',
      officeName: '北名古屋市',
      documentType: '介護保険被保険者証',
      fileDate: new Date(2024, 0, 15),
      fileName: 'document.pdf',
    });
    expect(tokens.filter(t => t.field === 'customer').length).to.be.greaterThan(0);
    expect(tokens.filter(t => t.field === 'office').length).to.be.greaterThan(0);
    expect(tokens.filter(t => t.field === 'documentType').length).to.be.greaterThan(0);
    expect(tokens.filter(t => t.field === 'date').length).to.be.greaterThan(0);
    expect(tokens.filter(t => t.field === 'fileName').length).to.be.greaterThan(0);
  });

  it('nullフィールドは無視する', () => {
    const tokens = generateDocumentTokens({
      customerName: null,
      officeName: undefined,
    });
    expect(tokens.length).to.equal(0);
  });
});

describe('tokenizeQuery', () => {
  it('クエリからトークンを生成する', () => {
    const tokens = tokenizeQuery('田中太郎');
    expect(tokens).to.include('田中');
    expect(tokens).to.include('太郎');
  });

  it('日付を含むクエリから日付トークンを生成する', () => {
    const tokens = tokenizeQuery('2024/01/15');
    expect(tokens).to.include('2024-01-15');
  });

  it('全角文字を正規化する', () => {
    const tokens = tokenizeQuery('田中　太郎');
    expect(tokens).to.include('田中');
    expect(tokens).to.include('太郎');
  });

  it('空クエリは空配列を返す', () => {
    expect(tokenizeQuery('')).to.deep.equal([]);
  });
});

describe('generateTokenId', () => {
  it('トークンからIDを生成する', () => {
    const id = generateTokenId('田中');
    expect(id).to.match(/^[0-9a-f]{8}$/);
  });

  it('同じトークンは同じIDを返す', () => {
    const id1 = generateTokenId('田中');
    const id2 = generateTokenId('田中');
    expect(id1).to.equal(id2);
  });

  it('異なるトークンは異なるIDを返す', () => {
    const id1 = generateTokenId('田中');
    const id2 = generateTokenId('山田');
    expect(id1).to.not.equal(id2);
  });
});

describe('generateTokensHash', () => {
  it('トークン配列からハッシュを生成する', () => {
    const tokens = [
      { token: '田中', field: 'customer' as const, weight: 3 },
      { token: '太郎', field: 'customer' as const, weight: 3 },
    ];
    const hash = generateTokensHash(tokens);
    expect(hash).to.match(/^[0-9a-f]{8}$/);
  });

  it('同じトークン配列は同じハッシュを返す', () => {
    const tokens1 = [
      { token: '田中', field: 'customer' as const, weight: 3 },
      { token: '太郎', field: 'customer' as const, weight: 3 },
    ];
    const tokens2 = [
      { token: '太郎', field: 'customer' as const, weight: 3 },
      { token: '田中', field: 'customer' as const, weight: 3 },
    ];
    // ソートされるので順序が異なっても同じハッシュ
    expect(generateTokensHash(tokens1)).to.equal(generateTokensHash(tokens2));
  });

  it('異なるトークン配列は異なるハッシュを返す', () => {
    const tokens1 = [
      { token: '田中', field: 'customer' as const, weight: 3 },
    ];
    const tokens2 = [
      { token: '山田', field: 'customer' as const, weight: 3 },
    ];
    expect(generateTokensHash(tokens1)).to.not.equal(generateTokensHash(tokens2));
  });
});
