/**
 * `functions/src/drive/exchangeDriveAuthCode.ts` 統合テスト(ADR-0022, Firestore emulator)
 *
 * onCall配管(認証・admin権限チェック等)は他のDrive関連Callableと同型の定型ロジックの
 * ため、`exchangeDriveAuthCodeCore`(業務ロジック本体)を直接テストする
 * (`retryDriveExportCore`と同型パターン)。OAuth2/Secret Managerへの外部依存は
 * `ExchangeDriveAuthCodeDeps`経由でfakeを注入する。
 *
 * 主眼はCLAUDE.md MUST「DBにPartial Updateする関数のテストには更新対象外フィールドの
 * 値が変化しないこと」を含める」(code-review指摘#48対応、2026-07-22): `settings/drive`への
 * 2段階の部分書込み(authMode→connectedEmail)が既存の他フィールド(rootFolderId/template/
 * furiganaFallback)を破壊しないことを検証する。
 *
 * 実行: firebase emulators:exec --only firestore --project exchange-drive-auth-code-test \
 *         'npm run test:integration'
 */

import './helpers/initFirestoreEmulator';

import { expect } from 'chai';
import * as admin from 'firebase-admin';
import { cleanupCollections } from './helpers/cleanupEmulator';
import {
  exchangeDriveAuthCodeCore,
  DriveRefreshTokenMissingError,
  ExchangeDriveAuthCodeDeps,
} from '../src/drive/exchangeDriveAuthCode';
import { DRIVE_SETTINGS_DOC_PATH } from '../src/utils/driveAuth';

const db = admin.firestore();
const COLLECTIONS_TO_CLEAN: readonly string[] = ['settings'];

function makeFakeDeps(opts: {
  refreshToken?: string | null;
  connectedEmail?: string;
} = {}): ExchangeDriveAuthCodeDeps & {
  setSecretCalls: Array<{ name: string; value: string }>;
  exchangeCodeCalls: Array<{ clientId: string; clientSecret: string; code: string }>;
} {
  const setSecretCalls: Array<{ name: string; value: string }> = [];
  const exchangeCodeCalls: Array<{ clientId: string; clientSecret: string; code: string }> = [];

  return {
    getSecret: async (name: string) => `fake-secret-value-for-${name}`,
    setSecret: async (name: string, value: string) => {
      setSecretCalls.push({ name, value });
    },
    exchangeCode: async (params) => {
      exchangeCodeCalls.push(params);
      return { refreshToken: opts.refreshToken === undefined ? 'fake-refresh-token' : opts.refreshToken };
    },
    fetchConnectedEmail: async () => opts.connectedEmail ?? 'connected@example.com',
    setSecretCalls,
    exchangeCodeCalls,
  };
}

async function seedDriveSettings(overrides: Record<string, unknown> = {}): Promise<void> {
  await db.doc(DRIVE_SETTINGS_DOC_PATH).set({
    rootFolderId: 'root-folder-id',
    rootFolderName: '事務',
    template: [{ type: 'fixed', value: '事業所A' }],
    furiganaFallback: 'stop',
    ...overrides,
  });
}

