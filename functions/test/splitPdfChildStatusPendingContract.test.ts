/**
 * splitPdf 子ドキュメント status:'pending' 契約テスト (Issue #526 PR4)
 *
 * 背景: 子ドキュメントは以前 `status: 'processed'` で直接生成され、OCR再処理パイプライン
 * (`processOCR`ポーリング)を経由しなかった。PR3で実装済みのconfirmed保護マージ/pageResults
 * 再利用ロジックを実運用で到達させるため、子を`status: 'pending'`で生成しパイプラインに
 * 乗せるよう変更した。
 *
 * このテストは、子ドキュメントpayload構築ブロックが`status: 'pending'`に固定されており、
 * 旧実装の`status: 'processed'`直書きが残っていないことをsource文字列レベルでlock-inする
 * (`splitPdfChildConfirmedAttributionContract.test.ts`と同形式)。
 *
 * 親ドキュメントの`status: 'split'`更新(`splitPdfPayloadContract.test.ts`が別途lock-in)とは
 * 対象ブロックが異なるため、本テストは子payloadブロックに限定して検証する
 * (ファイル全体走査だと親update側の`status: 'split'`等、無関係な箇所まで巻き込みうるため)。
 */

import { expect } from 'chai';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { extractBraceBlock } from './helpers/extractBraceBlock';

const SOURCE_PATH = 'src/pdf/pdfOperations.ts';
const PAYLOAD_ANCHOR = /const payload: Record<string, unknown> = \{/;

let payloadBlock: string | null = null;
let sourceText = '';

describe('splitPdf 子ドキュメント status:pending 契約 (Issue #526 PR4)', () => {
  before(() => {
    const path = resolve(__dirname, '..', SOURCE_PATH);
    if (!existsSync(path)) {
      throw new Error(`Source file not found: ${SOURCE_PATH}`);
    }
    sourceText = readFileSync(path, 'utf-8');
    payloadBlock = extractBraceBlock(sourceText, PAYLOAD_ANCHOR, {
      anchorMode: 'from-start',
    });
    expect(payloadBlock, 'splitPdf 子ドキュメント payload block not found').to.not.equal(null);
  });

  it('子payloadブロックに status: \'pending\' が含まれる', () => {
    expect(payloadBlock).to.match(/status:\s*'pending'/);
  });

  it('子payloadブロックに status: \'processed\' の直書きが残っていない(旧実装の巻き戻り防止)', () => {
    expect(payloadBlock).to.not.match(/status:\s*'processed'/);
  });

  it('子payloadブロックに processedAt が設定されている(processOCRポーリングクエリのorderBy対象)', () => {
    expect(payloadBlock).to.match(/processedAt:\s*admin\.firestore\.FieldValue\.serverTimestamp\(\)/);
  });

  it('子payloadブロックに parentDocumentId: documentId が設定されている(pageResults再利用条件)', () => {
    expect(payloadBlock).to.match(/parentDocumentId:\s*documentId/);
  });
});
