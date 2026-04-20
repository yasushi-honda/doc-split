/**
 * generateSummary caller-side 契約テスト (Issue #225, #214)
 *
 * 目的: caller 側で builder を bypass (Vertex AI 直呼) する回帰を検知する (Issue #209 型の
 * summary 暴走再発防止)。builder 側 canary だけでは caller bypass を見逃すため、caller
 * 呼出パターンを静的に lock-in する。
 *
 * 背景 (#214 リファクタ): summaryGenerator.ts が唯一の Vertex AI caller、ocrProcessor /
 * regenerateSummary は generateSummaryCore() 経由に統一。
 *
 * 方式: grep-based (docs/context/test-strategy.md §2.1 参照)。
 * 既知の limitation: 型 alias 経由 (const gen = model.generateContent; gen(...)) や分割代入は
 * 未検出。caller 追加時は CALLER_FILES / CORE_CALLERS への手動追記が必要 (grep 動的検出は未導入)。
 * 昇格条件: false negative が 1 件でも実発生した時点で sinon spy (案A) へ切替。
 */

import { expect } from 'chai';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const BUILDER_CALL_PATTERN = /model\.generateContent\s*\(\s*buildSummaryGenerationRequest\s*\(/g;
const CORE_DELEGATE_PATTERN = /generateSummaryCore\s*\(/g;

// Issue #214: builder 経由の Vertex AI 呼び出しを集約する唯一のファイル
const CALLER_FILES = ['src/ocr/summaryGenerator.ts'];

// Issue #214: 要約生成は generateSummaryCore に委譲される caller 群
const CORE_CALLERS = ['src/ocr/ocrProcessor.ts', 'src/ocr/regenerateSummary.ts'];

/**
 * 行頭 `//` コメント行を除去。コメントアウトされた呼び出しを「存在する」と
 * 誤検出する false positive を防ぐ。
 */
function stripLineComments(source: string): string {
  return source.replace(/^\s*\/\/.*$/gm, '');
}

function countMatches(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

describe('generateSummary caller contract', () => {
  for (const relPath of CALLER_FILES) {
    it(`${relPath} は buildSummaryGenerationRequest 経由で model.generateContent を呼ぶ`, () => {
      const absPath = resolve(process.cwd(), relPath);
      const source = stripLineComments(readFileSync(absPath, 'utf-8'));
      const count = countMatches(source, BUILDER_CALL_PATTERN);
      expect(count).to.be.at.least(
        1,
        `${relPath} で builder bypass を検出。` +
          `パターン ${BUILDER_CALL_PATTERN.source} が消滅している。` +
          'Issue #209 再発防止のため、summaryRequestBuilder 経由で呼び出してください。'
      );
    });
  }
});

describe('generateSummary delegation contract (Issue #214)', () => {
  for (const relPath of CORE_CALLERS) {
    it(`${relPath} は generateSummaryCore 経由で要約を生成する`, () => {
      const absPath = resolve(process.cwd(), relPath);
      const source = stripLineComments(readFileSync(absPath, 'utf-8'));
      const count = countMatches(source, CORE_DELEGATE_PATTERN);
      expect(count).to.be.at.least(
        1,
        `${relPath} で generateSummaryCore 呼び出しが見つかりません。` +
          'Issue #214 のリファクタ後、要約生成は summaryGenerator.generateSummaryCore に集約されているため、' +
          'caller は直接 Vertex AI を呼ばず generateSummaryCore を経由してください。'
      );
    });
  }

  for (const relPath of CORE_CALLERS) {
    it(`${relPath} は model.generateContent を直接呼ばない (bypass 防止)`, () => {
      const absPath = resolve(process.cwd(), relPath);
      const source = stripLineComments(readFileSync(absPath, 'utf-8'));
      // OCR 経路 (ocrProcessor.ts) は別目的で model.generateContent を呼ぶため、
      // buildSummaryGenerationRequest と組み合わさった "summary 用" 呼び出しのみを禁止する。
      const summaryCallCount = countMatches(source, BUILDER_CALL_PATTERN);
      expect(summaryCallCount).to.equal(
        0,
        `${relPath} で model.generateContent(buildSummaryGenerationRequest(...)) の直接呼び出しを検出。` +
          'Issue #214 のリファクタ後、summary 生成は summaryGenerator.ts に集約されているため、' +
          'caller からの直接呼び出しは bypass と見なします。'
      );
    });
  }
});

describe('BUILDER_CALL_PATTERN sanity (regex が bypass を正しく検出するか)', () => {
  it('正例: buildSummaryGenerationRequest 経由の呼び出しはマッチする', () => {
    const src = 'return await model.generateContent(buildSummaryGenerationRequest(prompt));';
    expect(countMatches(src, BUILDER_CALL_PATTERN)).to.equal(1);
  });

  it('負例: インライン展開 ({ contents: [...] }) はマッチしない', () => {
    const src = 'return await model.generateContent({ contents: [{ role: "user", parts: [{ text: prompt }] }] });';
    expect(countMatches(src, BUILDER_CALL_PATTERN)).to.equal(0);
  });

  it('負例: 事前組み立て req オブジェクトもマッチしない', () => {
    const src = 'const req = { contents, generationConfig }; await model.generateContent(req);';
    expect(countMatches(src, BUILDER_CALL_PATTERN)).to.equal(0);
  });

  it('負例: 行頭コメントアウトされた呼び出しは stripLineComments で除外される', () => {
    const src = '  // return await model.generateContent(buildSummaryGenerationRequest(prompt));';
    expect(countMatches(stripLineComments(src), BUILDER_CALL_PATTERN)).to.equal(0);
  });

  it('複数回呼び出しも正しくカウント', () => {
    const src = [
      'await model.generateContent(buildSummaryGenerationRequest(p1));',
      'await model.generateContent(buildSummaryGenerationRequest(p2));',
    ].join('\n');
    expect(countMatches(src, BUILDER_CALL_PATTERN)).to.equal(2);
  });
});

describe('CORE_DELEGATE_PATTERN sanity (generateSummaryCore 呼び出しの検出)', () => {
  it('正例: generateSummaryCore の呼び出しはマッチする', () => {
    const src = 'const result = await generateSummaryCore(ocrResult, documentType);';
    expect(countMatches(src, CORE_DELEGATE_PATTERN)).to.equal(1);
  });

  it('負例: import 文中の識別子名はマッチしない (関数呼び出しのみ)', () => {
    const src = "import { generateSummaryCore } from './summaryGenerator';";
    expect(countMatches(src, CORE_DELEGATE_PATTERN)).to.equal(0);
  });

  it('負例: コメントアウトされた呼び出しは stripLineComments で除外される', () => {
    const src = '  // await generateSummaryCore(ocr, type);';
    expect(countMatches(stripLineComments(src), CORE_DELEGATE_PATTERN)).to.equal(0);
  });

  it('複数回呼び出しも正しくカウント (BUILDER sanity と対称)', () => {
    const src = [
      'await generateSummaryCore(ocr1, type1);',
      'await generateSummaryCore(ocr2, type2);',
    ].join('\n');
    expect(countMatches(src, CORE_DELEGATE_PATTERN)).to.equal(2);
  });
});
