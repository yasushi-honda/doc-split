/**
 * documents集計トリガー(onDocumentWrite)のイベント冪等性 integration テスト
 * (Issue #660修正 ADR-0020 → Issue #664修正 ADR-0021、Firestore emulator)
 *
 * ADR-0021: 計算モデルを「event.before/afterの履歴差分適用」から「documentsの
 * ライブ状態への収束」に変更した。`processDocumentAggregationEvent()`はもはや
 * beforeData/afterDataを受け取らず、トランザクション内で`documents/{docId}`を
 * ライブ再読込みし、`documentAggregationStates/{docId}`に保持した「前回適用済み
 * contribution」との差分を適用する。これにより異なるevent.id間の配信順序不同
 * (Issue #664: 作成直後削除でdelete配信が先着するとphantom countが残留する)に
 * 対しても正しく収束する。
 *
 * 同一event.idの重複配信に対する冪等性(`documentAggregationEvents`台帳、
 * Issue #660/ADR-0020)は変更していない。
 *
 * CloudEvent(`event`オブジェクト)構築の複雑さを避けるため、`onDocumentWritten`の
 * プラミング部分から独立させた`processDocumentAggregationEvent()`を直接呼び出す。
 * 各テストは、実世界での`documents/{docId}`への実書込み(set/delete)を先に行った
 * うえで、そのイベントを表す`processDocumentAggregationEvent()`呼び出しを行う
 * (ライブ再読込みモデルのため、documentの実体が先に存在している必要がある。
 * ただしAC2は「delete配信が先着」を再現するため、両方の実書込みを済ませてから
 * delete相当のイベント処理を先に呼ぶ)。
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
const COLLECTIONS_TO_CLEAN: readonly string[] = [
  'documents',
  'documentGroups',
  'documentAggregationEvents',
  'documentAggregationStates',
];

function baseInput(overrides: Partial<Parameters<typeof processDocumentAggregationEvent>[1]> = {}) {
  return {
    docId: 'doc-1',
    eventId: 'event-A',
    eventSource: '//firestore.googleapis.com/projects/test/databases/(default)',
    eventSubject: 'documents/doc-1',
    eventTime: '2026-07-15T00:00:00.000Z',
    nowMillis: Date.parse('2026-07-15T00:00:00.000Z'),
    ...overrides,
  };
}

/** 正規化済みキー(customerKey等)を含む完全なdocumentDataを生成する。 */
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

