/**
 * BE feature flag 読取ヘルパー(kanameone現場要件「複数顧客FAX複製機能」、GOAL.md D3)
 *
 * OCR取込はscheduled/background関数でありrequestコンテキストを持たないため、
 * Firestore設定ドキュメントを直接参照するfail-closed設計にする。フラグ未設定・
 * ドキュメント不在時は既定OFF(複製機能を発火させない安全側デフォルト、
 * kanameoneのみ明示ONを想定。cocoroはOFFのまま展開)。
 */
import * as admin from 'firebase-admin';

export const FEATURE_FLAGS_DOC_PATH = 'settings/features';

/**
 * 複数顧客FAX複製機能が有効かどうかを返す。
 * フラグドキュメントが存在しない場合、またはfaxDuplicationが明示的にtrueでない
 * 場合は「無効」を安全側デフォルトとする。
 */
export async function isFaxDuplicationEnabled(
  db: admin.firestore.Firestore
): Promise<boolean> {
  const snap = await db.doc(FEATURE_FLAGS_DOC_PATH).get();
  if (!snap.exists) return false;
  return snap.data()?.faxDuplication === true;
}
