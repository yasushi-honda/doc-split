/**
 * 集計所属変更メンテナンスゲート
 *
 * GOAL.md タスクG(担当CM別集計バックフィル)の並行更新競合対策。documentsの
 * customerKey/careManagerKey/status等、documentGroupsの集計対象に影響するフィールドを
 * 確定させる書込み経路(OCR完了・split・顧客マスター同期)を一時停止するためのフラグ。
 *
 * Gmail取込によるpending文書作成(customerKeyがまだ空の段階)はこのゲートの対象外
 * (isAggregationUnchanged()の不変条件により、customerKey未確定な書込みは元々
 * documentGroupsへの副作用を持たないため、止める必要がない)。
 *
 * `/codex plan`セカンドオピニオン(session131)で、processedAt cutoff境界や
 * syncCareManagerのみの部分停止では並行更新レースを防げないと判明したため、
 * 集計所属を変えうる書込み経路全体をこのゲートで一括制御する設計にした。
 */
import * as admin from 'firebase-admin';

export const MAINTENANCE_FLAGS_DOC_PATH = 'system/maintenanceFlags';

/**
 * ゲートが開いている(通常運用中)かどうかを返す。
 * フラグドキュメントが存在しない場合、またはgroupAggregationGateOpenが
 * 明示的にfalseでない場合は「開いている」を安全側デフォルトとする。
 */
export async function isGroupAggregationGateOpen(
  db: admin.firestore.Firestore
): Promise<boolean> {
  const snap = await db.doc(MAINTENANCE_FLAGS_DOC_PATH).get();
  if (!snap.exists) return true;
  return snap.data()?.groupAggregationGateOpen !== false;
}
