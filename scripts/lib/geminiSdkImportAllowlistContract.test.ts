/**
 * Gemini SDK 利用範囲の契約 — scripts / frontend / shared 側 (ADR-0027 PR-E)
 *
 * 目的: `@google/genai` を参照してよいのは functions/src/ocr/ocrProcessor.ts(OCR緊急用経路)だけ。
 * scripts・frontend・shared には1件も無いことを固定する(評価用の比較スクリプト等を再び
 * 生やしても、顧客データをGeminiへ送る経路が本番外に増えないようにする)。functions 側は
 * functions/test/geminiSdkImportAllowlistContract.test.ts が守る。
 *
 * 方式: TypeScript の構文解析(AST)。静的 import / `import type` / `export ... from` /
 * 動的 `import()` / `require()` / `import x = require()` を検出し、コメントと通常の文字列内の
 * 言及は対象外にする(正規表現でコメントを除く方式は文字列内の `//` 等で誤判定するため使わない)。
 * 対象拡張子: .ts .tsx .js .mjs .cjs。
 *
 * 将来委譲: 新たな評価用スクリプトでGeminiを使う必要が出た場合は、ALLOWLIST に理由つきで追加する
 * (ADR-0027 の「Gemini SDKはOCR緊急用経路のみ」の方針変更として扱い、decision-makerの承認を得ること)。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as ts from 'typescript';

const GENAI = '@google/genai';
const repoRoot = resolve(__dirname, '..', '..');

/** 許可するファイル(repoRoot からの相対パス)。現在は空 — scripts等でSDKを使ってはならない。 */
const ALLOWLIST = new Set<string>([]);

const SCAN_ROOTS = ['scripts', 'frontend/src', 'shared'];
const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', 'lib-cjs', 'coverage']);

function collectModuleSpecifiers(source: string, fileName: string): string[] {
  const kind = /\.(js|mjs|cjs)$/.test(fileName) ? ts.ScriptKind.JS : /\.tsx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
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
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require')) {
        specs.push(node.arguments[0].text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return specs;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIRS.has(entry.name) || entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test('scripts / frontend/src / shared に @google/genai を参照するファイルが無い(許可リスト外)', () => {
  const violations: string[] = [];
  for (const root of SCAN_ROOTS) {
    for (const file of walk(resolve(repoRoot, root))) {
      const rel = relative(repoRoot, file).split('\\').join('/');
      if (ALLOWLIST.has(rel)) continue;
      const specs = collectModuleSpecifiers(readFileSync(file, 'utf-8'), file);
      if (specs.some((s) => s === GENAI || s.startsWith(`${GENAI}/`))) violations.push(rel);
    }
  }
  assert.deepEqual(violations, [], `@google/genai の参照は OCR緊急用経路(functions/src/ocr/ocrProcessor.ts)だけに限る。違反: ${violations.join(', ')}`);
});

test('scripts/package.json の dependencies に @google/genai が無い(使わない依存を残さない)', () => {
  const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'scripts', 'package.json'), 'utf-8'));
  assert.equal(Object.prototype.hasOwnProperty.call(pkg.dependencies ?? {}, GENAI), false);
});

test('検知ロジック: 静的/型/export from/動的/require/import=require を検知し、コメントと文字列内は検知しない', () => {
  const positives = [
    "import { a } from '@google/genai';",
    "import type { B } from '@google/genai';",
    "export { c } from '@google/genai';",
    "const d = await import('@google/genai');",
    "const e = require('@google/genai');",
    "import f = require('@google/genai');",
  ];
  for (const src of positives) {
    assert.deepEqual(collectModuleSpecifiers(src, 'x.ts'), [GENAI], src);
  }
  const negatives = [
    "// import { a } from '@google/genai';",
    "/* const d = await import('@google/genai'); */",
    'const note = "see @google/genai docs // not an import";',
  ];
  for (const src of negatives) {
    assert.deepEqual(collectModuleSpecifiers(src, 'x.ts'), [], src);
  }
  assert.deepEqual(collectModuleSpecifiers("const u = 'http://x'; require('@google/genai');", 'x.js'), [GENAI]);
});
