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
  computeCommonShortMasters,
  arbitrateDocumentType,
  arbitrateOfficeName,
  arbitrateCustomerName,
  arbitrateDate,
  extractFilenameInfo,
  DocumentMaster,
  OfficeMaster,
  CustomerMaster,
  OfficeExtractionResultWithCandidates,
  DocumentExtractionResult,
  CustomerExtractionResult,
  DateExtractionResult,
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

describe('extractFilenameInfo', () => {
  it('数字のみのプレフィックスはphone_number型と判定する', () => {
    const info = extractFilenameInfo('0529088423-L1-20260122104653.pdf');
    expect(info.prefix).to.equal('0529088423');
    expect(info.prefixType).to.equal('phone_number');
  });

  it('DOCで始まるプレフィックスはdocument_id型と判定する', () => {
    const info = extractFilenameInfo('DOC260718-L1-20260718131435.pdf');
    expect(info.prefix).to.equal('DOC260718');
    expect(info.prefixType).to.equal('document_id');
  });

  it('全角文字を含むプレフィックスはoffice_name型と判定する', () => {
    const info = extractFilenameInfo('西春内科在宅クリニック-L1-20260122101727.pdf');
    expect(info.prefix).to.equal('西春内科在宅クリニック');
    expect(info.prefixType).to.equal('office_name');
  });

  // code-review medium指摘・実証済み(Issue #680 Phase B): 半角カナのみのプレフィックスは
  // 修正前は぀-ゟ等の全角判定regexに一致せずunknown型に誤分類され、
  // tokenizer.ts側でbigram検索を失っていた
  it('半角カナのみのプレフィックスもoffice_name型と判定する(レガシーFAX機器のJIS X 0201制約対応)', () => {
    const info = extractFilenameInfo('ﾆｼﾊﾙﾅｲｶｸﾘﾆﾂｸ-L1-20260718131435.pdf');
    expect(info.prefix).to.equal('ﾆｼﾊﾙﾅｲｶｸﾘﾆﾂｸ');
    expect(info.prefixType).to.equal('office_name');
  });

  it('-L\\d+-パターンがない場合はbaseName全体をprefixとする', () => {
    const info = extractFilenameInfo('田中太郎_介護保険.pdf');
    expect(info.prefix).to.equal('田中太郎_介護保険');
    expect(info.prefixType).to.equal('office_name');
  });

  it('拡張子のみの場合はunknown型・空prefixを返す', () => {
    const info = extractFilenameInfo('.pdf');
    expect(info.prefix).to.equal('');
    expect(info.prefixType).to.equal('unknown');
  });

  it('空文字列の場合はエラーを投げずunknown型・空prefixを返す', () => {
    const info = extractFilenameInfo('');
    expect(info.prefix).to.equal('');
    expect(info.prefixType).to.equal('unknown');
  });

  // Issue #686: fax gateway由来ファイル名は`{prefix}-L{レーン番号}-{YYYYMMDDHHMMSS}`形式
  // (14桁タイムスタンプ必須)。非fax由来ファイル名が偶然`-L\d+-`様の部分文字列を含む場合、
  // 後続が14桁タイムスタンプでなければfax由来と誤判定してはならない
  it('-L\\d+-の直後が14桁タイムスタンプでない場合は誤判定せずbaseName全体をprefixとする', () => {
    const info = extractFilenameInfo('見積書-L1000-final.pdf');
    expect(info.prefix).to.equal('見積書-L1000-final');
  });

  it('-L\\d+-の直後の数字が14桁に満たない場合も誤判定せずbaseName全体をprefixとする', () => {
    const info = extractFilenameInfo('資料-L5-2026.pdf');
    expect(info.prefix).to.equal('資料-L5-2026');
  });
});

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
    // #501 v2: collision-based 抑制方式では length 単独で drop しないため、
    // 衝突がなければ 3 文字 hiragana name も exact 認定される (legitimate 保護)
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

  // #501 v2: 短文字列マスター ("ケア" / "ニック" 等) が長マスター name の substring に
  // 頻出する場合 (collision >= 2) は「common short master」と判定し exact match から除外。
  // length 単独でなく collision 数で動的判定するため legitimate 短マスター ("ピース" "てらす"
  // 等、cocoro/kanameone 実在で collision=0-1) はそのまま動作する。
  describe('#501 v2 common short master 抑制', () => {
    it('"ケア" マスターは他マスターの substring に頻出 (collision>=2) → bug マスターと判定され exact 認定されない', () => {
      const testMasters: OfficeMaster[] = [
        { id: 'bug-care', name: 'ケア', isDuplicate: false },
        { id: 'long-1', name: 'ニチイケアセンター岩倉', isDuplicate: false },
        { id: 'long-2', name: 'エスケアステーション開明', isDuplicate: false },
      ];
      const ocrText = '発行元: ニチイケアセンター岩倉 担当: 佐藤';
      const result = extractOfficeCandidates(ocrText, testMasters);

      expect(result.bestMatch).to.not.be.null;
      expect(result.bestMatch!.id).to.equal('long-1');
      // bug マスター「ケア」は exact match に到達しない (skip)
      const bug = result.candidates.find((c) => c.id === 'bug-care');
      if (bug) {
        expect(bug.matchType).to.not.equal('exact');
        expect(bug.score).to.be.lessThan(100);
      }
    });

    it('"ニック" マスターはクリニック系の substring に頻出 → 除外', () => {
      const testMasters: OfficeMaster[] = [
        { id: 'bug-nick', name: 'ニック', isDuplicate: false },
        { id: 'long-1', name: '正翔会クリニック小牧', isDuplicate: false },
        { id: 'long-2', name: '木の香往診クリニック', isDuplicate: false },
      ];
      const ocrText = 'クリニック発行: 正翔会クリニック小牧';
      const result = extractOfficeCandidates(ocrText, testMasters);

      expect(result.bestMatch).to.not.be.null;
      expect(result.bestMatch!.id).to.equal('long-1');
      const bug = result.candidates.find((c) => c.id === 'bug-nick');
      if (bug) {
        expect(bug.matchType).to.not.equal('exact');
      }
    });

    it('legitimate な短マスター "ピース" は他マスターと衝突しない → そのまま exact 認定', () => {
      // kanameone 実在事例: 「ピース」(3 文字、Firestore auto ID、12 件運用) は
      // 他マスター name と衝突しないため legitimate に動作する
      const testMasters: OfficeMaster[] = [
        { id: 'legit-piece', name: 'ピース', isDuplicate: false },
        { id: 'unrelated-1', name: 'デイサービスさくら', isDuplicate: false },
        { id: 'unrelated-2', name: '訪問看護ステーション桜', isDuplicate: false },
      ];
      const ocrText = '発行元: ピース 利用明細書';
      const result = extractOfficeCandidates(ocrText, testMasters);

      expect(result.bestMatch).to.not.be.null;
      expect(result.bestMatch!.id).to.equal('legit-piece');
      expect(result.bestMatch!.score).to.equal(100);
      expect(result.bestMatch!.matchType).to.equal('exact');
    });

    it('境界値: 衝突が 1 件のみ → uncommon と判定 (exact 認定可)', () => {
      // COMMON_SHORT_COLLISION_THRESHOLD=2 のため、1 件衝突では skip しない
      const testMasters: OfficeMaster[] = [
        { id: 'short', name: 'ケア', isDuplicate: false },
        { id: 'long-1', name: 'デイケアセンター', isDuplicate: false },
      ];
      const ocrText = 'ケア 担当者報告';
      const result = extractOfficeCandidates(ocrText, testMasters);

      const short = result.candidates.find((c) => c.id === 'short');
      // 「ケア」は他マスター 1 件のみに含まれるので exact 認定される
      expect(short).to.not.be.undefined;
      expect(short!.score).to.equal(100);
    });

    it('長マスター (length>=4) は collision 計算対象外、現状通り exact 認定', () => {
      // 長マスター同士の衝突は本機構の対象外 (短マスターのみが対象)
      const testMasters: OfficeMaster[] = [
        { id: 'long-1', name: 'デイケアセンター', isDuplicate: false },
        { id: 'long-2', name: 'デイケアセンター岩倉', isDuplicate: false },
      ];
      const ocrText = 'デイケアセンター 発行';
      const result = extractOfficeCandidates(ocrText, testMasters);

      expect(result.bestMatch).to.not.be.null;
      expect(result.bestMatch!.score).to.equal(100);
    });

    it('shortName 経路: common short master は exact 認定 skip', () => {
      const testMasters: OfficeMaster[] = [
        { id: 'bug-sn', name: '株式会社テストケア', shortName: 'ケア', isDuplicate: false },
        { id: 'long-1', name: 'ニチイケアセンター岩倉', isDuplicate: false },
        { id: 'long-2', name: 'エスケアステーション開明', isDuplicate: false },
      ];
      // shortName "ケア" がほかマスター name に頻出 → ただし shortName 自体は対象外で
      // bug-sn の name 「株式会社テストケア」(長) は collision 対象外
      // よって短 shortName 経由の skip にはならない仕様 (= 形式名長 ≥4 ならば対象外)
      const ocrText = '株式会社テストケア 利用明細';
      const result = extractOfficeCandidates(ocrText, testMasters);

      // 名前 'ケア' を含む文書では正式名一致 'bug-sn' が score 100 で勝つ
      expect(result.bestMatch).to.not.be.null;
      expect(result.bestMatch!.id).to.equal('bug-sn');
      expect(result.bestMatch!.score).to.equal(100);
    });

    it('aliases 経路: common short master でない長 aliases は exact 認定', () => {
      // 回帰防止: aliases は正規長で正常動作する
      const testMasters: OfficeMaster[] = [
        { id: 'al', name: '正翔会クリニック小牧', aliases: ['正翔クリニック'], isDuplicate: false },
      ];
      const ocrText = '発行元: 正翔クリニック';
      const result = extractOfficeCandidates(ocrText, testMasters);

      expect(result.bestMatch).to.not.be.null;
      expect(result.bestMatch!.id).to.equal('al');
      expect(result.bestMatch!.score).to.equal(98);
      expect(result.bestMatch!.matchType).to.equal('exact');
    });
  });
});

