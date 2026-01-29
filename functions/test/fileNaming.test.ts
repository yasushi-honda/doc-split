/**
 * ファイル名生成ユーティリティのテスト
 */

import { expect } from 'chai';
import {
  analyzeCustomerEntries,
  sanitizeFileName,
  sanitizeFilenameForStorage,
  formatDateForFileName,
  shortenDocumentId,
  generateOptimalFileName,
  generateUniqueFileName,
  generateSplitFileNames,
  parseFileName,
  CustomerAttribute,
} from '../src/utils/fileNaming';

// テスト用顧客データ
const customer1: CustomerAttribute = {
  id: 'cust1',
  name: '山田太郎',
  officeId: 'off1',
  careManagerId: 'cm1',
};

const customer2: CustomerAttribute = {
  id: 'cust2',
  name: '鈴木花子',
  officeId: 'off1',
  careManagerId: 'cm1',
};

const customer3: CustomerAttribute = {
  id: 'cust3',
  name: '田中一郎',
  officeId: 'off2', // 異なる事業所
  careManagerId: 'cm1',
};

const customer4: CustomerAttribute = {
  id: 'cust4',
  name: '佐藤二郎',
  officeId: 'off1',
  careManagerId: 'cm2', // 異なるケアマネ
};

describe('analyzeCustomerEntries', () => {
  it('空配列を分析', () => {
    const result = analyzeCustomerEntries([]);
    expect(result.count).to.equal(0);
    expect(result.isSingle).to.be.false;
    expect(result.shouldSplit).to.be.false;
  });

  it('単一顧客を分析', () => {
    const result = analyzeCustomerEntries([customer1]);
    expect(result.count).to.equal(1);
    expect(result.isSingle).to.be.true;
    expect(result.isSameAttribute).to.be.true;
    expect(result.shouldSplit).to.be.false;
    expect(result.primaryCustomer).to.deep.equal(customer1);
  });

  it('同一属性の複数顧客を分析', () => {
    const result = analyzeCustomerEntries([customer1, customer2]);
    expect(result.count).to.equal(2);
    expect(result.isSingle).to.be.false;
    expect(result.isSameAttribute).to.be.true;
    expect(result.attributeMatch.office).to.be.true;
    expect(result.attributeMatch.careManager).to.be.true;
    expect(result.shouldSplit).to.be.false;
  });

  it('事業所が異なる場合は分割推奨', () => {
    const result = analyzeCustomerEntries([customer1, customer3]);
    expect(result.isSameAttribute).to.be.false;
    expect(result.attributeMatch.office).to.be.false;
    expect(result.shouldSplit).to.be.true;
    expect(result.splitReason).to.include('事業所');
  });

  it('ケアマネが異なる場合は分割推奨', () => {
    const result = analyzeCustomerEntries([customer1, customer4]);
    expect(result.isSameAttribute).to.be.false;
    expect(result.attributeMatch.careManager).to.be.false;
    expect(result.shouldSplit).to.be.true;
    expect(result.splitReason).to.include('ケアマネ');
  });

  it('4名以上の場合は分割推奨', () => {
    const customers = [
      { id: 'c1', name: '顧客1', officeId: 'off1', careManagerId: 'cm1' },
      { id: 'c2', name: '顧客2', officeId: 'off1', careManagerId: 'cm1' },
      { id: 'c3', name: '顧客3', officeId: 'off1', careManagerId: 'cm1' },
      { id: 'c4', name: '顧客4', officeId: 'off1', careManagerId: 'cm1' },
    ];
    const result = analyzeCustomerEntries(customers);
    expect(result.shouldSplit).to.be.true;
    expect(result.splitReason).to.include('3名を超えています');
  });
});

