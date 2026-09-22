/**
 * summaryFabricationScan 単体テスト (ADR-0027 PR2a)
 *
 * `shared/summaryFabricationScan.ts` はFirestore/Admin SDK非依存の純粋関数のため、
 * `functions/test/customerIdentity.test.ts` と同じ規約でユニットテストする(emulator不要)。
 * frontend/functions双方から参照される契約をここで固定する。
 */

import { expect } from 'chai';
import {
  scanSummaryForFabrication,
  normalizeForFabricationScan,
  DEFAULT_FABRICATION_SCAN_CONFIG,
  FABRICATION_SCAN_CONFIG_VERSION,
} from '../../shared/summaryFabricationScan';

describe('normalizeForFabricationScan', () => {
  it('NFKCで全角/半角の揺れを正規化する', () => {
    expect(normalizeForFabricationScan('ABC（１２３）')).to.equal('ABC(123)');
  });

  it('<s>/</s>/<think>/</think>を除去する', () => {
    expect(normalizeForFabricationScan('こんにちは</s>')).to.equal('こんにちは');
    expect(normalizeForFabricationScan('<think>考え中</think>本文')).to.equal('考え中本文');
  });

  it('前後の空白・タブを除去する', () => {
    expect(normalizeForFabricationScan('  こんにちは\t\t')).to.equal('こんにちは');
  });

  it('空文字列は空文字列のまま', () => {
    expect(normalizeForFabricationScan('')).to.equal('');
  });
});

describe('scanSummaryForFabrication: verbatim判定(②)', () => {
  it('原典にそのまま存在する組織名は検出しない', () => {
    const source = '担当はみどりヶ丘訪問看護ステーションです。';
    const summary = '訪問看護はみどりヶ丘訪問看護ステーションが担当。';
    const r = scanSummaryForFabrication(summary, source);
    expect(r.findings).to.deep.equal([]);
    expect(r.fabricatedCount).to.equal(0);
  });

  it('助詞を挟んで原典に存在する組織名も検出しない(「向けにみどりヶ丘訪問看護ステーション」型)', () => {
    const source = '黒田様向けにみどりヶ丘訪問看護ステーションが訪問。';
    const summary = '利用者向けにみどりヶ丘訪問看護ステーションが訪問看護を実施。';
    const r = scanSummaryForFabrication(summary, source);
    expect(r.fabricatedCount).to.equal(0);
  });

  it('「主治医は青葉クリニック」型(助詞+原典実在語)は検出しない', () => {
    const source = '主治医は青葉クリニックの桜庭医師。';
    const summary = '主治医は青葉クリニックです。';
    const r = scanSummaryForFabrication(summary, source);
    expect(r.fabricatedCount).to.equal(0);
  });
});

describe('scanSummaryForFabrication: 助詞トリム(③)', () => {
  it('地の文を巻き込んだ「サービス内容は通所リハビリ」型は検出しない(genericCores)', () => {
    const source = '通所リハビリを週2回利用。';
    const summary = 'サービス内容は通所リハビリです。';
    const r = scanSummaryForFabrication(summary, source);
    expect(r.fabricatedCount).to.equal(0);
  });

  it('「具体的な利用者名や事業所」型(正直な回答の一部)は検出しない', () => {
    const source = 'メモ。特に変わったことはなし。';
    const summary = '具体的な利用者名や事業所名の記載はない。';
    const r = scanSummaryForFabrication(summary, source);
    expect(r.fabricatedCount).to.equal(0);
  });

  it('リスト列挙の中黒区切りを巻き込まない(「・」は区切り文字として扱う)', () => {
    const source = '訪問介護・通所介護・短期入所生活介護・訪問看護を提供。';
    const summary = '特筆事項：訪問介護・通所介護・短期入所生活介護・訪問看護の各サービス内容。';
    const r = scanSummaryForFabrication(summary, source);
    expect(r.fabricatedCount).to.equal(0);
  });

  it('箇条書き記号「・」で始まる文の先頭suffixを巻き込まない', () => {
    const source = '訪問看護報告書。黒田しずか様向けにみどりヶ丘訪問看護ステーションが作成。';
    const summary = '・訪問看護報告書は利用者黒田しずか様向けにみどりヶ丘訪問看護ステーションが作成。';
    const r = scanSummaryForFabrication(summary, source);
    expect(r.fabricatedCount).to.equal(0);
  });
});

