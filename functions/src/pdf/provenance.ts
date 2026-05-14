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

/**
 * createRotationProvenance() の入力型。
 *
 * rotation セマンティクス (ADR-0016 MUST 3 + PR-D3 AC1/AC2/AC14):
 * - `base`: rotation 前の DocumentProvenance (10 fields)。source 5 + audit 1 (createdAt) は
 *   そのまま継承。base.derived* は新 object のもので上書きされるため検証対象外。
 * - `newDerived`: rotation 後の新 Storage object 由来の 4 fields (caller が GCS metadata
 *   取得後に渡す)。derivedObjectPath は `processed/{docId}/rotations/{rotationId}.pdf` 形式。
 *
 * 型表面で sourceSha256 等を上書きする API を意図的に持たない (AC14 担保)。
 */
export interface CreateRotationProvenanceInput {
  base: DocumentProvenance;
  newDerived: {
    derivedObjectPath: string;
    derivedGeneration: string;
    derivedMetageneration: string;
    derivedSha256: string;
  };
}

/**
 * rotation 後の最終 provenance を runtime 検証する。
 *
 * 検証対象:
 *   (a) rotation 後に Firestore へ書き込む 9 fields (source 5 + newDerived 4) — base.derived* を newDerived で置換した最終形
 *   (b) base.derived* 単体 (defense in depth、type-design-analyzer 推奨): 未検証の base を caller が
 *       直接 Firestore から読み込んで渡した場合のガード。`createSplitProvenance()` 経由なら通過済だが二重チェック。
 *
 * `base.createdAt` は audit field のため runtime 検証対象外 (Timestamp は型レベルで保証)。
 * 失敗時は ProvenanceValidationError を throw。
 */
export function assertValidRotationProvenanceInput(
  input: CreateRotationProvenanceInput
): void {
  // (a) 最終形 (= rotation 後に Firestore へ書き込まれる 9 fields の整合)
  assertValidProvenanceInput({
    sourceGeneration: input.base.sourceGeneration,
    sourceMetageneration: input.base.sourceMetageneration,
    sourceSha256: input.base.sourceSha256,
    sourcePath: input.base.sourcePath,
    sourceBucket: input.base.sourceBucket,
    derivedObjectPath: input.newDerived.derivedObjectPath,
    derivedGeneration: input.newDerived.derivedGeneration,
    derivedMetageneration: input.newDerived.derivedMetageneration,
    derivedSha256: input.newDerived.derivedSha256,
  });
  // (b) base.derived* 単体 (defense in depth、未検証 base のガード)
  assertValidProvenanceInput({
    sourceGeneration: input.base.sourceGeneration,
    sourceMetageneration: input.base.sourceMetageneration,
    sourceSha256: input.base.sourceSha256,
    sourcePath: input.base.sourcePath,
    sourceBucket: input.base.sourceBucket,
    derivedObjectPath: input.base.derivedObjectPath,
    derivedGeneration: input.base.derivedGeneration,
    derivedMetageneration: input.base.derivedMetageneration,
    derivedSha256: input.base.derivedSha256,
  });
}

/**
 * rotation 後の DocumentProvenance を構築する factory。
 *
 * 不変性 (ADR-0016 MUST 3 + AC2 + AC14):
 * - source 5 fields は base の値を保持
 * - createdAt は base の値を保持 (rotation は audit timestamp を変更しない、split 完了時刻のまま)
 * - derived 4 fields のみ newDerived で上書き
 *
 * sha256 は lowercase に正規化 (createSplitProvenance と同じ)。
 * 戻り値キャスト理由は createSplitProvenance と同じ (admin/client Timestamp 互換性)。
 */
export function createRotationProvenance(
  input: CreateRotationProvenanceInput
): DocumentProvenance {
  assertValidRotationProvenanceInput(input);
  const provenance = {
    sourceGeneration: input.base.sourceGeneration,
    sourceMetageneration: input.base.sourceMetageneration,
    sourceSha256: input.base.sourceSha256.toLowerCase(),
    sourcePath: input.base.sourcePath,
    sourceBucket: input.base.sourceBucket,
    derivedObjectPath: input.newDerived.derivedObjectPath,
    derivedGeneration: input.newDerived.derivedGeneration,
    derivedMetageneration: input.newDerived.derivedMetageneration,
    derivedSha256: input.newDerived.derivedSha256.toLowerCase(),
    createdAt: input.base.createdAt,
  };
  return provenance as unknown as DocumentProvenance;
}
