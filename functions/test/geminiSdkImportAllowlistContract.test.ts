/**
 * Gemini SDK 利用範囲の契約テスト (ADR-0027 PR-E、GOAL「通常経路のGemini停止」)
 *
 * 目的: 本番コード(functions/src)で `@google/genai` を import してよいのは、明示指定時だけ
 * 動くOCR緊急用経路(`src/ocr/ocrProcessor.ts`、`OCR_PROVIDER=gemini`)の1ファイルだけに
 * 限定し、要約経路からGeminiへ到達できないことをCIで固定する。要約のGemini経路
 * (旧 `SUMMARY_PROVIDER=gemini` ロールバック運用)を復活させる変更はここで落ちる。
 *
 * 2つの契約を別々に守る(plan-crossreview 指摘4):
 *   A. SDK import の許可リスト: `@google/genai` を参照するファイル集合が ALLOWLIST と完全一致する。
 *   B. 要約からGeminiへ到達しない: 要約経路のエントリから相対 import/require を推移的にたどって
 *      も ocrProcessor.ts と `@google/genai` に到達せず、'gemini' という provider 文字列リテラルも現れない。
 *
 * 方式: TypeScript の構文解析(AST)。正規表現でコメントを除く方式は文字列内の `//` 等で誤判定する
 * ため使わない。検出する形式: 静的 import / `import type` / `export ... from` / 動的 `import()` /
 * `require()` / `import x = require()`。コメント内の言及は構文木に現れないので対象外になる。
 *
 * 将来委譲(docs/context/test-strategy.md §4): 旧 Vertex SDK(`@google-cloud/vertexai`)やREST直叩きで
 * Gemini要約を復活させる経路は本テストの対象外。`summaryPromptBuilderIsolationContract.test.ts` が
 * 旧SDKの不使用を別途守る。
 */

import { expect } from 'chai';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import * as ts from 'typescript';

const GENAI_SPECIFIER = '@google/genai';

// `@google/genai` を参照してよいファイル(functions/ からの相対パス)。理由: OCR緊急用経路。
const ALLOWLIST: readonly string[] = ['src/ocr/ocrProcessor.ts'];

// 要約経路のエントリ。ここから推移的にたどってGeminiへ到達しないことを確認する。
const SUMMARY_ENTRIES: readonly string[] = [
  'src/ocr/summaryPass.ts',
  'src/ocr/generateSummaryBatch.ts',
  'src/ocr/summaryManualRequest.ts',
  'src/ocr/regenerateSummary.ts',
  'src/ocr/summaryRunStore.ts',
  'src/ocr/summaryRunGuard.ts',
  'src/ocr/sarashinaSummaryClient.ts',
];

const FORBIDDEN_FOR_SUMMARY = 'src/ocr/ocrProcessor.ts';

/** ソース中のモジュール参照(import/export from/動的import/require/import=require)の指定子を返す。 */
export function collectModuleSpecifiers(source: string): string[] {
  const sf = ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const specs: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      specs.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      specs.push(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      specs.push(node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node) && node.arguments.length >= 1 && ts.isStringLiteralLike(node.arguments[0])) {
      const callee = node.expression;
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      if (isDynamicImport || isRequire) specs.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return specs;
}

/** ソース中の文字列リテラル(コメントは含まない)のうち、指定値と一致するものがあるか。 */
export function hasStringLiteral(source: string, value: string): boolean {
  const sf = ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) && node.text === value) found = true;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** ソース中の文字列リテラル(コメントは含まない)に、指定の部分文字列を含むものがあるか。 */
export function hasStringLiteralContaining(source: string, needle: string): boolean {
  const sf = ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) && node.text.includes(needle)) found = true;
    else if (ts.isTemplateExpression(node) && [node.head, ...node.templateSpans.map((sp) => sp.literal)].some((t) => t.text.includes(needle))) found = true;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

// GeminiのREST直叩きの兆候(SDKを使わずfetchで呼ぶ復活経路の検知)
const GEMINI_REST_HOSTS = ['aiplatform.googleapis.com', 'generativelanguage.googleapis.com'];

function walkTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) return [];
    if (entry.isDirectory()) return walkTs(full);
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
  });
}

function readWithContext(abs: string, purpose: string): string {
  try {
    return readFileSync(abs, 'utf-8');
  } catch (err) {
    throw new Error(`[${purpose}] readFileSync failed for ${abs}: ${(err as Error).message}`);
  }
}

// functions/ ディレクトリ。テストはESMとして読み込まれ__dirnameが使えないため、cwdから解決する
// (functions/ で実行してもリポジトリルートで実行しても動く)。
const ROOT = existsSync(resolve(process.cwd(), 'src/ocr/ocrProcessor.ts'))
  ? process.cwd()
  : resolve(process.cwd(), 'functions');
const rel = (abs: string): string => relative(ROOT, abs);

