/**
 * Issue #445 PR-D4 S1-3: parentReSplitVerifier.ts (parent 再 download + 再 split + child sha256 一致確認).
 *
 * MatchedByHash 候補に対する Phase B 主要処理:
 *   1. parent PDF download
 *   2. parent bytes の sha256 計算 (= provenance.sourceSha256 canonical 値)
 *   3. splitFromPages で page selection 再 split (scripts/lib/pdfRegenerator.ts 流用)
 *   4. 再 split 結果の sha256 と現 child sha256 を比較
 *
 * 結果: parentSha256MatchedAtBackfill = true (一致) / false (不一致 = 別 bytes、本番 Phase C 書込対象外)
 *
 * 注意: pdf-lib の cross-process non-determinism は本 module では発生しない (parent + child
 * を **同一プロセス内** で取得して比較するため)。ただし「現在 parent bytes」が「split 時点の
 * parent bytes」と異なれば当然 mismatch となる (rotate 等で parent 自体が変化したケース)。
 */

import { expect } from 'chai';
import * as crypto from 'crypto';
import {
  verifyParentReSplit,
  type ParentObjectDownloader,
} from '../../scripts/pr-d4-backfill/phase-b/parentReSplitVerifier';
import { PDFDocument } from 'pdf-lib';

class FakeParentDownloader implements ParentObjectDownloader {
  private bytesByPath: Record<string, Buffer | null>;
  public downloadCalls: string[] = [];
  constructor(bytesByPath: Record<string, Buffer | null>) {
    this.bytesByPath = bytesByPath;
  }
  async download(path: string): Promise<{
    bytes: Buffer;
    generation: string;
    metageneration: string;
  } | null> {
    this.downloadCalls.push(path);
    if (!(path in this.bytesByPath)) return null;
    const b = this.bytesByPath[path];
    if (b === null) return null;
    return { bytes: b, generation: 'pgen', metageneration: 'pmgen' };
  }
  async getMetadataOnly(path: string) {
    if (!(path in this.bytesByPath)) return null;
    const b = this.bytesByPath[path];
    if (b === null) return null;
    return { generation: 'pgen', metageneration: 'pmgen' };
  }
}

function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function makePdfBuffer(pageCount: number): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    pdf.addPage([100, 100]);
  }
  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

describe('verifyParentReSplit (PR-D4 S1-3 parent 再 split 検証)', () => {
  it('parent 不在 → exists=false (download 呼ばない)', async () => {
    const downloader = new FakeParentDownloader({});
    const result = await verifyParentReSplit({
      parentObjectPath: null,
      splitFromPages: { start: 1, end: 1 },
      childBytes: Buffer.from('child'),
      downloader,
    });
    expect(result.parentExists).to.equal(false);
    expect(downloader.downloadCalls).to.have.length(0);
  });

  it('parent path あり + GCS 404 → exists=false', async () => {
    const downloader = new FakeParentDownloader({ 'attachments/parent-1/source.pdf': null });
    const result = await verifyParentReSplit({
      parentObjectPath: 'attachments/parent-1/source.pdf',
      splitFromPages: { start: 1, end: 1 },
      childBytes: Buffer.from('child'),
      downloader,
    });
    expect(result.parentExists).to.equal(false);
  });

  it('parent download 成功 + 再 split で child sha256 一致 → parentSha256MatchedAtBackfill=true', async () => {
    const parentBytes = await makePdfBuffer(3);
    // 期待 child = parent から page 2 のみ抽出して再 split したもの
    const parentPdf = await PDFDocument.load(parentBytes);
    const childPdf = await PDFDocument.create();
    const [copiedPage] = await childPdf.copyPages(parentPdf, [1]);
    childPdf.addPage(copiedPage);
    const expectedChildBytes = Buffer.from(await childPdf.save());

    const downloader = new FakeParentDownloader({
      'attachments/parent-1/source.pdf': parentBytes,
    });
    const result = await verifyParentReSplit({
      parentObjectPath: 'attachments/parent-1/source.pdf',
      splitFromPages: { start: 2, end: 2 },
      childBytes: expectedChildBytes,
      downloader,
    });
    expect(result.parentExists).to.equal(true);
    if (result.parentExists) {
      expect(result.parentSha256MatchedAtBackfill).to.equal(true);
      expect(result.sourceSha256).to.equal(sha256Hex(parentBytes));
      expect(result.sourceGeneration).to.equal('pgen');
      expect(result.sourceMetageneration).to.equal('pmgen');
    }
  });

  it('parent download 成功だが child bytes が再 split と不一致 → parentSha256MatchedAtBackfill=false', async () => {
    const parentBytes = await makePdfBuffer(3);
    const downloader = new FakeParentDownloader({
      'attachments/parent-1/source.pdf': parentBytes,
    });
    const result = await verifyParentReSplit({
      parentObjectPath: 'attachments/parent-1/source.pdf',
      splitFromPages: { start: 1, end: 1 },
      childBytes: Buffer.from('不一致 child bytes'),
      downloader,
    });
    expect(result.parentExists).to.equal(true);
    if (result.parentExists) {
      expect(result.parentSha256MatchedAtBackfill).to.equal(false);
      // sourceSha256 + sourceGeneration は parent 実体から取得済 (Phase C で記録される)
      expect(result.sourceSha256).to.equal(sha256Hex(parentBytes));
    }
  });

  it('splitFromPages.endPage が parent 総ページ数を超える → 再 split 不能 → parentExists=true, matched=false', async () => {
    const parentBytes = await makePdfBuffer(3);
    const downloader = new FakeParentDownloader({
      'attachments/parent-1/source.pdf': parentBytes,
    });
    const result = await verifyParentReSplit({
      parentObjectPath: 'attachments/parent-1/source.pdf',
      splitFromPages: { start: 1, end: 99 }, // out of bounds
      childBytes: Buffer.from('whatever'),
      downloader,
    });
    expect(result.parentExists).to.equal(true);
    if (result.parentExists) {
      // out-of-bounds は再 split 失敗 → matched=false で記録
      expect(result.parentSha256MatchedAtBackfill).to.equal(false);
    }
  });

  it('parent PDF parse 失敗 (壊れた bytes) → parentExists=true, matched=false', async () => {
    const downloader = new FakeParentDownloader({
      'attachments/parent-1/source.pdf': Buffer.from('not a pdf'),
    });
    const result = await verifyParentReSplit({
      parentObjectPath: 'attachments/parent-1/source.pdf',
      splitFromPages: { start: 1, end: 1 },
      childBytes: Buffer.from('whatever'),
      downloader,
    });
    expect(result.parentExists).to.equal(true);
    if (result.parentExists) {
      expect(result.parentSha256MatchedAtBackfill).to.equal(false);
    }
  });

  it('splitFromPages null → exists=true で matched=false (再 split 不能)', async () => {
    const parentBytes = await makePdfBuffer(3);
    const downloader = new FakeParentDownloader({
      'attachments/parent-1/source.pdf': parentBytes,
    });
    const result = await verifyParentReSplit({
      parentObjectPath: 'attachments/parent-1/source.pdf',
      splitFromPages: null,
      childBytes: Buffer.from('whatever'),
      downloader,
    });
    expect(result.parentExists).to.equal(true);
    if (result.parentExists) {
      expect(result.parentSha256MatchedAtBackfill).to.equal(false);
    }
  });
});
