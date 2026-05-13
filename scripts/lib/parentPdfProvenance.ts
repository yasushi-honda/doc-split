/**
 * Issue #432 PR-C3c: 親 PDF provenance 6 fields 計算 lib。
 *
 * AC18 (execute provenance gate) の中核ロジック:
 *   - classify 側 (T1): provenanceRequired=true op の生成時に親 PDF metadata + bytes
 *     sha256 を snapshot として記録 (`Plan.operations[].provenance`)。
 *   - execute 側 (T2): runtime で同関数を呼び出し、plan 記録と field 単位で照合
 *     (AC18-2、sourceBucket / sourcePath / sourceGeneration / sourceMetageneration /
 *      sourceSha256 / derivedObjectPath の 6 fields を比較。size/contentType は AC18-2
 *      対象外、bytes 不変判定の主証拠は sourceSha256)。
 *
 * Codex Q1 反映: sourceSha256 + sourceGeneration が中核証拠、他 4 fields は補助。
 * sourceSha256 単独でも bytes 不変判定として強力だが、GCS object 識別性
 * (bucket/path/generation) を含めることで「別 bucket の別 PDF が同 sha256 で偶然一致」
 * のような edge case (極端に低確率) も同時に塞ぐ。
 *
 * Codex AC18-2 反映: GCS metadata 全体ではなく field 限定比較。irrelevant metadata
 * 変更 (例: Firebase console での custom metadata 追加) で execute が false reject
 * されないようにする。
 *
 * AC-PRD-BRIDGE 反映: 6 fields の名前は Issue #445 PR-D2 で Firestore に永続化する
 * 際の schema 候補と一致させる。PR-D 系列着手前に ADR-0016 (PR-D1) で記録する。
 */

import crypto from 'crypto';
import type { Bucket, File as StorageFile } from '@google-cloud/storage';
import type { ParentPdfProvenance } from './collisionPlanTypes';

/**
 * GCS object metadata の Firebase Admin SDK 型 (file.getMetadata() の戻り値)。
 *
 * `getMetadata()` は `[Metadata, ApiResponse]` のタプルを返す。中身の Metadata は
 * field が任意 (undefined 可) なので、本 lib では string field を厳密に validation
 * してから ParentPdfProvenance に詰め直す。
 */
interface GcsObjectMetadata {
  bucket?: string;
  name?: string;
  generation?: string | number;
  metageneration?: string | number;
  size?: string | number;
  contentType?: string;
  md5Hash?: string;
  updated?: string;
}

/**
 * 親 PDF の provenance snapshot を計算する。
 *
 * @param bucket - GCS Bucket (parent PDF が格納されている bucket)
 * @param sourcePath - parent PDF の object path (例: `original/<parentDocId>/<fileName>`)
 * @param derivedObjectPath - この snapshot から生成する派生 child の object path
 *   (例: `processed/<childDocId>/<childFileName>`)。AC-PRD-BRIDGE 反映で provenance に
 *   束ねて記録する (どの child のために計算した snapshot かを追跡可能にする)。
 * @returns 6 fields 完備の `ParentPdfProvenance`。bytes download + sha256 計算を行うため
 *   同一 parent に対して連続呼び出しすると I/O コストがかかる。caller は per-parent
 *   cache を検討すること (classify-collision-docs.ts で `parentBufferCache` を持っている
 *   のと同じ pattern)。
 * @throws Error - parent PDF が存在しない / metadata 不完全 / download 失敗 (transient
 *   error も含む。caller で computation-error として Ambiguous に降格させるか判断)。
 */
export async function computeParentPdfProvenance(
  bucket: Bucket,
  sourcePath: string,
  derivedObjectPath: string
): Promise<ParentPdfProvenance> {
  const file: StorageFile = bucket.file(sourcePath);

  const [exists] = await file.exists();
  if (!exists) {
    throw new Error(
      `parent PDF not found at gs://${bucket.name}/${sourcePath} (computeParentPdfProvenance)`
    );
  }

  const [rawMetadata] = await file.getMetadata();
  const metadata = rawMetadata as GcsObjectMetadata;

  const generation = metadata.generation;
  const metageneration = metadata.metageneration;
  if (generation === undefined || generation === null) {
    throw new Error(
      `parent PDF metadata missing 'generation' at gs://${bucket.name}/${sourcePath}`
    );
  }
  if (metageneration === undefined || metageneration === null) {
    throw new Error(
      `parent PDF metadata missing 'metageneration' at gs://${bucket.name}/${sourcePath}`
    );
  }

  // bytes download + sha256 計算 (AC18-2 主判定)
  const [buffer] = await file.download();
  const sourceSha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  return {
    sourceBucket: bucket.name,
    sourcePath,
    sourceGeneration: String(generation),
    sourceMetageneration: String(metageneration),
    sourceSha256,
    derivedObjectPath,
  };
}

/**
 * runtime 親 PDF と plan 記録の provenance を field 単位で照合する pure function。
 *
 * AC18-2 反映: 比較対象を generation/metageneration/sourcePath/sourceBucket/sourceSha256 に
 * 限定 (GCS metadata 全体は比較しない)。size/contentType/md5Hash は補助的に取得可能だが、
 * sourceSha256 が一致すれば bytes 一致は保証されるため、本関数では sha256 + 識別子のみ
 * チェックする。
 *
 * @param planRecord - plan に記録された provenance snapshot
 * @param runtimeRecord - runtime で計算した provenance (同一 derivedObjectPath で算出)
 * @returns 全 field 一致なら `{ ok: true }`、いずれか不一致なら `{ ok: false, reason }`
 */
export function verifyParentPdfProvenanceMatch(
  planRecord: ParentPdfProvenance,
  runtimeRecord: ParentPdfProvenance
): { ok: true } | { ok: false; reason: string } {
  const fieldsToCompare: (keyof ParentPdfProvenance)[] = [
    'sourceBucket',
    'sourcePath',
    'sourceGeneration',
    'sourceMetageneration',
    'sourceSha256',
    'derivedObjectPath',
  ];
  for (const field of fieldsToCompare) {
    if (planRecord[field] !== runtimeRecord[field]) {
      return {
        ok: false,
        reason: `parent PDF ${field} mismatch since classify (plan=${planRecord[field]}, runtime=${runtimeRecord[field]})`,
      };
    }
  }
  return { ok: true };
}
