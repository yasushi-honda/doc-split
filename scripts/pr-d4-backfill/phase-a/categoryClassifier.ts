/**
 * Issue #445 PR-D4 S1-2: Phase A 構造分類アダプタ (PR-C3c classifier コンセプト流用).
 *
 * Phase A は **read-only audit** で hash 計算は実施しない (Phase B 担当)。
 * doc の構造的状態 (parent 存在 + child 存在 + splitFromPages 存在) のみから
 * 5 分類を予測し、Phase B/C/D の処理対象を絞り込むための artifact を作る。
 *
 * 5 分類は shared/types.ts の BackfillClassifierCategory を流用 (4 値は PR-C3c
 * collisionClassifier.ts の Classification と同じ語彙、NeedsManualReview は
 * PR-D4 で追加した structural-data-missing fallback)。
 *
 * 注意:
 *   - "MatchedByHash" は **予測**。Phase B で actual hash verify した時に downgrade
 *     される可能性がある (downgrade 先は Phase B 側で記録、Phase A artifact は触らない)
 *   - PR-C3c collisionClassifier.ts の `classifyOrphan` / `classifyCollisionGroup` は
 *     hash evidence を入力に取るため Phase A では使えない。本 module は同じ語彙で
 *     **構造判定だけ** を行う独立 pure function。
 */

import type { BackfillClassifierCategory } from '../../../shared/types';

/**
 * 1 doc 分の構造的 snapshot (Phase A での classify 入力)。
 *
 * 設計:
 *   - `childObjectExists`: child PDF が GCS bucket 内に実在するか (Storage HEAD で判定済)
 *   - `parent`: parentDocumentId が指す Firestore doc の状態 + 元 PDF 存在
 *     - null: parentDocumentId が null (parent 取得自体不能)
 *     - {exists:false}: parentDocumentId は値があるが Firestore doc が見つからない
 *     - {exists:true, originalPdfExists}: parent doc は存在、元 PDF の存在は別 field
 */
export interface PhaseADocSnapshot {
  docId: string;
  parentDocumentId: string | null;
  splitFromPages: { start: number; end: number } | null;
  childObjectExists: boolean;
  parent:
    | { exists: true; originalPdfExists: boolean }
    | { exists: false }
    | null;
}

export interface PhaseAClassificationResult {
  category: BackfillClassifierCategory;
  reason: string;
}

/**
 * 構造的 5 分類予測。
 *
 * | snapshot 状態                                | category               |
 * |---------------------------------------------|------------------------|
 * | parentDocumentId 不在 or splitFromPages 不在  | NeedsManualReview      |
 * | parent.null (取得未実施 = caller bug)         | NeedsManualReview      |
 * | child + parent ok + 元 PDF ok                | MatchedByHash (予測)   |
 * | child orphan + parent ok + 元 PDF ok         | RepairableMissingFile  |
 * | child ok + parent 不完全                     | Ambiguous              |
 * | child orphan + parent 不完全                 | LostOrUnrecoverable    |
 */
export function classifyForPhaseA(
  snapshot: PhaseADocSnapshot
): PhaseAClassificationResult {
  // 1. structural-data-missing fallback (PR-D4 で追加した 5 番目分類)
  // 各 NeedsManualReview ブランチは exclusive。両 null → 片 null → defensive の順は
  // operator 監査 reason の精度を最大化するため意図的に分割している (順序入れ替え禁止)。
  if (snapshot.parentDocumentId === null && snapshot.splitFromPages === null) {
    return {
      category: 'NeedsManualReview',
      reason: 'structural-data-missing: parentDocumentId and splitFromPages both absent',
    };
  }
  if (snapshot.parentDocumentId === null) {
    return {
      category: 'NeedsManualReview',
      reason: 'structural-data-missing: parentDocumentId absent (cannot trace split origin)',
    };
  }
  if (snapshot.splitFromPages === null) {
    return {
      category: 'NeedsManualReview',
      reason: 'structural-data-missing: splitFromPages absent (cannot determine page range)',
    };
  }
  if (snapshot.parent === null) {
    // caller bug: parentDocumentId はあるのに parent fetch を実施せず null で渡した
    return {
      category: 'NeedsManualReview',
      reason: 'parent-fetch-not-performed: defensive fallback (snapshot.parent === null but parentDocumentId exists)',
    };
  }

  const parentOk =
    snapshot.parent.exists === true && snapshot.parent.originalPdfExists === true;

  if (snapshot.childObjectExists && parentOk) {
    return {
      category: 'MatchedByHash',
      reason: 'structural-prediction: child object + parent doc + original PDF all present; Phase B will verify with hash compute',
    };
  }

  if (!snapshot.childObjectExists && parentOk) {
    return {
      category: 'RepairableMissingFile',
      reason: 'child-orphan: child object missing in Storage; parent doc + original PDF available for regenerate-from-parent',
    };
  }

  if (snapshot.childObjectExists && !parentOk) {
    return {
      category: 'Ambiguous',
      reason: buildAmbiguousReason(snapshot.parent),
    };
  }

  // !childObjectExists && !parentOk
  return {
    category: 'LostOrUnrecoverable',
    reason: buildLostReason(snapshot.parent),
  };
}

function buildAmbiguousReason(
  parent: { exists: true; originalPdfExists: boolean } | { exists: false }
): string {
  if (parent.exists === false) {
    return 'child object exists but parent doc not found in Firestore; cannot verify provenance';
  }
  // parent.exists === true && parent.originalPdfExists === false
  return 'child object exists but parent original PDF missing in Storage; cannot verify provenance';
}

function buildLostReason(
  parent: { exists: true; originalPdfExists: boolean } | { exists: false }
): string {
  if (parent.exists === false) {
    return 'child orphan + parent doc not found in Firestore; cannot regenerate';
  }
  // parent.exists === true && parent.originalPdfExists === false
  return 'child orphan + parent doc exists but parent original PDF missing in Storage; cannot regenerate';
}
