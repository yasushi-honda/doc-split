/**
 * documents集計トリガー(onDocumentWrite)のイベント冪等性 integration テスト
 * (Issue #660修正、ADR-0020、Firestore emulator)
 *
 * Firestore/EventarcはCloudEventをat-least-once配信するため、`onDocumentWrite`が
 * 同一event.idに対して複数回・かつ配信順序が入れ替わって呼び出される可能性がある。
 * `documentAggregationEvents/{event.id}`をイベント処理済み台帳として、
 * 「台帳確認→全affected group更新→台帳作成」を単一トランザクションでatomicに実行する
 * ことで、これらのケースに対して冪等であることを本テストでlock-inする。
 *
 * CloudEvent(`event`オブジェクト)構築の複雑さを避けるため、`onDocumentWritten`の
 * プラミング部分から独立させた`processDocumentAggregationEvent()`を直接呼び出す。
 *
 * 実行: firebase emulators:exec --only firestore --project update-document-groups-idempotency-integration-test \
 *         'npm run test:integration'
 */

import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { cleanupCollections } from './helpers/cleanupEmulator';
import { processDocumentAggregationEvent } from '../src/triggers/updateDocumentGroups';

const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['documents', 'documentGroups', 'documentAggregationEvents'];

function baseInput(overrides: Partial<Parameters<typeof processDocumentAggregationEvent>[1]> = {}) {
  return {
    docId: 'doc-1',
    eventId: 'event-A',
    eventSource: '//firestore.googleapis.com/projects/test/databases/(default)',
    eventSubject: 'documents/doc-1',
    eventTime: '2026-07-15T00:00:00.000Z',
    beforeData: undefined,
    afterData: undefined,
    nowMillis: Date.parse('2026-07-15T00:00:00.000Z'),
    ...overrides,
  };
}

/**
 * 正規化済みキー(customerKey等)を含む完全なdocumentDataを生成する。
 * キーをNameと矛盾なく揃えることで`needsKeyUpdate`を確定的にfalseにし、
 * (実際には作成していない)documents/{docId}への自己書込み試行を回避する
 * (集計冪等性のテストにキー正規化の副作用を混入させないため)。
 */
function fullDocData(overrides: Record<string, unknown> = {}) {
  return {
    customerName: '山田太郎', customerKey: '山田太郎',
    officeName: '事業所A', officeKey: '事業所a',
    documentType: '契約書', documentTypeKey: '契約書',
    careManager: '佐藤花子', careManagerKey: '佐藤花子',
    status: 'processed', fileName: 'a.pdf', processedAt: Timestamp.now(),
    ...overrides,
  };
}

async function groupCount(groupType: string, name: string): Promise<number> {
  const groupId = `${groupType}_${name}`;
  const snap = await db.collection('documentGroups').doc(groupId).get();
  return snap.exists ? (snap.data()!.count as number) : 0;
}

async function careManagerGroupCount(name: string): Promise<number> {
  return groupCount('careManager', name);
}

async function customerGroupCount(name: string): Promise<number> {
  return groupCount('customer', name);
}

