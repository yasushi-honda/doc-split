/**
 * genesis provenance 適格判定 (ADR-0016 MUST 8) の table-driven unit test。
 *
 * `isGenesisEligible()` の 3 条件 (provenance 不在 / parentDocumentId 不在 / fileUrl が
 * `original/` 直下) を網羅する。
 */

import { expect } from 'chai';
import { isGenesisEligible } from '../src/pdf/genesisEligibility';

const BUCKET = 'docsplit-kanameone.firebasestorage.app';

describe('isGenesisEligible (genesis provenance 適格判定)', () => {
  it('provenance不在 + parentDocumentId不在 + original/直下 → true (適格)', () => {
    expect(
      isGenesisEligible({
        hasProvenance: false,
        hasParentDocumentId: false,
        fileUrl: `gs://${BUCKET}/original/1785120783129_test.pdf`,
        bucketName: BUCKET,
      })
    ).to.be.true;
  });

  it('provenance有り → false (通常フローを使う、genesis不要)', () => {
    expect(
      isGenesisEligible({
        hasProvenance: true,
        hasParentDocumentId: false,
        fileUrl: `gs://${BUCKET}/original/1785120783129_test.pdf`,
        bucketName: BUCKET,
      })
    ).to.be.false;
  });

  it('parentDocumentId有り → false (分割由来、PR-D4の領分)', () => {
    expect(
      isGenesisEligible({
        hasProvenance: false,
        hasParentDocumentId: true,
        fileUrl: `gs://${BUCKET}/original/1785120783129_test.pdf`,
        bucketName: BUCKET,
      })
    ).to.be.false;
  });

  it('fileUrlがprocessed/配下 → false (legacy分割doc、Issue #432被害候補、対象外)', () => {
    expect(
      isGenesisEligible({
        hasProvenance: false,
        hasParentDocumentId: false,
        fileUrl: `gs://${BUCKET}/processed/legacy-filename.pdf`,
        bucketName: BUCKET,
      })
    ).to.be.false;
  });

  it('fileUrlがoriginal/でもprocessed/でもないprefix → false (未知のprefixはfail-closed)', () => {
    expect(
      isGenesisEligible({
        hasProvenance: false,
        hasParentDocumentId: false,
        fileUrl: `gs://${BUCKET}/other/some-file.pdf`,
        bucketName: BUCKET,
      })
    ).to.be.false;
  });

  it('fileUrlが不正なGCS URI → false (fail-closed、通常フローに委ねる)', () => {
    expect(
      isGenesisEligible({
        hasProvenance: false,
        hasParentDocumentId: false,
        fileUrl: 'not-a-gcs-uri',
        bucketName: BUCKET,
      })
    ).to.be.false;
  });

  it('fileUrlのbucketが期待値と不一致 → false (fail-closed)', () => {
    expect(
      isGenesisEligible({
        hasProvenance: false,
        hasParentDocumentId: false,
        fileUrl: `gs://other-bucket.firebasestorage.app/original/test.pdf`,
        bucketName: BUCKET,
      })
    ).to.be.false;
  });

  it('全条件を満たさない (provenance有り + parentDocumentId有り + processed/) → false', () => {
    expect(
      isGenesisEligible({
        hasProvenance: true,
        hasParentDocumentId: true,
        fileUrl: `gs://${BUCKET}/processed/childId/file.pdf`,
        bucketName: BUCKET,
      })
    ).to.be.false;
  });
});
