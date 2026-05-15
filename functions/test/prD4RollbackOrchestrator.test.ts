/**
 * Issue #445 PR-D4 S6: Rollback orchestrator 統合テスト.
 *
 * BF24 (Codex 3rd 追加) / Codex MCP 12th review I1 反映:
 * dev fixture 限定 (prefix allowlist `BF_` / `BF13_test_fixture_`) で
 * provenance + provenanceBackfill 双方を FieldValue.delete() し、既存 verified
 * provenance (provenance exists && provenanceBackfill absent) は immutable skip する。
 *
 * AC1-AC6 を mocha + chai で網羅。AC7 (re-Phase C metric reproducibility) は
 * dev rehearsal scope で本 unit test ではなく artifact diff で検証する。
 */

import { expect } from 'chai';
import { runRollback } from '../../scripts/pr-d4-backfill/rollback/rollbackOrchestrator';
import type {
  DocRollbackSnapshot,
  FirestoreRollbackReader,
  FirestoreRollbackWriter,
} from '../../scripts/pr-d4-backfill/rollback/rollbackOrchestrator';
import type { ArtifactStorageWriter } from '../../scripts/pr-d4-backfill/phase-a/artifactWriter';
import type {
  BackfillEnvName,
  PhaseRollbackSummary,
} from '../../scripts/pr-d4-backfill/types';

const RUN_ID = '20260516T010000Z-dev-pr-d4-rollback-v1';
const ARTIFACT_BUCKET = 'doc-split-dev-pr-d4-artifacts';
const EXPECTED_ARTIFACT_PATH =
  `gs://${ARTIFACT_BUCKET}/pr-d4-backfill-artifacts/${RUN_ID}/phase-rollback-summary.json`;

class FakeRollbackReader implements FirestoreRollbackReader {
  private readonly docs: DocRollbackSnapshot[];

  constructor(docs: DocRollbackSnapshot[]) {
    this.docs = docs;
  }

  async *scanCandidateDocs(): AsyncIterable<DocRollbackSnapshot> {
    for (const doc of this.docs) {
      yield doc;
    }
  }
}

interface RecordedWriteCall {
  docId: string;
  deleteProvenance: boolean;
  deleteProvenanceBackfill: boolean;
}

class RecordingRollbackWriter implements FirestoreRollbackWriter {
  public calls: RecordedWriteCall[] = [];

  async deleteProvenanceFields(input: {
    docId: string;
    deleteProvenance: boolean;
    deleteProvenanceBackfill: boolean;
  }): Promise<void> {
    this.calls.push({ ...input });
  }
}

interface RecordedArtifactCall {
  path: string;
  content: string;
  precondition?: { ifGenerationMatch: number };
}

class RecordingArtifactWriter implements ArtifactStorageWriter {
  public calls: RecordedArtifactCall[] = [];

  async writeJson(
    path: string,
    content: string,
    precondition?: { ifGenerationMatch: number }
  ): Promise<void> {
    this.calls.push({ path, content, precondition });
  }
}

function snapshot(
  docId: string,
  hasProvenance: boolean,
  hasProvenanceBackfill: boolean
): DocRollbackSnapshot {
  return { docId, hasProvenance, hasProvenanceBackfill };
}

function parseSummary(content: string): PhaseRollbackSummary {
  return JSON.parse(content) as PhaseRollbackSummary;
}