describe('#501 v2 common short master 抑制 (extractOfficeNameEnhanced)', () => {
  it('"ケア" マスターは collision 多 → exact 認定 skip、正規マスターが勝つ', () => {
    const testMasters: OfficeMaster[] = [
      { id: 'bug-care', name: 'ケア', isDuplicate: false },
      { id: 'long-1', name: 'ニチイケアセンター岩倉', isDuplicate: false },
      { id: 'long-2', name: 'エスケアステーション開明', isDuplicate: false },
    ];
    const ocrText = '発行元: ニチイケアセンター岩倉';
    const result = extractOfficeNameEnhanced(ocrText, testMasters);

    expect(result.officeName).to.equal('ニチイケアセンター岩倉');
    expect(result.score).to.equal(100);
  });

  it('legitimate 短マスター "ピース" は collision なし → exact 認定可', () => {
    const testMasters: OfficeMaster[] = [
      { id: 'legit', name: 'ピース', isDuplicate: false },
      { id: 'unrelated', name: 'デイサービスさくら', isDuplicate: false },
    ];
    const ocrText = '発行元: ピース 報告書';
    const result = extractOfficeNameEnhanced(ocrText, testMasters);

    expect(result.officeName).to.equal('ピース');
    expect(result.score).to.equal(100);
    expect(result.matchType).to.equal('exact');
  });
});

