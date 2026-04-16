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
 * lib/ が存在しない場合、スクリプトは自動的に build を試みる。
 */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

// ========== Step 1: tokenizer のロード (production と同一実装を利用) ==========

const TOKENIZER_PATH = path.resolve(
  __dirname,
  '../functions/lib/functions/src/utils/tokenizer.js'
);

function ensureTokenizerBuilt() {
  if (fs.existsSync(TOKENIZER_PATH)) return;
  console.log('[BUILD] functions/lib/ が未生成のため build を実行します...');
  // execFileSync: shell を介さないため引数注入リスクなし
  execFileSync('npm', ['run', 'build'], {
    cwd: path.resolve(__dirname, '../functions'),
    stdio: 'inherit',
  });
  if (!fs.existsSync(TOKENIZER_PATH)) {
    console.error(`[FATAL] build 後も tokenizer が見つかりません: ${TOKENIZER_PATH}`);
    process.exit(1);
  }
}

// CLI 実行時のみ build を強制。test (require) 時は呼び出し側に委ねる。
if (require.main === module) {
  ensureTokenizerBuilt();
}

function loadTokenizer() {
  ensureTokenizerBuilt();
  return require(TOKENIZER_PATH);
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
      // 互換性: --dry-run はデフォルト動作。--execute が指定されない限り書き込まない。
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

const FIELD_TO_MASK = {
  customer: 1,
  office: 2,
  documentType: 4,
  fileName: 8,
  date: 16,
};

/**
 * 指定 docId の search_index を強制再構築する。
 * tokenHash 無視で以下を実行:
 *   1. 既存 posting (search.tokens が示す位置) を削除
 *   2. 新 posting を書き込み (冪等: 既存 posting 存在時は df 加算しない)
 *   3. documents.search を更新
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

  // 1. 旧 posting 削除 (search.tokens から差分のみ)
  if (tokensToRemove.length > 0) {
    const removeBatch = db.batch();
    for (const token of tokensToRemove) {
      const tokenId = tokenizer.generateTokenId(token);
      const indexRef = db.collection('search_index').doc(tokenId);
      removeBatch.update(indexRef, {
        [`postings.${docId}`]: admin.firestore.FieldValue.delete(),
        df: admin.firestore.FieldValue.increment(-1),
      });
    }
    try {
      await removeBatch.commit();
    } catch (error) {
      // NOT_FOUND は冪等 (既に削除済み)、その他は記録だけして続行
      if (error.code !== 5 && error.code !== 'NOT_FOUND' && error.code !== 'not-found') {
        console.warn(`  [WARN] ${docId}: 旧 posting 削除失敗 (code=${error.code}): ${error.message}`);
      }
    }
  }

  // 2. 新 posting 書き込み (冪等性のため posting を完全置換)
  const tokenMap = new Map();
  for (const { token, field, weight } of tokens) {
    const tokenId = tokenizer.generateTokenId(token);
    const existing = tokenMap.get(tokenId);
    if (existing) {
      existing.score += weight;
      existing.fieldsMask |= FIELD_TO_MASK[field];
    } else {
      tokenMap.set(tokenId, { score: weight, fieldsMask: FIELD_TO_MASK[field] });
    }
  }

  const tokenIds = Array.from(tokenMap.keys());
  const indexRefs = tokenIds.map(id => db.collection('search_index').doc(id));
  const existingDocs = tokenIds.length > 0 ? await db.getAll(...indexRefs) : [];
  const existingSet = new Set(existingDocs.filter(d => d.exists).map(d => d.id));

  const writeBatch = db.batch();
  for (const [tokenId, data] of tokenMap) {
    const indexRef = db.collection('search_index').doc(tokenId);
    const posting = { score: data.score, fieldsMask: data.fieldsMask, updatedAt: now };
    // 冪等性: 既に posting が存在するなら df 加算しない
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
  await writeBatch.commit();

  // 3. documents.search 更新
  await db.collection('documents').doc(docId).update({
    search: {
      version: 1,
      tokens: newTokenStrings,
      tokenHash,
      indexedAt: admin.firestore.Timestamp.now(),
    },
  });

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

async function runSingleDocId(db, args) {
  const docRef = db.collection('documents').doc(args.docId);
  const snap = await docRef.get();
  if (!snap.exists) {
    console.error(`[ERROR] ドキュメントが見つかりません: ${args.docId}`);
    process.exit(1);
  }
  const data = snap.data();
  if (data.status !== 'processed') {
    console.warn(`[WARN] ${args.docId}: status=${data.status}。processed 以外はインデックス対象外のため中止`);
    process.exit(1);
  }

  console.log(`[MODE] 単一 docId (${args.execute ? '実行' : 'dry-run'}): ${args.docId}`);
  const result = await reindexDocument(db, args.docId, data, { execute: args.execute });
  console.log(
    `  [${args.execute ? 'OK' : 'DRY'}] ${result.docId}: ` +
    `+${result.tokensToAdd} / -${result.tokensToRemove} tokens, ` +
    `hash ${result.actualHash || '(none)'} → ${result.expectedHash}`
  );
}

async function runAllDrift(db, args) {
  console.log(`[MODE] 全 drift scan (${args.execute ? '実行' : 'dry-run'})` +
    (args.sample ? `, sample=${args.sample}` : ''));

  let processed = 0;
  let drifted = 0;
  let reindexed = 0;
  let lastDoc = null;
  const maxDocs = args.sample ?? Infinity;

  while (processed < maxDocs) {
    const remaining = maxDocs - processed;
    const limit = Math.min(args.batchSize, remaining);
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
          console.error(`    [ERROR] 再 index 失敗: ${error.message}`);
        }
      }
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.docs.length < limit) break;
  }

  console.log('---');
  console.log(`走査: ${processed} 件 / drift: ${drifted} 件 / 再 index: ${reindexed} 件`);
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

  if (args.docId) {
    await runSingleDocId(db, args);
  } else if (args.allDrift) {
    await runAllDrift(db, args);
  }
}

// テスト時は main 呼び出しをスキップ
if (require.main === module) {
  main()
    .then(() => {
      console.log('完了');
      process.exit(0);
    })
    .catch((error) => {
      console.error('[FATAL]', error);
      process.exit(1);
    });
}

module.exports = {
  parseArgs,
  computeExpectedIndex,
  detectDrift,
  reindexDocument,
};
