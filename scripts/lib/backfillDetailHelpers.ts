/**
 * backfill-detail-subcollection.ts の純粋ロジック部(I/O非依存、unit test対象)。
 * Issue #547 ADR-0018 Phase C。
 *
 * Firestore/ネットワークに依存しない分類判定・canonical hash・集計を分離し、
 * モック不要でテストする(confirmedReplayStats.ts と同じ分離パターン)。
 */

import { createHash } from 'node:crypto';

/**
 * backfill 対象判定の結果。1 doc = 1 判定。
 *
 * detail/main 作成と ocrExcerpt 書込は**独立に判定する** (Codex Phase C review P1反映:
 * seed-dev-data.ts 等は detail/main を dual-write するが親に ocrExcerpt を書かないため、
 * 「detail存在＝完了」と扱うと excerpt が永久に欠けたまま --verify が収束しない)。
 *
 * - `backfill-detail-and-excerpt`: detail/main 作成 + ocrExcerpt 書込(フルbackfill)
 * - `backfill-excerpt-only`: detail/main は既存、親の ocrExcerpt のみ欠落
 * - `skip-complete`: detail/main と ocrExcerpt の両方が既に存在(冪等スキップ)
 * - `skip-in-pipeline`: status が pending/processing(OCRパイプライン進行中。
 *   ADR-0018 Phase C行 Codex 6th review P1: 再処理開始後に失敗した doc の detail/main が
 *   古い内容のまま残存しうるため、backfill 対象にも完了検証対象にも含めない。
 *   通常のOCRパイプライン完了時に dual-write で自然に解消される)
 */
export type BackfillDecision =
  | 'backfill-detail-and-excerpt'
  | 'backfill-excerpt-only'
  | 'skip-complete'
  | 'skip-in-pipeline';

/** OCRパイプライン進行中の status (backfill/検証の両方から除外) */
export const IN_PIPELINE_STATUSES = ['pending', 'processing'] as const;

export function decideBackfillAction(params: {
  status: unknown;
  detailExists: boolean;
  hasOcrExcerpt: boolean;
}): BackfillDecision {
  if (
    typeof params.status === 'string' &&
    (IN_PIPELINE_STATUSES as readonly string[]).includes(params.status)
  ) {
    return 'skip-in-pipeline';
  }
  if (!params.detailExists) {
    return 'backfill-detail-and-excerpt';
  }
  return params.hasOcrExcerpt ? 'skip-complete' : 'backfill-excerpt-only';
}

/**
 * detail/main へ書き込む payload を親docフィールドから構築する。
 *
 * ocrProcessor.ts の dual-write (`tx.set(detailRef, { ocrResult, pageResults })`) と
 * 同じ2フィールドのみを対象とする。
 *
 * - `ocrResult`: 親に string があればコピー、なければ **空文字列で必ず書く**
 *   (code-review C1指摘反映: 本番の全doc作成経路4箇所 — checkGmailAttachments /
 *   uploadPdf / ocrProcessor(savedOcrResult、offload時は'') / splitPdf — は例外なく
 *   ocrResult を string で書く。backfill だけ省略すると「detail作成時 ocrResult は
 *   常に string」という production 不変条件を破り、Phase D 読者の想定を崩す)
 * - `pageResults`: 親に配列があればコピー、なければ省略 (空配列は本番書込に存在しない
 *   値のため捏造しない。pageResultsReuse 等の Phase D 読者はフィールド不在を
 *   「再利用不可」として扱う)
 */
export function buildDetailPayload(parentData: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    ocrResult: typeof parentData.ocrResult === 'string' ? parentData.ocrResult : '',
  };
  if (Array.isArray(parentData.pageResults)) {
    payload.pageResults = parentData.pageResults;
  }
  return payload;
}

/**
 * 値のcanonical JSON文字列(キーを再帰的にソート)のSHA-256を返す。
 *
 * Firestoreから読んだオブジェクトはキー順序が保証されないため、JSON.stringifyを
 * 直接比較すると同一内容でも不一致になりうる。parity検証(--verify)では必ず本関数を
 * 両辺に適用して比較する。
 */
export function canonicalHash(value: unknown): string {
  return createHash('sha256').update(canonicalStringify(value)).digest('hex');
}

export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'undefined';
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalStringify(v)).join(',')}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalStringify((value as Record<string, unknown>)[k])}`
  );
  return `{${entries.join(',')}}`;
}

/**
 * --audit / --dry-run / --execute / --verify の集計カウンタ。
 *
 * `parentDeleted` と `decisionChanged` を分離する理由 (code-review D3指摘反映):
 * 前者「スキャン後に親docが削除された」は削除同期の異常やdeleteストームの兆候になりうる
 * シグナル、後者「並行再処理がdetail/mainを先に作成した」は設計想定内の正常系。
 * 同一カウンタに混ぜると operator が実行結果から異常を見分けられない。
 */
export interface BackfillCounters {
  scanned: number;
  targetsDetailAndExcerpt: number;
  targetsExcerptOnly: number;
  skippedComplete: number;
  skippedInPipeline: number;
  writtenDetailAndExcerpt: number;
  writtenExcerptOnly: number;
  parentDeleted: number;
  decisionChanged: number;
  errors: number;
}

export function createCounters(): BackfillCounters {
  return {
    scanned: 0,
    targetsDetailAndExcerpt: 0,
    targetsExcerptOnly: 0,
    skippedComplete: 0,
    skippedInPipeline: 0,
    writtenDetailAndExcerpt: 0,
    writtenExcerptOnly: 0,
    parentDeleted: 0,
    decisionChanged: 0,
    errors: 0,
  };
}
