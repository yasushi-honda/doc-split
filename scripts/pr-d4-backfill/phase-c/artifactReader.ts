/**
 * Issue #445 PR-D4 S1-4: Phase B artifact streaming reader (BF22 反映).
 *
 * Phase C が Phase B 出力を消費する経路:
 *   1. manifest.json 読込 → phaseB section から main path + sha256 取得
 *   2. main artifact 読込 + sha256 verify (不一致 → ArtifactIntegrityError)
 *   3. main.chunks 配列を順次 1 chunk ずつ stream read + sha256 verify + revalidated yield
 *
 * caller (orchestrator) は AsyncIterable<PhaseBRevalidatedCandidate> を for-await で消費し、
 * 全 chunk を一括メモリロードしない (BF22)。
 */

import * as crypto from 'crypto';
import type {
  BackfillManifest,
  PhaseBRevalidatedCandidate,
  PhaseBRevalidatedChunk,
  PhaseBRevalidationSummary,
} from '../types';
import type { ArtifactStorageReader } from '../phase-b/artifactReader';
import { ArtifactIntegrityError } from '../phase-b/artifactReader';

export type { ArtifactStorageReader } from '../phase-b/artifactReader';
export { ArtifactIntegrityError } from '../phase-b/artifactReader';

export interface ReadPhaseBArtifactInput {
  manifestPath: string;
  reader: ArtifactStorageReader;
}

export interface PhaseBArtifactStream {
  /** Phase B main artifact path (Phase C finalize 時に `phaseBArtifactRef` に記録) */
  phaseBArtifactRef: string;
  /** Phase B main artifact 内容の sha256 (= manifest.phaseB.mainArtifact.sha256) */
  phaseBManifestSha256: string;
  /** Phase B revalidated 候補件数 (chunks 配列の docCount 合計) */
  candidatesIn: number;
  /** Phase B 完了時点の manifest 全体 (Phase C finalize に existingManifest として渡す) */
  manifest: BackfillManifest;
  /** manifest.json の GCS generation (Phase C finalize で CAS update 用) */
  manifestGeneration: number;
  /** 全 candidate を順次 yield する AsyncIterable */
  candidates(): AsyncIterable<PhaseBRevalidatedCandidate>;
}

function sha256Hex(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

export async function readPhaseBArtifact(
  input: ReadPhaseBArtifactInput
): Promise<PhaseBArtifactStream> {
  const manifestRead = await input.reader.readJson(input.manifestPath);
  const manifest = JSON.parse(manifestRead.content) as BackfillManifest;
  if (!manifest.phaseB) {
    throw new Error(
      `manifest.phaseB section absent (Phase B artifact not finalized): ${input.manifestPath}`
    );
  }
  const phaseBArtifactRef = manifest.phaseB.mainArtifact.path;
  const phaseBManifestSha256 = manifest.phaseB.mainArtifact.sha256;

  const mainRead = await input.reader.readJson(phaseBArtifactRef);
  const mainContent = mainRead.content;
  const actualMainSha = sha256Hex(mainContent);
  if (actualMainSha !== phaseBManifestSha256) {
    throw new ArtifactIntegrityError(
      `Phase B main artifact sha256 mismatch: expected ${phaseBManifestSha256}, got ${actualMainSha} (path=${phaseBArtifactRef})`
    );
  }
  const main = JSON.parse(mainContent) as PhaseBRevalidationSummary;
  const chunkPointers = main.chunks;
  const candidatesIn = chunkPointers.reduce((acc, c) => acc + c.docCount, 0);

  async function* streamCandidates(): AsyncIterable<PhaseBRevalidatedCandidate> {
    for (const pointer of chunkPointers) {
      const chunkRead = await input.reader.readJson(pointer.path);
      const chunkContent = chunkRead.content;
      const actualSha = sha256Hex(chunkContent);
      if (actualSha !== pointer.sha256) {
        throw new ArtifactIntegrityError(
          `Phase B chunk sha256 mismatch: expected ${pointer.sha256}, got ${actualSha} (path=${pointer.path})`
        );
      }
      const chunk = JSON.parse(chunkContent) as PhaseBRevalidatedChunk;
      for (const candidate of chunk.revalidated) yield candidate;
    }
  }

  return {
    phaseBArtifactRef,
    phaseBManifestSha256,
    candidatesIn,
    manifest,
    manifestGeneration: manifestRead.generation,
    candidates: streamCandidates,
  };
}
