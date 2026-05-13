/**
 * splitSnapshot.ts (parseGcsUri / verifySnapshotConsistency / verifyFinalDrift /
 * backoffSleep / SourceDriftError) の単体テスト。
 *
 * ADR-0016 MUST 5 + Codex MCP review High 1 / H2 / Medium 1 / Medium 2 反映。
 */

import { expect } from 'chai';
import {
  SnapshotFile,
  SourceDriftError,
  acquireSourceSnapshot,
  backoffSleep,
  parseGcsUri,
  verifyFinalDrift,
  verifySnapshotConsistency,
} from '../src/pdf/splitSnapshot';

describe('parseGcsUri (Codex Medium 1: gs:// URI parser)', () => {
  it('"gs://bucket/object" を分解する', () => {
    const r = parseGcsUri('gs://my-bucket/folder/file.pdf');
    expect(r.bucket).to.equal('my-bucket');
    expect(r.objectName).to.equal('folder/file.pdf');
  });

  it('object name にスラッシュ複数あっても保持する', () => {
    const r = parseGcsUri('gs://b/a/b/c/d.pdf');
    expect(r.objectName).to.equal('a/b/c/d.pdf');
  });

  it('expectedBucket と一致すれば成功', () => {
    const r = parseGcsUri('gs://b/x.pdf', 'b');
    expect(r.bucket).to.equal('b');
  });

  it('expectedBucket 不一致で throw', () => {
    expect(() => parseGcsUri('gs://other/x.pdf', 'expected'))
      .to.throw(Error)
      .with.property('message')
      .match(/bucket mismatch/);
  });

  it('"gs://" prefix がないと throw', () => {
    expect(() => parseGcsUri('processed/abc/x.pdf')).to.throw(/Invalid GCS URI/);
  });

  it('https:// 等の別 scheme で throw', () => {
    expect(() => parseGcsUri('https://example.com/x.pdf')).to.throw(/Invalid GCS URI/);
  });

  it('空文字で throw', () => {
    expect(() => parseGcsUri('')).to.throw(/non-empty string/);
  });

  it('"gs://bucket" (object name なし) で throw', () => {
    expect(() => parseGcsUri('gs://b')).to.throw(/Invalid GCS URI/);
  });
});

describe('verifySnapshotConsistency (Codex High 1/H2: gen+metageneration 両方比較)', () => {
  it('generation + metageneration 両方一致で snapshot を返す', () => {
    const r = verifySnapshotConsistency(
      { generation: '100', metageneration: '1' },
      { generation: '100', metageneration: '1' }
    );
    expect(r.generation).to.equal('100');
    expect(r.metageneration).to.equal('1');
  });

  it('generation drift で SourceDriftError throw', () => {
    expect(() =>
      verifySnapshotConsistency(
        { generation: '100', metageneration: '1' },
        { generation: '101', metageneration: '1' }
      )
    )
      .to.throw(SourceDriftError)
      .with.property('message')
      .match(/generation 100 → 101/);
  });

  it('metageneration drift だけでも SourceDriftError throw (Codex H2)', () => {
    expect(() =>
      verifySnapshotConsistency(
        { generation: '100', metageneration: '1' },
        { generation: '100', metageneration: '2' }
      )
    )
      .to.throw(SourceDriftError)
      .with.property('message')
      .match(/metageneration 1 → 2/);
  });

  it('数値型でも文字列に正規化して比較する', () => {
    const r = verifySnapshotConsistency(
      { generation: 100, metageneration: 1 },
      { generation: '100', metageneration: '1' }
    );
    expect(r.generation).to.equal('100');
  });

  it('generation/metageneration が undefined で throw', () => {
    expect(() =>
      verifySnapshotConsistency({}, { generation: '100', metageneration: '1' })
    ).to.throw(/Missing generation/);
  });

  it('SourceDriftError は before/after を保持する', () => {
    try {
      verifySnapshotConsistency(
        { generation: '100', metageneration: '1' },
        { generation: '101', metageneration: '2' }
      );
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(SourceDriftError);
      const drift = err as SourceDriftError;
      expect(drift.before).to.deep.equal({ generation: '100', metageneration: '1' });
      expect(drift.after).to.deep.equal({ generation: '101', metageneration: '2' });
    }
  });
});

