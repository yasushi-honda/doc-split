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
 */

/**
 * 顧客名の sentinel 値。OCR 未マッチ・未判定状態を示すため、選択として無効扱いにする。
 */
export const CUSTOMER_INVALID_SENTINELS: ReadonlySet<string> = new Set(['未判定', '不明顧客']);

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
    counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
}
