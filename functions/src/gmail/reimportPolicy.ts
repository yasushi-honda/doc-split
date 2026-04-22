/**
 * Gmail 添付ファイルの重複/再取り込み判定 pure helper
 *
 * Exports:
 *   - evaluateReimportDecision: 主判定関数 (6 分岐を決定)
 *   - resolveExistingLogData: gmailLogs 優先順位の共有 helper
 *   - ReimportVerdict / ReimportDecisionInput / ReimportDecision: 公開型
 *
 * checkGmailAttachments.ts の processAttachment 内で行われていた hash 重複判定と
 * isSplitSource=true 再取り込み許可ロジックを I/O 非依存の純粋関数として抽出。
 * production (checkGmailAttachments.ts) と test (gmailAttachmentIntegration.test.ts)
 * で同一ロジックを共有し、source drift による silent regression を防ぐ (Issue #375)。
 *
 * I/O 境界の設計:
 *   - Firestore query 実行は caller 側 (production は checkGmailAttachments.ts、
 *     test は integration test の describe blocks)
 *   - 本 helper は snapshot.data() 相当の plain data オブジェクトのみ受取
 *   - gmailLogs と uploadLogs の優先順位 (gmailLogs 優先) は本 helper 内で表現
 */
export type ReimportVerdict = 'new' | 'skip' | 'reimport';

export interface ReimportDecisionInput {
  /**
   * gmailLogs collection の hash 一致ドキュメント .data() 戻り値。
   * 一致なしの場合は null (空 QuerySnapshot を caller 側で null にマッピング)。
   */
  existingGmailLogData: { fileUrl?: string } | null;
  /**
   * uploadLogs collection の hash 一致ドキュメント .data() 戻り値。
   */
  existingUploadLogData: { fileUrl?: string } | null;
  /**
   * fileUrl に紐づく documents collection 全件の .data() 配列。
   * gmailLog/uploadLog いずれにも fileUrl が存在する場合のみ caller が populate する。
   */
  relatedDocsData: ReadonlyArray<{ isSplitSource?: boolean }>;
}

export interface ReimportDecision {
  verdict: ReimportVerdict;
  /**
   * 既存 fileUrl。verdict 別の値:
   *   - 'new'      : 常に null (hash 一致なし)
   *   - 'skip'     : 既存 log に fileUrl がある場合は non-null (アクティブ doc あり等)、
   *                  fileUrl 欠損 legacy record の場合は null
   *   - 'reimport' : 常に non-null string (再取り込み対象ファイル)
   * caller は `verdict === 'reimport'` の場合のみ使用想定 (production の log 出力)。
   */
  fileUrl: string | null;
}

/**
 * gmailLogs / uploadLogs 両方の hash 一致 log から優先順位に従って 1 件を返す。
 *
 * gmailLogs 優先 (checkGmailAttachments.ts processAttachment の旧 inline 実装で
 * `!existingGmailLog.empty ? gmail : upload` のパターンだった判定を集約)。
 * caller は戻り値の `.fileUrl` を用いて関連 documents query の発行要否を判定できる。
 * evaluateReimportDecision 本体でも同じロジックを使うため、production / test / helper
 * 内部の 3 箇所で優先順位 drift を構造的に防ぐ (Issue #375 evaluator MEDIUM 対応)。
 */
export function resolveExistingLogData(
  existingGmailLogData: { fileUrl?: string } | null,
  existingUploadLogData: { fileUrl?: string } | null,
): { fileUrl?: string } | null {
  return existingGmailLogData ?? existingUploadLogData;
}

/**
 * Gmail 添付ファイルの hash 重複判定と isSplitSource=true 再取り込み許可を決定する。
 *
 * 判定フロー (PR #199 の旧 inline 実装を本 helper に集約、Issue #375):
 * 1. gmailLogs / uploadLogs 両方に hash 一致なし → new (新規処理対象)
 * 2. 片方以上に hash 一致あり:
 *    a. gmailLogs 優先で existing log を採用
 *    b. fileUrl 欠損 → skip (legacy record 後方互換)
 *    c. fileUrl あり + アクティブ document (isSplitSource != true) が 1 件以上 → skip
 *    d. fileUrl あり + 関連 documents が全て isSplitSource=true または 0 件 → reimport
 */
export function evaluateReimportDecision(
  input: ReimportDecisionInput,
): ReimportDecision {
  const { existingGmailLogData, existingUploadLogData, relatedDocsData } = input;

  if (existingGmailLogData === null && existingUploadLogData === null) {
    return { verdict: 'new', fileUrl: null };
  }

  const existingLogData = resolveExistingLogData(
    existingGmailLogData,
    existingUploadLogData,
  );
  // 型ガード: 上の早期 return で両方 null はカバー済だが、将来の refactor 耐性として
  // 本関数内で local にも null を弾くことで「早期 return 削除 → silent に skip 返却」
  // の regression を防ぐ (#378 silent-failure-hunter H1 対応)。
  if (existingLogData === null) {
    return { verdict: 'new', fileUrl: null };
  }
  const existingFileUrl = existingLogData.fileUrl;

  if (!existingFileUrl) {
    return { verdict: 'skip', fileUrl: null };
  }

  const hasActiveDocs = relatedDocsData.some((doc) => !doc.isSplitSource);
  return {
    verdict: hasActiveDocs ? 'skip' : 'reimport',
    fileUrl: existingFileUrl,
  };
}