describe('PR-D4 S6 rollback orchestrator (BF24 / Codex 12th I1)', () => {
  describe('AC1: dev-only hard gate', () => {
    it('env=cocoro で実行すると即 throw (cocoro/kanameone に rollback 適用しない、defense in depth)', async () => {
      const reader = new FakeRollbackReader([]);
      const writer = new RecordingRollbackWriter();
      const artifactWriter = new RecordingArtifactWriter();

      let caught: unknown;
      try {
        await runRollback({
          env: 'cocoro' as BackfillEnvName,
          runId: RUN_ID,
          dryRun: true,
          firestoreReader: reader,
          firestoreWriter: writer,
          artifactWriter,
          artifactBucketName: ARTIFACT_BUCKET,
          rollbackStartedAt: '2026-05-16T01:00:00.000Z',
          scriptVersion: 'pr-d4-v1.0',
        });
      } catch (e) {
        caught = e;
      }
      expect(caught, 'cocoro で throw されなかった').to.exist;
      expect((caught as Error).message).to.match(/dev-only/i);
      // 副作用ゼロ確認 (writer / artifactWriter 未呼出)
      expect(writer.calls).to.have.length(0);
      expect(artifactWriter.calls).to.have.length(0);
    });

    it('env=kanameone で実行すると即 throw', async () => {
      const reader = new FakeRollbackReader([]);
      const writer = new RecordingRollbackWriter();
      const artifactWriter = new RecordingArtifactWriter();

      let caught: unknown;
      try {
        await runRollback({
          env: 'kanameone' as BackfillEnvName,
          runId: RUN_ID,
          dryRun: true,
          firestoreReader: reader,
          firestoreWriter: writer,
          artifactWriter,
          artifactBucketName: ARTIFACT_BUCKET,
          rollbackStartedAt: '2026-05-16T01:00:00.000Z',
          scriptVersion: 'pr-d4-v1.0',
        });
      } catch (e) {
        caught = e;
      }
      expect(caught, 'kanameone で throw されなかった').to.exist;
      expect((caught as Error).message).to.match(/dev-only/i);
      expect(writer.calls).to.have.length(0);
      expect(artifactWriter.calls).to.have.length(0);
    });
  });

  describe('AC2: fixture prefix allowlist', () => {
    it('BF_ / BF13_test_fixture_ / 任意 docId 混在で query → 前 2 つのみ target、その他は out-of-scope', async () => {
      const reader = new FakeRollbackReader([
        snapshot('BF_alpha', true, true),
        snapshot('BF13_test_fixture_beta', true, true),
        snapshot('arbitrary_doc_gamma', true, true),
        snapshot('another_random_id', true, true),
      ]);
      const writer = new RecordingRollbackWriter();
      const artifactWriter = new RecordingArtifactWriter();

      await runRollback({
        env: 'dev',
        runId: RUN_ID,
        dryRun: false,
        firestoreReader: reader,
        firestoreWriter: writer,
        artifactWriter,
        artifactBucketName: ARTIFACT_BUCKET,
        rollbackStartedAt: '2026-05-16T01:00:00.000Z',
        scriptVersion: 'pr-d4-v1.0',
      });

      const summary = parseSummary(artifactWriter.calls[0]!.content);
      expect(summary.scannedDocs).to.equal(4);
      expect(summary.targetedDocs).to.equal(2);
      expect(summary.skippedDocs).to.equal(2);
      const outOfScopeIds = summary.skipped
        .filter((s) => s.reason === 'out-of-scope')
        .map((s) => s.docId)
        .sort();
      expect(outOfScopeIds).to.deep.equal(['another_random_id', 'arbitrary_doc_gamma']);

      const targetIds = summary.targets.map((t) => t.docId).sort();
      expect(targetIds).to.deep.equal(['BF13_test_fixture_beta', 'BF_alpha']);

      // out-of-scope の writer 呼出ゼロ確認 (target 2 つのみ)
      expect(writer.calls).to.have.length(2);
      const writtenIds = writer.calls.map((c) => c.docId).sort();
      expect(writtenIds).to.deep.equal(['BF13_test_fixture_beta', 'BF_alpha']);
    });
  });

  describe('AC3: field-only delete (doc 自体は残存、他 fields 不変)', () => {
    it('両 fields 存在 target で deleteProvenance=true + deleteProvenanceBackfill=true で writer 呼出', async () => {
      const reader = new FakeRollbackReader([
        snapshot('BF_target_both', true, true),
      ]);
      const writer = new RecordingRollbackWriter();
      const artifactWriter = new RecordingArtifactWriter();

      await runRollback({
        env: 'dev',
        runId: RUN_ID,
        dryRun: false,
        firestoreReader: reader,
        firestoreWriter: writer,
        artifactWriter,
        artifactBucketName: ARTIFACT_BUCKET,
        rollbackStartedAt: '2026-05-16T01:00:00.000Z',
        scriptVersion: 'pr-d4-v1.0',
      });

      expect(writer.calls).to.deep.equal([
        {
          docId: 'BF_target_both',
          deleteProvenance: true,
          deleteProvenanceBackfill: true,
        },
      ]);

      const summary = parseSummary(artifactWriter.calls[0]!.content);
      expect(summary.targets).to.deep.equal([
        {
          docId: 'BF_target_both',
          status: 'executed',
          deletedFields: ['provenance', 'provenanceBackfill'],
        },
      ]);
    });

    it('provenance のみ存在 (PR-D2/D3 split-time 由来) は immutable skip で writer 呼出ゼロ', async () => {
      const reader = new FakeRollbackReader([
        snapshot('BF_only_provenance', true, false),
      ]);
      const writer = new RecordingRollbackWriter();
      const artifactWriter = new RecordingArtifactWriter();

      await runRollback({
        env: 'dev',
        runId: RUN_ID,
        dryRun: false,
        firestoreReader: reader,
        firestoreWriter: writer,
        artifactWriter,
        artifactBucketName: ARTIFACT_BUCKET,
        rollbackStartedAt: '2026-05-16T01:00:00.000Z',
        scriptVersion: 'pr-d4-v1.0',
      });

      expect(writer.calls).to.have.length(0);
      const summary = parseSummary(artifactWriter.calls[0]!.content);
      expect(summary.skipped).to.deep.equal([
        {
          docId: 'BF_only_provenance',
          reason: 'existing-verified-provenance',
        },
      ]);
    });

    it('provenanceBackfill のみ存在 (orphan PR-D4 残骸) は target、deletedFields=[provenanceBackfill]', async () => {
      const reader = new FakeRollbackReader([
        snapshot('BF_only_backfill', false, true),
      ]);
      const writer = new RecordingRollbackWriter();
      const artifactWriter = new RecordingArtifactWriter();

      await runRollback({
        env: 'dev',
        runId: RUN_ID,
        dryRun: false,
        firestoreReader: reader,
        firestoreWriter: writer,
        artifactWriter,
        artifactBucketName: ARTIFACT_BUCKET,
        rollbackStartedAt: '2026-05-16T01:00:00.000Z',
        scriptVersion: 'pr-d4-v1.0',
      });

      expect(writer.calls).to.deep.equal([
        {
          docId: 'BF_only_backfill',
          deleteProvenance: false,
          deleteProvenanceBackfill: true,
        },
      ]);
      const summary = parseSummary(artifactWriter.calls[0]!.content);
      expect(summary.targets[0]?.deletedFields).to.deep.equal(['provenanceBackfill']);
    });
  });

  describe('AC4: immutable skip (existing verified provenance)', () => {
    it('provenance exists && provenanceBackfill absent → existing-verified-provenance に分類', async () => {
      const reader = new FakeRollbackReader([
        snapshot('BF_split_verified', true, false),
        snapshot('BF13_test_fixture_split', true, false),
      ]);
      const writer = new RecordingRollbackWriter();
      const artifactWriter = new RecordingArtifactWriter();

      await runRollback({
        env: 'dev',
        runId: RUN_ID,
        dryRun: false,
        firestoreReader: reader,
        firestoreWriter: writer,
        artifactWriter,
        artifactBucketName: ARTIFACT_BUCKET,
        rollbackStartedAt: '2026-05-16T01:00:00.000Z',
        scriptVersion: 'pr-d4-v1.0',
      });

      expect(writer.calls).to.have.length(0);
      const summary = parseSummary(artifactWriter.calls[0]!.content);
      expect(summary.targetedDocs).to.equal(0);
      expect(summary.skippedDocs).to.equal(2);
      const reasons = summary.skipped.map((s) => s.reason);
      expect(reasons).to.deep.equal([
        'existing-verified-provenance',
        'existing-verified-provenance',
      ]);
    });

    it('両 fields 不在 doc は no-provenance-fields に分類 (idempotent skip)', async () => {
      const reader = new FakeRollbackReader([
        snapshot('BF_empty_doc', false, false),
      ]);
      const writer = new RecordingRollbackWriter();
      const artifactWriter = new RecordingArtifactWriter();

      await runRollback({
        env: 'dev',
        runId: RUN_ID,
        dryRun: false,
        firestoreReader: reader,
        firestoreWriter: writer,
        artifactWriter,
        artifactBucketName: ARTIFACT_BUCKET,
        rollbackStartedAt: '2026-05-16T01:00:00.000Z',
        scriptVersion: 'pr-d4-v1.0',
      });

      expect(writer.calls).to.have.length(0);
      const summary = parseSummary(artifactWriter.calls[0]!.content);
      expect(summary.skipped).to.deep.equal([
        { docId: 'BF_empty_doc', reason: 'no-provenance-fields' },
      ]);
    });
  });

  describe('AC5: dry-run (writer 呼出なし、artifact 記録あり)', () => {
    it('dryRun=true なら target 識別はするが Firestore update は発行しない', async () => {
      const reader = new FakeRollbackReader([
        snapshot('BF_target_a', true, true),
        snapshot('BF13_test_fixture_b', true, true),
        snapshot('random_x', true, true), // out-of-scope
        snapshot('BF_split_only', true, false), // immutable skip
      ]);
      const writer = new RecordingRollbackWriter();
      const artifactWriter = new RecordingArtifactWriter();

      await runRollback({
        env: 'dev',
        runId: RUN_ID,
        dryRun: true,
        firestoreReader: reader,
        firestoreWriter: writer,
        artifactWriter,
        artifactBucketName: ARTIFACT_BUCKET,
        rollbackStartedAt: '2026-05-16T01:00:00.000Z',
        scriptVersion: 'pr-d4-v1.0',
      });

      // writer 呼出ゼロ (核心)
      expect(writer.calls).to.have.length(0);

      // artifact には target / skip 判定を full 記録
      const summary = parseSummary(artifactWriter.calls[0]!.content);
      expect(summary.dryRun).to.equal(true);
      expect(summary.scannedDocs).to.equal(4);
      expect(summary.targetedDocs).to.equal(2);
      expect(summary.skippedDocs).to.equal(2);
      // target.status 全 'dryRun'
      expect(summary.targets.every((t) => t.status === 'dryRun')).to.equal(true);
    });
  });

  describe('AC6: explicit confirm executes delete', () => {
    it('dryRun=false なら target 全てで writer 呼出 + target.status=executed 記録', async () => {
      const reader = new FakeRollbackReader([
        snapshot('BF_exec_a', true, true),
        snapshot('BF13_test_fixture_exec_b', true, true),
      ]);
      const writer = new RecordingRollbackWriter();
      const artifactWriter = new RecordingArtifactWriter();

      await runRollback({
        env: 'dev',
        runId: RUN_ID,
        dryRun: false,
        firestoreReader: reader,
        firestoreWriter: writer,
        artifactWriter,
        artifactBucketName: ARTIFACT_BUCKET,
        rollbackStartedAt: '2026-05-16T01:00:00.000Z',
        scriptVersion: 'pr-d4-v1.0',
      });

      expect(writer.calls).to.have.length(2);
      const summary = parseSummary(artifactWriter.calls[0]!.content);
      expect(summary.dryRun).to.equal(false);
      expect(summary.targets.every((t) => t.status === 'executed')).to.equal(true);
    });
  });

  describe('artifact 構造 (schema + path) 検証', () => {
    it('artifact path / phase / schemaVersion / scriptVersion / 保全式が impl-plan §4 と整合', async () => {
      const reader = new FakeRollbackReader([
        snapshot('BF_target', true, true),
        snapshot('BF_skip_verified', true, false),
        snapshot('outOfScope_x', true, true),
      ]);
      const writer = new RecordingRollbackWriter();
      const artifactWriter = new RecordingArtifactWriter();

      await runRollback({
        env: 'dev',
        runId: RUN_ID,
        dryRun: false,
        firestoreReader: reader,
        firestoreWriter: writer,
        artifactWriter,
        artifactBucketName: ARTIFACT_BUCKET,
        rollbackStartedAt: '2026-05-16T01:00:00.000Z',
        scriptVersion: 'pr-d4-v1.0',
        nowProvider: () => '2026-05-16T01:00:05.000Z',
      });

      expect(artifactWriter.calls).to.have.length(1);
      expect(artifactWriter.calls[0]!.path).to.equal(EXPECTED_ARTIFACT_PATH);

      const summary = parseSummary(artifactWriter.calls[0]!.content);
      expect(summary.phase).to.equal('E');
      expect(summary.schemaVersion).to.equal('pr-d4-v1.0');
      expect(summary.scriptVersion).to.equal('pr-d4-v1.0');
      expect(summary.env).to.equal('dev');
      expect(summary.runId).to.equal(RUN_ID);
      expect(summary.rollbackStartedAt).to.equal('2026-05-16T01:00:00.000Z');
      expect(summary.rollbackCompletedAt).to.equal('2026-05-16T01:00:05.000Z');

      // 保全式: targets.length + skipped.length === scannedDocs
      expect(summary.targets.length + summary.skipped.length).to.equal(
        summary.scannedDocs
      );
      // 保全式: targetedDocs === targets.length / skippedDocs === skipped.length
      expect(summary.targetedDocs).to.equal(summary.targets.length);
      expect(summary.skippedDocs).to.equal(summary.skipped.length);
    });
  });
});
