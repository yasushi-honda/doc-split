/**
 * 「確認済み」操作に伴う顧客・事業所の確定フラグ統合の純粋関数(Issue #1034)。
 *
 * 背景: 「確認済み」トグル(`verified`)は元々OCR内容の人的確認のみを表し、顧客/事業所の
 * 候補確定(`customerConfirmed`/`officeConfirmed`)とは無関係なフィールドだった。しかし
 * 単体編集の保存フロー(`frontend/src/hooks/useDocumentEdit.ts`、Issue #396「保存=確定」)
 * では既に、有効な顧客名・事業所名が入っていれば保存時に確定フラグを立てている。
 * 「確認済み」にする操作(単体トグル・一括確認済み)も同じルールで確定フラグを立てる
 * ことで、「確認済み」と「選択待ち」バッジの意味的な乖離(#1034の実際の原因)を解消する。
 *
 * 安全装置: ADR-0022(2026-07-25、Finding 1)で「同姓同名の候補を選び直さず無関係な
 * フィールドだけ直して保存してもcustomerConfirmed:trueになり、Driveの顧客未確定ゲートを
 * 素通りする」というバグが実際に発生したため、同姓同名の場合だけは確定を見送る
 * (`resolveCustomerUnconfirmedReason`を再利用、判定ロジックはFE/BE双方の既存契約と共通)。
 * 事業所側には同姓同名相当のガードが元々存在しない(`shouldSetOfficeConfirmed`と同じ非対称性
 * をそのまま踏襲する、今回新たに追加する保護ではない)。
 *
 * FE(単体トグル・一括確認済み)・backfillスクリプト(scripts/backfill-confirm-on-verify.ts)の
 * 3箇所から同一ロジックとして呼ばれるため shared/ に置く。Firestore/Admin SDK 非依存。
 */

import {
  isValidCustomerSelection,
  resolveCustomerUnconfirmedReason,
  type CustomerIdentityDocFields,
} from './customerIdentity';
import { isValidOfficeSelection } from './officeIdentity';

export type CustomerConfirmDecision =
  | { action: 'confirm' }
  | {
      action: 'skip';
      reason:
        | 'already-confirmed'
        | 'invalid-name'
        | 'same-name-collision'
        | 'name-id-mismatch'
        | 'customer-master-missing';
    };

export type OfficeConfirmDecision =
  | { action: 'confirm' }
  | { action: 'skip'; reason: 'already-confirmed' | 'invalid-name' };

export interface ConfirmOnVerifyDocFields extends CustomerIdentityDocFields {
  customerId?: string | null;
  officeName?: string | null;
  officeConfirmed?: boolean;
}

export interface ConfirmOnVerifyOpts {
  /**
   * `doc.customerId`が指すマスターの`name`。`doc.customerId`が無い場合、またはIDはあるが
   * マスターが見つからない(削除済み等)場合は`null`を渡す。後者を区別するため、
   * `doc.customerId`の有無は本関数側で見る(呼出元は「引けたかどうか」だけ気にすればよい)。
   */
  customerMasterName: string | null;
  sameNameCollisionNames: ReadonlySet<string>;
}

/**
 * 顧客側の確定可否を判定する。`doc.customerId`が設定されているのに`customerMasterName`が
 * `null`(マスター解決に失敗)の場合は、`name-id-mismatch`と区別して`customer-master-missing`
 * を返す(codexレビュー指摘: 両者を混同すると「customerIdなし」と「参照先マスター欠損」を
 * 見分けられず、後者を誤って確定してしまう恐れがあった)。
 */
export function decideCustomerConfirm(
  doc: ConfirmOnVerifyDocFields,
  opts: ConfirmOnVerifyOpts
): CustomerConfirmDecision {
  if (doc.customerConfirmed === true) {
    return { action: 'skip', reason: 'already-confirmed' };
  }
  if (!isValidCustomerSelection(doc.customerName)) {
    return { action: 'skip', reason: 'invalid-name' };
  }
  if (doc.customerId && opts.customerMasterName === null) {
    return { action: 'skip', reason: 'customer-master-missing' };
  }
  const reason = resolveCustomerUnconfirmedReason(doc, opts);
  if (reason === null) {
    return { action: 'confirm' };
  }
  if (reason === 'invalid-name') {
    // 上のisValidCustomerSelectionチェックで既に弾いているはずだが、判定基準がずれた場合の
    // フォールバックとして同じ理由を返す(到達しない想定、テストで担保)。
    return { action: 'skip', reason: 'invalid-name' };
  }
  return { action: 'skip', reason };
}

