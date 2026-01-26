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

const db = getFirestore();

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
    memory: '256MiB',
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
 */
async function addDocumentToIndex(docId: string, tokens: TokenInfo[]): Promise<void> {
  const batch = db.batch();
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

  // バッチ書き込み
  for (const [tokenId, data] of tokenMap) {
    const indexRef = db.collection('search_index').doc(tokenId);
    batch.set(
      indexRef,
      {
        updatedAt: now,
        [`postings.${docId}`]: {
          score: data.score,
          fieldsMask: data.fieldsMask,
          updatedAt: now,
        },
      },
      { merge: true }
    );
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
    // ドキュメントが存在しない場合は無視
    console.warn(`Failed to remove tokens from index for ${docId}:`, error);
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
