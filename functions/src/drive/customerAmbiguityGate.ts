/**
 * Drive エクスポートの顧客未確定ゲート判定 (ADR-0022 顧客未確定ゲート再設計、2026-07-25)
 *
 * `functions/src/drive/exportDocument.ts` から曖昧性判定ロジックを切り出し、単体テスト
 * 可能にする。守備範囲は「同姓同名マスターの衝突」だけでなく、顧客名未設定/sentinel値・
 * customerId↔name乖離も含む3系統(decision-maker承認済み、OCRの別名取り違え・スコア僅差
 * 誤認識は対象外。ADR-0022に2026-07-25追記: 当初「同姓同名の衝突のみ」と要約していたが、
 * 実データ監査でcocoro〈同名衝突0組〉でも36件検出され要約が実態と乖離していたため訂正)。
 *
 * 設計判断(前回セッションの実装が`/code-review`で破綻したことを踏まえた再設計):
 *
 * 1. 既存の「人間確定」dual-read判定(`customerConfirmed`優先→`needsManualCustomerSelection`
 *    反転)は、`customerConfirmed:true`かつ`needsManualCustomerSelection:true`という
 *    不整合docをUIから復旧不能な永久ブロックに追い込まないための`customerConfirmed`優先
 *    という設計判断を含んでいるため破棄せず活かす。ただし**両方未設定(Phase 6以前の
 *    レガシーdoc)は「確定済み」と見なさない**(旧実装は無条件で確定済み扱いしていたが、
 *    ambiguity-aware化に伴う仕様変更。人間による明示的確定の記録が一切無い以上、
 *    「未確定」として扱い、下記の曖昧性チェックに判定を委ねる。同名衝突が実在しなければ
 *    従来通り通過するため、後方互換上の実害はない)。
 * 2. マスターの`isDuplicate`フラグは信用できない(`frontend/src/pages/MastersPage.tsx`の
 *    `handleForceAdd`は新規追加するレコードのみに`isDuplicate:true`を付与し、既存の衝突
 *    レコード側は更新しない。`frontend/src/hooks/useMasters.ts`の`updateCustomer`には
 *    重複チェックが一切ない)ため、曖昧性はFirestoreへのライブクエリで確認する(ground truth)。
 * 3. sentinel値(「不明顧客」「未判定」)はOCR未マッチを示しマスターに実在しないため、
 *    ライブクエリより前に無条件で未確定扱いにする(`shared/customerIdentity.ts`の
 *    `isValidCustomerSelection`を再利用、FEの判定と同一契約)。
 * 4. `customerName`は`folderPath.ts`のフォルダ名生成と同じくtrimしてから照合する
 *    (untrimmedのまま照合すると前後空白付きdocが0件ヒットで通過するのに、フォルダ名は
 *    trim後で衝突するというズレが生じる)。
 * 5. 呼出元(`exportDocument.ts`)は`furigana`取得のため既に`masters/customers/{customerId}`
 *    を1回読んでいる。そこで得た`master.name`が`doc.customerName`と食い違う場合
 *    (マスター改名後の取り残し等)も、追加読み込みコストゼロで未確定扱いにする。
 *
 * FAX複製フロー(`functions/src/ocr/faxDuplication.ts`)はこのゲートを経由しない別の書込
 * 経路であり、本モジュールとは独立に同名衝突の除外が必要(`planFaxDuplication`の
 * `sameNameCollisionNames`引数を参照)。
 */

import type * as admin from 'firebase-admin';
import { isValidCustomerSelection } from '../../../shared/customerIdentity';
import { MASTER_PATHS } from '../utils/masterPaths';
import type { Document } from '../../../shared/types';

export interface IsCustomerUnconfirmedDeps {
  firestore: admin.firestore.Firestore;
  /**
   * `doc.customerId`が指すマスターの`name`(呼出元が既に読み込み済みの値をそのまま渡す)。
   * `doc.customerId`が無い場合は`null`を渡すとname↔id乖離チェックをスキップする。
   */
  customerMasterName: string | null;
}

/**
 * 顧客が未確定(顧客名未設定/sentinel値・customerId↔name乖離・同姓同名マスターの衝突が実在し
 * 人間による明示的選択が確認できない、のいずれか)かどうかを判定する。
 */
export async function isCustomerUnconfirmed(
  doc: Document,
  deps: IsCustomerUnconfirmedDeps
): Promise<boolean> {
  const name = (doc.customerName ?? '').trim();
  if (!isValidCustomerSelection(name)) {
    return true; // sentinel値(「不明顧客」「未判定」)・空文字は常に未確定扱い
  }

  // trim済みnameと比較する(doc.customerNameの生値と比較すると、マスター名は
  // normalizeName()でtrim済みのため、前後空白が付いただけの正常docまで誤って
  // 乖離扱いになってしまう)。
  if (deps.customerMasterName !== null && deps.customerMasterName !== name) {
    return true; // customerIdの指すマスター名とdoc.customerNameが乖離(マスター改名の取り残し等)
  }

  const humanConfirmed = doc.customerConfirmed !== undefined
    ? doc.customerConfirmed
    : doc.needsManualCustomerSelection !== undefined
      ? !doc.needsManualCustomerSelection
      : false; // 両方未設定(レガシーdoc)は「未確定」として扱い、曖昧性チェックに委ねる
  if (humanConfirmed) {
    return false;
  }

  // 未確定と判定された場合のみ、実際に同名マスターが2件以上存在するかをライブ確認する
  // (曖昧なものだけ止める、decision-maker承認済み方針)。単一フィールド等価検索のため
  // 複合インデックス不要。
  const collisionSnap = await deps.firestore
    .collection(MASTER_PATHS.customers)
    .where('name', '==', name)
    .limit(2)
    .get();
  return collisionSnap.size > 1;
}
