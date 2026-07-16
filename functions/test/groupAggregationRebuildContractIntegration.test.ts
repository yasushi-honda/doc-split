/**
 * 差分集計(processDocumentAggregationEvent)と全件再集計(rebuildAllGroupAggregations)の
 * 一致性契約テスト (Firestore emulator, GOAL.md タスクE → Issue #664修正で更新)
 *
 * 背景: `functions/src/triggers/updateDocumentGroups.ts`(onDocumentWrite)は、documents
 * 書き込みのたびに`processDocumentAggregationEvent()`(ライブ再読込み+
 * `documentAggregationStates`とのcontribution diff、ADR-0021)でdocumentGroupsを
 * 逐次更新する。一方、`scripts/migrate-document-groups.js`等のマイグレーションは
 * rebuildAllGroupAggregations()でdocumentGroups全体を都度再構築する。両者は独立した
 * 実装でありながら、同一のdocuments集合に対して常に同じdocumentGroups状態へ収束する
 * ことが本番の集計整合性の前提になっている(/codex plan セカンドオピニオン指摘③)。
 * groupAggregation.test.tsの単体テストはpure functionの戻り値のみを検証し
 * Firestoreへの実書き込みを経由しないため、本テストは実際のFirestore emulator上で
 * 本番トリガーと同一の`processDocumentAggregationEvent()`を実行し、
 * 全件再集計と最終的なdocumentGroupsの内容(groupType/groupKey/displayName/count)が
 * 完全一致することを検証する。
 *
 * Issue #664修正(ADR-0021)により、本テストが実行する差分pathを旧`getAffectedGroups()`
 * ベースの独自ヘルパーから`processDocumentAggregationEvent()`本体の直接呼び出しに更新した
 * (code-review指摘: 旧ヘルパーは本番で使われなくなったコードパスを検証しており、
 * buildContribution/diffContributionモデルの正しさを一切カバーしていなかった)。
 *
 * 実行: firebase emulators:exec --only firestore --project group-aggregation-rebuild-integration-test \
 *         'npm run test:integration'
 */

import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { cleanupCollections } from './helpers/cleanupEmulator';
import { rebuildAllGroupAggregations } from '../src/utils/groupAggregation';
import { processDocumentAggregationEvent } from '../src/triggers/updateDocumentGroups';

const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = [
  'documents', 'documentGroups', 'documentAggregationEvents', 'documentAggregationStates',
];

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

let eventCounter = 0;

/**
 * `documents/{docId}`書込み1件分のイベントを、本番トリガーと同一の
 * `processDocumentAggregationEvent()`で処理する。ライブ再読込みモデル(ADR-0021)の
 * ため、create/updateを区別する必要はない(呼び出し時点のFirestore上の実データを
 * 常に正として扱う)。呼び出し前にdocuments/{docId}への実際の書込み(set/update/delete)
 * を済ませておくこと。
 */
async function applyEvent(docId: string): Promise<void> {
  eventCounter++;
  await processDocumentAggregationEvent(db, {
    docId,
    eventId: `contract-event-${eventCounter}`,
    eventSource: '//firestore.googleapis.com/projects/test/databases/(default)',
    eventSubject: `documents/${docId}`,
    eventTime: new Date().toISOString(),
    nowMillis: Date.now(),
  });
}

describe('差分集計 vs 全件再集計の一致性契約 (processDocumentAggregationEvent vs rebuildAllGroupAggregations, GOAL.md タスクE / Issue #664)', () => {
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

    // 差分path: onDocumentWriteの本番ロジック(processDocumentAggregationEvent)と
    // 同一手順でdocumentGroupsを構築
    for (const f of fixtures) {
      await applyEvent(f.id);
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
      await applyEvent(f.id);
    }

    // doc-cm-a(佐藤花子)のcareManagerを未設定に変更する差分を適用
    const target = fixtures.find((f) => f.id === 'doc-cm-a')!;
    await db.collection('documents').doc(target.id).update({ careManager: '' });
    await applyEvent(target.id);

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
