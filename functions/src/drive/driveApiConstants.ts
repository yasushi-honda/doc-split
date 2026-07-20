/**
 * Drive API呼び出し共通定数(ADR-0022)
 *
 * `drive.file`スコープでShared Drive内のファイル/フォルダ操作を行うには
 * `supportsAllDrives: true`の付与が必須(実機検証済み、ADR-0022 Decision 2)。
 * この定数はFirestore/認証に依存しないため、`admin.firestore()`をモジュール
 * スコープで評価する`driveAuth.ts`(`gmailAuth.ts`経由で連鎖評価される)から
 * 意図的に分離している。find-or-create等、この定数だけを必要とする呼び出し元が
 * 不要なFirestore初期化依存を持ち込まないようにするため。
 */
export const SUPPORTS_ALL_DRIVES = { supportsAllDrives: true } as const;

/**
 * Drive API `q` パラメータ内の文字列リテラルをエスケープする。
 * `findOrCreateFolder.ts`(フォルダ名検索)と`exportDocument.ts`(appProperties検索)の
 * 両方から共有される。
 */
export function escapeQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
