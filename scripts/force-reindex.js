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

// CLI 実行時のみ build を強制。test (require) 時は呼び出し側に委ねる。
if (require.main === module) {
  ensureTokenizerBuilt();
}

const admin = require('firebase-admin');

// ========== Step 2: 引数パース (pure function) ==========

function parseArgs(argv) {
  const args = {
    docId: null,
    allDrift: false,
    execute: false,
    sample: null,
    batchSize: 500,
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
  --batch-size=<n>      バッチサイズ (デフォルト 500)
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
// FIELD_TO_MASK と集約ロジックは scripts/lib/aggregateTokens.js に集約 (Issue #237)。

/**
 * 指定 docId の search_index を強制再構築する。
 * tokenHash 無視で以下を実行:
 *   1. 既存 posting (search.tokens が示す位置) を削除
 *   2. 新 posting を書き込み (再実行安全: 既存 posting 存在時は df 加算しない)
 *   3. documents.search を dot 記法で Partial Update
 *
 * エラーポリシー:
 *   - NOT_FOUND: 冪等な無視 (旧 posting が既に削除済み)
 *   - その他の永続/一時エラー: throw して呼び出し元の failedCount に集計
 *     (silent に続行すると tokenHash だけ更新され次回 scan で検出不能になる
 *      ため、本 PR の目的と逆行する。PR #235 review 指摘対応)
 *
 * 厳密な冪等ではない境界:
 *   - 手動で search_index から posting を削除した状態で 2 回実行すると df が負になる
 *   - 並列実行は未対応 (Runbook で禁止明記)
 */
async function reindexDocument(db, docId, docData, { execute }, tokenizer = loadTokenizer()) {
  const { tokens, tokenHash } = computeExpectedIndex(docData, tokenizer);
  const oldTokens = docData.search?.tokens || [];
  const newTokenStrings = tokens.map(t => t.token);
  const tokensToRemove = oldTokens.filter(t => !newTokenStrings.includes(t));

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

  const now = admin.firestore.Timestamp.now();

  // 1. 旧 posting 削除: NOT_FOUND を事前 filter で除外してから batch。
  //    事前 filter にすることで「1 件 NOT_FOUND → batch 全体ロールバック」を回避する
  //    (PR #235 review evaluator HIGH 指摘対応)。
  if (tokensToRemove.length > 0) {
    const removeTokenIds = tokensToRemove.map(t => tokenizer.generateTokenId(t));
    const removeRefs = removeTokenIds.map(id => db.collection('search_index').doc(id));
    const removeSnaps = await db.getAll(...removeRefs);
    const removeBatch = db.batch();
    let removeCount = 0;
    for (let i = 0; i < removeSnaps.length; i++) {
      const snap = removeSnaps[i];
      // 既に posting が無い (NOT_FOUND 相当) なら skip
      if (!snap.exists || snap.data()?.postings?.[docId] === undefined) continue;
      removeBatch.update(snap.ref, {
        [`postings.${docId}`]: admin.firestore.FieldValue.delete(),
        df: admin.firestore.FieldValue.increment(-1),
      });
      removeCount++;
    }
    if (removeCount > 0) {
      // 事前 filter 後の batch 失敗は permanent error の可能性大 → throw で呼び出し元へ
      await removeBatch.commit();
    }
  }

  // 2. 新 posting 書き込み (同一 docId 再実行時は df を加算しない)
  //    集約ロジックは scripts/lib/aggregateTokens.js を経由 (migrate-search-index.js と共有)
  const tokenMap = aggregateTokensByTokenId(tokens, tokenizer.generateTokenId);

  const tokenIds = Array.from(tokenMap.keys());
  const indexRefs = tokenIds.map(id => db.collection('search_index').doc(id));
  const existingDocs = tokenIds.length > 0 ? await db.getAll(...indexRefs) : [];
  const existingSet = new Set(existingDocs.filter(d => d.exists).map(d => d.id));

  const writeBatch = db.batch();
  for (const [tokenId, data] of tokenMap) {
    const indexRef = db.collection('search_index').doc(tokenId);
    const posting = { score: data.score, fieldsMask: data.fieldsMask, updatedAt: now };
    // 再実行安全: 既に posting が存在するなら df 加算しない
    const existingDoc = existingDocs.find(d => d.id === tokenId);
    const hadPosting = existingDoc?.data()?.postings?.[docId] !== undefined;

    if (existingSet.has(tokenId)) {
      writeBatch.update(indexRef, {
        updatedAt: now,
        ...(hadPosting ? {} : { df: admin.firestore.FieldValue.increment(1) }),
        [`postings.${docId}`]: posting,
      });
    } else {
      writeBatch.set(indexRef, {
        updatedAt: now,
        df: 1,
        postings: { [docId]: posting },
      });
    }
  }
  // step 2/3 の失敗時に呼出元が stage を特定できるよう error を wrap する。
  // 半端状態 (postings 新しいが tokenHash 古い) 発生時は
  // Runbook §4.5 に基づき手動クリーンアップする (silent-failure-hunter MEDIUM 指摘対応)。
  try {
    await writeBatch.commit();
  } catch (error) {
    error.reindexStage = 'search_index_postings_write';
    throw error;
  }

  // 3. documents.search を dot 記法で Partial Update
  //    search オブジェクト全体置換にすると将来追加フィールドが消える
  //    (CLAUDE.md MUST: Partial Update は対象外フィールド不変)。
  try {
    await db.collection('documents').doc(docId).update({
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

// ========== Step 5: モード実行 ==========

/** exit code: 0=成功、1=事前検証エラー、2=部分失敗あり。main() で process.exit に反映。 */
const EXIT_OK = 0;
const EXIT_PRECONDITION = 1;
const EXIT_PARTIAL_FAILURE = 2;

async function runSingleDocId(db, args) {
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
  try {
    const result = await reindexDocument(db, args.docId, data, { execute: args.execute });
    console.log(
      `  [${args.execute ? 'OK' : 'DRY'}] ${result.docId}: ` +
      `+${result.tokensToAdd} / -${result.tokensToRemove} tokens, ` +
      `hash ${result.actualHash || '(none)'} → ${result.expectedHash}`
    );
    return EXIT_OK;
  } catch (error) {
    // 構造化ログ (GitHub Actions 経由 Cloud Logging 取込用)
    console.error(JSON.stringify({
      severity: 'ERROR',
      event: 'force_reindex_failed',
      docId: args.docId,
      stage: error.reindexStage ?? null,
      errorCode: error.code ?? null,
      errorMessage: error.message,
      stack: error.stack,
    }));
    return EXIT_PARTIAL_FAILURE;
  }
}

async function runAllDrift(db, args) {
  console.log(`[MODE] 全 drift scan (${args.execute ? '実行' : 'dry-run'})` +
    (args.sample ? `, sample=${args.sample}` : ''));

  let processed = 0;
  let drifted = 0;
  let reindexed = 0;
  let failed = 0;
  let lastDoc = null;
  const maxDocs = args.sample ?? Infinity;

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

    for (const docSnap of snapshot.docs) {
      processed++;
      const data = docSnap.data();
      const drift = detectDrift(data);
      if (!drift.isDrifted) continue;

      drifted++;
      console.log(
        `  [DRIFT] ${docSnap.id}: hash ${drift.actualHash || '(none)'} → ${drift.expectedHash}`
      );

      if (args.execute) {
        try {
          await reindexDocument(db, docSnap.id, data, { execute: true });
          reindexed++;
          console.log(`    [OK] 再 index 完了`);
        } catch (error) {
          failed++;
          // 構造化ログで呼出元が個別失敗を監査可能にする (PR #235 review silent-failure-hunter 指摘対応)
          console.error(JSON.stringify({
            severity: 'ERROR',
            event: 'force_reindex_failed',
            docId: docSnap.id,
            stage: error.reindexStage ?? null,
            errorCode: error.code ?? null,
            errorMessage: error.message,
            stack: error.stack,
          }));
        }
      }
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.docs.length < limit) break;
  }

  console.log('---');
  console.log(`走査: ${processed} 件 / drift: ${drifted} 件 / 再 index: ${reindexed} 件 / 失敗: ${failed} 件`);
  return failed > 0 ? EXIT_PARTIAL_FAILURE : EXIT_OK;
}

// ========== Step 6: main ==========

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[ERROR] ${error.message}`);
    printHelp();
    process.exit(1);
  }

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    console.error('[ERROR] FIREBASE_PROJECT_ID 環境変数が未設定です');
    process.exit(1);
  }

  admin.initializeApp({ projectId });
  const db = admin.firestore();

  console.log(`プロジェクト: ${projectId}`);
  console.log(`モード: ${args.execute ? '実行 (書き込みあり)' : 'dry-run (書き込みなし)'}`);

  let exitCode = EXIT_OK;
  if (args.docId) {
    exitCode = await runSingleDocId(db, args);
  } else if (args.allDrift) {
    exitCode = await runAllDrift(db, args);
  }
  return exitCode;
}

// テスト時は main 呼び出しをスキップ
if (require.main === module) {
  main()
    .then((exitCode) => {
      console.log(exitCode === EXIT_OK ? '完了' : `部分失敗で終了 (exit code=${exitCode})`);
      process.exit(exitCode);
    })
    .catch((error) => {
      console.error(JSON.stringify({
        severity: 'CRITICAL',
        event: 'force_reindex_fatal',
        errorCode: error.code ?? null,
        errorMessage: error.message,
        stack: error.stack,
      }));
      process.exit(1);
    });
}

module.exports = {
  parseArgs,
  computeExpectedIndex,
  detectDrift,
  reindexDocument,
};
