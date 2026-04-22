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

/**
 * processingスタック救済の閾値 (ms): この時間を超えて processing 状態の
 * ドキュメントを rescue 対象とする。10 分 (Function タイムアウト 540s の ~2 倍バッファ)。
 */
export const STUCK_PROCESSING_THRESHOLD_MS = 10 * 60 * 1000;

/** rescue の pending 分岐で書き込む lastErrorMessage (運用監視 grep 依存、#360) */
export const STUCK_RESCUE_PENDING_MESSAGE = 'Processing timed out, retrying';

/**
 * rescue の error 分岐 lastErrorMessage prefix (運用監視 grep 依存、#360)。
 * 実際の値は `${STUCK_RESCUE_FATAL_MESSAGE_PREFIX} (N/M)` の形式で書き込む。
 * オペレータが error 状態の原因分類に grep するため、文字列契約を test で lock-in する。
 */
export const STUCK_RESCUE_FATAL_MESSAGE_PREFIX = 'Processing timed out, max retries exceeded';