describe('scanSummaryForFabrication: 再結合判定(④、fabricated/recombined分離)', () => {
  it('原典の括弧書き略記を反転した組織名はrecombinedとして分類する(捏造扱いにしない)', () => {
    const source = '出席者：訪問介護(若草)、通所リハビリ(日向)、訪問看護(水無月)。';
    const summary = '関係者は水無月訪問看護、若草訪問介護、日向通所リハビリ。';
    const r = scanSummaryForFabrication(summary, source);
    expect(r.fabricatedCount).to.equal(0);
    expect(r.recombinedCount).to.equal(3);
    expect(r.findings.map((f) => f.name).sort()).to.deep.equal(
      ['水無月訪問看護', '日向通所リハビリ', '若草訪問介護'].sort()
    );
    expect(r.findings.every((f) => f.kind === 'recombined')).to.equal(true);
  });

  it('全角括弧の略記パターンも検出する', () => {
    const source = '訪問看護（水無月）が担当。';
    const summary = '水無月訪問看護が対応。';
    const r = scanSummaryForFabrication(summary, source);
    expect(r.recombinedCount).to.equal(1);
    expect(r.findings[0].kind).to.equal('recombined');
  });

  it('完全に実在しない組織名はfabricatedとして分類する(recombinedにしない)', () => {
    const source = '福祉用具貸与確認書。利用者：三好 陽子様。品目：歩行器。';
    const summary = '貸与事業所はみずほ訪問看護ステーションです。';
    const r = scanSummaryForFabrication(summary, source);
    expect(r.fabricatedCount).to.be.greaterThan(0);
    const target = r.findings.find((f) => f.name.includes('みずほ訪問看護ステーション'));
    expect(target?.kind).to.equal('fabricated');
  });

  it('他文書の実在事業所名を持ち込んだ場合もfabricated(sourceに存在しないため)', () => {
    const source = '福祉用具貸与確認書。利用者：三好 陽子様。品目：歩行器。';
    const summary = '担当はさくら居宅介護支援事業所です。';
    const r = scanSummaryForFabrication(summary, source);
    expect(r.fabricatedCount).to.equal(1);
    expect(r.findings[0].kind).to.equal('fabricated');
  });

  it('coreは実在するがsuffixだけ異なる組織名はfabricated(近接判定の悪用を防ぐ)', () => {
    // 「さくら」はD2原典に実在するが「さくらデイサービス」という組織自体は実在しない
    // (実在するのは「さくら通所介護センター」)。近接30文字判定を採用していた旧設計では
    // これをrecombinedとして見逃す恐れがあったため、限定的な括弧書き変換のみを許容する
    // 現行設計で正しくfabricatedになることを固定する(codex High指摘の回帰テスト)。
    const source = 'さくら通所介護センターを利用。';
    const summary = '請求元はさくらデイサービスです。';
    const r = scanSummaryForFabrication(summary, source);
    expect(r.fabricatedCount).to.equal(1);
    expect(r.findings[0].kind).to.equal('fabricated');
  });
});

describe('scanSummaryForFabrication: 包含関係の除去', () => {
  it('入れ子候補は最長スパンのみを残す(「みずほ訪問看護」⊂「みずほ訪問看護ステーション」)', () => {
    const source = '福祉用具貸与確認書。';
    const summary = 'みずほ訪問看護ステーションが担当。';
    const r = scanSummaryForFabrication(summary, source);
    // suffix候補として「訪問看護」「ステーション」の両方がマッチしうるが、
    // 最長スパン優先により「みずほ訪問看護ステーション」1件のみが残る。
    expect(r.findings.length).to.equal(1);
    expect(r.findings[0].name).to.equal('みずほ訪問看護ステーション');
  });
});

describe('scanSummaryForFabrication: 境界値', () => {
  it('空文字列summaryは検出0件', () => {
    const r = scanSummaryForFabrication('', 'ソーステキスト');
    expect(r.findings).to.deep.equal([]);
    expect(r.fabricatedCount).to.equal(0);
    expect(r.recombinedCount).to.equal(0);
  });

  it('空文字列sourceでも例外を投げない(全候補がfabricated扱いになる)', () => {
    const r = scanSummaryForFabrication('みずほ訪問看護ステーションが担当。', '');
    expect(r.fabricatedCount).to.equal(1);
  });

  it('ORG_SUFFIXを含まないテキストは検出0件', () => {
    const r = scanSummaryForFabrication('今日は良い天気です。', 'ソーステキスト');
    expect(r.findings).to.deep.equal([]);
  });

  it('sourceTextは呼び出し側が切り詰め済みである前提(本関数は切り詰めを行わない)', () => {
    // MAX_SUMMARY_INPUT_LENGTH相当の切り詰めは呼び出し側の責務。本関数へ切り詰め後の
    // sourceTextを渡した場合、切り詰めで失われた範囲の語は「原典に存在しない」扱いになる
    // (モデルが実際には見ていない範囲を実在扱いする偽陰性を防ぐ、PR2詳細設計の契約通り)。
    const fullSource = 'X'.repeat(100) + 'みずほ訪問看護ステーション';
    const truncatedSource = fullSource.slice(0, 100); // 「みずほ訪問看護ステーション」を含まない
    const r = scanSummaryForFabrication('みずほ訪問看護ステーションが担当。', truncatedSource);
    expect(r.fabricatedCount).to.equal(1);
  });
});

describe('scanSummaryForFabrication: configVersion', () => {
  it('optionsを省略した場合、既定configのFABRICATION_SCAN_CONFIG_VERSIONと一致する', () => {
    const r = scanSummaryForFabrication('テスト', 'テスト');
    expect(r.configVersion).to.equal(FABRICATION_SCAN_CONFIG_VERSION);
  });

  it('DEFAULT_FABRICATION_SCAN_CONFIGを明示的に渡しても同じconfigVersionになる', () => {
    const r = scanSummaryForFabrication('テスト', 'テスト', DEFAULT_FABRICATION_SCAN_CONFIG);
    expect(r.configVersion).to.equal(FABRICATION_SCAN_CONFIG_VERSION);
  });

  it('optionsを変更するとconfigVersionが変わる', () => {
    const r = scanSummaryForFabrication('テスト', 'テスト', {
      ...DEFAULT_FABRICATION_SCAN_CONFIG,
      maxLeftContext: 8,
    });
    expect(r.configVersion).to.not.equal(FABRICATION_SCAN_CONFIG_VERSION);
  });
});
