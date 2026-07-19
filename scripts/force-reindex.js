#!/usr/bin/env node
/**
 * search_index drift 復旧スクリプト (ADR-0015 Follow-up, Issue #229)
 *
 * 既存の `migrate-search-index.js` は `tokenHash` 済みドキュメントをスキップするため、
 * ADR-0015 で想定される drift パターン (tokenHash は更新済みだが search_index 側の
 * 削除/更新が silent failure した状態) を修復できない。
 *
 * 本スクリプトは tokenHash を無視して search_index を強制再構築する。
 *
 * 使用方法:
 *   FIREBASE_PROJECT_ID=<project> node scripts/force-reindex.js --doc-id <id> [--execute]
 *   FIREBASE_PROJECT_ID=<project> node scripts/force-reindex.js --all-drift [--execute]
 *   FIREBASE_PROJECT_ID=<project> node scripts/force-reindex.js --all-drift --sample=10
 *
 * デフォルトは dry-run (書き込みなし)。ADR-0008 データ保護方針により
 * 明示的な `--execute` フラグなしでは書き込みを行わない。
 *
 * production tokenizer (functions/src/utils/tokenizer.ts) と同一のロジックを使用する
 * ため、事前に `cd functions && npm run build` で lib/ を生成しておく必要がある。
 * CLI 起動時は自動 build を試みるが、テストから require する場合は事前に
 * build しておくこと (test は `loadTokenizer()` のデフォルト引数で間接的に lib/ を要求する)。
 */

// ========== Step 1: tokenizer のロード (production と同一実装を利用) ==========
// Issue #237 で scripts/lib/loadTokenizer.js に共通化 (migrate-search-index.js と共有)。
// BE tokenizer.ts の compiled lib/ を参照することで drift を防止する。
const { loadTokenizer, ensureTokenizerBuilt } = require('./lib/loadTokenizer');
const { aggregateTokensByTokenId } = require('./lib/aggregateTokens');
const {
  writeForceReindexAuditLog,
  flushAndCloseLogging,
  EVENTS,
  SEVERITIES,
} = require('./lib/auditLogger');

/**
 * 失敗イベントを stdout JSON (GitHub Actions 調査用) と
 * Cloud Logging audit (事後監査用) の両 sink に出力する SSoT。
 *
 * @param {Object} params
 * @param {Function} [params.loggingFactory] - test 用 DI: auditLogger 経由で injection
 */
async function emitFailureEvent({
  event, severity, mode, docId, error, dryRun, auditCtx, loggingFactory,
}) {
  console.error(JSON.stringify({
    severity,
    event,
    docId: docId ?? null,
    stage: error?.reindexStage ?? null,
    errorCode: error?.code ?? null,
    errorMessage: error?.message,
    stack: error?.stack,
  }));
  await writeForceReindexAuditLog(
    { event, severity, mode, dryRun, docId, error },
    auditCtx,
    loggingFactory ? { loggingFactory } : undefined,
  );
}

// CLI 実行時のみ build を強制。test (require) 時は呼び出し側に委ねる。
if (require.main === module) {
  ensureTokenizerBuilt();
}

const admin = require('firebase-admin');

// ========== Step 2: 引数パース (pure function) ==========

/** --all-drift --execute 時の docId 並行処理数のデフォルト値。
 *  Codex plan review 2026-07-19: ホット token (同一 tokenId への同時更新集中) の
 *  ABORTED retry・性能悪化リスクを踏まえ保守的な値から開始し、--concurrency で調整可能にする。 */
const DEFAULT_CONCURRENCY = 5;

