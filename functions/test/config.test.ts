/**
 * config.ts: parseOcrProvider / parseSummaryProvider / SARASHINA_SUMMARY_CONFIG テスト
 *
 * Geminiは緊急用OCR経路も含めて廃止した(ADR-0029)ため、Gemini用の設定
 * (parseOcrThinkingBudget / parseModelId / isThreePointFiveModel / resolveGeminiPricing /
 * GEMINI_CONFIG)のテストは削除した。Geminiが復活しないことは
 * geminiSdkImportAllowlistContract.test.ts が守る。
 */

import { expect } from 'chai';
import {
  parseOcrProvider,
  parseSummaryProvider,
  SARASHINA_SUMMARY_CONFIG,
} from '../src/utils/config';

describe('config: parseOcrProvider (ADR-0025、ADR-0029: paddleのみ。geminiは廃止)', () => {
  // Geminiは緊急用経路も含めて廃止した(ADR-0029)。設定欠落・不正値・旧緊急経路の値('gemini')は
  // 全て警告のうえpaddleへ倒す(実行時に古い環境変数が残っていても顧客データを外部AIへ送らない)。
  function captureWarn(fn: () => void): string[] {
    const original = console.warn;
    const messages: string[] = [];
    console.warn = (...args: unknown[]) => { messages.push(args.map(String).join(' ')); };
    try { fn(); } finally { console.warn = original; }
    return messages;
  }

  it('未設定(undefined)の場合は"paddle"を返し、警告は出さない', () => {
    const warns = captureWarn(() => { expect(parseOcrProvider(undefined)).to.equal('paddle'); });
    expect(warns).to.deep.equal([]);
  });

  it('空文字列・空白のみの場合は"paddle"を返し、警告は出さない', () => {
    const warns = captureWarn(() => {
      expect(parseOcrProvider('')).to.equal('paddle');
      expect(parseOcrProvider('   ')).to.equal('paddle');
    });
    expect(warns).to.deep.equal([]);
  });

  it('"paddle"を指定した場合は"paddle"を返し、警告は出さない(前後空白・末尾改行はtrim)', () => {
    const warns = captureWarn(() => {
      expect(parseOcrProvider('paddle')).to.equal('paddle');
      expect(parseOcrProvider('  paddle\n')).to.equal('paddle');
    });
    expect(warns).to.deep.equal([]);
  });

  it('"gemini"(旧緊急経路の値)を与えても"paddle"を返し、警告を出す(Geminiへ倒れない)', () => {
    const warns = captureWarn(() => {
      expect(parseOcrProvider('gemini')).to.equal('paddle');
      expect(parseOcrProvider('  gemini\n')).to.equal('paddle');
    });
    expect(warns).to.have.length(2);
    expect(warns[0]).to.include('OCR_PROVIDER');
    expect(warns[0]).to.include('ADR-0029');
  });

  it('未サポート値(綴り違い・大文字・モデルID)は"paddle"へフォールバックし、警告を出す', () => {
    const values = ['paddleocr', 'PADDLE', 'GEMINI', 'gemini-3.5-flash', 'code-default'];
    const warns = captureWarn(() => {
      for (const v of values) expect(parseOcrProvider(v), `OCR_PROVIDER=${v}`).to.equal('paddle');
    });
    expect(warns).to.have.length(values.length);
  });
});

describe('config: parseSummaryProvider (ADR-0027 PR3)', () => {
  it('未設定(undefined)の場合は既定値"none"を返す(警告なし)', () => {
    expect(parseSummaryProvider(undefined)).to.equal('none');
  });

  it('空文字列の場合は既定値"none"を返す(警告なし)', () => {
    expect(parseSummaryProvider('')).to.equal('none');
  });

  it('空白のみの場合は既定値"none"を返す(警告なし)', () => {
    expect(parseSummaryProvider('   ')).to.equal('none');
  });

  it('"none"を明示指定した場合は警告なしで"none"を返す', () => {
    expect(parseSummaryProvider('none')).to.equal('none');
  });

  it('"sarashina"を指定した場合は"sarashina"を返す', () => {
    expect(parseSummaryProvider('sarashina')).to.equal('sarashina');
  });

  it('"gemini"(旧ロールバック値、PR-Eで撤去)は警告つきで"none"に倒れ、Geminiを呼ばない', () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (msg?: unknown) => {
      warnings.push(String(msg));
    };
    try {
      expect(parseSummaryProvider('gemini')).to.equal('none');
    } finally {
      console.warn = original;
    }
    expect(warnings).to.have.length(1);
    expect(warnings[0]).to.include('SUMMARY_PROVIDER');
  });

  it('未サポート値は既定値"none"にフォールバックする(新規課金を無言で発生させない)', () => {
    expect(parseSummaryProvider('paddle')).to.equal('none');
    expect(parseSummaryProvider('SARASHINA')).to.equal('none');
  });

  it('前後空白・末尾改行はtrimして扱われる', () => {
    expect(parseSummaryProvider('  sarashina  ')).to.equal('sarashina');
  });
});

describe('config: SARASHINA_SUMMARY_CONFIG (ADR-0027 PR3)', () => {
  it('provider/serviceUrl/requestTimeoutMsを持つ(温度・max_tokens等のリクエストパラメータは含まない、ドリフト防止のためsarashinaSummaryRequest.tsが単一の情報源)', () => {
    expect(SARASHINA_SUMMARY_CONFIG).to.have.keys(['provider', 'serviceUrl', 'requestTimeoutMs']);
    expect(SARASHINA_SUMMARY_CONFIG.requestTimeoutMs).to.equal(620_000);
  });
});
