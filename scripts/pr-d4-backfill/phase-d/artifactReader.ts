/**
 * Issue #445 PR-D4 S1-5: Phase D artifact streaming reader (BF22 + manifest chain authority).
 *
 * Phase D は Phase C `writtenDocs[]` の verify が主目的だが、verify の expected source は
 * Phase B `computedProvenance` (10 fields)。manifest chain (phaseA → phaseB → phaseC) を
 * authority として、Phase B/C 両 artifact + Phase A summary を読み込む。
 *
 * Codex MCP 8th review 回答 5 反映: 同 runId 強制ではなく Phase C manifest authority。CLI は
 * `--phase-c-artifact-ref` (= manifest path) を起点とし、そこから phaseA/B/C を辿る。
 *
 * 設計:
 * - readPhaseCArtifactFromManifest: Phase D 起動時に Phase C main artifact + manifest を読み込み、
 *   `writtenDocs[]` streaming を提供 (chunks の writtenDocs のみ yield、他カテゴリは skip)
 * - readPhaseBCandidatesIndex: Phase B 全 chunks を in-memory Map<docId, computedProvenance> 化
 *   (Codex 7th 回答 1 + 8th 回答 1 反映、6,238 件 × ~500 bytes = ~3MB、OK)
 * - readPhaseACountReadOnly: Phase A main artifact から totalDocs / categoryDistribution 等を read-only
 *   抽出 (Codex 7th Important 5)
 */

import * as crypto from 'crypto';
import type {
  BackfillManifest,
  PhaseAClassifySummary,
  PhaseBRevalidatedCandidate,
  PhaseBRevalidatedChunk,
  PhaseBRevalidationSummary,
  PhaseCBackfillChunk,
  PhaseCBackfillSummary,
  PhaseCWrittenDoc,
} from '../types';
import type { ArtifactStorageReader } from '../phase-b/artifactReader';
import { ArtifactIntegrityError } from '../phase-b/artifactReader';

export type { ArtifactStorageReader } from '../phase-b/artifactReader';
export { ArtifactIntegrityError } from '../phase-b/artifactReader';

