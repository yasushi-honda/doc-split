/**
 * 検索インデックス更新トリガー
 *
 * Firestoreドキュメント変更時に検索インデックスを自動更新
 * - ドキュメント作成/更新時: インデックス追加/更新
 * - ドキュメント削除時: インデックス削除
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import {
  generateDocumentTokens,
  generateTokenId,
  generateTokensHash,
  type TokenField,
  type TokenInfo,
} from '../utils/tokenizer';
import { isFirestoreNotFoundError } from '../utils/firestoreErrors';
import { chunkArray } from '../utils/chunkArray';

const db = getFirestore();

/**
 * db.getAll(...indexRefs) を一度に大量実行するとピークメモリが膨らむため
 * (Issue #217、kanameone 512MiB OOM 201件既発)、この件数単位で逐次取得する。
 *
 * 1 doc あたりのトークン数上限は MAX_TOKENS_PER_FIELD(20) × 4 フィールド
 * (customer/office/documentType/fileName) + 日付少数 ≈ 84 件(tokenizer.ts)。
 * 10 は実測ではなく初期値であり、複製flag ON後にchunkサイズ・メモリ使用量を
 * 観測して妥当性を再評価する(GOAL.md AC-e参照)。
 */
const GET_ALL_CHUNK_SIZE = 10;

/** フィールドからマスクへの変換 */
const FIELD_TO_MASK: Record<TokenField, number> = {
  customer: 1,
  office: 2,
  documentType: 4,
  fileName: 8,
  date: 16,
};

/**
 * ドキュメント変更時に検索インデックスを更新
 */
export const onDocumentWriteSearchIndex = onDocumentWritten(
  {
    document: 'documents/{docId}',
    region: 'asia-northeast1',
    // Issue #217: 256MiB では db.getAll(...indexRefs) 時に境界を越えOOM頻発 (kanameone 04-14 12回+, 04-15 5回)。
    // 応急で 512MiB に増強。本質対応 (getAll chunk化) は GET_ALL_CHUNK_SIZE 導入で実施済み
    // (複数顧客FAX複製機能の前提整備、docs/handoff/GOAL.md参照)。複製flag ON後にchunkサイズ・
    // メモリ使用量を再実測し、本設定の妥当性(縮小余地の有無)を評価する。
    memory: '512MiB',
    timeoutSeconds: 60,
  },
  async (event) => {
    const docId = event.params.docId;
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();

    // 削除の場合
    if (!after) {
      if (before?.search?.tokens) {
        await removeDocumentFromIndex(docId, before.search.tokens);
        console.log(`Search index removed for document: ${docId}`);
      }
      return;
    }

    // 処理完了したドキュメントのみインデックス更新
    if (after.status !== 'processed') {
      return;
    }

    // トークン生成
    const fileDate = after.fileDate?.toDate?.() || null;
    const tokens = generateDocumentTokens({
      customerName: after.customerName || null,
      officeName: after.officeName || null,
      documentType: after.documentType || null,
      fileDate,
      fileName: after.fileName || null,
    });

    if (tokens.length === 0) {
      return;
    }

    // ハッシュで変更チェック（idempotent）
    const newHash = generateTokensHash(tokens);
    const oldHash = before?.search?.tokenHash || null;

    if (newHash === oldHash) {
      console.log(`Search index unchanged for document: ${docId}`);
      return;
    }

    // 古いトークンを削除
    if (before?.search?.tokens) {
      const oldTokens = before.search.tokens as string[];
      const newTokenStrings = tokens.map(t => t.token);
      const tokensToRemove = oldTokens.filter(t => !newTokenStrings.includes(t));
      if (tokensToRemove.length > 0) {
        await removeTokensFromIndex(docId, tokensToRemove);
      }
    }

    // 新しいトークンをインデックスに追加
    await addDocumentToIndex(docId, tokens);

    // ドキュメントに検索メタデータを保存（idempotent用）
    await db.doc(`documents/${docId}`).update({
      search: {
        version: 1,
        tokens: tokens.map(t => t.token),
        tokenHash: newHash,
        indexedAt: Timestamp.now(),
      },
    });

    console.log(`Search index updated for document: ${docId}, tokens: ${tokens.length}`);
  }
);

