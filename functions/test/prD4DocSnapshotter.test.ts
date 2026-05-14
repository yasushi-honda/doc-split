/**
 * Issue #445 PR-D4 S1-2: doc-snapshotter.ts pure-ish (DI 化) テスト.
 *
 * Firestore doc + parent doc + Storage HEAD を組み合わせて PhaseADocSnapshot +
 * PhaseACandidate metadata を構築する。実 Firestore/Storage 接続は DI 化し、
 * unit test は in-memory mock で実行する。
 */

import { expect } from 'chai';
import {
  snapshotDocForPhaseA,
  type SnapshotDocInput,
  type ParentFetcher,
  type BucketProber,
} from '../../scripts/pr-d4-backfill/phase-a/docSnapshotter';

class FakeParentFetcher implements ParentFetcher {
  private parents: Record<string, { fileUrl: string | null } | null>;
  constructor(parents: Record<string, { fileUrl: string | null } | null>) {
    this.parents = parents;
  }
  async fetchParent(parentDocId: string) {
    return parentDocId in this.parents ? this.parents[parentDocId] : null;
  }
}

class FakeBucketProber implements BucketProber {
  private metadataByPath: Record<
    string,
    { generation: string; metageneration: string } | null
  >;
  constructor(
    metadataByPath: Record<
      string,
      { generation: string; metageneration: string } | null
    >
  ) {
    this.metadataByPath = metadataByPath;
  }
  async getMetadata(path: string) {
    return path in this.metadataByPath ? this.metadataByPath[path] : null;
  }
}

function buildInput(overrides: Partial<SnapshotDocInput> = {}): SnapshotDocInput {
  return {
    doc: {
      id: 'doc-1',
      fileUrl: 'gs://docsplit-dev.firebasestorage.app/processed/doc-1/output.pdf',
      parentDocumentId: 'parent-1',
      splitFromPages: { start: 1, end: 1 },
      updateTimeIso: '2026-05-14T10:00:00.000Z',
    },
    bucketName: 'docsplit-dev.firebasestorage.app',
    parentFetcher: new FakeParentFetcher({
      'parent-1': {
        fileUrl: 'gs://docsplit-dev.firebasestorage.app/attachments/parent-1/source.pdf',
      },
    }),
    bucketProber: new FakeBucketProber({
      'processed/doc-1/output.pdf': { generation: '1234567890', metageneration: '1' },
      'attachments/parent-1/source.pdf': { generation: '9876543210', metageneration: '1' },
    }),
    ...overrides,
  };
}

