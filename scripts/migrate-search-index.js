#!/usr/bin/env node
/**
 * 検索インデックスマイグレーションスクリプト
 *
 * 既存のドキュメントに対して検索インデックスを生成し、
 * search_index コレクションに登録します。
 *
 * 使用方法:
 *   node scripts/migrate-search-index.js [--dry-run] [--batch-size=100] [--project=<project-id>]
 *
 * オプション:
 *   --dry-run       実際には書き込まず、処理内容を表示のみ
 *   --batch-size=N  バッチサイズ（デフォルト: 100）
 *   --project=ID    対象プロジェクトID（デフォルト: doc-split-dev）
 *
 * Issue #237 以降:
 *   - 従来は inline で tokenizer 関数を再実装していたが、BE tokenizer.ts との drift
 *     を防ぐため scripts/lib/loadTokenizer.js + scripts/lib/aggregateTokens.js 経由で
 *     BE の compiled lib/ を参照する。
 *   - 旧実装は generateTokenId に md5 16 文字 hex を使用していた。本版は BE と同じ
 *     32bit simple hash 8 文字 hex。search_index の doc ID が変わるが、production
 *     trigger (searchIndexer.ts) が書き直すため既存データへの実害なし。
 *   - 日付トークンは旧 8 形式 → BE 版 3 形式 (YYYY / YYYY-MM / YYYY-MM-DD)。
 */

const admin = require('firebase-admin');
const { loadTokenizer, ensureTokenizerBuilt } = require('./lib/loadTokenizer');
const { aggregateTokensByTokenId } = require('./lib/aggregateTokens');

// コマンドライン引数パース
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const batchSizeArg = args.find(a => a.startsWith('--batch-size='));
const batchSize = batchSizeArg ? parseInt(batchSizeArg.split('=')[1], 10) : 100;
const projectArg = args.find(a => a.startsWith('--project='));
const projectId = projectArg ? projectArg.split('=')[1] : 'doc-split-dev';

// CLI 実行時のみ build を強制。test (require) 時は呼び出し側に委ねる。
if (require.main === module) {
  ensureTokenizerBuilt();
}

// BE tokenizer module (functions/src/utils/tokenizer.ts の compiled lib/)
// CLI 実行時は ensureTokenizerBuilt() で lib/ の存在が保証されているが、
// test からの require 時は lib/ が未生成だと throw する (意図的)。
const tokenizer = loadTokenizer();

// Firebase Admin 初期化
admin.initializeApp({
  projectId,
});

const db = admin.firestore();

// ========== マイグレーション処理 ==========

async function migrateSearchIndex() {
  console.log('=== 検索インデックスマイグレーション ===');
  console.log(`プロジェクト: ${projectId}`);
  console.log(`バッチサイズ: ${batchSize}`);
  console.log(`ドライラン: ${dryRun ? 'はい' : 'いいえ'}`);
  console.log('');

  let processedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  let lastDoc = null;

  // インデックス更新のキャッシュ（df重複更新防止）
  const indexUpdates = new Map();

  while (true) {
    // status === 'processed' のドキュメントのみ対象（オンライン処理と統一）
    // 既存インデックス（status + processedAt）を使用
    let query = db.collection('documents')
      .where('status', '==', 'processed')
      .orderBy('processedAt', 'desc')
      .limit(batchSize);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();

    if (snapshot.empty) {
      break;
    }

    console.log(`バッチ処理中: ${snapshot.docs.length}件`);

    for (const docSnapshot of snapshot.docs) {
      const docId = docSnapshot.id;
      const docData = docSnapshot.data();

      try {
        // 既にインデックス済みの場合はスキップ
        if (docData.search?.tokenHash) {
          console.log(`  [SKIP] ${docId}: インデックス済み`);
          skippedCount++;
          continue;
        }

        // BE tokenizer でトークン生成 (TokenInfo[])
        // fileDate は Firestore Timestamp → Date に変換してから渡す
        const fileDate = docData.fileDate?.toDate?.() ?? null;
        const tokens = tokenizer.generateDocumentTokens({
          customerName: docData.customerName ?? null,
          officeName: docData.officeName ?? null,
          documentType: docData.documentType ?? null,
          fileDate,
          fileName: docData.fileName ?? null,
        });

        if (tokens.length === 0) {
          console.log(`  [SKIP] ${docId}: トークンなし`);
          skippedCount++;
          continue;
        }

        // tokenId ごとに集約 (searchIndexer.ts:addDocumentToIndex と同等ロジック)
        const tokenMap = aggregateTokensByTokenId(tokens, tokenizer.generateTokenId);
        const tokensHash = tokenizer.generateTokensHash(tokens);

        if (dryRun) {
          console.log(`  [DRY] ${docId}: ${tokenMap.size}トークン生成予定`);
          console.log(`         顧客: ${docData.customerName || '-'}, 事業所: ${docData.officeName || '-'}`);
          processedCount++;
          continue;
        }

        // search_indexに書き込み（postings形式 - オンライン処理と統一）
        const now = admin.firestore.Timestamp.now();

        for (const [tokenId, data] of tokenMap.entries()) {
          const indexRef = db.collection('search_index').doc(tokenId);

          // df更新を集約（同一tokenIdへの複数回更新を防止）
          const prevDelta = indexUpdates.get(tokenId) || 0;
          indexUpdates.set(tokenId, prevDelta + 1);

          // ドキュメントの存在確認して適切な方法で書き込み
          const indexDoc = await indexRef.get();
          const posting = {
            score: data.score,
            fieldsMask: data.fieldsMask,
            updatedAt: now,
          };

          if (!indexDoc.exists) {
            // 新規作成: postingsをネストされたオブジェクトとして設定
            await indexRef.set({
              updatedAt: now,
              df: 1,
              postings: { [docId]: posting },
            });
          } else {
            // 更新: updateメソッドでドット表記を使用（ネストとして解釈される）
            await indexRef.update({
              updatedAt: now,
              df: admin.firestore.FieldValue.increment(1),
              [`postings.${docId}`]: posting,
            });
          }
        }

        // ドキュメントに検索メタデータを記録（オンライン処理と統一）
        await db.collection('documents').doc(docId).update({
          search: {
            version: 1,
            tokens: tokens.map(t => t.token),
            tokenHash: tokensHash,
            indexedAt: admin.firestore.Timestamp.now(),
          },
        });

        console.log(`  [OK] ${docId}: ${tokenMap.size}トークン登録`);
        processedCount++;

      } catch (error) {
        console.error(`  [ERROR] ${docId}: ${error.message}`);
        errorCount++;
      }
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
  }

  console.log('');
  console.log('=== マイグレーション完了 ===');
  console.log(`処理済み: ${processedCount}件`);
  console.log(`スキップ: ${skippedCount}件`);
  console.log(`エラー: ${errorCount}件`);
  console.log(`ユニークトークン数: ${indexUpdates.size}件`);

  // マイグレーション状態を記録
  if (!dryRun) {
    await db.collection('_migrations').doc('search_index').set({
      status: 'completed',
      processedCount,
      skippedCount,
      errorCount,
      uniqueTokens: indexUpdates.size,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log('マイグレーション状態を _migrations/search_index に記録しました');
  }
}

// 実行 (CLI 起動時のみ)
if (require.main === module) {
  migrateSearchIndex()
    .then(() => {
      console.log('');
      console.log('スクリプト終了');
      process.exit(0);
    })
    .catch((error) => {
      console.error('致命的エラー:', error);
      process.exit(1);
    });
}

// test 用に内部 helper を露出 (副作用のない pure 関数のみ)
module.exports = {
  migrateSearchIndex,
};
