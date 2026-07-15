/**
 * ドキュメント変更時のグループ集計更新トリガー
 *
 * documentsコレクションの変更を監視し、documentGroupsコレクションを自動更新
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import {
  generateGroupKeys,
  getAffectedGroups,
  buildGroupRefs,
  applyAggregationDeltas,
  aggregationEventLedgerRef,
  buildAggregationEventLedgerEntry,
} from '../utils/groupAggregation';
import { Timestamp } from 'firebase-admin/firestore';

const db = admin.firestore();

interface DocumentData {
  customerName?: string;
  officeName?: string;
  documentType?: string;
  careManager?: string;
  customerKey?: string;
  officeKey?: string;
  documentTypeKey?: string;
  careManagerKey?: string;
  fileName?: string;
  processedAt?: Timestamp;
  status?: string;
}

export interface DocumentAggregationEventInput {
  docId: string;
  eventId: string;
  eventSource: string;
  eventSubject?: string;
  eventTime: string;
  beforeData: DocumentData | undefined;
  afterData: DocumentData | undefined;
  nowMillis: number;
}

export interface DocumentAggregationEventResult {
  skipped: boolean;
  groupsUpdated: number;
}

/**
 * documents書込みイベント1件分の「グループキー正規化+集計反映」処理本体。
 *
 * `onDocumentWritten`(CloudEvent)のプラミング部分から独立させ、`event`オブジェクトの
 * 構築を必要とせず直接呼び出せるようにしている(Issue #660修正、ADR-0020)。理由:
 * `firebase-functions-test`はv1トリガーの`.wrap()`は充実しているが、v2 Firestore
 * トリガー(CloudEvent、特に`event.id`を任意の値に固定する必要がある冪等性テスト)への
 * 対応が薄く、本体ロジックをCloudEvent非依存にすることで実Firestore emulatorに対する
 * 直接的な統合テストが可能になる。
 */
export async function processDocumentAggregationEvent(
  db: admin.firestore.Firestore,
  input: DocumentAggregationEventInput
): Promise<DocumentAggregationEventResult> {
  const { docId, eventId, eventSource, eventSubject, eventTime, nowMillis } = input;
  const beforeData = input.beforeData;
  const afterData = input.afterData;

  // ドキュメントが存在する場合、グループキーを自動設定
  if (afterData) {
    const keys = generateGroupKeys(afterData);
    const needsKeyUpdate =
      afterData.customerKey !== keys.customerKey ||
      afterData.officeKey !== keys.officeKey ||
      afterData.documentTypeKey !== keys.documentTypeKey ||
      afterData.careManagerKey !== keys.careManagerKey;

    if (needsKeyUpdate) {
      // グループキーを更新（再帰呼び出し防止のため、キーのみ更新）
      try {
        await db.collection('documents').doc(docId).update({
          customerKey: keys.customerKey,
          officeKey: keys.officeKey,
          documentTypeKey: keys.documentTypeKey,
          careManagerKey: keys.careManagerKey,
        });
        console.log(`[onDocumentWrite] Updated group keys for ${docId}`);
      } catch (error) {
        console.error(`[onDocumentWrite] Failed to update keys for ${docId}:`, error);
      }

      // キー更新後のafterDataを再構築
      Object.assign(afterData, keys);
    }
  }

  // beforeDataにもキーがない場合は生成
  const beforeWithKeys = beforeData ? {
    ...beforeData,
    ...generateGroupKeys(beforeData),
  } : undefined;

  const afterWithKeys = afterData ? {
    ...afterData,
    ...generateGroupKeys(afterData),
  } : undefined;

  // 影響を受けるグループを特定
  // 集計差分は必ずevent.data.before/afterの凍結スナップショット(の正規化コピー)から
  // 計算する。トランザクション内で「現在の」documentsを再読込みして差分計算すると、
  // 配信順序が入れ替わった別イベントの状態を誤って基準にしてしまう(/codex plan指摘)。
  const affectedGroups = getAffectedGroups(beforeWithKeys, afterWithKeys);

  if (affectedGroups.length === 0) {
    return { skipped: false, groupsUpdated: 0 };
  }

  // Issue #660: Firestore/EventarcはCloudEventをat-least-once配信するため、
  // 同一event.idに対してこのハンドラが複数回呼び出される可能性がある(配信順序も
  // 保証されない)。event.idごとの冪等台帳(documentAggregationEvents)を用いて、
  // 「台帳確認→全affected group更新→台帳作成」を単一トランザクションでatomicに
  // 実行することで、重複配信・部分失敗後のリトライいずれに対しても冪等にする
  // (ADR-0020)。
  const ledgerRef = aggregationEventLedgerRef(db, eventId);
  const groupRefs = buildGroupRefs(db, affectedGroups);
  const docData = afterWithKeys ? { ...afterWithKeys, id: docId } : undefined;

  let skipped = false;

  try {
    await db.runTransaction(async (transaction) => {
      // read phase: 台帳 + 全affected groupを一括読み取り(全読み取り→全書込みの
      // 順序制約を満たすため、この時点で全読み取りを完了させる)
      const [ledgerSnap, ...groupSnaps] = await transaction.getAll(ledgerRef, ...groupRefs);

      if (ledgerSnap.exists) {
        // 既に処理済みのイベント(再配信・リトライ) — 集計を再適用せずskip
        console.log(`[onDocumentWrite] event ${eventId} already processed for doc ${docId}, skipping`);
        skipped = true;
        return;
      }

      // write phase: 全グループ更新 + 台帳作成を同一トランザクションでatomicに実行。
      // 一部グループの更新でエラーが起きた場合、トランザクション全体がロールバック
      // されるため、台帳も作成されず「部分成功状態」が残らない。
      applyAggregationDeltas(transaction, affectedGroups, groupRefs, groupSnaps, docData);
      transaction.create(ledgerRef, buildAggregationEventLedgerEntry({
        source: eventSource,
        subject: eventSubject,
        eventTime,
        nowMillis,
      }));
    });
    if (!skipped) {
      console.log(`[onDocumentWrite] Updated ${affectedGroups.length} groups for doc ${docId} (event ${eventId})`);
    }
  } catch (error) {
    console.error(`[onDocumentWrite] Failed to update groups for ${docId} (event ${eventId}):`, error);
    throw error;
  }

  return { skipped, groupsUpdated: skipped ? 0 : affectedGroups.length };
}

/**
 * ドキュメント書き込み時にグループキーを設定し、グループ集計を更新
 */
export const onDocumentWrite = onDocumentWritten(
  {
    document: 'documents/{docId}',
    region: 'asia-northeast1',
  },
  async (event) => {
    await processDocumentAggregationEvent(db, {
      docId: event.params.docId,
      eventId: event.id,
      eventSource: event.source,
      eventSubject: event.subject,
      eventTime: event.time,
      beforeData: event.data?.before?.data() as DocumentData | undefined,
      afterData: event.data?.after?.data() as DocumentData | undefined,
      nowMillis: Date.now(),
    });
  }
);