function parseArgs(argv) {
  const args = {
    docId: null,
    allDrift: false,
    execute: false,
    sample: null,
    batchSize: 500,
    concurrency: DEFAULT_CONCURRENCY,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--doc-id') {
      args.docId = argv[++i];
      if (!args.docId || args.docId.startsWith('--')) {
        throw new Error('--doc-id には値が必要です');
      }
    } else if (arg === '--all-drift') {
      args.allDrift = true;
    } else if (arg === '--execute') {
      args.execute = true;
    } else if (arg.startsWith('--sample=')) {
      args.sample = parseInt(arg.split('=')[1], 10);
      if (!Number.isFinite(args.sample) || args.sample <= 0) {
        throw new Error('--sample には正の整数を指定してください');
      }
    } else if (arg.startsWith('--batch-size=')) {
      args.batchSize = parseInt(arg.split('=')[1], 10);
      if (!Number.isFinite(args.batchSize) || args.batchSize <= 0) {
        throw new Error('--batch-size には正の整数を指定してください');
      }
    } else if (arg.startsWith('--concurrency=')) {
      args.concurrency = parseInt(arg.split('=')[1], 10);
      if (!Number.isFinite(args.concurrency) || args.concurrency <= 0) {
        throw new Error('--concurrency には正の整数を指定してください');
      }
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--dry-run') {
      // 明示目的のみの受付。デフォルトが dry-run のため動作には影響しない。
    } else {
      throw new Error(`未知のオプション: ${arg}`);
    }
  }

  if (!args.help) {
    if (!args.docId && !args.allDrift) {
      throw new Error('--doc-id または --all-drift のいずれかを指定してください');
    }
    if (args.docId && args.allDrift) {
      throw new Error('--doc-id と --all-drift は同時指定できません');
    }
  }

  return args;
}

function printHelp() {
  console.log(`
search_index drift 復旧スクリプト (ADR-0015 / Issue #229)

使用方法:
  FIREBASE_PROJECT_ID=<project> node scripts/force-reindex.js <mode> [options]

モード (いずれか必須):
  --doc-id <id>         特定ドキュメントを tokenHash 無視で再 index 化
  --all-drift           documents 全体を scan し tokenHash 差分を検出

オプション:
  --execute             実書き込みを行う (未指定時は dry-run)
  --sample=<n>          --all-drift 時に先頭 n 件のみ処理 (部分検証用)
  --batch-size=<n>      Firestore クエリのページング件数 (デフォルト 500。
                        並行処理数とは別軸、--concurrency 参照)
  --concurrency=<n>     --all-drift --execute 時の docId 並行処理数
                        (デフォルト ${DEFAULT_CONCURRENCY}。ホット token への書込み集中を避けるため
                        大きくしすぎない)
  --help, -h            このヘルプを表示

環境変数:
  FIREBASE_PROJECT_ID   対象プロジェクト ID (必須)
`);
}

// ========== Step 3: pure helpers (テスト対象) ==========

/**
 * ドキュメントから期待される tokens と tokenHash を計算する。
 *
 * production の `onDocumentWriteSearchIndex` trigger と同一ロジック
 * (functions/src/search/searchIndexer.ts:62-77 と対応)。
 */
function computeExpectedIndex(docData, tokenizer = loadTokenizer()) {
  const fileDate = docData.fileDate?.toDate
    ? docData.fileDate.toDate()
    : docData.fileDate instanceof Date
      ? docData.fileDate
      : null;
  const tokens = tokenizer.generateDocumentTokens({
    customerName: docData.customerName || null,
    officeName: docData.officeName || null,
    documentType: docData.documentType || null,
    fileDate,
    fileName: docData.fileName || null,
  });
  const tokenHash = tokenizer.generateTokensHash(tokens);
  return { tokens, tokenHash };
}

/**
 * documents レコードが drift しているか判定。
 * - search.tokenHash が未設定 → drift (未 index)
 * - tokenHash が再計算値と不一致 → drift
 */
function detectDrift(docData, tokenizer = loadTokenizer()) {
  const expected = computeExpectedIndex(docData, tokenizer);
  const actual = docData.search?.tokenHash || null;
  const isDrifted = actual === null || actual !== expected.tokenHash;
  return {
    isDrifted,
    expectedHash: expected.tokenHash,
    actualHash: actual,
    expectedTokens: expected.tokens,
  };
}

// ========== Step 4: Firestore 操作 ==========

/**
 * ドキュメントの再 index 化に必要な計算 (tokens/tokenHash/削除対象/集約) を
 * 副作用なしで算出する。
 *
 * aggregateTokensByTokenId の invariant 違反 (プログラマエラー) はここで throw される。
 * 呼び出し側 (runAllDrift) は書き込み開始前にページ内全件をこの関数で計算しきることで、
 * systemic error 検知時に「まだ何も書き込んでいない」状態を保証できる
 * (Codex plan review 2026-07-19 指摘: 旧実装は posting 削除後に集約していたため、
 *  systemic error のドキュメントでも削除だけ済んでしまう余地があった)。
 */
