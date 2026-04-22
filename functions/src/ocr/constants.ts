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
 * ドキュメントを rescue 対象とする。10 分。
 * Function タイムアウト上限 540s (9 分) より長く設定し、真にタイムアウトした
 * ドキュメントのみを対象化する (正常終了間際の誤救済を避ける)。
 */
export const STUCK_PROCESSING_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * rescue の pending 分岐で書き込む lastErrorMessage。
 * ErrorsPage の UI 表示と Cloud Logging 検索で参照される文字列契約。
 * `as const` で literal 型を保持し、consumer が assert できるようにする。
 */
export const STUCK_RESCUE_PENDING_MESSAGE = 'Processing timed out, retrying' as const;

/**
 * rescue の error 分岐 lastErrorMessage prefix。
 * 実際の値は `${STUCK_RESCUE_FATAL_MESSAGE_PREFIX} (N/M)` の形式で書き込む。
 * 運用監視 (ErrorsPage フィルタ / Cloud Logging alert) がこの substring を参照するため、
 * 変更すると外部監視が壊れる。test で `.include()` lock-in してドリフトを検知する。
 */
export const STUCK_RESCUE_FATAL_MESSAGE_PREFIX = 'Processing timed out, max retries exceeded' as const;