/**
 * ドキュメントを検索インデックスに追加
 * (integration test から直接呼び出せるよう export。トリガー本体からの呼び出しは不変)
 */
export async function addDocumentToIndex(docId: string, tokens: TokenInfo[]): Promise<void> {
  const now = Timestamp.now();

  // トークンごとに集約
  const tokenMap = new Map<string, { score: number; fieldsMask: number }>();

  for (const { token, field, weight } of tokens) {
    const tokenId = generateTokenId(token);
    const existing = tokenMap.get(tokenId);
    if (existing) {
      existing.score += weight;
      existing.fieldsMask |= FIELD_TO_MASK[field];
    } else {
      tokenMap.set(tokenId, {
        score: weight,
        fieldsMask: FIELD_TO_MASK[field],
      });
    }
  }

  // 既存ドキュメントをチャンク単位で取得（ピークメモリ抑制、Issue #217）
  const tokenIds = Array.from(tokenMap.keys());
  const indexRefs = tokenIds.map(id => db.collection('search_index').doc(id));
  const existingSet = new Set<string>();
  for (const refChunk of chunkArray(indexRefs, GET_ALL_CHUNK_SIZE)) {
    const existingDocs = await db.getAll(...refChunk);
    for (const d of existingDocs) {
      if (d.exists) existingSet.add(d.id);
    }
  }

  // バッチ書き込み（新規と既存を分けて処理）
  const batch = db.batch();

  for (const [tokenId, data] of tokenMap) {
    const indexRef = db.collection('search_index').doc(tokenId);
    const posting = {
      score: data.score,
      fieldsMask: data.fieldsMask,
      updatedAt: now,
    };

    if (existingSet.has(tokenId)) {
      // 既存: updateでドット表記を使用（ネストとして解釈される）
      batch.update(indexRef, {
        updatedAt: now,
        df: FieldValue.increment(1),
        [`postings.${docId}`]: posting,
      });
    } else {
      // 新規: setでpostingsをネストされたオブジェクトとして設定
      batch.set(indexRef, {
        updatedAt: now,
        df: 1,
        postings: { [docId]: posting },
      });
    }
  }

  await batch.commit();
}

/**
 * ドキュメントを検索インデックスから削除
 */
async function removeDocumentFromIndex(docId: string, tokens: string[]): Promise<void> {
  await removeTokensFromIndex(docId, tokens);
}

/**
 * 特定のトークンからドキュメントを削除
 */
async function removeTokensFromIndex(docId: string, tokens: string[]): Promise<void> {
  const batch = db.batch();

  for (const token of tokens) {
    const tokenId = generateTokenId(token);
    const indexRef = db.collection('search_index').doc(tokenId);
    batch.update(indexRef, {
      [`postings.${docId}`]: FieldValue.delete(),
      df: FieldValue.increment(-1),
    });
  }

  try {
    await batch.commit();
  } catch (error) {
    if (isFirestoreNotFoundError(error)) {
      // インデックスエントリ不在は冪等な削除として正常扱い (既削除/未作成いずれも該当)
      console.warn(`Search index entry not found while removing tokens for ${docId} (idempotent skip)`);
      return;
    }
    // Firestore権限/ネットワーク/クォータ等の障害は ERROR として残し監視/アラート対象化する
    console.error(`Failed to remove tokens from search index for ${docId}:`, error);
  }
}

/**
 * dfを更新（初回インデックス作成用）
 */
export async function updateDocumentFrequency(tokenId: string, delta: number): Promise<void> {
  const indexRef = db.collection('search_index').doc(tokenId);
  await indexRef.update({
    df: FieldValue.increment(delta),
  });
}
