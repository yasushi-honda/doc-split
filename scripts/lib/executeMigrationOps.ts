/**
 * Issue #432 PR-C: execute-collision-migration.ts の update field 構築を pure 関数化 (F-D2)
 *
 * Partial update 不変 (CLAUDE.md MUST) を testable にするため、各 execute action の
 * Firestore update payload 構築をここに集約。caller (execute-collision-migration.ts) は
 * `db.doc(...).update(buildMigrateUpdatePayload(...))` の形で呼ぶことで、update key set が
 * 仕様通り (fileUrl のみ / fileUrl + status + lastErrorMessage / status + lastErrorMessage)
 * であることを test で固定できる。
 */

import * as admin from 'firebase-admin';

/** migrate-to-namespace: fileUrl のみ更新 (他フィールド不変) */
export function buildMigrateUpdatePayload(
  newFileUrl: string
): Record<string, string> {
  return { fileUrl: newFileUrl };
}

/**
 * regenerate-from-parent: fileUrl + status + lastErrorMessage 削除
 * (orphan 由来で error 化した doc も processed に回復)
 */
export function buildRegenerateUpdatePayload(
  newFileUrl: string
): Record<string, string | admin.firestore.FieldValue> {
  return {
    fileUrl: newFileUrl,
    status: 'processed',
    lastErrorMessage: admin.firestore.FieldValue.delete(),
  };
}

/** mark-error: status + lastErrorMessage のみ (Storage 触らない、最小 partial update) */
export function buildMarkErrorUpdatePayload(
  reason: string
): Record<string, string> {
  return {
    status: 'error',
    lastErrorMessage: `Issue #432 PR-C migration: ${reason}`,
  };
}

/** Partial update 不変検証用の expected key set (CLAUDE.md MUST 準拠) */
export const EXPECTED_UPDATE_KEYS = {
  migrate: ['fileUrl'] as const,
  regenerate: ['fileUrl', 'status', 'lastErrorMessage'] as const,
  markError: ['status', 'lastErrorMessage'] as const,
};
