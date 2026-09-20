/**
 * force-reindex.js の pure logic テスト (Issue #229, ADR-0015 Follow-up)
 *
 * 対象: `scripts/force-reindex.js` の parseArgs / computeExpectedIndex / detectDrift
 *
 * reindexDocument の execute=true パス (BulkWriter 経由の書込み) は、実 Firestore の
 * merge:true / FieldValue.increment / dot-path update セマンティクスを模倣する
 * インメモリモック (createFirestoreMock、Issue #687) で検証する。
 * Firestore 自体のセマンティクスの正しさは SDK の契約として信頼し、本テストは
 * reindexDocument が BulkWriter API を正しい引数・順序で呼んでいるかを検証する。
 */

import { expect } from 'chai';
import * as path from 'path';
import { createRequire } from 'module';

// ts-node の CommonJS / ESM 両モードに対応:
// - CommonJS モード (CI 環境): __dirname 等が使えるが require は直接利用可
// - ESM モード (ローカル mocha の ES module 自動判定時): createRequire で CJS 読込
// import.meta.url は CommonJS 出力でエラー (TS1470) のため使用不可。
// 代わりに process.cwd() + package.json 基点で createRequire を作る。
const requireCjs = createRequire(`${process.cwd()}/package.json`);
const forceReindex = requireCjs(path.resolve(process.cwd(), '../scripts/force-reindex.js'));
const { loadTokenizer } = requireCjs(path.resolve(process.cwd(), '../scripts/lib/loadTokenizer.js'));
const { assertFirestoreErrorsModule } = requireCjs(path.resolve(process.cwd(), '../scripts/lib/loadFirestoreErrors.js'));
// force-reindex.js と同一の CJS require パスで admin を取得する。
// `import * as admin from 'firebase-admin'` は ts-node の ESM 再解釈時に
// admin.firestore が undefined になる (CJS 名前空間解決の相互運用問題) ため使わない。
const admin: any = requireCjs('firebase-admin');
const auditLogger: any = requireCjs(path.resolve(process.cwd(), '../scripts/lib/auditLogger.js'));

/**
 * runSingleDocId/runAllDrift 経由のテストで Cloud Logging への実接続を避けるための stub。
 * force-reindex.js が require する auditLogger.js と同一インスタンス (Node module cache) を
 * 対象にするため、_setLoggingForTest(#387 由来の test 用 DI) で偽の Logging を注入する。
 */
function stubAuditLogging(projectId: string) {
  auditLogger._setLoggingForTest(projectId, {
    log: () => ({
      entry: (metadata: any, payload: any) => ({ metadata, payload }),
      write: async () => {},
    }),
  });
}

/** stubAuditLogging と同様だが、書き込まれた payload を capture して検証可能にする。 */
function stubAuditLoggingWithCapture(projectId: string): any[] {
  const captured: any[] = [];
  auditLogger._setLoggingForTest(projectId, {
    log: () => ({
      entry: (_metadata: any, payload: any) => payload,
      write: async (entry: any) => { captured.push(entry); },
    }),
  });
  return captured;
}

/**
 * 実 Firestore の主要セマンティクスを模倣するインメモリモック (Issue #687)。
 * - bulkWriter.set(ref, data, {merge:true}): 既存ドキュメントとの再帰マージ
 *   (ネストされたオブジェクトのキー単位マージ、FieldValue.increment/delete の解決を含む)
 * - bulkWriter.update(ref, data): dot 記法フィールドパスの部分更新
 * - db.getAll(...refs): 呼び出しごとに setImmediate 1 tick 分の遅延を挟み、
 *   並行 reindexDocument 呼び出しの read-then-write が確実に interleave するようにする
 *   (遅延がないと Node の同期実行順に依存し、競合シナリオが再現しないテストになる)
 */
