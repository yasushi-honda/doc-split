/**
 * グループ集計ユーティリティ
 * ドキュメントグループの集計・更新処理
 */

import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

// GroupType の定義（shared/types.ts からインポートできない場合のローカル定義）
export type GroupType = 'customer' | 'office' | 'documentType' | 'careManager';

export interface GroupPreviewDoc {
  id: string;
  fileName: string;
  documentType: string;
  processedAt: Timestamp;
}

export interface DocumentGroupData {
  groupType: GroupType;
  groupKey: string;
  displayName: string;
  count: number;
  latestAt: Timestamp;
  latestDocs: GroupPreviewDoc[];
  updatedAt: Timestamp;
}

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
 * テキストを正規化してグループキーを生成
 * 全角→半角、大文字→小文字、空白除去
 */
export function normalizeGroupKey(value: string | undefined | null): string {
  if (!value) return '';

  return value
    // 全角英数字→半角
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) =>
      String.fromCharCode(s.charCodeAt(0) - 0xFEE0)
    )
    // 大文字→小文字
    .toLowerCase()
    // 空白除去
    .replace(/[\s\u3000]/g, '')
    // 連続する空白系を統合
    .trim();
}

/**
 * ドキュメントからグループキーを生成
 */
export function generateGroupKeys(data: DocumentData): {
  customerKey: string;
  officeKey: string;
  documentTypeKey: string;
  careManagerKey: string;
} {
  return {
    customerKey: normalizeGroupKey(data.customerName),
    officeKey: normalizeGroupKey(data.officeName),
    documentTypeKey: normalizeGroupKey(data.documentType),
    careManagerKey: normalizeGroupKey(data.careManager),
  };
}

/**
 * グループIDを生成
 */
export function generateGroupId(groupType: GroupType, groupKey: string): string {
  return `${groupType}_${groupKey}`;
}

/**
 * 影響を受けるグループを特定
 */
export function getAffectedGroups(
  before: DocumentData | undefined,
  after: DocumentData | undefined
): Array<{ groupType: GroupType; groupKey: string; displayName: string; delta: number }> {
  const affected: Array<{ groupType: GroupType; groupKey: string; displayName: string; delta: number }> = [];

  const types: Array<{ type: GroupType; keyField: keyof DocumentData; displayField: keyof DocumentData }> = [
    { type: 'customer', keyField: 'customerKey', displayField: 'customerName' },
    { type: 'office', keyField: 'officeKey', displayField: 'officeName' },
    { type: 'documentType', keyField: 'documentTypeKey', displayField: 'documentType' },
    { type: 'careManager', keyField: 'careManagerKey', displayField: 'careManager' },
  ];

  for (const { type, keyField, displayField } of types) {
    const beforeKey = before?.[keyField] as string | undefined;
    const afterKey = after?.[keyField] as string | undefined;
    const beforeDisplay = before?.[displayField] as string | undefined;
    const afterDisplay = after?.[displayField] as string | undefined;

    // 分割済みステータスは集計対象外
    const beforeStatus = before?.status;
    const afterStatus = after?.status;
    const beforeValid = beforeKey && beforeStatus !== 'split';
    const afterValid = afterKey && afterStatus !== 'split';

    if (beforeValid && afterValid && beforeKey === afterKey) {
      // キーが変わらない場合は更新のみ（latestDocs更新用）
      affected.push({ groupType: type, groupKey: afterKey!, displayName: afterDisplay || afterKey!, delta: 0 });
    } else {
      // 削除または変更：古いグループから-1
      if (beforeValid) {
        affected.push({ groupType: type, groupKey: beforeKey!, displayName: beforeDisplay || beforeKey!, delta: -1 });
      }
      // 追加または変更：新しいグループに+1
      if (afterValid) {
        affected.push({ groupType: type, groupKey: afterKey!, displayName: afterDisplay || afterKey!, delta: 1 });
      }
    }
  }

  return affected;
}

/**
 * グループ集計を更新
 */
