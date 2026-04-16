/**
 * generateSummary caller-side 契約テスト (Issue #225)
 *
 * builder 側 canary は builder の契約を固定するが、caller 側で builder を経由
 * しなくなると canary は PASS のまま Issue #209 (Vertex AI summary 暴走) が再発する。
 * 本テストは caller 側の呼び出しパターンを構文検証して bypass を検出する。
 *
 * 方式: grep-based (静的検証)。
 *
 * 既知の limitation:
 * - 型 alias 経由 (const gen = model.generateContent; gen(...)) や分割代入の呼び出しは未検出
 * - caller 追加時は CALLER_FILES への手動追記が必要 (grep 動的検出は未導入)
 *
 * 昇格条件: false negative が 1 件でも実発生した時点で sinon spy (案A) へ切替。
 */

import { expect } from 'chai';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const BUILDER_CALL_PATTERN = /model\.generateContent\s*\(\s*buildSummaryGenerationRequest\s*\(/g;

// package.json のあるディレクトリから resolve。IDE/CI 間の cwd 差異を吸収。
const CALLER_FILES = [
  'src/ocr/ocrProcessor.ts',
  'src/ocr/regenerateSummary.ts',
];

/**
 * 行頭 `//` コメント行を除去。コメントアウトされた呼び出しを「存在する」と
 * 誤検出する false positive を防ぐ。
 */
function stripLineComments(source: string): string {
  return source.replace(/^\s*\/\/.*$/gm, '');
}

function countMatches(source: string): number {
  return source.match(BUILDER_CALL_PATTERN)?.length ?? 0;
}

describe('generateSummary caller contract', () => {
  for (const relPath of CALLER_FILES) {
    it(`${relPath} は buildSummaryGenerationRequest 経由で model.generateContent を呼ぶ`, () => {
      const absPath = resolve(process.cwd(), relPath);
      const source = stripLineComments(readFileSync(absPath, 'utf-8'));
      const count = countMatches(source);
      expect(count).to.be.at.least(
        1,
        `${relPath} で builder bypass を検出。` +
          `パターン ${BUILDER_CALL_PATTERN.source} が消滅している。` +
          'Issue #209 再発防止のため、summaryRequestBuilder 経由で呼び出してください。'
      );
    });
  }
});

describe('BUILDER_CALL_PATTERN sanity (regex が bypass を正しく検出するか)', () => {
  it('正例: buildSummaryGenerationRequest 経由の呼び出しはマッチする', () => {
    const src = 'return await model.generateContent(buildSummaryGenerationRequest(prompt));';
    expect(countMatches(src)).to.equal(1);
  });

  it('負例: インライン展開 ({ contents: [...] }) はマッチしない', () => {
    const src = 'return await model.generateContent({ contents: [{ role: "user", parts: [{ text: prompt }] }] });';
    expect(countMatches(src)).to.equal(0);
  });

  it('負例: 事前組み立て req オブジェクトもマッチしない', () => {
    const src = 'const req = { contents, generationConfig }; await model.generateContent(req);';
    expect(countMatches(src)).to.equal(0);
  });

  it('負例: 行頭コメントアウトされた呼び出しは stripLineComments で除外される', () => {
    const src = '  // return await model.generateContent(buildSummaryGenerationRequest(prompt));';
    expect(countMatches(stripLineComments(src))).to.equal(0);
  });

  it('複数回呼び出しも正しくカウント', () => {
    const src = [
      'await model.generateContent(buildSummaryGenerationRequest(p1));',
      'await model.generateContent(buildSummaryGenerationRequest(p2));',
    ].join('\n');
    expect(countMatches(src)).to.equal(2);
  });
});
