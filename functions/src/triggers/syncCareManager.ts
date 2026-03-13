/**
 * 顧客マスターcareManagerName変更時の同期トリガー
 *
 * #173: masters/customers/items のcareManagerNameが変更されたら、
 * 該当顧客の全ドキュメントの careManager + careManagerKey を更新する。
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { detectCareManagerChange, buildCareManagerUpdate } from './syncCareManagerLogic';

const db = admin.firestore();

export const onCustomerMasterWrite = onDocumentWritten(
  {
    document: 'masters/customers/items/{customerId}',
    region: 'asia-northeast1',
  },
  async (event) => {
    const beforeData = event.data?.before?.data() as { name?: string; careManagerName?: string } | undefined;
    const afterData = event.data?.after?.data() as { name?: string; careManagerName?: string } | undefined;

    const before = beforeData?.name ? { name: beforeData.name, careManagerName: beforeData.careManagerName } : null;
    const after = afterData?.name ? { name: afterData.name, careManagerName: afterData.careManagerName } : null;

    if (!detectCareManagerChange(before, after)) {
      return;
    }

    // afterがnullの場合はdetectCareManagerChangeでfalseになるので、ここではafter非null
    const customerName = after!.name;
    const customerId = event.params.customerId;
    const update = buildCareManagerUpdate(after!.careManagerName);

    // customerIdで特定（正確）、なければcustomerNameで検索
    const byIdSnapshot = await db.collection('documents')
      .where('customerId', '==', customerId)
      .get();

    const byNameSnapshot = byIdSnapshot.empty
      ? await db.collection('documents')
          .where('customerName', '==', customerName)
          .get()
      : null;

    const targetDocs = byNameSnapshot ?? byIdSnapshot;

    if (targetDocs.empty) {
      console.log(`No documents found for customer: ${customerName} (id: ${customerId})`);
      return;
    }

    // バッチ更新（Firestoreバッチは500件まで）
    const batches: admin.firestore.WriteBatch[] = [];
    let currentBatch = db.batch();
    let count = 0;

    for (const doc of targetDocs.docs) {
      currentBatch.update(doc.ref, update);
      count++;
      if (count % 500 === 0) {
        batches.push(currentBatch);
        currentBatch = db.batch();
      }
    }
    batches.push(currentBatch);

    await Promise.all(batches.map(b => b.commit()));

    console.log(`Updated careManager for ${count} documents (customer: ${customerName}, careManager: ${update.careManager})`);
  },
);