export async function updateGroupAggregation(
  db: admin.firestore.Firestore,
  groupType: GroupType,
  groupKey: string,
  displayName: string,
  delta: number,
  docData?: DocumentData & { id?: string }
): Promise<void> {
  if (!groupKey) return;

  const groupId = generateGroupId(groupType, groupKey);
  const groupRef = db.collection('documentGroups').doc(groupId);

  await db.runTransaction(async (transaction) => {
    const groupSnap = await transaction.get(groupRef);

    if (groupSnap.exists) {
      const currentData = groupSnap.data() as DocumentGroupData;
      const newCount = Math.max(0, currentData.count + delta);

      if (newCount === 0) {
        // カウントが0になったらグループを削除
        transaction.delete(groupRef);
      } else {
        // カウント更新 & latestDocs更新
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updateData: any = {
          count: newCount,
          displayName: displayName || currentData.displayName,
          updatedAt: FieldValue.serverTimestamp(),
        };

        // delta > 0（追加）の場合はlatestDocsを更新
        if (delta > 0 && docData?.id) {
          const newDoc: GroupPreviewDoc = {
            id: docData.id,
            fileName: docData.fileName || '',
            documentType: docData.documentType || '',
            processedAt: docData.processedAt || Timestamp.now(),
          };

          // 既存のlatestDocsから重複を除去し、新しいドキュメントを先頭に追加
          const existingDocs = (currentData.latestDocs || []).filter(d => d.id !== docData.id);
          const newLatestDocs = [newDoc, ...existingDocs].slice(0, 3);

          updateData.latestDocs = newLatestDocs;
          updateData.latestAt = docData.processedAt || Timestamp.now();
        }

        transaction.update(groupRef, updateData);
      }
    } else if (delta > 0) {
      // 新規グループ作成
      const latestDocs: GroupPreviewDoc[] = docData?.id ? [{
        id: docData.id,
        fileName: docData.fileName || '',
        documentType: docData.documentType || '',
        processedAt: docData.processedAt || Timestamp.now(),
      }] : [];

      const newGroupData: DocumentGroupData = {
        groupType,
        groupKey,
        displayName: displayName || groupKey,
        count: 1,
        latestAt: docData?.processedAt || Timestamp.now(),
        latestDocs,
        updatedAt: Timestamp.now(),
      };

      transaction.set(groupRef, newGroupData);
    }
  });
}

/**
 * 全グループ集計を再構築（マイグレーション用）
 */
export async function rebuildAllGroupAggregations(
  db: admin.firestore.Firestore,
  batchSize: number = 500
): Promise<{ processed: number; groups: number }> {
  // 既存のdocumentGroupsを削除
  const existingGroups = await db.collection('documentGroups').get();
  const deletePromises = existingGroups.docs.map(doc => doc.ref.delete());
  await Promise.all(deletePromises);

  // グループ集計用のマップ
  const groupMap = new Map<string, {
    groupType: GroupType;
    groupKey: string;
    displayName: string;
    count: number;
    latestAt: Timestamp;
    latestDocs: GroupPreviewDoc[];
  }>();

  // documentsを全件スキャン
  let processed = 0;
  let lastDoc: admin.firestore.QueryDocumentSnapshot | undefined;

  while (true) {
    let query = db.collection('documents')
      .where('status', '!=', 'split')
      .orderBy('status')
      .orderBy('processedAt', 'desc')
      .limit(batchSize);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data() as DocumentData;
      const keys = generateGroupKeys(data);

      // 各グループタイプに対して集計
      const types: Array<{ type: GroupType; key: string; display: string }> = [
        { type: 'customer', key: keys.customerKey, display: data.customerName || '' },
        { type: 'office', key: keys.officeKey, display: data.officeName || '' },
        { type: 'documentType', key: keys.documentTypeKey, display: data.documentType || '' },
        { type: 'careManager', key: keys.careManagerKey, display: data.careManager || '' },
      ];

      for (const { type, key, display } of types) {
        if (!key) continue;

        const groupId = generateGroupId(type, key);
        const existing = groupMap.get(groupId);

        const previewDoc: GroupPreviewDoc = {
          id: docSnap.id,
          fileName: data.fileName || '',
          documentType: data.documentType || '',
          processedAt: data.processedAt || Timestamp.now(),
        };

        if (existing) {
          existing.count++;
          if (existing.latestDocs.length < 3) {
            existing.latestDocs.push(previewDoc);
          }
          // latestAtの更新（より新しい場合）
          if (data.processedAt && data.processedAt.toMillis() > existing.latestAt.toMillis()) {
            existing.latestAt = data.processedAt;
          }
        } else {
          groupMap.set(groupId, {
            groupType: type,
            groupKey: key,
            displayName: display || key,
            count: 1,
            latestAt: data.processedAt || Timestamp.now(),
            latestDocs: [previewDoc],
          });
        }
      }

      processed++;
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
  }

  // グループデータをFirestoreに書き込み
  const batch = db.batch();
  let batchCount = 0;
  const batches: admin.firestore.WriteBatch[] = [batch];

  for (const [groupId, data] of groupMap) {
    const currentBatch = batches[batches.length - 1];
    const groupRef = db.collection('documentGroups').doc(groupId);

    currentBatch.set(groupRef, {
      ...data,
      updatedAt: FieldValue.serverTimestamp(),
    });

    batchCount++;
    if (batchCount >= 500) {
      batches.push(db.batch());
      batchCount = 0;
    }
  }

  // バッチコミット
  await Promise.all(batches.map(b => b.commit()));

  return { processed, groups: groupMap.size };
}
