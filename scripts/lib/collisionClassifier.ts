/**
 * Issue #432 PR-C: 衝突 doc / fileUrl 孤児の信頼度付き 4 分類 pure function
 *
 * 4 分類: MatchedByHash / Ambiguous / RepairableMissingFile / LostOrUnrecoverable
 * (LikelyWinner は Ambiguous 内 suggestedWinner hint に降格 = 設計案からの統合)。
 *
 * PR-C2 (2026-05-12, session60 着手): hash 比較を `sha256(raw PDF bytes)` から
 * `pdf-page-visual-v1` fingerprint 比較に変更 (pdf-lib `PDFDocument.save()` の
 * cross-process non-determinism を回避)。実装は scripts/lib/pdfPageVisualFingerprint.ts。
 *   - DocEvidence.hashEvidence.type='matched' → fingerprint hex が一致 (algorithm 明示)
 *   - DocEvidence.hashEvidence.type='mismatched' → fingerprint hex が異なる
 *   - DocEvidence.hashEvidence.type='unsupported' → PDF が暗号化 / AcroForm 等で fingerprint
 *     算出不能 (PR-C2 で追加)。Ambiguous + manual-review に倒す
 *   - DocEvidence.hashEvidence.type='unavailable' → parent 在不在等で fingerprint 比較に
 *     至らなかった (既存)
 *
 * 設計判断 (Codex セカンドオピニオン 2026-05-11/2026-05-12 反映):
 *   - fingerprint 一致確定のみ自動移行 (MatchedByHash)
 *   - rotatedAt!=null 唯一による LikelyWinner 自動移行は禁止 (silent breakage 偽装復旧の再演リスク)
 *     → Ambiguous 内 suggestedWinner hint に降格
 *   - fingerprint 不能 / 不一致 / 複数一致 / unsupported は全て Ambiguous (manual-review)
 *   - orphan + parent + splitFromPages + 親 PDF 実在 → RepairableMissingFile (auto regenerate)
 *   - 衝突 group 内の「敗者」doc も同条件で RepairableMissingFile に分類 (Codex 推奨: 復旧率最大化)
 *   - hash unavailable.reason='computation-error' (transient 503/403) は parent 在でも
 *     RepairableMissingFile / LostOrUnrecoverable に降格させず Ambiguous に留める (F-B3)
 *   - hashEvidence.type='unsupported' (PR-C2 追加) も同様に Ambiguous に留める (自動再生成
 *     しても fingerprint 比較不能なので gate 通せない)
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
 *   - hashEvidence: Storage 実体の visual fingerprint と「親 PDF + splitFromPages から
 *     再生成した PDF の visual fingerprint」の比較結果 (PR-C2 で sha256(raw bytes) から
 *     visual fingerprint 比較に変更、cross-process determinism を担保)
 *   - parent: parentDocumentId の有無 + 親 doc 存在 + 元 PDF 実在
 * を Firestore / Storage アクセスで埋め、本 classifier (pure) に渡す。
 *
 * `algorithm` は fingerprint アルゴリズムバージョン (例 'pdf-page-visual-v1')。
 * plan JSON の precondition snapshot に記録し、execute 側で固定値と照合して mismatch
 * なら gate reject する (AC13)。
 */
export type FingerprintAlgorithm = 'pdf-page-visual-v1';

export type UnsupportedReason =
  | 'encryption'
  | 'acroform'
  | 'optional-content'
  | 'malformed';

export interface DocEvidence {
  doc: CollisionDoc;
  hashEvidence:
    | { type: 'matched'; fingerprint: string; algorithm: FingerprintAlgorithm }
    | {
        type: 'mismatched';
        actualFingerprint: string;
        expectedFingerprint: string;
        algorithm: FingerprintAlgorithm;
      }
    | {
        type: 'unsupported';
        reason: UnsupportedReason;
        detail: string;
        algorithm: FingerprintAlgorithm;
      }
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
            reason:
              'fingerprint(actual storage, pdf-page-visual-v1) == fingerprint(regenerated from parent + splitFromPages)',
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
      reason: `multiple fingerprint matches in group (${matchedDocIds.length} docs share the same visual fingerprint with the regenerated PDF)`,
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
 * - hashEvidence.type='unsupported' (encryption / acroform / optional-content / malformed,
 *   PR-C2 追加): 同じく Ambiguous + manual-review (PDF 構造ベースの自動復旧不可)
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
      reason: buildUnavailableReason('hash-unavailable-transient'),
      suggestedWinner: false,
      recommendedAction: 'manual-review',
    };
  }

  // PR-C2: unsupported PDF feature (encryption / acroform / optional-content / malformed) も
  // Ambiguous に倒す (fingerprint 比較不能のため自動復旧 gate を通せない)
  if (isUnsupported(evidence)) {
    return {
      docId: doc.id,
      classification: 'Ambiguous',
      reason: buildUnsupportedReason(evidence),
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
      reason: `collision group loser; ${buildUnavailableReason('hash-unavailable-transient')}`,
      suggestedWinner: false,
      recommendedAction: 'manual-review',
    };
  }

  // PR-C2: unsupported は Ambiguous に倒す (fingerprint 比較不能)
  if (isUnsupported(evidence)) {
    return {
      docId: evidence.doc.id,
      classification: 'Ambiguous',
      reason: `collision group loser; ${buildUnsupportedReason(evidence)}`,
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

function isUnsupported(evidence: DocEvidence): boolean {
  return evidence.hashEvidence.type === 'unsupported';
}

/**
 * Codex Suggestion 反映: Ambiguous reason 細分化。operator が manual review 時に
 * 「なぜ Ambiguous か」を即特定できるよう、5 種類のサブカテゴリで返す:
 *   - content-mismatch: actual storage bytes と regenerated の visual fingerprint が異なる
 *   - unsupported-pdf-feature: encryption/acroform/optional-content/malformed
 *   - hash-unavailable-transient: 一時的な download エラー (再試行候補)
 *   - hash-unavailable-no-parent: parent doc または original PDF が見つからない
 *   - multiple-fingerprint-matches: 複数 doc が同じ fingerprint を持つ (希少)
 */
export type AmbiguousReasonKind =
  | 'content-mismatch'
  | 'unsupported-pdf-feature'
  | 'hash-unavailable-transient'
  | 'hash-unavailable-no-parent';

function buildAmbiguousReason(evidence: DocEvidence): string {
  switch (evidence.hashEvidence.type) {
    case 'mismatched':
      return 'content-mismatch: visual fingerprint(actual storage) != visual fingerprint(regenerated from parent + splitFromPages)';
    case 'unsupported':
      return buildUnsupportedReason(evidence);
    case 'unavailable':
      if (evidence.hashEvidence.reason === 'computation-error') {
        return buildUnavailableReason('hash-unavailable-transient');
      }
      return buildUnavailableReason('hash-unavailable-no-parent', evidence.hashEvidence.reason);
    case 'matched':
      // この path は ケース 2 (multiple matches) でのみ到達するが defensive に
      return 'multiple-fingerprint-matches: fingerprint matched but multiple winners in group';
  }
}

function buildUnsupportedReason(evidence: DocEvidence): string {
  if (evidence.hashEvidence.type !== 'unsupported') {
    return 'unsupported-pdf-feature: <unexpected hashEvidence type>';
  }
  return `unsupported-pdf-feature: ${evidence.hashEvidence.reason} (${evidence.hashEvidence.detail})`;
}

function buildUnavailableReason(kind: AmbiguousReasonKind, detail?: string): string {
  return detail ? `${kind}: ${detail}` : kind;
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
