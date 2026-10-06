/**
 * generateSummary caller-side 不在契約テスト (Issue #225, #214, #548-B1, ADR-0027 PR-E)
 *
 * 目的: 要約生成コア(旧 `generateSummaryCore` / `buildSummaryGenerationRequest`)の復活と、
 * 要約生成を行わないはずの caller からの直接生成(bypass)を検知する。
 *
 * 経緯: Issue #214 で要約生成は summaryGenerator.ts の generateSummaryCore に集約され、
 * Issue #548-B1 で ocrProcessor.ts の自動要約生成が削除された。ADR-0027 PR-C で
 * regenerateSummary.ts は「キューへの登録のみ」になり、生成は generateSummaryBatch→summaryPass
 * (Sarashina)に一本化された。ADR-0027 PR-E で要約のGemini経路(summaryGenerator.ts、
 * buildSummaryGenerationRequest)自体を撤去したため、以下を固定する:
 *   - 要約生成コアの呼び出し(`generateSummaryCore(`)が、どの要約関連ファイルにも存在しない。
 *   - ocrProcessor.ts / regenerateSummary.ts は要約を生成しない。
 *
 * `@google/genai` を参照してよいファイルの限定と、要約経路からGeminiへ到達しないことは
 * `geminiSdkImportAllowlistContract.test.ts` が構文解析(AST)で別途固定する。
 *
 * 方式: grep-based (docs/context/test-strategy.md §2.1 参照)。
 * 既知の limitation: 型 alias 経由 (const gen = xxx.generateContent; gen(...)) や分割代入は未検出。
 * 将来委譲: false negative 実発生時は構文解析の契約へ寄せる(上記テストが既に到達性を見ている)。
 */

import { expect } from 'chai';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const CORE_DELEGATE_PATTERN = /generateSummaryCore\s*\(/g;
const REQUEST_BUILDER_PATTERN = /buildSummaryGenerationRequest\s*\(/g;

// 要約生成コア(旧 generateSummaryCore)を呼ばない caller 群。
// Issue #548-B1: ocrProcessor.ts は要約生成に一切関与しない。
// PR-C: regenerateSummary.ts は登録のみ(L1/L2ゲートと直列実行を迂回する直接生成を許さない)。
// PR-E: 生成を担う summaryPass.ts / generateSummaryBatch.ts / summaryManualRequest.ts も、
// 旧コアへの委譲(Gemini経路)を持たない。
const SUMMARY_CORE_FREE_FILES = [
  'src/ocr/ocrProcessor.ts',
  'src/ocr/regenerateSummary.ts',
  'src/ocr/summaryPass.ts',
  'src/ocr/generateSummaryBatch.ts',
  'src/ocr/summaryManualRequest.ts',
  'src/ocr/summaryRunStore.ts',
];

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

describe('generateSummary 不在契約 (Issue #548-B1 / ADR-0027 PR-E)', () => {
  for (const relPath of SUMMARY_CORE_FREE_FILES) {
    it(`${relPath} は generateSummaryCore / buildSummaryGenerationRequest を呼ばない (Gemini要約経路の復活防止)`, () => {
      const absPath = resolve(process.cwd(), relPath);
      const source = stripLineComments(readFileSync(absPath, 'utf-8'));
      expect(countMatches(source, CORE_DELEGATE_PATTERN)).to.equal(
        0,
        `${relPath} で generateSummaryCore 呼び出しを検出。要約の生成は generateSummaryBatch(summaryPass 経由、Sarashina)に一本化されている。`
      );
      expect(countMatches(source, REQUEST_BUILDER_PATTERN)).to.equal(
        0,
        `${relPath} で buildSummaryGenerationRequest 呼び出しを検出。要約のGemini経路は撤去済み(ADR-0027 PR-E)。`
      );
    });
  }
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

  it('複数回呼び出しも正しくカウント', () => {
    const src = ['await generateSummaryCore(ocr1, type1);', 'await generateSummaryCore(ocr2, type2);'].join('\n');
    expect(countMatches(src, CORE_DELEGATE_PATTERN)).to.equal(2);
  });

  it('REQUEST_BUILDER_PATTERN は buildSummaryGenerationRequest の呼び出しにマッチし、import 識別子にはマッチしない', () => {
    expect(countMatches('ai.models.generateContent(buildSummaryGenerationRequest(prompt))', REQUEST_BUILDER_PATTERN)).to.equal(1);
    expect(countMatches("import { buildSummaryGenerationRequest } from './x';", REQUEST_BUILDER_PATTERN)).to.equal(0);
  });
});
