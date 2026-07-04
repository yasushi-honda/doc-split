/**
 * confirmed保護フィールドマージの純粋関数。(Issue #526 D2)
 *
 * OCR再解析(processDocument)は通常、抽出結果でcustomerName/officeName/documentType等を
 * 上書きするが、分割画面でユーザーが実際に選択した値(customerConfirmed/officeConfirmed/
 * documentTypeConfirmed = true)は保護し、フレッシュなOCR抽出結果で上書きしない。
 *
 * 保護はフィールド単位(セグメント単位ではない、Issue #526本文)。各confirmedフラグは
 * 以下をまとめて保護する:
 * - フラグ自体(customerConfirmed等) — 保護しないと、OCRが今回導き出した「確信度に基づく
 *   自己判定」で上書きされ、ユーザーが確定した状態が静かに未確定へ後退してしまう
 * - 対応する「ユーザー確定値」フィールド(customerName/officeName/documentType等)
 * - 確定者情報(confirmedBy/confirmedAt等) — documentTypeConfirmedのみBy/Atを持たない
 * - そのフィールドの状態を表すUI直結フィールド(isDuplicateCustomer等、customerConfirmed
 *   の値と無関係にFEで警告バナーを出すため保護しないと矛盾した表示になる)
 *
 * 候補一覧(customerCandidates等)や診断用フィールド(extractionScores/extractionDetails/
 * ocrExtraction)は編集UIの選択肢提示に使われ続けるため、confirmed状態によらず常に
 * 最新のOCR結果へ更新する。
 *
 * この関数は呼出元(ocrProcessor.ts)が Firestore transaction 内で最新ドキュメントを
 * 読み込んだ直後に呼び出す想定(stale snapshotによる編集競合を避けるため)。
 */

export interface ConfirmedProtectionSnapshot {
  customerConfirmed?: boolean;
  officeConfirmed?: boolean;
  documentTypeConfirmed?: boolean;
  customerName?: string;
  customerId?: string | null;
  careManager?: string | null;
  isDuplicateCustomer?: boolean;
  needsManualCustomerSelection?: boolean;
  /** Firestore Timestampまたはnull。この関数は値を解釈せずそのまま透過する */
  confirmedBy?: unknown;
  confirmedAt?: unknown;
  officeName?: string;
  officeId?: string | null;
  officeConfirmedBy?: unknown;
  officeConfirmedAt?: unknown;
  documentType?: string;
  category?: string | null;
}

/**
 * マージ対象となるproposed値の型。呼出元(buildOcrExtractionUpdatePayloadの戻り値)は
 * これよりフィールドが多いが、TypeScriptの構造的部分型により余剰フィールドはそのまま
 * 呼出元の型で保持される(この関数はマージ対象フィールドのみを型として要求する)。
 */
export interface ConfirmedProtectableFields {
  customerConfirmed: boolean;
  customerName: string;
  customerId: string | null;
  careManager: string | null;
  isDuplicateCustomer: boolean;
  needsManualCustomerSelection: boolean;
  confirmedBy: unknown;
  confirmedAt: unknown;
  officeConfirmed: boolean;
  officeName: string;
  officeId: string | null;
  officeConfirmedBy: unknown;
  officeConfirmedAt: unknown;
  documentTypeConfirmed: boolean;
  documentType: string;
  category: string | null;
}

/**
 * confirmed保護を適用したマージ結果を返す。保護対象フィールドのみ
 * `proposed` を書き換えたコピーとして返す(破壊的変更はしない)。
 */
export function applyConfirmedFieldProtection<T extends ConfirmedProtectableFields>(
  proposed: T,
  current: ConfirmedProtectionSnapshot
): T {
  const merged = { ...proposed };

  if (current.customerConfirmed === true) {
    merged.customerConfirmed = true;
    merged.customerName = current.customerName ?? proposed.customerName;
    merged.customerId = current.customerId ?? null;
    merged.careManager = current.careManager ?? null;
    merged.isDuplicateCustomer = current.isDuplicateCustomer ?? false;
    merged.needsManualCustomerSelection = current.needsManualCustomerSelection ?? false;
    merged.confirmedBy = current.confirmedBy ?? null;
    merged.confirmedAt = current.confirmedAt ?? null;
  }

  if (current.officeConfirmed === true) {
    merged.officeConfirmed = true;
    merged.officeName = current.officeName ?? proposed.officeName;
    merged.officeId = current.officeId ?? null;
    merged.officeConfirmedBy = current.officeConfirmedBy ?? null;
    merged.officeConfirmedAt = current.officeConfirmedAt ?? null;
  }

  if (current.documentTypeConfirmed === true) {
    merged.documentTypeConfirmed = true;
    merged.documentType = current.documentType ?? proposed.documentType;
    merged.category = current.category ?? null;
  }

  return merged;
}
