/**
 * Issue #445 PR-D4 S1-5: Phase D doc-level verifier (Codex Critical 1/2 + Stage 1/2 設計).
 *
 * Stage 1: observed field 単位検証 (factory 再 invoke なし、Codex 7th Critical 2 反映)
 *   - provenance 10 fields を Phase B `computedProvenance` と field-by-field 比較 (Critical 1 反映)
 *   - provenanceBackfill の method / confidence / backfilledAt / evidence.* を type + invariant 検証
 *   - `createBackfillProvenance` factory が固定生成する `method: 'legacy-observed'` の false positive
 *     を構造的に検出 (factory 再 invoke 前に observed を直接読む)
 *
 * Stage 2: sha256 deterministic 確認 (Stage 1 pass のみ)
 *   - observed metadata を `createBackfillProvenance` factory に再投入 (observed `backfilledAt`
 *     必須、省略すると Timestamp.now() で sha256 が一致しない)
 *   - 出力 metadata を `sha256ProvenanceBackfill` で hash 化 → Phase C `newProvenanceBackfillSha256`
 *     と比較
 *
 * `feedback_deterministic_cross_process.md` 反映: Firestore data() 直 stringify は key 順序
 * cross-process 不安定。factory 再 invoke で metadata 再構築してから sha256 化。
 */

import { Timestamp } from 'firebase-admin/firestore';
import type {
  BackfillConfidence,
  BackfillClassifierCategory,
  DocumentProvenance,
  ProvenanceBackfillMetadata,
} from '../../../shared/types';
import type { PhaseBRevalidatedCandidate, PhaseDFieldMismatchDoc } from '../types';
import { createBackfillProvenance } from '../../../functions/src/pdf/provenance';
import { sha256ProvenanceBackfill } from '../phase-c/batchWriter';

/**
 * Firestore document から読んだ observed の状態。
 *
 * `provenance` / `provenanceBackfill` は admin SDK 経由で取得した raw object (Timestamp 含む)。
 * `null` は absent / 取得不能。`undefined` は field 不在を表す。
 */
export interface ObservedDocState {
  docId: string;
  /** Firestore document.createdAt (BF10 検証で provenance.createdAt と比較) */
  documentCreatedAt: Timestamp | null;
  provenance: DocumentProvenance | null;
  provenanceBackfill: ProvenanceBackfillMetadata | null;
  /** Firestore 経由 raw object (null と undefined を区別するため別 field) */
  provenanceBackfillRaw: unknown;
}

export type VerifyDocResult =
  | {
      kind: 'verified';
      docId: string;
      provenanceFieldsConsistent: true;
      provenanceBackfillSha256Match: boolean;
      observedConfidence: BackfillConfidence;
      observedCreatedAt: string;
      /** BF10 検証結果: provenance.createdAt === document.createdAt */
      createdAtConsistent: boolean;
      /** createdAt 不一致時、observed と expected を残す (mismatch doc 構築用) */
      createdAtMismatch: PhaseDFieldMismatchDoc | null;
    }
  | {
      kind: 'mismatch';
      docId: string;
      mismatches: PhaseDFieldMismatchDoc[];
    };

/**
 * provenance 10 fields の field-by-field 比較 (Critical 1 反映)。
 *
 * 文字列 9 fields は厳密一致 (`===`)、createdAt は Timestamp → ISO8601 化して expected の
 * ISO string (Phase B computedProvenance.createdAt) と比較。
 */
function compareProvenanceFields(
  docId: string,
  observed: DocumentProvenance,
  expected: PhaseBRevalidatedCandidate['computedProvenance']
): PhaseDFieldMismatchDoc[] {
  const mismatches: PhaseDFieldMismatchDoc[] = [];
  const stringFields: Array<keyof DocumentProvenance> = [
    'sourceGeneration',
    'sourceMetageneration',
    'sourceSha256',
    'sourcePath',
    'sourceBucket',
    'derivedObjectPath',
    'derivedGeneration',
    'derivedMetageneration',
    'derivedSha256',
  ];
  for (const field of stringFields) {
    const observedValue = observed[field];
    const expectedValue = expected[field as keyof typeof expected];
    if (typeof observedValue !== 'string') {
      mismatches.push({
        docId,
        mismatchType: 'provenance-field',
        field,
        observed: observedValue == null ? null : String(observedValue),
        expected: typeof expectedValue === 'string' ? expectedValue : null,
      });
      continue;
    }
    if (observedValue !== expectedValue) {
      mismatches.push({
        docId,
        mismatchType: 'provenance-field',
        field,
        observed: observedValue,
        expected: typeof expectedValue === 'string' ? expectedValue : null,
      });
    }
  }
  // createdAt (Timestamp → ISO 比較)
  if (!(observed.createdAt instanceof Timestamp)) {
    mismatches.push({
      docId,
      mismatchType: 'provenance-field',
      field: 'createdAt',
      observed: observed.createdAt == null ? null : String(observed.createdAt),
      expected: expected.createdAt,
    });
  } else {
    const observedIso = observed.createdAt.toDate().toISOString();
    if (observedIso !== expected.createdAt) {
      mismatches.push({
        docId,
        mismatchType: 'provenance-field',
        field: 'createdAt',
        observed: observedIso,
        expected: expected.createdAt,
      });
    }
  }
  return mismatches;
}