describe('#501 v2 computeCommonShortMasters', () => {
  it('短マスター + 衝突 >= 2 → common 集合に含まれる', () => {
    const masters: OfficeMaster[] = [
      { id: 'short', name: 'ケア', isDuplicate: false },
      { id: 'long-1', name: 'デイケアセンター', isDuplicate: false },
      { id: 'long-2', name: 'ニチイケアセンター', isDuplicate: false },
    ];
    const result = computeCommonShortMasters(masters);
    expect(result.has('short')).to.be.true;
    expect(result.has('long-1')).to.be.false;
  });

  it('短マスター + 衝突 < 2 → common 集合に含まれない (legitimate 保護)', () => {
    const masters: OfficeMaster[] = [
      { id: 'short', name: 'ピース', isDuplicate: false },
      { id: 'long', name: 'デイサービスさくら', isDuplicate: false },
    ];
    const result = computeCommonShortMasters(masters);
    expect(result.has('short')).to.be.false;
  });

  it('長マスター (length>=4) は対象外', () => {
    const masters: OfficeMaster[] = [
      { id: 'len-4', name: 'デイケア', isDuplicate: false },
      { id: 'long-1', name: 'デイケアセンター岩倉', isDuplicate: false },
      { id: 'long-2', name: 'デイケアスマイル', isDuplicate: false },
    ];
    const result = computeCommonShortMasters(masters);
    expect(result.has('len-4')).to.be.false;
  });

  it('空マスター配列 → 空集合', () => {
    const result = computeCommonShortMasters([]);
    expect(result.size).to.equal(0);
  });
});

