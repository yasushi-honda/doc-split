/**
 * duplicateDocumentForCustomers 統合テスト(ADR-0032: 複数名FAXの手動複製ボタン)
 *
 * emulator(Firestore)上で、onCall本体(認可・メンテナンスゲート)と、トランザクション本体
 * (`executeManualDuplication`)を実際に動かして検証する。
 * Storageは偽物(`ManualDuplicationDeps`)に差し替える(CIのemulatorはFirestoreのみ。
 * OCR全文のコピー/補償削除の呼出し配線だけを見る)。氏名・事業所名は架空の値。
 *
 * 検証する契約(完了の定義):
 *   - 冪等: 同じ入力で2回続けて呼んでも、2回目は全件skippedで doc が増えない
 *   - 同時実行: 同時2回、および同じグループの別々の兄弟から同じ利用者を同時追加しても重複しない
 *   - 人数上限: グループ合計5名ちょうどはOK、6名目は拒否。回数を分けても超えない
 *   - 元の書類は distributionId の付与以外変わらない
 *   - 実行条件: processed / 非分割元 / 利用者が確定済み / 利用者がマスターに実在
 *   - OCR全文は複製専用パスへコピーし、Firestoreの書き込み失敗時は補償削除する(コミット結果不明時は消さない)
 *
 * 実行: cd functions && firebase emulators:exec --only firestore \
 *   'npx mocha --require ts-node/register --timeout 15000 test/duplicateDocumentForCustomersIntegration.test.ts'
 */

// default app + emulator host を最初に初期化する(helperの説明参照)
import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import functionsTest from 'firebase-functions-test';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  duplicateDocumentForCustomers,
  executeManualDuplication,
  type ManualDuplicationDeps,
} from '../src/documents/duplicateDocumentForCustomers';
import { cleanupCollections } from './helpers/cleanupEmulator';

const test = functionsTest();
const wrapped = test.wrap(duplicateDocumentForCustomers);
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

const OPERATOR_UID = 'uid-operator';
const COLLECTIONS_TO_CLEAN: readonly string[] = [
  'documents',
  'users',
  'masters/customers/items',
  'system',
];

// ---------------------------------------------------------------- seed helpers

async function seedUser(uid: string = OPERATOR_UID): Promise<void> {
  await db.doc(`users/${uid}`).set({ email: `${uid}@example.com`, role: 'user' });
}

async function seedCustomer(id: string, name: string, careManagerName?: string): Promise<void> {
  await db.doc(`masters/customers/items/${id}`).set({
    name,
    furigana: 'てすと',
    ...(careManagerName !== undefined ? { careManagerName } : {}),
  });
}

/** 通常の利用者マスター(元の利用者 + 複製先の候補6名) */
async function seedStandardCustomers(): Promise<void> {
  await seedCustomer('c-src', 'テスト太郎', '担当甲');
  await seedCustomer('c-a', 'テスト花子', '担当乙');
  await seedCustomer('c-b', 'テスト次郎', '担当丙');
  await seedCustomer('c-c', 'テスト三郎', '担当丁');
  await seedCustomer('c-d', 'テスト四郎', '担当戊');
  await seedCustomer('c-e', 'テスト五郎', '担当己');
}

function sourceDocData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'src1',
    status: 'processed',
    fileId: 'file-1',
    fileName: 'fax-20261105.pdf',
    mimeType: 'application/pdf',
    fileUrl: 'gs://test-bucket/original/fax-20261105.pdf',
    targetPageNumber: 1,
    totalPages: 2,
    ocrExcerpt: 'OCR抜粋',
    documentType: '提供票',
    officeName: 'テスト事業所',
    officeId: 'office-1',
    fileDate: Timestamp.fromDate(new Date(Date.UTC(2026, 10, 5, 3, 0, 0))),
    fileDateFormatted: '2026/11/05',
    customerId: 'c-src',
    customerName: 'テスト太郎',
    careManager: '担当甲',
    customerConfirmed: true,
    isDuplicateCustomer: false,
    needsManualCustomerSelection: false,
    verified: false,
    processedAt: Timestamp.fromDate(new Date(Date.UTC(2026, 10, 5, 4, 0, 0))),
    updatedAt: Timestamp.fromDate(new Date(Date.UTC(2026, 10, 5, 4, 0, 0))),
    ...overrides,
  };
}

async function seedSource(
  overrides: Record<string, unknown> = {},
  docId = 'src1',
  detail: Record<string, unknown> | null = {
    ocrResult: '提供票 テスト太郎 / テスト花子',
    pageResults: [{ pageNumber: 1, text: 'p1' }],
  }
): Promise<void> {
  await db.doc(`documents/${docId}`).set(sourceDocData({ id: docId, ...overrides }));
  if (detail) {
    await db.doc(`documents/${docId}/detail/main`).set(detail);
  }
}