function planReindex(docId, docData, tokenizer = loadTokenizer()) {
  const { tokens, tokenHash } = computeExpectedIndex(docData, tokenizer);
  const oldTokens = docData.search?.tokens || [];
  const newTokenStrings = tokens.map(t => t.token);
  // 重複排除必須 (code-review 2026-07-19 指摘): oldTokens は customerName/officeName 等
  // 複数フィールドから同一トークン文字列が生成された場合に重複を含みうる。重複したまま
  // tokensToRemove を使うと、同一 search_index doc への df:increment(-1) が2重に enqueue
  // され、emulator 実証済みの通り Firestore は同一 batch/BulkWriter 内の複数 transform を
  // 累積適用するため df が過剰に減算される (silent data corruption)。
  const tokensToRemove = [...new Set(oldTokens.filter(t => !newTokenStrings.includes(t)))];
  const tokenMap = aggregateTokensByTokenId(tokens, tokenizer.generateTokenId);
  return { docId, tokens, tokenHash, newTokenStrings, tokensToRemove, tokenMap };
}

/**
 * Promise 群を allSettled で drain し、1件でも失敗があれば reindexStage を付けて throw する。
 * Promise.all だと最初の失敗で即 reject し、他の enqueue 済み write の結果を捕捉できないため
 * (BulkWriter は各 write が独立した Promise を返し、batch のような一括ロールバックがない)。
 *
 * 複数件が同時に失敗した場合、代表エラー (先頭) だけでなく失敗件数をメッセージに集約する。
 * 旧実装は最初の1件のみを throw していたため、診断ログ (audit log の errorMessage) 上で
 * 実際の失敗 scope が過小評価されていた (code-review 2026-07-19 指摘)。書込み自体は
 * settleOrThrow 呼び出し時点で全 write が試行済みのため drop されない
 * (idempotent retry で収束する。詳細: Runbook §4.5)。
 */
async function settleOrThrow(promises, defaultStage) {
  const results = await Promise.allSettled(promises);
  const failures = results.filter(r => r.status === 'rejected').map(r => r.reason);
  if (failures.length === 0) return;

  if (failures.length === 1) {
    const error = failures[0];
    error.reindexStage = error.reindexStage || defaultStage;
    throw error;
  }

  const primary = failures[0];
  const aggregated = new Error(
    `${failures.length} 件の書込みが失敗しました (代表: ${primary?.message ?? String(primary)})`,
  );
  aggregated.reindexStage = defaultStage;
  aggregated.code = primary?.code;
  aggregated.cause = primary;
  throw aggregated;
}

/**
 * 指定 docId の search_index を強制再構築する (BulkWriter 版)。
 * tokenHash 無視で以下を実行:
 *   1. 既存 posting (search.tokens が示す位置) を削除
 *   2. 新 posting を書き込み (再実行安全: 既存 posting 存在時は df 加算しない)
 *   3. documents.search を dot 記法で Partial Update
 *
 * BulkWriter 移行の設計 (Codex plan review 2026-07-19 反映):
 *   - 同一 DocumentReference への 2 回目以降の書き込みは、1 回目の完了を待たずに
 *     別バッチとして送信され順序は保証されない (googleapis/nodejs-firestore 実装挙動)。
 *     そのため段階間 (削除→書込→documents更新) は各段階の Promise を明示的に待ってから
 *     次段階に進むことで、同一 docId 内の順序性を保証する。
 *   - 新 posting 書き込みは既存有無で set/update を分岐せず、`merge: true` の set に統一。
 *     異なる docId が同一の未作成 tokenId へ並行して書き込んでも、Firestore 側で
 *     postings map と df (server-side increment) が正しく合成される
 *     (旧実装の非 merge set は並行実行で後着が前着の postings を消す risk があった)。
 *   - 各段階は Promise.allSettled() で全 write を drain してから成否判定する
 *     (Promise.all は最初の失敗で即 reject し、他の enqueue 済み write の結果を
 *      捕捉できないため)。
 *
 * エラーポリシー:
 *   - NOT_FOUND: 冪等な無視 (旧 posting が既に削除済み)
 *   - その他の永続/一時エラー: throw して呼び出し元の failedCount に集計
 *     (silent に続行すると tokenHash だけ更新され次回 scan で検出不能になるため、
 *      本スクリプトの目的と逆行する)
 *
 * 厳密な冪等ではない境界:
 *   - 手動で search_index から posting を削除した状態で 2 回実行すると df が負になる
 *   - 同一 docId への cross-process 同時実行は未対応 (Runbook で単一起動を明記)
 *
 * @param {Object} opts
 * @param {Object} [opts.plan] - 呼び出し元が事前に planReindex() で計算済みの plan
 *   (runAllDrift はページ全件を書き込み前に検証するため必ず渡す)。未指定時はここで
 *   計算する (runSingleDocId や単体呼び出し用)。事前計算済み plan を再利用することで
 *   systemic error 検証時の plan と実際に書き込む plan が同一オブジェクトになることを
 *   保証する (二重計算による乖離・CPU 浪費を防ぐ、code-review 2026-07-19 指摘)。
 */