/** 相対指定子を src 配下の実ファイルへ解決する(解決できなければ null)。 */
function resolveRelative(fromAbs: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(fromAbs), spec);
  for (const cand of [`${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(cand)) return cand;
  }
  return null;
}

describe('Gemini SDK 利用範囲の契約 (ADR-0027 PR-E)', () => {
  describe('A. @google/genai を参照するファイルの許可リスト', () => {
    it('src 配下で @google/genai を参照するファイルは ALLOWLIST と完全一致する', () => {
      const detected = walkTs(resolve(ROOT, 'src'))
        .filter((f) =>
          collectModuleSpecifiers(readWithContext(f, 'sdk-scan')).some(
            (s) => s === GENAI_SPECIFIER || s.startsWith(`${GENAI_SPECIFIER}/`)
          )
        )
        .map(rel)
        .sort();
      expect(detected).to.deep.equal(
        [...ALLOWLIST].sort(),
        `@google/genai を参照してよいのは OCR緊急用経路だけ。許可外の参照: ${detected.filter((f) => !ALLOWLIST.includes(f)).join(', ') || '(なし)'}`
      );
    });

    it('許可リストのファイルが実在し、実際に @google/genai を参照している(リストの陳腐化防止)', () => {
      for (const f of ALLOWLIST) {
        const abs = resolve(ROOT, f);
        expect(existsSync(abs), `${f} が存在しない`).to.equal(true);
        const specs = collectModuleSpecifiers(readWithContext(abs, 'allowlist-check'));
        expect(specs, `${f} は @google/genai を参照していない(許可リストから外すこと)`).to.include(GENAI_SPECIFIER);
      }
    });

    it('GoogleGenAI / generateContent の呼び出しは許可リストのファイルにしか現れない', () => {
      const offenders = walkTs(resolve(ROOT, 'src'))
        .filter((f) => !ALLOWLIST.includes(rel(f)))
        .filter((f) => /\bnew\s+GoogleGenAI\s*\(|\.generateContent(?:Stream)?\s*\(/.test(readWithContext(f, 'call-scan')))
        .map(rel);
      expect(offenders).to.deep.equal([]);
    });
  });

  describe('B. 要約経路からGeminiへ到達しない', () => {
    const reachable = (entry: string): Set<string> => {
      const seen = new Set<string>();
      const stack = [resolve(ROOT, entry)];
      while (stack.length > 0) {
        const cur = stack.pop() as string;
        if (seen.has(cur)) continue;
        seen.add(cur);
        for (const spec of collectModuleSpecifiers(readWithContext(cur, 'reach-scan'))) {
          const next = resolveRelative(cur, spec);
          if (next) stack.push(next);
        }
      }
      return seen;
    };

    for (const entry of SUMMARY_ENTRIES) {
      it(`${entry} から推移的に ocrProcessor.ts と @google/genai に到達しない`, () => {
        expect(existsSync(resolve(ROOT, entry)), `${entry} が存在しない`).to.equal(true);
        const files = [...reachable(entry)].map(rel);
        expect(files, `${entry} が OCR緊急用経路(ocrProcessor.ts)へ到達している`).to.not.include(FORBIDDEN_FOR_SUMMARY);
        const genaiUsers = files.filter((f) =>
          collectModuleSpecifiers(readWithContext(resolve(ROOT, f), 'genai-scan')).includes(GENAI_SPECIFIER)
        );
        expect(genaiUsers, `${entry} から到達するファイルが @google/genai を参照している`).to.deep.equal([]);
      });

      it(`${entry} に provider 値としての 'gemini' 文字列リテラルが無い`, () => {
        expect(hasStringLiteral(readWithContext(resolve(ROOT, entry), 'literal-scan'), 'gemini')).to.equal(false);
      });
    }

    for (const entry of SUMMARY_ENTRIES) {
      it(`${entry} から到達するファイルにGemini REST直叩きの兆候(エンドポイント文字列)が無い`, () => {
        const offenders = [...reachable(entry)]
          .map(rel)
          .filter((f) => GEMINI_REST_HOSTS.some((h) => hasStringLiteralContaining(readWithContext(resolve(ROOT, f), 'rest-scan'), h)));
        expect(offenders).to.deep.equal([]);
      });
    }

    it('要約生成コア(summaryGenerator.ts)が存在しない', () => {
      expect(existsSync(resolve(ROOT, 'src/ocr/summaryGenerator.ts'))).to.equal(false);
    });
  });

  describe('検知ロジック自体の単体テスト(誤判定防止)', () => {
    it('静的 import / import type / export from / 動的 import / require / import=require を検知する', () => {
      const src = `
        import { a } from '@google/genai';
        import type { B } from '@google/genai' with { 'resolution-mode': 'import' };
        export { c } from '@google/genai';
        const d = await import('@google/genai');
        const e = require('@google/genai');
        import f = require('@google/genai');
      `;
      expect(collectModuleSpecifiers(src).filter((s) => s === GENAI_SPECIFIER)).to.have.length(6);
    });

    it('コメントと通常の文字列内の言及は検知しない', () => {
      const src = `
        // import { a } from '@google/genai';
        /* const d = await import('@google/genai'); */
        const note = "see @google/genai docs // not an import";
        const url = 'https://example.com/@google/genai';
      `;
      expect(collectModuleSpecifiers(src)).to.deep.equal([]);
    });

    it('文字列内に // を含んでいても、後続の本物の import を取りこぼさない', () => {
      const src = `const u = 'http://x'; import('@google/genai');`;
      expect(collectModuleSpecifiers(src)).to.deep.equal(['@google/genai']);
    });

    it('hasStringLiteralContaining はテンプレート文字列を含む実リテラルだけを検知し、コメントは無視する', () => {
      expect(hasStringLiteralContaining("const u = 'https://aiplatform.googleapis.com/v1/x';", 'aiplatform.googleapis.com')).to.equal(true);
      expect(hasStringLiteralContaining('const u = `https://${r}-aiplatform.googleapis.com/v1`;', 'aiplatform.googleapis.com')).to.equal(true);
      expect(hasStringLiteralContaining('// aiplatform.googleapis.com\nconst a = 1;', 'aiplatform.googleapis.com')).to.equal(false);
    });

    it('hasStringLiteral はコメント内の文字列を無視し、実リテラルは検知する', () => {
      expect(hasStringLiteral(`// 'gemini'\nconst a = 1;`, 'gemini')).to.equal(false);
      expect(hasStringLiteral(`const p = 'gemini';`, 'gemini')).to.equal(true);
      expect(hasStringLiteral(`const p = "gemini";`, 'gemini')).to.equal(true);
    });
  });
});