// ---------------------------------------------------------------- 偽のStorage

interface FakeDeps {
  deps: ManualDuplicationDeps;
  copies: Array<{ sourceUrl: string; destinationKey: string; ocrRunId: string }>;
  deleted: string[];
}

function fakeDeps(): FakeDeps {
  const copies: FakeDeps['copies'] = [];
  const deleted: string[] = [];
  return {
    copies,
    deleted,
    deps: {
      copyOcrResult: async (sourceUrl, destinationKey, ocrRunId) => {
        copies.push({ sourceUrl, destinationKey, ocrRunId });
        return `gs://test-bucket/ocr-results/${destinationKey}/${ocrRunId}.txt`;
      },
      deleteOcrResult: async (url) => {
        deleted.push(url);
      },
    },
  };
}

// ---------------------------------------------------------------- 呼び出し helpers

async function run(
  customerIds: unknown,
  opts: { documentId?: string; uid?: string; deps?: ManualDuplicationDeps; database?: admin.firestore.Firestore } = {}
) {
  return executeManualDuplication({
    db: opts.database ?? db,
    uid: opts.uid ?? OPERATOR_UID,
    documentId: opts.documentId ?? 'src1',
    customerIds,
    deps: opts.deps ?? fakeDeps().deps,
  });
}

async function callWrapped(data: unknown, uid: string | null = OPERATOR_UID) {
  const auth = uid === null ? undefined : { uid, token: {} as Record<string, unknown> };
  const request = { auth, data, rawRequest: {} } as unknown as Parameters<typeof wrapped>[0];
  return wrapped(request);
}

async function expectHttpsError(action: () => Promise<unknown>, expectedCode: string): Promise<HttpsError> {
  let caught: unknown;
  try {
    await action();
  } catch (err) {
    caught = err;
  }
  expect(caught, `expected HttpsError(${expectedCode})`).to.be.instanceOf(HttpsError);
  expect((caught as HttpsError).code).to.equal(expectedCode);
  return caught as HttpsError;
}

