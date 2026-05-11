/**
 * Storage path 抽出ロジックの contract test (Issue #432 PR-D, AC-B3 protect)
 *
 * PR-B (docId namespace) 完了後、Storage path は `processed/{fileName}` (旧) と
 * `processed/{docId}/{fileName}` (新) の両形式が混在する。3 call sites の path
 * 抽出ロジックが「gs://{bucket}/ 以降を任意 prefix で抽出する」設計を維持する限り、
 * 新旧両形式で動作する (replace() / regex match 形式は両対応)。
 *
 * 単一セグメント抽出 (path.basename / split('/').pop()) に refactor されると
 * 新形式 path で fileName のみが取れて bucket/path 構造が破綻し silent 破壊が
 * 再発するため、grep contract で固定する。
 *
 * 対象 call sites:
 *   - functions/src/ocr/ocrProcessor.ts (~line 111): fileUrl.replace() 形式
 *   - functions/src/documents/deleteDocument.ts (~line 80): regex match 形式
 *   - functions/src/pdf/pdfOperations.ts (rotatePdfPages, ~line 493): fileUrl.replace() 形式
 */

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
// Mocha esm-utils CJS loader 推論用 (splitPdfDocIdNamespace.test.ts と同じ workaround)
import '../src/storage/storageDeletionGuard';

interface PathExtractionTarget {
  label: string;
  filePath: string;
  /** path 抽出が「prefix 任意 / 末尾任意」設計であることの positive 確認パターン */
  expectedPattern: RegExp;
}

const targets: PathExtractionTarget[] = [
  {
    label: 'ocrProcessor.ts',
    filePath: 'src/ocr/ocrProcessor.ts',
    expectedPattern: /fileUrl\.replace\(`gs:\/\/\$\{bucket\.name\}\//,
  },
  {
    label: 'deleteDocument.ts',
    filePath: 'src/documents/deleteDocument.ts',
    expectedPattern: /match\(\/\^gs:\\\/\\\/\(\[\^\/\]\+\)\\\/\(\.\+\)\$\//,
  },
  {
    label: 'pdfOperations.ts (rotatePdfPages)',
    filePath: 'src/pdf/pdfOperations.ts',
    // rotatePdfPages 内の filePath = fileUrl.replace(...) パターン
    expectedPattern: /filePath = fileUrl\.replace\(`gs:\/\/\$\{bucket\.name\}\//,
  },
];

describe('Storage path extraction contract (Issue #432 PR-D, AC-B3 protect)', () => {
  for (const target of targets) {
    describe(target.label, () => {
      const fullPath = path.resolve(process.cwd(), target.filePath);
      const content = fs.readFileSync(fullPath, 'utf-8');

      it('path 抽出は prefix 任意の replace/regex 形式を維持 (新旧両 path 対応)', () => {
        expect(content).to.match(target.expectedPattern);
      });

      it('単一セグメント抽出 path.basename(filePath) を使わない (新形式 path で破綻)', () => {
        // path モジュールの import + basename(filePath) 呼出パターンを禁止
        expect(content).not.to.match(/path\.basename\(\s*filePath\s*\)/);
        expect(content).not.to.match(/basename\(\s*fileUrl\s*\)/);
      });

      it("split('/').pop() を path 末尾抽出に使わない (docId namespace 構造破壊)", () => {
        // fileUrl/filePath を起点とした単純な末尾抽出を禁止
        expect(content).not.to.match(/fileUrl\.split\(['"]\/['"]\)\.pop\(\)/);
        expect(content).not.to.match(/filePath\.split\(['"]\/['"]\)\.pop\(\)/);
      });
    });
  }
});
