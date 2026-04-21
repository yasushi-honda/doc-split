/**
 * OCR 処理関連の定数。
 *
 * side-effect-free モジュール。test 側から `admin.firestore()` の top-level
 * 実行を避けて import できるよう、定数のみをここに集約する (#196)。
 */

/** リトライ上限: handleProcessingError / rescueStuckProcessingDocs の両方で参照 */
export const MAX_RETRY_COUNT = 5;

/**
 * rescue 時の retryAfter 待機時間 (ms): stuck = 高負荷/quota 相当と見做し
 * handleProcessingError の quota 値と同じ 3 分 (#196)。
 */
export const STUCK_RESCUE_RETRY_AFTER_MS = 3 * 60 * 1000;
