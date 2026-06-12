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

/**
 * 429/RESOURCE_EXHAUSTED 専用リトライ上限。
 *
 * 既存 MAX_RETRY_COUNT (5) は他 transient (network/timeout 等) に使用継続。
 * 429 系のみ別カウンタで Vertex AI quota 長期枯渇 (数十分〜数時間) を吸収する。
 * 2026-06-11 kanameone で 39 分間 quota 枯渇 → 21 件 error 確定の事象を予防。
 */
export const MAX_RETRY_COUNT_429 = 8;

/**
 * 429 系 retry delay 配列 (ms)。index = retry attempt - 1。
 *
 * 合計 horizon 約 3.5 時間 (39 分 quota 枯渇に対し十分なマージン)。
 * 初回 1 min は軽微 rate spike からの早期復帰用。
 */
export const RETRY_DELAYS_429_MS = [
  1 * 60 * 1000, //   1 min
  3 * 60 * 1000, //   3 min
  6 * 60 * 1000, //   6 min
  12 * 60 * 1000, //  12 min
  24 * 60 * 1000, //  24 min
  48 * 60 * 1000, //  48 min
  60 * 60 * 1000, //  60 min
  60 * 60 * 1000, //  60 min
] as const;

/**
 * 429 系 retry delay の jitter factor (±20%)。
 *
 * 複数 doc が同時に 429 を踏んだ際の thundering herd (一斉再 retry で再衝突) を防止。
 */
export const RETRY_JITTER_FACTOR = 0.2;

/**
 * error 状態を rescue 対象とする最低経過時間 (ms)。
 *
 * 1 時間未満の error は handleProcessingError 直後の可能性があり、
 * 429 retry policy で粘っている最中と誤認しないよう猶予を持たせる。
 */
export const ERROR_RESCUE_THRESHOLD_MS = 60 * 60 * 1000;

/**
 * error rescue 試行回数上限 (永続ループ防止)。
 *
 * 3 回 rescue しても回復しない doc は構造的問題ありとみなし手動介入。
 * 既存フィールド名衝突回避のため `errorRescueCount` を新規導入 (未定義は 0 扱い)。
 */
export const MAX_ERROR_RESCUE_COUNT = 3;

/**
 * error rescue scan の最小実行間隔 (ms)。
 *
 * 既存 processOCR (1 min cadence) 内で 1 時間に 1 回だけ scan 実行。
 * `meta/ocrRescueState` doc の lastErrorRescueAt で制御。
 */
export const ERROR_RESCUE_SCAN_INTERVAL_MS = 60 * 60 * 1000;

/**
 * error rescue 後の retryAfter 待機時間 (ms)。
 *
 * rescue 直後の再 429 を回避するため pending 戻し時に retryAfter=now+10min を設定。
 */
export const ERROR_RESCUE_RETRY_AFTER_MS = 10 * 60 * 1000;

/**
 * error rescue 状態管理 doc path (Firestore)。
 *
 * lastErrorRescueAt timestamp を保持。1 時間 interval 制御に使用。
 */
export const RESCUE_STATE_DOC_PATH = 'meta/ocrRescueState' as const;
