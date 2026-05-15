/**
 * Issue #445 PR-D4 S6: Rollback adapters (Firestore implementation).
 *
 * BF24 (Codex 3rd 追加) / Codex MCP 12th review I1 反映:
 * - FirestoreRollbackReaderImpl: documents collection を prefix-bounded query で scan
 * - FirestoreRollbackWriterImpl: provenance / provenanceBackfill を FieldValue.delete() で削除
 *
 * 設計:
 * - prefix-bounded query: `orderBy('__name__').startAt(prefix).endAt(prefix + '')`。
 *   `` は Unicode の private use area 最後で、Firestore prefix 検索の慣習 (公式 docs 推奨)
 * - 各 prefix 別 query → orchestrator 側で順次 yield (merge は不要、出力順は仕様外)
 * - field-only delete: `doc.update({field: FieldValue.delete()})`。doc 自体や他 fields は不変
 *   (ADR-0008 削除制約と整合、本 PR は doc/collection delete を一切しない)
 *
 * cocoro/kanameone 万一実行された場合の二重防御:
 * - 本 adapter は env=dev hard gate を含まない (orchestrator + index.ts + workflow yaml で実施)
 * - prefix allowlist (`BF_` / `BF13_test_fixture_`) は本番に存在しないため、仮に走っても
 *   query 結果ゼロで silent (副作用ゼロ)。orchestrator が `out-of-scope` 判定する前に
 *   そもそも doc が返らない
 */

import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import type {
  DocRollbackSnapshot,
  FirestoreRollbackReader,
  FirestoreRollbackWriter,
} from './rollbackOrchestrator';

/**
 * Firestore documents collection から prefix-bounded query で fixture 候補を scan。
 *
 * 注意: __name__ orderBy で startAt/endAt が docId に対して適用される。
 *  は range 末端の慣習。
 */
export class FirestoreRollbackReaderImpl implements FirestoreRollbackReader {
  private readonly db: Firestore;
  private readonly prefixes: readonly string[];

  constructor(db: Firestore, prefixes: readonly string[]) {
    this.db = db;
    this.prefixes = prefixes;
  }

  async *scanCandidateDocs(): AsyncIterable<DocRollbackSnapshot> {
    for (const prefix of this.prefixes) {
      const snap = await this.db
        .collection('documents')
        .orderBy('__name__')
        .startAt(prefix)
        .endAt(`${prefix}`)
        .get();
      for (const doc of snap.docs) {
        const data = doc.data();
        yield {
          docId: doc.id,
          hasProvenance: data['provenance'] !== undefined,
          hasProvenanceBackfill: data['provenanceBackfill'] !== undefined,
        };
      }
    }
  }
}

/**
 * Firestore documents.doc(docId).update() で provenance / provenanceBackfill を field-delete。
 *
 * `FieldValue.delete()` は doc 内の指定 field のみ除去し、他 fields (createdAt 等) と doc 自体は
 * 残存させる (`.update()` semantics)。`set({merge:true})` ではないため新 field 追加リスクなし。
 */
export class FirestoreRollbackWriterImpl implements FirestoreRollbackWriter {
  private readonly db: Firestore;

  constructor(db: Firestore) {
    this.db = db;
  }

  async deleteProvenanceFields(input: {
    docId: string;
    deleteProvenance: boolean;
    deleteProvenanceBackfill: boolean;
  }): Promise<void> {
    const update: Record<string, FieldValue> = {};
    if (input.deleteProvenance) {
      update['provenance'] = FieldValue.delete();
    }
    if (input.deleteProvenanceBackfill) {
      update['provenanceBackfill'] = FieldValue.delete();
    }
    if (Object.keys(update).length === 0) {
      // 両 false なら no-op (orchestrator は呼ばない前提だが defensive)
      return;
    }
    await this.db.collection('documents').doc(input.docId).update(update);
  }
}
