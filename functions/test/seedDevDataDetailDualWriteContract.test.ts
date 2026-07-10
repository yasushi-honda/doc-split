/**
 * scripts/seed-dev-data.ts の detail/main dual-write 配線契約テスト
 * (ADR-0018 Phase B〜E, Issue #547)
 *
 * processed/error 書類・pending 書類の投入時、本体docと同一batch内で
 * detail/main へ ocrResult を dual-write する配線をソース文字列レベルでlock-in
 * する(documentCreationDetailDualWriteContract.test.ts と同形式)。
 *
 * Phase E (dual-write停止): d.data (buildProcessedDoc/buildPendingDocの戻り値) は
 * seed値生成の都合上ocrResultを含んだままなので、本体書込み直前に
 * `const { ocrResult, ...parentData } = d.data;` で分離し、本体には parentData
 * (ocrResult除外済み)を、detail/mainには分離した ocrResult 変数を書く。値そのものの
 * lock-in は scripts/lib/parentWriteOcrFieldExclusionContract.test.ts が担う。
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
    expect(block).to.match(/const \{ ocrResult, \.\.\.parentData \} = d\.data;/);
    expect(block).to.match(/\{ ref, data: parentData \}/);
    expect(block).to.match(/ref\.collection\('detail'\)\.doc\('main'\)/);
    expect(block).to.match(/ocrResult:\s*ocrResult\s*as\s*string/);
  });

  it('pending書類の投入でdetail/mainへocrResultをdual-writeするpushがある', () => {
    const loopBlock = extractBraceBlock(
      source,
      /for \(const d of pendingDocs\) \{/,
      { anchorMode: 'from-start' }
    );
    expect(loopBlock, 'pendingDocs for-loop block must be found').to.not.be.null;
    expect(loopBlock).to.match(/const \{ ocrResult, \.\.\.parentData \} = d\.data;/);
    expect(loopBlock).to.match(/pendingWrites\.push\(\{ ref, data: parentData \}\)/);
    expect(loopBlock).to.match(/ref\.collection\('detail'\)\.doc\('main'\)/);
    expect(loopBlock).to.match(/ocrResult:\s*ocrResult\s*as\s*string/);
  });
});
