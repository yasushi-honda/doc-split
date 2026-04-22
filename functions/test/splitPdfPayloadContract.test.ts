/**
 * splitPdf 元ドキュメント update payload 契約テスト (Issue #375 AC3 bundle)
 *
 * 目的: pdfOperations.ts の splitPdf 末尾 `docRef.update({...})` が
 *   - splitInto
 *   - status: 'split'
 *   - isSplitSource: true
 * の 3 フィールドのみであることを lock-in。4 番目のフィールドが追加された場合、
 * 既存の Gmail 再取り込み判定 (isSplitSource 依存) と Firestore クエリが
 * silent に drift する可能性がある。
 *
 * 背景: PR #374 pr-test-analyzer rating 6 指摘 → Issue #375 bundle として対応。
 * 選定理由: 3 フィールドの薄い update に対し payload builder 抽出は over-engineering。
 * #200 AC2 の endpoint contract と同じ grep-based + extractBraceBlock で統一する。
 *
 * 方式: #200 AC2 (checkGmailAttachmentsEndpointContract.test.ts) と同形式の
 * grep-based contract。source import は避けてソースファイル文字列を直接解析する。
 */

import { expect } from 'chai';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { extractBraceBlock } from './helpers/extractBraceBlock';

const SOURCE_PATH = 'src/pdf/pdfOperations.ts';
// 元ドキュメントを `isSplitSource: true` に更新する箇所の anchor。
// 先行する `// 元ドキュメントのステータスを更新` コメントを起点にし、
// forEach 内 split doc 書き込みの `newDocRef` 箇所と混同しないようにする。
const UPDATE_ANCHOR =
  /元ドキュメントのステータスを更新[\s\S]*?await\s+docRef\.update\s*\(/;

let payloadBlock: string | null = null;

let sourceText: string = '';

describe('splitPdf docRef.update payload contract (#375 AC3)', () => {
  before(() => {
    const path = resolve(__dirname, '..', SOURCE_PATH);
    if (!existsSync(path)) {
      throw new Error(`Source file not found: ${SOURCE_PATH}`);
    }
    sourceText = readFileSync(path, 'utf-8');
    payloadBlock = extractBraceBlock(sourceText, UPDATE_ANCHOR, {
      anchorMode: 'after-match',
    });
    // 以降の it で payloadBlock null 前提で assert するため、ここで早期 throw する
    // (#378 silent-failure-hunter M1 対応: `.to.match(null)` は Chai で TypeError
    // になる点は既に loud failure だが、診断情報を 1 箇所に集約して原因特定を高速化)。
    if (payloadBlock === null) {
      throw new Error(
        `splitPdf docRef.update payload block not found in ${SOURCE_PATH}. ` +
          `Anchor: ${UPDATE_ANCHOR.source}`,
      );
    }
  });

  it('anchor コメント "元ドキュメントのステータスを更新" がソース内に 1 箇所のみ存在する', () => {
    // UPDATE_ANCHOR の先頭コメント部分がソース内で複製されると、non-greedy 検索が
    // 別 `docRef.update` にマッチする silent regression が発生しうる
    // (#378 pr-test-analyzer I1 対応)。コメントの一意性そのものを lock-in する。
    const matches = sourceText.match(/元ドキュメントのステータスを更新/g);
    expect(matches, 'anchor comment must match exactly once').to.not.be.null;
    expect(matches).to.have.lengthOf(1);
  });

  it('splitInto フィールドが含まれる', () => {
    expect(payloadBlock).to.match(/\bsplitInto\s*:/);
  });

  it('status: "split"', () => {
    expect(payloadBlock).to.match(/\bstatus\s*:\s*['"]split['"]/);
  });

  it('isSplitSource: true (Gmail 再取り込み判定の前提)', () => {
    expect(payloadBlock).to.match(/\bisSplitSource\s*:\s*true\b/);
  });

  it('payload フィールド数は 3 のみ (4 番目追加で decisive fail)', () => {
    // trailing comma を除去した上でトップレベルのキーをカウント。
    // ネストした object (現状なし) を含む場合は depth tracking が必要だが、
    // 4 番目が原始値でも object でも確実に検知できるよう、
    // payload 内のトップレベル `key:` の出現数で判定する。
    expect(payloadBlock, 'payloadBlock must be non-null').to.not.be.null;
    const topLevelKeyCount = countTopLevelKeys(payloadBlock as string);
    expect(topLevelKeyCount).to.equal(
      3,
      `splitPdf docRef.update payload has ${topLevelKeyCount} top-level keys ` +
        `(expected 3: splitInto / status / isSplitSource). ` +
        `Adding a 4th field risks drifting the Gmail re-import decision ` +
        `(evaluateReimportDecision, src/gmail/reimportPolicy.ts) and other ` +
        `isSplitSource-dependent logic. Update this contract deliberately ` +
        `when extending the split source metadata.`,
    );
  });
});

/**
 * `{ key1: v1, key2: { nested }, key3: v3 }` の top-level key 数を数える。
 * ネスト object 内の key はカウント対象外。
 */
function countTopLevelKeys(block: string): number {
  // 先頭 `{` と末尾 `}` を剥がして中身だけを対象にする
  const inner = block.slice(1, -1);
  let depth = 0;
  let count = 0;
  let tokenStart = 0;
  // 簡易 parser: `,` で区切られるエントリを列挙し、
  // 各エントリの最初の `:` が depth 0 なら key とみなす。
  for (let i = 0; i <= inner.length; i++) {
    const ch = inner[i];
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    else if ((ch === ',' || i === inner.length) && depth === 0) {
      const entry = inner.slice(tokenStart, i);
      if (hasTopLevelColon(entry)) count++;
      tokenStart = i + 1;
    }
  }
  return count;
}

/** entry の中で depth 0 の `:` が 1 個以上あるか (key:value エントリか判定) */
function hasTopLevelColon(entry: string): boolean {
  let depth = 0;
  for (let i = 0; i < entry.length; i++) {
    const ch = entry[i];
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    else if (ch === ':' && depth === 0) return true;
  }
  return false;
}
