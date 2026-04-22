/**
 * Cloud Logging audit logger for force-reindex script.
 *
 * GitHub Actions ランナーの stdout は対象環境の GCP Cloud Logging に
 * 自動取込されないため、明示的書き込みが必要。
 *
 * 設計方針:
 *   - Fail-open: Cloud Logging 書き込み失敗で本体処理は止めない (drift 復旧優先)
 *   - PII 除外: customerName, officeName, fileName 等は payload に含めない
 *   - Schema 固定: helper 側で schema を正規化、呼出元の自由 payload を許さない
 *   - Event 名と severity は EVENTS / SEVERITIES 定数経由で typo 防止
 *
 * 必要 IAM: 実行 SA に roles/logging.logWriter (運用手順は SOP §7 参照)
 *
 * 関連: ADR-0008 (データ保護), ADR-0015 (search_index silent failure policy),
 *       functions/src/utils/errorLogger.ts (in-functions Firestore error logging,
 *       本 helper とは sink が異なる)
 */

const LOG_NAME = 'force_reindex_audit';

/** Event 名 SSoT (typo による silent failure 防止) */
const EVENTS = Object.freeze({
  EXECUTED: 'force_reindex_executed',
  FAILED: 'force_reindex_failed',
  FATAL: 'force_reindex_fatal',
  BATCH_SUMMARY: 'force_reindex_batch_summary',
  AUDIT_LOG_FAILED: 'force_reindex_audit_log_failed',
  STARTUP_FAILED: 'force_reindex_startup_failed',
});

/** Severity SSoT (typo 防止)。Cloud Logging string severity と一致させる */
const SEVERITIES = Object.freeze({
  INFO: 'INFO',
  NOTICE: 'NOTICE',
  WARNING: 'WARNING',
  ERROR: 'ERROR',
  CRITICAL: 'CRITICAL',
});

/** runtime 検証用 (jsonPayload クエリ可読性のため string severity を採用) */
const VALID_SEVERITIES = new Set(Object.values(SEVERITIES));

/**
 * lazy 初期化: projectId ごとにキャッシュ。
 * 単一 cache 変数だと第 2 呼出以降の projectId が無視される silent bug が出るため
 * Map で per-project にキャッシュする。
 *
 * require 失敗 (依存未インストール等) は cache せず毎回 throw すると、
 * fail-open の loop 防止が無効化されるため、別 sentinel でキャッシュする。
 */
const cachedLogging = new Map();
let cachedRequireError = null;

function getLogging(projectId) {
  if (cachedRequireError) throw cachedRequireError;
  const existing = cachedLogging.get(projectId);
  if (existing) return existing;
  let LoggingClass;
  try {
    LoggingClass = require('@google-cloud/logging').Logging;
  } catch (err) {
    cachedRequireError = err;
    throw err;
  }
  const logging = new LoggingClass({ projectId });
  cachedLogging.set(projectId, logging);
  return logging;
}

/** test/inter-call 状態リセット用 (@internal) */
function _resetCacheForTest() {
  cachedLogging.clear();
  cachedRequireError = null;
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
 * defensive 多層 catch:
 *   - JSON.stringify は err.code に bigint/object を持つ場合に例外可能
 *   - process.stderr.write は EPIPE (CI ログ収集側切断等) で例外可能
 *   - いずれの失敗も無視: fail-open invariant が最優先 (本体処理を止めない)
 */
function _failOpen(err) {
  try {
    const failurePayload = {
      severity: SEVERITIES.WARNING,
      event: EVENTS.AUDIT_LOG_FAILED,
      errorMessage: err?.message ?? String(err),
      errorCode: err?.code ?? null,
      timestamp: new Date().toISOString(),
    };
    _safeWriteStderr(JSON.stringify(failurePayload) + '\n');
  } catch (stringifyErr) {
    _safeWriteStderr(
      `audit_log_failed: ${err?.message ?? String(err)} (stringify error: ${stringifyErr?.message})\n`,
    );
  }
  return { ok: false, error: err };
}

/** stderr write の EPIPE 等を握り潰す last-resort writer */
function _safeWriteStderr(line) {
  try {
    process.stderr.write(line);
  } catch {
    // 監査ログの書き込み失敗を更に記録する手段がないため、ここで沈める。
    // fail-open invariant 維持が最優先 (本体処理を止めない)。
  }
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
  SEVERITIES,
  LOG_NAME,
  VALID_SEVERITIES,
  _resetCacheForTest,
};
