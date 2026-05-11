/**
 * Issue #432 PR-C: 衝突 doc / fileUrl 孤児の信頼度付き 4 分類 pure function
 *
 * 4 分類: MatchedByHash / Ambiguous / RepairableMissingFile / LostOrUnrecoverable
 * (LikelyWinner は Ambiguous 内 suggestedWinner hint に降格 = 設計案からの統合)。
 *
 * 設計判断 (Codex セカンドオピニオン 2026-05-11 反映):
 *   - hash 一致確定のみ自動移行 (MatchedByHash)
 *   - rotatedAt!=null 唯一による LikelyWinner 自動移行は禁止 (silent breakage 偽装復旧の再演リスク)
 *     → Ambiguous 内 suggestedWinner hint に降格
 *   - hash 不能 / 不一致 / 複数一致は全て Ambiguous (manual-review)
 *   - orphan + parent + splitFromPages + 親 PDF 実在 → RepairableMissingFile (auto regenerate)
 *   - 衝突 group 内の「敗者」doc も同条件で RepairableMissingFile に分類 (Codex 推奨: 復旧率最大化)
 *   - hash unavailable.reason='computation-error' (transient 503/403) は parent 在でも
 *     RepairableMissingFile / LostOrUnrecoverable に降格させず Ambiguous に留める (F-B3)
 *   - 復元不能は LostOrUnrecoverable (status:'error' + lastErrorMessage で manual repair 誘導)
 *
 * Partial update 不変 (CLAUDE.md MUST): mark-error action は status / lastErrorMessage のみ更新、
 * 他フィールド (fileName, parentDocumentId, ocrExtraction 等) は不変。
 */

export interface CollisionDoc {
  id: string;
  status: string;
  fileName: string;
  fileUrl: string | null;
  parentDocumentId: string | null;
  splitFromPages: { start: number; end: number } | null;
  rotatedAt: string | null;
  processedAt: string | null;
  updatedAt: string | null;
}

/**
 * doc 1 件分の事前評価結果。caller (classify-collision-docs.ts) が:
 *   - hashEvidence: Storage 実体 sha256 と「親 PDF + splitFromPages から再生成した期待 sha256」の比較結果
 *   - parent: parentDocumentId の有無 + 親 doc 存在 + 元 PDF 実在
 * を Firestore / Storage アクセスで埋め、本 classifier (pure) に渡す。
 */
export interface DocEvidence {
  doc: CollisionDoc;
  hashEvidence:
    | { type: 'matched'; sha256: string }
    | { type: 'mismatched'; actualSha256: string; expectedSha256: string }
    | {
        type: 'unavailable';
        reason:
          | 'no-parent'
          | 'no-parent-original-pdf'
          | 'no-storage-actual'
          | 'computation-error';
      };
  parent:
    | { exists: true; originalPdfExists: boolean }
    | { exists: false }
    | null;
}

/**
 * 衝突 group: 同 fileName を共有する doc 群 (1 件単独 group も含む)。
 * orphan (Storage 実体なし) は別経路 classifyOrphan で扱う。
 */
export interface CollisionGroup {
  fileName: string;
  evidences: DocEvidence[];
}

export type Classification =
  | 'MatchedByHash'
  | 'Ambiguous'
  | 'RepairableMissingFile'
  | 'LostOrUnrecoverable';

export type RecommendedAction =
  | 'migrate-to-namespace'
  | 'regenerate-from-parent'
  | 'manual-review'
  | 'mark-error';

export interface ClassificationResult {
  docId: string;
  classification: Classification;
  reason: string;
  /**
   * Ambiguous 内で「勝者候補」を示す低信頼 hint (rotatedAt!=null 唯一など)。
   * recommendedAction は manual-review 固定で、自動 destructive action には使わない。
   */
  suggestedWinner: boolean;
  recommendedAction: RecommendedAction;
}