/** distributionId が groupId の書類(元の書類・複製・兄弟)を ID 昇順で返す */
async function groupDocs(
  groupId: string
): Promise<Array<{ id: string; customerId?: string | null }>> {
  const snap = await db.collection('documents').where('distributionId', '==', groupId).get();
  return snap.docs
    .map((d) => ({ id: d.id, customerId: d.get('customerId') as string | null | undefined }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function countDocuments(): Promise<number> {
  return (await db.collection('documents').get()).size;
}

/**
 * runTransaction の中で、n 回目(1始まり)の tx.set を失敗させる db(OCR全文コピー後の書き込み失敗の再現)。
 * 複製1件につき set は「本体」「detail/main」の2回なので、3 を指定すると2件目の本体の書き込みで失敗し、
 * 1件目・2件目の両方のOCR全文がコピー済みの状態を作れる。
 */
function dbFailingTxSet(real: admin.firestore.Firestore, failOnNthSet: number): admin.firestore.Firestore {
  let setCalls = 0;
  return new Proxy(real, {
    get(target, prop) {
      if (prop === 'runTransaction') {
        return (cb: (tx: admin.firestore.Transaction) => Promise<unknown>, opts?: unknown) =>
          target.runTransaction(
            async (tx) =>
              cb(
                new Proxy(tx, {
                  get(t, p) {
                    if (p === 'set') {
                      return (...args: unknown[]) => {
                        setCalls += 1;
                        if (setCalls === failOnNthSet) {
                          throw new Error('injected write failure');
                        }
                        return (t.set as (...a: unknown[]) => unknown).apply(t, args);
                      };
                    }
                    const v = (t as unknown as Record<string | symbol, unknown>)[p];
                    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
                  },
                })
              ),
            opts as never
          );
      }
      const v = (target as unknown as Record<string | symbol, unknown>)[prop];
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

/** コミットは成功するが、呼出し元には例外が返る db(コミット結果不明=ambiguous commit の再現) */
function dbThrowingAfterCommit(real: admin.firestore.Firestore): admin.firestore.Firestore {
  return new Proxy(real, {
    get(target, prop) {
      if (prop === 'runTransaction') {
        return async (cb: (tx: admin.firestore.Transaction) => Promise<unknown>, opts?: unknown) => {
          await target.runTransaction(cb, opts as never);
          throw new Error('injected ambiguous commit failure');
        };
      }
      const v = (target as unknown as Record<string | symbol, unknown>)[prop];
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

/**
 * トランザクションの callback は最後まで返るが、commit は反映されない db。
 * commit RPC がタイムアウト等で失敗し、サーバー側では後から反映される「結果不明」の状況を、
 * 「その時点では複製docが読めない」形で再現する(commit後に1回読む判定では未commitと区別できない)。
 */
function dbFailingAfterCallbackBeforeCommit(real: admin.firestore.Firestore): admin.firestore.Firestore {
  return new Proxy(real, {
    get(target, prop) {
      if (prop === 'runTransaction') {
        return (cb: (tx: admin.firestore.Transaction) => Promise<unknown>, opts?: unknown) =>
          target.runTransaction(async (tx) => {
            await cb(tx);
            throw new Error('injected failure after callback, before commit');
          }, opts as never);
      }
      const v = (target as unknown as Record<string | symbol, unknown>)[prop];
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

// ================================================================= tests

describe('duplicateDocumentForCustomers 統合テスト (ADR-0032)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
    // detail サブコレクションは親の削除で消えないため個別に掃除する
    const docs = await db.collection('documents').listDocuments();
    await Promise.all(docs.map((d) => d.collection('detail').doc('main').delete()));
    await cleanupCollections(db, ['documents']);
    await seedUser();
    await seedStandardCustomers();
  });

  // ------------------------------------------------------------ 認可・ゲート
  describe('認可・メンテナンスゲート(onCall)', () => {
    it('未認証 → unauthenticated', async () => {
      await seedSource();
      await expectHttpsError(() => callWrapped({ documentId: 'src1', customerIds: ['c-a'] }, null), 'unauthenticated');
    });

    it('users/{uid} 未登録 → permission-denied', async () => {
      await seedSource();
      await expectHttpsError(
        () => callWrapped({ documentId: 'src1', customerIds: ['c-a'] }, 'not-in-whitelist'),
        'permission-denied'
      );
    });

    it('メンテナンスゲートが閉じている → unavailable(何も作られない)', async () => {
      await seedSource();
      await db.doc('system/maintenanceFlags').set({ groupAggregationGateOpen: false });
      await expectHttpsError(() => callWrapped({ documentId: 'src1', customerIds: ['c-a'] }), 'unavailable');
      expect(await countDocuments()).to.equal(1);
    });

    it('documentId が無い → invalid-argument', async () => {
      await expectHttpsError(() => callWrapped({ customerIds: ['c-a'] }), 'invalid-argument');
    });

    for (const [label, documentId] of [
      ['空文字', ''],
      ['パス区切りを含む(別のドキュメントを指せてしまう)', 'src1/detail/main'],
      ['文字列でない', 123],
    ] as const) {
      it(`documentId が${label} → invalid-argument(何も読まない)`, async () => {
        await seedSource();
        await expectHttpsError(() => callWrapped({ documentId, customerIds: ['c-a'] }), 'invalid-argument');
        expect(await countDocuments()).to.equal(1);
      });
    }

    it('ログイン済みの職員(role=user)は複製できる', async () => {
      await seedSource();
      const result = (await callWrapped({ documentId: 'src1', customerIds: ['c-a'] })) as {
        created: Array<{ customerId: string }>;
      };
      expect(result.created.map((c) => c.customerId)).to.deep.equal(['c-a']);
    });
  });

  // ------------------------------------------------------------ 実行できる条件
  describe('実行できる条件(異常系: 何も作られない)', () => {
    it('空配列 → invalid-argument', async () => {
      await seedSource();
      await expectHttpsError(() => run([]), 'invalid-argument');
      expect(await countDocuments()).to.equal(1);
    });

    it('元の書類が存在しない → not-found', async () => {
      await expectHttpsError(() => run(['c-a'], { documentId: 'no-such-doc' }), 'not-found');
    });

    for (const status of ['pending', 'processing', 'error', 'split']) {
      it(`status=${status} → failed-precondition`, async () => {
        await seedSource({ status });
        await expectHttpsError(() => run(['c-a']), 'failed-precondition');
        expect(await countDocuments()).to.equal(1);
      });
    }

    it('分割元(isSplitSource)→ failed-precondition', async () => {
      await seedSource({ isSplitSource: true });
      await expectHttpsError(() => run(['c-a']), 'failed-precondition');
      expect(await countDocuments()).to.equal(1);
    });

    it('元の書類の利用者が未判定 → failed-precondition(先に利用者を決めてもらう)', async () => {
      await seedSource({ customerName: '未判定', customerId: null, customerConfirmed: false });
      await expectHttpsError(() => run(['c-a']), 'failed-precondition');
      expect(await countDocuments()).to.equal(1);
    });

    it('元の書類の利用者名とマスター名が食い違う → failed-precondition', async () => {
      await seedSource({ customerName: '別の名前' });
      await expectHttpsError(() => run(['c-a']), 'failed-precondition');
    });

    // 再解析の保護(confirmedFieldMerge)は customerConfirmed === true の書類にしか効かない。
    // 同名衝突が無くても未確定の元の書類を複製すると、distributionId を付けた後の再解析で
    // 元の利用者が書き換わりうる(codex review P2)ため、人またはOCRの確定を必須にする。
    for (const [label, overrides] of [
      ['customerConfirmed が false', { customerConfirmed: false }],
      ['customerConfirmed が未設定', { customerConfirmed: undefined }],
    ] as const) {
      it(`同名衝突が無くても、${label}の元の書類は複製できない(failed-precondition・何も作られない)`, async () => {
        const data = sourceDocData(overrides);
        if (overrides.customerConfirmed === undefined) delete data.customerConfirmed;
        await db.doc('documents/src1').set(data);
        await db.doc('documents/src1/detail/main').set({ ocrResult: 'x', pageResults: [] });
        await expectHttpsError(() => run(['c-a']), 'failed-precondition');
        expect(await countDocuments()).to.equal(1);
        expect((await db.doc('documents/src1').get()).data()).to.not.have.property('distributionId');
      });
    }

    it('未確定の拒否は、詳細画面で利用者を確定するよう案内する', async () => {
      await seedSource({ customerConfirmed: false });
      const err = await expectHttpsError(() => run(['c-a']), 'failed-precondition');
      expect(err.message).to.contain('詳細画面で利用者を確定');
    });

    it('元の書類の利用者IDがマスターに無い場合は、マスターに見つからない旨を伝える', async () => {
      await seedSource({ customerId: 'c-deleted-master' });
      const err = await expectHttpsError(() => run(['c-a']), 'failed-precondition');
      expect(err.message).to.contain('マスターに見つかりません');
    });

    it('利用者名がマスターと食い違う場合は、食い違いを伝える(確定済みに見える書類でも原因が分かる)', async () => {
      await seedSource({ customerName: '別の名前', customerConfirmed: true });
      const err = await expectHttpsError(() => run(['c-a']), 'failed-precondition');
      expect(err.message).to.contain('食い違');
    });

    it('同姓同名のマスターがあり、人が確定していない → failed-precondition', async () => {
      await seedCustomer('c-src-twin', 'テスト太郎', '担当別');
      await seedSource({ customerConfirmed: false });
      await expectHttpsError(() => run(['c-a']), 'failed-precondition');
    });

    it('同姓同名のマスターがあっても、人が確定済みなら複製できる', async () => {
      await seedCustomer('c-src-twin', 'テスト太郎', '担当別');
      await seedSource({ customerConfirmed: true });
      const result = await run(['c-a']);
      expect(result.created).to.have.length(1);
    });

    it('緑の「確認済みにする」(verified)の前でも複製できる(verified は条件に含めない)', async () => {
      await seedSource({ verified: false });
      const result = await run(['c-a']);
      expect(result.created).to.have.length(1);
    });

    it('複製先の customerId がマスターに無い → not-found(他の分も作られない)', async () => {
      await seedSource();
      await expectHttpsError(() => run(['c-a', 'c-missing']), 'not-found');
      expect(await countDocuments()).to.equal(1);
    });

    it('元の書類と同じ利用者を指定 → invalid-argument', async () => {
      await seedSource();
      await expectHttpsError(() => run(['c-src']), 'invalid-argument');
      expect(await countDocuments()).to.equal(1);
    });
  });

  // ------------------------------------------------------------ 正常系
  describe('正常系', () => {
    it('2名分の複製: 決定的IDで作られ、利用者・担当CMはマスターから確定済み、確認は未', async () => {
      await seedSource();
      const result = await run(['c-a', 'c-b']);

      expect(result.created).to.deep.equal([
        { customerId: 'c-a', documentId: 'src1_dup_c-a' },
        { customerId: 'c-b', documentId: 'src1_dup_c-b' },
      ]);
      expect(result.skipped).to.deep.equal([]);

      const dupA = (await db.doc('documents/src1_dup_c-a').get()).data()!;
      expect(dupA).to.include({
        id: 'src1_dup_c-a',
        status: 'processed',
        customerId: 'c-a',
        customerName: 'テスト花子',
        careManager: '担当乙',
        customerConfirmed: true,
        isDuplicateCustomer: false,
        needsManualCustomerSelection: false,
        confirmedBy: OPERATOR_UID,
        verified: false,
        verifiedBy: null,
        verifiedAt: null,
        distributionId: 'src1',
        totalPages: 2,
        fileUrl: 'gs://test-bucket/original/fax-20261105.pdf',
        documentType: '提供票',
        officeName: 'テスト事業所',
      });
      expect(dupA.displayFileName).to.equal('提供票_テスト事業所_20261105_テスト花子.pdf');
      // 未設定だと一覧(processedAt 降順の取得)から消える
      expect(dupA.processedAt).to.be.instanceOf(Timestamp);
      expect(dupA.confirmedAt).to.be.instanceOf(Timestamp);
      expect(dupA.updatedAt).to.be.instanceOf(Timestamp);
      // 元の利用者の情報が紛れ込まない
      expect(JSON.stringify(dupA)).to.not.contain('テスト太郎');
    });

    it('複製した書類は processedAt 降順の一覧クエリで取得できる(欠落の回帰)', async () => {
      await seedSource();
      await run(['c-a', 'c-b']);
      const snap = await db.collection('documents').orderBy('processedAt', 'desc').get();
      expect(snap.docs.map((d) => d.id).sort()).to.deep.equal(['src1', 'src1_dup_c-a', 'src1_dup_c-b']);
    });

    it('detail/main(ocrResult・pageResults)を元の書類からそのまま写す', async () => {
      await seedSource();
      await run(['c-a']);
      const detail = (await db.doc('documents/src1_dup_c-a/detail/main').get()).data();
      expect(detail).to.deep.equal({
        ocrResult: '提供票 テスト太郎 / テスト花子',
        pageResults: [{ pageNumber: 1, text: 'p1' }],
      });
    });

    it('detail/main が無い旧形式の書類は、本体の ocrResult/pageResults を detail/main に写す', async () => {
      await seedSource({ ocrResult: '旧形式の全文', pageResults: [{ pageNumber: 1, text: 'legacy' }] }, 'src1', null);
      await run(['c-a']);
      const detail = (await db.doc('documents/src1_dup_c-a/detail/main').get()).data();
      expect(detail).to.deep.equal({ ocrResult: '旧形式の全文', pageResults: [{ pageNumber: 1, text: 'legacy' }] });
      // 本体には書かない(ADR-0018 Phase E)
      const dup = (await db.doc('documents/src1_dup_c-a').get()).data()!;
      expect(dup).to.not.have.property('ocrResult');
      expect(dup).to.not.have.property('pageResults');
    });

    it('元の書類: 利用者・確認・Drive出力の状態は変わらず、distributionId だけが追加される', async () => {
      await seedSource({
        verified: true,
        verifiedBy: 'staff-9',
        driveExportStatus: 'success',
        driveFileId: 'drive-1',
      });
      const before = (await db.doc('documents/src1').get()).data()!;
      await run(['c-a']);
      const after = (await db.doc('documents/src1').get()).data()!;

      expect(after.distributionId).to.equal('src1');
      const { distributionId: _added, ...afterRest } = after;
      void _added;
      expect(afterRest).to.deep.equal(before);
    });

    it('元の書類が既に distributionId を持つときはその値を使い、元の書類を更新しない', async () => {
      await seedSource({ distributionId: 'grp-old' });
      const before = (await db.doc('documents/src1').get()).data()!;
      await run(['c-a']);
      const after = (await db.doc('documents/src1').get()).data()!;
      expect(after).to.deep.equal(before);
      const dup = (await db.doc('documents/src1_dup_c-a').get()).data()!;
      expect(dup.distributionId).to.equal('grp-old');
    });

    it('以前の自動複製で作られたグループ(兄弟が同じ distributionId)に追加でき、既にいる利用者は作成済みになる', async () => {
      await seedSource({ distributionId: 'src1' });
      await db.doc('documents/auto-copy-a').set(
        sourceDocData({ id: 'auto-copy-a', customerId: 'c-a', customerName: 'テスト花子', distributionId: 'src1' })
      );
      const result = await run(['c-a', 'c-b']);
      expect(result.created.map((c) => c.customerId)).to.deep.equal(['c-b']);
      expect(result.skipped).to.deep.equal([{ customerId: 'c-a', reason: 'already-in-group' }]);
    });

    it('元の書類(distributionId の指す書類)が欠落している既存グループにも追加できる', async () => {
      await seedSource({ distributionId: 'gone-original' });
      await db.doc('documents/orphan-sib').set(
        sourceDocData({ id: 'orphan-sib', customerId: 'c-a', customerName: 'テスト花子', distributionId: 'gone-original' })
      );
      const result = await run(['c-b']);
      expect(result.created.map((c) => c.customerId)).to.deep.equal(['c-b']);
      expect((await db.doc('documents/src1_dup_c-b').get()).data()!.distributionId).to.equal('gone-original');
    });

    it('応答に distributionId は含めず、created/skipped のみ(FEとの契約)', async () => {
      await seedSource();
      const result = await run(['c-a']);
      expect(Object.keys(result).sort()).to.deep.equal(['created', 'skipped']);
    });
  });

  // ------------------------------------------------------------ OCR全文
  describe('OCR全文(ocrResultUrl)', () => {
    it('複製専用のパス(ocr-results/{複製docId}/)へコピーし、複製doc の ocrResultUrl をそのパスにする', async () => {
      await seedSource({ ocrResultUrl: 'gs://test-bucket/ocr-results/src1/run-a.txt' });
      const fake = fakeDeps();
      await run(['c-a', 'c-b'], { deps: fake.deps });

      expect(fake.copies).to.deep.equal([
        { sourceUrl: 'gs://test-bucket/ocr-results/src1/run-a.txt', destinationKey: 'src1_dup_c-a', ocrRunId: 'run-a' },
        { sourceUrl: 'gs://test-bucket/ocr-results/src1/run-a.txt', destinationKey: 'src1_dup_c-b', ocrRunId: 'run-a' },
      ]);
      const dupA = (await db.doc('documents/src1_dup_c-a').get()).data()!;
      expect(dupA.ocrResultUrl).to.equal('gs://test-bucket/ocr-results/src1_dup_c-a/run-a.txt');
      expect(fake.deleted).to.deep.equal([]);
    });

    it('OCR全文を持たない書類(ocrResultUrl 無し)ではコピーせず、キーも作らない', async () => {
      await seedSource();
      const fake = fakeDeps();
      await run(['c-a'], { deps: fake.deps });
      expect(fake.copies).to.deep.equal([]);
      expect((await db.doc('documents/src1_dup_c-a').get()).data()).to.not.have.property('ocrResultUrl');
    });

    it('作成済みで飛ばす利用者の分はコピーしない', async () => {
      await seedSource({ ocrResultUrl: 'gs://test-bucket/ocr-results/src1/run-a.txt' });
      await run(['c-a']);
      const fake = fakeDeps();
      await run(['c-a'], { deps: fake.deps });
      expect(fake.copies).to.deep.equal([]);
    });

    it('コピー後に Firestore の書き込みが失敗したら、コピーしたファイルを削除する(複製docは作られない)', async () => {
      await seedSource({ ocrResultUrl: 'gs://test-bucket/ocr-results/src1/run-a.txt' });
      const fake = fakeDeps();
      let caught: unknown;
      try {
        // 3回目の set(= 2件目の本体の書き込み)で失敗させる。この時点で2件ともOCR全文はコピー済み。
        await run(['c-a', 'c-b'], { deps: fake.deps, database: dbFailingTxSet(db, 3) });
      } catch (err) {
        caught = err;
      }
      expect(caught, '書き込み失敗は呼出し元へ伝わる').to.be.instanceOf(Error);
      expect((caught as Error).message).to.equal('injected write failure');
      expect(fake.copies, '2件ともコピーされている前提').to.have.length(2);
      expect(fake.deleted.sort()).to.deep.equal(
        [
          'gs://test-bucket/ocr-results/src1_dup_c-a/run-a.txt',
          'gs://test-bucket/ocr-results/src1_dup_c-b/run-a.txt',
        ].sort()
      );
      expect(await countDocuments(), '複製docは1件も作られない').to.equal(1);
    });

    it('コミットは成功したが例外が返った(結果不明)場合は、コピーを削除しない(実際には採用されている)', async () => {
      await seedSource({ ocrResultUrl: 'gs://test-bucket/ocr-results/src1/run-a.txt' });
      const fake = fakeDeps();
      let caught: unknown;
      try {
        await run(['c-a'], { deps: fake.deps, database: dbThrowingAfterCommit(db) });
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.instanceOf(Error);
      expect((await db.doc('documents/src1_dup_c-a').get()).exists).to.equal(true);
      expect(fake.deleted, '採用済みの全文を消すと複製docの getOcrText が not-found になる').to.deep.equal([]);
    });
  });

  describe('OCR全文の失敗時の扱い(silent-failure レビュー)', () => {
    it('callback は最後まで返ったが commit 結果が不明な場合は、複製docがまだ読めなくてもコピーを削除しない', async () => {
      // 後からサーバー側で commit が反映されると、複製docは消えたオブジェクトを指すことになり、
      // 再実行も「作成済み」で全文が作り直されない。結果不明のときは孤児を残す方を選ぶ。
      await seedSource({ ocrResultUrl: 'gs://test-bucket/ocr-results/src1/run-a.txt' });
      const fake = fakeDeps();
      let caught: unknown;
      try {
        await run(['c-a'], { deps: fake.deps, database: dbFailingAfterCallbackBeforeCommit(db) });
      } catch (err) {
        caught = err;
      }
      expect((caught as Error).message).to.equal('injected failure after callback, before commit');
      expect(fake.copies, '前提: コピーは行われている').to.have.length(1);
      expect((await db.doc('documents/src1_dup_c-a').get()).exists, '前提: この時点では複製docは読めない').to.equal(false);
      expect(fake.deleted).to.deep.equal([]);
    });

    it('補償時に複製docが既にあっても、ocrResultUrl が今回のコピーと違えば(別の実行のもの)、今回のコピーは削除する', async () => {
      // 同じ複製を別の実行が先に作った(別の ocrRunId のコピー)場合、今回のコピーは採用されていない。
      // トランザクションが読んだdocへ callback の内側から外で書き込むと、悲観ロックで待たされて
      // デッドロックするため、「トランザクションが失敗して(ロックが解放された)直後」に作る。
      await seedSource({ ocrResultUrl: 'gs://test-bucket/ocr-results/src1/run-a.txt' });
      const fake = fakeDeps();
      const failing = dbFailingTxSet(db, 1);
      const database = new Proxy(failing, {
        get(target, prop) {
          if (prop === 'runTransaction') {
            return async (cb: unknown, opts: unknown) => {
              try {
                return await (target as unknown as { runTransaction: (...a: unknown[]) => Promise<unknown> }).runTransaction(cb, opts);
              } catch (err) {
                await db.doc('documents/src1_dup_c-a').set({
                  id: 'src1_dup_c-a',
                  customerId: 'c-a',
                  ocrResultUrl: 'gs://test-bucket/ocr-results/other-run.txt',
                });
                throw err;
              }
            };
          }
          const v = (target as unknown as Record<string | symbol, unknown>)[prop];
          return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
        },
      }) as admin.firestore.Firestore;

      try {
        await run(['c-a'], { deps: fake.deps, database });
      } catch {
        // 期待どおり失敗する
      }
      expect(fake.deleted).to.deep.equal(['gs://test-bucket/ocr-results/src1_dup_c-a/run-a.txt']);
    });

    it('補償削除が失敗しても、元のエラーを優先して返し、残りのコピーの削除も続ける', async () => {
      await seedSource({ ocrResultUrl: 'gs://test-bucket/ocr-results/src1/run-a.txt' });
      const fake = fakeDeps();
      const attempted: string[] = [];
      const deps: ManualDuplicationDeps = {
        ...fake.deps,
        deleteOcrResult: async (url) => {
          attempted.push(url);
          throw new Error('delete failed');
        },
      };
      let caught: unknown;
      try {
        await run(['c-a', 'c-b'], { deps, database: dbFailingTxSet(db, 3) });
      } catch (err) {
        caught = err;
      }
      expect((caught as Error).message, '補償の失敗(delete failed)ではなく、元のエラーが返る').to.equal('injected write failure');
      expect(attempted, '1件目の削除が失敗しても、2件目の削除を試みる').to.have.length(2);
    });

    it('OCR全文のコピーが失敗したら、原因が分かる failed-precondition にし、先にコピーした分は削除する', async () => {
      await seedSource({ ocrResultUrl: 'gs://test-bucket/ocr-results/src1/run-a.txt' });
      const fake = fakeDeps();
      let copyCalls = 0;
      const deps: ManualDuplicationDeps = {
        ...fake.deps,
        copyOcrResult: async (sourceUrl, destinationKey, ocrRunId) => {
          copyCalls += 1;
          if (copyCalls === 2) throw new Error('gcs: 404 No such object');
          return fake.deps.copyOcrResult(sourceUrl, destinationKey, ocrRunId);
        },
      };

      const err = await expectHttpsError(() => run(['c-a', 'c-b'], { deps }), 'failed-precondition');

      // 汎用の internal(FEでは「電波状況を確認」)ではなく、OCR全文のコピー失敗だと分かる文言にする
      expect(err.message).to.contain('OCR全文');
      expect(fake.deleted).to.deep.equal(['gs://test-bucket/ocr-results/src1_dup_c-a/run-a.txt']);
      expect(await countDocuments()).to.equal(1);
    });
  });

  // ------------------------------------------------------------ 冪等・同時実行
  describe('重複の防止(冪等・同時実行)', () => {
    it('同じ入力を2回続けて呼ぶと、2回目は全件 skipped で doc の数が増えない', async () => {
      await seedSource();
      const first = await run(['c-a', 'c-b']);
      expect(first.created).to.have.length(2);
      const countAfterFirst = await countDocuments();

      const second = await run(['c-a', 'c-b']);
      expect(second.created).to.deep.equal([]);
      expect(second.skipped).to.deep.equal([
        { customerId: 'c-a', reason: 'already-exists' },
        { customerId: 'c-b', reason: 'already-exists' },
      ]);
      expect(await countDocuments()).to.equal(countAfterFirst);
    });

    it('同じ入力の同時2回呼び出しでも、複製は重複しない', async () => {
      await seedSource();
      const results = await Promise.all([run(['c-a', 'c-b']), run(['c-a', 'c-b'])]);

      const createdTotal = results.reduce((n, r) => n + r.created.length, 0);
      expect(createdTotal, '2回の呼び出しで作られた合計は2件').to.equal(2);
      const members = await groupDocs('src1');
      expect(members.map((m) => m.id)).to.deep.equal(['src1', 'src1_dup_c-a', 'src1_dup_c-b']);
    });

    it('同じグループの別々の兄弟(元の書類と複製)から、同じ利用者を同時に追加しても重複しない', async () => {
      await seedSource();
      await run(['c-a']); // sib = src1_dup_c-a
      // 元の書類と兄弟、どちらからも c-b を追加する(決定的IDは別々になる)
      await Promise.all([
        run(['c-b'], { documentId: 'src1' }),
        run(['c-b'], { documentId: 'src1_dup_c-a' }),
      ]);
      const members = await groupDocs('src1');
      const forB = members.filter((m) => m.customerId === 'c-b');
      expect(forB, 'c-b の書類はグループ内で1件だけ').to.have.length(1);
      expect(members.length).to.be.at.most(5);
    });

    it('複製後に利用者を変更しても、元の利用者用は作り直せず「作成済み」になる(IDは作成の履歴)', async () => {
      await seedSource();
      await run(['c-a']);
      await db.doc('documents/src1_dup_c-a').update({ customerId: 'c-e', customerName: 'テスト五郎' });

      const again = await run(['c-a']);
      expect(again.created).to.deep.equal([]);
      // 「作成済み」と伝えると、その利用者用の書類は実際には存在しない(別の利用者のものになっている)ため、
      // 付け替えられていることが分かる理由で返す(FEで「削除してから複製し直す」手順を案内する)
      expect(again.skipped).to.deep.equal([{ customerId: 'c-a', reason: 'reassigned' }]);
    });

    it('付け替えられていない既存の複製は、これまでどおり「作成済み」(already-exists)で返す', async () => {
      await seedSource();
      await run(['c-a']);
      const again = await run(['c-a']);
      expect(again.skipped).to.deep.equal([{ customerId: 'c-a', reason: 'already-exists' }]);
    });
  });

  // ------------------------------------------------------------ 人数上限
  describe('グループ合計の上限(5名)', () => {
    it('元の書類 + 4名 = 5名ちょうどは作れる', async () => {
      await seedSource();
      const result = await run(['c-a', 'c-b', 'c-c', 'c-d']);
      expect(result.created).to.have.length(4);
      expect(await groupDocs('src1')).to.have.length(5);
    });

    it('一度に5名を依頼 → invalid-argument(何も作られない)', async () => {
      await seedSource();
      await expectHttpsError(() => run(['c-a', 'c-b', 'c-c', 'c-d', 'c-e']), 'invalid-argument');
      expect(await countDocuments()).to.equal(1);
    });

    it('回数を分けても 5名を超えない(2名 → 2名 → 1名目で拒否)', async () => {
      await seedSource();
      await run(['c-a', 'c-b']);
      await run(['c-c', 'c-d']);
      expect(await groupDocs('src1')).to.have.length(5);

      await expectHttpsError(() => run(['c-e']), 'failed-precondition');
      expect(await groupDocs('src1')).to.have.length(5);
    });

    it('既存の兄弟が1件あるとき、4名の追加(合計6名)は拒否され、1件も作られない', async () => {
      await seedSource({ distributionId: 'src1' });
      await db.doc('documents/auto-copy-x').set(
        sourceDocData({ id: 'auto-copy-x', customerId: 'c-e', customerName: 'テスト五郎', distributionId: 'src1' })
      );
      await expectHttpsError(() => run(['c-a', 'c-b', 'c-c', 'c-d']), 'failed-precondition');
      expect(await countDocuments()).to.equal(2);
    });

    it('作成済みの利用者だけを再依頼する場合は、上限に達していても拒否されず skipped になる', async () => {
      await seedSource();
      await run(['c-a', 'c-b', 'c-c', 'c-d']);
      const again = await run(['c-a', 'c-b']);
      expect(again.created).to.deep.equal([]);
      expect(again.skipped).to.have.length(2);
    });
  });
});
