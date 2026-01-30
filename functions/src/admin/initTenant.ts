/**
 * テナント初期化用一時関数
 *
 * 設定復旧後に削除すること
 */

import { onRequest } from 'firebase-functions/v2/https';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const db = getFirestore();

export const initTenantSettings = onRequest(
  { region: 'asia-northeast1', cors: true },
  async (req, res) => {
    try {
      // settings/auth
      await db.doc('settings/auth').set({
        allowedDomains: ['kanameone.com']
      });
      console.log('✅ settings/auth created');

      // settings/app
      await db.doc('settings/app').set({
        targetLabels: ['ｹｱﾏﾈ/L1'],
        labelSearchOperator: 'OR',
        errorNotificationEmails: [],
        gmailAccount: 'docsplit@kanameone.com',
        delegatedUserEmail: 'docsplit@kanameone.com'
      });
      console.log('✅ settings/app created');

      // settings/gmail（Gmail認証設定 - gmailAuth.tsが参照）
      // 注意: authModeは環境に応じて設定画面から変更すること
      // - Secret Managerにgmail-oauth-*がある場合: 'oauth'
      // - Domain-wide Delegation設定済みの場合: 'service_account'
      await db.doc('settings/gmail').set({
        authMode: 'oauth'  // デフォルトはOAuth（Secret Managerに認証情報がある前提）
      });
      console.log('✅ settings/gmail created');

      res.json({
        success: true,
        message: 'Settings initialized',
        settings: {
          auth: { allowedDomains: ['kanameone.com'] },
          app: { targetLabels: ['ｹｱﾏﾈ/L1'], gmailAccount: 'docsplit@kanameone.com', delegatedUserEmail: 'docsplit@kanameone.com' },
          gmail: { authMode: 'service_account', delegatedUserEmail: 'docsplit@kanameone.com' }
        }
      });
    } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ success: false, error: String(error) });
    }
  }
);

// 管理者ユーザー登録用関数
export const registerAdminUser = onRequest(
  { region: 'asia-northeast1', cors: true },
  async (req, res) => {
    try {
      const { uid, email } = req.query;

      if (!uid || !email) {
        res.status(400).json({ success: false, error: 'uid and email are required' });
        return;
      }

      const now = Timestamp.now();
      await db.doc(`users/${uid}`).set({
        email: email,
        role: 'admin',
        createdAt: now,
        lastLoginAt: now
      });

      console.log(`✅ Admin user registered: ${email}`);
      res.json({ success: true, message: `Admin user ${email} registered` });
    } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ success: false, error: String(error) });
    }
  }
);
