/**
 * マスターデータ読み込み共通関数。
 *
 * 3 コレクション（documents/customers/offices）を並列取得し、各サニタイザで型崩れを
 * 除去したマスターデータを返す。OCR 処理と PDF 分割提案の両系列で使う。
 *
 * #344: sanitize で drop が発生した場合、errorLogger.safeLogError で observability を確保する
 *       (silent failure 解消)。errorLogger は top-level で admin.firestore() を呼ぶため lazy
 *       import で遅延初期化する (テスト環境で未初期化の場合も主パスが壊れない)。
 */

import type * as admin from 'firebase-admin';
import type { CustomerMaster, DocumentMaster, MasterData, OfficeMaster } from './extractors';
import { MASTER_PATHS } from './masterPaths';
import {
  sanitizeCustomerMasters,
  sanitizeDocumentMasters,
  sanitizeOfficeMasters,
} from './sanitizeMasterData';

type RawDoc = FirebaseFirestore.DocumentData;

/** Firestore Raw → 型付き中間表現。型崩れは後段の sanitize*Masters で除去される */
function toDocumentMaster(id: string, raw: RawDoc): DocumentMaster {
  return {
    id,
    name: raw.name as string,
    category: raw.category as string | undefined,
    keywords: raw.keywords as string[] | undefined,
    aliases: raw.aliases as string[] | undefined,
    dateMarker: raw.dateMarker as string | undefined,
  };
}

/** Firestore Raw → 型付き中間表現。型崩れは後段の sanitize*Masters で除去される */
function toCustomerMaster(id: string, raw: RawDoc): CustomerMaster {
  return {
    id,
    name: raw.name as string,
    furigana: raw.furigana as string | undefined,
    isDuplicate: raw.isDuplicate as boolean | undefined,
    careManagerName: raw.careManagerName as string | undefined,
    aliases: raw.aliases as string[] | undefined,
  };
}

/** Firestore Raw → 型付き中間表現。型崩れは後段の sanitize*Masters で除去される */
function toOfficeMaster(id: string, raw: RawDoc): OfficeMaster {
  return {
    id,
    name: raw.name as string,
    shortName: raw.shortName as string | undefined,
    isDuplicate: raw.isDuplicate as boolean | undefined,
    aliases: raw.aliases as string[] | undefined,
  };
}

/**
 * Firebase Functions runtime 判定 (positive signal)。
 *
 * `NODE_ENV === 'production'` 単独判定は Functions Gen2 (Cloud Run ベース) で
 * 未設定のケースがあり、production drop を safeLogError に送れない silent risk がある
 * (silent-failure-hunter Important #1 対応)。Firebase runtime は `K_SERVICE` (Cloud Run SA
 * 由来) または `FUNCTION_TARGET` (Functions framework) を常時セットするため、いずれか
 * 検出で production path を確定させる。ローカル dev / test 環境では両方 unset で skip される。
 */
function isFirebaseFunctionsRuntime(): boolean {
  return (
    !!process.env.K_SERVICE ||
    !!process.env.FUNCTION_TARGET ||
    process.env.NODE_ENV === 'production'
  );
}

/**
 * sanitize 各層の drop 結果を集約し observability を確保する (#344)。
 *
 * 挙動:
 * - drop ゼロ → no-op (return early)
 * - drop あり → console.warn 1 発 (常時、本番/テスト共通) + Firebase runtime のみ safeLogError 発火
 * - 「raw 非ゼロ だが items ゼロ」の kind があれば Error message prefix を 'ALL RECORDS DROPPED'
 *   にする (運用で閾値検知を容易にする)
 *
 * Why lazy require:
 * errorLogger は top-level で `admin.firestore()` を呼ぶため、admin 未初期化のテスト環境で
 * import するとエラーになる。Firebase runtime gate + lazy require は textCap.ts の既存パターン
 * (rules/error-handling.md §1 の独立 try-catch 推奨に準拠)。テスト環境では console.warn
 * を stub して drop 検出を検証する。
 *
 * Why always async:
 * 戻り値を `Promise<void>` 統一 (evaluator/silent-failure-hunter 指摘)。caller は常に await
 * で待機する契約で、将来 safeLogError が sync になっても型安全が崩れない。
 */
async function reportSanitizeDrops(
  reports: Array<{ kind: 'documents' | 'customers' | 'offices'; rawCount: number; droppedIds: string[] }>,
): Promise<void> {
  const dropped = reports.filter((r) => r.droppedIds.length > 0);
  if (dropped.length === 0) return;

  const hasAllDroppedKind = dropped.some((r) => r.rawCount > 0 && r.rawCount === r.droppedIds.length);
  // ログの可読性のため先頭 5 件のみ列挙、超過分は '...' で省略する (droppedIds.length > 5 の時のみ付与)。
  // 全 droppedIds は fallback 時のデバッグ用に別途保持 (L87 allDroppedIds)。
  const summary = dropped
    .map((r) => `${r.kind}: ${r.droppedIds.length}/${r.rawCount} (ids: ${r.droppedIds.slice(0, 5).join(', ')}${r.droppedIds.length > 5 ? ', ...' : ''})`)
    .join('; ');
  const prefix = hasAllDroppedKind ? 'ALL RECORDS DROPPED' : 'Records dropped during sanitize';
  const message = `${prefix}: ${summary}`;
  const allDroppedIds = dropped.flatMap((r) => r.droppedIds);

  console.warn(`[loadMasterData] ${message}`);

  if (!isFirebaseFunctionsRuntime()) return;

  // Firebase runtime のみ: errorLogger は top-level で admin.firestore() を呼ぶため lazy require
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { safeLogError } = require('./errorLogger') as typeof import('./errorLogger');
    await safeLogError({
      error: new Error(message),
      source: 'ocr',
      functionName: 'loadMasterData',
    });
  } catch (loadErr) {
    // 全 droppedIds を fallback に含める (safeLogError 不達時のデバッグ可能性担保)
    console.error(
      '[loadMasterData] failed to load errorLogger for drop report:',
      loadErr,
      message,
      { fullDroppedIds: allDroppedIds },
    );
  }
}

export async function loadMasterData(
  db: admin.firestore.Firestore
): Promise<MasterData> {
  const [documentSnap, customerSnap, officeSnap] = await Promise.all([
    db.collection(MASTER_PATHS.documents).get(),
    db.collection(MASTER_PATHS.customers).get(),
    db.collection(MASTER_PATHS.offices).get(),
  ]);

  const documentRaw = documentSnap.docs.map((d) => toDocumentMaster(d.id, d.data()));
  const customerRaw = customerSnap.docs.map((d) => toCustomerMaster(d.id, d.data()));
  const officeRaw = officeSnap.docs.map((d) => toOfficeMaster(d.id, d.data()));

  const documentResult = sanitizeDocumentMasters(documentRaw);
  const customerResult = sanitizeCustomerMasters(customerRaw);
  const officeResult = sanitizeOfficeMasters(officeRaw);

  await reportSanitizeDrops([
    { kind: 'documents', rawCount: documentRaw.length, droppedIds: documentResult.droppedIds },
    { kind: 'customers', rawCount: customerRaw.length, droppedIds: customerResult.droppedIds },
    { kind: 'offices', rawCount: officeRaw.length, droppedIds: officeResult.droppedIds },
  ]);

  return {
    documents: documentResult.items,
    customers: customerResult.items,
    offices: officeResult.items,
  };
}
