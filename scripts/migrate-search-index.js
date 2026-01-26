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
 */

const admin = require('firebase-admin');
const crypto = require('crypto');

// コマンドライン引数パース
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const batchSizeArg = args.find(a => a.startsWith('--batch-size='));
const batchSize = batchSizeArg ? parseInt(batchSizeArg.split('=')[1], 10) : 100;
const projectArg = args.find(a => a.startsWith('--project='));
const projectId = projectArg ? projectArg.split('=')[1] : 'doc-split-dev';

// Firebase Admin 初期化
admin.initializeApp({
  projectId,
});

const db = admin.firestore();

// ========== トークナイザー（functions/src/utils/tokenizer.ts から移植）==========

/**
 * 検索用にテキストを正規化
 */
function normalizeForSearch(text) {
  if (!text) return '';

  let normalized = text;

  // 全角英数字を半角に
  normalized = normalized.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) =>
    String.fromCharCode(s.charCodeAt(0) - 0xFEE0)
  );

  // 全角スペースを半角に
  normalized = normalized.replace(/　/g, ' ');

  // 小文字化
  normalized = normalized.toLowerCase();

  // 連続スペースを単一に
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

/**
 * bi-gramトークンを生成
 */
function generateBigrams(text) {
  const normalized = normalizeForSearch(text);
  if (normalized.length < 2) {
    return normalized.length === 1 ? [normalized] : [];
  }

  const bigrams = new Set();
  for (let i = 0; i < normalized.length - 1; i++) {
    const bigram = normalized.slice(i, i + 2);
    // スペースのみのbi-gramは除外
    if (bigram.trim().length > 0) {
      bigrams.add(bigram);
    }
  }

  return Array.from(bigrams);
}

/**
 * キーワードトークンを生成（スペース区切り）
 */
function generateKeywords(text) {
  const normalized = normalizeForSearch(text);
  if (!normalized) return [];

  // スペースで分割して2文字以上のものを抽出
  const words = normalized.split(' ').filter(w => w.length >= 2);

  return Array.from(new Set(words));
}

/**
 * 日付トークンを生成
 */
function generateDateTokens(date) {
  if (!date) return [];

  const tokens = [];
  let dateObj;

  if (date instanceof admin.firestore.Timestamp) {
    dateObj = date.toDate();
  } else if (date instanceof Date) {
    dateObj = date;
  } else if (typeof date === 'string') {
    dateObj = new Date(date);
  } else {
    return [];
  }

  if (isNaN(dateObj.getTime())) return [];

  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');

  // 各種形式のトークン
  tokens.push(`${year}`);               // 2024
  tokens.push(`${year}${month}`);       // 202401
  tokens.push(`${year}${month}${day}`); // 20240115
  tokens.push(`${year}/${month}`);      // 2024/01
  tokens.push(`${year}/${month}/${day}`); // 2024/01/15
  tokens.push(`${month}/${day}`);       // 01/15

  return tokens;
}

/**
 * フィールド重み付け
 */
const FIELD_WEIGHTS = {
  customerName: 3,
  officeName: 2,
  documentType: 2,
  fileDate: 2,
  fileName: 1,
};

/**
 * ドキュメントから検索トークンを生成
 */
