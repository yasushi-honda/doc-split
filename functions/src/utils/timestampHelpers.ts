/**
 * Firestore Timestamp 変換ヘルパー (shared/timestampHelpers.ts への re-export)。
 *
 * #334 で実装を shared/ に昇格。BE 既存 import path (`../utils/timestampHelpers`) を
 * 維持するためこのモジュールは re-export のみに留める。
 * star export で shared 側に新エクスポート追加時も自動追従する (re-export drift 防止)。
 *
 * 注: `../../../shared/` 前提 (functions/src/utils/ から 3 hops up)。functions/ の
 * ディレクトリ構造変更時は shared 側のパス解決もあわせて再検証すること。
 */

export * from '../../../shared/timestampHelpers';