async function reindexDocument(db, docId, docData, { execute, bulkWriter, plan } = {}, tokenizer = loadTokenizer()) {
  const resolvedPlan = plan || planReindex(docId, docData, tokenizer);
  const { tokens, tokenHash, newTokenStrings, tokensToRemove, tokenMap } = resolvedPlan;

  if (!execute) {
    return {
      docId,
      tokensToAdd: tokens.length,
      tokensToRemove: tokensToRemove.length,
      expectedHash: tokenHash,
      actualHash: docData.search?.tokenHash || null,
      skipped: false,
    };
  }

  if (!bulkWriter) {
    throw new Error('reindexDocument: execute=true には bulkWriter が必須です');
  }

  const now = admin.firestore.Timestamp.now();

  // 削除対象・新規書込み対象の ref を先に構築する。両者は disjoint (tokensToRemove は
  // newTokenStrings に含まれないトークンのみ) で互いに依存しないため、getAll を並列実行する
  // (code-review 2026-07-19 指摘: 旧実装は逐次 await していた)。
  const removeTokenIds = tokensToRemove.map(t => tokenizer.generateTokenId(t));
  const removeRefs = removeTokenIds.map(id => db.collection('search_index').doc(id));
  const tokenIds = Array.from(tokenMap.keys());
  const indexRefs = tokenIds.map(id => db.collection('search_index').doc(id));

  const [removeSnaps, existingDocs] = await Promise.all([
    removeRefs.length > 0 ? db.getAll(...removeRefs) : Promise.resolve([]),
    indexRefs.length > 0 ? db.getAll(...indexRefs) : Promise.resolve([]),
  ]);
  // O(1) ルックアップ用 Map (旧実装の existingDocs.find() は tokenMap サイズに対し O(n²)
  // になっていた、code-review 2026-07-19 指摘)
  const existingById = new Map(existingDocs.map(d => [d.id, d]));

  // 1. 旧 posting 削除: NOT_FOUND を事前 filter で除外してから enqueue。
  //    事前 filter にすることで「1 件 NOT_FOUND → 全体失敗」を回避する。
  if (removeSnaps.length > 0) {
    const removePromises = [];
    for (let i = 0; i < removeSnaps.length; i++) {
      const snap = removeSnaps[i];
      // 既に posting が無い (NOT_FOUND 相当) なら skip
      if (!snap.exists || snap.data()?.postings?.[docId] === undefined) continue;
      removePromises.push(
        bulkWriter.update(snap.ref, {
          [`postings.${docId}`]: admin.firestore.FieldValue.delete(),
          df: admin.firestore.FieldValue.increment(-1),
        }),
      );
    }
    await settleOrThrow(removePromises, 'search_index_postings_remove');
  }

  // 2. 新 posting 書き込み (再実行安全: 既に posting が存在するなら df 加算しない)。
  //    集約ロジックは scripts/lib/aggregateTokens.js を経由 (migrate-search-index.js と共有)
  const writePromises = [];
  for (const [tokenId, data] of tokenMap) {
    const indexRef = db.collection('search_index').doc(tokenId);
    const posting = { score: data.score, fieldsMask: data.fieldsMask, updatedAt: now };
    const existingDoc = existingById.get(tokenId);
    const hadPosting = existingDoc?.data()?.postings?.[docId] !== undefined;

    writePromises.push(
      bulkWriter.set(
        indexRef,
        {
          updatedAt: now,
          ...(hadPosting ? {} : { df: admin.firestore.FieldValue.increment(1) }),
          postings: { [docId]: posting },
        },
        { merge: true },
      ),
    );
  }
  // 半端状態 (postings 一部/全部新しいが tokenHash 古い) 発生時は
  // Runbook §4.5 に基づき手動クリーンアップ or 再実行する。
  await settleOrThrow(writePromises, 'search_index_postings_write');

  // 3. documents.search を dot 記法で Partial Update
  //    search オブジェクト全体置換にすると将来追加フィールドが消える
  //    (CLAUDE.md MUST: Partial Update は対象外フィールド不変)。
  try {
    await bulkWriter.update(db.collection('documents').doc(docId), {
      'search.version': 1,
      'search.tokens': newTokenStrings,
      'search.tokenHash': tokenHash,
      'search.indexedAt': admin.firestore.Timestamp.now(),
    });
  } catch (error) {
    // step 2 成功後に step 3 が失敗 → postings 新しいが tokenHash 古い半端状態
    error.reindexStage = 'documents_search_update';
    throw error;
  }

  return {
    docId,
    tokensToAdd: tokens.length,
    tokensToRemove: tokensToRemove.length,
    expectedHash: tokenHash,
    actualHash: docData.search?.tokenHash || null,
    skipped: false,
  };
}

