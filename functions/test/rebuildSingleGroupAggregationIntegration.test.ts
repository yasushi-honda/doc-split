/**
 * rebuildSingleGroupAggregation() integration テスト (Firestore emulator, GOAL.md タスクJ4)
 *
 * 背景: Issue #660の非冪等トリガーによって蓄積したdocumentGroupsのドリフトが
 * 特定少数のgroupIdに局在している場合の補正手段として、対象groupIdのみを生データから
 * 完全再導出して置換する`rebuildSingleGroupAggregation()`を追加した(/codex plan
 * セカンドオピニオンで設計確定)。本テストは実際のFirestore emulator上で、
 * (a) count/displayName/latestAtの正確な再計算、(b) 既存のdriftしたcount/staleな
 * latestDocsが正しく補正されること、(c) 対象0件時の削除、(d) latestDocsの厳密な
 * processedAt降順(rebuildAllGroupAggregations()のstatus境界をまたぐ既知の限界への
 * 回帰確認)を検証する。
 *
 * 実行: firebase emulators:exec --only firestore --project rebuild-single-group-integration-test \
 *         'npm run test:integration'
 */

import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { cleanupCollections } from './helpers/cleanupEmulator';
import { rebuildSingleGroupAggregation } from '../src/utils/groupAggregation';

const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['documents', 'documentGroups'];

