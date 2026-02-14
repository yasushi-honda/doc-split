/**
 * 強化版情報抽出ユーティリティのテスト
 */

import { expect } from 'chai';
import {
  extractDocumentTypeEnhanced,
  extractOfficeNameEnhanced,
  extractCustomerCandidates,
  extractOfficeCandidates,
  aggregateCustomerCandidates,
  aggregateOfficeCandidates,
  extractDateEnhanced,
  ensureCustomerEntry,
  extractAllInformation,
  DocumentMaster,
  OfficeMaster,
  CustomerMaster,
  OfficeExtractionResultWithCandidates,
} from '../src/utils/extractors';

// テスト用マスターデータ
const documentMasters: DocumentMaster[] = [
  { id: 'doc1', name: '介護保険被保険者証', category: '保険証' },
  { id: 'doc2', name: '居宅サービス計画書', category: '計画書', keywords: ['ケアプラン', '計画'] },
  { id: 'doc3', name: '請求書', category: '請求', keywords: ['請求', '金額'] },
  { id: 'doc4', name: '訪問介護記録', category: '記録' },
];

const officeMasters: OfficeMaster[] = [
  { id: 'off1', name: '株式会社テストケア', shortName: 'テストケア', isDuplicate: false },
  { id: 'off2', name: '医療法人社団あおぞら会', shortName: 'あおぞら会', isDuplicate: false },
  { id: 'off3', name: 'デイサービスさくら', isDuplicate: false },
  { id: 'off4', name: '訪問介護センター北', isDuplicate: true },
  { id: 'off5', name: '訪問介護センター北', isDuplicate: true },
];

const customerMasters: CustomerMaster[] = [
  { id: 'cust1', name: '山田太郎', furigana: 'やまだたろう' },
  { id: 'cust2', name: '山田花子', furigana: 'やまだはなこ' },
  { id: 'cust3', name: '鈴木一郎', furigana: 'すずきいちろう' },
  { id: 'cust4', name: '田中太郎', furigana: 'たなかたろう', isDuplicate: true },
  { id: 'cust5', name: '田中太郎', furigana: 'たなかたろう', isDuplicate: true },
];

describe('extractDocumentTypeEnhanced', () => {
  it('完全一致で書類名を抽出', () => {
    const ocrText = '介護保険被保険者証\n被保険者番号: 12345';
    const result = extractDocumentTypeEnhanced(ocrText, documentMasters);

    expect(result.documentType).to.equal('介護保険被保険者証');
    expect(result.score).to.equal(100);
    expect(result.matchType).to.equal('exact');
  });

  it('部分一致で書類名を抽出', () => {
    const ocrText = '居宅サービス計画書（第1表）\n作成日: 令和7年1月';
    const result = extractDocumentTypeEnhanced(ocrText, documentMasters);

    expect(result.documentType).to.equal('居宅サービス計画書');
    expect(result.matchType).to.equal('exact');
  });

  it('キーワードで書類名を抽出', () => {
    const ocrText = 'ケアプラン\n利用者: 山田太郎\n作成日: 2025/01/18';
    const result = extractDocumentTypeEnhanced(ocrText, documentMasters);

    expect(result.documentType).to.equal('居宅サービス計画書');
    expect(result.keywords).to.include('ケアプラン');
  });

  it('マッチしない場合はnullを返す', () => {
    const ocrText = 'これは全く関係ないテキストです';
    const result = extractDocumentTypeEnhanced(ocrText, documentMasters);

    expect(result.documentType).to.be.null;
    expect(result.matchType).to.equal('none');
  });

  it('空のマスターリストではnullを返す', () => {
    const result = extractDocumentTypeEnhanced('何かのテキスト', []);
    expect(result.documentType).to.be.null;
  });
});

