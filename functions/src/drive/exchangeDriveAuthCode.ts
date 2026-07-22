/**
 * Google Drive OAuth認証コード交換 Callable Function(ADR-0022)
 *
 * フロントエンドからGoogle Identity ServicesのOAuth認証コードを受け取り、
 * refresh_tokenに交換してSecret Managerに保存する。
 * Gmail連携(`exchangeGmailAuthCode.ts`)と同型の骨格だが、認証情報・接続先は完全に独立。
 *
 * フロー:
 * 1. 認証・admin権限チェック
 * 2. Secret Managerからclient-id/client-secretを取得
 * 3. auth code → tokens交換
 * 4. refresh_tokenをSecret Managerに保存
 * 5. Firestore settings/drive.authMode を 'oauth' に更新
 * 6. Drive APIで疎通確認(about.get)
 *
 * `exchangeDriveAuthCodeCore`は外部依存(Secret Manager/OAuth2/Drive API)をDI
 * (`ExchangeDriveAuthCodeDeps`)で注入する(`retryDriveExportCore`と同型パターン)。
 * このファイルにはOAuth外部依存をモックする手段(`jest.mock`等)が無く、統合テストで
 * `settings/drive`への部分書込みの安全性(CLAUDE.md MUST)を検証するために必要
 * (code-review指摘#48対応、2026-07-22)。
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { google } from 'googleapis';
import { getSecretValue, setSecretValue } from '../utils/gmailAuth';
import { DRIVE_SETTINGS_DOC_PATH } from '../utils/driveAuth';

const db = admin.firestore();

/**
 * `exchangeCode`がrefresh_tokenを返さなかった場合にthrowするマーカーエラー。
 * 「既にこのアプリを認可済み」等でGoogleがrefresh_tokenを再発行しないケースを表す。
 * メッセージ自体がユーザー向け日本語文言(onCallラッパーがfailed-preconditionへ
 * そのまま変換して返す、code-review指摘#65対応: 英語メッセージのGmail回帰を修正)。
 */
export class DriveRefreshTokenMissingError extends Error {
  constructor() {
    super(
      'リフレッシュトークンを取得できませんでした。既にこのアプリを認可済みの可能性があります。' +
        'https://myaccount.google.com/permissions でアクセスを解除してから、' +
        'もう一度「Google Drive連携」ボタンを押してください。'
    );
    this.name = 'DriveRefreshTokenMissingError';
  }
}

export interface ExchangeDriveAuthCodeDeps {
  /** Secret Managerから値を取得。テストでは固定値を返すfakeに差し替える。 */
  getSecret: (name: string) => Promise<string>;
  /** Secret Managerへ値を保存。テストでは呼び出し記録のみのfakeに差し替える。 */
  setSecret: (name: string, value: string) => Promise<void>;
  /** OAuth認証コードをrefresh_tokenに交換する(GIS popupフローの`postmessage`redirect_uri)。 */
  exchangeCode: (params: {
    clientId: string;
    clientSecret: string;
    code: string;
  }) => Promise<{ refreshToken: string | null }>;
  /** refresh_tokenでDrive APIの疎通確認(about.get)を行い、接続先メールアドレスを返す。 */
  fetchConnectedEmail: (params: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  }) => Promise<string>;
}

export interface ExchangeDriveAuthCodeResult {
  success: true;
  email: string;
}

/**
 * 交換本体ロジック(認証・admin権限チェック・onCall配管から独立、テスト容易性のため
 * `retryDriveExportCore`と同型パターン)。
 */
