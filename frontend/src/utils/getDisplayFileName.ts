/**
 * ドキュメントの表示用ファイル名を取得する
 *
 * #178: displayFileName が設定されていればそちらを返し、
 * 未設定の場合は fileName にフォールバックする。
 */
export function getDisplayFileName(doc: { fileName: string; displayFileName?: string }): string {
  return doc.displayFileName || doc.fileName;
}