/**
 * provenanceBackfill の Stage 1 field 単位検証 (Codex Critical 2 反映)。
 *
 * factory 再 invoke 前に observed を直接読み、`method: 'legacy-observed'` 等の固定値が
 * 壊れていないかを type + invariant 検証する。Stage 2 sha256 比較の前に false positive を
 * 検出する。
 *
 * Codex 8th Important 2 反映: `parentSha256MatchedAtBackfill` 型は `boolean | null`
 * を一般 validator では許容、confidence-specific invariant で derived-bytes-verified は true 必須。
 */
function validateBackfillMetadataStage1(
  docId: string,
  raw: unknown
): { ok: true; metadata: ProvenanceBackfillMetadata } | { ok: false; mismatches: PhaseDFieldMismatchDoc[] } {
  const mismatches: PhaseDFieldMismatchDoc[] = [];
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    mismatches.push({
      docId,
      mismatchType: 'backfill-field',
      field: 'provenanceBackfill',
      observed: raw === null ? null : typeof raw,
      expected: 'object',
    });
    return { ok: false, mismatches };
  }
  const obj = raw as Record<string, unknown>;

  if (obj.method !== 'legacy-observed') {
    mismatches.push({
      docId,
      mismatchType: 'backfill-field',
      field: 'provenanceBackfill.method',
      observed: typeof obj.method === 'string' ? obj.method : null,
      expected: 'legacy-observed',
    });
  }
  const allowedConfidence: BackfillConfidence[] = [
    'derived-bytes-verified',
    'child-snapshot-only',
    'metadata-only',
  ];
  if (typeof obj.confidence !== 'string' || !allowedConfidence.includes(obj.confidence as BackfillConfidence)) {
    mismatches.push({
      docId,
      mismatchType: 'backfill-field',
      field: 'provenanceBackfill.confidence',
      observed: typeof obj.confidence === 'string' ? obj.confidence : null,
      expected: 'derived-bytes-verified | child-snapshot-only | metadata-only',
    });
  }
  if (!(obj.backfilledAt instanceof Timestamp)) {
    mismatches.push({
      docId,
      mismatchType: 'backfill-field',
      field: 'provenanceBackfill.backfilledAt',
      observed: obj.backfilledAt == null ? null : typeof obj.backfilledAt,
      expected: 'Timestamp',
    });
  }
  const evidenceRaw = obj.evidence;
  if (
    evidenceRaw === null ||
    typeof evidenceRaw !== 'object' ||
    Array.isArray(evidenceRaw)
  ) {
    mismatches.push({
      docId,
      mismatchType: 'backfill-field',
      field: 'provenanceBackfill.evidence',
      observed: evidenceRaw == null ? null : typeof evidenceRaw,
      expected: 'object',
    });
  } else {
    const ev = evidenceRaw as Record<string, unknown>;
    if (typeof ev.parentExists !== 'boolean') {
      mismatches.push({
        docId,
        mismatchType: 'backfill-field',
        field: 'provenanceBackfill.evidence.parentExists',
        observed: typeof ev.parentExists === 'boolean' ? ev.parentExists : null,
        expected: 'boolean',
      });
    }
    // boolean | null 許容 (Codex 8th Important 2)
    if (
      ev.parentSha256MatchedAtBackfill !== true &&
      ev.parentSha256MatchedAtBackfill !== false &&
      ev.parentSha256MatchedAtBackfill !== null
    ) {
      mismatches.push({
        docId,
        mismatchType: 'backfill-field',
        field: 'provenanceBackfill.evidence.parentSha256MatchedAtBackfill',
        observed: typeof ev.parentSha256MatchedAtBackfill,
        expected: 'boolean | null',
      });
    }
    if (typeof ev.childSha256ComputedAtBackfill !== 'boolean') {
      mismatches.push({
        docId,
        mismatchType: 'backfill-field',
        field: 'provenanceBackfill.evidence.childSha256ComputedAtBackfill',
        observed: typeof ev.childSha256ComputedAtBackfill === 'boolean' ? ev.childSha256ComputedAtBackfill : null,
        expected: 'boolean',
      });
    }
    if (typeof ev.backfillScriptVersion !== 'string' || ev.backfillScriptVersion.length === 0) {
      mismatches.push({
        docId,
        mismatchType: 'backfill-field',
        field: 'provenanceBackfill.evidence.backfillScriptVersion',
        observed: typeof ev.backfillScriptVersion === 'string' ? ev.backfillScriptVersion : null,
        expected: 'non-empty string',
      });
    }
    const allowedCategories: BackfillClassifierCategory[] = [
      'MatchedByHash',
      'RepairableMissingFile',
      'Ambiguous',
      'LostOrUnrecoverable',
      'NeedsManualReview',
    ];
    if (
      typeof ev.classifierCategory !== 'string' ||
      !allowedCategories.includes(ev.classifierCategory as BackfillClassifierCategory)
    ) {
      mismatches.push({
        docId,
        mismatchType: 'backfill-field',
        field: 'provenanceBackfill.evidence.classifierCategory',
        observed: typeof ev.classifierCategory === 'string' ? ev.classifierCategory : null,
        expected: 'MatchedByHash | RepairableMissingFile | Ambiguous | LostOrUnrecoverable | NeedsManualReview',
      });
    }
  }
  if (mismatches.length > 0) return { ok: false, mismatches };
  return { ok: true, metadata: obj as unknown as ProvenanceBackfillMetadata };
}