// #506: 本番で発見された bug pattern を fixture から流して回帰テスト
// (classifier collision-based 抑制 + shared validation の意図しない rollback を CI で検出)
import { BUG_OFFICE_MASTER_PATTERNS, LEGITIMATE_SHORT_OFFICE_MASTERS } from './fixtures/bug-masters';

describe('#506 本番 bug pattern 回帰テスト (extractOfficeCandidates)', () => {
  for (const pattern of BUG_OFFICE_MASTER_PATTERNS) {
    it(`${pattern.label}: collision 多 → exact 認定 skip、正規マスターが勝つ`, () => {
      const masters: OfficeMaster[] = [pattern.master, ...pattern.collidingLongMasters];
      // 任意の長マスター name を含む OCR で検証
      const ocrText = `発行元: ${pattern.collidingLongMasters[0]!.name} 担当者報告書`;
      const result = extractOfficeCandidates(ocrText, masters);

      expect(result.bestMatch).to.not.be.null;
      expect(result.bestMatch!.id).to.equal(pattern.collidingLongMasters[0]!.id);
      // bug master は exact 認定されない
      const bugMatch = result.candidates.find((c) => c.id === pattern.master.id);
      if (bugMatch) {
        expect(bugMatch.matchType).to.not.equal('exact');
        expect(bugMatch.score).to.be.lessThan(100);
      }
    });
  }
});

