/**
 * Issue #811 Phase B: folder merge plan v1 schema + provenance pure function の単体テスト。
 * `functions/test/collisionPlanTypesV3.test.ts`(Issue #432、実装済み)と同じ構成方針。
 *
 * 対象は scripts/lib/ の以下 pure function:
 *  - folderMergePlanTypes: verifyActionProvenanceInvariant / verifyFolderProvenanceCompleteness /
 *    verifyFolderProvenanceMatch / computeFirestoreSnapshotHash
 *  - driveApiVersionGate: verifyDriveApiVersionMatch (I/O を伴う readDriveApiVersionSnapshot は
 *    dev リハーサル integration test で)
 */

import { expect } from 'chai';
import {
  FOLDER_MERGE_PLAN_SCHEMA_VERSION,
  PROVENANCE_REQUIRED_BY_ACTION,
  computeFirestoreSnapshotHash,
  verifyActionProvenanceInvariant,
  verifyFolderProvenanceCompleteness,
  verifyFolderProvenanceMatch,
  type FolderFileProvenance,
  type RecommendedAction,
} from '../../scripts/lib/folderMergePlanTypes';
import { verifyDriveApiVersionMatch } from '../../scripts/lib/driveApiVersionGate';

describe('folder merge plan v1 schema constants', () => {
  it('FOLDER_MERGE_PLAN_SCHEMA_VERSION is the literal folder-merge-plan-v1', () => {
    expect(FOLDER_MERGE_PLAN_SCHEMA_VERSION).to.equal('folder-merge-plan-v1');
  });

  it('PROVENANCE_REQUIRED_BY_ACTION maps both actions to booleans', () => {
    expect(PROVENANCE_REQUIRED_BY_ACTION['move-to-canonical']).to.equal(true);
    expect(PROVENANCE_REQUIRED_BY_ACTION['manual-review']).to.equal(false);
  });
});

describe('verifyActionProvenanceInvariant (AC-INVARIANT)', () => {
  const validPairs: [RecommendedAction, boolean][] = [
    ['move-to-canonical', true],
    ['manual-review', false],
  ];
  for (const [action, provenanceRequired] of validPairs) {
    it(`accepts action=${action} provenanceRequired=${provenanceRequired}`, () => {
      const result = verifyActionProvenanceInvariant(action, provenanceRequired);
      expect(result.ok).to.equal(true);
    });
  }

  const invalidPairs: [RecommendedAction, boolean][] = [
    ['move-to-canonical', false], // bypass attempt: destructive action without provenance
    ['manual-review', true],
  ];
  for (const [action, provenanceRequired] of invalidPairs) {
    it(`rejects action=${action} provenanceRequired=${provenanceRequired}`, () => {
      const result = verifyActionProvenanceInvariant(action, provenanceRequired);
      expect(result.ok).to.equal(false);
    });
  }
});

describe('verifyFolderProvenanceCompleteness', () => {
  it('rejects null provenance', () => {
    const result = verifyFolderProvenanceCompleteness(null);
    expect(result.ok).to.equal(false);
  });

  it('rejects missing fileId', () => {
    const result = verifyFolderProvenanceCompleteness({
      fileId: '',
      version: '1',
      md5Checksum: null,
      headRevisionId: null,
    });
    expect(result.ok).to.equal(false);
  });

  it('rejects missing version', () => {
    const result = verifyFolderProvenanceCompleteness({
      fileId: 'f1',
      version: '',
      md5Checksum: null,
      headRevisionId: null,
    });
    expect(result.ok).to.equal(false);
  });

  it('accepts complete provenance with null md5Checksum/headRevisionId (Google-native format)', () => {
    const result = verifyFolderProvenanceCompleteness({
      fileId: 'f1',
      version: '1',
      md5Checksum: null,
      headRevisionId: null,
    });
    expect(result.ok).to.equal(true);
  });
});

describe('verifyFolderProvenanceMatch', () => {
  const base: FolderFileProvenance = {
    fileId: 'f1',
    version: '10',
    md5Checksum: 'abc123',
    headRevisionId: 'rev1',
  };

  it('accepts identical provenance', () => {
    const result = verifyFolderProvenanceMatch(base, { ...base });
    expect(result.ok).to.equal(true);
  });

  it('rejects fileId mismatch', () => {
    const result = verifyFolderProvenanceMatch(base, { ...base, fileId: 'other' });
    expect(result.ok).to.equal(false);
  });

  it('rejects version mismatch (file changed since classify)', () => {
    const result = verifyFolderProvenanceMatch(base, { ...base, version: '11' });
    expect(result.ok).to.equal(false);
  });

  it('rejects md5Checksum mismatch (content changed since classify)', () => {
    const result = verifyFolderProvenanceMatch(base, { ...base, md5Checksum: 'def456' });
    expect(result.ok).to.equal(false);
  });
});

describe('computeFirestoreSnapshotHash', () => {
  const fields = {
    careManager: '森 奈穂美',
    customerName: 'テスト利用者',
    documentCategory: '請求書',
    documentType: '請求書',
    fileDateIso: '2026-07-01T00:00:00.000Z',
  };

  it('is deterministic for identical input', () => {
    expect(computeFirestoreSnapshotHash(fields)).to.equal(computeFirestoreSnapshotHash({ ...fields }));
  });

  it('changes when careManager changes (reassignment detection)', () => {
    const changed = computeFirestoreSnapshotHash({ ...fields, careManager: '別 担当者' });
    expect(changed).to.not.equal(computeFirestoreSnapshotHash(fields));
  });

  it('changes when fileDateIso changes to null', () => {
    const changed = computeFirestoreSnapshotHash({ ...fields, fileDateIso: null });
    expect(changed).to.not.equal(computeFirestoreSnapshotHash(fields));
  });
});

describe('verifyDriveApiVersionMatch (AC-CC1相当)', () => {
  const snapshot = { lockfileHash: 'hash-a', googleapisLockfileVersion: '144.0.0' };

  it('accepts identical snapshot', () => {
    const result = verifyDriveApiVersionMatch(snapshot, { ...snapshot });
    expect(result.ok).to.equal(true);
  });

  it('rejects lockfileHash mismatch', () => {
    const result = verifyDriveApiVersionMatch(snapshot, { ...snapshot, lockfileHash: 'hash-b' });
    expect(result.ok).to.equal(false);
  });

  it('rejects googleapisLockfileVersion mismatch', () => {
    const result = verifyDriveApiVersionMatch(snapshot, { ...snapshot, googleapisLockfileVersion: '145.0.0' });
    expect(result.ok).to.equal(false);
  });
});