describe('rebuildSingleGroupAggregation (GOAL.md タスクJ4、過去ドリフトの個別グループ補正)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('生データから正しいcount/displayName/latestAtを再計算する', async () => {
    const now = Timestamp.now();
    const batch = db.batch();
    batch.set(db.collection('documents').doc('doc-1'), {
      customerName: '山田太郎', careManager: '佐藤花子', status: 'processed', fileName: 'a.pdf', processedAt: now,
    });
    batch.set(db.collection('documents').doc('doc-2'), {
      customerName: '鈴木一郎', careManager: '佐藤花子', status: 'processed', fileName: 'b.pdf', processedAt: now,
    });
    batch.set(db.collection('documents').doc('doc-other-cm'), {
      customerName: '田中花子', careManager: '高橋実', status: 'processed', fileName: 'c.pdf', processedAt: now,
    });
    await batch.commit();

    const result = await rebuildSingleGroupAggregation(db, 'careManager', '佐藤花子');
    expect(result.deleted).to.equal(false);
    expect(result.count).to.equal(2);

    const snap = await db.collection('documentGroups').doc('careManager_佐藤花子').get();
    expect(snap.data()?.count).to.equal(2);
    expect(snap.data()?.displayName).to.equal('佐藤花子');
    expect(snap.data()?.latestAt.isEqual(now), 'latestAtは対象documentのprocessedAtに基づき再計算されるべき').to.equal(true);
  });

  it('本番で観測された二重計上ドリフト(2倍のcount)を正しい値へ補正する', async () => {
    const now = Timestamp.now();
    // 正しい母集団: careManager=奥村敬子は1件のみ
    await db.collection('documents').doc('doc-okumura').set({
      customerName: '中村誠', careManager: '奥村敬子', status: 'processed', fileName: 'd.pdf', processedAt: now,
    });
    // documentGroupsには(Issue #660の非冪等性により)誤って2倍のcountが記録されている状態を再現
    await db.collection('documentGroups').doc('careManager_奥村敬子').set({
      groupType: 'careManager', groupKey: '奥村敬子', displayName: '奥村敬子',
      count: 2, latestAt: now, latestDocs: [], updatedAt: now,
    });

    const result = await rebuildSingleGroupAggregation(db, 'careManager', '奥村敬子');
    expect(result.count).to.equal(1);

    const snap = await db.collection('documentGroups').doc('careManager_奥村敬子').get();
    expect(snap.data()?.count, '生データに基づく正しいcountへ補正されるべき').to.equal(1);
  });

  it('staleなlatestDocs(既に対象外になったdocument)を正しい最新3件へ置換する', async () => {
    const now = Timestamp.now();
    await db.collection('documents').doc('doc-current').set({
      customerName: '木村保', careManager: '森奈穂美', status: 'processed', fileName: 'current.pdf', processedAt: now,
    });
    // documentGroupsには、既に対象でなくなった(careManagerが変更された)documentのpreviewが
    // 残留している状態を再現(過去のドリフトで典型的に起きるstale previewパターン)
    await db.collection('documentGroups').doc('careManager_森奈穂美').set({
      groupType: 'careManager', groupKey: '森奈穂美', displayName: '森奈穂美',
      count: 1,
      latestAt: now,
      latestDocs: [{ id: 'doc-stale-deleted', fileName: 'stale.pdf', documentType: '', processedAt: now }],
      updatedAt: now,
    });

    const result = await rebuildSingleGroupAggregation(db, 'careManager', '森奈穂美');
    expect(result.count).to.equal(1);

    const snap = await db.collection('documentGroups').doc('careManager_森奈穂美').get();
    const latestDocs = snap.data()?.latestDocs as Array<{ id: string }>;
    expect(latestDocs).to.have.lengthOf(1);
    expect(latestDocs[0].id, 'staleなpreviewは現在の生データに基づくものへ置換されるべき').to.equal('doc-current');
  });

  it('対象groupに一致するdocumentが0件の場合、既存グループを削除する', async () => {
    await db.collection('documentGroups').doc('careManager_退職済CM').set({
      groupType: 'careManager', groupKey: '退職済CM', displayName: '退職済CM',
      count: 5, latestAt: Timestamp.now(), latestDocs: [], updatedAt: Timestamp.now(),
    });

    const result = await rebuildSingleGroupAggregation(db, 'careManager', '退職済CM');
    expect(result.deleted).to.equal(true);
    expect(result.count).to.equal(0);

    const snap = await db.collection('documentGroups').doc('careManager_退職済CM').get();
    expect(snap.exists, '対象0件のグループは削除されるべき').to.equal(false);
  });

  it('latestDocsはstatus境界をまたいでも厳密にprocessedAt降順で先頭3件が選ばれる(rebuildAllGroupAggregationsの既知の限界への回帰確認)', async () => {
    // rebuildAllGroupAggregations()のクエリはorderBy('status').orderBy('processedAt','desc')で
    // statusが第一ソートキーのため、'completed'グループの中で先に3件embedされてしまうと、
    // 後続の'processed'グループ内のより新しいdocumentが反映されない既知の限界がある。
    // rebuildSingleGroupAggregation()は全件収集後にソートするため、この限界を持たない。
    const t = (msOffset: number) => Timestamp.fromMillis(Date.now() + msOffset);
    const batch = db.batch();
    // 'completed'(statusソートで先に来る想定)側に4件、うち3件は古い
    batch.set(db.collection('documents').doc('doc-completed-old-1'), {
      customerName: 'A', careManager: '共通担当', status: 'completed', fileName: 'c1.pdf', processedAt: t(-5000),
    });
    batch.set(db.collection('documents').doc('doc-completed-old-2'), {
      customerName: 'B', careManager: '共通担当', status: 'completed', fileName: 'c2.pdf', processedAt: t(-4000),
    });
    batch.set(db.collection('documents').doc('doc-completed-old-3'), {
      customerName: 'C', careManager: '共通担当', status: 'completed', fileName: 'c3.pdf', processedAt: t(-3000),
    });
    // 'processed'側に、上記より新しいdocumentを1件
    batch.set(db.collection('documents').doc('doc-processed-newest'), {
      customerName: 'D', careManager: '共通担当', status: 'processed', fileName: 'p1.pdf', processedAt: t(0),
    });
    await batch.commit();

    const result = await rebuildSingleGroupAggregation(db, 'careManager', '共通担当');
    expect(result.count).to.equal(4);

    const snap = await db.collection('documentGroups').doc('careManager_共通担当').get();
    const latestDocs = snap.data()?.latestDocs as Array<{ id: string }>;
    expect(latestDocs).to.have.lengthOf(3);
    // 真にprocessedAt降順であれば、最新のdoc-processed-newestが必ず含まれるはず
    expect(latestDocs.map((d) => d.id)).to.include('doc-processed-newest');
    expect(latestDocs[0].id, '最新のdocumentが先頭に来るべき').to.equal('doc-processed-newest');
  });

  it('batchSizeを跨ぐ大規模グループでも全documentが漏れなく1回ずつ集計される(pr-test-analyzer指摘: ページネーション境界の回帰確認)', async () => {
    const now = Timestamp.now();
    const batch = db.batch();
    for (let i = 0; i < 5; i++) {
      batch.set(db.collection('documents').doc(`doc-page-${i}`), {
        customerName: `顧客${i}`, careManager: '大規模担当', status: 'processed', fileName: `p${i}.pdf`, processedAt: now,
      });
    }
    await batch.commit();

    // batchSize=2で5件を強制的に3ページ(2+2+1)に分割してスキャンさせる
    const result = await rebuildSingleGroupAggregation(db, 'careManager', '大規模担当', { batchSize: 2 });
    expect(result.count, 'ページ境界で漏れ/重複なく5件すべてが集計されるべき').to.equal(5);

    const snap = await db.collection('documentGroups').doc('careManager_大規模担当').get();
    expect(snap.data()?.count).to.equal(5);
  });

  it('groupType=customerでも正しく再構築される(careManager以外の型の回帰確認)', async () => {
    const now = Timestamp.now();
    const batch = db.batch();
    batch.set(db.collection('documents').doc('doc-cust-1'), {
      customerName: '山田太郎', careManager: '佐藤花子', status: 'processed', fileName: 'a.pdf', processedAt: now,
    });
    batch.set(db.collection('documents').doc('doc-cust-2'), {
      customerName: '山田太郎', careManager: '高橋実', status: 'processed', fileName: 'b.pdf', processedAt: now,
    });
    batch.set(db.collection('documents').doc('doc-cust-other'), {
      customerName: '鈴木一郎', careManager: '佐藤花子', status: 'processed', fileName: 'c.pdf', processedAt: now,
    });
    await batch.commit();

    const result = await rebuildSingleGroupAggregation(db, 'customer', '山田太郎');
    expect(result.count).to.equal(2);

    const snap = await db.collection('documentGroups').doc('customer_山田太郎').get();
    expect(snap.data()?.count).to.equal(2);
    expect(snap.data()?.displayName).to.equal('山田太郎');
  });
});
