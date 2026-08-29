/**
 * 複数人記載FAX検出の共有述語(kanameone現場要件、PR-A、2026-08-30)
 *
 * 「複数顧客FAX複製機能」(`functions/src/ocr/faxDuplication.ts`)の複製発火条件と
 * 厳密に同一の基準で「1つの書類に複数人が記載されている可能性」を検出する。BE(検出結果の
 * 永続化、`functions/src/ocr/ocrProcessor.ts`)・棚卸しスクリプト
 * (`scripts/audit-fax-duplication-inventory.ts`)双方から参照するため shared/ に置く
 * (`shared/customerIdentity.ts` と同じ設計)。
 *
 * フィルタ条件は `faxDuplication.ts` の `planFaxDuplication()` 内の候補フィルタと同一
 * (matchType==='exact' && !isDuplicate && !sameNameCollisionNames.has(name.trim())、
 * score降順ソート後customerIdでfirst-wins重複排除)。両者のparityは
 * `functions/test/multiCustomerDetection.test.ts` で契約テストする。
 *
 * 複製処理と異なり、本モジュールは「複製するかどうか」の判断(flagEnabled/alreadyDistributed/
 * alreadyConfirmedOrVerified等のガード)を一切持たない。「この書類に複数人書かれているように
 * 見えるか」という事実だけを返す純粋関数群。
 */

/** 「複数人記載」と判定する distinct-exact 候補数のしきい値。 */
export const MULTI_CUSTOMER_MIN_COUNT = 2;

/**
 * 検出述語が必要とする候補の最小フィールド集合。呼出元(BE の `CustomerCandidate`、FE の
 * `CustomerCandidateInfo`)はいずれもこれより多いフィールドを持つが、TypeScript の構造的
 * 部分型により余剰フィールドは `selectDistinctExactCandidates` の戻り値でもそのまま保持される。
 */
export interface MultiCustomerCandidateLike {
  customerId: string | null;
  customerName: string;
  score: number;
  matchType: string;
  isDuplicate: boolean;
}

/**
 * exact マッチ && 非 isDuplicate && 同名衝突していない候補を、score 降順にソートした後
 * customerId で first-wins 重複排除して返す(元の候補オブジェクトを保持したまま)。
 * `faxDuplication.ts` の `planFaxDuplication()` 内の候補フィルタと厳密に同一のロジック
 * (移植元、挙動不変)。
 *
 * ジェネリックにしているのは、呼出元が `careManagerName` 等の追加フィールドを持つ候補を渡した
 * 場合でもそれを失わずに返すため(`faxDuplication.ts` が複製先へ割り当てる `careManagerName` の
 * 引き継ぎに必要)。
 */
export function selectDistinctExactCandidates<C extends MultiCustomerCandidateLike>(
  candidates: readonly C[],
  sameNameCollisionNames: ReadonlySet<string>
): C[] {
  const exactNonDuplicate = candidates
    .filter(
      (c): c is C =>
        c.customerId != null &&
        c.customerId.length > 0 &&
        c.matchType === 'exact' &&
        !c.isDuplicate &&
        !sameNameCollisionNames.has(c.customerName.trim())
    )
    .sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const result: C[] = [];
  for (const c of exactNonDuplicate) {
    const id = c.customerId as string;
    if (!seen.has(id)) {
      seen.add(id);
      result.push(c);
    }
  }
  return result;
}

/**
 * `selectDistinctExactCandidates` の簡易版(customerId の配列だけが欲しい呼出元向け)。
 */
export function selectDistinctExactCustomerIds(
  candidates: readonly MultiCustomerCandidateLike[],
  sameNameCollisionNames: ReadonlySet<string>
): string[] {
  return selectDistinctExactCandidates(candidates, sameNameCollisionNames).map(
    (c) => c.customerId as string
  );
}

/** distinct-exact 候補が `MULTI_CUSTOMER_MIN_COUNT` 件以上あれば「複数人記載の可能性」ありと判定する。 */
export function isMultiCustomerDetected(distinctExactCustomerIds: readonly string[]): boolean {
  return distinctExactCustomerIds.length >= MULTI_CUSTOMER_MIN_COUNT;
}

/**
 * Firestore `documents/{docId}` に書き込む検出結果フィールド(`shared/types.ts` の `Document`
 * インターフェース参照)。`multiCustomerDetection` フラグ有効時のみ書き込む(呼出元が
 * `Partial<MultiCustomerDetectionFields>` として扱い、無効時は空オブジェクトを渡すことで
 * キー自体を書き込まない設計にする)。
 */
export interface MultiCustomerDetectionFields {
  multiCustomerDetected: boolean;
  multiCustomerCount: number;
}

/**
 * `MultiCustomerDetectionFields` を組み立てる。`enabled:false` の場合は空オブジェクトを返す
 * (呼出元がこれを spread することで、フラグ無効時はキー自体を書き込まない設計にする)。
 *
 * 呼出元(`functions/src/ocr/ocrProcessor.ts`)側の配線契約テスト
 * (`ocrProcessorOcrResultCleanupWiringContract.test.ts`)が「try{ から
 * applyOcrCompletionTransaction呼出までの間に `}` を含んではならない」という制約を
 * ソース文字列レベルで検証しているため、呼出元では中括弧を伴うインライン処理(IIFE・
 * オブジェクトリテラル)を書けない。本関数を名前付き関数呼び出し1行で完結させることで
 * その制約を満たす。
 */
export function buildMultiCustomerDetectionFields(
  candidates: readonly MultiCustomerCandidateLike[],
  sameNameCollisionNames: ReadonlySet<string>,
  enabled: boolean
): Partial<MultiCustomerDetectionFields> {
  if (!enabled) return {};
  const distinctIds = selectDistinctExactCustomerIds(candidates, sameNameCollisionNames);
  return { multiCustomerDetected: isMultiCustomerDetected(distinctIds), multiCustomerCount: distinctIds.length };
}