export async function exchangeDriveAuthCodeCore(
  firestore: admin.firestore.Firestore,
  rawCode: string,
  deps: ExchangeDriveAuthCodeDeps
): Promise<ExchangeDriveAuthCodeResult> {
  // trim済みの値を以降すべてで使う(code-review xhigh指摘#7対応、2026-07-22): onCall
  // ラッパーの検証は`!code.trim()`のみでuntrimmedのcodeをそのまま渡していたため、
  // 前後に空白を含むcodeがOAuthトークン交換エンドポイントへ送られ、有効なコードでも
  // invalid_grant相当のエラーになりえた。
  const code = rawCode.trim();

  const [clientId, clientSecret] = await Promise.all([
    deps.getSecret('drive-oauth-client-id'),
    deps.getSecret('drive-oauth-client-secret'),
  ]);

  const { refreshToken } = await deps.exchangeCode({ clientId, clientSecret, code });
  if (!refreshToken) {
    throw new DriveRefreshTokenMissingError();
  }

  // 疎通確認(fetchConnectedEmail)を、Secret Managerへの保存より先に行う(codex review
  // 指摘対応、2026-07-22): `setSecret`はSecret Managerの新バージョンを即座に`latest`に
  // 昇格させるため、これを先に実行すると、fetchConnectedEmailが失敗した場合でも
  // (別アカウント宛の誤ったrefresh_token・失効済み等)、以後の`getDriveClient()`
  // (実際のエクスポート処理)が新しい未検証のrefresh_tokenを使ってしまい、Firestore上は
  // 旧アカウントのまま「連携済み」表示なのに実体は別アカウント宛にエクスポートされる
  // というsplit-brain状態になりうる。疎通確認をrefreshToken単体(未保存)に対して直接
  // 行うことで、失敗時はSecret Manager・Firestoreのいずれも変更されないまま維持される。
  const email = await deps.fetchConnectedEmail({ clientId, clientSecret, refreshToken });

  await deps.setSecret('drive-oauth-refresh-token', refreshToken);

  // 疎通確認・Secret Manager保存の両方が成功したことを確認してから単一書込み
  // (code-review xhigh指摘#3対応、2026-07-22): 旧実装はauthModeとconnectedEmailを
  // 2段階で書き込んでおり、fetchConnectedEmailが失敗するとauthMode:'oauth'だけが
  // コミット済みで残り、FEの接続判定(authMode==='oauth')が「連携済み」と誤表示していた。
  // 単一ドキュメントへのsetは元々アトミックなため、成功確定後にまとめて書くことで
  // 部分書込みの不整合状態が構造的に発生しなくなる(ロールバック処理は不要)。
  await firestore.doc(DRIVE_SETTINGS_DOC_PATH).set({ authMode: 'oauth', connectedEmail: email }, { merge: true });

  return { success: true, email };
}

const productionDeps: ExchangeDriveAuthCodeDeps = {
  getSecret: getSecretValue,
  setSecret: setSecretValue,
  exchangeCode: async ({ clientId, clientSecret, code }) => {
    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      'postmessage' // GIS popup flow uses 'postmessage' as redirect_uri
    );
    const { tokens } = await oauth2Client.getToken(code);
    return { refreshToken: tokens.refresh_token ?? null };
  },
  fetchConnectedEmail: async ({ clientId, clientSecret, refreshToken }) => {
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'postmessage');
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const about = await drive.about.get({ fields: 'user' });
    return about.data.user?.emailAddress || '';
  },
};

export const exchangeDriveAuthCode = onCall(
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

    // 3. パラメータ検証(実際のtrim済み値の利用はexchangeDriveAuthCodeCore側で行う。
    // #7対応: 元はここでのvalidationのみtrimしており、実際に使われる値はuntrimmedの
    // ままだった)
    const { code } = request.data as { code?: string };
    if (!code || typeof code !== 'string' || !code.trim()) {
      throw new HttpsError('invalid-argument', 'Authorization code is required');
    }

    try {
      const result = await exchangeDriveAuthCodeCore(db, code, productionDeps);

      const callerEmail = request.auth.token.email || request.auth.uid;
      console.log(`Drive OAuth connected successfully for: ${result.email} by user: ${callerEmail}`);

      return result;
    } catch (error) {
      // HttpsErrorはそのまま再throw
      if (error instanceof HttpsError) {
        throw error;
      }

      if (error instanceof DriveRefreshTokenMissingError) {
        throw new HttpsError('failed-precondition', error.message);
      }

      const message = error instanceof Error ? error.message : String(error);
      console.error('Drive OAuth exchange failed:', message);

      // transient/permanent分類
      if (message.includes('invalid_grant')) {
        throw new HttpsError(
          'failed-precondition',
          '認証コードが無効または期限切れです。もう一度「Google Drive連携」ボタンを押してください。'
        );
      }

      throw new HttpsError('internal', `Google Drive連携に失敗しました: ${message}`);
    }
  }
);
