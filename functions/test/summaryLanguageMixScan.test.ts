/**
 * summaryLanguageMixScan 単体テスト (PR-C)
 *
 * `shared/summaryLanguageMixScan.ts` はFirestore/Admin SDK非依存の純粋関数のため、
 * `summaryFabricationScan.test.ts` と同じ規約でユニットテストする(emulator不要)。
 * 要約に「送信した原文に存在しない4文字以上の英単語」が混入していないかを検知する。
 */

import { expect } from 'chai';
import { scanSummaryForForeignWords, LANGUAGE_MIX_MIN_WORD_LENGTH } from '../../shared/summaryLanguageMixScan';

describe('scanSummaryForForeignWords', () => {
  it('原文に存在しない4文字以上の英単語を検知する(ADR-0027 canary #7の再現: folgerende)', () => {
    const result = scanSummaryForForeignWords('訪問看護の指示。folgerende medical instructions を記載。', '訪問看護指示書 内服薬の指示');
    expect(result.count).to.equal(3);
    expect(result.words).to.deep.equal(['folgerende', 'medical', 'instructions']);
  });

  it('日本語のみの要約は検知しない', () => {
    const result = scanSummaryForForeignWords('利用者は歩行器を利用しています。', '福祉用具貸与確認書 歩行器');
    expect(result).to.deep.equal({ count: 0, words: [] });
  });

  it('原文にも存在する英単語は検知しない(大文字小文字を区別しない)', () => {
    const result = scanSummaryForForeignWords('Barthel Index を確認', '評価: barthel index 85点');
    expect(result.count).to.equal(0);
  });

  it('境界値: 3文字以下の英字(ADL・AI)は対象外、4文字(MRSA)から対象', () => {
    expect(LANGUAGE_MIX_MIN_WORD_LENGTH).to.equal(4);
    expect(scanSummaryForForeignWords('ADLとAIの評価', '評価').count).to.equal(0);
    expect(scanSummaryForForeignWords('MRSAの保菌', '保菌').words).to.deep.equal(['MRSA']);
  });

  it('全角英字はNFKCで半角へ正規化して比較する(原文・要約どちらが全角でも同一視)', () => {
    expect(scanSummaryForForeignWords('ＢＭＩを測定', 'BMI 測定').count).to.equal(0);
    expect(scanSummaryForForeignWords('Barthel Indexを確認', 'Ｂａｒｔｈｅｌ　Ｉｎｄｅｘ 85').count).to.equal(0);
  });

  it('原文中の長い語の一部として現れる語は検知しない(部分一致で存在とみなす)', () => {
    expect(scanSummaryForForeignWords('care を実施', 'homecare 計画').count).to.equal(0);
  });

  it('同じ語が複数回現れても1語として数える(重複排除、出現順を保つ)', () => {
    const result = scanSummaryForForeignWords('Hello world. hello World', '');
    expect(result.words).to.deep.equal(['Hello', 'world']);
    expect(result.count).to.equal(2);
  });

  it('異常系: 空文字の要約・空文字の原文でも例外にならない', () => {
    expect(scanSummaryForForeignWords('', '原文')).to.deep.equal({ count: 0, words: [] });
    expect(scanSummaryForForeignWords('text', '').count).to.equal(1);
  });
});
