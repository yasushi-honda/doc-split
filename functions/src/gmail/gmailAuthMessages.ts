/**
 * Gmail OAuth関連のユーザー向けメッセージ文言(code-review指摘#65対応、2026-07-22)
 *
 * `exchangeGmailAuthCode.ts`から分離した独立モジュール。firebase-admin等の副作用を
 * 持つimportを一切含まないため、単体テストから安全にimportできる
 * (`exchangeGmailAuthCode.ts`自体は`../utils/gmailAuth`経由でモジュールレベルの
 * `admin.firestore()`呼び出しを持ち、`admin.initializeApp()`未実行の単体テストプールから
 * importすると"The default Firebase app does not exist"で失敗するため分離が必要だった)。
 */

/**
 * refresh_token欠如時のユーザー向けメッセージ。元は英語("No refresh token returned...")
 * だったため`frontend/src/lib/callFunction.ts`のfailed-precondition素通し経由でユーザーに
 * そのまま英語表示されてしまう回帰があった。他のfailed-preconditionは全て日本語のため、
 * この文言のみが外れ値だった。
 */
export const GMAIL_REFRESH_TOKEN_MISSING_MESSAGE =
  'リフレッシュトークンを取得できませんでした。既にこのアプリを認可済みの可能性があります。' +
  'https://myaccount.google.com/permissions でアクセスを解除してから、' +
  'もう一度「Gmail連携」ボタンを押してください。';