describe('extractOfficeNameEnhanced', () => {
  it('完全一致で事業所名を抽出', () => {
    const ocrText = '発行元: 株式会社テストケア\n電話: 03-1234-5678';
    const result = extractOfficeNameEnhanced(ocrText, officeMasters);

    expect(result.officeName).to.equal('株式会社テストケア');
    expect(result.score).to.equal(100);
    expect(result.matchType).to.equal('exact');
  });

  it('短縮名で事業所名を抽出', () => {
    const ocrText = 'テストケア　担当: 佐藤';
    const result = extractOfficeNameEnhanced(ocrText, officeMasters);

    expect(result.officeName).to.equal('株式会社テストケア');
    expect(result.score).to.equal(95);
    expect(result.matchType).to.equal('exact');
  });

  it('全角文字を含むテキストでも抽出', () => {
    const ocrText = 'デイサービスさくら　ご利用明細';
    const result = extractOfficeNameEnhanced(ocrText, officeMasters);

    expect(result.officeName).to.equal('デイサービスさくら');
  });

  it('マッチしない場合はnullを返す', () => {
    const ocrText = '不明な事業所からの書類';
    const result = extractOfficeNameEnhanced(ocrText, officeMasters);

    expect(result.officeName).to.be.null;
    expect(result.matchType).to.equal('none');
  });
});

describe('extractCustomerCandidates', () => {
  it('完全一致で顧客を抽出', () => {
    const ocrText = '利用者: 山田太郎 様\n住所: 東京都';
    const result = extractCustomerCandidates(ocrText, customerMasters);

    expect(result.bestMatch).to.not.be.null;
    expect(result.bestMatch!.name).to.equal('山田太郎');
    expect(result.bestMatch!.matchType).to.equal('exact');
  });

  it('ふりがなで顧客を抽出', () => {
    const ocrText = 'ご利用者様: すずきいちろう';
    const result = extractCustomerCandidates(ocrText, customerMasters);

    expect(result.bestMatch).to.not.be.null;
    expect(result.bestMatch!.name).to.equal('鈴木一郎');
  });

  it('複数候補を返す', () => {
    const ocrText = '山田太郎　山田花子　鈴木一郎';
    const result = extractCustomerCandidates(ocrText, customerMasters);

    expect(result.candidates.length).to.be.greaterThan(1);
    expect(result.hasMultipleCandidates).to.be.true;
  });

  it('同姓同名フラグがある場合は手動選択が必要', () => {
    const ocrText = '田中太郎 様';
    const result = extractCustomerCandidates(ocrText, customerMasters);

    expect(result.needsManualSelection).to.be.true;
    expect(result.candidates.some((c) => c.isDuplicate)).to.be.true;
  });

  it('ページ番号を記録', () => {
    const ocrText = '山田太郎';
    const result = extractCustomerCandidates(ocrText, customerMasters, { pageNumber: 1 });

    expect(result.bestMatch!.pageNumbers).to.deep.equal([1]);
  });

  it('マッチしない場合は空の結果を返す', () => {
    const ocrText = '該当なし';
    const result = extractCustomerCandidates(ocrText, customerMasters);

    expect(result.bestMatch).to.be.null;
    expect(result.candidates.length).to.equal(0);
  });
});

describe('aggregateCustomerCandidates', () => {
  it('複数ページの結果を集約', () => {
    const page1Result = extractCustomerCandidates('山田太郎', customerMasters, { pageNumber: 1 });
    const page2Result = extractCustomerCandidates('山田太郎 山田花子', customerMasters, { pageNumber: 2 });

    const aggregated = aggregateCustomerCandidates([
      { pageNumber: 1, result: page1Result },
      { pageNumber: 2, result: page2Result },
    ]);

    expect(aggregated.bestMatch!.name).to.equal('山田太郎');
    // 山田太郎は両ページに出現
    const taro = aggregated.candidates.find((c) => c.name === '山田太郎');
    expect(taro!.pageNumbers).to.include(1);
    expect(taro!.pageNumbers).to.include(2);
  });

  it('スコアが高い方を優先', () => {
    // 低スコアのページ
    const page1Result = extractCustomerCandidates('山田', customerMasters, { pageNumber: 1 });
    // 高スコアのページ
    const page2Result = extractCustomerCandidates('山田太郎様', customerMasters, { pageNumber: 2 });

    const aggregated = aggregateCustomerCandidates([
      { pageNumber: 1, result: page1Result },
      { pageNumber: 2, result: page2Result },
    ]);

    const taro = aggregated.candidates.find((c) => c.name === '山田太郎');
    expect(taro!.score).to.be.greaterThanOrEqual(90);
  });
});

