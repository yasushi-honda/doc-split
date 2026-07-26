/**
 * 顧客識別の純粋関数 (ADR-0022 顧客未確定ゲート再設計、2026-07-25)
 *
 * frontend/functions 双方から参照されるため shared/ に配置。Firestore/Admin SDK 非依存。
 *
 * `isValidCustomerSelection` は元々 frontend/src/lib/documentUtils.ts にのみ定義されていたが、
 * BE 側の Drive エクスポートゲート (functions/src/drive/customerAmbiguityGate.ts) も同じ
 * sentinel 判定を必要とするため、ここへ移設し documentUtils.ts からは re-export する
 * (既存 importer は無修正で動作)。
 *
 * `findSameNameCollisionNames` は「顧客マスターの`isDuplicate`フラグは信用できない」
 * (frontend/src/pages/MastersPage.tsx の handleForceAdd は新規追加するレコードのみに
 * isDuplicate:true を付与し、既存の衝突レコード側は更新しない。frontend/src/hooks/useMasters.ts
 * の updateCustomer には重複チェックが一切ない) という調査結果を踏まえ、保存済みフラグに
 * 頼らず「同名(完全一致)のマスターが実際に何件あるか」を毎回ライブに数え直す ground truth の
 * 実装。呼出元ごとにデータ取得方法が異なる(FE は useCustomers() のインメモリ全件、
 * functions/src/ocr/ocrProcessor.ts は loadMasterData() のインメモリ全件、
 * functions/src/drive/exportDocument.ts は名前1件を対象にした Firestore クエリ)ため、
 * このリスト処理版はインメモリで全件を保持済みの呼出元(FE・OCR取り込み)専用。
 * exportDocument.ts 側は全件フェッチを避けるため独自の限定クエリを実装する
 * (functions/src/drive/customerAmbiguityGate.ts 参照、同一契約は双方のテストで固定する)。
 *
 * `precheckCustomerIdentity`/`resolveCustomerUnconfirmedReason` は、現場管理者へ「同姓同名の
 * 可能性があるので確認してください」を能動的に知らせるUI追加(2026-07-26)で新設。BE は
 * 「マスター名1件 + 遅延Firestoreクエリ」、FE は「全件インメモリ(同期)」というデータ取得の
 * 非対称があるため、判定順序と`customerConfirmed`優先のdual-read(真の重複ロジック)だけを
 * `precheckCustomerIdentity` に共通化し、衝突真偽の取得方法(クエリ or Set照合)は呼出元に残す
 * 2関数構成にした。単一関数に統合すると BE が短絡できるケースでも常に衝突クエリを撃つことになる
 * ため。`isCustomerUnconfirmed`(functions/src/drive/customerAmbiguityGate.ts)はこれらへ委譲する
 * 形にリファクタ済み、外部契約(戻り値boolean)は不変。
 */

/**
 * 顧客名の sentinel 値。OCR 未マッチ・未判定状態を示すため、選択として無効扱いにする。
 */
export const CUSTOMER_INVALID_SENTINELS: ReadonlySet<string> = new Set(['未判定', '不明顧客']);

/**
 * 顧客が未確定と判定された理由(現場管理者への通知UI・監査スクリプトの内訳集計で使う、
 * 「同姓同名」プロアクティブ通知UI追加、2026-07-26)。
 */
export type CustomerUnconfirmedReason =
  | 'invalid-name' // 顧客名未設定・空白のみ・sentinel値
  | 'name-id-mismatch' // customerIdが指すマスター名とcustomerNameが乖離
  | 'same-name-collision'; // 同名(完全一致)マスターが2件以上 + 人間の明示的確定なし

/** `CustomerUnconfirmedReason` の日本語ラベル。`scripts/check-customer-master-integrity.js` の
 * `UNCONFIRMED_REASON` と将来一本化する余地を残すため同一文言にする。 */
export const CUSTOMER_UNCONFIRMED_REASON_LABELS: Readonly<Record<CustomerUnconfirmedReason, string>> = {
  'invalid-name': '顧客名未設定/sentinel値',
  'name-id-mismatch': 'customerId↔name乖離',
  'same-name-collision': '同名衝突未確定',
};

/**
 * 顧客未確定判定に必要なdocフィールドのみの構造的インターフェース。`shared/types.ts` の
 * `Document` は構造的にこれを満たすため、呼出元は `Document` をそのまま渡せる。
 */
export interface CustomerIdentityDocFields {
  customerName?: string | null;
  customerConfirmed?: boolean;
  needsManualCustomerSelection?: boolean;
}

