/**
 * E2Eテスト共通ヘルパー
 */

import { Page } from '@playwright/test';

export const TEST_USER = {
  email: 'test@example.com',
  password: 'testpassword123',
};

/**
 * Emulator環境でメール/パスワードログイン
 * @param waitSelector ログイン後の待機セレクタ（モバイルでは 'h1:has-text("書類管理")' を指定）
 */
export async function loginWithTestUser(page: Page, waitSelector = 'text=書類一覧') {
  await page.goto('/');
  await page.evaluate(
    async ({ email, password }) => {
      // @ts-expect-error - Vite devサーバー経由でモジュール解決
      const { auth, signInWithEmailAndPassword } = await import('/src/lib/firebase.ts');
      await signInWithEmailAndPassword(auth, email, password);
    },
    { email: TEST_USER.email, password: TEST_USER.password }
  );
  await page.waitForSelector(waitSelector, { timeout: 10000 });
}

/** タブをクリック */
export async function clickTab(page: Page, tabName: string) {
  await page.locator('[role="tab"]').filter({ hasText: tabName }).click();
}
