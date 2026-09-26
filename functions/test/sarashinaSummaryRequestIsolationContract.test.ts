/**
 * sarashinaSummaryRequest の外部依存ゼロ契約テスト(ADR-0027 PR3)
 *
 * summaryPromptBuilderIsolationContract.test.ts と同型。`scripts/lib/sarashinaSummaryVerify.ts`
 * (scripts配下、CommonJS)がこのモジュールへ委譲するため、admin/google-auth-library等への
 * 依存を一切持たないことを構造的にlock-inする。
 */

import { expect } from 'chai';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import './helpers/extractBraceBlock';

const SOURCE_PATH = 'src/ocr/sarashinaSummaryRequest.ts';

describe('sarashinaSummaryRequest 外部依存ゼロ契約 (ADR-0027 PR3)', () => {
  let source: string;

  before(() => {
    const path = resolve(__dirname, '..', SOURCE_PATH);
    if (!existsSync(path)) {
      throw new Error(`Source file not found: ${SOURCE_PATH}`);
    }
    source = readFileSync(path, 'utf-8');
  });

  it('import 文を 1 つも含まない(純粋な定数 + 関数のみ、scripts配下からの委譲を安全にする)', () => {
    const importLines = source.match(/^import\s+.+?from\s+['"][^'"]+['"];?\s*$/gm) ?? [];
    expect(importLines).to.deep.equal([]);
  });
});
