/**
 * Issue #811 Phase B: Google Drive フォルダ重複統合の分類 pure function
 * (`scripts/lib/collisionClassifier.ts`のDrive版)。
 *
 * PDF/Storage衝突フレームワークの「hint出しても自動action禁止」原則を踏襲する:
 * 曖昧・不能・競合・担当替え・複数親・shortcutは全て`manual-review`に倒し、
 * `move-to-canonical`は「安全に自動移動できる」と確信できる場合のみ選ぶ。
 */

export type Classification = 'ConfirmedMatch' | 'ManualReviewRequired';
export type RecommendedAction = 'move-to-canonical' | 'manual-review';

const SHORTCUT_MIME_TYPE = 'application/vnd.google-apps.shortcut';

/** classify-drive-folder-duplicates.ts が集めた1ファイル分の証拠。 */
export interface FileEvidence {
  driveFileId: string;
  name: string;
  mimeType: string;
  parents: string[];
  trashed: boolean;
  /** appProperties.docSplitDocId(未設定ならnull) */
  docSplitDocId: string | null;
  /** docSplitDocIdから解決したFirestore document(存在しない/未紐付けならnull) */
  firestoreDoc: { docId: string; careManagerName: string } | null;
  /** 統合先ケアマネの正規名(canonicalフォルダが表す本来のケアマネ名) */
  targetCareManagerName: string;
  /** 移動先(canonical配下の該当階層)に同一docSplitDocIdのファイルが既に存在するか */
  destinationConflict: boolean;
}

export interface ClassificationResult {
  driveFileId: string;
  classification: Classification;
  reason: string;
  recommendedAction: RecommendedAction;
}

export function classifyDuplicateFile(evidence: FileEvidence): ClassificationResult {
  if (evidence.mimeType === SHORTCUT_MIME_TYPE) {
    return manualReview(evidence, 'shortcut: not a regular file entity, requires manual handling');
  }

  if (evidence.parents.length !== 1) {
    return manualReview(
      evidence,
      `multi-parent: file has ${evidence.parents.length} parents, ambiguous which to remove on move`
    );
  }

  if (evidence.docSplitDocId === null) {
    return manualReview(evidence, 'unlinked: appProperties.docSplitDocId is not set');
  }

  if (evidence.firestoreDoc === null) {
    return manualReview(
      evidence,
      `unresolvable: docSplitDocId=${evidence.docSplitDocId} does not resolve to an existing Firestore document`
    );
  }

  if (evidence.firestoreDoc.careManagerName !== evidence.targetCareManagerName) {
    return manualReview(
      evidence,
      `reassigned: current careManager="${evidence.firestoreDoc.careManagerName}" differs from target="${evidence.targetCareManagerName}" (care manager reassignment since original export; out of Phase B scope per ADR-0022 Decision 7)`
    );
  }

  if (evidence.destinationConflict) {
    return manualReview(
      evidence,
      `conflict: destination already has a file with the same docSplitDocId=${evidence.docSplitDocId}`
    );
  }

  return {
    driveFileId: evidence.driveFileId,
    classification: 'ConfirmedMatch',
    reason:
      'docSplitDocId resolved; careManager matches target; single parent; no destination conflict',
    recommendedAction: 'move-to-canonical',
  };
}

function manualReview(evidence: FileEvidence, reason: string): ClassificationResult {
  return {
    driveFileId: evidence.driveFileId,
    classification: 'ManualReviewRequired',
    reason,
    recommendedAction: 'manual-review',
  };
}
