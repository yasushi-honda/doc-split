/**
 * マスターデータ操作 Callable Functions
 *
 * - addMasterAlias: マスターに許容表記（alias）を追加
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

/** マスタータイプ */
type MasterType = 'office' | 'customer' | 'document';

/** マスターコレクションパス */
const MASTER_COLLECTIONS: Record<MasterType, string> = {
  office: 'masters/offices/items',
  customer: 'masters/customers/items',
  document: 'masters/documents/items',
};

/**
 * マスターにエイリアス（許容表記）を追加
 *
 * リクエスト: {
 *   masterType: 'office' | 'customer' | 'document',
 *   masterId: string,
 *   alias: string
 * }
 * レスポンス: { success: boolean, aliases: string[] }
 */
export const addMasterAlias = onCall(
  { region: 'asia-northeast1' },
  async (request) => {
    // 1. 認証チェック
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    // 2. ホワイトリスト + adminロール確認
    const userDoc = await getFirestore().doc(`users/${request.auth.uid}`).get();
    if (!userDoc.exists) {
      throw new HttpsError('permission-denied', 'User not in whitelist');
    }
    if (userDoc.data()?.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Admin permission required');
    }

    const { masterType, masterId, alias } = request.data;

    // 3. パラメータ検証
    if (!masterType || !['office', 'customer', 'document'].includes(masterType)) {
      throw new HttpsError('invalid-argument', 'Invalid masterType. Must be office, customer, or document');
    }
    if (!masterId || typeof masterId !== 'string') {
      throw new HttpsError('invalid-argument', 'masterId is required');
    }
    if (!alias || typeof alias !== 'string' || alias.trim().length === 0) {
      throw new HttpsError('invalid-argument', 'alias is required and must be non-empty');
    }

    const trimmedAlias = alias.trim();

    // 3. マスタードキュメント取得
    const db = getFirestore();
    const collectionPath = MASTER_COLLECTIONS[masterType as MasterType];
    const docRef = db.doc(`${collectionPath}/${masterId}`);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      throw new HttpsError('not-found', `Master ${masterType}/${masterId} not found`);
    }

    const data = docSnap.data()!;
    const currentAliases = (data.aliases as string[]) || [];

    // 4. 重複チェック
    if (currentAliases.includes(trimmedAlias)) {
      // 既に登録済みの場合は成功扱い
      return { success: true, aliases: currentAliases, message: 'Alias already exists' };
    }

    // 5. エイリアス追加
    await docRef.update({
      aliases: FieldValue.arrayUnion(trimmedAlias),
    });

    const updatedAliases = [...currentAliases, trimmedAlias];
    console.log(`Added alias "${trimmedAlias}" to ${masterType}/${masterId}`);

    // 6. 学習履歴を保存
    const masterName = data.name as string || masterId;
    await db.collection('aliasLearningLogs').add({
      masterType,
      masterId,
      masterName,
      alias: trimmedAlias,
      learnedBy: request.auth.uid,
      learnedByEmail: request.auth.token.email || '',
      learnedAt: FieldValue.serverTimestamp(),
    });

    return { success: true, aliases: updatedAliases };
  }
);

/**
 * マスターからエイリアスを削除
 *
 * リクエスト: {
 *   masterType: 'office' | 'customer' | 'document',
 *   masterId: string,
 *   alias: string
 * }
 * レスポンス: { success: boolean, aliases: string[] }
 */
export const removeMasterAlias = onCall(
  { region: 'asia-northeast1' },
  async (request) => {
    // 1. 認証チェック
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    // 2. ホワイトリスト + adminロール確認
    const userDoc = await getFirestore().doc(`users/${request.auth.uid}`).get();
    if (!userDoc.exists) {
      throw new HttpsError('permission-denied', 'User not in whitelist');
    }
    if (userDoc.data()?.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Admin permission required');
    }

    const { masterType, masterId, alias } = request.data;

    // 3. パラメータ検証
    if (!masterType || !['office', 'customer', 'document'].includes(masterType)) {
      throw new HttpsError('invalid-argument', 'Invalid masterType');
    }
    if (!masterId || typeof masterId !== 'string') {
      throw new HttpsError('invalid-argument', 'masterId is required');
    }
    if (!alias || typeof alias !== 'string') {
      throw new HttpsError('invalid-argument', 'alias is required');
    }

    // 3. マスタードキュメント取得
    const db = getFirestore();
    const collectionPath = MASTER_COLLECTIONS[masterType as MasterType];
    const docRef = db.doc(`${collectionPath}/${masterId}`);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      throw new HttpsError('not-found', `Master ${masterType}/${masterId} not found`);
    }

    // 4. エイリアス削除
    await docRef.update({
      aliases: FieldValue.arrayRemove(alias),
    });

    const data = docSnap.data()!;
    const currentAliases = (data.aliases as string[]) || [];
    const updatedAliases = currentAliases.filter(a => a !== alias);

    console.log(`Removed alias "${alias}" from ${masterType}/${masterId}`);

    return { success: true, aliases: updatedAliases };
  }
);
