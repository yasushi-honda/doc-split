/**
 * 分割 PDF Source Snapshot 取得 / Drift 検出 / GCS URI parsing
 *
 * ADR-0016 MUST 5 (同一 read snapshot で source\* を取得 + concurrent write 検出) を
 * 純粋関数で実装する。「3-stage metadata-download-metadata 一致確認」パターンで
 * download 中の親 PDF 上書きを generation + metageneration 両方で検知する
 * (Codex MCP セカンドオピニオン High 1/H2 指摘反映、詳細は PR #456 description 参照)。
 *
 * Issue #445 PR-D2 (splitPdf 改修) で利用。
 *
 * 詳細: docs/adr/0016-document-identity-and-provenance.md
 */

/**
 * Source snapshot drift / GCS URI 不整合 検出時に throw されるエラー型。
 * splitPdf の retry ループで「再試行可能 = drift」と「即 fail = それ以外」を区別するために
 * instanceof でカテゴリ判定する。
 */
export class SourceDriftError extends Error {
  constructor(
    message: string,
    public readonly before: { generation: string; metageneration: string },
    public readonly after: { generation: string; metageneration: string }
  ) {
    super(message);
    this.name = 'SourceDriftError';
  }
}

/**
 * `gs://bucket/path/to/object` 形式の URI を bucket と object name に分解する。
 *
 * - 不正形式 / 別 bucket / 空 object name は throw する (caller は failed-precondition で abort)
 * - `gs://` prefix を含まない単純 path や、別 prefix (例: `https://`) も拒否
 *
 * 期待 bucket を渡すと bucket mismatch も検出する。
 *
 * Codex Medium 1 指摘 (fileUrl.replace の脆弱性) への対応。
 */
export function parseGcsUri(
  uri: string,
  expectedBucket?: string
): { bucket: string; objectName: string } {
  if (typeof uri !== 'string' || uri.length === 0) {
    throw new Error(`Invalid GCS URI: expected non-empty string, got ${typeof uri}`);
  }
  const match = uri.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!match) {
    throw new Error(`Invalid GCS URI: expected "gs://bucket/object", got "${uri}"`);
  }
  const [, bucket, objectName] = match;
  if (expectedBucket !== undefined && bucket !== expectedBucket) {
    throw new Error(
      `GCS bucket mismatch: expected "${expectedBucket}", got "${bucket}" in URI "${uri}"`
    );
  }
  return { bucket, objectName };
}

/**
 * `getMetadata()` の戻り値 2 件を比較し、generation と metageneration の両方が
 * 一致しているか検証する pure function。
 *
 * - 一致 → snapshot として採用可能 (戻り値 = consistent snapshot)
 * - 不一致 → SourceDriftError を throw (caller が retry or abort を判断)
 *
 * Codex High 1 (snapshot 一致確認) + High 2 (metageneration も必須) 反映。
 */
export function verifySnapshotConsistency(
  before: { generation?: string | number; metageneration?: string | number },
  after: { generation?: string | number; metageneration?: string | number }
): { generation: string; metageneration: string } {
  const beforeGen = String(before.generation ?? '');
  const beforeMeta = String(before.metageneration ?? '');
  const afterGen = String(after.generation ?? '');
  const afterMeta = String(after.metageneration ?? '');

  if (!beforeGen || !beforeMeta || !afterGen || !afterMeta) {
    throw new Error(
      `Missing generation/metageneration in metadata: before=(${beforeGen},${beforeMeta}) after=(${afterGen},${afterMeta})`
    );
  }
  if (beforeGen !== afterGen || beforeMeta !== afterMeta) {
    throw new SourceDriftError(
      `Source object changed during download: ` +
        `generation ${beforeGen} → ${afterGen}, metageneration ${beforeMeta} → ${afterMeta}`,
      { generation: beforeGen, metageneration: beforeMeta },
      { generation: afterGen, metageneration: afterMeta }
    );
  }
  return { generation: beforeGen, metageneration: beforeMeta };
}

/**
 * Final drift check (segments ループ後、Firestore batch write 前)。
 * 取得済み source snapshot と再取得した親 metadata を比較する。
 *
 * 一致 → 続行可能 / 不一致 → SourceDriftError throw (caller は cleanup + retry)
 */
export function verifyFinalDrift(
  snapshot: { generation: string; metageneration: string },
  finalMetadata: { generation?: string | number; metageneration?: string | number }
): void {
  const finalGen = String(finalMetadata.generation ?? '');
  const finalMeta = String(finalMetadata.metageneration ?? '');
  if (!finalGen || !finalMeta) {
    throw new Error(
      `Missing generation/metageneration in final metadata check: gen=${finalGen}, meta=${finalMeta}`
    );
  }
  if (finalGen !== snapshot.generation || finalMeta !== snapshot.metageneration) {
    throw new SourceDriftError(
      `Source object changed during segments processing: ` +
        `generation ${snapshot.generation} → ${finalGen}, metageneration ${snapshot.metageneration} → ${finalMeta}`,
      snapshot,
      { generation: finalGen, metageneration: finalMeta }
    );
  }
}

/**
 * GCS File から source snapshot を 3-stage で取得する orchestration helper。
 * (Codex High 1 反映: metadata-download-metadata で download 中の上書きを検出)
 *
 * mock 可能な最小 File-like interface のみ受け取るので unit test 可能。
 * splitPdf 内では `bucket.file(name)` を渡す。
 *
 * @returns 一致した snapshot + download した bytes
 * @throws SourceDriftError - generation または metageneration が download 前後で変化
 * @throws Error - metadata に必須フィールド欠落
 */
export interface SnapshotFile {
  // GCS @google-cloud/storage File.getMetadata は [Metadata, ApiResponse] の tuple を返す。
  // 我々が使うのは先頭の Metadata のみだが、rest 要素を許容して real type と互換にする。
  getMetadata(): Promise<
    [
      {
        generation?: string | number;
        metageneration?: string | number;
        [k: string]: unknown;
      },
      ...unknown[],
    ]
  >;
  download(): Promise<[Buffer, ...unknown[]]>;
}

export async function acquireSourceSnapshot(file: SnapshotFile): Promise<{
  buffer: Buffer;
  generation: string;
  metageneration: string;
}> {
  const [metaBefore] = await file.getMetadata();
  const [buffer] = await file.download();
  const [metaAfter] = await file.getMetadata();
  const consistent = verifySnapshotConsistency(metaBefore, metaAfter);
  return {
    buffer,
    generation: consistent.generation,
    metageneration: consistent.metageneration,
  };
}

/**
 * concurrent write retry 間の sleep。jitter 付き backoff で連続衝突を緩和する。
 *
 * Codex Medium 2 指摘: 連続上書き中の即 retry を避けるため 100ms / 300ms ベースで
 * jitter を加える。
 *
 * @param attempt 0-indexed の試行回数 (0 → 1 回目失敗後の sleep, 1 → 2 回目失敗後の sleep)
 */
export async function backoffSleep(attempt: number): Promise<void> {
  const baseMs = attempt === 0 ? 100 : 300;
  const jitter = Math.floor(Math.random() * baseMs * 0.5);
  await new Promise<void>((resolve) => setTimeout(resolve, baseMs + jitter));
}
