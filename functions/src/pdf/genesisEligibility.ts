/**
 * Genesis provenance 適格判定 (ADR-0016 MUST 8)
 *
 * 分割を経ていない doc (Gmail 添付取込 / 手動アップロードのみで完結、`provenance` 不在) に対し、
 * `rotatePdfPages` が回転時にその場で起点 provenance を実測合成 (genesis) してよいかを判定する
 * 純粋関数。`rotateGate.ts` と同じく Firebase 初期化なしで unit test 可能な設計。
 *
 * 適格条件 (4つ全て満たす場合のみ true):
 * - `provenance` が不在 (既存 provenance があれば通常フローを使う、genesis 不要)
 * - `parentDocumentId` が不在 (分割由来の doc は対象外、PR-D4 backfill の領分)
 * - `isSplitSource` が true でない (splitPdf が親 doc に書く `status:'split'`/`isSplitSource:true`
 *   の split-source doc は、fileUrl が `original/` のまま・provenance/parentDocumentId 不在の
 *   ままなので上記2条件だけでは除外できない。この doc は「分割済みの記録」であり実質的に
 *   非アクティブ化されているため、rotate で新たに provenance を持たせて再アクティブ化すべきでない
 *   — code-review 指摘、`splitInto` を持つ親と回転済み子が矛盾した状態になるのを防ぐ)
 * - `fileUrl` の object name が `original/` 直下 (Gmail 添付取込 `checkGmailAttachments.ts` /
 *   手動アップロード `uploadPdf.ts` の 2 箇所でのみ生成される prefix。`Date.now()` ベースの命名で
 *   衝突経路が存在せず、Issue #432 の被害対象になり得ない)
 *
 * `processed/` 配下 (legacy 分割 doc、Issue #432 の被害候補) は明示的に対象外とし、
 * 現行の `failed-precondition` 拒否を維持する。
 *
 * 詳細: docs/adr/0016-document-identity-and-provenance.md MUST 8
 */

import { parseGcsUri } from './splitSnapshot';

export interface GenesisEligibilityInput {
  hasProvenance: boolean;
  hasParentDocumentId: boolean;
  isSplitSource: boolean;
  fileUrl: string;
  bucketName: string;
}

const ORIGINAL_PREFIX = 'original/';

/**
 * genesis provenance 合成の適格性を判定する。
 *
 * `fileUrl` が不正な GCS URI (パース不能 / bucket 不一致) の場合は fail-closed で false を返す
 * (呼び出し元の通常フローに委ね、そちらで適切なエラーを出させる)。
 */
export function isGenesisEligible(input: GenesisEligibilityInput): boolean {
  if (input.hasProvenance) return false;
  if (input.hasParentDocumentId) return false;
  if (input.isSplitSource) return false;

  let objectName: string;
  try {
    objectName = parseGcsUri(input.fileUrl, input.bucketName).objectName;
  } catch {
    return false;
  }

  return objectName.startsWith(ORIGINAL_PREFIX);
}
