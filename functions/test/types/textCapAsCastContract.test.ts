/**
 * textCap.ts `as T` cast 不在 + dev-assert 存在の grep 契約テスト (Issue #284)
 *
 * 目的: capPageResultsAggregate の戻り値型を CappedAggregatePage (= Omit<T,...> & SummaryField)
 * に変更し、`as T` cast 2 箇所を排除した構成を静的に lock-in する。
 *
 * 背景 (#284):
 * PR #282 (#264) 時点で `as T` cast 2 箇所が narrow 型 T (例: truncated=true 固定) を渡された
 * 場合の silent 契約違反を通していた。本 refactor で cast を排除し、戻り値型を SummaryField フル
 * union 復帰させることで static 検知に切り替え + dev-assert (Option B) で runtime 早期検知を追加。
 *
 * 本 contract は以下を lock-in する:
 * 1. textCap.ts の実コード内で `as T` cast が 0 箇所であること (コメント内説明文は除外)
 * 2. capPageResultsAggregate の signature が `<T extends SummaryField>` + Array<CappedAggregatePage<T>>
 *    に近い形であること (実装詳細の揺れは許容するが主要 shape は固定)
 * 3. dev-assert (process.env.NODE_ENV !== 'production' gate) が同関数 scope 内に存在すること
 *
 * 方式: コード文字列を読み、コメント行を除外してから pattern を検出する。
 */

import { expect } from 'chai';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const TEXT_CAP_PATH = 'src/utils/textCap.ts';

/**
 * 行頭からの `//` または block `/* ... *\/` コメントを除去する簡易サニタイザ。
 * テンプレートリテラル内の `//` を誤除去しないよう、行全体が `*`/`//` 始まりの場合のみ落とす。
 * block コメントは開閉のみを見る粗い実装 (textCap.ts は JSDoc 中心でネスト無し前提)。
 */
function stripComments(source: string): string {
  const lines = source.split('\n');
  const result: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (inBlock) {
      if (trimmed.includes('*/')) inBlock = false;
      continue;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlock = true;
      continue;
    }
    if (trimmed.startsWith('*') || trimmed.startsWith('//')) continue;
    // 行末の `//` コメントは許容: source code 部分 + trailing comment パターンを
    // 雑に切る (文字列リテラル内 `//` を誤除去するケースは textCap.ts には存在しない)。
    const slashIdx = line.indexOf('//');
    result.push(slashIdx >= 0 ? line.slice(0, slashIdx) : line);
  }
  return result.join('\n');
}

