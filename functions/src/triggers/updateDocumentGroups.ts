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
  updateGroupAggregation,
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

/**
 * ドキュメント書き込み時にグループキーを設定し、グループ集計を更新
 */
export const onDocumentWrite = onDocumentWritten(
  {
    document: 'documents/{docId}',
    region: 'asia-northeast1',
  },
  async (event) => {
    const docId = event.params.docId;
    const beforeData = event.data?.before?.data() as DocumentData | undefined;
    const afterData = event.data?.after?.data() as DocumentData | undefined;

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
    const affectedGroups = getAffectedGroups(beforeWithKeys, afterWithKeys);

    // 各グループの集計を更新
    const updatePromises = affectedGroups.map(({ groupType, groupKey, displayName, delta }) =>
      updateGroupAggregation(
        db,
        groupType,
        groupKey,
        displayName,
        delta,
        afterWithKeys ? { ...afterWithKeys, id: docId } : undefined
      )
    );

    try {
      await Promise.all(updatePromises);
      console.log(`[onDocumentWrite] Updated ${affectedGroups.length} groups for doc ${docId}`);
    } catch (error) {
      console.error(`[onDocumentWrite] Failed to update groups for ${docId}:`, error);
      throw error;
    }
  }
);
