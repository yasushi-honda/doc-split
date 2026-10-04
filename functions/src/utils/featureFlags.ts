/**
 * BE feature flag 読取ヘルパー(kanameone現場要件「複数顧客FAX複製機能」、GOAL.md D3)
 *
 * OCR取込はscheduled/background関数でありrequestコンテキストを持たないため、
 * Firestore設定ドキュメントを直接参照するfail-closed設計にする。フラグ未設定・
 * ドキュメント不在時は既定OFF(複製機能を発火させない安全側デフォルト、
 * kanameoneのみ明示ONを想定。cocoroはOFFのまま展開)。
 */
import * as admin from 'firebase-admin';
import { PADDLE_OCR_CONFIG, type OcrProvider, SARASHINA_SUMMARY_CONFIG, type SummaryProviderSetting } from './config';

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
 *
 * 【PR-B(2026-10-03)以降】OCRの判定(`resolveOcrProvider`)には使われない。全面切替済みで、
 * OCRの倒れ先をpaddleへ反転し、`OCR_PROVIDER`(L1)だけで決まるようにしたため。運用スクリプト
 * (set-paddle-ocr-allowlist等)が参照しているため残置しており、PR-Eで整理する。
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
 * OCR Pass1プロバイダを解決する(ADR-0025)。
 *
 * L1(環境変数`OCR_PROVIDER`)だけで決まる。`gemini`を明示したときだけ'gemini'(緊急手段)、
 * それ以外(未設定・空・未知値・`paddle`)は'paddle'。以前はL2(Firestoreの`paddleOcr`フラグと
 * allowlist)も合成し、どちらかが欠けると無言でGeminiへ倒れる設計だったが、全面切替済みで
 * L2に残る意味は「倒れ先をGeminiにする危険」だけになったため、OCRの判定からは外した
 * (2026-09-23/25に実際に回帰した。顧客データを意図せず外部AIへ送らない方針)。
 * Firestoreを読まない純粋関数なので、呼出元(ocrProcessor.ts)は文書処理開始直後に1回だけ
 * 呼び出し、同一文書内でプロバイダが途中で変わる不整合を防ぐ。
 *
 * `getPaddleOcrGate`と`paddleOcr`フラグは、運用スクリプト(set-paddle-ocr-allowlist等)が
 * 参照しているため残しているが、OCRの判定には使われない(PR-Eで整理する)。
 *
 * `l1Provider`はテスト専用の注入口(既定は本番同様`PADDLE_OCR_CONFIG.provider`を使う)。
 */
export function resolveOcrProvider(l1Provider: OcrProvider = PADDLE_OCR_CONFIG.provider): OcrProvider {
  return l1Provider === 'gemini' ? 'gemini' : 'paddle';
}

export interface SarashinaSummaryGate {
  enabled: boolean;
  /**
   * null: フィールド不在 = 制限なし(全docIdが対象)。
   * string[]: このdocIdのみSarashinaへ切替許可(空配列は「全docId拒否」の意味、canary準備用)。
   * 不正値(非配列・非string混在)はfail-closedで空配列扱い(全docId拒否)にする。
   */
  allowlist: string[] | null;
  /**
   * OCR完了時に自動で要約を生成する(`summaryState:'pending'`を書く)か(`settings/features.autoSummaryOnOcr`、
   * PR-C)。既定(不在・true以外)は偽=手動のみ。自動を再開する時だけtrueにする。
   */
  autoOnOcr: boolean;
}

/**
 * ADR-0027 要約生成のSarashina切替(`SUMMARY_PROVIDER=sarashina`をL1として選択した上での)
 * L2ゲート(flag + 許可リスト)を単一snapshotで返す。`getPaddleOcrGate`と同型
 * (`paddleOcr`→`sarashinaSummary`、`paddleOcrAllowlist`→`sarashinaSummaryAllowlist`)。
 *
 * フラグドキュメントが存在しない場合、またはsarashinaSummaryが明示的にtrueでない場合は
 * 「無効」を安全側デフォルトとする(fail-closed)。
 */
export async function getSarashinaSummaryGate(
  db: admin.firestore.Firestore
): Promise<SarashinaSummaryGate> {
  const snap = await db.doc(FEATURE_FLAGS_DOC_PATH).get();
  const data = snap.data();
  const enabled = data?.sarashinaSummary === true;
  const autoOnOcr = data?.autoSummaryOnOcr === true;

  if (!data || !('sarashinaSummaryAllowlist' in data)) {
    return { enabled, allowlist: null, autoOnOcr };
  }
  const rawAllowlist = data.sarashinaSummaryAllowlist;
  if (!Array.isArray(rawAllowlist) || rawAllowlist.some((v) => typeof v !== 'string')) {
    console.error(
      `[featureFlags] sarashinaSummaryAllowlist が不正な形式です(配列/文字列以外): ${JSON.stringify(rawAllowlist)}。fail-closedで全docId拒否として扱います。`
    );
    return { enabled, allowlist: [], autoOnOcr };
  }
  return { enabled, allowlist: rawAllowlist as string[], autoOnOcr };
}

/**
 * ドキュメント単位の要約生成プロバイダを解決する(ADR-0027)。
 *
 * L1(環境変数`SUMMARY_PROVIDER`)とL2(Firestoreフラグ+許可リスト)の2層構造。
 * `resolveOcrProvider`と異なり、L1='sarashina'がL2で不許可の場合は**'gemini'ではなく
 * 'none'にfail-safe**する(ADR-0027 主要な設計判断2: 新規課金を無言で発生させないため)。
 * L1が'none'/'gemini'の場合はFirestore読取自体を行わない(意図的な最適化、テストで
 * 読取なしを検証する)。
 */
export async function resolveSummaryProvider(
  db: admin.firestore.Firestore,
  docId: string,
  l1Provider: SummaryProviderSetting = SARASHINA_SUMMARY_CONFIG.provider
): Promise<SummaryProviderSetting> {
  if (l1Provider === 'none' || l1Provider === 'gemini') return l1Provider;

  const gate = await getSarashinaSummaryGate(db);
  if (!gate.enabled) return 'none';
  if (gate.allowlist !== null && !gate.allowlist.includes(docId)) return 'none';
  return 'sarashina';
}
