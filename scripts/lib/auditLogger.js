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
  // #386 review C1: close 失敗 = in-flight write drop 可能性。silent にしない
  LOGGING_CLOSE_FAILED: 'force_reindex_logging_close_failed',
  // #386 review C2: loggingService が undefined = library API 変更検知。#384 再発予兆
  LOGGING_CLOSE_UNAVAILABLE: 'force_reindex_logging_close_unavailable',
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

/** test 用: cachedLogging に直接 instance を注入 (flushAndCloseLogging の検証用 @internal) */
function _setLoggingForTest(projectId, logging) {
  cachedLogging.set(projectId, logging);
}

/**
 * Cached Logging instance の gRPC channel を gracefully close する。
 *
 * 必要性 (#384):
 *   `Log.write()` の await が resolve しても内部 gRPC stream の post-processing が
 *   未完了の場合があり、`process.exit()` で event loop を即時停止すると in-flight
 *   write が drop される。`LoggingServiceV2Client.close()` を呼んで channel を
 *   gracefully close することで全 in-flight write の完了を保証する。
 *
 * 呼び出しタイミング: script 終了直前 (main の then/catch 内)。
 * Fail-open: close 失敗は無視 (script 終了処理を止めない invariant)。
 *
 * @returns {Promise<void>}
 */
async function flushAndCloseLogging() {
  const closes = [];
  for (const [projectId, logging] of cachedLogging.entries()) {
    // loggingService は @google-cloud/logging v11 の internal property だが、
    // public な Logging.close() が存在しないため唯一の graceful shutdown 経路。
    if (!logging.loggingService?.close) {
      // #386 review C2: API 変更検知。#384 と同じ silent drop の予兆として stderr に必ず残す
      _emitLoggingDiagnostic(EVENTS.LOGGING_CLOSE_UNAVAILABLE, projectId);
      continue;
    }
    closes.push(
      // 同期 throw も catch するため try で wrap (Promise.resolve は sync throw を変換しない)
      Promise.resolve()
        .then(() => logging.loggingService.close())
        .catch((closeErr) => {
          // #386 review C1: close 失敗 = in-flight write drop の可能性。
          // 本体終了は止めない (fail-open invariant) が診断情報は必ず残す
          _emitLoggingDiagnostic(EVENTS.LOGGING_CLOSE_FAILED, projectId, closeErr);
        }),
    );
  }
  await Promise.all(closes);
  cachedLogging.clear();
}

/** flushAndCloseLogging 内の診断情報出力 (silent failure 防止)。@internal */
function _emitLoggingDiagnostic(event, projectId, err) {
  try {
    const payload = {
      severity: SEVERITIES.WARNING,
      event,
      projectId,
      timestamp: new Date().toISOString(),
    };
    if (err !== undefined) {
      payload.errorMessage = err?.message ?? String(err);
      payload.errorCode = err?.code ?? null;
    }
    _safeWriteStderr(JSON.stringify(payload) + '\n');
  } catch (stringifyErr) {
    _safeWriteStderr(
      `${event}: projectId=${projectId} (stringify error: ${stringifyErr?.message})\n`,
    );
  }
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
    // resource: 'global' で project-level のシンプルな書き込み。
    // partialSuccess: true で 1 件 invalid でも他を drop しない (Codex Q1 推奨)。
    await log.write(log.entry(metadata, entryPayload), { partialSuccess: true });
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
  flushAndCloseLogging,
  EVENTS,
  SEVERITIES,
  LOG_NAME,
  VALID_SEVERITIES,
  _resetCacheForTest,
  _setLoggingForTest,
};
