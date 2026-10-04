/**
 * 要約キューのFirestore複合インデックス定義の存在契約 (PR-C)
 *
 * emulatorは複合インデックスを強制しないため、`generateSummaryBatch`のクエリに必要なインデックスが
 * `firestore.indexes.json`から欠けても統合テストは通ってしまう。欠落すると本番では毎tick
 * FAILED_PRECONDITIONで失敗する(2026-10-04にkanameone/cocoroで実際に発生)。
 * クエリが使う(summaryState, <orderBy>)の3組をここで固定する。
 */

import { expect } from 'chai';
import { readFileSync } from 'fs';
import { resolve } from 'path';

interface IndexDef {
  collectionGroup: string;
  queryScope: string;
  fields: Array<{ fieldPath: string; order: string }>;
}

const indexes: IndexDef[] = JSON.parse(readFileSync(resolve(process.cwd(), '../firestore.indexes.json'), 'utf-8')).indexes;

function hasIndex(second: string): boolean {
  return indexes.some(
    (i) =>
      i.collectionGroup === 'documents' &&
      i.queryScope === 'COLLECTION' &&
      i.fields.length === 2 &&
      i.fields[0].fieldPath === 'summaryState' &&
      i.fields[0].order === 'ASCENDING' &&
      i.fields[1].fieldPath === second &&
      i.fields[1].order === 'ASCENDING'
  );
}

describe('要約キューの複合インデックス契約', () => {
  it('手動依頼の優先クエリ(summaryState==pending orderBy summaryManualRequestedAt)用のインデックスがある', () => {
    expect(hasIndex('summaryManualRequestedAt')).to.equal(true);
  });

  it('自動生成クエリ(summaryState==pending orderBy updatedAt)用のインデックスがある', () => {
    expect(hasIndex('updatedAt')).to.equal(true);
  });

  it('stuck回収クエリ(summaryState==processing + summaryStateUpdatedAt範囲)用のインデックスがある', () => {
    expect(hasIndex('summaryStateUpdatedAt')).to.equal(true);
  });

  it('バッチのクエリが実際にこの3つのorderBy/範囲フィールドを使っている(定義とクエリの乖離防止)', () => {
    const batch = readFileSync(resolve(process.cwd(), 'src/ocr/generateSummaryBatch.ts'), 'utf-8');
    const store = readFileSync(resolve(process.cwd(), 'src/ocr/summaryRunStore.ts'), 'utf-8');
    expect(batch).to.contain(".orderBy('summaryManualRequestedAt', 'asc')");
    expect(batch).to.contain(".orderBy('updatedAt', 'asc')");
    expect(store).to.contain(".where('summaryStateUpdatedAt', '<', threshold)");
  });
});
