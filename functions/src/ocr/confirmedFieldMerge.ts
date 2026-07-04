/**
 * confirmed保護フィールドマージの純粋関数。(Issue #526 D2)
 *
 * OCR再解析(processDocument)は通常、抽出結果でcustomerName/officeName/documentType等を
 * 上書きする。`customerConfirmed`/`officeConfirmed`はユーザーが分割画面で実際に選択した
 * 場合だけでなく、OCR自身の確信度に基づく自己判定(候補が一意に定まった場合、
 * `ocrUpdatePayloadBuilder.ts`の`!needsManualSelection`)でも true になりうる
 * (`documentTypeConfirmed`のみユーザー選択専用、対応する自己判定シグナルを持たない)。
 * この関数はどちらの経路でtrueになったかを区別せず、trueである限り同じ規約で保護する。
 *
 * この設計が安全に成立するのは、手動再処理(`frontend/src/hooks/useDocuments.ts`の
 * `getReprocessClearFields()`)が再処理開始時に3フラグを明示的にfalseへリセットして
 * いるため。このリセットが将来失われると、OCR自身の低確信度な自己判定が本関数により
 * 恒久的に凍結される回帰リスクがある(コメント削除・簡略化時は要注意)。
 *
 * 保護はフィールド単位(セグメント単位ではない、Issue #526本文)。各confirmedフラグは
 * 以下をまとめて保護する:
 * - フラグ自体(customerConfirmed等) — 保護しないと、OCRが今回導き出した自己判定で
 *   上書きされ、確定済みの状態が静かに未確定へ後退してしまう
 * - 対応する「確定値」フィールド(customerName/officeName/documentType等)
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

import type { Timestamp } from 'firebase-admin/firestore';

/** 確定者UID (人間が確定した場合のみ設定、システム自動確定時はnull) */
type ConfirmedByValue = string | null;
/** 確定日時。Firestoreから読み戻したTimestampを解釈せずそのまま透過する */
type ConfirmedAtValue = Timestamp | null;

export interface ConfirmedProtectionSnapshot {
  customerConfirmed?: boolean;
  officeConfirmed?: boolean;
  documentTypeConfirmed?: boolean;
  customerName?: string;
  customerId?: string | null;
  careManager?: string | null;
  isDuplicateCustomer?: boolean;
  needsManualCustomerSelection?: boolean;
  confirmedBy?: ConfirmedByValue;
  confirmedAt?: ConfirmedAtValue;
  officeName?: string;
  officeId?: string | null;
  officeConfirmedBy?: ConfirmedByValue;
  officeConfirmedAt?: ConfirmedAtValue;
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
  confirmedBy: ConfirmedByValue;
  confirmedAt: ConfirmedAtValue;
  officeConfirmed: boolean;
  officeName: string;
  officeId: string | null;
  officeConfirmedBy: ConfirmedByValue;
  officeConfirmedAt: ConfirmedAtValue;
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
