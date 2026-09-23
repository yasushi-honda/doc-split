/**
 * backfill-confirm-on-verify.ts の純粋ロジック部(I/O非依存、unit test対象)。
 * Issue #1034。scripts/lib/driveExportBackfillHelpers.ts と同じ分離パターンに倣う。
 *
 * codexレビュー(2026-09-23)で「本番backfillが既にDriveエクスポート向けに実装済み」と
 * 判明したため、`applyLimit`/`assertExpectedCount`/`ExpectedCountMismatchError`は
 * driveExportBackfillHelpers.tsから再利用し、ここでは重複実装しない
 * (backfill-confirm-on-verify.ts側でimportする)。
 */

import type { ConfirmOnVerifyDecisions } from '../../shared/confirmOnVerify';

/**
 * backfill候補の一次フィルタ(Firestoreクエリで`verified==true`に絞り込んだ後、
 * 追加のマスター読込なしで機械的に判定できる範囲)。`customerConfirmed`/`officeConfirmed`
 * のどちらかがtrueでない(未確定の可能性がある)docのみを対象にする。
 * 同姓同名等による実際のskip判定は`planConfirmOnVerify`(マスターデータが必要)に委ねる。
 */
export function isConfirmOnVerifyCandidate(data: Record<string, unknown>): boolean {
  return data.customerConfirmed !== true || data.officeConfirmed !== true;
}

/** dry-runの理由別内訳集計(codexレビュー指摘: 戻り値の真偽値だけでは内訳が出せない対応)。 */
export interface ConfirmOnVerifyTally {
  confirmBoth: number;
  confirmCustomerOnly: number;
  confirmOfficeOnly: number;
  confirmNeither: number;
  customerSkipReasons: Record<string, number>;
  officeSkipReasons: Record<string, number>;
}

export function tallyConfirmOnVerifyDecisions(
  decisionsList: readonly ConfirmOnVerifyDecisions[]
): ConfirmOnVerifyTally {
  const tally: ConfirmOnVerifyTally = {
    confirmBoth: 0,
    confirmCustomerOnly: 0,
    confirmOfficeOnly: 0,
    confirmNeither: 0,
    customerSkipReasons: {},
    officeSkipReasons: {},
  };

  for (const decisions of decisionsList) {
    const confirmsCustomer = decisions.customer.action === 'confirm';
    const confirmsOffice = decisions.office.action === 'confirm';
    if (confirmsCustomer && confirmsOffice) tally.confirmBoth++;
    else if (confirmsCustomer) tally.confirmCustomerOnly++;
    else if (confirmsOffice) tally.confirmOfficeOnly++;
    else tally.confirmNeither++;

    if (decisions.customer.action === 'skip') {
      tally.customerSkipReasons[decisions.customer.reason] =
        (tally.customerSkipReasons[decisions.customer.reason] ?? 0) + 1;
    }
    if (decisions.office.action === 'skip') {
      tally.officeSkipReasons[decisions.office.reason] = (tally.officeSkipReasons[decisions.office.reason] ?? 0) + 1;
    }
  }

  return tally;
}

/** dry-runでDriveへの影響を可視化するための`driveExportStatus`別内訳(codexレビュー指摘対応)。 */
export function tallyDriveExportStatus(statuses: readonly (string | undefined)[]): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const status of statuses) {
    const key = status ?? '(フィールド不在)';
    tally[key] = (tally[key] ?? 0) + 1;
  }
  return tally;
}

/**
 * backfillが実際に確定した1文書分のmanifestエントリ。ロールバック時に「backfill実行前の
 * 値」へ正確に戻すため、書込み前の値(field不在ならundefined)を保持する
 * (codexレビュー指摘: 部分失敗・再実行・ロールバック手段が未定義だった対応)。
 */
