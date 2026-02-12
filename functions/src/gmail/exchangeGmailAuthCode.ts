/**
 * Gmail OAuth認証コード交換 Callable Function
 *
 * フロントエンドからGoogle Identity ServicesのOAuth認証コードを受け取り、
 * refresh_tokenに交換してSecret Managerに保存する。
 *
 * フロー:
 * 1. 認証・admin権限チェック
 * 2. Secret Managerからclient-id/client-secretを取得
 * 3. auth code → tokens交換
 * 4. refresh_tokenをSecret Managerに保存
 * 5. Firestore settings/gmail.authMode を 'oauth' に更新
 * 6. Gmail APIで疎通確認
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { google } from 'googleapis';
import { getSecretValue, setSecretValue } from '../utils/gmailAuth';

const db = admin.firestore();

export const exchangeGmailAuthCode = onCall(
  { region: 'asia-northeast1', timeoutSeconds: 60 },
  async (request) => {
    // 1. 認証チェック
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }

    // 2. admin権限チェック
    const userDoc = await db.doc(`users/${request.auth.uid}`).get();
    if (!userDoc.exists) {
      throw new HttpsError('permission-denied', 'User not in whitelist');
    }
    if (userDoc.data()?.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Admin permission required');
    }

    // 3. パラメータ検証
    const { code } = request.data as { code?: string };
    if (!code || typeof code !== 'string' || !code.trim()) {
      throw new HttpsError('invalid-argument', 'Authorization code is required');
    }

    try {
      // 4. Secret Managerからclient-id/client-secretを取得
      const [clientId, clientSecret] = await Promise.all([
        getSecretValue('gmail-oauth-client-id'),
        getSecretValue('gmail-oauth-client-secret'),
      ]);

      // 5. auth code → tokens交換
      const oauth2Client = new google.auth.OAuth2(
        clientId,
        clientSecret,
        'postmessage' // GIS popup flow uses 'postmessage' as redirect_uri
      );

      const { tokens } = await oauth2Client.getToken(code);

      if (!tokens.refresh_token) {
        throw new HttpsError(
          'failed-precondition',
          'No refresh token returned. The user may have already authorized this app. ' +
          'Please revoke access at https://myaccount.google.com/permissions and try again.'
        );
      }

      // 6. refresh_tokenをSecret Managerに保存
      await setSecretValue('gmail-oauth-refresh-token', tokens.refresh_token);

      // 7. Firestore settings/gmail.authMode を 'oauth' に更新
      await db.doc('settings/gmail').set(
        { authMode: 'oauth' },
        { merge: true }
      );

      // 8. Gmail API疎通確認
      oauth2Client.setCredentials(tokens);
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const profile = await gmail.users.getProfile({ userId: 'me' });
      const email = profile.data.emailAddress || '';

      // 9. gmailAccountも更新
      await db.doc('settings/app').set(
        { gmailAccount: email },
        { merge: true }
      );

      const callerEmail = request.auth.token.email || request.auth.uid;
      console.log(`Gmail OAuth connected successfully for: ${email} by user: ${callerEmail}`);

      return {
        success: true,
        email,
      };
    } catch (error) {
      // HttpsErrorはそのまま再throw
      if (error instanceof HttpsError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      console.error('Gmail OAuth exchange failed:', message);

      // transient/permanent分類
      if (message.includes('invalid_grant')) {
        throw new HttpsError(
          'failed-precondition',
          '認証コードが無効または期限切れです。もう一度「Gmail連携」ボタンを押してください。'
        );
      }

      throw new HttpsError('internal', `Gmail連携に失敗しました: ${message}`);
    }
  }
);