function generateDocumentTokens(doc) {
  const tokens = {};

  // 顧客名
  if (doc.customerName) {
    const bigrams = generateBigrams(doc.customerName);
    const keywords = generateKeywords(doc.customerName);
    [...bigrams, ...keywords].forEach(token => {
      if (!tokens[token]) {
        tokens[token] = { fields: [], weight: 0 };
      }
      tokens[token].fields.push('customerName');
      tokens[token].weight = Math.max(tokens[token].weight, FIELD_WEIGHTS.customerName);
    });
  }

  // 事業所名
  if (doc.officeName) {
    const bigrams = generateBigrams(doc.officeName);
    const keywords = generateKeywords(doc.officeName);
    [...bigrams, ...keywords].forEach(token => {
      if (!tokens[token]) {
        tokens[token] = { fields: [], weight: 0 };
      }
      tokens[token].fields.push('officeName');
      tokens[token].weight = Math.max(tokens[token].weight, FIELD_WEIGHTS.officeName);
    });
  }

  // 書類種別
  if (doc.documentType) {
    const bigrams = generateBigrams(doc.documentType);
    const keywords = generateKeywords(doc.documentType);
    [...bigrams, ...keywords].forEach(token => {
      if (!tokens[token]) {
        tokens[token] = { fields: [], weight: 0 };
      }
      tokens[token].fields.push('documentType');
      tokens[token].weight = Math.max(tokens[token].weight, FIELD_WEIGHTS.documentType);
    });
  }

  // 日付
  if (doc.fileDate) {
    const dateTokens = generateDateTokens(doc.fileDate);
    dateTokens.forEach(token => {
      if (!tokens[token]) {
        tokens[token] = { fields: [], weight: 0 };
      }
      tokens[token].fields.push('fileDate');
      tokens[token].weight = Math.max(tokens[token].weight, FIELD_WEIGHTS.fileDate);
    });
  }

  // ファイル名
  if (doc.fileName) {
    const bigrams = generateBigrams(doc.fileName);
    const keywords = generateKeywords(doc.fileName);
    [...bigrams, ...keywords].forEach(token => {
      if (!tokens[token]) {
        tokens[token] = { fields: [], weight: 0 };
      }
      tokens[token].fields.push('fileName');
      tokens[token].weight = Math.max(tokens[token].weight, FIELD_WEIGHTS.fileName);
    });
  }

  return tokens;
}

/**
 * トークンIDを生成（正規化したトークン値のハッシュ）
 */
function generateTokenId(token) {
  const normalized = normalizeForSearch(token);
  return crypto.createHash('md5').update(normalized).digest('hex').slice(0, 16);
}

/**
 * ドキュメントのトークンハッシュを生成（冪等性チェック用）
 */
function generateTokensHash(tokens) {
  const sortedTokens = Object.keys(tokens).sort().join('|');
  return crypto.createHash('md5').update(sortedTokens).digest('hex');
}

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

  while (true) {
    // ドキュメント取得
    let query = db.collection('documents')
      .orderBy('createdAt', 'desc')
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
        // トークン生成
        const tokens = generateDocumentTokens(docData);
        const tokenCount = Object.keys(tokens).length;

        if (tokenCount === 0) {
          console.log(`  [SKIP] ${docId}: トークンなし`);
          skippedCount++;
          continue;
        }

        const tokensHash = generateTokensHash(tokens);

        if (dryRun) {
          console.log(`  [DRY] ${docId}: ${tokenCount}トークン生成予定`);
          console.log(`         顧客: ${docData.customerName || '-'}, 事業所: ${docData.officeName || '-'}`);
          processedCount++;
          continue;
        }

        // search_indexに書き込み
        const batch = db.batch();

        for (const [token, data] of Object.entries(tokens)) {
          const tokenId = generateTokenId(token);
          const indexRef = db.collection('search_index').doc(tokenId);

          // 既存のドキュメントを取得
          const existingDoc = await indexRef.get();

          if (existingDoc.exists) {
            // 既存トークンに追加
            const existingData = existingDoc.data();
            const existingDocs = existingData.documents || [];

            // 重複チェック
            const alreadyExists = existingDocs.some(d => d.docId === docId);
            if (!alreadyExists) {
              batch.update(indexRef, {
                documents: admin.firestore.FieldValue.arrayUnion({
                  docId,
                  weight: data.weight,
                  fields: data.fields,
                }),
                documentCount: admin.firestore.FieldValue.increment(1),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              });
            }
          } else {
            // 新規トークン作成
            batch.set(indexRef, {
              token,
              documents: [{
                docId,
                weight: data.weight,
                fields: data.fields,
              }],
              documentCount: 1,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          }
        }

        // ドキュメントにハッシュを記録（冪等性用）
        batch.update(db.collection('documents').doc(docId), {
          searchTokensHash: tokensHash,
          searchIndexedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        await batch.commit();

        console.log(`  [OK] ${docId}: ${tokenCount}トークン登録`);
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

  // マイグレーション状態を記録
  if (!dryRun) {
    await db.collection('_migrations').doc('search_index').set({
      status: 'completed',
      processedCount,
      skippedCount,
      errorCount,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log('マイグレーション状態を _migrations/search_index に記録しました');
  }
}

// 実行
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