describe('textCap as T cast 排除 contract (#284)', () => {
  const absPath = resolve(process.cwd(), TEXT_CAP_PATH);

  before(() => {
    if (!existsSync(absPath)) {
      throw new Error(
        `${TEXT_CAP_PATH} が存在しない。textCap.ts のリネーム/移設時は本契約の見直しが必要。`,
      );
    }
  });

  const source = existsSync(absPath) ? readFileSync(absPath, 'utf-8') : '';
  const code = stripComments(source);

  it('実コード内に `as T` cast が存在しない (#284 AC-1)', () => {
    // word boundary 付きで "as T" を検出。"as Type", "as unknown" 等は誤検知しない。
    const AS_T_CAST = /\bas\s+T\b/;
    expect(AS_T_CAST.test(code)).to.equal(
      false,
      '`as T` cast が textCap.ts 実コード内に残っている。' +
        'narrow 型 T (例: truncated=true 固定) を caller が渡した場合に silent 契約違反が通る ' +
        '(#284 で排除したはず)。',
    );
  });

  it('capPageResultsAggregate の戻り値型が CappedAggregatePage ベース (#284 AC-3)', () => {
    // signature 行の揺れを吸収するため、関数名と戻り値型キーワードの組で検出。
    const SIGNATURE = /capPageResultsAggregate<T\s+extends\s+SummaryField>/;
    expect(SIGNATURE.test(code)).to.equal(
      true,
      'capPageResultsAggregate<T extends SummaryField> シグネチャが見つからない。#264 + #284 の型制約が崩れた可能性。',
    );
    const RETURN_TYPE = /CappedAggregatePage<T>/;
    expect(RETURN_TYPE.test(code)).to.equal(
      true,
      '戻り値型に CappedAggregatePage<T> が使われていない。' +
        '`as T` cast 排除後の戻り値型 contract (#284) が崩れた可能性。',
    );
  });

  it('aggregate 用 dev-assert が独立に存在する (#284 AC-2)', () => {
    // evaluator MEDIUM 指摘対応: `!==` pattern だけだと capPageText 側の既存 dev-assert に一致して
    // false-pass する。`!==` と `===` の両方 (equal gate) + aggregate 固有 assert 関数名の
    // 独立検出で「aggregate 経路に dev-assert が存在すること」を直接 lock-in する。
    const ENV_GATE_EQUAL = /process\.env\.NODE_ENV\s*[!=]==\s*['"]production['"]/g;
    const gateMatches = code.match(ENV_GATE_EQUAL) ?? [];
    expect(gateMatches.length).to.be.at.least(
      2,
      'process.env.NODE_ENV の production gate が 2 箇所 (capPageText + aggregate) 揃っていない。' +
        'capPageText 側の dev-assert が消えた、または aggregate 用 dev-assert が消失した可能性。',
    );

    // aggregate 用 assert 関数 (または同等の関数名) が存在することを独立に検証。
    // 名称変更を許容するため "assert.*Aggregate.*Invariant" の緩いパターンで検出。
    const AGGREGATE_ASSERT_FN = /assert\w*Aggregate\w*Invariant/;
    expect(AGGREGATE_ASSERT_FN.test(code)).to.equal(
      true,
      'aggregate 用 invariant assert 関数 (assert...Aggregate...Invariant) が存在しない。' +
        '#284 で追加した `assertAggregatePageInvariant` が削除 or リネームされた可能性。',
    );

    const INVARIANT_ASSERT = /invariant\s+violation/i;
    expect(INVARIANT_ASSERT.test(code)).to.equal(
      true,
      '"invariant violation" エラーメッセージが textCap.ts 内に存在しない。' +
        '#284 で追加した dev-assert が削除された可能性。',
    );
  });

  describe('stripComments sanitizer', () => {
    it('positive: `//` で始まる行を除去する', () => {
      const fixture = 'const x = 1;\n// comment line\nconst y = 2;';
      expect(stripComments(fixture)).to.not.include('comment line');
      expect(stripComments(fixture)).to.include('const x = 1');
      expect(stripComments(fixture)).to.include('const y = 2');
    });

    it('positive: block コメント `/* ... */` を除去する', () => {
      const fixture = 'const x = 1;\n/**\n * JSDoc with as T example\n */\nconst y = 2;';
      expect(stripComments(fixture)).to.not.include('as T');
    });

    it('positive: 行末の `//` コメントを除去する', () => {
      const fixture = 'const x = 1; // trailing comment with as T';
      expect(stripComments(fixture)).to.include('const x = 1');
      expect(stripComments(fixture)).to.not.include('as T');
    });
  });
});

describe('RawPageOcrResult 命名 contract (#278)', () => {
  const BUILD_PAGE_RESULT_PATH = 'src/ocr/buildPageResult.ts';

  it('buildPageResult.ts で export される型名が RawPageOcrResult (#278 AC-4)', () => {
    const absPath = resolve(process.cwd(), BUILD_PAGE_RESULT_PATH);
    if (!existsSync(absPath)) {
      throw new Error(
        `${BUILD_PAGE_RESULT_PATH} が存在しない。ファイルリネーム時は本契約の見直しが必要。`,
      );
    }
    const source = readFileSync(absPath, 'utf-8');
    const EXPORT_RAW = /export\s+type\s+RawPageOcrResult\b/;
    expect(EXPORT_RAW.test(source)).to.equal(
      true,
      'buildPageResult.ts に `export type RawPageOcrResult` が見つからない。' +
        '#278 の命名規約 (shared/types.ts の PageOcrResult との 3 重定義回避) が崩れた可能性。',
    );

    const EXPORT_OLD_NAME = /export\s+type\s+PageOcrResult\b/;
    expect(EXPORT_OLD_NAME.test(source)).to.equal(
      false,
      'buildPageResult.ts で旧名 `PageOcrResult` の export が復活している。' +
        'shared/types.ts の post-processed PageOcrResult と衝突するため #278 で禁止した。',
    );
  });
});
