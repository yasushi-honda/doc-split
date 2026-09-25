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

/**
 * `customerConfirmed`/`officeConfirmed`は本来boolean|フィールド不在の契約だが、実データの
 * 充足率は未確認(CLAUDE.md「既存データへの新規ゲート追加時の注意」)。この契約を破る値
 * (null・文字列等)がbackfill実行時にそのままmanifestへ書き込まれると、`--rollback`実行時に
 * `isValidManifestEntry`がその1件を理由にmanifest全体を無効判定し、正常な残り全件のロール
 * バックまで巻き込んでしまう(pr-review-toolkit指摘、書込み側/読込み側の非対称バグ)。
 * 書込み前(候補収集時点)でこの契約を検査し、満たさない文書はbackfill対象から除外する。
 */
export function isValidConfirmedFieldValue(x: unknown): x is boolean | undefined {
  return x === undefined || typeof x === 'boolean';
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
 * 顧客側の確定結果(判別可能ユニオン、Issue #1043)。`confirmedCustomer:false`かつ
 * `customerConfirmedBefore`に値がある、といった不正な組み合わせを型として表現不能にする
 * (旧フラット構造では規約でしか守れず、コンパイラの保証がなかった、codex `type-design-analyzer`指摘)。
 */
export type ManifestCustomerOutcome =
  | { confirmedCustomer: false }
  | {
      confirmedCustomer: true;
      /** backfill実行前のcustomerConfirmedの値(field不在ならundefined)。 */
      customerConfirmedBefore: boolean | undefined;
      /**
       * 顧客確定と同時に`needsManualCustomerSelection:true`→`false`のレガシーフラグ書き戻しが
       * 発生したか(shared/confirmOnVerify.tsのbuildConfirmOnVerifyUpdate参照、実行前は常にtrue
       * だった場合のみ発生するため、trueを記録すれば「実行前の値はtrueだった」ことも自明)。
       * これを記録しないと、rollbackでcustomerConfirmedだけ戻してもneedsManualCustomerSelection:false
       * が残存し、レガシー文書が「確定済み」のまま復元されてしまう(codexレビュー指摘)。
       */
      resetNeedsManualCustomerSelection: boolean;
    };

/** 事業所側の確定結果(判別可能ユニオン、Issue #1043)。設計意図はManifestCustomerOutcomeと同じ。 */
export type ManifestOfficeOutcome =
  | { confirmedOffice: false }
  | { confirmedOffice: true; officeConfirmedBefore: boolean | undefined };

/**
 * backfillが実際に確定した1文書分のmanifestエントリ。ロールバック時に「backfill実行前の
 * 値」へ正確に戻すため、書込み前の値(field不在ならundefined)を保持する
 * (codexレビュー指摘: 部分失敗・再実行・ロールバック手段が未定義だった対応)。
 */
export interface ConfirmOnVerifyManifestEntry {
  docId: string;
  customer: ManifestCustomerOutcome;
  office: ManifestOfficeOutcome;
  /**
   * backfillがこの文書へ書込んだ直後の`updateTime`(`WriteResult.writeTime`のseconds/nanoseconds、
   * `Timestamp.toMillis()`ではなくフル精度で保持する)。rollback時、ライブの`updateTime`と
   * この値が一致する場合のみ「backfill以降、誰にも(再処理を含め)一切触れられていない」と
   * 判定できる(codexレビュー指摘: `confirmedBy`がnullのままの再確認だけでなく、OCR再処理に
   * よる自動確定もconfirmedByをnullのままcustomerConfirmed等を新しい値で書き換えうるため、
   * actorベースの判定だけでは「backfillが書いた値のまま」なのか「その後さらに別の値で
   * 上書きされた」のかを区別できなかった。updateTime完全一致チェックはどちらの経路の
   * 上書きも等しく検知する)。
   *
   * codexレビュー指摘(5回目、P2): `toMillis()`(ミリ秒精度)だと、backfill書込み直後の
   * 同一ミリ秒内に別の書込みが発生した場合に両者のミリ秒値が一致してしまい、rollbackが
   * その新しい書込みを誤って「backfillのまま」と判定し上書きしてしまう恐れがあった。
   * Firestoreの`Timestamp`はナノ秒精度を持つため、seconds/nanosecondsをそのまま保持して
   * 完全一致比較することで、この衝突リスクを排除する。
   */
  backfillUpdateTime: { seconds: number; nanoseconds: number };
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
 *
 * codexレビュー指摘(5回目、P2): ミリ秒精度(`toMillis()`)の比較だと、同一ミリ秒内に
 * 発生した別の書込みを誤って「backfillのまま」と判定しうる。seconds/nanosecondsの
 * 両方が完全一致する場合のみeligibleとする(Firestoreのナノ秒精度を活かす)。
 */
export function isRollbackEligibleByUpdateTime(
  entry: ConfirmOnVerifyManifestEntry,
  liveUpdateTime: { seconds: number; nanoseconds: number }
): boolean {
  return (
    liveUpdateTime.seconds === entry.backfillUpdateTime.seconds &&
    liveUpdateTime.nanoseconds === entry.backfillUpdateTime.nanoseconds
  );
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
  if (entry.customer.confirmedCustomer) {
    result.customer =
      entry.customer.customerConfirmedBefore === undefined
        ? { action: 'delete' }
        : { action: 'set', value: entry.customer.customerConfirmedBefore };
    if (entry.customer.resetNeedsManualCustomerSelection) {
      result.needsManualCustomerSelection = { action: 'set', value: true };
    }
  }
  if (entry.office.confirmedOffice) {
    result.office =
      entry.office.officeConfirmedBefore === undefined
        ? { action: 'delete' }
        : { action: 'set', value: entry.office.officeConfirmedBefore };
  }
  return result;
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** `ManifestCustomerOutcome`のランタイム検証(Issue #1043、`--rollback`読込み時の型ガード)。 */
export function isValidManifestCustomerOutcome(x: unknown): x is ManifestCustomerOutcome {
  if (!isPlainObject(x)) return false;
  if (x.confirmedCustomer === false) return true;
  if (x.confirmedCustomer === true) {
    return (
      (x.customerConfirmedBefore === undefined || typeof x.customerConfirmedBefore === 'boolean') &&
      typeof x.resetNeedsManualCustomerSelection === 'boolean'
    );
  }
  return false;
}

/** `ManifestOfficeOutcome`のランタイム検証(Issue #1043、`--rollback`読込み時の型ガード)。 */
export function isValidManifestOfficeOutcome(x: unknown): x is ManifestOfficeOutcome {
  if (!isPlainObject(x)) return false;
  if (x.confirmedOffice === false) return true;
  if (x.confirmedOffice === true) {
    return x.officeConfirmedBefore === undefined || typeof x.officeConfirmedBefore === 'boolean';
  }
  return false;
}

/**
 * manifest 1件分のランタイム検証(Issue #1043)。`--rollback`実行時、`JSON.parse`+型アサーション
 * のみで信頼していた読込み経路(手編集・別バージョン・部分破損JSONを構文エラーなくすり抜けさせて
 * いた、codex `type-design-analyzer`指摘)に、生成側と同じ構造的整合性チェックを課す。
 */
export function isValidManifestEntry(x: unknown): x is ConfirmOnVerifyManifestEntry {
  if (!isPlainObject(x)) return false;
  // "/"混入は`db.doc(`documents/${docId}`)`(呼出元)が別コレクション配下の無関係なドキュメント
  // を指す経路を開くため、手編集されたmanifestに対する追加の防御として拒否する(pr-review-toolkit指摘)。
  if (typeof x.docId !== 'string' || x.docId.length === 0 || x.docId.includes('/')) return false;
  if (!isValidManifestCustomerOutcome(x.customer)) return false;
  if (!isValidManifestOfficeOutcome(x.office)) return false;
  const t = x.backfillUpdateTime;
  if (!isPlainObject(t) || typeof t.seconds !== 'number' || typeof t.nanoseconds !== 'number') return false;
  return true;
}

/**
 * manifest全体のランタイム検証(Issue #1043)。1件でも不正なentryがあれば全体をfalseとし、
 * `--rollback`側はFirestoreへ一切書込まずexit(1)する(fail-closed、部分的に壊れたJSONを
 * 「壊れていない部分だけ実行」して誤ったロールバックが混入する事故を防ぐ)。
 */
export function isValidManifest(x: unknown): x is ConfirmOnVerifyBackfillManifest {
  if (!isPlainObject(x)) return false;
  if (typeof x.runId !== 'string' || typeof x.projectId !== 'string' || typeof x.timestamp !== 'string') return false;
  if (!Array.isArray(x.entries)) return false;
  return x.entries.every(isValidManifestEntry);
}
