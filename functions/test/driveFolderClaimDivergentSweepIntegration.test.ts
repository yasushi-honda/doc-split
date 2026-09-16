/**
 * `functions/src/drive/driveFolderClaimDivergentSweep.ts` 統合テスト(Issue #871 恒久対応, Firestore emulator)
 *
 * `onSchedule`のCloudEvent配管から独立させた`computeDivergentBacklogSummary`を直接テストする
 * (`driveExportScheduledIntegration.test.ts`と同型パターン)。
 *
 * 実行: firebase emulators:exec --only firestore --project drive-folder-claim-divergent-sweep-test \
 *         'npm run test:integration'
 */

import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import { cleanupCollections } from './helpers/cleanupEmulator';
import {
  computeDivergentBacklogSummary,
  logDivergentBacklogSummary,
  STALE_THRESHOLD_MS,
} from '../src/drive/driveFolderClaimDivergentSweep';

const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['driveFolderLocks'];

describe('driveFolderClaimDivergentSweep(Issue #871 恒久対応)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  describe('computeDivergentBacklogSummary', () => {
    it('divergentが0件ならcount=0・oldestAgeMs=undefined・stale=false', async () => {
      const summary = await computeDivergentBacklogSummary(db);
      expect(summary).to.deep.equal({
        count: 0,
        oldestAgeMs: undefined,
        unknownAgeCount: 0,
        stale: false,
      });
    });

    it('divergentAtMsを持つclaimのうち最古の滞留時間を算出する', async () => {
      const nowMs = 1_000_000_000_000;
      await db.collection('driveFolderLocks').doc('claim-old').set({
        state: 'divergent',
        folderId: 'f1',
        attempt: null,
        divergentReason: 'parents-mismatch',
        divergentAtMs: nowMs - 5000,
        parentId: 'p1',
        name: '古太郎',
      });
      await db.collection('driveFolderLocks').doc('claim-new').set({
        state: 'divergent',
        folderId: 'f2',
        attempt: null,
        divergentReason: 'name-mismatch',
        divergentAtMs: nowMs - 1000,
        parentId: 'p2',
        name: '新次郎',
      });
      await db.collection('driveFolderLocks').doc('claim-resolved').set({
        state: 'resolved',
        folderId: 'f3',
        attempt: null,
        parentId: 'p3',
        name: '無関係花子',
      });

      const summary = await computeDivergentBacklogSummary(db, nowMs);

      expect(summary.count).to.equal(2);
      expect(summary.oldestAgeMs).to.equal(5000);
      expect(summary.unknownAgeCount).to.equal(0);
    });

    it('divergentAtMsを持たない(移行前の過去分)claimはunknownAgeCountに分類され、staleと判定される', async () => {
      await db.collection('driveFolderLocks').doc('claim-legacy').set({
        state: 'divergent',
        folderId: 'f1',
        attempt: null,
        divergentReason: 'parents-mismatch',
        parentId: 'p1',
        name: 'レガシー太郎',
      });

      const summary = await computeDivergentBacklogSummary(db);

      expect(summary.count).to.equal(1);
      expect(summary.oldestAgeMs).to.equal(undefined);
      expect(summary.unknownAgeCount).to.equal(1);
      expect(summary.stale).to.equal(true);
    });

    it('滞留がSTALE_THRESHOLD_MS(3日)を超えるとstale=true、超えなければfalse', async () => {
      const nowMs = 1_000_000_000_000;
      await db.collection('driveFolderLocks').doc('claim-fresh').set({
        state: 'divergent',
        folderId: 'f1',
        attempt: null,
        divergentReason: 'parents-mismatch',
        divergentAtMs: nowMs - (STALE_THRESHOLD_MS - 1000),
        parentId: 'p1',
        name: '新鮮太郎',
      });

      const freshSummary = await computeDivergentBacklogSummary(db, nowMs);
      expect(freshSummary.stale).to.equal(false);

      await db.collection('driveFolderLocks').doc('claim-fresh').update({
        divergentAtMs: nowMs - (STALE_THRESHOLD_MS + 1000),
      });

      const staleSummary = await computeDivergentBacklogSummary(db, nowMs);
      expect(staleSummary.stale).to.equal(true);
    });
  });

  describe('logDivergentBacklogSummary', () => {
    it('count=0の場合はwarnを出力しない', () => {
      const warnCalls: unknown[][] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warnCalls.push(args);
      try {
        logDivergentBacklogSummary({ count: 0, oldestAgeMs: undefined, unknownAgeCount: 0, stale: false });
      } finally {
        console.warn = originalWarn;
      }
      expect(warnCalls).to.have.lengthOf(0);
    });

    it('staleな場合は"[driveFolderClaim] divergent backlog stale"を含むwarnを出力する(claim_divergent_backlog_staleメトリクスが拾う文言)', () => {
      const warnCalls: unknown[][] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warnCalls.push(args);
      try {
        logDivergentBacklogSummary({ count: 1, oldestAgeMs: STALE_THRESHOLD_MS + 1, unknownAgeCount: 0, stale: true });
      } finally {
        console.warn = originalWarn;
      }
      expect(warnCalls).to.have.lengthOf(1);
      expect(warnCalls[0][0] as string).to.include('[driveFolderClaim] divergent backlog stale');
    });

    it('countがあってもstaleでなければwarnを出力しない', () => {
      const warnCalls: unknown[][] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warnCalls.push(args);
      try {
        logDivergentBacklogSummary({ count: 1, oldestAgeMs: 1000, unknownAgeCount: 0, stale: false });
      } finally {
        console.warn = originalWarn;
      }
      expect(warnCalls).to.have.lengthOf(0);
    });
  });
});