describe('sanitizeFilenameForStorage', () => {
  it('禁止文字をアンダースコアに置換', () => {
    expect(sanitizeFilenameForStorage('file<test>.pdf')).to.equal('file_test_.pdf');
    expect(sanitizeFilenameForStorage('path/to\\file')).to.equal('path_to_file');
  });

  it('空白をアンダースコアに置換', () => {
    expect(sanitizeFilenameForStorage('test file name.pdf')).to.equal('test_file_name.pdf');
  });

  it('連続アンダースコアを統一', () => {
    expect(sanitizeFilenameForStorage('test___file')).to.equal('test_file');
  });

  it('デフォルト200文字で切り詰め', () => {
    const longName = 'a'.repeat(250);
    const result = sanitizeFilenameForStorage(longName);
    expect(result.length).to.equal(200);
  });

  it('カスタム長で切り詰め', () => {
    const longName = 'a'.repeat(100);
    const result = sanitizeFilenameForStorage(longName, 50);
    expect(result.length).to.equal(50);
  });

  it('日本語ファイル名を保持', () => {
    expect(sanitizeFilenameForStorage('介護保険被保険者証.pdf')).to.equal('介護保険被保険者証.pdf');
  });

  it('空文字列を処理', () => {
    expect(sanitizeFilenameForStorage('')).to.equal('');
  });
});

describe('sanitizeFileName', () => {
  it('禁止文字を除去', () => {
    expect(sanitizeFileName('file<>:"/\\|?*name')).to.equal('filename');
  });

  it('全角を半角に変換', () => {
    expect(sanitizeFileName('ファイル２０２５')).to.equal('ファイル2025');
  });

  it('連続アンダースコアを統一', () => {
    expect(sanitizeFileName('test___file')).to.equal('test_file');
  });

  it('空白をアンダースコアに変換', () => {
    expect(sanitizeFileName('test file name')).to.equal('test_file_name');
  });

  it('先頭・末尾のアンダースコアを除去', () => {
    expect(sanitizeFileName('__test__')).to.equal('test');
  });

  it('最大長で切り詰め', () => {
    const longName = 'a'.repeat(150);
    const result = sanitizeFileName(longName, 100);
    expect(result.length).to.be.at.most(100);
  });

  it('空文字列を処理', () => {
    expect(sanitizeFileName('')).to.equal('');
  });
});

describe('formatDateForFileName', () => {
  it('スラッシュ形式をYYYYMMDDに変換', () => {
    expect(formatDateForFileName('2025/01/18')).to.equal('20250118');
  });

  it('ハイフン形式をYYYYMMDDに変換', () => {
    expect(formatDateForFileName('2025-01-18')).to.equal('20250118');
  });

  it('空文字列を処理', () => {
    expect(formatDateForFileName('')).to.equal('');
  });
});

describe('shortenDocumentId', () => {
  it('デフォルト6文字に短縮', () => {
    expect(shortenDocumentId('abc123def456')).to.equal('abc123');
  });

  it('指定長に短縮', () => {
    expect(shortenDocumentId('abc123def456', 8)).to.equal('abc123de');
  });

  it('短いIDはそのまま', () => {
    expect(shortenDocumentId('abc')).to.equal('abc');
  });

  it('空文字列を処理', () => {
    expect(shortenDocumentId('')).to.equal('');
  });
});

