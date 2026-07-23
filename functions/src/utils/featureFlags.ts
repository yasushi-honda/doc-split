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

/**
 * Google Drive連携機能(ADR-0022)が有効かどうかを返す。
 * フラグドキュメントが存在しない場合、またはdriveExportが明示的にtrueでない
 * 場合は「無効」を安全側デフォルトとする(fail-closed、Drive API呼び出しを起動させない)。
 */
export async function isDriveExportEnabled(
  db: admin.firestore.Firestore
): Promise<boolean> {
  const snap = await db.doc(FEATURE_FLAGS_DOC_PATH).get();
  if (!snap.exists) return false;
  return snap.data()?.driveExport === true;
}

export interface DriveExportGate {
  enabled: boolean;
  /**
   * null: フィールド不在 = 制限なし(dev環境の全展開挙動を保持)。
   * string[]: このdocIdのみexport許可(空配列は「全docId拒否」の意味、staging用)。
   * 不正値(非配列・非string混在)はfail-closedで空配列扱い(全docId拒否)にする。
   */
  allowlist: string[] | null;
}

/**
 * Google Drive連携のtrigger専用gate(flag + allowlist)を単一snapshotで返す。
 * `driveExportTrigger.ts`が verify毎に settings/features を2回読むのを避けるため
 * isDriveExportEnabled()とは別に単一read で両方返す(Phase D/E再設計、Codex Finding1対応)。
 *
 * allowlistは意図的にsweep(`driveExportScheduled.ts`)・手動retry(`retryDriveExport.ts`)には
 * 適用しない設計(それらはbackfillの--limitや個別admin操作でスコープ制御される)。
 */
export async function getDriveExportGate(
  db: admin.firestore.Firestore
): Promise<DriveExportGate> {
  const snap = await db.doc(FEATURE_FLAGS_DOC_PATH).get();
  const data = snap.data();
  const enabled = data?.driveExport === true;

  const rawAllowlist = data?.driveExportAllowlist;
  if (rawAllowlist == null) {
    return { enabled, allowlist: null };
  }
  if (!Array.isArray(rawAllowlist) || rawAllowlist.some((v) => typeof v !== 'string')) {
    console.error(
      `[featureFlags] driveExportAllowlist が不正な形式です(配列/文字列以外): ${JSON.stringify(rawAllowlist)}。fail-closedで全docId拒否として扱います。`
    );
    return { enabled, allowlist: [] };
  }
  return { enabled, allowlist: rawAllowlist as string[] };
}
