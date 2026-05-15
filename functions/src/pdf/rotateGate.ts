/**
 * Issue #445 PR-D4 S1-5: rotate gate helper (ADR-0016 MUST 3 拡張).
 *
 * PR-D4 backfilled doc の rotate を `confidence === 'derived-bytes-verified'` のみ allow
 * する fail-closed ガード。`provenanceBackfill` が malformed / unknown / 低信頼度 confidence
 * の場合は reject 理由文字列を返却し、callable 側で `failed-precondition` HttpsError に
 * wrap する設計 (Codex MCP 2nd review Important 1 + Suggestion 1 反映で pure helper 化)。
 *
 * 検証スコープ (production gate = Phase D Stage 1 最小 invariant 共有):
 * - 型: provenanceBackfill is undefined (absent) | plain object | それ以外で reject
 * - method: 'legacy-observed' 固定値
 * - confidence: 'derived-bytes-verified' allow / それ以外 reject
 * - evidence: derived-bytes-verified の場合は parentExists / parentSha256MatchedAtBackfill /
 *   childSha256ComputedAtBackfill 全 true (Codex 2nd review Important 1 反映、confidence
 *   文字列だけで allow しない)
 *
 * 戻り値:
 * - `null`: rotate 許可 (legacy verified / 完全な derived-bytes-verified)
 * - `string`: rotate reject 理由 (failed-precondition で throw)
 *
 * 参照: docs/adr/0016-document-identity-and-provenance.md MUST 3 拡張 / shared/types.ts
 * BackfillConfidence / ProvenanceBackfillMetadata
 */

/**
 * provenanceBackfill が plain object かどうかを判定。
 * array や Date / Buffer 等は plain object として扱わない (Firestore 経由 deserialize で
 * plain object に正規化される前提だが防御的に判定)。
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * rotate gate: provenanceBackfill 存在時は confidence === 'derived-bytes-verified' + 完全
 * evidence のみ allow。fail-closed 設計で malformed (null 含む) や未知 confidence は reject。
 *
 * @param raw - Firestore document.provenanceBackfill (unknown 型で受け取り runtime guard)
 * @returns rotate 許可なら null、reject 理由文字列ならその内容
 */
export function shouldRejectRotateForBackfill(raw: unknown): string | null {
  // 1. absent (undefined) = PR-D2/D3 verified split-time origin、allow
  if (raw === undefined) return null;

  // 2. null = malformed (古い書込経路 / 手動修復で混入の可能性)、fail-closed reject
  if (raw === null) {
    return 'provenanceBackfill is null (malformed); rotate requires either field absent (verified split-time origin) or a complete backfilled record with confidence "derived-bytes-verified"';
  }

  // 3. plain object 以外の型 (string / number / boolean / array / Buffer 等) は reject
  if (!isPlainObject(raw)) {
    return `provenanceBackfill has unexpected type "${typeof raw}"; rotate reject (malformed)`;
  }

  // 4. method 検証: 'legacy-observed' 固定値以外は reject
  const method = raw.method;
  if (typeof method !== 'string') {
    return 'provenanceBackfill.method is missing or non-string; rotate reject (malformed)';
  }
  if (method !== 'legacy-observed') {
    return `provenanceBackfill.method has unexpected value "${method}"; expected "legacy-observed"`;
  }

  // 5. confidence 検証: type guard + 'derived-bytes-verified' allow
  const confidence = raw.confidence;
  if (typeof confidence !== 'string') {
    return `provenanceBackfill.confidence has unexpected type "${typeof confidence}"; rotate reject (malformed)`;
  }
  if (
    confidence !== 'derived-bytes-verified' &&
    confidence !== 'child-snapshot-only' &&
    confidence !== 'metadata-only'
  ) {
    return `provenanceBackfill.confidence has unexpected value "${confidence}"; rotate reject (malformed, allowed: derived-bytes-verified | child-snapshot-only | metadata-only)`;
  }
  if (confidence !== 'derived-bytes-verified') {
    return `Document was backfilled with confidence "${confidence}"; rotate requires "derived-bytes-verified" (壊れた legacy bytes を正規 rotation 経路で昇格させない、ADR-0016 MUST 3 拡張)`;
  }

  // 6. evidence 必須 + plain object
  const evidence = raw.evidence;
  if (!isPlainObject(evidence)) {
    return 'provenanceBackfill.evidence is missing or non-object; derived-bytes-verified rotate requires complete evidence';
  }

  // 7. derived-bytes-verified では evidence 3 field を全 true 確認 (Codex 2nd Important 1)
  const parentExists = evidence.parentExists;
  if (typeof parentExists !== 'boolean') {
    return 'provenanceBackfill.evidence.parentExists has unexpected type; expected boolean';
  }
  if (parentExists !== true) {
    return 'provenanceBackfill.evidence.parentExists !== true; derived-bytes-verified requires parent現存';
  }

  const parentSha256Match = evidence.parentSha256MatchedAtBackfill;
  // 型 union 上は boolean | null だが、derived-bytes-verified では true 必須 (null も reject)
  if (parentSha256Match !== true && parentSha256Match !== false && parentSha256Match !== null) {
    return 'provenanceBackfill.evidence.parentSha256MatchedAtBackfill has unexpected type; expected boolean | null';
  }
  if (parentSha256Match !== true) {
    return 'provenanceBackfill.evidence.parentSha256MatchedAtBackfill !== true; derived-bytes-verified requires re-split sha256 match (null = unverified, false = mismatch)';
  }

  const childSha256Computed = evidence.childSha256ComputedAtBackfill;
  if (typeof childSha256Computed !== 'boolean') {
    return 'provenanceBackfill.evidence.childSha256ComputedAtBackfill has unexpected type; expected boolean';
  }
  if (childSha256Computed !== true) {
    return 'provenanceBackfill.evidence.childSha256ComputedAtBackfill !== true; derived-bytes-verified requires child sha256 実計算';
  }

  // 8. 全 invariant 通過 → allow
  return null;
}
