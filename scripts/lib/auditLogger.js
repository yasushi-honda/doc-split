/**
 * Cloud Logging audit logger for force-reindex script (Issue #239)
 *
 * GitHub Actions ランナーの stdout は対象環境の GCP Cloud Logging に
 * 自動取込されないため、明示的書き込みが必要 (PR #235 review evaluator 指摘)。
 *
 * 設計方針:
 *   - Fail-open: Cloud Logging 書き込み失敗で本体処理は止めない (drift 復旧優先)
 *   - PII 除外: customerName, officeName, fileName 等は payload に含めない
 *   - Schema 固定: helper 側で schema を正規化、呼出元の自由 payload を許さない
 *   - Event 名は EVENTS 定数経由で typo 防止
 *
 * 必要 IAM: 実行 SA に roles/logging.logWriter (3 環境設定済、2026-04-22 確認)
 *
 * 関連: ADR-0008 (データ保護), ADR-0015 (search_index silent failure policy),
 *       functions/src/utils/errorLogger.ts (in-functions Firestore error logging,
 *       本 helper とは sink が異なる)
 *
 * 既知の制約 (Follow-up):
 *   - --all-drift で 1000+ docs を処理する際、log.write を per-doc で直列実行する。
 *     大規模 drift 時は batch flush (log.write([entries...])) で 10-50x 高速化可能。
 *     通常 0-10 件運用では実害なし、ADR-0015 再評価トリガー発動レベルで顕在化。
 *     別 Issue で対応予定。
 */

const LOG_NAME = 'force_reindex_audit';

/** Event 名 SSoT (typo による silent failure 防止) */
const EVENTS = Object.freeze({
  EXECUTED: 'force_reindex_executed',
  FAILED: 'force_reindex_failed',
  FATAL: 'force_reindex_fatal',
  BATCH_SUMMARY: 'force_reindex_batch_summary',
  AUDIT_LOG_FAILED: 'force_reindex_audit_log_failed',
});

/**
 * Cloud Logging string severity (jsonPayload クエリ可読性のため string 推奨)
 */
const VALID_SEVERITIES = new Set(['INFO', 'NOTICE', 'WARNING', 'ERROR', 'CRITICAL']);

/**
 * lazy 初期化: projectId ごとにキャッシュ。
 * 単一 cache 変数だと第 2 呼出以降の projectId が無視される silent bug が出るため
 * Map で per-project にキャッシュする。
 */
const cachedLogging = new Map();
function getLogging(projectId) {
  const existing = cachedLogging.get(projectId);
  if (existing) return existing;
  const { Logging } = require('@google-cloud/logging');
  const logging = new Logging({ projectId });
  cachedLogging.set(projectId, logging);
  return logging;
}

/** test/inter-call 状態リセット用 (@internal) */
function _resetCacheForTest() {
  cachedLogging.clear();
}

/**
 * force-reindex 実行結果を Cloud Logging に書き込む。
 *
 * @param {Object} payload - audit 内容
 * @param {string} payload.event - EVENTS 定数のいずれか
 * @param {string} payload.severity - VALID_SEVERITIES のいずれか
 * @param {string} [payload.mode] - 'doc-id' | 'all-drift'
 * @param {boolean} [payload.dryRun] - --execute 未指定時は true
 * @param {string} [payload.docId] - 対象ドキュメント ID (PII を含まない不透明 ID)
 * @param {Object} [payload.counts] - { tokensAdded, tokensRemoved, processed, drifted, ... }
 * @param {Object} [payload.hashes] - { oldHash, newHash } (drift detection 値、PII ではない)
 * @param {Error|Object} [payload.error] - errorCode/errorMessage/stage を抽出 (stack は除外)
 * @param {Object} ctx - 実行コンテキスト
 * @param {string} ctx.projectId - 必須。対象環境 (FIREBASE_PROJECT_ID)
 * @param {string} [ctx.executedBy] - 実行者 identity。GITHUB_ACTOR (Actions) or USER (local) を想定
 * @param {Object} [options]
 * @param {Function} [options.loggingFactory] - test 用 DI: (projectId) => Logging instance (@internal)
 * @returns {Promise<{ ok: boolean, error?: Error }>} fail-open のため reject しない
 */
async function writeForceReindexAuditLog(payload, ctx, options = {}) {
  const validation = _validate(payload, ctx);
  if (validation) return _failOpen(validation);

  const entryPayload = _buildPayload(payload, ctx);

  try {
    const factory = options.loggingFactory || getLogging;
    const logging = factory(ctx.projectId);
    const log = logging.log(LOG_NAME);
    const metadata = { severity: payload.severity, resource: { type: 'global' } };
    await log.write(log.entry(metadata, entryPayload));
    return { ok: true };
  } catch (err) {
    return _failOpen(err);
  }
}

/** 入力検証: 違反があれば Error を返す、OK なら null */
function _validate(payload, ctx) {
  if (!ctx?.projectId) return new Error('auditLogger: ctx.projectId is required');
  if (!payload?.event) return new Error('auditLogger: payload.event is required');
  if (!VALID_SEVERITIES.has(payload?.severity)) {
    return new Error(`auditLogger: invalid severity: ${payload?.severity}`);
  }
  return null;
}

/** payload 正規化 (PII 除外、stack 除外、undefined フィールド除外) */
function _buildPayload(payload, ctx) {
  const { event, mode, dryRun, docId, counts, hashes, error } = payload;
  const out = {
    event,
    projectId: ctx.projectId,
    timestamp: new Date().toISOString(),
  };
  if (mode !== undefined) out.mode = mode;
  if (dryRun !== undefined) out.dryRun = Boolean(dryRun);
  if (docId !== undefined) out.docId = docId;
  if (counts !== undefined) out.counts = counts;
  if (hashes !== undefined) out.hashes = hashes;
  if (ctx.executedBy !== undefined) out.executedBy = ctx.executedBy;
  if (error !== undefined) out.error = _normalizeError(error);
  return out;
}

/**
 * fail-open: stderr に構造化 JSON を出力して継続。本体処理は止めない。
 * Cloud Logging への二度目の書き込みは試みない (loop 防止)。
 *
 * defensive: JSON.stringify が err.code に bigint/object 等を持つ場合に例外可能。
 * fail-open の invariant を守るため、stringify 失敗時は last-resort の text 出力に fallback。
 */
function _failOpen(err) {
  try {
    const failurePayload = {
      severity: 'WARNING',
      event: EVENTS.AUDIT_LOG_FAILED,
      errorMessage: err?.message ?? String(err),
      errorCode: err?.code ?? null,
      timestamp: new Date().toISOString(),
    };
    process.stderr.write(JSON.stringify(failurePayload) + '\n');
  } catch (stringifyErr) {
    process.stderr.write(
      `audit_log_failed: ${err?.message ?? String(err)} (stringify error: ${stringifyErr?.message})\n`,
    );
  }
  return { ok: false, error: err };
}

/** Error / 任意 object から audit に載せるフィールドだけ抽出 (stack は監査価値なく除外) */
function _normalizeError(err) {
  if (!err) return null;
  return {
    code: err.code ?? null,
    message: err.message ?? String(err),
    stage: err.reindexStage ?? err.stage ?? null,
  };
}

module.exports = {
  writeForceReindexAuditLog,
  EVENTS,
  LOG_NAME,
  VALID_SEVERITIES,
  _resetCacheForTest,
};
