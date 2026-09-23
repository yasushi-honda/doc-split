/**
 * Issue #1028(ADR-0028): drive.file→driveフルスコープ拡張後に検出可能になる、
 * 「人が手動作成したフォルダ」と「appが作成したフォルダ」が同一parent+nameで
 * 並存する重複(以下「兄弟重複」)を統合するPlan/Approval/Manifestの型定義。
 *
 * Issue #811(`scripts/lib/folderMergePlanTypes.ts`)とは別の型モジュールとして
 * 新設する。#811版は「ケアマネ直下のcanonicalフォルダ + 既にtrashed済みの
 * duplicateフォルダ群」を前提にしており、本件(activeな2フォルダが任意の階層で
 * 衝突する)とは前提が異なるため、既存型を無理に流用せず独立させた
 * (plan-crossreview、codex Medium指摘対応)。
 *
 * 統合方針(decision-maker承認済み): 人が作った側(docSplitFolderClaimタグ無し)を
 * canonical(残す側)、appが作った側(タグ有り)をduplicate(統合して消える側)とする。
 * 自動統合の対象は「parent+nameが一致するactiveフォルダが2件、うちタグ無し
 * ちょうど1件・タグ有りちょうど1件、かつduplicate側に子フォルダが無い」場合のみ
 * (Medium指摘#13: タグ不在だけでは証明にならないため、判定条件を厳格に絞る)。
 * それ以外は全てmanual-reviewとし、自動処理しない。
 */

export const SIBLING_DUPLICATE_PLAN_SCHEMA_VERSION = 'sibling-duplicate-plan-v1' as const;
export type SiblingDuplicatePlanSchemaVersion = typeof SIBLING_DUPLICATE_PLAN_SCHEMA_VERSION;

export type SiblingGroupAction = 'merge' | 'manual-review';

/** audit時点・execute直前の再取得のいずれでも使う、フォルダ1件分のスナップショット。 */
export interface FolderSnapshot {
  id: string;
  parentId: string;
  name: string;
  trashed: boolean;
  modifiedTime: string;
  hasClaimTag: boolean;
  /** 直下の子フォルダ数(mimeType=folder, trashed=false)。duplicate側は0でなければmanual-review。 */
  childFolderCount: number;
  /** 直下の子ファイル数(mimeType!=folder, trashed=false)。参考情報(承認画面表示用)。 */
  childFileCount: number;
}

export interface SiblingGroup {
  groupId: string;
  parentId: string;
  /** 表示用の完全パス(祖先フォルダ名を辿って構築、承認画面での目視確認用)。 */
  parentPath: string;
  name: string;
  /** このparent+nameで見つかったactiveフォルダ全件(2件以上)。 */
  folders: FolderSnapshot[];
  action: SiblingGroupAction;
  reason: string;
  /** action==='merge'の場合のみ非null。 */
  canonicalFolderId: string | null;
  duplicateFolderId: string | null;
}

export interface SiblingDuplicatePlanSummary {
  scannedFolderCount: number;
  groupCount: number;
  byAction: Record<SiblingGroupAction, number>;
}

export interface SiblingDuplicatePlan {
  schemaVersion: SiblingDuplicatePlanSchemaVersion;
  planId: string;
  createdAt: string;
  environment: string;
  projectId: string;
  rootFolderId: string;

  /** driveApiVersionGate.tsのDriveApiVersionSnapshotをそのまま埋め込む(#811と同型のgate)。 */
  googleapisLockfileVersion: string;
  lockfileHash: string;

  summary: SiblingDuplicatePlanSummary;
  groups: SiblingGroup[];
}

/** Operator承認(--approval JSON)。groupId単位で承認する(#811のapprovedOperationIdsと同型)。 */
export interface SiblingDuplicateApproval {
  planId: string;
  approvedGroupIds: string[];
}

export function buildGroupId(parentId: string, name: string): string {
  return `${parentId}:${name}`;
}

/**
 * execute直前の再照合(fencing、codex High#8対応)。audit時点のスナップショットと
 * 実行直前に再取得したライブ状態を比較し、drift(手動変更・想定外の状態変化)が
 * あればfail-closedでskipする。
 */
export function verifySiblingGroupFingerprint(
  plan: { canonical: FolderSnapshot; duplicate: FolderSnapshot },
  live: { canonical: FolderSnapshot; duplicate: FolderSnapshot }
): { ok: true } | { ok: false; reason: string } {
  if (live.canonical.id !== plan.canonical.id) {
    return { ok: false, reason: `canonical folder id mismatch (plan=${plan.canonical.id}, live=${live.canonical.id})` };
  }
  if (live.canonical.parentId !== plan.canonical.parentId || live.canonical.name !== plan.canonical.name) {
    return { ok: false, reason: 'canonical folderのparent/nameがaudit時点と異なる(手動で移動/改名された可能性)' };
  }
  if (live.canonical.trashed) {
    return { ok: false, reason: 'canonical folderがtrashed状態になっている' };
  }
  if (live.canonical.modifiedTime !== plan.canonical.modifiedTime) {
    return { ok: false, reason: 'canonical folderのmodifiedTimeがaudit時点と異なる(drift検知)' };
  }
  if (live.duplicate.id !== plan.duplicate.id) {
    return { ok: false, reason: `duplicate folder id mismatch (plan=${plan.duplicate.id}, live=${live.duplicate.id})` };
  }
  if (live.duplicate.parentId !== plan.duplicate.parentId || live.duplicate.name !== plan.duplicate.name) {
    return { ok: false, reason: 'duplicate folderのparent/nameがaudit時点と異なる(手動で移動/改名された可能性)' };
  }
  if (live.duplicate.modifiedTime !== plan.duplicate.modifiedTime) {
    return { ok: false, reason: 'duplicate folderのmodifiedTimeがaudit時点と異なる(drift検知)' };
  }
  if (live.duplicate.childFolderCount > 0) {
    return { ok: false, reason: 'duplicate folder配下に子フォルダが新たに存在する(同名衝突リスク)' };
  }
  return { ok: true };
}

/**
 * execute直前の再取得結果から「このグループは既に統合済み(再実行時のスキップ対象)」を
 * 判定する(codex Medium指摘: 部分成功からの再実行を安全にするための冪等性チェック)。
 * duplicate folderが404(取得不能)またはtrashed済みなら、既に統合完了済みとみなす。
 */
export function isGroupAlreadyMerged(duplicateLive: { trashed: boolean } | null): boolean {
  return duplicateLive === null || duplicateLive.trashed === true;
}
