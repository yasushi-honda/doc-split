/**
 * generateSummary caller-side 契約テスト (Issue #225)
 *
 * 目的:
 * - summaryRequestBuilder.test.ts (#213/PR #224) の canary は builder 側の契約を固定するが、
 *   caller 側で builder を経由しなくなる (bypass) と canary は PASS のまま Issue #209 が再発する。
 * - 本テストで caller 側の契約 `model.generateContent(buildSummaryGenerationRequest(...))` を
 *   構文レベルで固定し、将来のインライン展開 (`model.generateContent({ contents: [...] })`) を検出する。
 *
 * 方式: 案B (grep-based、Issue #225 推奨)
 * - 最小コストの静的検証。頻発時は sinon spy (案A) / ESLint rule (案C) へ昇格を検討。
 */

import { expect } from 'chai';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const BUILDER_CALL_PATTERN = /model\.generateContent\s*\(\s*buildSummaryGenerationRequest\s*\(/;

// functions/ ディレクトリからの相対パス。mocha は package.json のあるディレクトリで実行される。
const CALLER_FILES = [
  'src/ocr/ocrProcessor.ts',
  'src/ocr/regenerateSummary.ts',
];

describe('generateSummary caller contract (Issue #225)', () => {
  for (const relPath of CALLER_FILES) {
    it(`${relPath} は buildSummaryGenerationRequest 経由で model.generateContent を呼ぶ`, () => {
      const absPath = resolve(process.cwd(), relPath);
      const source = readFileSync(absPath, 'utf-8');
      expect(BUILDER_CALL_PATTERN.test(source)).to.equal(
        true,
        `${relPath} で builder bypass を検出。` +
          'model.generateContent(buildSummaryGenerationRequest(...)) パターンが消滅している。' +
          'Issue #209 再発防止のため、summaryRequestBuilder 経由で呼び出してください。'
      );
    });
  }
});

describe('BUILDER_CALL_PATTERN sanity (regex が bypass を正しく検出するか)', () => {
  it('正例: buildSummaryGenerationRequest 経由の呼び出しはマッチする', () => {
    const src = 'return await model.generateContent(buildSummaryGenerationRequest(prompt));';
    expect(BUILDER_CALL_PATTERN.test(src)).to.equal(true);
  });

  it('負例: インライン展開 ({ contents: [...] }) はマッチしない (bypass 検出)', () => {
    const src = 'return await model.generateContent({ contents: [{ role: "user", parts: [{ text: prompt }] }] });';
    expect(BUILDER_CALL_PATTERN.test(src)).to.equal(false);
  });

  it('負例: 事前組み立て req オブジェクトもマッチしない (builder未経由)', () => {
    const src = 'const req = { contents, generationConfig }; await model.generateContent(req);';
    expect(BUILDER_CALL_PATTERN.test(src)).to.equal(false);
  });
});
