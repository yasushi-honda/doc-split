/**
 * Issue #445 PR-D4 S1-5: rotateGateFixtureTester unit test (Codex 8th Important 2).
 *
 * - dev hard gate (env !== 'dev' で throw)
 * - fixture docId 形式 (`BF13_test_fixture_${runId}_${kind}_${uuid}`)
 * - cleanup hook が try / finally で必ず実行 (rotate API 成否に関わらず)
 * - cleanup 失敗を `fixtureCleanupFailures[]` に記録
 * - prefix 違反 docId を cleanup hook が refuse (defense in depth)
 */

import { expect } from 'chai';
import {
  buildFixtureDocId,
  isFixtureDocId,
  runRotateGateFixtureTest,
  type FixtureStore,
  type RotateApiCaller,
} from '../../scripts/pr-d4-backfill/phase-d/rotateGateFixtureTester';

describe('rotateGateFixtureTester (Codex 8th Important 2 反映)', () => {
  describe('buildFixtureDocId / isFixtureDocId', () => {
    it('prefix + runId + kind + uuid を含む', () => {
      const docId = buildFixtureDocId('run-123', 'verified');
      expect(docId).to.match(/^BF13_test_fixture_run-123_verified_/);
      expect(isFixtureDocId(docId)).to.be.true;
    });

    it('uuid 部分で 2 回の呼出が衝突しない', () => {
      const a = buildFixtureDocId('run-1', 'child_snapshot_only');
      const b = buildFixtureDocId('run-1', 'child_snapshot_only');
      expect(a).to.not.equal(b);
    });

    it('prefix 違反 docId は isFixtureDocId=false', () => {
      expect(isFixtureDocId('production-doc-id')).to.be.false;
      expect(isFixtureDocId('something-else-BF13_test_fixture')).to.be.false;
    });
  });

  describe('dev hard gate', () => {
    it('env !== "dev" で throw', async () => {
      const fakeStore: FixtureStore = {
        async createFixture() {
          return { objectPath: 'x', objectGeneration: '1' };
        },
        async cleanupFixture() {},
      };
      const fakeRotate: RotateApiCaller = {
        async callRotate() {
          return { kind: 'rejected', rejectionMessage: 'never' };
        },
      };
      try {
        await runRotateGateFixtureTest({
          env: 'cocoro',
          runId: 'r1',
          pdfBytesVerified: Buffer.from('a'),
          pdfBytesChildSnapshotOnly: Buffer.from('b'),
          fixtureStore: fakeStore,
          rotateApiCaller: fakeRotate,
        });
        expect.fail('should throw');
      } catch (err) {
        expect((err as Error).message).to.match(/dev-only/);
      }
    });
  });

  describe('正常系: BF12 success + BF13 rejected', () => {
    it('verified rotate success + child_snapshot_only rejected + cleanup 2 件成功', async () => {
      const createCalls: string[] = [];
      const cleanupCalls: string[] = [];
      const fakeStore: FixtureStore = {
        async createFixture(input) {
          createCalls.push(input.docId);
          return { objectPath: `processed/${input.docId}/p.pdf`, objectGeneration: '100' };
        },
        async cleanupFixture(input) {
          cleanupCalls.push(input.docId);
        },
      };
      const fakeRotate: RotateApiCaller = {
        async callRotate(input) {
          if (input.docId.includes('child_snapshot_only')) {
            return { kind: 'rejected', rejectionMessage: 'failed-precondition' };
          }
          return {
            kind: 'success',
            rotatedAt: '2026-05-15T10:00:00.000Z',
            newRotationObjectPath: `processed/${input.docId}/rotations/u.pdf`,
            newRotationObjectGeneration: '200',
          };
        },
      };
      const result = await runRotateGateFixtureTest({
        env: 'dev',
        runId: 'run-1',
        pdfBytesVerified: Buffer.from('verified-pdf'),
        pdfBytesChildSnapshotOnly: Buffer.from('child-snapshot-pdf'),
        fixtureStore: fakeStore,
        rotateApiCaller: fakeRotate,
      });
      expect(result.derivedBytesVerified.rotateApiResult).to.equal('success');
      expect(result.childSnapshotOnly.rotateApiResult).to.equal('rejected');
      expect(result.fixtureCleanupFailures).to.have.length(0);
      expect(createCalls).to.have.length(2);
      expect(cleanupCalls).to.have.length(2);
    });
  });

  describe('異常系: rotate gate leak (BF13 FAIL) を artifact に記録', () => {
    it('child_snapshot_only が success → result に "BF13 FAILED" 残し cleanup は実行', async () => {
      const fakeStore: FixtureStore = {
        async createFixture(input) {
          return { objectPath: `p/${input.docId}.pdf`, objectGeneration: '50' };
        },
        async cleanupFixture() {},
      };
      const fakeRotate: RotateApiCaller = {
        async callRotate() {
          return {
            kind: 'success',
            rotatedAt: '2026-05-15T10:00:00.000Z',
            newRotationObjectPath: 'p/r.pdf',
            newRotationObjectGeneration: '60',
          };
        },
      };
      const result = await runRotateGateFixtureTest({
        env: 'dev',
        runId: 'run-2',
        pdfBytesVerified: Buffer.from('v'),
        pdfBytesChildSnapshotOnly: Buffer.from('c'),
        fixtureStore: fakeStore,
        rotateApiCaller: fakeRotate,
      });
      expect(result.childSnapshotOnly.rotateApiResult).to.equal('success');
      expect(result.childSnapshotOnly.rejectionMessage).to.match(/BF13 FAILED/i);
    });
  });

  describe('cleanup hook 失敗 → fixtureCleanupFailures[] に記録', () => {
    it('cleanupFixture が throw → fixtureCleanupFailures に error 記録', async () => {
      const fakeStore: FixtureStore = {
        async createFixture(input) {
          return { objectPath: `p/${input.docId}.pdf`, objectGeneration: '70' };
        },
        async cleanupFixture(input) {
          if (input.docId.includes('child_snapshot_only')) {
            throw new Error('GCS 412 PreconditionFailed (simulated)');
          }
        },
      };
      const fakeRotate: RotateApiCaller = {
        async callRotate(input) {
          if (input.docId.includes('child_snapshot_only')) {
            return { kind: 'rejected', rejectionMessage: 'failed-precondition' };
          }
          return {
            kind: 'success',
            rotatedAt: 'now',
            newRotationObjectPath: 'p/r.pdf',
            newRotationObjectGeneration: '80',
          };
        },
      };
      const result = await runRotateGateFixtureTest({
        env: 'dev',
        runId: 'run-3',
        pdfBytesVerified: Buffer.from('v'),
        pdfBytesChildSnapshotOnly: Buffer.from('c'),
        fixtureStore: fakeStore,
        rotateApiCaller: fakeRotate,
      });
      expect(result.fixtureCleanupFailures).to.have.length(1);
      expect(result.fixtureCleanupFailures[0].fixtureDocId).to.match(/child_snapshot_only/);
      expect(result.fixtureCleanupFailures[0].error).to.match(/GCS 412/);
    });
  });

  describe('rotate API error → kind=error を rejected 扱い (defense in depth)', () => {
    it('rotate API が error 返却 → result.rotateApiResult=rejected + cleanup 実行', async () => {
      let createCount = 0;
      let cleanupCount = 0;
      const fakeStore: FixtureStore = {
        async createFixture(input) {
          createCount++;
          return { objectPath: `p/${input.docId}.pdf`, objectGeneration: '99' };
        },
        async cleanupFixture() {
          cleanupCount++;
        },
      };
      const fakeRotate: RotateApiCaller = {
        async callRotate() {
          return { kind: 'error', message: 'network timeout' };
        },
      };
      const result = await runRotateGateFixtureTest({
        env: 'dev',
        runId: 'run-4',
        pdfBytesVerified: Buffer.from('v'),
        pdfBytesChildSnapshotOnly: Buffer.from('c'),
        fixtureStore: fakeStore,
        rotateApiCaller: fakeRotate,
      });
      // BF12 verified: error は rejected 扱い (verifiedDocs.rotateApiResult=rejected)
      expect(result.derivedBytesVerified.rotateApiResult).to.equal('rejected');
      // BF13 child-snapshot-only: error も rejected (safety side)
      expect(result.childSnapshotOnly.rotateApiResult).to.equal('rejected');
      expect(createCount).to.equal(2);
      expect(cleanupCount).to.equal(2);
    });
  });
});
