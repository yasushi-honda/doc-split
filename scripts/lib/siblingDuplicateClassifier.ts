/**
 * Issue #1028(ADR-0028): 兄弟重複グループ(同一parent+nameのactiveフォルダ2件以上)を
 * merge/manual-reviewへ分類する純粋関数。Drive API呼び出しを一切持たないため、
 * fixtureなしで単体テストできる(`functions/test/driveFolderDuplicateClassifier.test.ts`
 * と同型の設計方針)。
 */

import type { FolderSnapshot, SiblingGroupAction } from './siblingDuplicatePlanTypes';

export interface ClassifiedSiblingGroup {
  action: SiblingGroupAction;
  reason: string;
  canonicalFolderId: string | null;
  duplicateFolderId: string | null;
}

export function classifySiblingGroup(folders: FolderSnapshot[]): ClassifiedSiblingGroup {
  if (folders.length < 2) {
    return {
      action: 'manual-review',
      reason: `parent+name一致のactiveフォルダが${folders.length}件しかない(2件以上でグループ化されるべき呼び出し側のバグ疑い)`,
      canonicalFolderId: null,
      duplicateFolderId: null,
    };
  }

  if (folders.length !== 2) {
    return {
      action: 'manual-review',
      reason: `同一parent+nameのactiveフォルダが${folders.length}件あり、自動統合の対象(ちょうど2件)を超える`,
      canonicalFolderId: null,
      duplicateFolderId: null,
    };
  }

  const untagged = folders.filter((f) => !f.hasClaimTag);
  const tagged = folders.filter((f) => f.hasClaimTag);

  if (untagged.length !== 1 || tagged.length !== 1) {
    return {
      action: 'manual-review',
      reason: `docSplitFolderClaimタグ無しのフォルダがちょうど1件ではない(タグ無し${untagged.length}件・タグ有り${tagged.length}件)`,
      canonicalFolderId: null,
      duplicateFolderId: null,
    };
  }

  const canonical = untagged[0];
  const duplicate = tagged[0];

  if (canonical.trashed || duplicate.trashed) {
    return {
      action: 'manual-review',
      reason: '一方がtrashed状態(呼び出し側でactiveのみに絞り込まれるべき)',
      canonicalFolderId: null,
      duplicateFolderId: null,
    };
  }

  if (duplicate.childFolderCount > 0) {
    return {
      action: 'manual-review',
      reason: `統合元(app作成)フォルダ配下に子フォルダが${duplicate.childFolderCount}件あり、同名衝突リスクがあるため自動統合の対象外`,
      canonicalFolderId: null,
      duplicateFolderId: null,
    };
  }

  return {
    action: 'merge',
    reason: 'タグ無し(人作成)1件・タグ有り(app作成)1件・統合元に子フォルダなし',
    canonicalFolderId: canonical.id,
    duplicateFolderId: duplicate.id,
  };
}