/**
 * 衝突 group 内の各 doc を分類する。
 *
 * ロジック (各 doc の戻り値 classification + recommendedAction):
 *   1. hash matched が group 内で一意:
 *      - 勝者 → MatchedByHash + migrate-to-namespace (自動 Storage move)
 *      - 敗者 → 親 + splitFromPages + 親 PDF 実在なら RepairableMissingFile + regenerate-from-parent
 *               (= 親から再生成、敗者の Storage 実体は勝者と別物のため上書き再生成で復旧)、
 *               不能なら LostOrUnrecoverable + mark-error
 *   2. hash matched が複数 → 全員 Ambiguous + manual-review (どれが正しい page bytes か断定不能)
 *   3. hash matched なし → 全員 Ambiguous + manual-review (rotatedAt 唯一性で 1 件 suggestedWinner hint、
 *      ただし hint は operator 参考情報であり自動 destructive action には使わない = Codex Critical)
 *   4. hash mismatched / unavailable のみの group → 上記 3 と同じ
 *
 * 1 件単独 group (collision なし) でも本関数を通せる。
 */
export function classifyCollisionGroup(
  group: CollisionGroup
): ClassificationResult[] {
  const matchedDocIds = group.evidences
    .filter((e) => e.hashEvidence.type === 'matched')
    .map((e) => e.doc.id);

  // ケース 1: hash matched が一意 → 自動 migrate (敗者は再生成 or LostOrUnrecoverable)
  if (matchedDocIds.length === 1) {
    const winnerId = matchedDocIds[0];
    return group.evidences.map((e) =>
      e.doc.id === winnerId
        ? {
            docId: e.doc.id,
            classification: 'MatchedByHash' as const,
            reason: 'sha256(actual storage bytes) == sha256(regenerated from parent + splitFromPages)',
            suggestedWinner: false,
            recommendedAction: 'migrate-to-namespace' as const,
          }
        : classifyLoserForRegeneration(e, /* hasUniqueWinner */ true)
    );
  }

  // ケース 2: hash matched が複数 → 全員 Ambiguous (どれを勝者とすべきか断定不能)
  if (matchedDocIds.length >= 2) {
    return group.evidences.map((e) => ({
      docId: e.doc.id,
      classification: 'Ambiguous' as const,
      reason: `multiple hash matches in group (${matchedDocIds.length} docs claim ownership of same storage bytes)`,
      suggestedWinner: e.hashEvidence.type === 'matched',
      recommendedAction: 'manual-review' as const,
    }));
  }

  // ケース 3: hash matched なし (mismatched / unavailable のみ)
  // → 全員 Ambiguous、rotatedAt!=null 唯一 doc には suggestedWinner hint (低信頼)
  const rotatedDocs = group.evidences.filter((e) => e.doc.rotatedAt !== null);
  const hasUniqueRotatedHint = rotatedDocs.length === 1;
  const suggestedHintDocId = hasUniqueRotatedHint ? rotatedDocs[0].doc.id : null;

  return group.evidences.map((e) => ({
    docId: e.doc.id,
    classification: 'Ambiguous' as const,
    reason: buildAmbiguousReason(e),
    suggestedWinner: e.doc.id === suggestedHintDocId,
    recommendedAction: 'manual-review' as const,
  }));
}

/**
 * fileUrl 孤児 (Storage 実体なし) を分類する。
 *
 * - hash unavailable.reason='computation-error' (transient 503/403): parent 在でも
 *   一旦 Ambiguous + manual-review に留める (F-B3 反映、actual 取得失敗を Lost に流さない)
 * - parent + splitFromPages + 親 PDF 実在 → RepairableMissingFile + regenerate-from-parent
 * - 上記以外 → LostOrUnrecoverable + mark-error (status:'error' 誘導)
 */