describe('onDocumentWrite イベント冪等性・順序不同耐性 (Issue #660/#664修正、ADR-0020/0021)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('AC1(反例ケース、Codexセカンドオピニオン指摘の核心): 別文書Yがグループに存在する状態で、文書Xのupdateイベントをcreateイベントより先に処理しても、Yの分は減算されない', async () => {
    // 文書Y: 最初からグループ「a」に属する既存文書
    // (careManagerKeyはnormalizeGroupKey済みの値で揃える。大文字を混ぜると
    // normalizeGroupKeyが小文字化するため、生成されるgroupKeyと食い違う)
    await db.collection('documents').doc('doc-y').set(
      fullDocData({ careManager: 'a', careManagerKey: 'a' })
    );
    await processDocumentAggregationEvent(db, baseInput({ docId: 'doc-y', eventId: 'event-y-create' }));
    expect(await careManagerGroupCount('a')).to.equal(1);

    // 文書X: 実世界ではcreate(careManager=a)→update(careManager=b)の両方が
    // 既にコミット済み(ライブ状態は最終的にb)という想定
    await db.collection('documents').doc('doc-x').set(
      fullDocData({ careManager: 'b', careManagerKey: 'b' })
    );

    // Xのupdateイベントが、Xのcreateイベントより先に配信・処理される(順序不同)。
    // 旧モデル(event.before/afterの履歴差分)ならbefore=aとして-1をaに適用し、
    // 無関係なYの分まで誤って減算してしまっていた。
    await processDocumentAggregationEvent(db, baseInput({ docId: 'doc-x', eventId: 'event-x-update' }));
    expect(await careManagerGroupCount('a'), 'Xの分がaから誤って減算され、Yの分まで消えてはいけない').to.equal(1);
    expect(await careManagerGroupCount('b')).to.equal(1);

    // 遅れてXのcreateイベントが処理される(古いイベントの後着)。
    // ライブ再読込みは常に現在の真の状態(b)を見るため、古いcreateイベントの
    // 処理はno-opになる。
    await processDocumentAggregationEvent(db, baseInput({ docId: 'doc-x', eventId: 'event-x-create' }));
    expect(await careManagerGroupCount('a'), '遅延到着したcreateイベントでaが変化してはいけない').to.equal(1);
    expect(await careManagerGroupCount('b'), '遅延到着したcreateイベントでbが二重加算されてはいけない').to.equal(1);
  });

  it('AC2(Issue #664の核心ケース): 作成直後削除でdelete配信が先着・create配信が後着でも、phantom countが残らない', async () => {
    const docId = 'doc-create-then-delete';

    // 実世界ではcreate→deleteの両方が既にコミット済み(最終的にdocumentは存在しない)
    await db.collection('documents').doc(docId).set(
      fullDocData({ careManager: 'c', careManagerKey: 'c' })
    );
    await db.collection('documents').doc(docId).delete();

    // delete配信が先着。旧モデルでは対応groupがまだ作成されていないため-1はno-opで、
    // かつ台帳にはevent-deleteが「処理済み」として記録されていた。
    await processDocumentAggregationEvent(db, baseInput({ docId, eventId: 'event-delete' }));
    expect(await careManagerGroupCount('c')).to.equal(0);

    // create配信が後着。旧モデルではevent.data.afterの凍結スナップショット(careManager=c)
    // を信じて+1を適用し、削除済みdocumentへのphantom countが永久に残留していた。
    // 新モデルはライブ再読込みでdocumentが存在しないことを確認し、targetは空配列のまま。
    await processDocumentAggregationEvent(db, baseInput({ docId, eventId: 'event-create' }));
    expect(await careManagerGroupCount('c'), '旧モデルではここでphantom countの+1が発生していた').to.equal(0);
  });

  it('AC3: 文書削除後の同一docId再利用で、遅延到着した古いイベントが新しい内容を破壊しない', async () => {
    const docId = 'doc-reused';

    // 旧incarnation: careManager=c1
    // (customerKey/careManagerKeyはnormalizeGroupKey済みの値で揃える。大文字を
    // 混ぜるとnormalizeGroupKeyが小文字化するため、生成されるgroupKeyと食い違う)
    await db.collection('documents').doc(docId).set(
      fullDocData({ customerName: 'x', customerKey: 'x', careManager: 'c1', careManagerKey: 'c1' })
    );
    await processDocumentAggregationEvent(db, baseInput({ docId, eventId: 'event-old-create' }));
    expect(await careManagerGroupCount('c1')).to.equal(1);

    await db.collection('documents').doc(docId).delete();
    await processDocumentAggregationEvent(db, baseInput({ docId, eventId: 'event-old-delete' }));
    expect(await careManagerGroupCount('c1')).to.equal(0);

    // 同一docIdで新incarnation作成: careManager=c2
    await db.collection('documents').doc(docId).set(
      fullDocData({ customerName: 'y', customerKey: 'y', careManager: 'c2', careManagerKey: 'c2' })
    );
    await processDocumentAggregationEvent(db, baseInput({ docId, eventId: 'event-new-create' }));
    expect(await careManagerGroupCount('c2')).to.equal(1);

    // 旧incarnation時代の何らかのイベント(旧create/delete以外の未処理event.id)が
    // 遅延到着する。ライブ再読込みは常に「今」の状態(新incarnation=c2)を見るため、
    // 新incarnationを破壊しない。
    await processDocumentAggregationEvent(db, baseInput({ docId, eventId: 'event-old-stale-retry' }));
    expect(await careManagerGroupCount('c2'), '新incarnationが古いイベントで破壊されてはいけない').to.equal(1);
    expect(await careManagerGroupCount('c1'), '旧incarnationのグループが復活してはいけない').to.equal(0);
  });

  it('AC4-1: 同一event.idの二重(逐次)実行 → documentGroupsのcount変化は1回分のみ', async () => {
    await db.collection('documents').doc('doc-1').set(fullDocData());
    const input = baseInput();

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

  it('AC4-2: delete→delete再配信でも二重減算が起きない', async () => {
    const docId = 'doc-delete-redelivery';
    await db.collection('documents').doc(docId).set(fullDocData({ customerName: '田中花子', customerKey: '田中花子' }));
    await processDocumentAggregationEvent(db, baseInput({ docId, eventId: 'event-create' }));
    expect(await careManagerGroupCount('佐藤花子')).to.equal(1);

    await db.collection('documents').doc(docId).delete();
    const deleteInput = baseInput({ docId, eventId: 'event-delete' });
    const firstDelete = await processDocumentAggregationEvent(db, deleteInput);
    expect(firstDelete.skipped).to.equal(false);
    expect(await careManagerGroupCount('佐藤花子')).to.equal(0);

    // 削除イベントの再配信(documentは既に存在しないが、ライブ再読込みは
    // undefinedを正しく扱う)
    const secondDelete = await processDocumentAggregationEvent(db, deleteInput);
    expect(secondDelete.skipped, '削除イベントの再配信もskipされるべき').to.equal(true);
    expect(await careManagerGroupCount('佐藤花子'), '再配信でcountが負数になってはいけない').to.equal(0);
  });

  it('AC4-3: 同一event.idの並行実行でも、集計は1回分のみ反映される(トランザクション競合の正しい処理)', async () => {
    await db.collection('documents').doc('doc-concurrent').set(
      fullDocData({ customerName: '渡辺次郎', customerKey: '渡辺次郎', careManager: '高橋実', careManagerKey: '高橋実' })
    );
    const input = baseInput({ docId: 'doc-concurrent', eventId: 'event-concurrent' });

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

  it('AC4-4(アトミック性の実証、ADR-0020の核心的claim): 一部グループの更新が失敗した場合、他グループの更新も台帳・state作成もロールバックされる', async () => {
    const docId = 'doc-fault-injection';
    await db.collection('documents').doc(docId).set(
      fullDocData({ customerName: '伊藤浩二', customerKey: '伊藤浩二', careManager: '佐藤花子', careManagerKey: '佐藤花子' })
    );
    await processDocumentAggregationEvent(db, baseInput({ docId, eventId: 'event-fault-init' }));
    expect(await customerGroupCount('伊藤浩二')).to.equal(1);
    expect(await careManagerGroupCount('佐藤花子')).to.equal(1);

    // event-fault-init成功時点でのstate(次のfault-trigger処理のpreviousになる)を記録
    const stateBeforeFault = await db.collection('documentAggregationStates').doc(docId).get();
    expect(stateBeforeFault.exists, 'event-fault-init成功時点でstateは作成済みのはず').to.equal(true);

    // careManagerを異常に長い名前(2000文字)に変更する。documentGroups/careManager_{2000文字}
    // のdocument IDがFirestoreの1500バイト制限を超え、トランザクションのwrite phaseで
    // 実際にINVALID_ARGUMENTエラーが発生する(モックではないgenuineなFirestoreエラー)。
    const oversizedCareManager = 'x'.repeat(2000);
    await db.collection('documents').doc(docId).update({
      careManager: oversizedCareManager, careManagerKey: oversizedCareManager,
    });

    let thrown: unknown;
    try {
      await processDocumentAggregationEvent(db, baseInput({ docId, eventId: 'event-fault-trigger' }));
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
    // ロールバック確認: stateがevent-fault-init時点のまま更新されていない(次回リトライ時に
    // 正しいpreviousから再計算できる。documentのcareManagerKeyは既にoversized値に書き変わって
    // いるが、これはトランザクション外のセットアップ用updateであり本テストの検証対象外)
    const stateAfterFault = await db.collection('documentAggregationStates').doc(docId).get();
    expect(stateAfterFault.exists).to.equal(true);
    expect(
      stateAfterFault.data()?.updatedAt.isEqual(stateBeforeFault.data()?.updatedAt),
      'stateはfault-trigger処理前のまま変化していないべき(ロールバック)'
    ).to.equal(true);
  });

  it('AC4-5(ADR-0021の中核安全性claim、Evaluator指摘): 既に集計済みの同一docIdに対する変更を異なるevent.id2件で真に並行処理しても、二重反映も欠落もなく正しい状態に収束する', async () => {
    // AC4-3は「同一event.id」の並行実行(台帳create()衝突による冪等性)のみを検証しており、
    // ADR-0021が新たに導入した安全性claim「異なるevent.id同士が同一docIdのstateRef/
    // documentGroupsを巡って競合してもFirestoreのトランザクション機構でシリアライズされ、
    // 正しく収束する」は未検証だった(Evaluator指摘)。本テストは、同一docIdに対して
    // 異なるeventIdを持つ2つの呼び出しを実際に並行実行し、これを直接検証する。
    //
    // 検証範囲についての注記: レース対象のdocIdは「既に一度集計済み」の状態から開始する
    // (baselineイベントを先に適用する)。調査の結果、ローカルFirestoreエミュレータは
    // 「未存在ドキュメントへのtransaction.set()」が絡む競合(=あるdocIdの生まれて初めての
    // イベント同士が競合するケース)を確実には検知しないことを実機検証で確認した
    // (firebase-tools issue #8120で公式に認知されている、エミュレータ固有の楽観的並行性
    // 制御の既知の不完全さ。本番の標準Edition Firestore/Admin SDKはデフォルトで悲観的
    // ロックを使用するため、この制約は本番には適用されない: 公式ドキュメント
    // https://firebase.google.com/docs/firestore/transaction-data-contention 参照)。
    // 一方、既存ドキュメントへのtransaction.update()/delete()が絡む競合は、エミュレータ上
    // でも確実に検知・シリアライズされることを実機で確認済み(実行時間3秒超のリトライが
    // 観測される)。そのため本テストは、この確実に検証可能な経路(既存state/groupに対する
    // 変更の競合)でADR-0021の収束性を検証する。
    await db.collection('documents').doc('doc-race').set(
      fullDocData({ customerName: '中村太一', customerKey: '中村太一', careManager: '田村恵', careManagerKey: '田村恵' })
    );
    await processDocumentAggregationEvent(db, baseInput({ docId: 'doc-race', eventId: 'event-race-baseline' }));
    expect(await careManagerGroupCount('田村恵')).to.equal(1);

    // careManagerを変更した後、この1件の変更を表す2つの異なるeventIdを並行到着させる
    // (Eventarcの重複配信+リトライで、同じ実質的な変更が異なるevent.idとして複数回
    // 到着しうるケースを再現)
    await db.collection('documents').doc('doc-race').update({ careManager: '高橋実', careManagerKey: '高橋実' });

    const [r1, r2] = await Promise.all([
      processDocumentAggregationEvent(db, baseInput({ docId: 'doc-race', eventId: 'event-race-1' })),
      processDocumentAggregationEvent(db, baseInput({ docId: 'doc-race', eventId: 'event-race-2' })),
    ]);

    // 旧グループから正しく-1され、新グループへ正しく+1されている(二重反映も欠落もない)
    expect(await careManagerGroupCount('田村恵'), '旧グループは0に収束するはず').to.equal(0);
    expect(await careManagerGroupCount('高橋実'), '新グループは二重にも欠落にもならず1のはず').to.equal(1);
    expect(r1.skipped, '異なるeventIdは台帳ヒットによるskip対象ではない').to.equal(false);
    expect(r2.skipped, '異なるeventIdは台帳ヒットによるskip対象ではない').to.equal(false);
  });

  it('AC4-6(Evaluator指摘の未網羅ケース): キー正規化のみ必要で集計自体には変化がない場合、documentGroupsへの書込みは発生せずキーのみ補正される', async () => {
    const docId = 'doc-key-only-drift';
    await db.collection('documents').doc(docId).set(
      fullDocData({ customerName: '小林誠', customerKey: '小林誠' })
    );
    await processDocumentAggregationEvent(db, baseInput({ docId, eventId: 'event-key-only-init' }));
    expect(await customerGroupCount('小林誠')).to.equal(1);

    // customerNameは変えずcustomerKeyフィールドだけを手動修復等で不整合な値にする
    // (buildContribution()はcustomerNameから直接キーを再導出するため、この操作は
    // targetContributionには一切影響しない = deltas.length===0になるはずの状況を作る)
    await db.collection('documents').doc(docId).update({ customerKey: 'stale-manually-corrupted-key' });

    const result = await processDocumentAggregationEvent(
      db,
      baseInput({ docId, eventId: 'event-key-only-fix' })
    );

    // documentGroupsへの書込みは発生していない(集計カウントは変化しない)
    expect(result.groupsUpdated, 'キー正規化のみでcontribution自体は変化しないためgroup更新は0のはず').to.equal(0);
    expect(await customerGroupCount('小林誠')).to.equal(1);

    // documentのcustomerKeyフィールドは、ライブ再読込み基準で正しい値に補正されている
    const docSnap = await db.collection('documents').doc(docId).get();
    expect(docSnap.data()?.customerKey, 'ズレたcustomerKeyはライブ再読込み基準で補正されるべき').to.not.equal(
      'stale-manually-corrupted-key'
    );

    // 純粋なno-opではない(keyUpdateがあった)ため、台帳は作成される
    const ledgerSnap = await db.collection('documentAggregationEvents').doc('event-key-only-fix').get();
    expect(ledgerSnap.exists, 'keyUpdateのみでも真のno-opではないため台帳は作成されるはず').to.equal(true);
  });

  it('AC5: needsKeyUpdateはライブ再読込みしたデータを基準にトランザクション内で統合される(旧: イベントの古いafterData基準・トランザクション外の事前update)', async () => {
    const docId = 'doc-key-normalize';
    const fixedProcessedAt = Timestamp.now();
    // customerKey/careManagerKey等の正規化キーが未設定のまま実際にFirestoreへ
    // 書き込まれたケース(例: FE直接編集や旧データ)を再現する。
    await db.collection('documents').doc(docId).set({
      customerName: '木村保', careManager: '森奈穂美', status: 'processed',
      fileName: 'e.pdf', processedAt: fixedProcessedAt,
    });

    const result = await processDocumentAggregationEvent(db, baseInput({ docId, eventId: 'event-key-normalize' }));
    expect(result.skipped).to.equal(false);
    expect(await careManagerGroupCount('森奈穂美'), 'キー未設定でもライブデータから正しく集計されるべき').to.equal(1);

    // トランザクション内でキー正規化の自己書込みが行われ、documents側に反映されていることを確認
    const docSnap = await db.collection('documents').doc(docId).get();
    expect(docSnap.data()?.careManagerKey).to.equal('森奈穂美');
    expect(docSnap.data()?.customerKey).to.equal('木村保');

    // computeKeyUpdate()はcustomerKey/officeKey/documentTypeKey/careManagerKeyのみを
    // 対象にしたPartial Updateであるため、更新対象外フィールドが変化しないことを検証する
    // (~/.claude/CLAUDE.md「DBにPartial Updateする関数の追加/変更→テストに『更新対象外
    // フィールドの値が変化しないこと』を含める」ルール対応)。
    expect(docSnap.data()?.customerName, '更新対象外: customerNameは変化しないべき').to.equal('木村保');
    expect(docSnap.data()?.careManager, '更新対象外: careManagerは変化しないべき').to.equal('森奈穂美');
    expect(docSnap.data()?.status, '更新対象外: statusは変化しないべき').to.equal('processed');
    expect(docSnap.data()?.fileName, '更新対象外: fileNameは変化しないべき').to.equal('e.pdf');
    expect(docSnap.data()?.processedAt.isEqual(fixedProcessedAt), '更新対象外: processedAtは変化しないべき').to.equal(true);
  });

  it('AC5-2: docId再利用時に古いイベントが遅延到着しても、キー正規化が新incarnationのデータを古い値で上書きしない', async () => {
    const docId = 'doc-key-normalize-reused';

    // 旧incarnation(正規化キー未設定のまま)を作成・処理
    await db.collection('documents').doc(docId).set({
      customerName: '旧顧客', careManager: '旧CM', status: 'processed',
      fileName: 'old.pdf', processedAt: Timestamp.now(),
    });
    await processDocumentAggregationEvent(db, baseInput({ docId, eventId: 'event-old' }));
    await db.collection('documents').doc(docId).delete();
    await processDocumentAggregationEvent(db, baseInput({ docId, eventId: 'event-old-delete' }));

    // 新incarnation(こちらも正規化キー未設定のまま作成、needsKeyUpdateがtrueになる)
    await db.collection('documents').doc(docId).set({
      customerName: '新顧客', careManager: '新CM', status: 'processed',
      fileName: 'new.pdf', processedAt: Timestamp.now(),
    });
    await processDocumentAggregationEvent(db, baseInput({ docId, eventId: 'event-new' }));

    // 旧incarnation時代の古いイベントが遅延到着しても、キー正規化はライブ読込み
    // (=新incarnationのデータ)を基準にするため、新incarnationのキーを破壊しない
    await processDocumentAggregationEvent(db, baseInput({ docId, eventId: 'event-old-stale' }));

    const docSnap = await db.collection('documents').doc(docId).get();
    expect(docSnap.data()?.customerName).to.equal('新顧客');
    expect(docSnap.data()?.customerKey, '新incarnationのキーが古いイベントで上書きされてはいけない').to.equal('新顧客');
    expect(docSnap.data()?.careManagerKey).to.equal('新cm');

    // 更新対象外フィールドが古いイベントの処理で変化しないことを検証する
    // (~/.claude/CLAUDE.md Partial Updateルール対応)
    expect(docSnap.data()?.careManager, '更新対象外: careManagerは変化しないべき').to.equal('新CM');
    expect(docSnap.data()?.status, '更新対象外: statusは変化しないべき').to.equal('processed');
    expect(docSnap.data()?.fileName, '更新対象外: fileNameは変化しないべき').to.equal('new.pdf');
  });
});