/**
 * 外部依存 (p-limit 等) を追加しない自前の bounded worker pool。
 * items を concurrency 件まで同時実行し、1 件完了するたびに次を取り出す。
 * 全件を一度に enqueue しない設計 (BulkWriter 自体のスロットリングとは独立に、
 * getAll・監査ログ生成量・ホット token への書き込み集中を制御するため)。
 */
async function runWithConcurrency(items, concurrency, worker) {
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      await worker(items[currentIndex], currentIndex);
    }
  }
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
}

// ========== Step 5: モード実行 ==========

/** exit code: 0=成功、1=事前検証エラー、2=部分失敗あり。main() で process.exit に反映。 */
const EXIT_OK = 0;
const EXIT_PRECONDITION = 1;
const EXIT_PARTIAL_FAILURE = 2;

/**
 * BulkWriter.close() を安全に呼ぶ。close() は enqueue 済み write を drain してから
 * 完了するため、失敗は「write が drop された」ではなく「drain 完了の確認ができなかった」
 * ことを意味する (各 write 自体は settleOrThrow で個別に成否判定済み)。
 * 失敗しても呼び出し元の処理結果 (exitCode 等) は握り潰さず、警告として記録した上で
 * true を返す (呼び出し元は exitCode を EXIT_PARTIAL_FAILURE に格上げする判断に使う)。
 * これにより close() 失敗時も BATCH_SUMMARY 等の事後ログ出力に必ず到達できる
 * (code-review 2026-07-19 指摘: 旧実装は finally 内 throw で summary 出力に未到達だった)。
 * @returns {Promise<boolean>} true なら close 失敗
 */
async function closeBulkWriterSafely(bulkWriter, mode, auditCtx) {
  if (!bulkWriter) return false;
  try {
    await bulkWriter.close();
    return false;
  } catch (closeError) {
    console.error(JSON.stringify({
      severity: SEVERITIES.WARNING,
      event: EVENTS.BULKWRITER_CLOSE_FAILED,
      mode,
      errorMessage: closeError?.message ?? String(closeError),
    }));
    await writeForceReindexAuditLog(
      { event: EVENTS.BULKWRITER_CLOSE_FAILED, severity: SEVERITIES.WARNING, mode, dryRun: false },
      auditCtx,
    );
    return true;
  }
}

