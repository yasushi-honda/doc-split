/**
 * 差分集計(getAffectedGroups)と全件再集計(rebuildAllGroupAggregations)の
 * 一致性契約テスト (Firestore emulator, GOAL.md タスクE)
 *
 * 背景: `functions/src/triggers/updateDocumentGroups.ts`(onDocumentWrite)は
 * documents書き込みのたびにgetAffectedGroups()の差分をdocumentGroupsへ逐次適用する。
 * 一方、`scripts/migrate-document-groups.js`等のマイグレーションはrebuildAllGroupAggregations()
 * でdocumentGroups全体を都度再構築する。両者は独立した実装(getAffectedGroups /
 * rebuildAllGroupAggregations)でありながら、同一のdocuments集合に対して常に同じ
 * documentGroups状態へ収束することが本番の集計整合性の前提になっている
 * (/codex plan セカンドオピニオン指摘③)。groupAggregation.test.tsの単体テストは
 * pure functionの戻り値のみを検証しFirestoreへの実書き込みを経由しないため、本テストは
 * 実際のFirestore emulator上で両経路を実行し、最終的なdocumentGroupsの内容
 * (groupType/groupKey/displayName/count)が完全一致することを検証する。
 *
 * 実行: firebase emulators:exec --only firestore --project group-aggregation-rebuild-integration-test \
 *         'npm run test:integration'
 */

import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { cleanupCollections } from './helpers/cleanupEmulator';
import {
  generateGroupKeys,
  getAffectedGroups,
  updateGroupAggregation,
  rebuildAllGroupAggregations,
} from '../src/utils/groupAggregation';

const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['documents', 'documentGroups'];

interface Fixture {
  id: string;
  data: Record<string, unknown>;
}

// customer/office/documentType/careManagerの全パターン(実在CM・CM未設定・
// customerKey未確定・split除外)を含むfixture。groupAggregation.test.tsの
// 単体テストでlock-inされた境界値を、実Firestore上の集計として再現する。
function baseFixtures(): Fixture[] {
  const now = Timestamp.now();
  return [
    {
      id: 'doc-cm-a',
      data: {
        customerName: '山田太郎', officeName: '事業所A', documentType: '契約書',
        careManager: '佐藤花子', status: 'processed', fileName: 'a.pdf', processedAt: now,
      },
    },
    {
      id: 'doc-cm-missing-1',
      data: {
        customerName: '鈴木一郎', officeName: '事業所A', documentType: '契約書',
        status: 'processed', fileName: 'b.pdf', processedAt: now, // careManager未設定
      },
    },
    {
      id: 'doc-cm-b',
      data: {
        customerName: '田中花子', officeName: '事業所B', documentType: '請求書',
        careManager: '佐藤花子', status: 'completed', fileName: 'c.pdf', processedAt: now,
      },
    },
    {
      id: 'doc-cm-missing-2',
      data: {
        customerName: '渡辺次郎', officeName: '事業所B', documentType: '請求書',
        careManager: '', status: 'processed', fileName: 'd.pdf', processedAt: now,
      },
    },
    {
      id: 'doc-split-excluded',
      data: {
        customerName: '除外太郎', officeName: '事業所A', documentType: '契約書',
        careManager: '', status: 'split', fileName: 'e.pdf', processedAt: now,
      },
    },
    {
      id: 'doc-pending-no-customer',
      data: {
        status: 'pending', fileName: 'f.pdf', processedAt: now, // customerName/careManagerとも未設定
      },
    },
    {
      id: 'doc-pending-cm-only',
      data: {
        officeName: '事業所C', documentType: '介護計画書', careManager: '佐藤花子',
        status: 'pending', fileName: 'g.pdf', processedAt: now, // customerNameのみ未確定
      },
    },
  ];
}

interface GroupSnapshotEntry {
  groupType: string;
  groupKey: string;
  displayName: string;
  count: number;
}

/** documentGroupsの現在状態を、比較に無関係な時刻系フィールド(updatedAt/latestAt/latestDocs)を除いて取得する */
async function snapshotGroups(): Promise<Record<string, GroupSnapshotEntry>> {
  const snap = await db.collection('documentGroups').get();
  const out: Record<string, GroupSnapshotEntry> = {};
  snap.forEach((doc) => {
    const d = doc.data();
    out[doc.id] = {
      groupType: d.groupType,
      groupKey: d.groupKey,
      displayName: d.displayName,
      count: d.count,
    };
  });
  return out;
}

/** onDocumentWrite(updateDocumentGroups.ts)と同一手順でcreateイベントの差分をdocumentGroupsへ適用する */
async function applyCreateDiff(fixture: Fixture): Promise<void> {
  const withKeys = { ...fixture.data, ...generateGroupKeys(fixture.data) };
  const affected = getAffectedGroups(undefined, withKeys);
  for (const { groupType, groupKey, displayName, delta } of affected) {
    await updateGroupAggregation(db, groupType, groupKey, displayName, delta, {
      ...withKeys,
      id: fixture.id,
    });
  }
}

