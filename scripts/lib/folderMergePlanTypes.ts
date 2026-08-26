/**
 * Issue #811 Phase B: Google Drive フォルダ重複統合(folder merge)の Plan/Operation/Approval
 * 共通型定義(schemaVersion v1)。
 *
 * `scripts/lib/collisionPlanTypes.ts`(Issue #432 PDF/Storage衝突移行フレームワーク、
 * 実装済み)の設計(schemaVersion literal reject・precondition snapshot・
 * action↔provenanceRequired invariant・2-phase preflight前提)を、Google Driveの
 * フォルダ/ファイル移動というドメインに移植する。
 *
 * PDF/Storage版との主な差分(4回のcodex独立診断で確定した要件):
 *  - PDF版のhashAlgorithm/pdfLibVersion/lockfileHash(pdf-lib fingerprint再現性の保証)は
 *    Driveのmove/rename/untrashには不要。代わりに`driveApiVersionGate.ts`でgoogleapis
 *    パッケージ版数を照合する(classify/execute間のライブラリ差分検知)。
 *  - PDF版のparentPdfProvenance(sha256による親PDF不変性証明)の代わりに、
 *    `folderProvenance.ts`でDrive file自体の`version`/`md5Checksum`/`headRevisionId`を
 *    照合する(再生成ではなく移動のため、ダウンロード不要で軽量)。
 *  - precondition snapshotをDrive側(parents/trashed/name)とFirestore側
 *    (careManager/customerName/documentCategory/fileDate等のハッシュ)の**両方**に
 *    拡張した。PDF版はFirestore側drift検知を持たない(collision版はFirestore documentの
 *    fileUrl/status/updatedAtのみを見る設計だったため、ケアマネ担当替え等のドメイン固有の
 *    drift概念自体が存在しなかった)。
 *  - `regenerate-from-parent`相当のaction(PDF再生成)は不要。原本のDriveファイル自体は
 *    消えていないため、actionは`move-to-canonical`と`manual-review`の2種のみ。
 */

import crypto from 'crypto';

/**
 * 現在のplan schema version。execute-drive-folder-merge.tsはliteral比較で
 * `'folder-merge-plan-v1'`以外をexit 2でrejectする。
 */
export const FOLDER_MERGE_PLAN_SCHEMA_VERSION = 'folder-merge-plan-v1' as const;
export type FolderMergePlanSchemaVersion = typeof FOLDER_MERGE_PLAN_SCHEMA_VERSION;

export type Classification = 'ConfirmedMatch' | 'ManualReviewRequired';

export type RecommendedAction = 'move-to-canonical' | 'manual-review';

/**
 * action ↔ provenanceRequired の組合せ invariant。
 *   - 'move-to-canonical' → provenanceRequired === true (destructive、folderProvenance必須)
 *   - 'manual-review'     → provenanceRequired === false (何も実行しない)
 * plan改竄で`manual-review + provenanceRequired:true`のような不整合を作っても
 * execute側Gateでrejectされる(collision版のGate8と同型)。
 */
export const PROVENANCE_REQUIRED_BY_ACTION: Record<RecommendedAction, boolean> = {
  'move-to-canonical': true,
  'manual-review': false,
};

export function verifyActionProvenanceInvariant(
  action: RecommendedAction,
  provenanceRequired: boolean
): { ok: true } | { ok: false; reason: string } {
  const expected = PROVENANCE_REQUIRED_BY_ACTION[action];
  if (expected === provenanceRequired) return { ok: true };
  return {
    ok: false,
    reason: `schema invariant violated: action='${action}' requires provenanceRequired=${expected}, got ${provenanceRequired}`,
  };
}

/**
 * Drive file の identity 確認用 provenance(PDF版のsha256の代わり)。
 * ダウンロード不要、`drive.files.get`のfieldsで一括取得できる。
 *
 * `md5Checksum`はGoogle純正形式(Docs/Sheets/Slides)には存在しない(binary
 * ファイルのみ)。バイナリでないファイルはこのフィールドがnullのままprovenance
 * completeness gateを通す(`verifyFolderProvenanceCompleteness`参照)。
 */
export interface FolderFileProvenance {
  fileId: string;
  /** バイナリファイルのみ非null。Google純正形式はnull。 */
  md5Checksum: string | null;
  /** Drive fileのversion(変更ごとに単調増加)。 */
  version: string;
  /** headRevisionId(バージョン履歴の先頭revision)。取得不能な場合null。 */
  headRevisionId: string | null;
}

/**
 * folderDuplicateClassifier.ts の分類結果と紐づく単一ファイルへの操作。
 */
export interface Operation {
  /** operation識別子(例: `op-0001`) */
  operationId: string;
  /** appProperties.docSplitDocId から解決したFirestore document ID */
  docId: string;
  /** 移動対象のDrive file ID */
  driveFileId: string;
  classification: Classification;
  recommendedAction: RecommendedAction;
  reason: string;

  // ─── precondition snapshot: Drive側(Gate5) ─────────────────────
  expectedParents: string[];
  expectedTrashed: boolean;
  expectedName: string;

  // ─── precondition snapshot: Firestore側(Gate5拡張、PDF版にない新規追加) ──
  /**
   * classify時点のFirestore document(careManager/customerName/documentCategory/
   * documentType/fileDate)から computeFirestoreSnapshotHash() で計算したハッシュ。
   * execute直前に再計算し不一致ならdrift(担当替え・顧客名変更等を検知)。
   * docId解決不能なOperation(manual-review固定)ではnull。
   */
  expectedFirestoreSnapshotHash: string | null;

