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
  isExcludedToken,
  tokenizeQueryByWords,
  FIELD_WEIGHTS,
} from '../src/utils/tokenizer';
import { extractDateFilters } from '../src/search/dateQuery';

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
    expect(normalizeForSearch('ケアマネジャー')).to.equal('ケアマネジャ');
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

  it('日付トークンは索引に持たない (日付は fileDate の範囲クエリで答える。Issue #984 段階2a)', () => {
    const tokens = generateDocumentTokens({ fileDate: new Date(2024, 0, 15) });
    expect(tokens.some(t => t.field === 'date')).to.be.false;
    expect(tokens).to.deep.equal([]);
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
    expect(tokens.filter(t => t.field === 'date').length).to.equal(0);
    expect(tokens.filter(t => t.field === 'fileName').length).to.be.greaterThan(0);
  });

  it('nullフィールドは無視する', () => {
    const tokens = generateDocumentTokens({
      customerName: null,
      officeName: undefined,
    });
    expect(tokens.length).to.equal(0);
  });

  // Issue #680: fileNameのbigram化がsearch_index肥大化(too many index entries)の
  // 原因だったため、fax gateway命名規則由来のprefixType別にbigram生成を制御する
  describe('Issue #680: fileNameトークン化のprefixType別制御', () => {
    it('AC-B1: document_id型ファイル名から"26"・"l1"・時刻断片を含むトークンを生成しない', () => {
      const tokens = generateDocumentTokens({ fileName: 'DOC260718-L1-20260718131435.pdf' });
      const fileNameTokens = tokens.filter(t => t.field === 'fileName').map(t => t.token);
      expect(fileNameTokens).to.not.include('26');
      expect(fileNameTokens).to.not.include('l1');
      expect(fileNameTokens).to.not.include('20260718131435');
      expect(fileNameTokens).to.not.include('131435');
    });

    it('AC-B2: document_id型（DOC始まり）はkeywordのみ生成する', () => {
      const tokens = generateDocumentTokens({ fileName: 'DOC260718-L1-20260718131435.pdf' });
      const fileNameTokens = tokens.filter(t => t.field === 'fileName');
      expect(fileNameTokens.some(t => t.token === 'doc260718')).to.be.true;
      // bigram（1文字重複の断片）が生成されていないこと
      expect(fileNameTokens.every(t => t.weight === FIELD_WEIGHTS.fileName)).to.be.true;
    });

    it('AC-B2: phone_number型（数字のみ）はkeywordのみ生成する', () => {
      const tokens = generateDocumentTokens({ fileName: '0529088423-L1-20260122104653.pdf' });
      const fileNameTokens = tokens.filter(t => t.field === 'fileName');
      expect(fileNameTokens.some(t => t.token === '0529088423')).to.be.true;
      expect(fileNameTokens.every(t => t.weight === FIELD_WEIGHTS.fileName)).to.be.true;
    });

    it('AC-B2: office_name型（日本語を含む）はbigram込みで生成する', () => {
      const tokens = generateDocumentTokens({ fileName: '西春内科在宅クリニック-L1-20260122101727.pdf' });
      const fileNameTokens = tokens.filter(t => t.field === 'fileName');
      // bigram（重みが半分）が含まれること
      expect(fileNameTokens.some(t => t.weight === FIELD_WEIGHTS.fileName * 0.5)).to.be.true;
    });

    it('AC-B2: unknown型（英数字のみ、DOC始まりでも数字のみでもない）はkeywordのみ生成する', () => {
      const tokens = generateDocumentTokens({ fileName: 'invoice-L1-20260122101727.pdf' });
      const fileNameTokens = tokens.filter(t => t.field === 'fileName');
      expect(fileNameTokens.some(t => t.token === 'invoice')).to.be.true;
      expect(fileNameTokens.every(t => t.weight === FIELD_WEIGHTS.fileName)).to.be.true;
    });

    it('AC-B3回帰: 日本語ファイル名（-L\\d+-パターンなし）は従来通りbigram込みで生成する', () => {
      const tokens = generateDocumentTokens({ fileName: '田中太郎_介護保険.pdf' });
      const fileNameTokens = tokens.filter(t => t.field === 'fileName');
      expect(fileNameTokens.some(t => t.token === '田中')).to.be.true;
      expect(fileNameTokens.some(t => t.weight === FIELD_WEIGHTS.fileName * 0.5)).to.be.true;
    });

    it('AC-B4境界値: 拡張子のみのファイル名はエラーを投げず空トークンも生成しない', () => {
      const tokens = generateDocumentTokens({ fileName: '.pdf' });
      const fileNameTokens = tokens.filter(t => t.field === 'fileName');
      expect(fileNameTokens.length).to.equal(0);
      expect(fileNameTokens.some(t => t.token === '')).to.be.false;
    });

    it('AC-B4境界値: 空文字のファイル名は無視される（fileNameフィールド自体を生成しない）', () => {
      const tokens = generateDocumentTokens({ fileName: '' });
      expect(tokens.filter(t => t.field === 'fileName').length).to.equal(0);
    });
  });
});