async function runSingleDocId(db, args, auditCtx) {
  const docRef = db.collection('documents').doc(args.docId);
  const snap = await docRef.get();
  if (!snap.exists) {
    console.error(`[ERROR] ドキュメントが見つかりません: ${args.docId}`);
    return EXIT_PRECONDITION;
  }
  const data = snap.data();
  if (data.status !== 'processed') {
    console.warn(`[WARN] ${args.docId}: status=${data.status}。processed 以外はインデックス対象外のため中止`);
    return EXIT_PRECONDITION;
  }

  console.log(`[MODE] 単一 docId (${args.execute ? '実行' : 'dry-run'}): ${args.docId}`);
  const bulkWriter = args.execute ? db.bulkWriter() : null;
  let exitCode;
  try {
    const result = await reindexDocument(db, args.docId, data, { execute: args.execute, bulkWriter });
    console.log(
      `  [${args.execute ? 'OK' : 'DRY'}] ${result.docId}: ` +
      `+${result.tokensToAdd} / -${result.tokensToRemove} tokens, ` +
      `hash ${result.actualHash || '(none)'} → ${result.expectedHash}`
    );
    await writeForceReindexAuditLog(
      {
        event: EVENTS.EXECUTED,
        severity: SEVERITIES.NOTICE,
        mode: 'doc-id',
        dryRun: !args.execute,
        docId: result.docId,
        counts: { tokensAdded: result.tokensToAdd, tokensRemoved: result.tokensToRemove },
        hashes: { oldHash: result.actualHash || null, newHash: result.expectedHash },
      },
      auditCtx,
    );
    exitCode = EXIT_OK;
  } catch (error) {
    await emitFailureEvent({
      event: EVENTS.FAILED,
      severity: SEVERITIES.ERROR,
      mode: 'doc-id',
      docId: args.docId,
      error,
      dryRun: !args.execute,
      auditCtx,
    });
    exitCode = EXIT_PARTIAL_FAILURE;
  } finally {
    // BulkWriter インスタンスはこの関数内でのみ生成・使用するため一度だけ呼べばよい。
    const closeFailed = await closeBulkWriterSafely(bulkWriter, 'doc-id', auditCtx);
    if (closeFailed && exitCode === EXIT_OK) {
      exitCode = EXIT_PARTIAL_FAILURE;
    }
  }
  return exitCode;
}

