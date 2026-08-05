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
 *
 * 上記1-4の判定順序(sentinel→name↔id乖離→customerConfirmed優先のdual-read)は
 * `shared/customerIdentity.ts`の`precheckCustomerIdentity()`へ移設した(現場管理者への
 * 「同姓同名」プロアクティブ通知UI追加、2026-07-26。FEバッジと同一実装を共有するため)。
 * 本関数はその判定に「衝突確認が必要」と判定された場合のみFirestoreへライブクエリを撃つ
 * BE固有の短絡ロジックを残す。挙動・外部契約(戻り値boolean)は不変。
 */

import type * as admin from 'firebase-admin';
import { precheckCustomerIdentity } from '../../../shared/customerIdentity';
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
  const pre = precheckCustomerIdentity(doc, { customerMasterName: deps.customerMasterName });
  if (pre.outcome === 'unconfirmed') {
    return true; // sentinel値・空文字、またはcustomerId↔name乖離
  }
  if (pre.outcome === 'confirmed') {
    return false;
  }

  // 未確定と判定された場合のみ、実際に同名マスターが2件以上存在するかをライブ確認する
  // (曖昧なものだけ止める、decision-maker承認済み方針)。単一フィールド等価検索のため
  // 複合インデックス不要。
  //
  // trim不整合の残存リスク(Codex review-diff P2指摘、2026-07-26): このクエリは
  // Firestore上のマスター`name`の生値との完全一致検索のため、マスター名に前後空白が
  // 付与されている場合(FE`findSameNameCollisionNames()`はtrim済みで衝突検出するのに
  // このクエリは0件ヒットで通過する)、FE通知とBEブロックの挙動が食い違いうる。全件
  // フェッチしてJS側でtrim比較する案は複合インデックス不要という本設計のメリットを
  // 失うため採用せず、`check-customer-master-integrity.js`のwhitespaceIssues検出
  // (PR #732、本番マスターデータで前後空白付きnameは0件と実測済み)による継続監視で
  // 許容する判断とした。
  //
  // 内部スペース表記ゆれの残存リスク(Issue #774、2026-08-06追記): 上記と同種のギャップが
  // 姓名間スペースの有無(例:「鬼頭 京子」/「鬼頭京子」)にも存在する
  // (`shared/customerIdentity.ts`の`findSameNameCollisionNames`はスペース正規化して衝突検出
  // するが、このクエリは生の`name`完全一致のため検出できない)。ただし本件は上記のtrim
  // 不整合とは異なりスキーマ変更(`normalizedName`フィールド追加等)の検討も一度行った上で、
  // 同じ判断(全件フェッチ回避・継続監視で許容)を踏襲する決定とした。理由:
  // ①既知の実例(PR #741監査、kanameone2組)は`merge-notation-duplicate-masters.ts --execute`
  // (2026-07-27実行、run 30257992453)で統合済み、cocoroは対象0組
  // ②残る除外8組(furigana食い違い等で自動統合対象外)も精査済みで、別人が表記ゆれのみで
  // 衝突した実例はこれまで一度も確認されていない(1件のみ読み表記自体の違い(ズ/ヅ)で実害なし)
  // ③`merge-notation-duplicate-masters.ts`/`check-customer-master-integrity.js`は
  // `workflow_dispatch`専用で定期実行の自動化はまだ無いため、次回手動監査までの間に新規の
  // 表記ゆれが発生する理論上のリスクは残る。実例が確認された場合は速やかにP1へ昇格し
  // 再検討する(Issue #774参照)。
  const collisionSnap = await deps.firestore
    .collection(MASTER_PATHS.customers)
    .where('name', '==', pre.trimmedName)
    .limit(2)
    .get();
  return collisionSnap.size > 1;
}