describe('verifyFinalDrift (segments ループ後の最終 drift check)', () => {
  it('一致時は何も throw しない', () => {
    expect(() =>
      verifyFinalDrift(
        { generation: '100', metageneration: '1' },
        { generation: '100', metageneration: '1' }
      )
    ).to.not.throw();
  });

  it('generation drift で SourceDriftError throw', () => {
    expect(() =>
      verifyFinalDrift(
        { generation: '100', metageneration: '1' },
        { generation: '101', metageneration: '1' }
      )
    ).to.throw(SourceDriftError);
  });

  it('metageneration drift で SourceDriftError throw (Codex H2)', () => {
    expect(() =>
      verifyFinalDrift(
        { generation: '100', metageneration: '1' },
        { generation: '100', metageneration: '2' }
      )
    ).to.throw(SourceDriftError);
  });

  it('final metadata に generation 欠落で generic Error', () => {
    expect(() =>
      verifyFinalDrift({ generation: '100', metageneration: '1' }, {})
    ).to.throw(/Missing generation/);
  });
});

describe('acquireSourceSnapshot (Codex M4: download 前後 metadata 変化を検出)', () => {
  function makeFile(
    metadataResponses: Array<{ generation: string; metageneration: string }>,
    downloadBuffer: Buffer
  ): SnapshotFile {
    let metaCallCount = 0;
    return {
      getMetadata: async () => {
        const r = metadataResponses[metaCallCount];
        metaCallCount++;
        if (!r) {
          throw new Error(
            `Unexpected getMetadata call ${metaCallCount}, only ${metadataResponses.length} responses queued`
          );
        }
        return [r];
      },
      download: async () => [downloadBuffer],
    };
  }

  it('metadata before/after が一致するとき snapshot を返す', async () => {
    const file = makeFile(
      [
        { generation: '100', metageneration: '1' },
        { generation: '100', metageneration: '1' },
      ],
      Buffer.from('pdf-bytes')
    );
    const snap = await acquireSourceSnapshot(file);
    expect(snap.generation).to.equal('100');
    expect(snap.metageneration).to.equal('1');
    expect(snap.buffer.toString()).to.equal('pdf-bytes');
  });

  it('download 中に generation が変化したら SourceDriftError throw', async () => {
    const file = makeFile(
      [
        { generation: '100', metageneration: '1' },
        { generation: '101', metageneration: '1' },
      ],
      Buffer.from('partial-or-old-bytes')
    );
    try {
      await acquireSourceSnapshot(file);
      expect.fail('should have thrown SourceDriftError');
    } catch (err) {
      expect(err).to.be.instanceOf(SourceDriftError);
      expect((err as SourceDriftError).before.generation).to.equal('100');
      expect((err as SourceDriftError).after.generation).to.equal('101');
    }
  });

  it('download 中に metageneration だけ変化しても SourceDriftError throw (Codex H2)', async () => {
    const file = makeFile(
      [
        { generation: '100', metageneration: '1' },
        { generation: '100', metageneration: '2' },
      ],
      Buffer.from('bytes')
    );
    try {
      await acquireSourceSnapshot(file);
      expect.fail('should have thrown SourceDriftError');
    } catch (err) {
      expect(err).to.be.instanceOf(SourceDriftError);
    }
  });

  it('getMetadata を厳密に 2 回 + download を 1 回呼ぶ', async () => {
    let metaCount = 0;
    let downloadCount = 0;
    const file: SnapshotFile = {
      getMetadata: async () => {
        metaCount++;
        return [{ generation: '100', metageneration: '1' }];
      },
      download: async () => {
        downloadCount++;
        return [Buffer.from('x')];
      },
    };
    await acquireSourceSnapshot(file);
    expect(metaCount).to.equal(2);
    expect(downloadCount).to.equal(1);
  });
});

describe('backoffSleep (Codex Medium 2: jitter 付き backoff)', () => {
  it('attempt=0 は 100-150ms 範囲で sleep する', async () => {
    const start = Date.now();
    await backoffSleep(0);
    const elapsed = Date.now() - start;
    expect(elapsed).to.be.at.least(95); // setTimeout 精度の許容範囲
    expect(elapsed).to.be.at.most(200);
  });

  it('attempt=1 は 300-450ms 範囲で sleep する', async () => {
    const start = Date.now();
    await backoffSleep(1);
    const elapsed = Date.now() - start;
    expect(elapsed).to.be.at.least(295);
    expect(elapsed).to.be.at.most(500);
  });
});