describe('onDocumentWrite イベント冪等性 (Issue #660修正、ADR-0020)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('AC1: 同一event.idの二重(逐次)実行 → documentGroupsのcount変化は1回分のみ', async () => {
    const input = baseInput({ afterData: fullDocData() });

    const first = await processDocumentAggregationEvent(db, input);
    expect(first.skipped).to.equal(false);
    expect(first.groupsUpdated).to.be.greaterThan(0);

    expect(await careManagerGroupCount('佐藤花子')).to.equal(1);

    // 同一event.idでの再配信(at-least-once配信のシミュレーション)
    const second = await processDocumentAggregationEvent(db, input);
    expect(second.skipped).to.equal(true);
    expect(second.groupsUpdated).to.equal(0);

    expect(await careManagerGroupCount('佐藤花子'), '再配信でcountが二重加算されてはいけない').to.equal(1);
  });

  it('AC2(核心ケース): A→B→A順序不同再配信でも、古いAの再適用が起きない', async () => {
    // イベントA: careManager未設定 → 佐藤花子
    const afterA = fullDocData({ careManager: '佐藤花子', careManagerKey: '佐藤花子' });
    const eventA = baseInput({ eventId: 'event-A', beforeData: undefined, afterData: afterA });
    await processDocumentAggregationEvent(db, eventA);
    expect(await careManagerGroupCount('佐藤花子')).to.equal(1);

    // イベントB: 佐藤花子 → 鈴木一郎(担当CM変更)
    const afterB = { ...afterA, careManager: '鈴木一郎', careManagerKey: '鈴木一郎' };
    const eventB = baseInput({ eventId: 'event-B', beforeData: afterA, afterData: afterB });
    await processDocumentAggregationEvent(db, eventB);
    expect(await careManagerGroupCount('佐藤花子'), 'B適用後、佐藤花子グループは0に戻るはず').to.equal(0);
    expect(await careManagerGroupCount('鈴木一郎')).to.equal(1);

    // イベントAが遅延配信される(Bより後に到着する順序不同ケース)。
    // 単一フィールド方式(documents.lastAggregationEventId)ではlast=B≠Aとなり
    // 誤って再適用してしまうケース(/codex plan指摘の核心)。台帳方式ではevent.id=A
    // は既にdocumentAggregationEvents/event-Aとして記録済みのため、正しくskipされる。
    const lateEventA = await processDocumentAggregationEvent(db, eventA);
    expect(lateEventA.skipped, '遅延再配信されたAは既処理としてskipされるべき').to.equal(true);

    expect(await careManagerGroupCount('佐藤花子'), 'Aの遅延再配信で佐藤花子グループが復活してはいけない').to.equal(0);
    expect(await careManagerGroupCount('鈴木一郎'), 'Aの遅延再配信で鈴木一郎グループが二重計上されてはいけない').to.equal(1);
  });

  it('AC3: delete→delete再配信でも二重減算が起きない', async () => {
    const afterData = fullDocData({ customerName: '田中花子', customerKey: '田中花子' });

    const createEvent = baseInput({ eventId: 'event-create', beforeData: undefined, afterData });
    await processDocumentAggregationEvent(db, createEvent);
    expect(await careManagerGroupCount('佐藤花子')).to.equal(1);

    const deleteEvent = baseInput({ eventId: 'event-delete', beforeData: afterData, afterData: undefined });
    const firstDelete = await processDocumentAggregationEvent(db, deleteEvent);
    expect(firstDelete.skipped).to.equal(false);
    expect(await careManagerGroupCount('佐藤花子')).to.equal(0);

    // 削除イベントの再配信
    const secondDelete = await processDocumentAggregationEvent(db, deleteEvent);
    expect(secondDelete.skipped, '削除イベントの再配信もskipされるべき').to.equal(true);
    expect(await careManagerGroupCount('佐藤花子'), '再配信でcountが負数になってはいけない').to.equal(0);
  });

  it('AC4: 同一event.idの並行実行でも、集計は1回分のみ反映される(トランザクション競合の正しい処理)', async () => {
    const input = baseInput({
      eventId: 'event-concurrent',
      afterData: fullDocData({ customerName: '渡辺次郎', customerKey: '渡辺次郎', careManager: '高橋実', careManagerKey: '高橋実' }),
    });

    // 同一event.idの並行実行(Firestoreトランザクションの楽観的並行性制御により、
    // 一方が先にcommitし、もう一方はretry後にledgerSnap.exists=trueを見てskipする)
    const [r1, r2] = await Promise.all([
      processDocumentAggregationEvent(db, input),
      processDocumentAggregationEvent(db, input),
    ]);

    const skippedCount = [r1, r2].filter((r) => r.skipped).length;
    const appliedCount = [r1, r2].filter((r) => !r.skipped).length;
    expect(appliedCount, '並行実行でも適用は1回のみ').to.equal(1);
    expect(skippedCount).to.equal(1);

    expect(await careManagerGroupCount('高橋実')).to.equal(1);
  });

  it('AC5: キー正規化のみが必要なイベント(needsKeyUpdate)でも、正規化済みイベントと同じ集計結果になる(既存isAggregationUnchanged早期returnのリグレッション確認)', async () => {
    // customerKey/careManagerKey等の正規化キーが未設定のまま書き込まれたケース
    // (例: FE直接編集や旧データ)。onDocumentWrite内で自己書込みによりキーが補完される。
    // このケースでは実際にdocuments/doc-key-normalizeを事前作成しておく必要がある
    // (needsKeyUpdate時の自己書込みが対象文書の存在を前提とするため)。
    await db.collection('documents').doc('doc-key-normalize').set({
      customerName: '木村保', careManager: '森奈穂美', status: 'processed',
      fileName: 'e.pdf', processedAt: Timestamp.now(),
    });

    const afterDataWithoutKeys = {
      customerName: '木村保', careManager: '森奈穂美',
      status: 'processed', fileName: 'e.pdf', processedAt: Timestamp.now(),
    };
    const input = baseInput({ eventId: 'event-key-normalize', docId: 'doc-key-normalize', afterData: afterDataWithoutKeys });

    const result = await processDocumentAggregationEvent(db, input);
    expect(result.skipped).to.equal(false);
    expect(await careManagerGroupCount('森奈穂美'), 'キー未設定でも正規化後の値で正しく集計されるべき').to.equal(1);

    // 自己書込みで正規化されたキーがdocuments側に反映されていることを確認
    const docSnap = await db.collection('documents').doc('doc-key-normalize').get();
    expect(docSnap.data()?.careManagerKey).to.equal('森奈穂美');
    expect(docSnap.data()?.customerKey).to.equal('木村保');
  });

  it('AC6(アトミック性の実証、ADR-0020の核心的claim): 一部グループの更新が失敗した場合、他グループの更新も台帳作成もロールバックされる', async () => {
    // 事前に正常な初期状態を作成(customer/careManager双方のグループがcount=1)
    const initialData = fullDocData({
      customerName: '伊藤浩二', customerKey: '伊藤浩二',
      careManager: '佐藤花子', careManagerKey: '佐藤花子',
    });
    const initEvent = baseInput({ eventId: 'event-fault-init', docId: 'doc-fault-injection', beforeData: undefined, afterData: initialData });
    await processDocumentAggregationEvent(db, initEvent);
    expect(await customerGroupCount('伊藤浩二')).to.equal(1);
    expect(await careManagerGroupCount('佐藤花子')).to.equal(1);

    // careManagerを異常に長い名前(2000文字)に変更する。documentGroups/careManager_{2000文字}
    // のdocument IDがFirestoreの1500バイト制限を超え、トランザクションのwrite phaseで
    // 実際にINVALID_ARGUMENTエラーが発生する(モックではないgenuineなFirestoreエラー。
    // firebase emulators:execで事前に`SET FAILED: 3 3 INVALID_ARGUMENT: The key path
    // element name is longer than 1500 bytes.`を実測確認済み)。
    const oversizedCareManager = 'x'.repeat(2000);
    const faultAfterData = { ...initialData, careManager: oversizedCareManager, careManagerKey: oversizedCareManager };
    const faultEvent = baseInput({
      eventId: 'event-fault-trigger', docId: 'doc-fault-injection', beforeData: initialData, afterData: faultAfterData,
    });

    let thrown: unknown;
    try {
      await processDocumentAggregationEvent(db, faultEvent);
    } catch (error) {
      thrown = error;
    }
    expect(thrown, 'oversizedなgroupKeyへの書込みはトランザクション全体を失敗させるはず').to.not.equal(undefined);

    // ロールバック確認: 同一トランザクション内の他グループ(customer)の更新も反映されていない
    expect(await customerGroupCount('伊藤浩二'), 'アトミック性: 同一イベント内の他グループ更新もロールバックされるべき').to.equal(1);
    // ロールバック確認: 削除対象だった旧careManagerグループの-1もロールバックされ、countが残る
    expect(await careManagerGroupCount('佐藤花子'), 'アトミック性: 削除対象グループの-1もロールバックされるべき').to.equal(1);
    // ロールバック確認: 台帳が作成されていない(再配信時に正しく再試行できる)
    const ledgerSnap = await db.collection('documentAggregationEvents').doc('event-fault-trigger').get();
    expect(ledgerSnap.exists, 'トランザクション失敗時は台帳も作成されないべき(再試行可能性を保つ)').to.equal(false);
  });
});