describe('#506 legitimate 短マスター保護 (extractOfficeCandidates)', () => {
  for (const legit of LEGITIMATE_SHORT_OFFICE_MASTERS) {
    it(`"${legit.name}" (length=${legit.name.length}): collision なし → exact 認定 score 100 を取れる`, () => {
      const masters: OfficeMaster[] = [
        legit,
        { id: 'unrelated-1', name: 'デイサービスさくら', isDuplicate: false },
        { id: 'unrelated-2', name: '訪問看護ステーション桜', isDuplicate: false },
      ];
      const ocrText = `発行元: ${legit.name} 利用明細書`;
      const result = extractOfficeCandidates(ocrText, masters);

      expect(result.bestMatch).to.not.be.null;
      expect(result.bestMatch!.id).to.equal(legit.id);
      expect(result.bestMatch!.score).to.equal(100);
      expect(result.bestMatch!.matchType).to.equal('exact');
    });
  }
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

// GOAL.md タスクC: OCR突合arbitration（既存の全文ベース結果とAI候補抽出結果の統合）
describe('arbitrateDocumentType', () => {
  const noneResult: DocumentExtractionResult = {
    documentType: null,
    category: null,
    score: 0,
    matchType: 'none',
    keywords: [],
  };

  it('既存がnoneで候補がgrounding済み+exact一致なら候補に昇格する', () => {
    const fullText = '--- Page 1 ---\n本日付にて請求書を送付いたします。';
    const result = arbitrateDocumentType(noneResult, '請求書', documentMasters, fullText);

    expect(result.documentType).to.equal('請求書');
    expect(result.matchType).to.equal('exact');
    expect(result.provenance.source).to.equal('candidate');
    expect(result.provenance.candidateGrounded).to.be.true;
  });

  it('既存にマッチがあれば候補がexact一致でも上書きしない（誤マスター一致防止）', () => {
    const existing: DocumentExtractionResult = {
      documentType: '介護保険被保険者証',
      category: '保険証',
      score: 100,
      matchType: 'exact',
      keywords: [],
    };
    const fullText = '介護保険被保険者証の写しと共に請求書在中の封筒を同封します。';
    const result = arbitrateDocumentType(existing, '請求書', documentMasters, fullText);

    expect(result.documentType).to.equal('介護保険被保険者証');
    expect(result.provenance.source).to.equal('existing');
  });

  it('候補がfullTextにgroundingされない場合(文字化け想定)は既存を維持する', () => {
    const fullText = '本日付にて請求書を送付いたします。';
    const result = arbitrateDocumentType(noneResult, '舅求書', documentMasters, fullText);

    expect(result.documentType).to.be.null;
    expect(result.provenance.source).to.equal('existing');
    expect(result.provenance.candidateGrounded).to.be.false;
  });

  it('候補がgrounding済みでもキーワード一致(partial)止まりなら昇格しない(exact限定の回帰)', () => {
    const fullText = '本日はケアプランについてご説明します。';
    // 'ケアプラン' は doc2(居宅サービス計画書) の keywords に含まれるため
    // extractDocumentTypeEnhanced への再入力ではキーワード加点でmatchType='partial'になる。
    // exact未満のため昇格しないことを確認する。
    const result = arbitrateDocumentType(noneResult, 'ケアプラン', documentMasters, fullText);

    expect(result.documentType).to.be.null;
    expect(result.provenance.source).to.equal('existing');
  });

  it('候補が空文字列の場合は既存を維持する', () => {
    const fullText = '本日付にて請求書を送付いたします。';
    const result = arbitrateDocumentType(noneResult, '', documentMasters, fullText);

    expect(result.provenance.source).to.equal('existing');
    expect(result.provenance.candidateGrounded).to.be.false;
  });

  it('候補がnullの場合は既存を維持する', () => {
    const fullText = '本日付にて請求書を送付いたします。';
    const result = arbitrateDocumentType(noneResult, null, documentMasters, fullText);

    expect(result.provenance.source).to.equal('existing');
    expect(result.provenance.candidateGrounded).to.be.false;
  });

  it('候補がfullText先頭300文字より後にのみ出現する場合は昇格しない(searchRange制約の回帰)', () => {
    // extractDocumentTypeEnhancedは先頭300文字のみを検索範囲とする設計(既存の位置制約)。
    // 候補文字列を単独で再入力すると300文字制約が実質無意味化する問題(/code-review medium
    // 指摘・実証済み)への対策として、arbitrateDocumentTypeはgrounding判定自体に同じ
    // searchRangeを適用する。
    const padding = 'あ'.repeat(310);
    const fullText = `${padding}請求書`;
    const result = arbitrateDocumentType(noneResult, '請求書', documentMasters, fullText);

    expect(result.documentType).to.be.null;
    expect(result.provenance.source).to.equal('existing');
    expect(result.provenance.candidateGrounded).to.be.false;
  });

  it('候補がfullText先頭300文字以内に出現する場合は従来通り昇格する', () => {
    const padding = 'あ'.repeat(100);
    const fullText = `${padding}請求書`;
    const result = arbitrateDocumentType(noneResult, '請求書', documentMasters, fullText);

    expect(result.documentType).to.equal('請求書');
    expect(result.provenance.source).to.equal('candidate');
  });

  it('候補がexact一致でも他マスターとのコリジョンがある短いマスターへは昇格しない(#501対策の回帰)', () => {
    // 「報告書」(3文字)が他の2マスター名のsubstringとして出現するためcommon short
    // masterと判定され、exact match昇格から除外される(office系のみにあった#501対策を
    // customer/documentにも適用、/code-review medium指摘)。
    const collidingDocMasters: DocumentMaster[] = [
      { id: 'd1', name: '報告書' },
      { id: 'd2', name: '訪問看護報告書' },
      { id: 'd3', name: '経過報告書類' },
    ];
    const fullText = '本日は報告書についてご説明します。';
    const result = arbitrateDocumentType(noneResult, '報告書', collidingDocMasters, fullText);

    expect(result.documentType).to.be.null;
    expect(result.provenance.source).to.equal('existing');
  });
});

describe('arbitrateOfficeName', () => {
  const emptyResult: OfficeExtractionResultWithCandidates = {
    bestMatch: null,
    candidates: [],
    hasMultipleCandidates: false,
    needsManualSelection: false,
  };

  it('既存がbestMatchなしで候補がgrounding済み+exact一致なら昇格する', () => {
    const fullText = '発行元: 株式会社テストケア\n電話: 03-1234-5678';
    const result = arbitrateOfficeName(emptyResult, '株式会社テストケア', officeMasters, fullText);

    expect(result.bestMatch?.id).to.equal('off1');
    expect(result.provenance.source).to.equal('candidate');
  });

  it('既存にbestMatchがあれば候補がexact一致でも上書きしない（誤マスター一致防止）', () => {
    const existing: OfficeExtractionResultWithCandidates = {
      bestMatch: { id: 'off3', name: 'デイサービスさくら', score: 100, matchType: 'exact', isDuplicate: false },
      candidates: [{ id: 'off3', name: 'デイサービスさくら', score: 100, matchType: 'exact', isDuplicate: false }],
      hasMultipleCandidates: false,
      needsManualSelection: false,
    };
    const fullText = 'デイサービスさくらのご利用者様へ。委託先: 株式会社テストケア';
    const result = arbitrateOfficeName(existing, '株式会社テストケア', officeMasters, fullText);

    expect(result.bestMatch?.id).to.equal('off3');
    expect(result.provenance.source).to.equal('existing');
  });

  it('候補がfullTextにgroundingされない場合は既存を維持する', () => {
    const fullText = '発行元: 株式会社テストケア';
    const result = arbitrateOfficeName(emptyResult, '林式会社テストケア', officeMasters, fullText);

    expect(result.bestMatch).to.be.null;
    expect(result.provenance.candidateGrounded).to.be.false;
  });

  it('候補がnullの場合は既存を維持する', () => {
    const fullText = '発行元: 株式会社テストケア';
    const result = arbitrateOfficeName(emptyResult, null, officeMasters, fullText);

    expect(result.provenance.source).to.equal('existing');
  });

  it('候補が短すぎる(3文字未満)場合はgroundingとみなさず既存を維持する(最小長ガードの回帰)', () => {
    // 実サンプルマスターデータのshortName「ふじ」(2文字)を使用。無関係な文脈
    // (顧客名「ふじたに」の一部)に偶然出現しただけでexact match昇格してしまう
    // バグを/code-review mediumで実機再現済み。
    const shortOfficeMasters: OfficeMaster[] = [{ id: 'shortoff1', name: 'ふじ福祉用具', shortName: 'ふじ', isDuplicate: false }];
    const fullText = '請求書\nふじたに様\nご利用料金のご請求について';
    const result = arbitrateOfficeName(emptyResult, 'ふじ', shortOfficeMasters, fullText);

    expect(result.bestMatch).to.be.null;
    expect(result.provenance.candidateGrounded).to.be.false;
  });
});

describe('arbitrateCustomerName', () => {
  const emptyResult: CustomerExtractionResult = {
    bestMatch: null,
    candidates: [],
    hasMultipleCandidates: false,
    needsManualSelection: false,
  };

  it('既存がbestMatchなしで候補がgrounding済み+exact一致なら昇格する', () => {
    const fullText = '利用者様: 鈴木一郎様の記録です。';
    const result = arbitrateCustomerName(emptyResult, '鈴木一郎', customerMasters, fullText);

    expect(result.bestMatch?.id).to.equal('cust3');
    expect(result.provenance.source).to.equal('candidate');
  });

  it('既存にbestMatchがあれば候補がexact一致でも上書きしない（誤マスター一致防止）', () => {
    const existing: CustomerExtractionResult = {
      bestMatch: {
        id: 'cust1',
        name: '山田太郎',
        furigana: 'やまだたろう',
        score: 100,
        matchType: 'exact',
        isDuplicate: false,
      },
      candidates: [
        {
          id: 'cust1',
          name: '山田太郎',
          furigana: 'やまだたろう',
          score: 100,
          matchType: 'exact',
          isDuplicate: false,
        },
      ],
      hasMultipleCandidates: false,
      needsManualSelection: false,
    };
    // 主治医名として別の顧客氏名(鈴木一郎)が偶然文書内に記載されているケース
    const fullText = '利用者: 山田太郎\n主治医: 鈴木一郎';
    const result = arbitrateCustomerName(existing, '鈴木一郎', customerMasters, fullText);

    expect(result.bestMatch?.id).to.equal('cust1');
    expect(result.provenance.source).to.equal('existing');
  });

  it('候補がfullTextにgroundingされない場合は既存を維持する', () => {
    const fullText = '利用者様: 鈴木一郎様の記録です。';
    const result = arbitrateCustomerName(emptyResult, '鈴木一朗', customerMasters, fullText);

    expect(result.bestMatch).to.be.null;
    expect(result.provenance.candidateGrounded).to.be.false;
  });

  it('候補がexact一致でも他マスターとのコリジョンがある短いマスターへは昇格しない(#501対策の回帰)', () => {
    // 「田中一」(3文字)が他の2マスター名のsubstringとして出現するためcommon short
    // masterと判定され、exact match昇格から除外される。
    const collidingCustomerMasters: CustomerMaster[] = [
      { id: 'c1', name: '田中一', isDuplicate: false },
      { id: 'c2', name: '田中一郎', isDuplicate: false },
      { id: 'c3', name: '藤田田中一', isDuplicate: false },
    ];
    const fullText = '利用者: 田中一様のご記録です。';
    const result = arbitrateCustomerName(emptyResult, '田中一', collidingCustomerMasters, fullText);

    expect(result.bestMatch).to.be.null;
    expect(result.provenance.source).to.equal('existing');
  });
});

describe('arbitrateDate', () => {
  const nullResult: DateExtractionResult = {
    date: null,
    formattedDate: null,
    source: null,
    pattern: null,
    confidence: 0,
    allCandidates: [],
  };

  it('既存がnullで候補がgrounding済み+パース可能なら採用する', () => {
    const fullText = '発行日: 令和7年1月18日';
    const result = arbitrateDate(nullResult, '令和7年1月18日', fullText);

    expect(result.date).to.not.be.null;
    expect(result.formattedDate).to.equal('2025/01/18');
    expect(result.provenance.source).to.equal('candidate');
  });

  it('既存に日付があれば候補がgroundingされても上書きしない', () => {
    const existingDate = new Date(2025, 0, 1);
    const existing: DateExtractionResult = {
      date: existingDate,
      formattedDate: '2025/01/01',
      source: '2025/01/01',
      pattern: '西暦スラッシュ',
      confidence: 90,
      allCandidates: [],
    };
    const fullText = '発行日: 令和7年1月18日';
    const result = arbitrateDate(existing, '令和7年1月18日', fullText);

    expect(result.date).to.equal(existingDate);
    expect(result.provenance.source).to.equal('existing');
  });

  it('候補がgrounding済みでもパース不能なフォーマットなら既存(null)を維持する', () => {
    const fullText = '発行日: XXXX年不明';
    const result = arbitrateDate(nullResult, 'XXXX年不明', fullText);

    expect(result.date).to.be.null;
    expect(result.provenance.source).to.equal('existing');
    expect(result.provenance.candidateGrounded).to.be.true;
  });

  it('候補がfullTextにgroundingされない場合(文字化け想定)は既存を維持する', () => {
    const fullText = '発行日: 令和7年1月18日';
    const result = arbitrateDate(nullResult, '令和7年1月1蕗日', fullText);

    expect(result.date).to.be.null;
    expect(result.provenance.candidateGrounded).to.be.false;
  });

  it('候補が空文字列の場合は既存を維持する', () => {
    const result = arbitrateDate(nullResult, '', '発行日: 令和7年1月18日');

    expect(result.provenance.candidateGrounded).to.be.false;
    expect(result.provenance.source).to.equal('existing');
  });

  it('候補がnullの場合は既存を維持する', () => {
    const result = arbitrateDate(nullResult, null, '発行日: 令和7年1月18日');

    expect(result.provenance.source).to.equal('existing');
  });

  it('候補が全角形式の日付でもパースして採用する(全角変換漏れの回帰)', () => {
    // Geminiは日付候補を「原文の書式のまま」抽出するため、OCR全文が全角表記なら
    // 候補も全角のまま返る。convertFullWidthToHalfWidth前処理漏れにより、全角日付が
    // 一切パースされず日付補完が機能しないバグを/code-review mediumで実機確認・修正済み。
    const fullText = '発行日: 令和７年１月１８日';
    const result = arbitrateDate(nullResult, '令和７年１月１８日', fullText);

    expect(result.date).to.not.be.null;
    expect(result.formattedDate).to.equal('2025/01/18');
    expect(result.provenance.source).to.equal('candidate');
  });
});
