/**
 * Gmail認証ユーティリティ
 *
 * ADR-0003 に基づく OAuth 2.0 / Service Account 切替機能
 *
 * 環境判定方式:
 * - Firestore /settings/gmail の authMode で判定
 * - 開発環境: OAuth 2.0（個人Gmail対応）
 * - 本番環境: Service Account + Domain-wide Delegation（推奨）
 */

import * as admin from 'firebase-admin';
import { google, gmail_v1 } from 'googleapis';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const db = admin.firestore();

/** Gmail設定スキーマ */
export interface GmailSettings {
  authMode: 'oauth' | 'service_account';

  // OAuth用（開発環境）
  oauthClientId?: string;
  // oauthClientSecret は Secret Manager に保存
  // refreshToken は Secret Manager に保存

  // Service Account用（本番環境）
  serviceAccountEmail?: string;
  delegatedUserEmail?: string; // 対象Gmail
}

/** デフォルト設定（設定がない場合） */
const DEFAULT_GMAIL_SETTINGS: GmailSettings = {
  authMode: 'service_account',
};

/**
 * Secret Managerから値を取得
 */
async function getSecretValue(secretName: string): Promise<string> {
  const client = new SecretManagerServiceClient();
  // Cloud Functions 2nd gen (Cloud Run) uses GOOGLE_CLOUD_PROJECT
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;

  const name = `projects/${projectId}/secrets/${secretName}/versions/latest`;

  try {
    const [version] = await client.accessSecretVersion({ name });
    const payload = version.payload?.data;

    if (!payload) {
      throw new Error(`Secret ${secretName} has no data`);
    }

    return payload.toString();
  } catch (error) {
    console.error(`Failed to access secret ${secretName}:`, error);
    throw error;
  }
}

/**
 * Gmail設定を取得
 */
export async function getGmailSettings(): Promise<GmailSettings> {
  try {
    const settingsDoc = await db.doc('settings/gmail').get();

    if (!settingsDoc.exists) {
      console.log('Gmail settings not found, using defaults');
      return DEFAULT_GMAIL_SETTINGS;
    }

    return settingsDoc.data() as GmailSettings;
  } catch (error) {
    console.error('Failed to get Gmail settings:', error);
    return DEFAULT_GMAIL_SETTINGS;
  }
}

/**
 * OAuth 2.0 クライアントを作成（開発環境用）
 */
async function createOAuthClient(settings: GmailSettings): Promise<gmail_v1.Gmail> {
  if (!settings.oauthClientId) {
    throw new Error('OAuth client ID not configured');
  }

  // Secret Managerからシークレットを取得
  const [clientSecret, refreshToken] = await Promise.all([
    getSecretValue('gmail-oauth-client-secret'),
    getSecretValue('gmail-oauth-refresh-token'),
  ]);

  const oauth2Client = new google.auth.OAuth2(
    settings.oauthClientId,
    clientSecret
  );

  oauth2Client.setCredentials({
    refresh_token: refreshToken,
  });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

/**
 * Service Account クライアントを作成（本番環境用）
 */
async function createServiceAccountClient(settings: GmailSettings): Promise<gmail_v1.Gmail> {
  if (!settings.delegatedUserEmail) {
    throw new Error('Delegated user email not configured');
  }

  // Application Default Credentials + Domain-wide Delegation
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    clientOptions: {
      subject: settings.delegatedUserEmail,
    },
  });

  return google.gmail({ version: 'v1', auth });
}

/**
 * Gmail APIクライアントを取得
 *
 * Firestore /settings/gmail の authMode に基づいて
 * OAuth 2.0 または Service Account を自動選択
 */
export async function getGmailClient(): Promise<gmail_v1.Gmail> {
  const settings = await getGmailSettings();

  console.log(`Gmail auth mode: ${settings.authMode}`);

  if (settings.authMode === 'oauth') {
    console.log('Using OAuth 2.0 authentication (development mode)');
    return createOAuthClient(settings);
  } else {
    console.log('Using Service Account + Delegation (production mode)');
    return createServiceAccountClient(settings);
  }
}

/**
 * Gmail認証設定を検証
 */
export async function validateGmailAuth(): Promise<{
  valid: boolean;
  authMode: string;
  error?: string;
}> {
  try {
    const settings = await getGmailSettings();
    const gmail = await getGmailClient();

    // プロファイル取得でテスト
    const appSettingsDoc = await db.doc('settings/app').get();
    const gmailAccount = appSettingsDoc.data()?.gmailAccount;

    if (!gmailAccount) {
      return {
        valid: false,
        authMode: settings.authMode,
        error: 'Gmail account not configured in settings/app',
      };
    }

    const profile = await gmail.users.getProfile({
      userId: gmailAccount,
    });

    console.log(`Gmail auth validated for: ${profile.data.emailAddress}`);

    return {
      valid: true,
      authMode: settings.authMode,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      valid: false,
      authMode: 'unknown',
      error: errorMessage,
    };
  }
}