export function classifyOrphan(evidence: DocEvidence): ClassificationResult {
  const { doc, parent } = evidence;

  // F-B3: transient error (computation-error) は Lost に降格させず Ambiguous に留める
  if (isComputationError(evidence)) {
    return {
      docId: doc.id,
      classification: 'Ambiguous',
      reason: 'hash comparison unavailable due to transient error; defer to manual-review',
      suggestedWinner: false,
      recommendedAction: 'manual-review',
    };
  }

  if (
    doc.parentDocumentId !== null &&
    doc.splitFromPages !== null &&
    parent !== null &&
    parent.exists &&
    parent.originalPdfExists
  ) {
    return {
      docId: doc.id,
      classification: 'RepairableMissingFile',
      reason: 'fileUrl orphan; parent doc + splitFromPages + parent original PDF all available',
      suggestedWinner: false,
      recommendedAction: 'regenerate-from-parent',
    };
  }

  return {
    docId: doc.id,
    classification: 'LostOrUnrecoverable',
    reason: buildLostReason(doc, parent),
    suggestedWinner: false,
    recommendedAction: 'mark-error',
  };
}

/**
 * 衝突 group 内の「勝者以外」doc を分類する (Codex 推奨: 復旧率最大化のため敗者も自動再生成).
 *
 * - hash unavailable.reason='computation-error' は Ambiguous に留める (F-B3、Lost に流さない)
 * - parent + splitFromPages + 親 PDF 実在 → RepairableMissingFile + regenerate-from-parent
 *   (敗者の Storage 実体は勝者と別物のため、親から再生成して上書き)
 * - 不能 → LostOrUnrecoverable + mark-error
 *
 * 注意: pending 化は OCR 再処理キューを壊す (processOCR が pending を拾う) ため、
 * 敗者 doc の status は 'processed' のまま fileUrl のみ新 docId namespace path に
 * 切り替える (regenerate-from-parent action 内で実装)。
 */
function classifyLoserForRegeneration(
  evidence: DocEvidence,
  hasUniqueWinner: boolean
): ClassificationResult {
  // F-B3: transient error は Lost に降格させない
  if (isComputationError(evidence)) {
    return {
      docId: evidence.doc.id,
      classification: 'Ambiguous',
      reason: 'collision group loser; hash comparison unavailable due to transient error; defer to manual-review',
      suggestedWinner: false,
      recommendedAction: 'manual-review',
    };
  }

  if (
    evidence.doc.parentDocumentId !== null &&
    evidence.doc.splitFromPages !== null &&
    evidence.parent !== null &&
    evidence.parent.exists &&
    evidence.parent.originalPdfExists
  ) {
    return {
      docId: evidence.doc.id,
      classification: 'RepairableMissingFile',
      reason: hasUniqueWinner
        ? 'collision group loser; winner identified by hash, this doc has different content; parent + original PDF available for regeneration'
        : 'collision group; parent + original PDF available for regeneration',
      suggestedWinner: false,
      recommendedAction: 'regenerate-from-parent',
    };
  }

  return {
    docId: evidence.doc.id,
    classification: 'LostOrUnrecoverable',
    reason: buildLostReason(evidence.doc, evidence.parent),
    suggestedWinner: false,
    recommendedAction: 'mark-error',
  };
}

function isComputationError(evidence: DocEvidence): boolean {
  return (
    evidence.hashEvidence.type === 'unavailable' &&
    evidence.hashEvidence.reason === 'computation-error'
  );
}

function buildAmbiguousReason(evidence: DocEvidence): string {
  switch (evidence.hashEvidence.type) {
    case 'mismatched':
      return `hash mismatch: actual storage bytes != regenerated from parent + splitFromPages`;
    case 'unavailable':
      return `hash comparison unavailable: ${evidence.hashEvidence.reason}`;
    case 'matched':
      // この path は ケース 2 (multiple matches) でのみ到達するが defensive に
      return 'hash matched but multiple winners in group';
  }
}

function buildLostReason(
  doc: CollisionDoc,
  parent: DocEvidence['parent']
): string {
  if (doc.parentDocumentId === null) {
    return 'no parentDocumentId; cannot regenerate from split source';
  }
  if (doc.splitFromPages === null) {
    return 'no splitFromPages; cannot determine page range to regenerate';
  }
  if (parent === null || !parent.exists) {
    return `parent doc (${doc.parentDocumentId}) not found; cannot regenerate`;
  }
  if (!parent.originalPdfExists) {
    return `parent doc exists but parent original PDF not in Storage; cannot regenerate`;
  }
  return 'unknown lost reason';
}
