/**
 * `functions/src/gmail/exchangeGmailAuthCode.ts` のメッセージ文言テスト(code-review指摘#65対応)
 *
 * refresh_token欠如時のメッセージが日本語化されていることを固定する(再発防止)。
 * OAuth2/Secret Manager等の外部依存モックが無い(このファイルはDI化されていない)ため、
 * `onCall`本体は呼ばず、副作用を持たない`gmailAuthMessages.ts`のメッセージ定数のみを検証する
 * (`exchangeGmailAuthCode.ts`自体は`admin.firestore()`をモジュールレベルで呼ぶ`gmailAuth.ts`に
 * 依存しており、`admin.initializeApp()`未実行の単体テストプールから直接importできないため)。
 */

import { expect } from 'chai';
import { GMAIL_REFRESH_TOKEN_MISSING_MESSAGE } from '../src/gmail/gmailAuthMessages';

describe('GMAIL_REFRESH_TOKEN_MISSING_MESSAGE', () => {
  it('日本語メッセージであり、元の英語文言("No refresh token returned...")を含まない', () => {
    expect(GMAIL_REFRESH_TOKEN_MISSING_MESSAGE).to.not.include('No refresh token returned');
    expect(GMAIL_REFRESH_TOKEN_MISSING_MESSAGE).to.include('リフレッシュトークン');
  });
});