describe('snapshotDocForPhaseA (PR-D4 S1-2 doc-snapshotter)', () => {
  it('全フィールド揃った正常 doc (child + parent + 元 PDF 存在) で snapshot + candidate を返す', async () => {
    const { snapshot, candidate } = await snapshotDocForPhaseA(buildInput());
    expect(snapshot.docId).to.equal('doc-1');
    expect(snapshot.parentDocumentId).to.equal('parent-1');
    expect(snapshot.splitFromPages).to.deep.equal({ start: 1, end: 1 });
    expect(snapshot.childObjectExists).to.equal(true);
    expect(snapshot.parent).to.deep.equal({ exists: true, originalPdfExists: true });

    expect(candidate.docId).to.equal('doc-1');
    expect(candidate.firestoreUpdateTime).to.equal('2026-05-14T10:00:00.000Z');
    expect(candidate.childObjectPath).to.equal('processed/doc-1/output.pdf');
    expect(candidate.childGeneration).to.equal('1234567890');
    expect(candidate.childMetageneration).to.equal('1');
    expect(candidate.parentDocId).to.equal('parent-1');
    expect(candidate.parentObjectPath).to.equal('attachments/parent-1/source.pdf');
    expect(candidate.parentGeneration).to.equal('9876543210');
    expect(candidate.parentMetageneration).to.equal('1');
    expect(candidate.splitFromPages).to.deep.equal({ start: 1, end: 1 });
  });

  it('child object Storage 不在 (HEAD null) → childObjectExists=false, generation/metageneration=null', async () => {
    const { snapshot, candidate } = await snapshotDocForPhaseA(
      buildInput({
        bucketProber: new FakeBucketProber({
          'attachments/parent-1/source.pdf': { generation: '9876543210', metageneration: '1' },
          // child は登録なし → null 返却
        }),
      })
    );
    expect(snapshot.childObjectExists).to.equal(false);
    expect(candidate.childGeneration).to.equal(null);
    expect(candidate.childMetageneration).to.equal(null);
    // childObjectPath は doc.fileUrl 由来で記録される (Storage 不在でも path は分かる)
    expect(candidate.childObjectPath).to.equal('processed/doc-1/output.pdf');
  });

  it('parent doc 不在 (Firestore に無い) → parent={exists:false} + parent path/generation/metageneration=null', async () => {
    const { snapshot, candidate } = await snapshotDocForPhaseA(
      buildInput({
        parentFetcher: new FakeParentFetcher({}),
      })
    );
    expect(snapshot.parent).to.deep.equal({ exists: false });
    expect(candidate.parentObjectPath).to.equal(null);
    expect(candidate.parentGeneration).to.equal(null);
    expect(candidate.parentMetageneration).to.equal(null);
    expect(candidate.parentDocId).to.equal('parent-1');
  });

  it('parent doc 存在だが fileUrl null → parent.originalPdfExists=false', async () => {
    const { snapshot, candidate } = await snapshotDocForPhaseA(
      buildInput({
        parentFetcher: new FakeParentFetcher({ 'parent-1': { fileUrl: null } }),
      })
    );
    expect(snapshot.parent).to.deep.equal({ exists: true, originalPdfExists: false });
    expect(candidate.parentObjectPath).to.equal(null);
    expect(candidate.parentGeneration).to.equal(null);
  });

  it('parent doc 存在 + fileUrl あるが Storage HEAD 不在 → parent.originalPdfExists=false', async () => {
    const { snapshot, candidate } = await snapshotDocForPhaseA(
      buildInput({
        bucketProber: new FakeBucketProber({
          'processed/doc-1/output.pdf': { generation: '1234567890', metageneration: '1' },
          // parent path は登録なし
        }),
      })
    );
    expect(snapshot.parent).to.deep.equal({ exists: true, originalPdfExists: false });
    expect(candidate.parentObjectPath).to.equal('attachments/parent-1/source.pdf');
    expect(candidate.parentGeneration).to.equal(null);
    expect(candidate.parentMetageneration).to.equal(null);
  });

  it('parentDocumentId null → parentFetcher 呼ばずに parent=null, parent path/generation/metageneration 全 null', async () => {
    let fetchCalls = 0;
    class CountingFetcher implements ParentFetcher {
      async fetchParent(_id: string) {
        fetchCalls++;
        return null;
      }
    }
    const { snapshot, candidate } = await snapshotDocForPhaseA(
      buildInput({
        doc: {
          id: 'doc-noparent',
          fileUrl: 'gs://docsplit-dev.firebasestorage.app/processed/doc-noparent/output.pdf',
          parentDocumentId: null,
          splitFromPages: null,
          updateTimeIso: '2026-05-14T10:00:00.000Z',
        },
        parentFetcher: new CountingFetcher(),
      })
    );
    expect(fetchCalls).to.equal(0);
    expect(snapshot.parent).to.equal(null);
    expect(snapshot.parentDocumentId).to.equal(null);
    expect(snapshot.splitFromPages).to.equal(null);
    expect(candidate.parentDocId).to.equal(null);
    expect(candidate.parentObjectPath).to.equal(null);
    expect(candidate.parentGeneration).to.equal(null);
    expect(candidate.parentMetageneration).to.equal(null);
    expect(candidate.splitFromPages).to.equal(null);
  });

  it('doc.fileUrl が bucket 不一致 → childObjectPath=null + Storage HEAD スキップ (F-B4 反映)', async () => {
    let probeCalls = 0;
    class CountingProber implements BucketProber {
      async getMetadata(_path: string) {
        probeCalls++;
        return null;
      }
    }
    const { snapshot, candidate } = await snapshotDocForPhaseA(
      buildInput({
        doc: {
          id: 'doc-1',
          fileUrl: 'gs://other-bucket/processed/doc-1/output.pdf', // 別 bucket
          parentDocumentId: null,
          splitFromPages: null,
          updateTimeIso: '2026-05-14T10:00:00.000Z',
        },
        bucketProber: new CountingProber(),
      })
    );
    expect(probeCalls).to.equal(0);
    expect(snapshot.childObjectExists).to.equal(false);
    expect(candidate.childObjectPath).to.equal(null);
    expect(candidate.childGeneration).to.equal(null);
  });

  it('doc.fileUrl が null → childObjectPath=null, childObjectExists=false', async () => {
    const { snapshot, candidate } = await snapshotDocForPhaseA(
      buildInput({
        doc: {
          id: 'doc-1',
          fileUrl: null,
          parentDocumentId: null,
          splitFromPages: null,
          updateTimeIso: '2026-05-14T10:00:00.000Z',
        },
      })
    );
    expect(snapshot.childObjectExists).to.equal(false);
    expect(candidate.childObjectPath).to.equal(null);
  });

  it('parent.fileUrl が bucket 不一致 → parent.originalPdfExists=false + Storage HEAD スキップ', async () => {
    const { snapshot, candidate } = await snapshotDocForPhaseA(
      buildInput({
        parentFetcher: new FakeParentFetcher({
          'parent-1': { fileUrl: 'gs://other-bucket/attachments/parent-1/source.pdf' },
        }),
      })
    );
    expect(snapshot.parent).to.deep.equal({ exists: true, originalPdfExists: false });
    expect(candidate.parentObjectPath).to.equal(null);
    expect(candidate.parentGeneration).to.equal(null);
  });
});