export interface ConfirmOnVerifyManifestEntry {
  docId: string;
  /** このentryが顧客側を確定させたか。falseなら顧客側は対象外(元々touchしていない)。 */
  confirmedCustomer: boolean;
  /** confirmedCustomer:trueの場合のみ有効。backfill実行前のcustomerConfirmedの値。 */
  customerConfirmedBefore?: boolean;
  /**
   * 顧客確定と同時に`needsManualCustomerSelection:true`→`false`のレガシーフラグ書き戻しが
   * 発生したか(shared/confirmOnVerify.tsのbuildConfirmOnVerifyUpdate参照、実行前は常にtrue
   * だった場合のみ発生するため、trueを記録すれば「実行前の値はtrueだった」ことも自明)。
   * これを記録しないと、rollbackでcustomerConfirmedだけ戻してもneedsManualCustomerSelection:false
   * が残存し、レガシー文書が「確定済み」のまま復元されてしまう(codexレビュー指摘)。
   */
  resetNeedsManualCustomerSelection: boolean;
  confirmedOffice: boolean;
  /** confirmedOffice:trueの場合のみ有効。backfill実行前のofficeConfirmedの値。 */
  officeConfirmedBefore?: boolean;
  /**
   * backfillがこの文書へ書込んだ直後の`updateTime`(ミリ秒、`WriteResult.writeTime.toMillis()`)。
   * rollback時、ライブの`updateTime`とこの値が一致する場合のみ「backfill以降、誰にも
   * (再処理を含め)一切触れられていない」と判定できる(codexレビュー指摘: `confirmedBy`が
   * nullのままの再確認だけでなく、OCR再処理による自動確定もconfirmedByをnullのまま
   * customerConfirmed等を新しい値で書き換えうるため、actorベースの判定だけでは
   * 「backfillが書いた値のまま」なのか「その後さらに別の値で上書きされた」のかを
   * 区別できなかった。updateTime完全一致チェックはどちらの経路の上書きも等しく検知する)。
   */
  backfillUpdateTimeMs: number;
}

export interface ConfirmOnVerifyBackfillManifest {
  runId: string;
  projectId: string;
  timestamp: string;
  entries: ConfirmOnVerifyManifestEntry[];
}

export function buildConfirmOnVerifyManifest(params: {
  runId: string;
  projectId: string;
  timestampIso: string;
  entries: readonly ConfirmOnVerifyManifestEntry[];
}): ConfirmOnVerifyBackfillManifest {
  return {
    runId: params.runId,
    projectId: params.projectId,
    timestamp: params.timestampIso,
    entries: [...params.entries],
  };
}

/**
 * ロールバック可否判定(codexレビュー指摘、2回目: actorベース(confirmedBy等)の判定を
 * updateTime完全一致ベースに置き換え)。backfillが書込んだ直後の`updateTime`と、
 * ライブの`updateTime`が完全一致する場合のみ「backfill以降、この文書には一切(再処理・
 * 他の確定操作を含め)書込みが発生していない」と判定できる。1文字でも異なれば、それが
 * 人間の確定操作によるものかOCR再処理の自動確定によるものかを問わず、backfillが記録した
 * 「実行前の値」は既に古くなっている可能性があるためrollback対象外とする
 * (backfill-drive-export.tsの「進行済みはskip」と同じ設計思想をより厳密にしたもの)。
 */
export function isRollbackEligibleByUpdateTime(entry: ConfirmOnVerifyManifestEntry, liveUpdateTimeMs: number): boolean {
  return liveUpdateTimeMs === entry.backfillUpdateTimeMs;
}

/**
 * ロールバック用のFirestore更新データを組み立てる。backfill実行前の値がundefined
 * (フィールド不在)だった場合は`FieldValue.delete()`相当のマーカーではなく、
 * 呼出元がAdmin SDKの`FieldValue.delete()`に変換できるよう`{ __delete: true }`を返す
 * (本モジュールはFirestore/Admin SDK非依存の純粋関数のため、実際のFieldValueは
 * 呼出元(backfill-confirm-on-verify.ts)で組み立てる)。
 */
export type RollbackFieldInstruction = { action: 'set'; value: boolean } | { action: 'delete' };

export function computeRollbackInstructions(entry: ConfirmOnVerifyManifestEntry): {
  customer?: RollbackFieldInstruction;
  /** resetNeedsManualCustomerSelection:trueの場合のみ返す。実行前は常にtrueだった値へ戻す。 */
  needsManualCustomerSelection?: RollbackFieldInstruction;
  office?: RollbackFieldInstruction;
} {
  const result: {
    customer?: RollbackFieldInstruction;
    needsManualCustomerSelection?: RollbackFieldInstruction;
    office?: RollbackFieldInstruction;
  } = {};
  if (entry.confirmedCustomer) {
    result.customer =
      entry.customerConfirmedBefore === undefined ? { action: 'delete' } : { action: 'set', value: entry.customerConfirmedBefore };
    if (entry.resetNeedsManualCustomerSelection) {
      result.needsManualCustomerSelection = { action: 'set', value: true };
    }
  }
  if (entry.confirmedOffice) {
    result.office =
      entry.officeConfirmedBefore === undefined ? { action: 'delete' } : { action: 'set', value: entry.officeConfirmedBefore };
  }
  return result;
}
