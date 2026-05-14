/**
 * Issue #445 PR-D4 S1-3: Phase A artifact streaming reader (BF22 反映).
 *
 * Phase B が Phase A 出力を消費する経路:
 *   1. manifest.json 読込 → phaseA section から main path + sha256 取得
 *   2. main artifact 読込 + sha256 verify (不一致 → ArtifactIntegrityError)
 *   3. main.chunks 配列を順次 1 chunk ずつ stream read + sha256 verify + candidates yield
 *
 * caller (orchestrator) は AsyncIterable<PhaseACandidate> を for-await で消費し、
 * 全 chunk を一括メモリロードしない (chunk 1 件 ≤ 1000 candidates が in-memory 上限)。
 */

import * as crypto from 'crypto';
import type {
  PhaseACandidate,
  PhaseAClassifyChunk,
  PhaseAClassifySummary,
  BackfillManifest,
} from '../types';

export class ArtifactIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtifactIntegrityError';
  }
}

export interface ArtifactStorageReader {
  /**
   * `gs://{bucket}/{path}` 形式の path から content を読み、object generation も返す。
   * generation は manifest update 時の compare-and-swap 用 (CAS で他者上書き検出)。
   */
  readJson(objectPath: string): Promise<{ content: string; generation: number }>;
}

export interface ReadPhaseAArtifactInput {
  manifestPath: string;
  reader: ArtifactStorageReader;
}

export interface PhaseAArtifactStream {
  /** Phase A main artifact path (caller が後段 artifact に記録) */
  phaseAArtifactRef: string;
  /**
   * Phase A main artifact 内容の sha256 (= manifest.phaseA.mainArtifact.sha256)。
   * field 名は **Phase A main artifact の sha256** であり manifest 自体の sha256 ではない。
   * caller (Phase B finalize) が後段 artifact `phaseAManifestSha256` field に記録する用途。
   */
  phaseAManifestSha256: string;
  /** Phase A 候補件数 (chunks 配列の docCount 合計、streaming 開始前判明) */
  candidatesIn: number;
  /**
   * Phase A 開始時点の manifest 全体 (caller が finalizePhaseBArtifact の existingManifest に
   * そのまま渡せる)。orchestrator が manifest を二重 read することを避けるため reader が保持。
   */
  manifest: BackfillManifest;
  /**
   * manifest.json の GCS generation (Phase B finalize で compare-and-swap update 用)。
   * Phase B 実行中に他者が manifest を上書きしていれば finalize 時に 412 fail。
   */
  manifestGeneration: number;
  /** 全 candidate を順次 yield する AsyncIterable */
  candidates(): AsyncIterable<PhaseACandidate>;
}

function sha256Hex(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * manifest → main → chunks を eager に initialize し stream object を返す。
 * chunks 本体は AsyncIterable 内で 1 chunk ずつ stream read する (BF22 維持)。
 */
export async function readPhaseAArtifact(
  input: ReadPhaseAArtifactInput
): Promise<PhaseAArtifactStream> {
  const manifestRead = await input.reader.readJson(input.manifestPath);
  const manifest = JSON.parse(manifestRead.content) as BackfillManifest;
  if (!manifest.phaseA) {
    throw new Error(
      `manifest.phaseA section absent (Phase A artifact not finalized): ${input.manifestPath}`
    );
  }
  const phaseAArtifactRef = manifest.phaseA.mainArtifact.path;
  const phaseAManifestSha256 = manifest.phaseA.mainArtifact.sha256;

  const mainRead = await input.reader.readJson(phaseAArtifactRef);
  const mainContent = mainRead.content;
  const actualMainSha = sha256Hex(mainContent);
  if (actualMainSha !== phaseAManifestSha256) {
    throw new ArtifactIntegrityError(
      `main artifact sha256 mismatch: expected ${phaseAManifestSha256}, got ${actualMainSha} (path=${phaseAArtifactRef})`
    );
  }
  const main = JSON.parse(mainContent) as PhaseAClassifySummary;
  const chunkPointers = main.chunks;
  const candidatesIn = chunkPointers.reduce((acc, c) => acc + c.docCount, 0);

  async function* streamCandidates(): AsyncIterable<PhaseACandidate> {
    for (const pointer of chunkPointers) {
      const chunkRead = await input.reader.readJson(pointer.path);
      const chunkContent = chunkRead.content;
      const actualSha = sha256Hex(chunkContent);
      if (actualSha !== pointer.sha256) {
        throw new ArtifactIntegrityError(
          `chunk sha256 mismatch: expected ${pointer.sha256}, got ${actualSha} (path=${pointer.path})`
        );
      }
      const chunk = JSON.parse(chunkContent) as PhaseAClassifyChunk;
      for (const candidate of chunk.candidates) yield candidate;
    }
  }

  return {
    phaseAArtifactRef,
    phaseAManifestSha256,
    candidatesIn,
    manifest,
    manifestGeneration: manifestRead.generation,
    candidates: streamCandidates,
  };
}
