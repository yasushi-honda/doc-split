/**
 * OCR結果Storageオブジェクト孤児化クリーンアップの純粋ロジック (Issue #625)
 *
 * `ocr-results/{docId}/{ocrRunId}.txt` はrun毎に分離されているため、reprocessの度に
 * 新しいrunが新しいパスへオブジェクトを作成し、旧オブジェクトは誰にも削除されず孤児化する。
 * FE側のreprocessクリア処理(getReprocessClearFields、frontend/src/hooks/useDocuments.ts)は
 * `ocrResultUrl`フィールドをreprocess開始時に即座にdeleteFieldするため、Firestoreの
 * フィールド値を頼りに旧URLを特定する設計は機能しない(Codexセカンドオピニオンで指摘)。
 * 本モジュールの純粋関数は、Cloud Storage自体をsource of truthとして扱う設計を支える。
 *
 * firebase-admin初期化なしで検証できるよう、ocrProcessor.tsとは独立したモジュールに
 * 分離する(summaryPromptBuilder.ts等、このディレクトリの既存パターンを踏襲)。
 */

/**
 * OCR結果Storageオブジェクトのlist/delete操作を抽象化するアダプタ。
 * テスト時にfake実装へ差し替えることで、実Storageに触れずcleanup/補償削除の
 * 呼出し配線を検証できる。
 */
export interface OcrResultStorageAdapter {
  listObjectNames(prefix: string): Promise<string[]>;
  deleteObject(objectName: string): Promise<void>;
}

/**
 * OCR結果Storageオブジェクトのクリーンアップ対象を計算する。
 *
 * `ocr-results/{docId}/` 配下の全オブジェクト名から、残すべき1件(keepObjectName)を
 * 除いた削除対象を返す。keepObjectNameがnullの場合は全件削除対象とする(今回の実行で
 * Storage保存が発生しなかった=OCR結果がFirestore本体にインライン保持されている場合)。
 */
export function computeOcrResultObjectsToDelete(
  allObjectNames: string[],
  keepObjectName: string | null
): string[] {
  return allObjectNames.filter((name) => name !== keepObjectName);
}

/**
 * 補償削除の安全確認 (Codexセカンドオピニオン指摘反映)。
 *
 * 最終transactionのthrowは「未commitの確証」にはならない(ローカルにはエラーが
 * 返っても実際にはサーバー側でcommit済みの場合がありうる)。再読みしたドキュメントが
 * `status: 'processed'` かつ `ocrRunId` が今回のrunと一致する場合、このrunは実際には
 * 採用されていた(transactionは実は成功していた)と判断し、削除をスキップする。
 */
export function shouldSkipCompensatingDelete(
  docExists: boolean,
  docStatus: string | undefined,
  docOcrRunId: string | undefined,
  ocrRunId: string
): boolean {
  return docExists && docStatus === 'processed' && docOcrRunId === ocrRunId;
}

/**
 * 成功パスcleanupの安全確認 (/code-review low 指摘反映)。
 *
 * 「このrunの最終transactionが成功した」ことは、cleanup実行**時点**でこのrunが依然
 * 最新であることを保証しない。reprocess等で後続run(次のocrRunId)が既にclaimしている
 * 場合、後続runは自分自身の成功時にownの成功パスcleanupを実行し「後続run自身のオブジェクト
 * のみkeep・他は削除」する。この状態でさらに先行runのcleanupが「先行run自身のオブジェクト
 * のみkeep」で実行されると、後続runが直近書き込んだ有効なオブジェクトを誤削除し、
 * Firestoreの`ocrResultUrl`が指す実体が消失する(孤児化より深刻な退行)。
 *
 * cleanup実行直前にドキュメントを再読みし、`ocrRunId`が既に別の値に変わっている
 * (=後続runにより上書きされた)場合はcleanup自体をスキップする(後続run自身の
 * cleanup呼出しに委ねる)。ドキュメントが削除されている場合もスキップする(削除時の
 * 孤児化はdeleteDocument.ts側の別経路、本Issueのスコープ外)。
 */
export function shouldSkipSuccessCleanup(
  docExists: boolean,
  docOcrRunId: string | undefined,
  ocrRunId: string
): boolean {
  return !docExists || docOcrRunId !== ocrRunId;
}