export function decideOfficeConfirm(doc: ConfirmOnVerifyDocFields): OfficeConfirmDecision {
  if (doc.officeConfirmed === true) {
    return { action: 'skip', reason: 'already-confirmed' };
  }
  if (!isValidOfficeSelection(doc.officeName)) {
    return { action: 'skip', reason: 'invalid-name' };
  }
  return { action: 'confirm' };
}

export interface ConfirmOnVerifyDecisions {
  customer: CustomerConfirmDecision;
  office: OfficeConfirmDecision;
}

export function planConfirmOnVerify(
  doc: ConfirmOnVerifyDocFields,
  opts: ConfirmOnVerifyOpts
): ConfirmOnVerifyDecisions {
  return {
    customer: decideCustomerConfirm(doc, opts),
    office: decideOfficeConfirm(doc),
  };
}

export interface ConfirmOnVerifyActor {
  /**
   * 人間操作(単体トグル・一括確認済み)は Firebase Auth uid。
   * backfill等のシステム適用は`null`(confirmedBy/officeConfirmedByをupdateに含めない。
   * `functions/src/ocr/confirmedFieldMerge.ts`の既存契約「確定者UIDは人間確定時のみ設定、
   * システム自動確定時はnull(=未設定)」を破らないため)。
   */
  uid: string | null;
  /**
   * 呼出元が用意したタイムスタンプ値をそのまま透過する(client SDKの`serverTimestamp()`
   * センチネル、Admin SDKの`Timestamp.now()`等、本関数はFirestore SDKに依存しないため
   * 解釈しない)。`uid`が`null`のときは使用しない。
   */
  now?: unknown;
}

export interface ConfirmOnVerifyLogEntry {
  field: 'customerConfirmed' | 'officeConfirmed' | 'needsManualCustomerSelection';
  oldValue: string | null;
  newValue: string;
}

export interface ConfirmOnVerifyDocSnapshot {
  customerConfirmed?: boolean;
  officeConfirmed?: boolean;
  needsManualCustomerSelection?: boolean;
}

/**
 * 確定フラグの更新データと監査ログエントリを組み立てる。
 * customerId・customerName・officeId・officeNameには一切触れない
 * (表示中の値をそのまま確定するだけで、値そのものは変更しない)。
 */
export function buildConfirmOnVerifyUpdate(
  decisions: ConfirmOnVerifyDecisions,
  doc: ConfirmOnVerifyDocSnapshot,
  actor: ConfirmOnVerifyActor
): { update: Record<string, unknown>; logs: ConfirmOnVerifyLogEntry[] } {
  const update: Record<string, unknown> = {};
  const logs: ConfirmOnVerifyLogEntry[] = [];

  if (decisions.customer.action === 'confirm') {
    update.customerConfirmed = true;
    if (actor.uid !== null) {
      update.confirmedBy = actor.uid;
      update.confirmedAt = actor.now;
    }
    logs.push({
      field: 'customerConfirmed',
      oldValue: doc.customerConfirmed === undefined ? null : String(doc.customerConfirmed),
      newValue: 'true',
    });
    if (doc.needsManualCustomerSelection === true) {
      update.needsManualCustomerSelection = false;
      logs.push({ field: 'needsManualCustomerSelection', oldValue: 'true', newValue: 'false' });
    }
  }

  if (decisions.office.action === 'confirm') {
    update.officeConfirmed = true;
    if (actor.uid !== null) {
      update.officeConfirmedBy = actor.uid;
      update.officeConfirmedAt = actor.now;
    }
    logs.push({
      field: 'officeConfirmed',
      oldValue: doc.officeConfirmed === undefined ? null : String(doc.officeConfirmed),
      newValue: 'true',
    });
  }

  return { update, logs };
}

/**
 * 確定判定用の顧客マスター一覧取得(`fetchFreshCustomerIdentityLookup()`)が失敗し、
 * customerConfirmed/officeConfirmedの確定処理を丸ごとスキップした場合にユーザーへ
 * 提示する警告文言の共通部分(Issue #1042)。単体トグル(useDocumentVerification.ts)・
 * 一括確認済み(DocumentsPage.tsxのhandleBulkVerify)の両方から参照する。
 *
 * 「確認済みにしました」等の前置き(件数の有無で文言が変わる)は各呼び出し元が組み立てる。
 * ここに前置きを含めてしまうと、呼び出し元側で独自に前置きを付ける際に「確認済みに
 * しました」が二重に出る(codex review / pr-review-toolkit:code-reviewer 指摘、2026-09-25)。
 */
export const CONFIRM_ON_VERIFY_SKIPPED_REASON_MESSAGE =
  '顧客/事業所マスターの取得に失敗したため確定処理はスキップされました。再実行してください';
