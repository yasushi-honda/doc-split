/**
 * Issue #445 PR-D4 S1-3: parent PDF 再 download + 再 split + child sha256 一致確認.
 *
 * MatchedByHash 候補に対する Phase B 主要処理 (impl-plan §4.2 step 5):
 *   1. parent PDF download (DI 化)
 *   2. parent bytes sha256 計算 (= provenance.sourceSha256 canonical 値)
 *   3. splitFromPages で page selection 再 split (scripts/lib/pdfRegenerator.ts 流用)
 *   4. 再 split 結果の sha256 と現 child sha256 を比較
 *
 * 結果:
 *   - parentExists=false: parent 不在 (HEAD null or parentObjectPath null)
 *   - parentExists=true + parentSha256MatchedAtBackfill=true: 完全一致 (derived-bytes-verified 候補)
 *   - parentExists=true + parentSha256MatchedAtBackfill=false: 不一致 (child-snapshot-only 相当、
 *     本番 Phase C 書込対象外)
 *
 * 再 split が throw する経路 (out of bounds / 壊れた PDF) は exception 化せず
 * matched=false で記録する (1 doc の問題が全 Phase B run を停止させない、graceful degrade)。
 */

import * as crypto from 'crypto';
import { regenerateChildPdf } from '../../lib/pdfRegenerator';

export interface ParentObjectDownloader {
  download(objectPath: string): Promise<{
    bytes: Buffer;
    generation: string;
    metageneration: string;
  } | null>;
  /**
   * HEAD のみで metadata 取得 (drift 検出を bytes download より前に行う用途、Codex MCP Important 反映)。
   * download() のコストを drift 検出後に遅延することで cross-region egress / 大規模 PDF 転送を回避。
   */
  getMetadataOnly(objectPath: string): Promise<{
    generation: string;
    metageneration: string;
  } | null>;
}

export interface ParentReSplitInput {
  /** gs:// prefix なし object path。null = parent 不在で download skip */
  parentObjectPath: string | null;
  splitFromPages: { start: number; end: number } | null;
  /** Phase B が現在 download した child bytes (= 比較対象) */
  childBytes: Buffer;
  downloader: ParentObjectDownloader;
}

export type ParentReSplitResult =
  | { parentExists: false }
  | {
      parentExists: true;
      parentSha256MatchedAtBackfill: boolean;
      sourceSha256: string;
      sourceGeneration: string;
      sourceMetageneration: string;
    };

function sha256HexLower(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function safeRegenerate(
  parentBytes: Buffer,
  splitFromPages: { start: number; end: number } | null
): Promise<Buffer | null> {
  if (splitFromPages === null) return null;
  try {
    return await regenerateChildPdf(parentBytes, splitFromPages.start, splitFromPages.end);
  } catch {
    return null;
  }
}

export async function verifyParentReSplit(
  input: ParentReSplitInput
): Promise<ParentReSplitResult> {
  if (input.parentObjectPath === null) {
    return { parentExists: false };
  }
  const downloaded = await input.downloader.download(input.parentObjectPath);
  if (downloaded === null) {
    return { parentExists: false };
  }

  const sourceSha256 = sha256HexLower(downloaded.bytes);
  const regenerated = await safeRegenerate(downloaded.bytes, input.splitFromPages);
  const matched =
    regenerated !== null &&
    regenerated.equals(input.childBytes);

  return {
    parentExists: true,
    parentSha256MatchedAtBackfill: matched,
    sourceSha256,
    sourceGeneration: downloaded.generation,
    sourceMetageneration: downloaded.metageneration,
  };
}