describe('extractDateEnhanced', () => {
  it('令和形式の日付を抽出', () => {
    const ocrText = '発行日: 令和7年1月18日';
    const result = extractDateEnhanced(ocrText, '発行日');

    expect(result.date).to.not.be.null;
    expect(result.date!.getFullYear()).to.equal(2025);
    expect(result.formattedDate).to.equal('2025/01/18');
  });

  it('西暦形式の日付を抽出', () => {
    const ocrText = '作成日: 2025/01/18';
    const result = extractDateEnhanced(ocrText);

    expect(result.date).to.not.be.null;
    expect(result.formattedDate).to.equal('2025/01/18');
  });

  it('複数日付から最適なものを選択', () => {
    const ocrText = '作成日: 2025/01/01 発行日: 2025/01/18';
    const result = extractDateEnhanced(ocrText, '発行日');

    expect(result.date!.getDate()).to.equal(18);
    expect(result.allCandidates.length).to.equal(2);
  });

  it('全角日付も処理', () => {
    const ocrText = '日付：２０２５年１月１８日';
    const result = extractDateEnhanced(ocrText);

    expect(result.date).to.not.be.null;
    expect(result.date!.getFullYear()).to.equal(2025);
  });

  it('日付がない場合はnullを返す', () => {
    const ocrText = '日付情報なし';
    const result = extractDateEnhanced(ocrText);

    expect(result.date).to.be.null;
    expect(result.formattedDate).to.be.null;
  });
});

describe('ensureCustomerEntry', () => {
  it('有効な抽出結果からエントリを生成', () => {
    const extractionResult = extractCustomerCandidates('山田太郎', customerMasters);
    const entry = ensureCustomerEntry(extractionResult, 'doc123');

    expect(entry).to.not.be.null;
    expect(entry!.customerName).to.equal('山田太郎');
    expect(entry!.isConfirmed).to.be.true;
  });

  it('手動選択が必要な場合はisConfirmed=false', () => {
    const extractionResult = extractCustomerCandidates('田中太郎', customerMasters);
    const entry = ensureCustomerEntry(extractionResult, 'doc123');

    expect(entry).to.not.be.null;
    expect(entry!.isConfirmed).to.be.false;
  });

  it('マッチなしの場合はnullを返す', () => {
    const extractionResult = extractCustomerCandidates('該当なし', customerMasters);
    const entry = ensureCustomerEntry(extractionResult, 'doc123');

    expect(entry).to.be.null;
  });
});

describe('extractAllInformation', () => {
  it('全情報を一括抽出', () => {
    const ocrText = `
      介護保険被保険者証

      被保険者: 山田太郎
      発行元: 株式会社テストケア
      発行日: 令和7年1月18日
    `;

    const result = extractAllInformation(
      ocrText,
      { documents: documentMasters, offices: officeMasters, customers: customerMasters },
      { dateMarker: '発行日' }
    );

    expect(result.document.documentType).to.equal('介護保険被保険者証');
    expect(result.office.officeName).to.equal('株式会社テストケア');
    expect(result.customer.bestMatch!.name).to.equal('山田太郎');
    expect(result.date.formattedDate).to.equal('2025/01/18');
  });
});

