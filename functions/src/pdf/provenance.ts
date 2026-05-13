/**
 * 分割 PDF Provenance Factory + Runtime Validation
 *
 * ADR-0016 MUST 2 (10 fields) / MUST 5 (read snapshot 整合) を実装する factory。
 * sha256 hex 長さ・generation 数値文字列・path 非空を runtime 検証する。
 *
 * Issue #445 PR-D2 (splitPdf 改修) で利用。
 *
 * 詳細: docs/adr/0016-document-identity-and-provenance.md
 */

import { Timestamp } from 'firebase-admin/firestore';
import type { DocumentProvenance } from '../../../shared/types';

const SHA256_HEX_RE = /^[0-9a-fA-F]{64}$/;
const NUMERIC_STRING_RE = /^[0-9]+$/;

/**
 * createSplitProvenance() の入力型。createdAt は audit field のため省略可
 * (省略時は Timestamp.now() を採用)。
 */
export interface CreateSplitProvenanceInput {
  sourceGeneration: string;
  sourceMetageneration: string;
  sourceSha256: string;
  sourcePath: string;
  sourceBucket: string;
  derivedObjectPath: string;
  derivedGeneration: string;
  derivedMetageneration: string;
  derivedSha256: string;
  createdAt?: Timestamp;
}

export class ProvenanceValidationError extends Error {
  constructor(public readonly field: string, public readonly reason: string) {
    super(`Invalid provenance field "${field}": ${reason}`);
    this.name = 'ProvenanceValidationError';
  }
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ProvenanceValidationError(
      field,
      `expected non-empty string, got ${typeof value === 'string' ? '""' : typeof value}`
    );
  }
}

function assertSha256Hex(value: unknown, field: string): asserts value is string {
  assertNonEmptyString(value, field);
  if (!SHA256_HEX_RE.test(value)) {
    throw new ProvenanceValidationError(
      field,
      `expected 64-char hex string, got length ${value.length}`
    );
  }
}

function assertNumericString(value: unknown, field: string): asserts value is string {
  assertNonEmptyString(value, field);
  if (!NUMERIC_STRING_RE.test(value)) {
    throw new ProvenanceValidationError(
      field,
      `expected numeric digit string, got "${value}"`
    );
  }
}

function assertObjectName(value: unknown, field: string): asserts value is string {
  assertNonEmptyString(value, field);
  if (value.startsWith('gs://')) {
    throw new ProvenanceValidationError(
      field,
      'expected GCS object name (no "gs://" prefix), got URI'
    );
  }
}

/**
 * 入力 10 fields 全てを runtime 検証する。失敗時は ProvenanceValidationError を throw。
 *
 * 検証規則 (ADR-0016 MUST 2):
 * - sourceGeneration / sourceMetageneration / derivedGeneration / derivedMetageneration: 数値文字列 (GCS metadata 仕様)
 * - sourceSha256 / derivedSha256: 64 桁 hex (大小文字許容)
 * - sourcePath / derivedObjectPath: 非空 + "gs://" prefix 禁止 (object name のみ受け取る)
 * - sourceBucket: 非空
 */
export function assertValidProvenanceInput(input: CreateSplitProvenanceInput): void {
  assertNumericString(input.sourceGeneration, 'sourceGeneration');
  assertNumericString(input.sourceMetageneration, 'sourceMetageneration');
  assertSha256Hex(input.sourceSha256, 'sourceSha256');
  assertObjectName(input.sourcePath, 'sourcePath');
  assertNonEmptyString(input.sourceBucket, 'sourceBucket');
  assertObjectName(input.derivedObjectPath, 'derivedObjectPath');
  assertNumericString(input.derivedGeneration, 'derivedGeneration');
  assertNumericString(input.derivedMetageneration, 'derivedMetageneration');
  assertSha256Hex(input.derivedSha256, 'derivedSha256');
}

/**
 * DocumentProvenance を構築する factory。runtime 検証 + sha256 を lowercase 正規化する。
 *
 * - createdAt 省略時は Timestamp.now() を採用
 * - sha256 は lowercase に正規化 (大文字小文字の混在で照合失敗を防ぐ)
 * - 入力検証 NG 時は ProvenanceValidationError を throw (caller が segment ループを abort できる)
 *
 * 戻り値のキャストについて: shared/types.ts の DocumentProvenance.createdAt は
 * `firebase/firestore` (client SDK) の Timestamp 型を参照しているが、本ファイルでは
 * `firebase-admin/firestore` の Timestamp を生成する。両者は runtime 互換 (seconds/
 * nanoseconds/toDate/toMillis/isEqual 同一) だが `toJSON` の有無で TS 型が一致しないため、
 * 既存パターン (searchIndexer.ts L104 等の admin Timestamp 直書込) と整合させるために
 * factory 境界で 1 箇所キャストする。
 */
export function createSplitProvenance(
  input: CreateSplitProvenanceInput
): DocumentProvenance {
  assertValidProvenanceInput(input);
  const provenance = {
    sourceGeneration: input.sourceGeneration,
    sourceMetageneration: input.sourceMetageneration,
    sourceSha256: input.sourceSha256.toLowerCase(),
    sourcePath: input.sourcePath,
    sourceBucket: input.sourceBucket,
    derivedObjectPath: input.derivedObjectPath,
    derivedGeneration: input.derivedGeneration,
    derivedMetageneration: input.derivedMetageneration,
    derivedSha256: input.derivedSha256.toLowerCase(),
    createdAt: input.createdAt ?? Timestamp.now(),
  };
  return provenance as unknown as DocumentProvenance;
}