/** onDocumentWriteと同一手順でupdateイベントの差分をdocumentGroupsへ適用する */
async function applyUpdateDiff(before: Record<string, unknown>, after: Record<string, unknown>, docId: string): Promise<void> {
  const beforeWithKeys = { ...before, ...generateGroupKeys(before) };
  const afterWithKeys = { ...after, ...generateGroupKeys(after) };
  const affected = getAffectedGroups(beforeWithKeys, afterWithKeys);
  for (const { groupType, groupKey, displayName, delta } of affected) {
    await updateGroupAggregation(db, groupType, groupKey, displayName, delta, {
      ...afterWithKeys,
      id: docId,
    });
  }
}

describe('差分集計 vs 全件再集計の一致性契約 (getAffectedGroups vs rebuildAllGroupAggregations, GOAL.md タスクE)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('create差分の逐次適用結果と全件再集計結果が完全一致する', async () => {
    const fixtures = baseFixtures();

    // documents本体を書き込む(rebuildAllGroupAggregations()が直接スキャンする対象)
    const batch = db.batch();
    for (const f of fixtures) {
      batch.set(db.collection('documents').doc(f.id), f.data);
    }
    await batch.commit();

    // 差分path: onDocumentWriteのcreateイベントと同一手順でdocumentGroupsを構築
    for (const f of fixtures) {
      await applyCreateDiff(f);
    }
    const diffResult = await snapshotGroups();

    // 全件再集計path: documentGroupsをクリアしてrebuildAllGroupAggregations()で再構築
    await cleanupCollections(db, ['documentGroups']);
    const rebuildStats = await rebuildAllGroupAggregations(db, 500);
    const rebuildResult = await snapshotGroups();

    expect(diffResult).to.deep.equal(rebuildResult);

    // 両経路が実際に非自明な結果を生成していること(空集合同士の一致による偽陽性を防止)。
    // 期待値はハードコードせず、fixtureの意味(split除外・customerKey未確定除外・CM未設定
    // フォールバック)から導かれる集計対象母集団の件数と突き合わせる。
    expect(rebuildStats.processed).to.equal(6); // status='split'の1件を除く6件が母集団
    const groupsByType = Object.values(rebuildResult).reduce<Record<string, number>>((acc, g) => {
      acc[g.groupType] = (acc[g.groupType] || 0) + 1;
      return acc;
    }, {});
    expect(groupsByType.customer).to.equal(4); // 山田太郎/鈴木一郎/田中花子/渡辺次郎(customerName未設定2件は除外)
    expect(groupsByType.careManager).to.equal(2); // 佐藤花子 + CM未設定
    const cmMissingGroup = Object.values(rebuildResult).find(
      (g) => g.groupType === 'careManager' && g.displayName === 'CM未設定'
    );
    expect(cmMissingGroup?.count).to.equal(2); // doc-cm-missing-1, doc-cm-missing-2
  });

  it('create+update差分の逐次適用結果と全件再集計結果が完全一致する(実CM→CM未設定の変更を含む)', async () => {
    const fixtures = baseFixtures();

    const batch = db.batch();
    for (const f of fixtures) {
      batch.set(db.collection('documents').doc(f.id), f.data);
    }
    await batch.commit();

    for (const f of fixtures) {
      await applyCreateDiff(f);
    }

    // doc-cm-a(佐藤花子)のcareManagerを未設定に変更する差分を適用
    const target = fixtures.find((f) => f.id === 'doc-cm-a')!;
    const beforeData = target.data;
    const afterData = { ...target.data, careManager: '' };
    await db.collection('documents').doc(target.id).update({ careManager: '' });
    await applyUpdateDiff(beforeData, afterData, target.id);

    const diffResult = await snapshotGroups();

    await cleanupCollections(db, ['documentGroups']);
    await rebuildAllGroupAggregations(db, 500);
    const rebuildResult = await snapshotGroups();

    expect(diffResult).to.deep.equal(rebuildResult);

    // doc-cm-b(田中花子)・doc-pending-cm-onlyが実CM「佐藤花子」に残り、doc-cm-aはCM未設定へ移動しているはず
    const sato = Object.values(rebuildResult).find(
      (g) => g.groupType === 'careManager' && g.displayName === '佐藤花子'
    );
    expect(sato?.count).to.equal(2);
    const cmMissingGroup = Object.values(rebuildResult).find(
      (g) => g.groupType === 'careManager' && g.displayName === 'CM未設定'
    );
    expect(cmMissingGroup?.count).to.equal(3); // doc-cm-missing-1, doc-cm-missing-2, doc-cm-a(変更後)
  });
});