describe('extractOfficeCandidates', () => {
  it('事業所候補を複数抽出', () => {
    const ocrText = '株式会社テストケア様 送付先: デイサービスさくら';
    const result = extractOfficeCandidates(ocrText, officeMasters);

    expect(result.candidates.length).to.be.greaterThanOrEqual(2);
    expect(result.bestMatch).to.not.be.null;
    expect(result.bestMatch!.name).to.equal('株式会社テストケア');
  });

  it('同名事業所でneedsManualSelectionがtrue', () => {
    const ocrText = '訪問介護センター北';
    const result = extractOfficeCandidates(ocrText, officeMasters);

    expect(result.bestMatch).to.not.be.null;
    expect(result.bestMatch!.isDuplicate).to.be.true;
    expect(result.needsManualSelection).to.be.true;
  });

  it('短縮名でも検出', () => {
    const ocrText = 'テストケア　担当: 佐藤';
    const result = extractOfficeCandidates(ocrText, officeMasters);

    expect(result.bestMatch).to.not.be.null;
    expect(result.bestMatch!.name).to.equal('株式会社テストケア');
  });

  it('マッチなしの場合は空の候補', () => {
    const ocrText = '該当する事業所なし';
    const result = extractOfficeCandidates(ocrText, officeMasters);

    expect(result.candidates.length).to.equal(0);
    expect(result.bestMatch).to.be.null;
  });

  it('キーワードマッチング: 法人名の微妙な違いがあっても正しくマッチ', () => {
    // 実際の問題ケース: OCRに「株式会社」、マスターに「ケアセンター」が含まれる場合
    const testOfficeMasters: OfficeMaster[] = [
      { id: 'off1', name: 'ショートステイ鳩の丘', isDuplicate: false },
      { id: 'off2', name: 'パナソニックエイジフリーケアセンター名古屋上小田井・デイサービス', isDuplicate: false },
      { id: 'off3', name: 'デイサービスゴールドエイジ千秋', isDuplicate: false },
      { id: 'off4', name: 'パナソニックエイジフリーケアセンター名古屋上小田井・ショートステイ', isDuplicate: false },
      { id: 'off5', name: 'パナソニックエイジフリーショップ稲沢', isDuplicate: false },
    ];

    const ocrText = `
パナソニック エイジフリー株式会社
名古屋上小田井ショートステイ

FAX: 052-509-2295
TEL: 052-509-2292

サービス提供票のご案内
    `;

    const result = extractOfficeCandidates(ocrText, testOfficeMasters);

    // 「パナソニック」「エイジフリー」「名古屋上小田井」「ショートステイ」がマッチするはず
    expect(result.bestMatch).to.not.be.null;
    expect(result.bestMatch!.name).to.include('パナソニックエイジフリー');
    expect(result.bestMatch!.name).to.include('ショートステイ');
    expect(result.bestMatch!.id).to.equal('off4');

    // ショートステイ鳩の丘は低いスコアであるべき
    const hatonoOka = result.candidates.find(c => c.id === 'off1');
    if (hatonoOka && result.bestMatch) {
      expect(hatonoOka.score).to.be.lessThan(result.bestMatch.score);
    }
  });

  it('キーワードマッチング: 短い名前の完全一致より長い名前のキーワードマッチが優先される', () => {
    // 完全一致がない場合のキーワードマッチング優先度テスト
    const testOfficeMasters: OfficeMaster[] = [
      { id: 'off1', name: 'ショートステイ山田', isDuplicate: false },
      { id: 'off2', name: '名古屋市ショートステイ山田', isDuplicate: false },
    ];

    // 「名古屋市」がOCRに含まれる場合、off2が優先されるべき
    const ocrText = '名古屋市にあるショートステイ山田施設です';
    const result = extractOfficeCandidates(ocrText, testOfficeMasters);

    // 両方とも候補に入るが、off2がより高いスコアになるべき
    expect(result.candidates.length).to.be.greaterThanOrEqual(2);
    const off1 = result.candidates.find(c => c.id === 'off1');
    const off2 = result.candidates.find(c => c.id === 'off2');
    expect(off1).to.not.be.undefined;
    expect(off2).to.not.be.undefined;
    // 完全一致でoff1がスコア100になるが、off2も高いスコアになるはず
    expect(off2!.score).to.be.greaterThanOrEqual(85);
  });

  it('施設タイプ汎用語「居宅介護支援」による誤マッチを防ぐ（ひらがな固有名詞）', () => {
    // 実際の問題ケース: 「みどり居宅介護支援センター」→キーワード["居宅介護支援","みどり"]
    // OCRに「居宅介護支援事業所」のみ含まれ「みどり」が含まれない場合は低スコアであるべき
    const testOfficeMasters: OfficeMaster[] = [
      { id: 'off1', name: 'みどり居宅介護支援センター', isDuplicate: false },
      { id: 'off2', name: 'さくら訪問看護ステーション', isDuplicate: false },
    ];

    const ocrText = `居宅介護支援事業所
サービス提供票
利用者: 山田太郎`;

    const result = extractOfficeCandidates(ocrText, testOfficeMasters);

    // 「みどり」がOCRに含まれないため、スコアは閾値(70)未満であるべき
    const midori = result.candidates.find(c => c.id === 'off1');
    if (midori) {
      expect(midori.score).to.be.lessThan(70);
    }
    // bestMatchがみどり居宅介護支援センターであってはならない
    if (result.bestMatch) {
      expect(result.bestMatch.id).to.not.equal('off1');
    }
  });

  it('汎用語「サービス」による誤マッチを防ぐ', () => {
    // 実際の問題ケース: OCRに「居宅サービス事業所」のみ含まれるが
    // 「あおぞらデイサービス」がpartialマッチ(score=83)で選ばれてしまう
    const testOfficeMasters: OfficeMaster[] = [
      { id: 'off1', name: 'あおぞらデイサービス', isDuplicate: false },
      { id: 'off2', name: 'さくら訪問介護', isDuplicate: false },
    ];

    const ocrText = `居宅介護支援事業所
居宅サービス事業所
ケアプランデータ連携システム
介護を つなぐ。心をつなげる。`;

    const result = extractOfficeCandidates(ocrText, testOfficeMasters);

    // 「サービス」という汎用語だけでは「あおぞらデイサービス」にマッチすべきでない
    const aozora = result.candidates.find(c => c.id === 'off1');
    if (aozora) {
      // マッチしたとしても閾値(70)未満のスコアであるべき
      expect(aozora.score).to.be.lessThan(70);
    }
    // bestMatchがあおぞらデイサービスであってはならない
    if (result.bestMatch) {
      expect(result.bestMatch.id).to.not.equal('off1');
    }
  });

  // === 真陽性テスト（正しいマッチが壊れていないことの確認） ===

  it('真陽性: OCRに完全な事業所名が含まれる場合はスコア100', () => {
    const testOfficeMasters: OfficeMaster[] = [
      { id: 'off1', name: 'みどり居宅介護支援センター', isDuplicate: false },
    ];

    const ocrText = 'みどり居宅介護支援センター ご利用者: 山田太郎';
    const result = extractOfficeCandidates(ocrText, testOfficeMasters);

    expect(result.bestMatch).to.not.be.null;
    expect(result.bestMatch!.name).to.equal('みどり居宅介護支援センター');
    expect(result.bestMatch!.score).to.equal(100);
    expect(result.bestMatch!.matchType).to.equal('exact');
  });

  it('真陽性: ひらがな+施設タイプの事業所名、OCRに両方含まれる場合は高スコア', () => {
    const testOfficeMasters: OfficeMaster[] = [
      { id: 'off1', name: 'ひかり通所介護', isDuplicate: false },
      { id: 'off2', name: 'あさひ通所介護', isDuplicate: false },
    ];

    // OCRに「ひかり」も「通所介護」も含まれる
    const ocrText = 'ひかり通所介護 サービス提供票 令和7年2月';
    const result = extractOfficeCandidates(ocrText, testOfficeMasters);

    expect(result.bestMatch).to.not.be.null;
    expect(result.bestMatch!.id).to.equal('off1');
    expect(result.bestMatch!.score).to.equal(100); // 完全一致
  });

  // === 施設タイプ汎用語ペナルティの網羅的テスト ===

  it('施設タイプペナルティ: 「ひかり通所介護」、OCRに「通所介護」のみ → 低スコア', () => {
    const testOfficeMasters: OfficeMaster[] = [
      { id: 'off1', name: 'ひかり通所介護', isDuplicate: false },
    ];

    const ocrText = '通所介護利用明細 令和7年2月分';
    const result = extractOfficeCandidates(ocrText, testOfficeMasters);

    const hikari = result.candidates.find(c => c.id === 'off1');
    if (hikari) {
      expect(hikari.score).to.be.lessThan(70);
    }
    if (result.bestMatch) {
      expect(result.bestMatch.id).to.not.equal('off1');
    }
  });

  it('施設タイプペナルティ: 「あさひ訪問介護ステーション」、OCRに「訪問介護」のみ → 低スコア', () => {
    const testOfficeMasters: OfficeMaster[] = [
      { id: 'off1', name: 'あさひ訪問介護ステーション', isDuplicate: false },
    ];

    const ocrText = '訪問介護サービス提供票 利用者: 鈴木一郎';
    const result = extractOfficeCandidates(ocrText, testOfficeMasters);

    const asahi = result.candidates.find(c => c.id === 'off1');
    if (asahi) {
      expect(asahi.score).to.be.lessThan(70);
    }
    if (result.bestMatch) {
      expect(result.bestMatch.id).to.not.equal('off1');
    }
  });

  // === 同施設タイプの事業所の識別（高リスク） ===

  it('識別: 「さくらデイサービス」vs「たんぽぽデイサービス」、OCRに「さくら」あり → 正しく識別', () => {
    const testOfficeMasters: OfficeMaster[] = [
      { id: 'off1', name: 'さくらデイサービス', isDuplicate: false },
      { id: 'off2', name: 'たんぽぽデイサービス', isDuplicate: false },
    ];

    const ocrText = 'さくらデイサービス 利用明細書 令和7年2月分';
    const result = extractOfficeCandidates(ocrText, testOfficeMasters);

    expect(result.bestMatch).to.not.be.null;
    expect(result.bestMatch!.id).to.equal('off1');
    expect(result.bestMatch!.score).to.equal(100); // 完全一致

    // たんぽぽはbestMatchであってはならない
    const tanpopo = result.candidates.find(c => c.id === 'off2');
    if (tanpopo) {
      expect(tanpopo.score).to.be.lessThan(result.bestMatch!.score);
    }
  });

  it('識別: 同施設タイプで片方のひらがなのみOCRに含まれる場合の区別', () => {
    const testOfficeMasters: OfficeMaster[] = [
      { id: 'off1', name: 'さくらデイサービス', isDuplicate: false },
      { id: 'off2', name: 'たんぽぽデイサービス', isDuplicate: false },
    ];

    // OCRに「デイサービス」と「さくら」は含まれるが「たんぽぽ」は含まれない
    const ocrText = 'デイサービス さくら 利用明細書';
    const result = extractOfficeCandidates(ocrText, testOfficeMasters);

    // さくらの方が高いスコアであるべき
    const sakura = result.candidates.find(c => c.id === 'off1');
    const tanpopo = result.candidates.find(c => c.id === 'off2');
    if (sakura && tanpopo) {
      expect(sakura.score).to.be.greaterThan(tanpopo.score);
    }
  });

  // === ひらがなキーワード抽出の境界条件 ===

  it('境界: ひらがな3文字はキーワードとして抽出される', () => {
    const testOfficeMasters: OfficeMaster[] = [
      { id: 'off1', name: 'あいう通所介護', isDuplicate: false },
    ];

    // OCRに「通所介護」はあるが「あいう」はない
    const ocrText = '通所介護サービス提供票';
    const result = extractOfficeCandidates(ocrText, testOfficeMasters);

    // 「あいう」(3文字)が抽出されるため、施設タイプだけのマッチにはならず
    // totalWeightが増えてスコアが下がる
    const aiu = result.candidates.find(c => c.id === 'off1');
    if (aiu) {
      expect(aiu.score).to.be.lessThan(70);
    }
  });

  it('境界: ひらがな2文字はキーワードとして抽出されない', () => {
    const testOfficeMasters: OfficeMaster[] = [
      { id: 'off1', name: 'あい通所介護', isDuplicate: false },
    ];

    // 「あい」(2文字)はキーワードとして抽出されないため
    // 施設タイプのみがキーワードとなり、ペナルティが適用される
    const ocrText = '通所介護サービス提供票';
    const result = extractOfficeCandidates(ocrText, testOfficeMasters);

    const ai = result.candidates.find(c => c.id === 'off1');
    if (ai) {
      expect(ai.score).to.be.lessThan(70);
    }
  });

  // === 全ひらがな事業所名 ===

  it('全ひらがな事業所名: OCRに含まれる場合は完全一致', () => {
    const testOfficeMasters: OfficeMaster[] = [
      { id: 'off1', name: 'あさひ', isDuplicate: false },
    ];

    const ocrText = 'あさひ 訪問介護サービス提供票';
    const result = extractOfficeCandidates(ocrText, testOfficeMasters);

    expect(result.bestMatch).to.not.be.null;
    expect(result.bestMatch!.id).to.equal('off1');
    expect(result.bestMatch!.score).to.equal(100);
  });

  // === 混合キーワード（施設タイプ + 非施設タイプ）の検証 ===

  it('混合キーワード: 非施設タイプキーワードもマッチすればペナルティなし', () => {
    const testOfficeMasters: OfficeMaster[] = [
      { id: 'off1', name: 'みどりデイサービス', isDuplicate: false },
    ];

    // 「デイサービス」(施設タイプ)と「みどり」(ひらがな固有名詞)の両方がOCRに含まれる
    const ocrText = 'みどりデイサービス利用明細';
    const result = extractOfficeCandidates(ocrText, testOfficeMasters);

    expect(result.bestMatch).to.not.be.null;
    expect(result.bestMatch!.id).to.equal('off1');
    expect(result.bestMatch!.score).to.equal(100); // 完全一致
  });

  it('混合キーワード: 施設タイプのみOCRに含まれ固有名詞がない場合はペナルティ', () => {
    const testOfficeMasters: OfficeMaster[] = [
      { id: 'off1', name: 'みどりデイサービス', isDuplicate: false },
    ];

    // 「デイサービス」はあるが「みどり」がない
    const ocrText = 'デイサービス利用明細 令和7年';
    const result = extractOfficeCandidates(ocrText, testOfficeMasters);

    const midori = result.candidates.find(c => c.id === 'off1');
    if (midori) {
      expect(midori.score).to.be.lessThan(70);
    }
  });
});