describe('exchangeDriveAuthCodeCore (ADR-0022)', () => {
  beforeEach(async () => {
    await cleanupCollections(db, COLLECTIONS_TO_CLEAN);
  });

  it('ハッピーパス: authMode/connectedEmailを設定し成功結果を返す', async () => {
    await seedDriveSettings();
    const deps = makeFakeDeps({ connectedEmail: 'hy.unimail.11@example.com' });

    const result = await exchangeDriveAuthCodeCore(db, 'auth-code-1', deps);

    expect(result).to.deep.equal({ success: true, email: 'hy.unimail.11@example.com' });
    const settings = (await db.doc(DRIVE_SETTINGS_DOC_PATH).get()).data();
    expect(settings?.authMode).to.equal('oauth');
    expect(settings?.connectedEmail).to.equal('hy.unimail.11@example.com');
    expect(deps.setSecretCalls).to.deep.equal([
      { name: 'drive-oauth-refresh-token', value: 'fake-refresh-token' },
    ]);
  });

  it('更新対象外フィールド(rootFolderId/rootFolderName/template/furiganaFallback)の値が変化しない(CLAUDE.md MUST)', async () => {
    await seedDriveSettings({
      rootFolderId: '不変フォルダID',
      rootFolderName: '不変事務',
      furiganaFallback: 'useNameInitial',
    });
    const deps = makeFakeDeps();

    await exchangeDriveAuthCodeCore(db, 'auth-code-1', deps);

    const settings = (await db.doc(DRIVE_SETTINGS_DOC_PATH).get()).data();
    expect(settings?.rootFolderId).to.equal('不変フォルダID');
    expect(settings?.rootFolderName).to.equal('不変事務');
    expect(settings?.template).to.deep.equal([{ type: 'fixed', value: '事業所A' }]);
    expect(settings?.furiganaFallback).to.equal('useNameInitial');
  });

  it('settings/driveドキュメントが未作成の場合でも部分書込み(merge)で新規作成される', async () => {
    // seedDriveSettings()を呼ばない(ドキュメント自体が存在しない状態から接続する初回シナリオ)
    const deps = makeFakeDeps();

    await exchangeDriveAuthCodeCore(db, 'auth-code-1', deps);

    const settings = (await db.doc(DRIVE_SETTINGS_DOC_PATH).get()).data();
    expect(settings?.authMode).to.equal('oauth');
    expect(settings?.connectedEmail).to.equal('connected@example.com');
  });

  it('refresh_tokenが返らない場合はDriveRefreshTokenMissingErrorをthrowし、authModeは書き込まれない', async () => {
    await seedDriveSettings();
    const deps = makeFakeDeps({ refreshToken: null });

    try {
      await exchangeDriveAuthCodeCore(db, 'auth-code-1', deps);
      expect.fail('DriveRefreshTokenMissingErrorがthrowされるべき');
    } catch (error) {
      expect(error).to.be.instanceOf(DriveRefreshTokenMissingError);
      // #65対応: 元の英語メッセージ("No refresh token returned...")のGmail回帰と
      // 同じ根本原因を日本語化で修正済み。URL部分を除き英単語の羅列でないことを確認
      expect((error as Error).message).to.not.include('No refresh token returned');
      expect((error as Error).message).to.include('リフレッシュトークン');
    }

    const settings = (await db.doc(DRIVE_SETTINGS_DOC_PATH).get()).data();
    expect(settings?.authMode).to.be.undefined;
    expect(deps.setSecretCalls).to.deep.equal([]);
  });

  it('fetchConnectedEmailが失敗した場合、settings/driveにauthModeが一切書き込まれない(code-review xhigh指摘#3対応)', async () => {
    await seedDriveSettings();
    const deps = makeFakeDeps();
    deps.fetchConnectedEmail = async () => {
      throw new Error('Drive about.get failed (transient)');
    };

    try {
      await exchangeDriveAuthCodeCore(db, 'auth-code-1', deps);
      expect.fail('fetchConnectedEmailの例外が伝播するべき');
    } catch (error) {
      expect((error as Error).message).to.equal('Drive about.get failed (transient)');
    }

    // 旧実装はauthModeを先に書き込んでいたため、ここでコミット済みになってしまっていた。
    // 現在は単一書込みに変更したため、疎通確認が失敗した場合はauthMode/connectedEmail
    // いずれも書き込まれない(FEが「連携済み」と誤表示することはない)。
    const settings = (await db.doc(DRIVE_SETTINGS_DOC_PATH).get()).data();
    expect(settings?.authMode).to.be.undefined;
    expect(settings?.connectedEmail).to.be.undefined;
  });

  it('fetchConnectedEmailが失敗した場合、Secret Managerへのrefresh_token保存も一切発生しない(codex review指摘対応)', async () => {
    // setSecretはSecret Managerの新バージョンを即座にlatestへ昇格させるため、
    // 疎通確認より先に保存すると、失敗時(別アカウント宛の誤ったrefresh_token等)でも
    // 以後の実際のエクスポート処理が新しい未検証のrefresh_tokenを使ってしまい、
    // Firestore上は旧アカウントの表示のまま実体は別アカウント宛にエクスポートされる
    // split-brain状態になりうる。疎通確認を保存より先に行うことでこれを防ぐ。
    await seedDriveSettings();
    const deps = makeFakeDeps();
    deps.fetchConnectedEmail = async () => {
      throw new Error('別アカウント宛のrefresh_tokenで疎通確認に失敗');
    };

    try {
      await exchangeDriveAuthCodeCore(db, 'auth-code-1', deps);
      expect.fail('fetchConnectedEmailの例外が伝播するべき');
    } catch {
      // 上のテストで例外内容は確認済み
    }

    expect(deps.setSecretCalls).to.deep.equal([]);
  });

  it('codeの前後に空白がある場合はtrim済みの値でexchangeCode/fetchConnectedEmailへ渡す(code-review xhigh指摘#7対応)', async () => {
    await seedDriveSettings();
    const deps = makeFakeDeps();

    await exchangeDriveAuthCodeCore(db, '  auth-code-with-whitespace  \n', deps);

    expect(deps.exchangeCodeCalls).to.deep.equal([
      {
        clientId: 'fake-secret-value-for-drive-oauth-client-id',
        clientSecret: 'fake-secret-value-for-drive-oauth-client-secret',
        code: 'auth-code-with-whitespace',
      },
    ]);
  });

  it('client-id/client-secretはgetSecret経由で取得しexchangeCodeへ渡す', async () => {
    await seedDriveSettings();
    const deps = makeFakeDeps();

    await exchangeDriveAuthCodeCore(db, 'auth-code-xyz', deps);

    expect(deps.exchangeCodeCalls).to.deep.equal([
      {
        clientId: 'fake-secret-value-for-drive-oauth-client-id',
        clientSecret: 'fake-secret-value-for-drive-oauth-client-secret',
        code: 'auth-code-xyz',
      },
    ]);
  });
});