describe('isExcludedToken (Issue #984 段階2a)', () => {
  it('日付形 (YYYY / YYYY-MM / YYYY-MM-DD, 2000〜2099) は除外', () => {
    for (const t of ['2026', '2000', '2099', '2026-09', '2026-12', '2026-09-20', '2028-02-29']) {
      expect(isExcludedToken(t), t).to.equal(true);
    }
  });

  it('数字・_ だけの 1〜2 文字は除外', () => {
    for (const t of ['20', '02', '26', '60', '09', '0', '9', '_2', '0_', '2_', '__']) {
      expect(isExcludedToken(t), t).to.equal(true);
    }
  });

  it('通常の語・3 文字以上の数字・範囲外の年・不正な月日は除外しない', () => {
    for (const t of ['田中', '介護', '1999', '2100', '1234', '20260920', '2026年報告', '2026-13', '2026-09-32',
      '0t', 'ab', '_顧', 'a1']) {
      expect(isExcludedToken(t), t).to.equal(false);
    }
  });

  it('tokenId が除外トークンと衝突する通常の語は除外しない (文字列で判定)', () => {
    // "0t" は "26" と generateTokenId が衝突する (32bit ハッシュ)
    expect(generateTokenId('0t')).to.equal(generateTokenId('26'));
    expect(isExcludedToken('26')).to.equal(true);
    expect(isExcludedToken('0t')).to.equal(false);
  });

  it('日付語として認識する範囲 (dateQuery) と一致する: 認識される年月日は除外され、認識されない語は除外されない', () => {
    // 不一致だと、索引から除外された日付が範囲検索にも載らず 0 件になる
    for (let y = 1990; y <= 2110; y++) {
      const word = String(y);
      expect(isExcludedToken(word), word).to.equal(extractDateFilters(word).dateRange !== null);
    }
    for (const word of ['2026-01', '2026-12', '2026-13', '2026-00', '2099-12', '2100-01', '1999-12',
      '2026-01-31', '2028-02-29', '2026-09-00', '2026-09-32']) {
      // 索引トークンは normalizeForSearch 後の形 (ハイフンあり) で date 形を判定する
      expect(isExcludedToken(word), word).to.equal(extractDateFilters(word).dateRange !== null);
    }
  });
});

describe('generateDocumentTokens: 日付由来トークンの除外 (Issue #984 段階2a)', () => {
  it('アプリの改名規則ファイル名の YYYYMMDD 由来の 2 桁 bigram を含まない', () => {
    const tokens = generateDocumentTokens({
      fileName: '訪問看護報告書_西春内科在宅クリニック_20260920_田中太郎',
    });
    const set = new Set(tokens.map(t => t.token));
    for (const t of ['20', '02', '26', '60', '09', '92', '_2', '0_']) {
      expect(set.has(t), t).to.equal(false);
    }
    // 通常の語は残る
    expect(set.has('訪問')).to.equal(true);
  });

  it('顧客名・事業所名・書類種別の数字だけの語も除外する (全フィールド共通)', () => {
    const tokens = generateDocumentTokens({ customerName: '田中 26', officeName: '2026', documentType: '第20号' });
    const set = new Set(tokens.map(t => t.token));
    expect(set.has('26')).to.equal(false);
    expect(set.has('2026')).to.equal(false);
    expect(set.has('20')).to.equal(false);
    expect(set.has('田中')).to.equal(true);
  });
});

describe('tokenizeQueryByWords: 除外トークンの扱い (Issue #984 段階2a)', () => {
  it('全トークンが除外される語は AND から外れる ("田中 20" → 田中のみ)', () => {
    const groups = tokenizeQueryByWords('田中 20');
    expect(groups).to.have.length(1);
    expect(groups[0]).to.include('田中');
  });

  it('除外語だけのクエリは空配列', () => {
    expect(tokenizeQueryByWords('20')).to.deep.equal([]);
    expect(tokenizeQueryByWords('2026')).to.deep.equal([]);
  });

  it('語の一部だけが除外される場合は残りのトークンを保持する ("田中26" → 田中26 / 田中 / 中2 / 26除外)', () => {
    const groups = tokenizeQueryByWords('田中26');
    expect(groups).to.have.length(1);
    expect(groups[0]).to.not.include('26');
    expect(groups[0]).to.include('田中26');
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