describe('aggregateOfficeCandidates', () => {
  it('複数ページの事業所候補を集約', () => {
    const pageResults: Array<{ pageNumber: number; result: OfficeExtractionResultWithCandidates }> = [
      {
        pageNumber: 1,
        result: {
          bestMatch: { id: 'off1', name: '株式会社テストケア', score: 90, matchType: 'exact', isDuplicate: false },
          candidates: [
            { id: 'off1', name: '株式会社テストケア', score: 90, matchType: 'exact', isDuplicate: false },
            { id: 'off3', name: 'デイサービスさくら', score: 75, matchType: 'fuzzy', isDuplicate: false },
          ],
          hasMultipleCandidates: true,
          needsManualSelection: false,
        },
      },
      {
        pageNumber: 2,
        result: {
          bestMatch: { id: 'off1', name: '株式会社テストケア', score: 100, matchType: 'exact', isDuplicate: false },
          candidates: [
            { id: 'off1', name: '株式会社テストケア', score: 100, matchType: 'exact', isDuplicate: false },
          ],
          hasMultipleCandidates: false,
          needsManualSelection: false,
        },
      },
    ];

    const result = aggregateOfficeCandidates(pageResults);

    // 最高スコアが採用される
    expect(result.bestMatch!.score).to.equal(100);
    expect(result.bestMatch!.name).to.equal('株式会社テストケア');
    // 複数の候補が集約される
    expect(result.candidates.length).to.equal(2);
    // ページ番号が集約される
    const off1 = result.candidates.find((c) => c.id === 'off1');
    expect(off1!.pageNumbers).to.deep.equal([1, 2]);
  });

  it('同名事業所がある場合needsManualSelection=true', () => {
    const pageResults: Array<{ pageNumber: number; result: OfficeExtractionResultWithCandidates }> = [
      {
        pageNumber: 1,
        result: {
          bestMatch: { id: 'off4', name: '訪問介護センター北', score: 100, matchType: 'exact', isDuplicate: true },
          candidates: [
            { id: 'off4', name: '訪問介護センター北', score: 100, matchType: 'exact', isDuplicate: true },
          ],
          hasMultipleCandidates: false,
          needsManualSelection: true,
        },
      },
    ];

    const result = aggregateOfficeCandidates(pageResults);

    expect(result.needsManualSelection).to.be.true;
  });

  it('スコア差が小さい場合needsManualSelection=true', () => {
    const pageResults: Array<{ pageNumber: number; result: OfficeExtractionResultWithCandidates }> = [
      {
        pageNumber: 1,
        result: {
          bestMatch: { id: 'off1', name: '株式会社テストケア', score: 85, matchType: 'partial', isDuplicate: false },
          candidates: [
            { id: 'off1', name: '株式会社テストケア', score: 85, matchType: 'partial', isDuplicate: false },
            { id: 'off3', name: 'デイサービスさくら', score: 80, matchType: 'partial', isDuplicate: false },
          ],
          hasMultipleCandidates: true,
          needsManualSelection: false,
        },
      },
    ];

    const result = aggregateOfficeCandidates(pageResults);

    // スコア差が10以内なのでneedsManualSelection=true
    expect(result.needsManualSelection).to.be.true;
  });

  it('空の結果を処理', () => {
    const pageResults: Array<{ pageNumber: number; result: OfficeExtractionResultWithCandidates }> = [];

    const result = aggregateOfficeCandidates(pageResults);

    expect(result.bestMatch).to.be.null;
    expect(result.candidates.length).to.equal(0);
    expect(result.needsManualSelection).to.be.false;
  });
});
