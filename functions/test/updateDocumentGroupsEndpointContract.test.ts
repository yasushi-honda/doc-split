/**
 * onDocumentWrite (documents集計トリガー) endpoint 設定契約テスト (Issue #660 / ADR-0020)
 *
 * 目的: `retry: true` が退行しないことを保証する。
 *
 * 背景: 冪等台帳(documentAggregationEvents)方式により、同一event.idの再試行は
 * 安全にskipされる設計になった(ADR-0020)。この前提の上で`retry: true`を設定して
 * いるが、`retry: false`(既定)に戻ると、トランザクション失敗(競合リトライ上限
 * 超過等)時にイベントが再試行されず静かにdropされ、その1件分の集計deltaが永久に
 * 失われる — Issue #660が解決したドリフトを別の入口から再導入してしまう
 * (/codex planセカンドオピニオン指摘)。`retry`はコンパイルエラーを起こさず
 * 静かに退行しうる runtime option のため、grep-based contractで固定する。
 *
 * 方式: grep-based (docs/context/test-strategy.md §2.1 参照)。
 * source import は `admin.firestore()` top-level 評価で副作用が大きく、unit test 環境に
 * emulator host を注入すると他テストに波及するため、ソースファイル文字列から
 * `onDocumentWritten` の options literal を読み取って assert する。
 *
 * 将来委譲: なし(現時点で委譲先の設計変更予定なし)。
 */

import { expect } from 'chai';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { extractBraceBlock } from './helpers/extractBraceBlock';

const SOURCE_PATH = 'src/triggers/updateDocumentGroups.ts';
const ON_DOCUMENT_WRITE_ANCHOR = /export\s+const\s+onDocumentWrite\s*=\s*onDocumentWritten\s*\(/;

let optionsBlock: string = '';

describe('onDocumentWrite endpoint contract (Issue #660 / ADR-0020)', () => {
  before(() => {
    const path = resolve(__dirname, '..', SOURCE_PATH);
    if (!existsSync(path)) {
      throw new Error(`Source file not found: ${SOURCE_PATH}`);
    }
    const source = readFileSync(path, 'utf-8');
    // onDocumentWritten( anchor の直後から最初の `{` 〜 対応する `}` を options object として抽出
    const block = extractBraceBlock(source, ON_DOCUMENT_WRITE_ANCHOR, {
      anchorMode: 'after-match',
    });
    if (block === null) {
      throw new Error(
        `onDocumentWritten options block not found in ${SOURCE_PATH}. ` +
          `Anchor: ${ON_DOCUMENT_WRITE_ANCHOR.source}`,
      );
    }
    optionsBlock = block;
  });

  it('retry: true (Issue #660 / ADR-0020 冪等台帳前提。falseに戻すとドリフトが再導入される)', () => {
    expect(optionsBlock).to.match(/retry:\s*true\b/);
  });

  it('document: documents/{docId}', () => {
    expect(optionsBlock).to.match(/document:\s*['"]documents\/\{docId\}['"]/);
  });

  it('region: asia-northeast1', () => {
    expect(optionsBlock).to.match(/region:\s*['"]asia-northeast1['"]/);
  });
});