function sha256Hex(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

export interface ReadPhaseCArtifactInput {
  manifestPath: string;
  reader: ArtifactStorageReader;
}

export interface PhaseCArtifactStream {
  phaseCArtifactRef: string;
  phaseCManifestSha256: string;
  /** Phase C writtenDocs 件数 (chunks 内 writtenDocs.length 合計、Phase D candidatesIn) */
  writtenDocsIn: number;
  /** Phase B main artifact path (Phase D が Phase B index を読む authority) */
  phaseBArtifactRef: string;
  /** Phase A main artifact path (Phase D が summary を read-only 抽出する authority) */
  phaseAArtifactRef: string;
  /**
   * Phase C main artifact 全体 (Codex 9th Important 4 + code-reviewer L1 反映で expose、
   * preconditionFailedDocs / skippedImmutable / unprocessableDocs / outOfScopeDocs を
   * Phase D coverage 算出で利用)。
   */
  phaseCSummary: PhaseCBackfillSummary;
  manifest: BackfillManifest;
  manifestGeneration: number;
  /** Phase C 全 chunks の writtenDocs のみを順次 yield (他カテゴリは skip) */
  writtenDocs(): AsyncIterable<PhaseCWrittenDoc>;
}

/**
 * Phase C manifest を起点に main artifact + writtenDocs stream を構築。
 *
 * Codex 7th 回答 5 反映: 同 runId 強制ではなく phaseC manifest authority。
 */
export async function readPhaseCArtifactFromManifest(
  input: ReadPhaseCArtifactInput
): Promise<PhaseCArtifactStream> {
  const manifestRead = await input.reader.readJson(input.manifestPath);
  const manifest = JSON.parse(manifestRead.content) as BackfillManifest;
  if (!manifest.phaseC) {
    throw new Error(
      `manifest.phaseC section absent (Phase C artifact not finalized): ${input.manifestPath}`
    );
  }
  if (!manifest.phaseB) {
    throw new Error(
      `manifest.phaseB section absent (Phase D requires Phase B index): ${input.manifestPath}`
    );
  }
  if (!manifest.phaseA) {
    throw new Error(
      `manifest.phaseA section absent (Phase D requires Phase A summary): ${input.manifestPath}`
    );
  }
  const phaseCArtifactRef = manifest.phaseC.mainArtifact.path;
  const phaseCManifestSha256 = manifest.phaseC.mainArtifact.sha256;

  const mainRead = await input.reader.readJson(phaseCArtifactRef);
  const mainContent = mainRead.content;
  const actualMainSha = sha256Hex(mainContent);
  if (actualMainSha !== phaseCManifestSha256) {
    throw new ArtifactIntegrityError(
      `Phase C main artifact sha256 mismatch: expected ${phaseCManifestSha256}, got ${actualMainSha} (path=${phaseCArtifactRef})`
    );
  }
  const main = JSON.parse(mainContent) as PhaseCBackfillSummary;
  const chunkPointers = main.chunks;

  // writtenDocs 件数を chunks streaming 前に確定するため、Phase C summary の writtenDocs を使う。
  // (chunks の writtenDocs.length 合計と一致する設計、Phase C orchestrator が保全式で保証済)
  const writtenDocsIn = main.writtenDocs;

  async function* streamWrittenDocs(): AsyncIterable<PhaseCWrittenDoc> {
    for (const pointer of chunkPointers) {
      const chunkRead = await input.reader.readJson(pointer.path);
      const chunkContent = chunkRead.content;
      const actualSha = sha256Hex(chunkContent);
      if (actualSha !== pointer.sha256) {
        throw new ArtifactIntegrityError(
          `Phase C chunk sha256 mismatch: expected ${pointer.sha256}, got ${actualSha} (path=${pointer.path})`
        );
      }
      const chunk = JSON.parse(chunkContent) as PhaseCBackfillChunk;
      for (const writtenDoc of chunk.writtenDocs) yield writtenDoc;
    }
  }

  return {
    phaseCArtifactRef,
    phaseCManifestSha256,
    writtenDocsIn,
    phaseBArtifactRef: manifest.phaseB.mainArtifact.path,
    phaseAArtifactRef: manifest.phaseA.mainArtifact.path,
    phaseCSummary: main,
    manifest,
    manifestGeneration: manifestRead.generation,
    writtenDocs: streamWrittenDocs,
  };
}

/**
 * Phase B chunks を in-memory Map に load (Codex 7th 回答 1 + 8th 回答 1 反映)。
 *
 * 6,238 件 × computedProvenance 10 fields (~80 bytes/field) = ~5MB rough。constant-memory
 * 設計よりも index look-up 計算量 O(1) を優先 (Phase D は per-doc に Phase B candidate を
 * 引きたいため)。
 *
 * Codex 9th Important 2 + code-reviewer M2 反映: Phase B main artifact の sha256 も
 * manifest と照合 (Phase C と同等の chain authority に揃える)。
 *
 * 注意: Map<docId, PhaseBRevalidatedCandidate>。docId 重複時は **後者で上書き**する設計 (Phase B
 * が同 docId を 2 回 revalidated[] に入れる仕様はないが、防御として一応 last-write 動作明文化)。
 */
export async function readPhaseBCandidatesIndex(
  phaseBArtifactRef: string,
  expectedMainSha256: string,
  reader: ArtifactStorageReader
): Promise<Map<string, PhaseBRevalidatedCandidate>> {
  const mainRead = await reader.readJson(phaseBArtifactRef);
  const mainContent = mainRead.content;
  const actualMainSha = sha256Hex(mainContent);
  if (actualMainSha !== expectedMainSha256) {
    throw new ArtifactIntegrityError(
      `Phase B main artifact sha256 mismatch: expected ${expectedMainSha256}, got ${actualMainSha} (path=${phaseBArtifactRef})`
    );
  }
  const main = JSON.parse(mainContent) as PhaseBRevalidationSummary;

  const index = new Map<string, PhaseBRevalidatedCandidate>();
  for (const pointer of main.chunks) {
    const chunkRead = await reader.readJson(pointer.path);
    const chunkContent = chunkRead.content;
    const actualSha = sha256Hex(chunkContent);
    if (actualSha !== pointer.sha256) {
      throw new ArtifactIntegrityError(
        `Phase B chunk sha256 mismatch (Phase D index 構築中): expected ${pointer.sha256}, got ${actualSha} (path=${pointer.path})`
      );
    }
    const chunk = JSON.parse(chunkContent) as PhaseBRevalidatedChunk;
    for (const candidate of chunk.revalidated) {
      index.set(candidate.docId, candidate);
    }
  }
  return index;
}

/**
 * Phase A main artifact から read-only count を抽出 (Codex 7th Important 5)。
 */
export interface PhaseACountReadOnlyResult {
  totalDocs: number;
  alreadyBackfilled: number;
  verifiedExistingProvenance: number;
  categoryDistribution: PhaseAClassifySummary['categoryDistribution'];
}

/**
 * Codex 9th Important 2 + code-reviewer M2 反映: Phase A main artifact の sha256 も manifest と
 * 照合 (chain authority 完全性)。
 */
export async function readPhaseACountReadOnly(
  phaseAArtifactRef: string,
  expectedMainSha256: string,
  reader: ArtifactStorageReader
): Promise<PhaseACountReadOnlyResult> {
  const mainRead = await reader.readJson(phaseAArtifactRef);
  const actualMainSha = sha256Hex(mainRead.content);
  if (actualMainSha !== expectedMainSha256) {
    throw new ArtifactIntegrityError(
      `Phase A main artifact sha256 mismatch: expected ${expectedMainSha256}, got ${actualMainSha} (path=${phaseAArtifactRef})`
    );
  }
  const main = JSON.parse(mainRead.content) as PhaseAClassifySummary;
  return {
    totalDocs: main.totalDocs,
    alreadyBackfilled: main.alreadyBackfilled,
    verifiedExistingProvenance: main.verifiedExistingProvenance,
    categoryDistribution: main.categoryDistribution,
  };
}
