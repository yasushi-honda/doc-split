/**
 * sarashinaSummaryRequest.ts pure function unit test (ADR-0027 PR3)
 *
 * PR2b実機ゲート(`scripts/lib/sarashinaSummaryVerify.ts`)が検証したリクエスト形状の
 * 単一の情報源。本番client(`sarashinaSummaryClient.ts`)とハーネスの両方がここへ委譲する
 * ことで、body定義の重複によるドリフトを構造的に防ぐ(plan-crossreview #10反映)。
 */

import { expect } from 'chai';
import {
  buildSarashinaChatRequestBody,
  normalizeSarashinaContent,
  SARASHINA_SUMMARY_MAX_TOKENS,
  SARASHINA_SUMMARY_TEMPERATURE,
} from '../src/ocr/sarashinaSummaryRequest';

describe('buildSarashinaChatRequestBody (ADR-0027 PR3、PR2b検証済み形状の単一情報源)', () => {
  it('PR2bハーネスが実機ゲートPASSを確認した形と完全一致するbodyを返す(既定パラメータ)', () => {
    expect(buildSarashinaChatRequestBody('プロンプト本文')).to.deep.equal({
      messages: [{ role: 'user', content: 'プロンプト本文' }],
      max_tokens: 1024,
      temperature: 0.2,
      cache_prompt: false,
      chat_template_kwargs: { enable_thinking: false },
    });
  });

  it('SARASHINA_SUMMARY_MAX_TOKENS / SARASHINA_SUMMARY_TEMPERATURE はPR2b検証値(1024 / 0.2)', () => {
    expect(SARASHINA_SUMMARY_MAX_TOKENS).to.equal(1024);
    expect(SARASHINA_SUMMARY_TEMPERATURE).to.equal(0.2);
  });

  it('opts.maxTokens / opts.temperature で上書きできる(短縮再送等のPR3拡張用)', () => {
    const body = buildSarashinaChatRequestBody('p', { maxTokens: 256, temperature: 0 });
    expect(body.max_tokens).to.equal(256);
    expect(body.temperature).to.equal(0);
  });

  it('messagesは常にrole:userの単一メッセージ(system roleは使わない、PR2b検証済み形状)', () => {
    const body = buildSarashinaChatRequestBody('x');
    expect(body.messages).to.deep.equal([{ role: 'user', content: 'x' }]);
  });
});

describe('normalizeSarashinaContent (末尾のEOSトークン除去、ADR-0027 PR3)', () => {
  it('末尾の単一</s>を除去してtrimする', () => {
    expect(normalizeSarashinaContent('要約本文</s>')).to.equal('要約本文');
  });

  it('末尾の連続</s></s>を全て除去する', () => {
    expect(normalizeSarashinaContent('要約本文</s></s>\n')).to.equal('要約本文');
  });

  it('末尾の</s>前後の空白・改行も含めて除去する', () => {
    expect(normalizeSarashinaContent('要約本文 </s> ')).to.equal('要約本文');
  });

  it('文中(末尾以外)の</s>は保持する(推測で内部トークンを削除しない、plan-crossreview Low反映)', () => {
    expect(normalizeSarashinaContent('前半</s>後半')).to.equal('前半</s>後半');
  });

  it('</s>が無い場合は前後の空白のみtrimする', () => {
    expect(normalizeSarashinaContent('  要約本文  ')).to.equal('要約本文');
  });

  it('空文字はそのまま空文字を返す', () => {
    expect(normalizeSarashinaContent('')).to.equal('');
  });
});