describe('generateOptimalFileName', () => {
  it('基本形式のファイル名を生成', () => {
    const result = generateOptimalFileName({
      documentType: '介護保険被保険者証',
      officeName: 'テストケア',
      date: '2025/01/18',
      customers: [customer1],
    });

    expect(result.fileName).to.include('介護保険被保険者証');
    expect(result.fileName).to.include('テストケア');
    expect(result.fileName).to.include('20250118');
    expect(result.fileName).to.include('山田太郎');
    expect(result.fileName).to.include('.pdf');
    expect(result.shouldSplit).to.be.false;
  });

  it('複数顧客（同属性）のファイル名を生成', () => {
    const result = generateOptimalFileName({
      documentType: '請求書',
      date: '2025/01/18',
      customers: [customer1, customer2],
    });

    expect(result.fileName).to.include('山田太郎');
    expect(result.fileName).to.include('鈴木花子');
    expect(result.includedCustomers).to.have.lengthOf(2);
    expect(result.shouldSplit).to.be.false;
  });

  it('複数顧客（異属性）で分割推奨', () => {
    const result = generateOptimalFileName({
      documentType: '請求書',
      customers: [customer1, customer3],
    });

    expect(result.shouldSplit).to.be.true;
    expect(result.splitReason).to.not.be.undefined;
  });

  it('4名以上で省略表記', () => {
    const customers = [
      { id: 'c1', name: '顧客1', officeId: 'off1', careManagerId: 'cm1' },
      { id: 'c2', name: '顧客2', officeId: 'off1', careManagerId: 'cm1' },
      { id: 'c3', name: '顧客3', officeId: 'off1', careManagerId: 'cm1' },
      { id: 'c4', name: '顧客4', officeId: 'off1', careManagerId: 'cm1' },
    ];
    const result = generateOptimalFileName({
      documentType: '請求書',
      customers,
    });

    expect(result.fileName).to.include('他1名');
    expect(result.includedCustomers).to.have.lengthOf(3);
    expect(result.omittedCustomers).to.have.lengthOf(1);
  });

  it('ドキュメントIDを短縮形で追加', () => {
    const result = generateOptimalFileName({
      documentType: '請求書',
      documentId: 'abcdef123456',
    });

    expect(result.fileName).to.include('abcdef');
    expect(result.fileName).not.to.include('123456');
  });

  it('拡張子をカスタマイズ', () => {
    const result = generateOptimalFileName({
      documentType: 'テスト',
      extension: '.txt',
    });

    expect(result.fileName).to.include('.txt');
    expect(result.fileName).not.to.include('.pdf');
  });

  it('空のオプションでも動作', () => {
    const result = generateOptimalFileName({});
    expect(result.fileName).to.equal('.pdf');
  });
});

describe('generateUniqueFileName', () => {
  it('衝突がなければそのまま', () => {
    const result = generateUniqueFileName('test', '.pdf', ['other.pdf']);
    expect(result).to.equal('test.pdf');
  });

  it('衝突時にサフィックスを追加', () => {
    const result = generateUniqueFileName('test', '.pdf', ['test.pdf']);
    expect(result).to.equal('test_1.pdf');
  });

  it('連続衝突時にインクリメント', () => {
    const result = generateUniqueFileName('test', '.pdf', ['test.pdf', 'test_1.pdf', 'test_2.pdf']);
    expect(result).to.equal('test_3.pdf');
  });
});

describe('generateSplitFileNames', () => {
  it('分割ファイル名を生成', () => {
    const results = generateSplitFileNames(
      { documentType: '請求書', date: '2025/01/18' },
      [
        { customers: [customer1], pageRange: { start: 1, end: 2 } },
        { customers: [customer2], pageRange: { start: 3, end: 4 } },
      ]
    );

    expect(results).to.have.lengthOf(2);
    expect(results[0]!.fileName).to.include('山田太郎');
    expect(results[1]!.fileName).to.include('鈴木花子');
  });
});

describe('parseFileName', () => {
  it('標準形式のファイル名をパース', () => {
    const result = parseFileName('請求書_テストケア_20250118_山田太郎.pdf');

    expect(result.documentType).to.equal('請求書');
    expect(result.officeName).to.equal('テストケア');
    expect(result.date).to.equal('2025/01/18');
    expect(result.customerNames).to.include('山田太郎');
    expect(result.extension).to.equal('.pdf');
  });

  it('拡張子なしをパース', () => {
    const result = parseFileName('テスト_ファイル');

    expect(result.extension).to.equal('');
    expect(result.documentType).to.equal('テスト');
  });

  it('日付なしをパース', () => {
    const result = parseFileName('請求書_山田太郎.pdf');

    expect(result.documentType).to.equal('請求書');
    expect(result.date).to.be.undefined;
  });
});