async function runAllDrift(db, args, auditCtx) {
  console.log(`[MODE] 全 drift scan (${args.execute ? '実行' : 'dry-run'})` +
    (args.sample ? `, sample=${args.sample}` : '') +
    (args.execute ? `, concurrency=${args.concurrency}` : ''));

  let processed = 0;
  let drifted = 0;
  let reindexed = 0;
  let failed = 0;
  let lastDoc = null;
  const maxDocs = args.sample ?? Infinity;

  // execute 時のみ生成し、全ページで使い回す (BulkWriter は 500/50/5 ルールで
  // 自動スロットリングするため、実行全体で 1 インスタンスに集約する)。
  const bulkWriter = args.execute ? db.bulkWriter() : null;

  try {
    while (processed < maxDocs) {
      const remaining = maxDocs - processed;
      const limit = Math.min(args.batchSize, remaining);
      // 注: processedAt 欠如ドキュメントはこのクエリから除外される (Firestore 仕様)。
      // 既存運用で processedAt は書込必須のため許容。未設定が発生した場合は
      // 別途 `--doc-id` で個別復旧する。
      let query = db.collection('documents')
        .where('status', '==', 'processed')
        .orderBy('processedAt', 'desc')
        .limit(limit);
      if (lastDoc) query = query.startAfter(lastDoc);

      const snapshot = await query.get();
      if (snapshot.empty) break;

      const driftedInPage = [];
      for (const docSnap of snapshot.docs) {
        processed++;
        const data = docSnap.data();
        const drift = detectDrift(data);
        if (!drift.isDrifted) continue;

        drifted++;
        console.log(
          `  [DRIFT] ${docSnap.id}: hash ${drift.actualHash || '(none)'} → ${drift.expectedHash}`
        );
        driftedInPage.push({ docId: docSnap.id, data });
      }

      if (args.execute && driftedInPage.length > 0) {
        // systemic programmer error (aggregateTokens の unknown TokenField 等) を
        // 書き込み開始前にページ全件検証する。ここで throw すればこのページは
        // 書き込みゼロのまま中断できる (Codex plan review 2026-07-19 反映)。
        // drift を silent に隠すと force-reindex が部分完了で exit 0 に見え、
        // FIELD_TO_MASK の同期漏れ等の structural bug を見逃すため、全体中止する。
        let plans;
        try {
          plans = driftedInPage.map(({ docId, data }) => ({ docId, data, plan: planReindex(docId, data) }));
        } catch (error) {
          console.error(`[FATAL] aggregateTokens invariant violation during planning: ${error.message}`);
          throw error;
        }

        await runWithConcurrency(plans, args.concurrency, async ({ docId, data, plan }) => {
          try {
            // 事前検証済みの plan をそのまま渡す (二重計算防止 + 検証対象と実書込み対象の
            // 同一性保証、code-review 2026-07-19 指摘)。
            const result = await reindexDocument(db, docId, data, { execute: true, bulkWriter, plan });
            reindexed++;
            console.log(`    [OK] ${docId} 再 index 完了`);
            await writeForceReindexAuditLog(
              {
                event: EVENTS.EXECUTED,
                severity: SEVERITIES.NOTICE,
                mode: 'all-drift',
                dryRun: false,
                docId,
                counts: { tokensAdded: result.tokensToAdd, tokensRemoved: result.tokensToRemove },
                hashes: { oldHash: result.actualHash || null, newHash: result.expectedHash },
              },
              auditCtx,
            );
          } catch (error) {
            failed++;
            // 個別失敗を監査可能にする (silent 続行で次回 scan 検出不能になるのを防ぐ)
            await emitFailureEvent({
              event: EVENTS.FAILED,
              severity: SEVERITIES.ERROR,
              mode: 'all-drift',
              docId,
              error,
              dryRun: false,
              auditCtx,
            });
          }
        });
      }

      lastDoc = snapshot.docs[snapshot.docs.length - 1];
      if (snapshot.docs.length < limit) break;
    }
  } catch (error) {
    // systemic error (aggregateTokens invariant 違反等) は close() の成否に関わらず
    // 即座に中断する意図的な設計を維持する (サマリー出力には到達させない)。
    // close() 自体は必ず試み、成否に関わらず元の error を再 throw する。
    await closeBulkWriterSafely(bulkWriter, 'all-drift', auditCtx);
    throw error;
  }

  // close() が失敗しても、全 write は個別に settleOrThrow で成否判定済みのため、
  // ここで throw せずサマリー出力・監査ログには必ず到達させる
  // (code-review 2026-07-19 指摘: 旧実装は finally 内 close() throw で summary 出力に未到達だった)。
  if (await closeBulkWriterSafely(bulkWriter, 'all-drift', auditCtx)) {
    failed++;
  }

  console.log('---');
  console.log(`走査: ${processed} 件 / drift: ${drifted} 件 / 再 index: ${reindexed} 件 / 失敗: ${failed} 件`);

  await writeForceReindexAuditLog(
    {
      event: EVENTS.BATCH_SUMMARY,
      severity: failed > 0 ? SEVERITIES.WARNING : SEVERITIES.NOTICE,
      mode: 'all-drift',
      dryRun: !args.execute,
      counts: { processed, drifted, reindexed, failed },
    },
    auditCtx,
  );

  return failed > 0 ? EXIT_PARTIAL_FAILURE : EXIT_OK;
}

// ========== Step 6: main ==========

/** GitHub Actions では GITHUB_ACTOR、手動実行時は USER をフォールバック */
function buildAuditCtx(projectId) {
  return {
    projectId,
    executedBy: process.env.GITHUB_ACTOR || process.env.USER || 'unknown',
  };
}

async function main() {
  // projectId は parseArgs より先に検証する。理由: parseArgs throw 時にも
  // audit ctx を構築できるようにし、startup_failed event を Cloud Logging へ
  // 残せるようにするため (silent failure 防止)。
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    console.error('[ERROR] FIREBASE_PROJECT_ID 環境変数が未設定です');
    return EXIT_PRECONDITION;
  }
  const auditCtx = buildAuditCtx(projectId);

  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    await emitFailureEvent({
      event: EVENTS.STARTUP_FAILED,
      severity: SEVERITIES.ERROR,
      error,
      auditCtx,
    });
    printHelp();
    return EXIT_PRECONDITION;
  }

  if (args.help) {
    printHelp();
    return EXIT_OK;
  }

  admin.initializeApp({ projectId });
  const db = admin.firestore();

  console.log(`プロジェクト: ${projectId}`);
  console.log(`モード: ${args.execute ? '実行 (書き込みあり)' : 'dry-run (書き込みなし)'}`);

  let exitCode = EXIT_OK;
  if (args.docId) {
    exitCode = await runSingleDocId(db, args, auditCtx);
  } else if (args.allDrift) {
    exitCode = await runAllDrift(db, args, auditCtx);
  }
  return exitCode;
}

