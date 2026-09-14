/**
 * BE feature flag 読取ヘルパー(kanameone現場要件「複数顧客FAX複製機能」、GOAL.md D3)
 *
 * OCR取込はscheduled/background関数でありrequestコンテキストを持たないため、
 * Firestore設定ドキュメントを直接参照するfail-closed設計にする。フラグ未設定・
 * ドキュメント不在時は既定OFF(複製機能を発火させない安全側デフォルト、
 * kanameoneのみ明示ONを想定。cocoroはOFFのまま展開)。
 */
import * as admin from 'firebase-admin';
import { PADDLE_OCR_CONFIG, type OcrProvider } from './config';

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
 * 複数人記載検出機能(kanameone現場要件、PR-A「複数人記載FAX: 複製廃止→検出バッジへの置換」、
 * 2026-08-30)が有効かどうかを返す。`faxDuplication`(人数分複製)とは意図的に別フラグにして
 * いる: 両方ONの「併走ステージ」(複製ONのまま検出だけONにして本番データで検出集合==複製
 * 発火集合を実測する)を作れるようにするため。フラグドキュメントが存在しない場合、または
 * multiCustomerDetectionが明示的にtrueでない場合は「無効」を安全側デフォルトとする
 * (fail-closed、kanameoneのみ明示ONを想定)。
 */
export async function isMultiCustomerDetectionEnabled(
  db: admin.firestore.Firestore
): Promise<boolean> {
  const snap = await db.doc(FEATURE_FLAGS_DOC_PATH).get();
  if (!snap.exists) return false;
  return snap.data()?.multiCustomerDetection === true;
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

  // フィールドが「存在しない」場合のみ制限なし(null)とする。フィールドが存在するが
  // 値がnull(コンソール誤操作等)の場合は、undefinedと`==null`で同一視すると
  // fail-closed方針から漏れてしまうため、不正値と同じくfail-closed側(空配列)へ倒す
  // (codex review P1指摘対応、2026-07-23)。
  if (!data || !('driveExportAllowlist' in data)) {
    return { enabled, allowlist: null };
  }
  const rawAllowlist = data.driveExportAllowlist;
  if (!Array.isArray(rawAllowlist) || rawAllowlist.some((v) => typeof v !== 'string')) {
    console.error(
      `[featureFlags] driveExportAllowlist が不正な形式です(配列/文字列以外): ${JSON.stringify(rawAllowlist)}。fail-closedで全docId拒否として扱います。`
    );
    return { enabled, allowlist: [] };
  }
  return { enabled, allowlist: rawAllowlist as string[] };
}

/**
 * Drive フォルダclaimプロトコル(Issue #871、`driveFolderClaim.ts`)の読み経路が
 * 有効かどうかを返す。書き込み(claim記録)は常時行う(shadowモード、既存挙動へ
 * 影響ゼロ)。このフラグは「記録済みclaimを信用して`files.list`をスキップ/
 * 短絡してよいか」だけを制御する。フラグドキュメントが存在しない場合、または
 * driveFolderClaimReadが明示的にtrueでない場合は「無効」を安全側デフォルトとする
 * (fail-closed、段階導入の既定はshadow)。
 */
export async function isDriveFolderClaimReadEnabled(
  db: admin.firestore.Firestore
): Promise<boolean> {
  const snap = await db.doc(FEATURE_FLAGS_DOC_PATH).get();
  if (!snap.exists) return false;
  return snap.data()?.driveFolderClaimRead === true;
}

export interface PaddleOcrGate {
  enabled: boolean;
  /**
   * null: フィールド不在 = 制限なし(全docIdが対象、devの全展開挙動)。
   * string[]: このdocIdのみPaddleOCRへ切替許可(空配列は「全docId拒否」の意味、canary準備用)。
   * 不正値(非配列・非string混在)はfail-closedで空配列扱い(全docId拒否)にする。
   */
  allowlist: string[] | null;
}

/**
 * ADR-0025 Pass1切替(`OCR_PROVIDER=paddle`をL1として選択した上での)L2ゲート
 * (flag + 許可リスト)を単一snapshotで返す。`getDriveExportGate`と同型
 * (`driveExport`→`paddleOcr`、`driveExportAllowlist`→`paddleOcrAllowlist`)。
 *
 * フラグドキュメントが存在しない場合、またはpaddleOcrが明示的にtrueでない場合は
 * 「無効」を安全側デフォルトとする(fail-closed、段階導入の既定はGemini継続)。
 */
export async function getPaddleOcrGate(
  db: admin.firestore.Firestore
): Promise<PaddleOcrGate> {
  const snap = await db.doc(FEATURE_FLAGS_DOC_PATH).get();
  const data = snap.data();
  const enabled = data?.paddleOcr === true;

  if (!data || !('paddleOcrAllowlist' in data)) {
    return { enabled, allowlist: null };
  }
  const rawAllowlist = data.paddleOcrAllowlist;
  if (!Array.isArray(rawAllowlist) || rawAllowlist.some((v) => typeof v !== 'string')) {
    console.error(
      `[featureFlags] paddleOcrAllowlist が不正な形式です(配列/文字列以外): ${JSON.stringify(rawAllowlist)}。fail-closedで全docId拒否として扱います。`
    );
    return { enabled, allowlist: [] };
  }
  return { enabled, allowlist: rawAllowlist as string[] };
}

/**
 * ドキュメント単位のOCR Pass1プロバイダを解決する(ADR-0025)。
 *
 * L1(環境変数`OCR_PROVIDER`)とL2(Firestoreフラグ+許可リスト)の2層構造。
 * どちらもGemini側にfail-closed: L1が'paddle'でない場合は即座に'gemini'、
 * L2の`paddleOcr`フラグが無効、または許可リストが存在しdocIdを含まない場合も'gemini'。
 * 呼出元(ocrProcessor.ts)はドキュメント処理開始直後に1回だけ呼び出す。
 *
 * silent-failure-hunterレビュー指摘: 上記「fail-closed」は判定ロジック自体の既定値の話であり、
 * `getPaddleOcrGate`内のFirestore read自体はtry/catchしていない(既存の`isFaxDuplicationEnabled`
 * 等の他フラグ取得関数と同じ規約)。read失敗時は例外がそのまま呼出元(processDocument)へ
 * 伝播し、ドキュメント処理全体がerror状態になる(geminiへ静かにフォールバックするわけではない)。
 * 「間違ったエンジンを黙って選ぶ」より「処理全体を明示的に失敗させる」方を安全側とする、
 * このプロジェクトのsilent-failure回避方針との整合を優先した意図的な挙動。
 *
 * `l1Provider`はテスト専用の注入口(既定は本番同様`PADDLE_OCR_CONFIG.provider`を使う、
 * paddleOcrClient.tsのdeps注入と同じ規約)。`PADDLE_OCR_CONFIG`はモジュール読み込み時に
 * 一度だけ評価される定数のため、これが無いとL1='paddle'側のL2合成ロジック(このpr-test-analyzer
 * 指摘対応)がテストスイート内で一度も実行されない。
 */
export async function resolveOcrProvider(
  db: admin.firestore.Firestore,
  docId: string,
  l1Provider: OcrProvider = PADDLE_OCR_CONFIG.provider
): Promise<OcrProvider> {
  if (l1Provider !== 'paddle') return 'gemini';

  const gate = await getPaddleOcrGate(db);
  if (!gate.enabled) return 'gemini';
  if (gate.allowlist !== null && !gate.allowlist.includes(docId)) return 'gemini';
  return 'paddle';
}