/**
 * Stage 2: sha256 deterministic 確認 (Stage 1 pass のみ)。
 *
 * observed metadata の `backfilledAt` を input.backfilledAt として factory 再 invoke → sha256
 * → Phase C `newProvenanceBackfillSha256` と比較。Codex Critical 2 反映で observed backfilledAt
 * を必ず渡す (省略すると Timestamp.now() で hash 一致しない)。
 */
function compareBackfillSha256(
  docId: string,
  observedMetadata: ProvenanceBackfillMetadata,
  observedProvenance: DocumentProvenance,
  expectedSha256: string,
  backfillScriptVersion: string
): PhaseDFieldMismatchDoc | null {
  const expectedSplitCreatedAt = observedProvenance.createdAt;
  if (!(expectedSplitCreatedAt instanceof Timestamp)) {
    return {
      docId,
      mismatchType: 'sha256',
      field: 'provenanceBackfill.sha256',
      observed: 'observed.provenance.createdAt is not Timestamp; sha256 比較スキップ',
      expected: expectedSha256,
    };
  }
  // observed metadata を factory に再投入 (Codex Critical 2 反映: backfilledAt は observed 値)
  let rebuilt;
  try {
    rebuilt = createBackfillProvenance({
      provenanceFields: {
        sourceGeneration: observedProvenance.sourceGeneration,
        sourceMetageneration: observedProvenance.sourceMetageneration,
        sourceSha256: observedProvenance.sourceSha256,
        sourcePath: observedProvenance.sourcePath,
        sourceBucket: observedProvenance.sourceBucket,
        derivedObjectPath: observedProvenance.derivedObjectPath,
        derivedGeneration: observedProvenance.derivedGeneration,
        derivedMetageneration: observedProvenance.derivedMetageneration,
        derivedSha256: observedProvenance.derivedSha256,
        createdAt: expectedSplitCreatedAt,
      },
      confidence: observedMetadata.confidence,
      classifierCategory: observedMetadata.evidence.classifierCategory,
      evidence: {
        parentExists: observedMetadata.evidence.parentExists,
        parentSha256MatchedAtBackfill: observedMetadata.evidence.parentSha256MatchedAtBackfill,
        childSha256ComputedAtBackfill: observedMetadata.evidence.childSha256ComputedAtBackfill,
      },
      backfillScriptVersion,
      backfilledAt: observedMetadata.backfilledAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      docId,
      mismatchType: 'sha256',
      field: 'provenanceBackfill.sha256',
      observed: `factory re-invoke failed: ${message}`,
      expected: expectedSha256,
    };
  }
  const observedSha = sha256ProvenanceBackfill(rebuilt.provenanceBackfill);
  if (observedSha !== expectedSha256) {
    return {
      docId,
      mismatchType: 'sha256',
      field: 'provenanceBackfill.sha256',
      observed: observedSha,
      expected: expectedSha256,
    };
  }
  return null;
}

export interface VerifyDocInput {
  observed: ObservedDocState;
  expectedFromPhaseB: PhaseBRevalidatedCandidate | undefined;
  expectedSha256FromPhaseC: string;
  backfillScriptVersion: string;
}

/**
 * 1 doc の verify (Stage 1 + Stage 2)。
 *
 * 戻り値:
 * - kind=verified: provenance 10 fields 一致 + Stage 1 pass。Stage 2 sha256 一致を
 *   `provenanceBackfillSha256Match` で表現 (true/false)
 * - kind=mismatch: いずれかの段階で fail
 *
 * BF10 `provenance.createdAt === document.createdAt` 検証も含む (createdAtConsistent field)。
 */
export function verifyDoc(input: VerifyDocInput): VerifyDocResult {
  const docId = input.observed.docId;
  const mismatches: PhaseDFieldMismatchDoc[] = [];

  // Phase B index に該当 docId が無い場合 (Phase C と Phase B の同期ズレ、Codex Suggestion 1)
  if (!input.expectedFromPhaseB) {
    mismatches.push({
      docId,
      mismatchType: 'missing-expected',
      field: '__phaseBIndex',
      observed: null,
      expected: 'Phase B candidate entry',
    });
    return { kind: 'mismatch', docId, mismatches };
  }

  if (input.observed.provenance === null) {
    mismatches.push({
      docId,
      mismatchType: 'provenance-field',
      field: 'provenance',
      observed: null,
      expected: 'DocumentProvenance object',
    });
    return { kind: 'mismatch', docId, mismatches };
  }

  // Stage 1a: provenance 10 fields 比較
  const provMismatches = compareProvenanceFields(
    docId,
    input.observed.provenance,
    input.expectedFromPhaseB.computedProvenance
  );
  mismatches.push(...provMismatches);

  // Stage 1b: provenanceBackfill field 単位検証
  const stage1 = validateBackfillMetadataStage1(docId, input.observed.provenanceBackfillRaw);
  if (!stage1.ok) {
    mismatches.push(...stage1.mismatches);
    return { kind: 'mismatch', docId, mismatches };
  }
  if (provMismatches.length > 0) {
    return { kind: 'mismatch', docId, mismatches };
  }

  // Stage 2: sha256 deterministic 比較
  const sha256Mismatch = compareBackfillSha256(
    docId,
    stage1.metadata,
    input.observed.provenance,
    input.expectedSha256FromPhaseC,
    input.backfillScriptVersion
  );
  const provenanceBackfillSha256Match = sha256Mismatch === null;

  // BF10: provenance.createdAt === document.createdAt
  const observedCreatedAtIso = input.observed.provenance.createdAt.toDate().toISOString();
  let createdAtConsistent = false;
  let createdAtMismatch: PhaseDFieldMismatchDoc | null = null;
  if (input.observed.documentCreatedAt instanceof Timestamp) {
    const docCreatedAtIso = input.observed.documentCreatedAt.toDate().toISOString();
    createdAtConsistent = observedCreatedAtIso === docCreatedAtIso;
    if (!createdAtConsistent) {
      createdAtMismatch = {
        docId,
        mismatchType: 'provenance-field',
        field: 'createdAt[BF10:document.createdAt]',
        observed: observedCreatedAtIso,
        expected: docCreatedAtIso,
      };
    }
  } else {
    createdAtMismatch = {
      docId,
      mismatchType: 'provenance-field',
      field: 'createdAt[BF10:document.createdAt]',
      observed: input.observed.documentCreatedAt == null ? null : typeof input.observed.documentCreatedAt,
      expected: 'Timestamp',
    };
  }

  if (sha256Mismatch) {
    mismatches.push(sha256Mismatch);
    return { kind: 'mismatch', docId, mismatches };
  }

  return {
    kind: 'verified',
    docId,
    provenanceFieldsConsistent: true,
    provenanceBackfillSha256Match,
    observedConfidence: stage1.metadata.confidence,
    observedCreatedAt: observedCreatedAtIso,
    createdAtConsistent,
    createdAtMismatch,
  };
}

