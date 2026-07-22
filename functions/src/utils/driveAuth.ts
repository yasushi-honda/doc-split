/**
 * Google Drive認証ユーティリティ(ADR-0022)
 *
 * Gmail連携(`gmailAuth.ts`)とは完全に独立したOAuth 2.0接続。
 * スコープは `drive.file` に確定(実機検証済み、ADR-0022 Decision 2)。
 * 認証情報は Secret Manager に保存(`drive-oauth-client-id` / `-secret` / `-refresh-token`)。
 */

import * as admin from 'firebase-admin';
import { google, drive_v3 } from 'googleapis';
import { DriveSettings } from '../../../shared/types';
import { getSecretValue } from './gmailAuth';

const db = admin.firestore();

export const DRIVE_SETTINGS_DOC_PATH = 'settings/drive';

/**
 * Drive API呼び出し時の`supportsAllDrives: true`定数は `drive/driveApiConstants.ts`
 * に分離されている(Firestore非依存の呼び出し元が本ファイルの`admin.firestore()`
 * 評価を巻き込まないため)。
 */

/**
 * Drive設定(`settings/drive`)を取得。
 * ドキュメントが存在しない場合は空オブジェクトを返す(未接続状態)。
 */
export async function getDriveSettings(): Promise<DriveSettings> {
  const snap = await db.doc(DRIVE_SETTINGS_DOC_PATH).get();
  if (!snap.exists) {
    return {};
  }
  return snap.data() as DriveSettings;
}

/**
 * OAuth 2.0 クライアントを作成。
 * 認証情報は全てSecret Managerから取得(`gmailAuth.ts`の`createOAuthClient`と同型)。
 */
export async function createDriveOAuthClient(): Promise<drive_v3.Drive> {
  const [clientId, clientSecret, refreshToken] = await Promise.all([
    getSecretValue('drive-oauth-client-id'),
    getSecretValue('drive-oauth-client-secret'),
    getSecretValue('drive-oauth-refresh-token'),
  ]);

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);

  oauth2Client.setCredentials({
    refresh_token: refreshToken,
  });

  return google.drive({ version: 'v3', auth: oauth2Client });
}

/**
 * Drive APIクライアントを取得。
 * Phase 1はOAuth接続のみ(`DriveSettings.authMode`はPhase2でservice_account拡張予定)。
 */
export async function getDriveClient(): Promise<drive_v3.Drive> {
  return createDriveOAuthClient();
}
