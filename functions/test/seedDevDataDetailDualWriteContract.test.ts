/**
 * scripts/seed-dev-data.ts の detail/main dual-write 配線契約テスト
 * (ADR-0018 Phase B, Issue #547)
 *
 * processed/error 書類・pending 書類の投入時、本体docと同一batch内で
 * detail/main へ ocrResult を dual-write する配線をソース文字列レベルでlock-in
 * する(documentCreationDetailDualWriteContract.test.ts と同形式)。
 */

import { expect } from 'chai';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { extractBraceBlock } from './helpers/extractBraceBlock';

describe('seed-dev-data.ts detail/main dual-write contract (ADR-0018 Phase B)', () => {
  let source: string | null = null;

  before(() => {
    const fullPath = resolve(__dirname, '..', '..', 'scripts', 'seed-dev-data.ts');
    source = existsSync(fullPath) ? readFileSync(fullPath, 'utf-8') : null;
  });

  it('ソースファイルが存在する', () => {
    expect(source, 'scripts/seed-dev-data.ts must exist').to.not.be.null;
  });

  it('BATCH_SIZEは250 (書込み要素数の上限、1docあたり2writeのため実質125doc分)', () => {
    expect(source).to.match(/const BATCH_SIZE = 250;/);
  });

  it('旧BATCH_SIZE=400の判定は残存しない (回帰防止)', () => {
    expect(source).to.not.match(/const BATCH_SIZE = 400;/);
  });

  it('processed/error書類の投入でbulkDocsをflatMapしdetail/mainへocrResultをdual-writeする', () => {
    const block = extractBraceBlock(
      source,
      /bulkDocs\.flatMap\(\(d\) => \{/,
      { anchorMode: 'from-start' }
    );
    expect(block, 'bulkDocs.flatMap block must be found').to.not.be.null;
    expect(block).to.match(/ref\.collection\('detail'\)\.doc\('main'\)/);
    expect(block).to.match(/ocrResult:\s*d\.data\.ocrResult/);
  });

  it('pending書類の投入でdetail/mainへocrResultをdual-writeするpushがある', () => {
    const loopBlock = extractBraceBlock(
      source,
      /for \(const d of pendingDocs\) \{/,
      { anchorMode: 'from-start' }
    );
    expect(loopBlock, 'pendingDocs for-loop block must be found').to.not.be.null;
    expect(loopBlock).to.match(/pendingWrites\.push\(\{\s*ref,\s*data:\s*d\.data,?\s*\}\)/);
    expect(loopBlock).to.match(/ref\.collection\('detail'\)\.doc\('main'\)/);
    expect(loopBlock).to.match(/ocrResult:\s*d\.data\.ocrResult/);
  });
});
