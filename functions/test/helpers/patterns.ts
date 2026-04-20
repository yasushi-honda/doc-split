/**
 * 契約テスト共通 regex パターン定数 (Issue #313 Q4)
 *
 * 目的: 複数の契約テストで重複していた `/\bsafeLogError\s*\(/` 等の inline 定義を
 * 一元化し、anchor 表記の食い違いによる silent drift を防ぐ。
 *
 * 依存方針: 他の helper (extractBraceBlock 等) に依存させず、純粋な RegExp 定数のみを
 * export する。循環依存リスクを避け、他 helper 側がパターン定数を取り込むのが自然になる。
 *
 * 関連:
 * - Issue #313 Q4 + E2 (PR #311 follow-up)
 * - session23 PR #325 (PR-2): `SAFE_LOG_ERROR_CALL` を handleProcessingErrorContract L32 /
 *   textCapProdInvariantContract L29 の top-level に昇格する先行対応を実施済。
 *   本 helper は 4 caller (上記 2 + summaryCatchLogErrorContract + aggregateCapLogErrorContract)
 *   の import 先を一本化する。
 */

/**
 * safeLogError 呼出の anchor。
 *
 * - `\b` で word boundary を取り、`functionName: 'xxxSafeLogError'` 等の偽陽性を避ける。
 * - `\s*` で `safeLogError (` / `safeLogError(` の両方を許容。
 * - 引数側は `extractParenBlock(..., SAFE_LOG_ERROR_CALL)` のような paren-nesting helper と
 *   組み合わせて scope を絞ること。
 */
export const SAFE_LOG_ERROR_CALL = /\bsafeLogError\s*\(/;