/**
 * CLI entrypoint の本体。テストから DI で mock 注入して invariant を lock-in する。
 * defaults は module-scope の関数を参照するため CLI 経由の挙動は不変。
 *
 * 保証する invariant:
 *   I1: process.exitCode は flushAndCloseLogging 呼び出しより先に設定する
 *       (flush throw でも exit code 反映を保証)
 *   I2: emitFailureEvent も try/catch で包む (FATAL audit log の silent loss 防止)
 *   I3: 初期値 EXIT_PRECONDITION は defensive fallback として保持。現行制御フローでは
 *       catch 先頭で EXIT_PARTIAL_FAILURE に上書きされるため observable ではないが、
 *       将来 runMain 呼出前に初期化処理が追加され throw された場合の安全側 default。
 *
 * process.exit() は in-flight gRPC を切断するため使用しない。
 * process.exitCode 設定 + Logging client gracefully close により event loop が
 * natural drain し audit 書き込みの完全性を保証する。
 */
async function runEntrypoint(deps = {}) {
  const {
    main: runMain = main,
    flushAndCloseLogging: flushFn = flushAndCloseLogging,
    emitFailureEvent: emitFailure = emitFailureEvent,
    buildAuditCtx: buildCtx = buildAuditCtx,
  } = deps;

  let exitCode = EXIT_PRECONDITION;
  try {
    exitCode = await runMain();
    console.log(exitCode === EXIT_OK ? '完了' : `部分失敗で終了 (exit code=${exitCode})`);
  } catch (error) {
    // main() 内のエラー (projectId 未設定 / parseArgs 失敗 / args.help) は
    // EXIT_PRECONDITION/EXIT_OK で return するため、ここに到達するのは
    // admin.initializeApp 以降に発生した未捕捉 async エラーに限られる
    exitCode = EXIT_PARTIAL_FAILURE;
    const projectId = process.env.FIREBASE_PROJECT_ID;
    if (projectId) {
      try {
        await emitFailure({
          event: EVENTS.FATAL,
          severity: SEVERITIES.CRITICAL,
          error,
          auditCtx: buildCtx(projectId),
        });
      } catch (emitErr) {
        // emitFailureEvent 自体の throw (JSON circular 等) を最低限 stderr に残す
        console.error(`fatal: emitFailureEvent failed: ${emitErr?.message ?? emitErr}`);
        console.error(`original error: ${error?.message ?? error}`);
      }
    } else {
      try {
        console.error(JSON.stringify({
          severity: SEVERITIES.CRITICAL,
          event: EVENTS.FATAL,
          errorCode: error?.code ?? null,
          errorMessage: error?.message ?? String(error),
          stack: error?.stack,
        }));
      } catch (stringifyErr) {
        // stringify throw 時も original error を surface (silent loss 防止)。
        // projectId 有り分岐の emit catch と対称な二行出力とし、
        // 最低限 operator が何が起きたか追跡可能にする。
        console.error(`fatal: error stringify failed: ${stringifyErr?.message}`);
        console.error(
          `original error: code=${error?.code ?? 'n/a'} message=${error?.message ?? String(error)}`,
        );
      }
    }
  } finally {
    // I1: exit code を flush より先に設定 (flush throw でも反映を保証)
    process.exitCode = exitCode;
    try {
      await flushFn();
    } catch (flushErr) {
      // flush 自体の throw は audit drop の強い示唆。exit code を強制的に失敗扱いに
      console.error(`fatal: flushAndCloseLogging failed: ${flushErr?.message ?? flushErr}`);
      if (process.exitCode === EXIT_OK) {
        process.exitCode = EXIT_PARTIAL_FAILURE;
      }
    }
  }
}

// テスト時は entrypoint 呼び出しをスキップ
if (require.main === module) {
  runEntrypoint();
}

module.exports = {
  parseArgs,
  computeExpectedIndex,
  detectDrift,
  planReindex,
  reindexDocument,
  runWithConcurrency,
  runSingleDocId,
  runAllDrift,
  emitFailureEvent,
  buildAuditCtx,
  runEntrypoint,
  DEFAULT_CONCURRENCY,
  EXIT_OK,
  EXIT_PRECONDITION,
  EXIT_PARTIAL_FAILURE,
};