function createFirestoreMock() {
  const store = new Map<string, any>();

  function isFieldValue(v: any): boolean {
    return v instanceof admin.firestore.FieldValue;
  }

  function resolveFieldValue(existing: any, value: any): { value: any; isDelete: boolean } {
    const ctorName = value.constructor.name;
    if (ctorName === 'NumericIncrementTransform') {
      const operand = (value as any).operand;
      return { value: (typeof existing === 'number' ? existing : 0) + operand, isDelete: false };
    }
    if (ctorName === 'DeleteTransform') {
      return { value: undefined, isDelete: true };
    }
    throw new Error(`createFirestoreMock: 未対応の FieldValue: ${ctorName}`);
  }

  function isPlainObject(v: any): boolean {
    return v !== null && typeof v === 'object' && !Array.isArray(v) && !isFieldValue(v)
      && v.constructor === Object;
  }

  function deepMergeSet(target: any, patch: any): any {
    const result: any = { ...(target || {}) };
    for (const [key, value] of Object.entries(patch)) {
      if (isFieldValue(value)) {
        const { value: resolved, isDelete } = resolveFieldValue(result[key], value);
        if (isDelete) delete result[key];
        else result[key] = resolved;
      } else if (isPlainObject(value)) {
        result[key] = deepMergeSet(result[key], value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  function applyDotPathUpdate(target: any, patch: Record<string, any>): any {
    const result: any = { ...(target || {}) };
    for (const [fieldPath, value] of Object.entries(patch)) {
      const parts = fieldPath.split('.');
      let cursor = result;
      for (let i = 0; i < parts.length - 1; i++) {
        cursor[parts[i]] = { ...(cursor[parts[i]] || {}) };
        cursor = cursor[parts[i]];
      }
      const lastKey = parts[parts.length - 1];
      if (isFieldValue(value)) {
        const { value: resolved, isDelete } = resolveFieldValue(cursor[lastKey], value);
        if (isDelete) delete cursor[lastKey];
        else cursor[lastKey] = resolved;
      } else {
        cursor[lastKey] = value;
      }
    }
    return result;
  }

  function tick() {
    return new Promise((resolve) => setImmediate(resolve));
  }

  function makeRef(collectionName: string, id: string) {
    return { id, path: `${collectionName}/${id}`, collectionName };
  }

  async function getAll(...refs: any[]) {
    await tick();
    return refs.map((ref) => {
      const data = store.get(ref.path);
      return {
        exists: data !== undefined,
        id: ref.id,
        ref,
        data: () => (data ? { ...data } : undefined),
      };
    });
  }

  function collection(name: string) {
    return {
      doc(id: string) {
        return makeRef(name, id);
      },
    };
  }

  const db: any = { collection, getAll };

  function createBulkWriter() {
    let closed = false;
    let closeCallCount = 0;
    return {
      async set(ref: any, data: any, options?: { merge?: boolean }) {
        if (closed) throw new Error('createFirestoreMock: close() 後の set() 呼び出し');
        await tick();
        const existing = store.get(ref.path);
        store.set(ref.path, options?.merge ? deepMergeSet(existing, data) : data);
        return {};
      },
      async update(ref: any, data: any) {
        if (closed) throw new Error('createFirestoreMock: close() 後の update() 呼び出し');
        await tick();
        if (!store.has(ref.path)) {
          const err: any = new Error(`createFirestoreMock: NOT_FOUND ${ref.path}`);
          err.code = 5;
          throw err;
        }
        store.set(ref.path, applyDotPathUpdate(store.get(ref.path), data));
        return {};
      },
      async close() {
        closeCallCount++;
        closed = true;
      },
      get closeCallCount() {
        return closeCallCount;
      },
    };
  }

  function getStoredDoc(collectionName: string, id: string) {
    return store.get(`${collectionName}/${id}`);
  }

  function seedDoc(collectionName: string, id: string, data: any) {
    store.set(`${collectionName}/${id}`, data);
  }

  return { db, createBulkWriter, getStoredDoc, seedDoc };
}

describe('force-reindex: parseArgs', () => {
  it('--doc-id のみで値が設定される', () => {
    const args = forceReindex.parseArgs(['--doc-id', 'abc123']);
    expect(args.docId).to.equal('abc123');
    expect(args.allDrift).to.equal(false);
    expect(args.execute).to.equal(false);
  });

  it('--all-drift フラグが有効になる', () => {
    const args = forceReindex.parseArgs(['--all-drift']);
    expect(args.allDrift).to.equal(true);
    expect(args.docId).to.equal(null);
  });

  it('--missing-hash-only は --all-drift と併用でき、既定は false (Issue #984)', () => {
    expect(forceReindex.parseArgs(['--all-drift']).missingHashOnly).to.equal(false);
    const args = forceReindex.parseArgs(['--all-drift', '--missing-hash-only', '--sample=5']);
    expect(args.missingHashOnly).to.equal(true);
    expect(args.allDrift).to.equal(true);
    expect(args.sample).to.equal(5);
  });

  it('--missing-hash-only は --all-drift なしでは拒否する(--doc-id との併用も同様)', () => {
    expect(() => forceReindex.parseArgs(['--missing-hash-only'])).to.throw();
    expect(() => forceReindex.parseArgs(['--doc-id', 'abc123', '--missing-hash-only'])).to.throw();
  });

  it('--execute 未指定時は dry-run (execute=false)', () => {
    const args = forceReindex.parseArgs(['--doc-id', 'abc123']);
    expect(args.execute).to.equal(false);
  });

  it('--execute 指定時は execute=true', () => {
    const args = forceReindex.parseArgs(['--doc-id', 'abc123', '--execute']);
    expect(args.execute).to.equal(true);
  });

  it('--sample=10 を数値として受理', () => {
    const args = forceReindex.parseArgs(['--all-drift', '--sample=10']);
    expect(args.sample).to.equal(10);
  });

  it('--batch-size=250 を数値として受理', () => {
    const args = forceReindex.parseArgs(['--all-drift', '--batch-size=250']);
    expect(args.batchSize).to.equal(250);
  });

  it('--concurrency 未指定時は DEFAULT_CONCURRENCY を採用', () => {
    const args = forceReindex.parseArgs(['--all-drift']);
    expect(args.concurrency).to.equal(forceReindex.DEFAULT_CONCURRENCY);
  });

  it('--concurrency=8 を数値として受理', () => {
    const args = forceReindex.parseArgs(['--all-drift', '--concurrency=8']);
    expect(args.concurrency).to.equal(8);
  });

  it('--dry-run はデフォルト動作のため無視される (互換性維持)', () => {
    const args = forceReindex.parseArgs(['--doc-id', 'abc', '--dry-run']);
    expect(args.execute).to.equal(false);
  });

  it('--doc-id と --all-drift 同時指定はエラー', () => {
    expect(() => forceReindex.parseArgs(['--doc-id', 'abc', '--all-drift'])).to.throw(
      '--doc-id と --all-drift は同時指定できません'
    );
  });

  it('モード未指定はエラー', () => {
    expect(() => forceReindex.parseArgs(['--execute'])).to.throw(
      '--doc-id または --all-drift のいずれかを指定してください'
    );
  });

  it('--doc-id 直後に値が無いとエラー', () => {
    expect(() => forceReindex.parseArgs(['--doc-id', '--execute'])).to.throw(
      '--doc-id には値が必要です'
    );
  });

  it('未知のオプションはエラー', () => {
    expect(() => forceReindex.parseArgs(['--doc-id', 'abc', '--unknown'])).to.throw(
      '未知のオプション: --unknown'
    );
  });

  it('--sample に負数はエラー', () => {
    expect(() => forceReindex.parseArgs(['--all-drift', '--sample=-1'])).to.throw(
      '--sample には正の整数を指定してください'
    );
  });

  it('--sample に 0 はエラー', () => {
    expect(() => forceReindex.parseArgs(['--all-drift', '--sample=0'])).to.throw(
      '--sample には正の整数を指定してください'
    );
  });

  it('--sample に非数値はエラー', () => {
    expect(() => forceReindex.parseArgs(['--all-drift', '--sample=abc'])).to.throw(
      '--sample には正の整数を指定してください'
    );
  });

  it('--batch-size に負数はエラー (pr-test-analyzer 指摘)', () => {
    expect(() => forceReindex.parseArgs(['--all-drift', '--batch-size=-1'])).to.throw(
      '--batch-size には正の整数を指定してください'
    );
  });

  it('--batch-size に 0 はエラー', () => {
    expect(() => forceReindex.parseArgs(['--all-drift', '--batch-size=0'])).to.throw(
      '--batch-size には正の整数を指定してください'
    );
  });

  it('--batch-size に非数値はエラー', () => {
    expect(() => forceReindex.parseArgs(['--all-drift', '--batch-size=abc'])).to.throw(
      '--batch-size には正の整数を指定してください'
    );
  });

  it('--concurrency に負数はエラー', () => {
    expect(() => forceReindex.parseArgs(['--all-drift', '--concurrency=-1'])).to.throw(
      '--concurrency には正の整数を指定してください'
    );
  });

  it('--concurrency に 0 はエラー', () => {
    expect(() => forceReindex.parseArgs(['--all-drift', '--concurrency=0'])).to.throw(
      '--concurrency には正の整数を指定してください'
    );
  });

  it('--concurrency に非数値はエラー', () => {
    expect(() => forceReindex.parseArgs(['--all-drift', '--concurrency=abc'])).to.throw(
      '--concurrency には正の整数を指定してください'
    );
  });

  it('--doc-id に空文字はエラー', () => {
    expect(() => forceReindex.parseArgs(['--doc-id', ''])).to.throw(
      '--doc-id には値が必要です'
    );
  });

  it('--help はエラーなしで args.help=true', () => {
    const args = forceReindex.parseArgs(['--help']);
    expect(args.help).to.equal(true);
  });
});

describe('force-reindex: computeExpectedIndex', () => {
  it('最小ドキュメント (顧客名のみ) でトークンと tokenHash を返す', () => {
    const result = forceReindex.computeExpectedIndex({
      customerName: 'テスト太郎',
      fileDate: null,
    });
    expect(result.tokens).to.be.an('array').with.length.greaterThan(0);
    expect(result.tokenHash).to.be.a('string').with.length.greaterThan(0);
  });

  it('空ドキュメントでも tokenHash を返す (空配列の hash)', () => {
    const result = forceReindex.computeExpectedIndex({});
    expect(result.tokens).to.deep.equal([]);
    expect(result.tokenHash).to.be.a('string');
  });

  it('同一内容のドキュメントは同一 tokenHash を返す (idempotent)', () => {
    const doc = { customerName: 'A社', officeName: 'B事業所', fileName: 'test.pdf' };
    const result1 = forceReindex.computeExpectedIndex(doc);
    const result2 = forceReindex.computeExpectedIndex(doc);
    expect(result1.tokenHash).to.equal(result2.tokenHash);
  });

  it('Firestore Timestamp 型の fileDate を Date に変換する', () => {
    const mockTimestamp = {
      toDate: () => new Date('2026-04-16'),
    };
    const result = forceReindex.computeExpectedIndex({
      customerName: 'X',
      fileDate: mockTimestamp,
    });
    // 日付トークンが含まれていること
    const dateTokens = result.tokens.filter((t: { field: string }) => t.field === 'date');
    expect(dateTokens.length).to.be.greaterThan(0);
  });
});

describe('force-reindex: detectDrift', () => {
  it('search.tokenHash 未設定のドキュメントは drift 判定', () => {
    const result = forceReindex.detectDrift({
      customerName: 'テスト',
    });
    expect(result.isDrifted).to.equal(true);
    expect(result.actualHash).to.equal(null);
    expect(result.expectedHash).to.be.a('string');
  });

  it('tokenHash が再計算結果と一致すれば drift なし', () => {
    const doc = { customerName: '一致テスト' };
    const expected = forceReindex.computeExpectedIndex(doc);
    const result = forceReindex.detectDrift({
      ...doc,
      search: { tokenHash: expected.tokenHash },
    });
    expect(result.isDrifted).to.equal(false);
    expect(result.actualHash).to.equal(expected.tokenHash);
    expect(result.expectedHash).to.equal(expected.tokenHash);
  });

  it('tokenHash が再計算結果と不一致なら drift 判定', () => {
    const result = forceReindex.detectDrift({
      customerName: '不一致テスト',
      search: { tokenHash: 'stale-hash-xxxxxxxx' },
    });
    expect(result.isDrifted).to.equal(true);
    expect(result.actualHash).to.equal('stale-hash-xxxxxxxx');
    expect(result.expectedHash).to.not.equal('stale-hash-xxxxxxxx');
  });
});

describe('force-reindex: reindexDocument (dry-run)', () => {
  it('execute=false の場合は plan を返すだけで Firestore 呼び出しなし', async () => {
    // execute=false 時は db / tokenizer の Firestore 書き込み系を呼ばない
    const fakeDb = {} as Parameters<typeof forceReindex.reindexDocument>[0];
    const result = await forceReindex.reindexDocument(
      fakeDb,
      'test-doc-id',
      { customerName: 'A社', fileName: 'test.pdf' },
      { execute: false }
    );
    expect(result.docId).to.equal('test-doc-id');
    expect(result.tokensToAdd).to.be.greaterThan(0);
    expect(result.tokensToRemove).to.equal(0);
    expect(result.expectedHash).to.be.a('string');
    expect(result.skipped).to.equal(false);
  });

  it('execute=false で db の任意メソッド呼出は throw する Proxy でも成功 (ADR-0008 準拠の明示検証)', async () => {
    // pr-test-analyzer 指摘対応: dry-run パスで db が一切呼ばれないことを Proxy で検証。
    // 将来 dry-run パスに書き込みが混入すると本テストで検出される。
    const throwingDb = new Proxy({}, {
      get(_target, prop: string) {
        throw new Error(`dry-run で db.${prop} が呼ばれてはいけない (ADR-0008 違反)`);
      },
    }) as Parameters<typeof forceReindex.reindexDocument>[0];
    const result = await forceReindex.reindexDocument(
      throwingDb,
      'test-doc-id',
      { customerName: 'A社', fileName: 'test.pdf' },
      { execute: false }
    );
    expect(result.skipped).to.equal(false);
    expect(result.tokensToAdd).to.be.greaterThan(0);
  });

  it('execute=false で search.tokens がある場合 tokensToRemove を計算', async () => {
    const fakeDb = {} as Parameters<typeof forceReindex.reindexDocument>[0];
    const result = await forceReindex.reindexDocument(
      fakeDb,
      'test-doc-id',
      {
        customerName: 'A社',
        search: { tokens: ['削除されるべき古いトークン'], tokenHash: 'old' },
      },
      { execute: false }
    );
    // 古いトークン 1件は新トークンに含まれないため tokensToRemove=1
    expect(result.tokensToRemove).to.equal(1);
  });

  it('search.tokens に重複トークン文字列があっても tokensToRemove は重複排除される (code-review 2026-07-19 指摘)', () => {
    // customerName と officeName から同一トークン文字列が生成されるケースを模した
    // oldTokens (Firestore に保存済みの旧 search.tokens は重複を含みうる)。
    const plan = forceReindex.planReindex('test-doc-id', {
      customerName: 'X社',
      search: { tokens: ['重複トークン', '重複トークン', '他のトークン'], tokenHash: 'old' },
    });
    // '重複トークン' は新トークンに含まれないため削除対象だが、1件のみに集約される。
    // 重複排除されないと emulator 実証済みの通り同一 search_index doc への
    // df:increment(-1) が2重 enqueue され df が過剰減算される。
    const removeCount = plan.tokensToRemove.filter((t: string) => t === '重複トークン').length;
    expect(removeCount).to.equal(1);
  });
});

describe('force-reindex: planReindex (systemic error, Issue #687)', () => {
  it('aggregateTokensByTokenId が invariant 違反なら副作用前に throw する', () => {
    // FIELD_TO_MASK に存在しない field を返す fake tokenizer で
    // systemic error (プログラマエラー) を再現する。
    const fakeTokenizer = {
      generateDocumentTokens: () => [{ field: 'unknownField', token: 'x', weight: 1 }],
      generateTokensHash: () => 'fake-hash',
      generateTokenId: (t: string) => `id-${t}`,
    };
    expect(() =>
      forceReindex.planReindex('doc-x', { customerName: 'A' }, fakeTokenizer)
    ).to.throw('[aggregateTokens] unknown TokenField');
  });

  it('planReindex が throw した場合 reindexDocument の Firestore 呼び出しに一切到達しない', async () => {
    const fakeTokenizer = {
      generateDocumentTokens: () => [{ field: 'unknownField', token: 'x', weight: 1 }],
      generateTokensHash: () => 'fake-hash',
      generateTokenId: (t: string) => `id-${t}`,
    };
    const throwingDb = new Proxy({}, {
      get(_target, prop: string) {
        throw new Error(`db.${prop} が呼ばれてはいけない (planReindex 段階で中断すべき)`);
      },
    }) as Parameters<typeof forceReindex.reindexDocument>[0];
    let caught: any = null;
    try {
      await forceReindex.reindexDocument(
        throwingDb,
        'doc-x',
        { customerName: 'A' },
        { execute: true, bulkWriter: {} },
        fakeTokenizer,
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).to.exist;
    expect(caught.message).to.include('[aggregateTokens]');
  });
});

describe('force-reindex: reindexDocument (execute, BulkWriter 並行実行, Issue #687)', () => {
  it('未作成の search_index token に2つの docId が並行 execute しても、両方の postings が保持され df が正しく加算される (Codex plan review High #1 対応)', async () => {
    const tokenizer = loadTokenizer();
    const mock = createFirestoreMock();
    const bulkWriter = mock.createBulkWriter();

    // 同一 customerName で共通トークンを持たせ、並行実行時に同一 tokenId への
    // 未作成 posting 書込みが競合するシナリオを再現する。
    const docA = { customerName: '共有太郎商店', fileName: 'a.pdf' };
    const docB = { customerName: '共有太郎商店', fileName: 'b.pdf' };
    // documents.doc(docId).update() (step 3) が対象とする既存レコードを事前に seed する
    // (drift 復旧対象は既存 processed ドキュメントのため、実運用でも必ず存在する)
    mock.seedDoc('documents', 'docA', docA);
    mock.seedDoc('documents', 'docB', docB);

    const planA = forceReindex.planReindex('docA', docA, tokenizer);
    const planB = forceReindex.planReindex('docB', docB, tokenizer);
    const commonTokenIds = [...planA.tokenMap.keys()].filter((id: string) => planB.tokenMap.has(id));
    expect(commonTokenIds.length).to.be.greaterThan(0);

    await Promise.all([
      forceReindex.reindexDocument(mock.db, 'docA', docA, { execute: true, bulkWriter }),
      forceReindex.reindexDocument(mock.db, 'docB', docB, { execute: true, bulkWriter }),
    ]);

    for (const tokenId of commonTokenIds) {
      const indexDoc = mock.getStoredDoc('search_index', tokenId);
      expect(indexDoc, `tokenId=${tokenId} の search_index ドキュメントが存在しない`).to.exist;
      expect(indexDoc.postings.docA, `tokenId=${tokenId} の postings.docA が消失`).to.exist;
      expect(indexDoc.postings.docB, `tokenId=${tokenId} の postings.docB が消失`).to.exist;
      expect(indexDoc.df, `tokenId=${tokenId} の df が不正`).to.equal(2);
    }
  });

  it('新 posting 書込みで一部 token が失敗しても Promise.allSettled で他の書込みは完了してから例外を投げる (Codex plan review High #2 対応)', async () => {
    const tokenizer = loadTokenizer();
    const mock = createFirestoreMock();
    const bulkWriter = mock.createBulkWriter();
    const originalSet = bulkWriter.set.bind(bulkWriter);
    let setCallCount = 0;
    bulkWriter.set = async (ref: any, data: any, options?: any) => {
      setCallCount++;
      if (setCallCount === 1) {
        throw new Error('simulated write failure on first token');
      }
      return originalSet(ref, data, options);
    };

    // 複数 token を生成させるため customerName + officeName + fileName を持たせる
    const doc = { customerName: '複数トークン顧客名', officeName: '複数トークン事業所', fileName: 'multi-token.pdf' };
    const plan = forceReindex.planReindex('docX', doc, tokenizer);
    expect(plan.tokenMap.size).to.be.greaterThan(1);

    let caught: any = null;
    try {
      await forceReindex.reindexDocument(mock.db, 'docX', doc, { execute: true, bulkWriter });
    } catch (error) {
      caught = error;
    }
    expect(caught).to.exist;
    expect(caught.reindexStage).to.equal('search_index_postings_write');
    // 1件目が失敗しても、allSettled により残りの token 書込みは試行される
    expect(setCallCount).to.equal(plan.tokenMap.size);
  });

  it('同一stageで複数tokenが失敗した場合、settleOrThrow は全書込みを試行した上で失敗件数を集約したエラーを投げる (診断精度、code-review 2026-07-19 指摘)', async () => {
    const tokenizer = loadTokenizer();
    const mock = createFirestoreMock();
    const bulkWriter = mock.createBulkWriter();
    const originalSet = bulkWriter.set.bind(bulkWriter);
    let setCallCount = 0;
    bulkWriter.set = async (ref: any, data: any, options?: any) => {
      setCallCount++;
      // 3 token 中 2 件を失敗させる (旧実装は1件目のみ記録し2件目の失敗scopeが失われていた)
      if (setCallCount <= 2) {
        throw new Error(`simulated failure #${setCallCount}`);
      }
      return originalSet(ref, data, options);
    };

    const doc = { customerName: '3トークン生成用顧客名', officeName: '3トークン生成用事業所', fileName: 'triple-token.pdf' };
    const plan = forceReindex.planReindex('docMulti', doc, tokenizer);
    expect(plan.tokenMap.size).to.be.greaterThan(2);

    let caught: any = null;
    try {
      await forceReindex.reindexDocument(mock.db, 'docMulti', doc, { execute: true, bulkWriter });
    } catch (error) {
      caught = error;
    }
    expect(caught).to.exist;
    expect(caught.reindexStage).to.equal('search_index_postings_write');
    // 全 token への書込みが試行された (allSettled により drop されない)
    expect(setCallCount).to.equal(plan.tokenMap.size);
    // 失敗件数 (2件) がエラーメッセージに集約されている
    expect(caught.message).to.include('2 件の書込みが失敗');
    // 代表エラー (先頭の失敗) の情報を cause として保持している
    expect(caught.cause?.message).to.equal('simulated failure #1');
  });

  it('新posting書込みが部分失敗した後に再実行すると postings/df が正しい最終状態に収束する (冪等性収束、code-review 2026-07-19 指摘)', async () => {
    const tokenizer = loadTokenizer();
    const mock = createFirestoreMock();
    const bulkWriter = mock.createBulkWriter();
    const originalSet = bulkWriter.set.bind(bulkWriter);
    let setCallCount = 0;
    let failFirstAttempt = true;
    bulkWriter.set = async (ref: any, data: any, options?: any) => {
      setCallCount++;
      if (failFirstAttempt && setCallCount === 1) {
        throw new Error('simulated write failure on first attempt only');
      }
      return originalSet(ref, data, options);
    };

    const doc = { customerName: '冪等性テスト顧客', officeName: '冪等性テスト事業所', fileName: 'idempotent.pdf' };
    mock.seedDoc('documents', 'docIdem', doc);
    const plan = forceReindex.planReindex('docIdem', doc, tokenizer);
    expect(plan.tokenMap.size).to.be.greaterThan(1);

    // 1回目: 1 token だけ失敗し、他の token は部分適用された状態で例外が投げられる
    let firstError: any = null;
    try {
      await forceReindex.reindexDocument(mock.db, 'docIdem', doc, { execute: true, bulkWriter });
    } catch (error) {
      firstError = error;
    }
    expect(firstError, '1回目は部分失敗するはず').to.exist;
    expect(firstError.reindexStage).to.equal('search_index_postings_write');

    // documents.search はまだ更新されていない (step3 未到達の半端状態)
    const documentsAfterFirst = mock.getStoredDoc('documents', 'docIdem');
    expect(documentsAfterFirst.search).to.be.undefined;

    // 2回目: 書込み失敗を解除して再実行 (運用手順通りの再実行)
    failFirstAttempt = false;
    const result = await forceReindex.reindexDocument(mock.db, 'docIdem', doc, { execute: true, bulkWriter });
    expect(result.skipped).to.equal(false);

    // 最終状態: 全 tokenId が postings.docIdem を持ち、df は二重加算されず 1 になっている
    // (1回目に成功した token は hadPosting=true で再 increment されない、
    //  1回目に失敗した token は 2回目で初めて作成され df=1 になる)
    for (const tokenId of plan.tokenMap.keys()) {
      const indexDoc = mock.getStoredDoc('search_index', tokenId);
      expect(indexDoc, `tokenId=${tokenId} が存在しない`).to.exist;
      expect(indexDoc.postings.docIdem, `tokenId=${tokenId} の posting が無い`).to.exist;
      expect(indexDoc.df, `tokenId=${tokenId} の df が不正 (二重加算の疑い)`).to.equal(1);
    }

    const documentsAfterSecond = mock.getStoredDoc('documents', 'docIdem');
    expect(documentsAfterSecond.search.tokenHash).to.equal(plan.tokenHash);
  });

  it('execute=true には bulkWriter が必須 (未指定は明示的エラー)', async () => {
    const doc = { customerName: 'A社' };
    let caught: any = null;
    try {
      await forceReindex.reindexDocument({} as any, 'docX', doc, { execute: true });
    } catch (error) {
      caught = error;
    }
    expect(caught).to.exist;
    expect(caught.message).to.include('bulkWriter');
  });

  it('既存 token から2つの docId が並行してpostingを削除しても df が正しく2減算される (create/increment側との対称テスト、code-review 2026-07-19 指摘)', async () => {
    const tokenizer = loadTokenizer();
    const mock = createFirestoreMock();
    const bulkWriter = mock.createBulkWriter();

    // docA/docB が旧 customerName で共通トークンを持っていた状態を用意する
    const oldCustomerName = '共有太郎商店';
    const planAOld = forceReindex.planReindex('docA', { customerName: oldCustomerName, fileName: 'a.pdf' }, tokenizer);
    const planBOld = forceReindex.planReindex('docB', { customerName: oldCustomerName, fileName: 'b.pdf' }, tokenizer);
    const commonTokenIds = [...planAOld.tokenMap.keys()].filter((id: string) => planBOld.tokenMap.has(id));
    expect(commonTokenIds.length).to.be.greaterThan(0);

    // 共通 token に両方の posting を事前 seed (df=2 相当)
    for (const tokenId of commonTokenIds) {
      const dataA = planAOld.tokenMap.get(tokenId);
      const dataB = planBOld.tokenMap.get(tokenId);
      mock.seedDoc('search_index', tokenId, {
        df: 2,
        postings: {
          docA: { score: dataA.score, fieldsMask: dataA.fieldsMask },
          docB: { score: dataB.score, fieldsMask: dataB.fieldsMask },
        },
      });
    }

    // 新ドキュメントでは customerName が変わり、共通トークンが完全に削除される想定
    const docANew = {
      customerName: '無関係な新顧客名A', fileName: 'a.pdf',
      search: { tokens: planAOld.tokens.map((t: any) => t.token), tokenHash: 'stale-a' },
    };
    const docBNew = {
      customerName: '無関係な新顧客名B', fileName: 'b.pdf',
      search: { tokens: planBOld.tokens.map((t: any) => t.token), tokenHash: 'stale-b' },
    };
    mock.seedDoc('documents', 'docA', docANew);
    mock.seedDoc('documents', 'docB', docBNew);

    await Promise.all([
      forceReindex.reindexDocument(mock.db, 'docA', docANew, { execute: true, bulkWriter }),
      forceReindex.reindexDocument(mock.db, 'docB', docBNew, { execute: true, bulkWriter }),
    ]);

    for (const tokenId of commonTokenIds) {
      const indexDoc = mock.getStoredDoc('search_index', tokenId);
      expect(indexDoc.postings.docA, `tokenId=${tokenId} の postings.docA が残っている`).to.be.undefined;
      expect(indexDoc.postings.docB, `tokenId=${tokenId} の postings.docB が残っている`).to.be.undefined;
      expect(indexDoc.df, `tokenId=${tokenId} の df が不正 (並行 decrement の競合)`).to.equal(0);
    }
  });

  it('同一 docId 内の削除→書込→documents更新の順序で書込みが行われる (段階の直列性)', async () => {
    const tokenizer = loadTokenizer();
    const mock = createFirestoreMock();
    const bulkWriter = mock.createBulkWriter();

    // 旧トークンを1つ持たせ、新ドキュメントでは含まれないようにする。
    // 他 docId の posting (docOther) も同居させ、Partial Update で
    // 更新対象外フィールドが変化しないこと (CLAUDE.md MUST) を検証する。
    mock.seedDoc('search_index', 'old-token-id', {
      df: 2,
      postings: {
        docY: { score: 1, fieldsMask: 1 },
        docOther: { score: 3, fieldsMask: 2 },
      },
    });
    const docData = {
      customerName: '新トークン顧客名',
      officeName: '不変フィールド事業所',
      search: { tokens: ['旧トークン文字列'], tokenHash: 'stale' },
    };
    mock.seedDoc('documents', 'docY', docData);
    // detectDrift 相当: tokenizer.generateTokenId('旧トークン文字列') が 'old-token-id' になるよう
    // fake tokenizer で固定する (実 tokenizer の hash 値に依存しないテストにするため)
    const fakeTokenizer = {
      generateDocumentTokens: tokenizer.generateDocumentTokens,
      generateTokensHash: tokenizer.generateTokensHash,
      generateTokenId: (t: string) => (t === '旧トークン文字列' ? 'old-token-id' : tokenizer.generateTokenId(t)),
    };

    await forceReindex.reindexDocument(mock.db, 'docY', docData, { execute: true, bulkWriter }, fakeTokenizer);

    const oldIndexDoc = mock.getStoredDoc('search_index', 'old-token-id');
    expect(oldIndexDoc.df).to.equal(1); // docY 分のみ -1、docOther 分は不変
    expect(oldIndexDoc.postings.docY).to.be.undefined;
    // 更新対象外: 他 docId (docOther) の posting は変化しない (CLAUDE.md MUST: Partial Update 不変性)
    expect(oldIndexDoc.postings.docOther).to.deep.equal({ score: 3, fieldsMask: 2 });

    const documentsDoc = mock.getStoredDoc('documents', 'docY');
    expect(documentsDoc['search']['tokenHash']).to.not.equal('stale');
    // 更新対象外: customerName/officeName 等は dot 記法 Partial Update で変化しない
    expect(documentsDoc.customerName).to.equal('新トークン顧客名');
    expect(documentsDoc.officeName).to.equal('不変フィールド事業所');
  });

  it('runSingleDocId は execute 完了後に bulkWriter.close() を一度だけ呼ぶ', async () => {
    stubAuditLogging('test');
    const mock = createFirestoreMock();
    const bulkWriter = mock.createBulkWriter();
    mock.seedDoc('documents', 'docZ', { status: 'processed', customerName: 'クローズテスト' });

    // documents.doc(id).get() を追加でサポートする db (runSingleDocId が使用)
    const db: any = {
      ...mock.db,
      bulkWriter: () => bulkWriter,
      collection: (name: string) => {
        const base = mock.db.collection(name);
        return {
          ...base,
          doc(id: string) {
            const ref = base.doc(id);
            return {
              ...ref,
              async get() {
                const data = mock.getStoredDoc(name, id);
                return { exists: data !== undefined, data: () => data };
              },
            };
          },
        };
      },
    };

    const args = { docId: 'docZ', execute: true };
    const auditCtx = { projectId: 'test', executedBy: 'tester' };
    const exitCode = await forceReindex.runSingleDocId(db, args, auditCtx);

    expect(exitCode).to.equal(forceReindex.EXIT_OK);
    expect(bulkWriter.closeCallCount).to.equal(1);
  });

  it('runSingleDocId は reindexDocument が失敗しても bulkWriter.close() を一度だけ呼ぶ (finally 保証)', async () => {
    stubAuditLogging('test');
    const mock = createFirestoreMock();
    const bulkWriter = mock.createBulkWriter();
    bulkWriter.set = async () => {
      throw new Error('simulated failure');
    };
    mock.seedDoc('documents', 'docZ', { status: 'processed', customerName: 'エラーテスト' });

    const db: any = {
      ...mock.db,
      bulkWriter: () => bulkWriter,
      collection: (name: string) => {
        const base = mock.db.collection(name);
        return {
          ...base,
          doc(id: string) {
            const ref = base.doc(id);
            return {
              ...ref,
              async get() {
                const data = mock.getStoredDoc(name, id);
                return { exists: data !== undefined, data: () => data };
              },
            };
          },
        };
      },
    };

    const args = { docId: 'docZ', execute: true };
    const auditCtx = { projectId: 'test', executedBy: 'tester' };
    const exitCode = await forceReindex.runSingleDocId(db, args, auditCtx);

    expect(exitCode).to.equal(forceReindex.EXIT_PARTIAL_FAILURE);
    expect(bulkWriter.closeCallCount).to.equal(1);
  });

  it('runSingleDocId は reindexDocument 成功後に bulkWriter.close() が失敗しても EXIT_PARTIAL_FAILURE を返す (code-review 2026-07-19 指摘)', async () => {
    stubAuditLogging('test');
    const mock = createFirestoreMock();
    const bulkWriter = mock.createBulkWriter();
    bulkWriter.close = async () => {
      throw new Error('simulated close failure');
    };
    mock.seedDoc('documents', 'docZ', { status: 'processed', customerName: 'close失敗テスト' });

    const db: any = {
      ...mock.db,
      bulkWriter: () => bulkWriter,
      collection: (name: string) => {
        const base = mock.db.collection(name);
        return {
          ...base,
          doc(id: string) {
            const ref = base.doc(id);
            return {
              ...ref,
              async get() {
                const data = mock.getStoredDoc(name, id);
                return { exists: data !== undefined, data: () => data };
              },
            };
          },
        };
      },
    };

    const args = { docId: 'docZ', execute: true };
    const auditCtx = { projectId: 'test', executedBy: 'tester' };
    // close() が例外を投げても runSingleDocId 自体は throw せず exitCode で結果を返す
    const exitCode = await forceReindex.runSingleDocId(db, args, auditCtx);

    // reindexDocument 自体は成功したが close() 失敗により EXIT_PARTIAL_FAILURE に格上げされる
    expect(exitCode).to.equal(forceReindex.EXIT_PARTIAL_FAILURE);
  });
});

describe('force-reindex: runWithConcurrency (Issue #687)', () => {
  it('全 item を過不足なく処理する', async () => {
    const items = Array.from({ length: 23 }, (_, i) => i);
    const processed: number[] = [];
    await forceReindex.runWithConcurrency(items, 5, async (item: number) => {
      processed.push(item);
    });
    expect(processed.sort((a, b) => a - b)).to.deep.equal(items);
  });

  it('同時実行数が concurrency を超えない', async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    let active = 0;
    let maxActive = 0;
    await forceReindex.runWithConcurrency(items, 4, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      active--;
    });
    expect(maxActive).to.be.at.most(4);
    expect(maxActive).to.be.greaterThan(1); // 並行実行されていること自体の確認 (直列化への退化を検出)
  });

  it('items が空なら worker を一度も呼ばない', async () => {
    let calls = 0;
    await forceReindex.runWithConcurrency([], 5, async () => {
      calls++;
    });
    expect(calls).to.equal(0);
  });

  it('concurrency が items.length より大きくてもエラーにならない', async () => {
    const items = [1, 2, 3];
    const processed: number[] = [];
    await forceReindex.runWithConcurrency(items, 100, async (item: number) => {
      processed.push(item);
    });
    expect(processed.sort()).to.deep.equal(items);
  });
});

describe('force-reindex: runAllDrift (Issue #687)', () => {
  /**
   * documents コレクションに対する where/orderBy/limit/startAfter クエリと doc(id) 取得の
   * 両方をサポートするモック。limit/startAfter を実際に allDocs 配列へ適用し、
   * runAllDrift の複数ページ pagination (startAfter カーソル) を正確に模倣する
   * (旧実装は毎回全件を1ページで返し2ページ目以降を検証できなかった、code-review 2026-07-19 指摘)。
   */
  function createDocumentsQueryableCollection(mock: ReturnType<typeof createFirestoreMock>, allDocs: Array<{ id: string; data: any }>) {
    function makeQuery(state: { limit: number; startAfterId: string | null }): any {
      return {
        where() { return makeQuery(state); },
        orderBy() { return makeQuery(state); },
        limit(n: number) { return makeQuery({ ...state, limit: n }); },
        startAfter(afterDocSnap: { id: string }) { return makeQuery({ ...state, startAfterId: afterDocSnap.id }); },
        async get() {
          let startIndex = 0;
          if (state.startAfterId) {
            const idx = allDocs.findIndex((d) => d.id === state.startAfterId);
            startIndex = idx >= 0 ? idx + 1 : allDocs.length;
          }
          const page = allDocs.slice(startIndex, startIndex + state.limit);
          return {
            empty: page.length === 0,
            docs: page.map((d) => ({ id: d.id, data: () => d.data })),
          };
        },
        doc(id: string) {
          const base = mock.db.collection('documents').doc(id);
          return {
            ...base,
            async get() {
              const data = mock.getStoredDoc('documents', id);
              return { exists: data !== undefined, data: () => data };
            },
          };
        },
      };
    }
    return makeQuery({ limit: allDocs.length, startAfterId: null });
  }

  it('ページ内で個別 docId の reindexDocument が失敗しても処理を継続し、finally で bulkWriter.close() を一度だけ呼ぶ', async () => {
    stubAuditLogging('test');
    const mock = createFirestoreMock();
    const bulkWriter = mock.createBulkWriter();
    // 1件目の set() のみ失敗させ、そのドキュメントの再index化を失敗させる
    let setCallCount = 0;
    const originalSet = bulkWriter.set.bind(bulkWriter);
    bulkWriter.set = async (ref: any, data: any, options?: any) => {
      setCallCount++;
      if (setCallCount === 1) throw new Error('simulated write failure');
      return originalSet(ref, data, options);
    };

    const docFail = { customerName: '失敗顧客', status: 'processed', processedAt: { toDate: () => new Date() } };
    mock.seedDoc('documents', 'doc-fail', docFail);

    const db: any = {
      collection: (name: string) => {
        if (name === 'documents') {
          return createDocumentsQueryableCollection(mock, [{ id: 'doc-fail', data: docFail }]);
        }
        return mock.db.collection(name);
      },
      bulkWriter: () => bulkWriter,
      getAll: mock.db.getAll,
    };

    const exitCode = await forceReindex.runAllDrift(
      db,
      { execute: true, batchSize: 500, concurrency: 5, sample: null },
      { projectId: 'test', executedBy: 'tester' },
    );

    expect(exitCode).to.equal(forceReindex.EXIT_PARTIAL_FAILURE);
    expect(bulkWriter.closeCallCount).to.equal(1);
  });

  it('drift なしなら EXIT_OK を返し bulkWriter.close() を一度だけ呼ぶ', async () => {
    stubAuditLogging('test');
    const mock = createFirestoreMock();
    const bulkWriter = mock.createBulkWriter();

    const db: any = {
      collection: (name: string) => {
        if (name === 'documents') return createDocumentsQueryableCollection(mock, []);
        return mock.db.collection(name);
      },
      bulkWriter: () => bulkWriter,
      getAll: mock.db.getAll,
    };

    const exitCode = await forceReindex.runAllDrift(
      db,
      { execute: true, batchSize: 500, concurrency: 5, sample: null },
      { projectId: 'test', executedBy: 'tester' },
    );

    expect(exitCode).to.equal(forceReindex.EXIT_OK);
    expect(bulkWriter.closeCallCount).to.equal(1);
  });

  describe('--missing-hash-only (Issue #984)', () => {
    /** 3件: tokenHash 未保存 / tokenHash 保存済みで不一致(stale) / 同じく保存済みで不一致 */
    async function run(missingHashOnly: boolean) {
      const captured = stubAuditLoggingWithCapture('test');
      const mock = createFirestoreMock();
      const bulkWriter = mock.createBulkWriter();
      const base = { status: 'processed', processedAt: { toDate: () => new Date() } };
      const allDocs = [
        { id: 'doc-nohash', data: { ...base, customerName: '未保存' } },
        { id: 'doc-stale-1', data: { ...base, customerName: '不一致1', search: { tokens: [], tokenHash: 'deadbeef' } } },
        { id: 'doc-stale-2', data: { ...base, customerName: '不一致2', search: { tokens: [], tokenHash: 'cafebabe' } } },
      ];
      allDocs.forEach((d) => mock.seedDoc('documents', d.id, d.data));
      const db: any = {
        collection: (name: string) => {
          if (name === 'documents') return createDocumentsQueryableCollection(mock, allDocs);
          return mock.db.collection(name);
        },
        bulkWriter: () => bulkWriter,
        getAll: mock.db.getAll,
      };
      const exitCode = await forceReindex.runAllDrift(
        db,
        { execute: true, batchSize: 500, concurrency: 5, sample: null, missingHashOnly },
        { projectId: 'test', executedBy: 'tester' },
      );
      const summary = captured.find((e) => e.event === 'force_reindex_batch_summary');
      return { exitCode, summary, mock };
    }

    it('tokenHash が未保存の書類だけを再 index し、保存済み(値が不一致でも)の書類には一切書込まない', async () => {
      const { exitCode, summary, mock } = await run(true);
      expect(exitCode).to.equal(forceReindex.EXIT_OK);
      expect(summary.counts.processed).to.equal(3);
      expect(summary.counts.drifted, '対象は未保存の1件のみ').to.equal(1);
      expect(summary.counts.reindexed).to.equal(1);

      expect(mock.getStoredDoc('documents', 'doc-nohash').search?.tokenHash, '未保存だった書類は再 index される').to.be.a('string');
      // Partial Update の MUST: 対象外の書類は完全に不変(tokenHash も tokens も)
      expect(mock.getStoredDoc('documents', 'doc-stale-1').search).to.deep.equal({ tokens: [], tokenHash: 'deadbeef' });
      expect(mock.getStoredDoc('documents', 'doc-stale-2').search).to.deep.equal({ tokens: [], tokenHash: 'cafebabe' });
    });

    it('フラグなしなら従来どおり、不一致の書類も含めて全て再 index する(既存挙動の回帰確認)', async () => {
      const { exitCode, summary, mock } = await run(false);
      expect(exitCode).to.equal(forceReindex.EXIT_OK);
      expect(summary.counts.drifted).to.equal(3);
      expect(summary.counts.reindexed).to.equal(3);
      expect(mock.getStoredDoc('documents', 'doc-stale-1').search.tokenHash).to.not.equal('deadbeef');
    });
  });

  it('複数ページに跨る複数 drift docs を pagination + runWithConcurrency 経由で漏れなく処理する (code-review 2026-07-19 指摘: PRの主目的である4389件規模スキャンの核心機構の検証)', async () => {
    const captured = stubAuditLoggingWithCapture('test');
    const mock = createFirestoreMock();
    const bulkWriter = mock.createBulkWriter();

    // 7件のドキュメント、全て tokenHash 未設定 (drift 判定) を用意し、
    // batchSize=3 で 3 ページ (3+3+1件) に分割、concurrency=2 で並行処理させる。
    const allDocs = Array.from({ length: 7 }, (_, i) => ({
      id: `doc-${i}`,
      data: {
        customerName: `顧客${i}`,
        status: 'processed',
        processedAt: { toDate: () => new Date() },
      },
    }));
    allDocs.forEach((d) => mock.seedDoc('documents', d.id, d.data));

    const db: any = {
      collection: (name: string) => {
        if (name === 'documents') return createDocumentsQueryableCollection(mock, allDocs);
        return mock.db.collection(name);
      },
      bulkWriter: () => bulkWriter,
      getAll: mock.db.getAll,
    };

    const exitCode = await forceReindex.runAllDrift(
      db,
      { execute: true, batchSize: 3, concurrency: 2, sample: null },
      { projectId: 'test', executedBy: 'tester' },
    );

    expect(exitCode).to.equal(forceReindex.EXIT_OK);

    const batchSummary = captured.find((e) => e.event === 'force_reindex_batch_summary');
    expect(batchSummary, 'BATCH_SUMMARY audit log が送信されていない').to.exist;
    // 全 7 件が 3 ページに跨って重複・漏れなく走査・drift 判定・再 index されたことを確認
    expect(batchSummary.counts.processed).to.equal(7);
    expect(batchSummary.counts.drifted).to.equal(7);
    expect(batchSummary.counts.reindexed).to.equal(7);
    expect(batchSummary.counts.failed).to.equal(0);

    // audit log の counts だけでなく実際の書込み結果 (documents.search) でも実効性を確認
    for (const d of allDocs) {
      const documentsDoc = mock.getStoredDoc('documents', d.id);
      expect(documentsDoc.search?.tokenHash, `${d.id} が再 index されていない`).to.be.a('string');
    }
  });

  it('bulkWriter.close() が失敗しても BATCH_SUMMARY 監査ログとサマリー出力に到達し EXIT_PARTIAL_FAILURE を返す (code-review 2026-07-19 指摘)', async () => {
    const captured = stubAuditLoggingWithCapture('test');
    const mock = createFirestoreMock();
    const bulkWriter = mock.createBulkWriter();
    bulkWriter.close = async () => {
      throw new Error('simulated close failure');
    };

    const doc = { customerName: '成功顧客', status: 'processed', processedAt: { toDate: () => new Date() } };
    mock.seedDoc('documents', 'doc-ok', doc);

    const db: any = {
      collection: (name: string) => {
        if (name === 'documents') return createDocumentsQueryableCollection(mock, [{ id: 'doc-ok', data: doc }]);
        return mock.db.collection(name);
      },
      bulkWriter: () => bulkWriter,
      getAll: mock.db.getAll,
    };

    const exitCode = await forceReindex.runAllDrift(
      db,
      { execute: true, batchSize: 500, concurrency: 5, sample: null },
      { projectId: 'test', executedBy: 'tester' },
    );

    // 個別 doc 処理自体は成功 (reindexed=1) だが close() 失敗により EXIT_PARTIAL_FAILURE
    expect(exitCode).to.equal(forceReindex.EXIT_PARTIAL_FAILURE);
    // close() 失敗後も BATCH_SUMMARY 監査ログに到達している (旧実装は finally 内 throw で未到達だった)
    const batchSummary = captured.find((e) => e.event === 'force_reindex_batch_summary');
    expect(batchSummary, 'BATCH_SUMMARY audit log が送信されていない').to.exist;
    expect(batchSummary.counts.reindexed).to.equal(1);
    // close 失敗自体も別イベントとして記録される
    expect(captured.some((e) => e.event === 'force_reindex_bulkwriter_close_failed')).to.equal(true);
  });
});

/**
 * サイズ超過(1MiB)トークンのスキップ (Issue #984)
 *
 * search_index/{tokenId} が上限に達した高頻度トークンは書けないが、その書類の他トークンは登録する。
 * 復旧(--all-drift)が同じ失敗を繰り返さないため、トリガー(addDocumentToIndex)と同じ方針にする。
 * - search.tokens = 登録できたトークンのみ / search.skippedTokens = スキップ分 / search.tokenHash = 全トークン
 * - サイズ超過以外のエラーは従来どおり throw
 * - 既に posting がある token はサイズ超過で書けなくても索引に残っているので skipped にしない
 */
describe('force-reindex: reindexDocument (サイズ超過 token のスキップ, Issue #984)', () => {
  const sizeError = () => Object.assign(new Error('maximum entity size is 1048576 bytes'), { code: 3 });

  function failSetFor(bulkWriter: any, failingIds: Set<string>, makeError: () => Error) {
    const originalSet = bulkWriter.set.bind(bulkWriter);
    bulkWriter.set = async (ref: any, data: any, options?: any) => {
      if (ref.collectionName === 'search_index' && failingIds.has(ref.id)) throw makeError();
      return originalSet(ref, data, options);
    };
  }

  it('サイズ超過の token だけスキップし、他 token は登録。search メタは仕様どおりで、対象外フィールドは不変', async () => {
    const tokenizer = loadTokenizer();
    const mock = createFirestoreMock();
    const bulkWriter = mock.createBulkWriter();
    const doc = {
      customerName: 'スキップ確認顧客', officeName: 'スキップ確認事業所', fileName: 'skip.pdf',
      displayFileName: 'keep-me.pdf', status: 'processed',
    };
    mock.seedDoc('documents', 'docHot', doc);
    const plan = forceReindex.planReindex('docHot', doc, tokenizer);
    expect(plan.tokenMap.size).to.be.greaterThan(2);
    const hotId = [...plan.tokenMap.keys()][0] as string;
    failSetFor(bulkWriter, new Set([hotId]), sizeError);

    const result = await forceReindex.reindexDocument(mock.db, 'docHot', doc, { execute: true, bulkWriter });

    const hotStrings = [...new Set<string>(plan.newTokenStrings.filter((t: string) => tokenizer.generateTokenId(t) === hotId))];
    const stored = mock.getStoredDoc('documents', 'docHot');
    expect(stored.search.tokens).to.deep.equal(
      plan.newTokenStrings.filter((t: string) => tokenizer.generateTokenId(t) !== hotId)
    );
    expect(stored.search.skippedTokens).to.deep.equal(hotStrings);
    expect(stored.search.tokenHash, 'tokenHash は全トークンのハッシュ').to.equal(plan.tokenHash);
    expect(result.tokensSkipped).to.equal(hotStrings.length);

    // Partial Update: search.* 以外のフィールドは不変(CLAUDE.md MUST)
    expect(stored.displayFileName).to.equal('keep-me.pdf');
    expect(stored.customerName).to.equal(doc.customerName);
    expect(stored.status).to.equal('processed');

    // スキップした token の search_index は作られず、他 token は登録される
    expect(mock.getStoredDoc('search_index', hotId)).to.equal(undefined);
    for (const id of [...plan.tokenMap.keys()].filter((k) => k !== hotId)) {
      const idx = mock.getStoredDoc('search_index', id);
      expect(idx.postings.docHot).to.exist;
      expect(idx.df).to.equal(1);
    }
  });

  it('サイズ超過以外のエラーは従来どおり throw し、search メタは更新されない', async () => {
    const tokenizer = loadTokenizer();
    const mock = createFirestoreMock();
    const bulkWriter = mock.createBulkWriter();
    const doc = { customerName: '非サイズ失敗顧客', officeName: '非サイズ失敗事業所', fileName: 'nonsize.pdf' };
    mock.seedDoc('documents', 'docErr', doc);
    const plan = forceReindex.planReindex('docErr', doc, tokenizer);
    const failingId = [...plan.tokenMap.keys()][0] as string;
    failSetFor(bulkWriter, new Set([failingId]), () => Object.assign(new Error('permission denied'), { code: 7 }));

    let caught: any = null;
    try {
      await forceReindex.reindexDocument(mock.db, 'docErr', doc, { execute: true, bulkWriter });
    } catch (error) {
      caught = error;
    }
    expect(caught).to.exist;
    expect(caught.reindexStage).to.equal('search_index_postings_write');
    expect(mock.getStoredDoc('documents', 'docErr').search, 'step 3 に進まない').to.equal(undefined);
  });

  it('サイズ超過と非サイズ失敗が混在する場合は throw し(非サイズ失敗を隠さない)、サイズ超過だけを skipped 扱いにしない', async () => {
    const tokenizer = loadTokenizer();
    const mock = createFirestoreMock();
    const bulkWriter = mock.createBulkWriter();
    const doc = { customerName: '混在顧客名', officeName: '混在事業所', fileName: 'mixed.pdf' };
    mock.seedDoc('documents', 'docMix', doc);
    const plan = forceReindex.planReindex('docMix', doc, tokenizer);
    const ids = [...plan.tokenMap.keys()] as string[];
    const originalSet = bulkWriter.set.bind(bulkWriter);
    bulkWriter.set = async (ref: any, data: any, options?: any) => {
      if (ref.collectionName === 'search_index' && ref.id === ids[0]) throw sizeError();
      if (ref.collectionName === 'search_index' && ref.id === ids[1]) {
        throw Object.assign(new Error('unavailable'), { code: 14 });
      }
      return originalSet(ref, data, options);
    };

    let caught: any = null;
    try {
      await forceReindex.reindexDocument(mock.db, 'docMix', doc, { execute: true, bulkWriter });
    } catch (error) {
      caught = error;
    }
    expect(caught).to.exist;
    expect(caught.code).to.equal(14);
    expect(mock.getStoredDoc('documents', 'docMix').search).to.equal(undefined);
  });

  it('スキップが無い場合は search.skippedTokens を付けず、既存の skippedTokens は削除される', async () => {
    const mock = createFirestoreMock();
    const bulkWriter = mock.createBulkWriter();
    const doc = {
      customerName: '過去スキップ顧客', officeName: '過去スキップ事業所', fileName: 'oldskip.pdf',
      // futureField: 今回の書込み対象ではない search.* 内の兄弟フィールド。dot 記法の Partial Update なら不変
      // (search オブジェクト全体を置換する回帰が入ると消える。CLAUDE.md MUST)
      search: { version: 1, tokens: [], tokenHash: 'stale', skippedTokens: ['old-hot-token'], futureField: 'keep-me' },
    };
    mock.seedDoc('documents', 'docOld', doc);
    const plan = forceReindex.planReindex('docOld', doc, loadTokenizer());

    await forceReindex.reindexDocument(mock.db, 'docOld', doc, { execute: true, bulkWriter });

    const stored = mock.getStoredDoc('documents', 'docOld');
    expect(stored.search).to.not.have.property('skippedTokens');
    expect(stored.search.tokens, '全トークンが登録された').to.deep.equal(plan.newTokenStrings);
    expect(stored.search.futureField, 'search.* 内の対象外フィールドは不変').to.equal('keep-me');
  });

  it('既に posting がある token はサイズ超過で書けなくても skipped にせず search.tokens に残す', async () => {
    const tokenizer = loadTokenizer();
    const mock = createFirestoreMock();
    const bulkWriter = mock.createBulkWriter();
    const doc = { customerName: '既存posting顧客', officeName: '既存posting事業所', fileName: 'kept.pdf' };
    mock.seedDoc('documents', 'docKept', doc);
    const plan = forceReindex.planReindex('docKept', doc, tokenizer);
    const hotId = [...plan.tokenMap.keys()][0] as string;
    mock.seedDoc('search_index', hotId, { df: 1, postings: { docKept: { score: 1, fieldsMask: 1 } } });
    failSetFor(bulkWriter, new Set([hotId]), sizeError);

    const result = await forceReindex.reindexDocument(mock.db, 'docKept', doc, { execute: true, bulkWriter });

    const stored = mock.getStoredDoc('documents', 'docKept');
    expect(stored.search).to.not.have.property('skippedTokens');
    expect(stored.search.tokens).to.deep.equal(plan.newTokenStrings);
    expect(result.tokensSkipped).to.equal(0);
  });
});

describe('force-reindex: reindexDocument (サイズ超過の境界・衝突・旧書式, Issue #984)', () => {
  const sizeError = () => Object.assign(new Error('maximum entity size is 1048576 bytes'), { code: 3 });

  function failSetFor(bulkWriter: any, failingIds: Set<string>) {
    const originalSet = bulkWriter.set.bind(bulkWriter);
    bulkWriter.set = async (ref: any, data: any, options?: any) => {
      if (ref.collectionName === 'search_index' && failingIds.has(ref.id)) throw sizeError();
      return originalSet(ref, data, options);
    };
  }

  it('全トークンがサイズ超過でも resolve し、search.tokens=[] / skippedTokens=全件 / tokenHash=全ハッシュ', async () => {
    const tokenizer = loadTokenizer();
    const mock = createFirestoreMock();
    const bulkWriter = mock.createBulkWriter();
    const doc = { customerName: '全飽和顧客', officeName: '全飽和事業所', fileName: 'allhot.pdf' };
    mock.seedDoc('documents', 'docAllHot', doc);
    const plan = forceReindex.planReindex('docAllHot', doc, tokenizer);
    failSetFor(bulkWriter, new Set(plan.tokenMap.keys() as Iterable<string>));

    const result = await forceReindex.reindexDocument(mock.db, 'docAllHot', doc, { execute: true, bulkWriter });

    const stored = mock.getStoredDoc('documents', 'docAllHot');
    expect(stored.search.tokens).to.deep.equal([]);
    expect([...stored.search.skippedTokens].sort()).to.deep.equal([...new Set<string>(plan.newTokenStrings)].sort());
    expect(stored.search.tokenHash).to.equal(plan.tokenHash);
    expect(result.tokensSkipped).to.equal(stored.search.skippedTokens.length);
  });

  it('tokenId が衝突する別文字列("Aa" と "BB")は、片方が飽和すれば両方を skippedTokens に入れ、tokens に残さない(1:N 逆引き)', async () => {
    const real = loadTokenizer();
    // planReindex / computeExpectedIndex は tokenizer を引数で受けるため、固定の衝突ペアを返す偽 tokenizer を注入する
    const tokenizer = {
      ...real,
      generateDocumentTokens: () => [
        { token: 'Aa', field: 'customer', weight: 10 },
        { token: 'BB', field: 'office', weight: 8 },
        { token: 'other', field: 'fileName', weight: 5 },
      ],
    };
    const collidingId = real.generateTokenId('Aa');
    expect(real.generateTokenId('BB'), '前提: 衝突する').to.equal(collidingId);
    const mock = createFirestoreMock();
    const bulkWriter = mock.createBulkWriter();
    const doc = { customerName: 'x', fileName: 'collide.pdf' };
    mock.seedDoc('documents', 'docCollide', doc);
    failSetFor(bulkWriter, new Set([collidingId]));

    await forceReindex.reindexDocument(mock.db, 'docCollide', doc, { execute: true, bulkWriter }, tokenizer);

    const stored = mock.getStoredDoc('documents', 'docCollide');
    expect(stored.search.skippedTokens).to.deep.equal(['Aa', 'BB']);
    expect(stored.search.tokens).to.deep.equal(['other']);
  });

  it('旧書式(ルート直下の postings.<docId>)の既存 posting でも df を再加算しない(トリガー側 hasPostingFor と同じ判定)', async () => {
    const tokenizer = loadTokenizer();
    const mock = createFirestoreMock();
    const bulkWriter = mock.createBulkWriter();
    const doc = { customerName: '旧書式顧客', officeName: '旧書式事業所', fileName: 'legacy.pdf' };
    mock.seedDoc('documents', 'docLegacy', doc);
    const plan = forceReindex.planReindex('docLegacy', doc, tokenizer);
    const legacyId = [...plan.tokenMap.keys()][0] as string;
    // 旧 addDocumentToIndex が set({[`postings.${docId}`]: ...}, {merge:true}) で作った、文字どおりのフィールド名
    mock.seedDoc('search_index', legacyId, { df: 1, 'postings.docLegacy': { score: 1, fieldsMask: 1 } });

    await forceReindex.reindexDocument(mock.db, 'docLegacy', doc, { execute: true, bulkWriter });

    expect(mock.getStoredDoc('search_index', legacyId).df, '旧書式でも既存 posting とみなし df は増えない').to.equal(1);
  });

  it('旧書式の既存 posting があるトークンは、サイズ超過で書けなくても skipped にせず search.tokens に残す', async () => {
    const tokenizer = loadTokenizer();
    const mock = createFirestoreMock();
    const bulkWriter = mock.createBulkWriter();
    const doc = { customerName: '旧書式skip顧客', officeName: '旧書式skip事業所', fileName: 'legacyskip.pdf' };
    mock.seedDoc('documents', 'docLegacy2', doc);
    const plan = forceReindex.planReindex('docLegacy2', doc, tokenizer);
    const hotId = [...plan.tokenMap.keys()][0] as string;
    mock.seedDoc('search_index', hotId, { df: 1, 'postings.docLegacy2': { score: 1, fieldsMask: 1 } });
    failSetFor(bulkWriter, new Set([hotId]));

    const result = await forceReindex.reindexDocument(mock.db, 'docLegacy2', doc, { execute: true, bulkWriter });

    const stored = mock.getStoredDoc('documents', 'docLegacy2');
    expect(stored.search).to.not.have.property('skippedTokens');
    expect(stored.search.tokens).to.deep.equal(plan.newTokenStrings);
    expect(result.tokensSkipped).to.equal(0);
  });
});

describe('scripts/lib/loadFirestoreErrors: 古い functions/lib のガード (Issue #984)', () => {
  it('判定関数が無い(古いビルドの)モジュールは、原因が分かるエラーで即時停止する', () => {
    expect(() => assertFirestoreErrorsModule({})).to.throw(/functions.*build/);
    expect(() => assertFirestoreErrorsModule({ isFirestoreDocumentSizeExceededError: 'not-a-function' })).to.throw(/build/);
  });

  it('判定関数があるモジュールはそのまま返す', () => {
    const mod = { isFirestoreDocumentSizeExceededError: () => true };
    expect(assertFirestoreErrorsModule(mod)).to.equal(mod);
  });
});