  // ─── 移動元・移動先 ──────────────────────────────────────────
  /** このファイルが現在属しているduplicateフォルダのID */
  sourceFolderId: string;
  /**
   * canonicalフォルダ配下でこのファイルが本来あるべき階層(customer/documentCategory等、
   * `resolveFolderSegments()`のケアマネセグメント以降の出力)。childFolderResolver.tsが
   * この配列を辿ってfind-or-createする。
   */
  targetSegments: string[];

  // ─── provenance (Gate9相当) ──────────────────────────────────
  provenanceRequired: boolean;
  provenance: FolderFileProvenance | null;
}

export function verifyFolderProvenanceCompleteness(
  provenance: FolderFileProvenance | null
): { ok: true } | { ok: false; reason: string } {
  if (!provenance) {
    return { ok: false, reason: 'provenance missing: null or undefined' };
  }
  if (typeof provenance.fileId !== 'string' || provenance.fileId.length === 0) {
    return { ok: false, reason: 'provenance missing: fileId' };
  }
  if (typeof provenance.version !== 'string' || provenance.version.length === 0) {
    return { ok: false, reason: 'provenance missing: version' };
  }
  // md5Checksum/headRevisionIdはnull許容(Google純正形式/取得不能ケース)なので
  // completeness gateの対象外。値の一致自体は verifyFolderProvenanceMatch で行う。
  return { ok: true };
}

export function verifyFolderProvenanceMatch(
  planProvenance: FolderFileProvenance,
  runtimeProvenance: FolderFileProvenance
): { ok: true } | { ok: false; reason: string } {
  if (planProvenance.fileId !== runtimeProvenance.fileId) {
    return {
      ok: false,
      reason: `fileId mismatch (plan=${planProvenance.fileId}, runtime=${runtimeProvenance.fileId})`,
    };
  }
  if (planProvenance.version !== runtimeProvenance.version) {
    return {
      ok: false,
      reason: `version mismatch (plan=${planProvenance.version}, runtime=${runtimeProvenance.version}); file changed since classify`,
    };
  }
  if (planProvenance.md5Checksum !== runtimeProvenance.md5Checksum) {
    return {
      ok: false,
      reason: `md5Checksum mismatch (plan=${planProvenance.md5Checksum}, runtime=${runtimeProvenance.md5Checksum}); content changed since classify`,
    };
  }
  return { ok: true };
}

/**
 * Firestore側drift検知用ハッシュ。classify時点のdocumentの「配置決定に使うフィールド」を
 * 安定した文字列に固定してsha256する。execute直前に再計算し不一致ならFirestore側drift
 * (担当替え・顧客名変更・書類カテゴリ変更・書類日付変更等)として扱う。
 */
export interface FirestoreSnapshotFields {
  careManager: string;
  customerName: string;
  documentCategory: string;
  documentType: string;
  /** ISO文字列化したfileDate、未設定ならnull */
  fileDateIso: string | null;
}

export function computeFirestoreSnapshotHash(fields: FirestoreSnapshotFields): string {
  const payload = [
    fields.careManager,
    fields.customerName,
    fields.documentCategory,
    fields.documentType,
    fields.fileDateIso ?? '<null>',
  ].join('|');
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

/** classify時点のcanonical/duplicateフォルダのDrive側スナップショット(健全性確認用)。 */
export interface FolderProvenanceSnapshot {
  id: string;
  name: string;
  parents: string[];
  trashed: boolean;
  modifiedTime: string;
  /** classify時点でこのフォルダ配下に見つかった子ファイル数(全ページ列挙後の実数)。 */
  childCountAtClassify: number;
}

export interface PlanSummary {
  /** 全duplicateフォルダの全ページ走査に成功した件数(0 = 完全走査達成)。 */
  scannedSourceFolders: number;
  /**
   * 走査が完全に成功しなかったduplicateフォルダのID一覧(ページ取得失敗・権限不足等)。
   * 1件でも非空ならPlan全体をexit 2で拒否する(codex指摘: 「失敗を集計するだけ」では
   * 未走査subtreeを見逃したまま「統合完了」と誤認するリスクがあるため)。
   */
  unscannedSourceFolderIds: string[];
  totalFilesScanned: number;
  byClassification: Record<Classification, number>;
  byAction: Record<RecommendedAction, number>;
}

export interface Plan {
  schemaVersion: FolderMergePlanSchemaVersion;
  planId: string;
  createdAt: string;
  environment: string;
  projectId: string;

  /** googleapis lockfile version gate(driveApiVersionGate.ts参照) */
  googleapisLockfileVersion: string;
  lockfileHash: string;

  canonicalFolderId: string;
  duplicateFolderIds: string[];
  canonicalProvenance: FolderProvenanceSnapshot;
  sourceFolderProvenance: FolderProvenanceSnapshot[];

  summary: PlanSummary;
  operations: Operation[];
}

/** Operator承認(--approval JSON、execute起動時のGate1/Gate3で照合)。 */
export interface Approval {
  planId: string;
  approvedOperationIds: string[];
  /** `drive://<sourceFolderId>/<driveFileId>` 形式のpath認可(Gate3)。 */
  approvedPaths: string[];
}

export function buildDrivePath(folderId: string, fileId: string): string {
  return `drive://${folderId}/${fileId}`;
}
