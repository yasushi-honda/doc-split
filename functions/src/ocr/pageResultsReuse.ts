/**
 * 既存pageResultsの再利用可否を判定する純粋関数。(Issue #526 D3)
 *
 * processDocument()は通常、PDFをStorageからダウンロードしページ単位でOCRを実行するが、
 * ドキュメントが既に有効なpageResultsを保持している場合(手動分割で生成された子ドキュメント、
 * 親の`pageResults`から該当ページ分を継承済み)、そのOCRを再実行せず既存テキストを再利用する
 * ことでコスト・レイテンシを削減する。
 *
 * 再利用対象とみなす条件は以下の3点全て:
 * 1. `parentDocumentId`が設定されている(#445で確立済みのprovenanceフィールド、分割子
 *    ドキュメントであることの明示シグナル)。構造(連番/非空)だけを見て判定すると、将来
 *    マスターデータ移行や手動データ修復スクリプトが偶然この構造を満たすpageResultsを
 *    書き込んだ場合に、意図せずフルOCRがスキップされてしまう(evaluator指摘)
 * 2. ページ番号が1..Nの連番で揃っている
 * 3. 各ページのtextが非空
 *
 * #524の手動再処理(`getReprocessClearFields()`)は`pageResults`自体をdeleteFieldで
 * 削除するため、このパスに到達する時点でpageResultsが存在するのは分割子ドキュメント
 * 由来のケースに限られる(条件1はこれを構造的に保証する)。
 */

export interface PageResultsReuseCheck {
  reusable: boolean;
  /** reusable=falseの場合のみ設定 (ログ用) */
  reason?: string;
}

interface CandidatePage {
  pageNumber?: unknown;
  text?: unknown;
}

export function validatePageResultsForReuse(
  pageResults: unknown,
  parentDocumentId: unknown
): PageResultsReuseCheck {
  if (typeof parentDocumentId !== 'string' || parentDocumentId.length === 0) {
    return { reusable: false, reason: 'parentDocumentId is missing (not a split child)' };
  }

  if (!Array.isArray(pageResults) || pageResults.length === 0) {
    return { reusable: false, reason: 'pageResults is missing or empty' };
  }

  const pages = pageResults as CandidatePage[];

  const pageNumbers = pages.map((p) => p.pageNumber);
  const isSequential =
    pageNumbers.every((n): n is number => typeof n === 'number') &&
    [...(pageNumbers as number[])]
      .sort((a, b) => a - b)
      .every((n, i) => n === i + 1);
  if (!isSequential) {
    return { reusable: false, reason: 'pageNumber is not a sequential 1..N series' };
  }

  const allNonEmpty = pages.every(
    (p) => typeof p.text === 'string' && p.text.trim().length > 0
  );
  if (!allNonEmpty) {
    return { reusable: false, reason: 'one or more pages have empty text' };
  }

  return { reusable: true };
}
