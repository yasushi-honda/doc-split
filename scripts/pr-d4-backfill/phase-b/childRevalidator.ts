/**
 * Issue #445 PR-D4 S1-3: child object 現在 sha256 計算 + metadata 取得.
 *
 * Phase B では各 candidate の child object を **実 download** し sha256 を計算する
 * (= provenance.derivedSha256 の canonical 値)。Phase A は HEAD のみで metadata
 * 取得のみだったが、Phase B では Phase C 書込対象 doc に対し実 bytes 計算が必要。
 *
 * DI 化: ChildObjectDownloader interface で実 GCS download を抽象化。unit test は
 * in-memory mock で実行する。
 *
 * 並行度制御 (impl-plan §4.2 rate limit): GCS download N=4 並行で開始 (Codex 2nd I3)。
 * 本 module は 1 doc 単位、orchestrator が p-limit / Promise.all 等で並行 fan-out する。
 */

import * as crypto from 'crypto';

export interface ChildObjectDownloader {
  /**
   * GCS から object download (HEAD + GET 同時)。
   * - 存在: bytes + metadata
   * - 不在: null
   */
  download(objectPath: string): Promise<{
    bytes: Buffer;
    generation: string;
    metageneration: string;
  } | null>;
}

export interface ChildRevalidationInput {
  /** child Storage object path (gs:// prefix なし、bucket 共通)、null = orphan で download skip */
  childObjectPath: string | null;
  downloader: ChildObjectDownloader;
}

export type ChildRevalidationResult =
  | { exists: false }
  | {
      exists: true;
      bytes: Buffer;
      derivedSha256: string;
      derivedGeneration: string;
      derivedMetageneration: string;
    };

function sha256HexLower(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export async function revalidateChildObject(
  input: ChildRevalidationInput
): Promise<ChildRevalidationResult> {
  if (input.childObjectPath === null) {
    return { exists: false };
  }
  const downloaded = await input.downloader.download(input.childObjectPath);
  if (downloaded === null) {
    return { exists: false };
  }
  return {
    exists: true,
    bytes: downloaded.bytes,
    derivedSha256: sha256HexLower(downloaded.bytes),
    derivedGeneration: downloaded.generation,
    derivedMetageneration: downloaded.metageneration,
  };
}