/**
 * 同名衝突の確認手前までの判定結果。BE(`functions/src/drive/customerAmbiguityGate.ts`)は
 * `'needs-collision-check'` のときだけ Firestore へライブクエリを撃つ(短絡)。FE・監査スクリプトは
 * インメモリの衝突集合と照合するため常に同期的に完結する(`resolveCustomerUnconfirmedReason`参照)。
 */
export type CustomerIdentityPrecheck =
  | { outcome: 'unconfirmed'; reason: 'invalid-name' | 'name-id-mismatch' }
  | { outcome: 'confirmed' }
  | { outcome: 'needs-collision-check'; trimmedName: string };

/**
 * 同名衝突の確認手前まで(sentinel判定→name↔id乖離チェック→`customerConfirmed`優先のdual-read)を
 * 判定する。判定順序・「両方undefinedのレガシーdocは未確定として扱う」という設計判断は
 * `functions/src/drive/customerAmbiguityGate.ts` の旧実装からそのまま移設(挙動不変)。
 *
 * `opts.customerMasterName` が `null` の場合は name↔id 乖離チェックをスキップする(呼出元が
 * `customerId` を持たない、またはマスターを未取得の場合)。
 */
export function precheckCustomerIdentity(
  doc: CustomerIdentityDocFields,
  opts: { customerMasterName: string | null }
): CustomerIdentityPrecheck {
  const name = (doc.customerName ?? '').trim();
  if (!isValidCustomerSelection(name)) {
    return { outcome: 'unconfirmed', reason: 'invalid-name' };
  }

  if (opts.customerMasterName !== null && opts.customerMasterName !== name) {
    return { outcome: 'unconfirmed', reason: 'name-id-mismatch' };
  }

  const humanConfirmed = doc.customerConfirmed !== undefined
    ? doc.customerConfirmed
    : doc.needsManualCustomerSelection !== undefined
      ? !doc.needsManualCustomerSelection
      : false; // 両方未設定(レガシーdoc)は「未確定」として扱い、衝突チェックに委ねる
  if (humanConfirmed) {
    return { outcome: 'confirmed' };
  }

  return { outcome: 'needs-collision-check', trimmedName: name };
}

/**
 * 顧客未確定の理由を同期的に解決する(FE・監査スクリプト用)。`opts.sameNameCollisionNames` は
 * `findSameNameCollisionNames()` の戻り値をそのまま渡す想定。確定済みなら `null` を返す。
 */
export function resolveCustomerUnconfirmedReason(
  doc: CustomerIdentityDocFields,
  opts: { customerMasterName: string | null; sameNameCollisionNames: ReadonlySet<string> }
): CustomerUnconfirmedReason | null {
  const pre = precheckCustomerIdentity(doc, { customerMasterName: opts.customerMasterName });
  if (pre.outcome === 'unconfirmed') {
    return pre.reason;
  }
  if (pre.outcome === 'confirmed') {
    return null;
  }
  return opts.sameNameCollisionNames.has(pre.trimmedName) ? 'same-name-collision' : null;
}

/**
 * 顧客名が「確定可能な有効値」かを判定する。
 * 空文字・null・undefined・空白のみ・sentinel 値（'未判定'/'不明顧客'）は false を返す。
 */
export function isValidCustomerSelection(name: string | null | undefined): boolean {
  if (name == null) return false;
  const trimmed = name.trim();
  if (trimmed === '') return false;
  return !CUSTOMER_INVALID_SENTINELS.has(trimmed);
}

/**
 * 顧客マスター一覧から、同名(完全一致)が2件以上存在する名前の集合を返す。
 *
 * 「同姓同名の別人が同一 Drive フォルダへ合流するリスク」の判定に使う。マスターの
 * `isDuplicate` フラグ(登録時に自動付与されるが事後の追加・改名では更新されない)には
 * 依存せず、渡された一覧そのものから毎回数え直す。
 */
export function findSameNameCollisionNames(customers: Array<{ name: string }>): Set<string> {
  const counts = new Map<string, number>();
  for (const c of customers) {
    // BE(customerAmbiguityGate.ts)はtrim済みのdoc.customerNameで完全一致クエリするため、
    // マスター名もtrimしてから集計しないと判定が食い違いうる(2026-07-26、本番マスターデータ
    // (kanameone/cocoro双方)で前後空白付きnameが実在しないことは確認済み。addCustomer()の
    // normalizeName()・import-masters.jsのCSVパースが書込み時に既にtrimしているため)。
    const trimmed = c.name.trim();
    counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
}
