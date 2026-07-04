/**
 * splitPdf 子ドキュメント confirmedBy/officeConfirmedBy 条件付き書込み契約テスト (Issue #526)
 *
 * 背景: buildSplitDocumentData の customerConfirmed/officeConfirmed は、以前は無条件 true
 * 固定だったため、pdfOperations.ts 側で confirmedBy/confirmedAt/officeConfirmedBy/
 * officeConfirmedAt を無条件に書き込んでも矛盾しなかった。Issue #526 でフロントエンドが
 * 明示送信したconfirmedフラグをそのまま反映するよう変更した結果、*Confirmed: false の
 * ドキュメントに *ConfirmedBy/*ConfirmedAt が入る「未確認なのに確認者がいる」矛盾状態が
 * 生まれる可能性が判明した（Codex/code-reviewer/silent-failure-hunter 3件独立指摘）。
 *
 * このテストは、pdfOperations.ts の子ドキュメントpayload構築が
 * splitDocFields.customerConfirmed/officeConfirmed を条件に確認者情報を出し分けている
 * ことをlock-inする。#375 と同形式のgrep-based contract。
 */

import { expect } from 'chai';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { extractBraceBlock } from './helpers/extractBraceBlock';

const SOURCE_PATH = 'src/pdf/pdfOperations.ts';
// 子ドキュメントpayload構築の anchor。`buildSplitDocumentData` 呼出直後の
// `const payload: Record<string, unknown> = {` ブロックを対象にする。
const PAYLOAD_ANCHOR = /const payload: Record<string, unknown> = \{/;

let payloadBlock: string | null = null;
let sourceText = '';

describe('splitPdf 子ドキュメント confirmedBy 条件付き書込み契約 (#526)', () => {
  before(() => {
    const path = resolve(__dirname, '..', SOURCE_PATH);
    if (!existsSync(path)) {
      throw new Error(`Source file not found: ${SOURCE_PATH}`);
    }
    sourceText = readFileSync(path, 'utf-8');
    payloadBlock = extractBraceBlock(sourceText, PAYLOAD_ANCHOR, {
      anchorMode: 'from-start',
    });
    if (payloadBlock === null) {
      throw new Error(
        `splitPdf 子ドキュメント payload block not found in ${SOURCE_PATH}. ` +
          `Anchor: ${PAYLOAD_ANCHOR.source}`,
      );
    }
  });

  it('anchor がソース内に 1 箇所のみ存在する', () => {
    const matches = sourceText.match(/const payload: Record<string, unknown> = \{/g);
    expect(matches, 'anchor must match exactly once').to.not.be.null;
    expect(matches).to.have.lengthOf(1);
  });

  it('confirmedBy は splitDocFields.customerConfirmed を条件に出し分けている（無条件代入ではない）', () => {
    expect(payloadBlock).to.match(
      /confirmedBy:\s*splitDocFields\.customerConfirmed\s*\?/,
    );
  });

  it('confirmedAt は splitDocFields.customerConfirmed を条件に出し分けている', () => {
    expect(payloadBlock).to.match(
      /confirmedAt:\s*splitDocFields\.customerConfirmed\s*\?/,
    );
  });

  it('officeConfirmedBy は splitDocFields.officeConfirmed を条件に出し分けている', () => {
    expect(payloadBlock).to.match(
      /officeConfirmedBy:\s*splitDocFields\.officeConfirmed\s*\?/,
    );
  });

  it('officeConfirmedAt は splitDocFields.officeConfirmed を条件に出し分けている', () => {
    expect(payloadBlock).to.match(
      /officeConfirmedAt:\s*splitDocFields\.officeConfirmed\s*\?/,
    );
  });

  it('無条件の request.auth?.uid || null 直書き（旧実装）が残っていない', () => {
    // 旧実装: `confirmedBy: request.auth?.uid || null,`（三項演算子なしの直書き）
    expect(payloadBlock).to.not.match(
      /confirmedBy:\s*request\.auth\?\.uid\s*\|\|\s*null,/,
    );
  });
});
