/**
 * searchIndexer が出力する、log-based metric(search_index_token_skipped / search_index_write_failed)の検知対象となる固定ログ文言 (Issue #984)
 *
 * 副作用のないモジュールに切り出しているのは、`scripts/setup-log-based-metrics.sh` の metric filter との一致を
 * 単体テスト(emulator・Firestore 初期化なし)で検証するため。文言だけを変更して filter が無音で外れる
 * (#981 と同型の失敗)のを防ぐ。変更する場合は metric filter と README/ドキュメントも同時に更新すること。
 *
 * どちらも `console.error` に**引数1個の単一文字列**で出す(第2引数を渡すとペイロード形状が変わり、
 * textPayload 前提の log-based metric に当たらなくなる)。
 */

/** サイズ超過(Firestore の 1MiB 上限)の高頻度トークンをスキップした */
export const TOKEN_SKIPPED_LOG = '[searchIndexer] token skipped: document size limit';

/** サイズ超過と判定できなかった索引書込みの失敗(サイズ超過以外の失敗全般。判定関数の外れは原因の一つ) */
export const INDEX_WRITE_FAILED_LOG = '[searchIndexer] index write failed';
