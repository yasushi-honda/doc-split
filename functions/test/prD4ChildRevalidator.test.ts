/**
 * Issue #445 PR-D4 S1-3: phase-b/childRevalidator.ts (child object 現在 sha256 計算 + metadata 取得).
 *
 * 担当:
 *   - child Storage object 存在確認 (HEAD)
 *   - object content download
 *   - raw bytes sha256 計算 (= provenance.derivedSha256)
 *
 * DI 化 (BucketProber + downloadBytes wrapper) で実 Storage アクセス不要。
 */

import { expect } from 'chai';
import * as crypto from 'crypto';
import {
  revalidateChildObject,
  type ChildObjectDownloader,
} from '../../scripts/pr-d4-backfill/phase-b/childRevalidator';

class FakeDownloader implements ChildObjectDownloader {
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
    const b = this.bytesByPath[path];
    if (b === undefined) return null;
    if (b === null) return null;
    return { bytes: b, generation: '12345', metageneration: '1' };
  }
}

function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

describe('revalidateChildObject (PR-D4 S1-3 child sha256 計算)', () => {
  it('child 存在 → bytes / sha256 / generation / metageneration を返す', async () => {
    const bytes = Buffer.from('hello PR-D4 phase B child content');
    const downloader = new FakeDownloader({ 'processed/doc-1/output.pdf': bytes });
    const result = await revalidateChildObject({
      childObjectPath: 'processed/doc-1/output.pdf',
      downloader,
    });
    expect(result.exists).to.equal(true);
    if (result.exists) {
      expect(result.derivedSha256).to.equal(sha256Hex(bytes));
      expect(result.derivedGeneration).to.equal('12345');
      expect(result.derivedMetageneration).to.equal('1');
    }
  });

  it('child 不在 (HEAD null) → exists=false', async () => {
    const downloader = new FakeDownloader({});
    const result = await revalidateChildObject({
      childObjectPath: 'processed/doc-1/output.pdf',
      downloader,
    });
    expect(result.exists).to.equal(false);
  });

  it('childObjectPath null → exists=false (download 呼ばれない)', async () => {
    const downloader = new FakeDownloader({});
    const result = await revalidateChildObject({
      childObjectPath: null,
      downloader,
    });
    expect(result.exists).to.equal(false);
    expect(downloader.downloadCalls).to.have.length(0);
  });

  it('sha256 は lowercase hex (provenance.derivedSha256 と整合)', async () => {
    const bytes = Buffer.from('abc');
    const downloader = new FakeDownloader({ 'p/a.pdf': bytes });
    const result = await revalidateChildObject({
      childObjectPath: 'p/a.pdf',
      downloader,
    });
    expect(result.exists).to.equal(true);
    if (result.exists) {
      expect(result.derivedSha256).to.match(/^[a-f0-9]{64}$/);
      expect(result.derivedSha256).to.equal(sha256Hex(bytes));
    }
  });

  it('空 buffer (0 byte file) でも sha256 計算する (e3b0c44... empty hash)', async () => {
    const downloader = new FakeDownloader({ 'p/empty.pdf': Buffer.alloc(0) });
    const result = await revalidateChildObject({
      childObjectPath: 'p/empty.pdf',
      downloader,
    });
    expect(result.exists).to.equal(true);
    if (result.exists) {
      expect(result.derivedSha256).to.equal(
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      );
    }
  });
});
