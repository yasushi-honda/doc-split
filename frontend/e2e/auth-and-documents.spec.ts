/**
 * 認証・書類一覧 E2Eテスト
 *
 * ログイン→書類一覧表示→タブ切替→統計カード表示を検証
 *
 * 実行方法:
 *   1. Firebase Emulator起動: firebase emulators:start
 *   2. シードデータ投入: FIRESTORE_EMULATOR_HOST=localhost:8085 node scripts/seed-e2e-data.js
 *   3. テスト実行: cd frontend && npx playwright test e2e/auth-and-documents.spec.ts
 */

import { test, expect, Page } from '@playwright/test';

const TEST_USER = {
  email: 'test@example.com',
  password: 'testpassword123',
};

async function loginWithTestUser(page: Page) {
  await page.goto('/');
  await page.evaluate(
    async ({ email, password }) => {
      // @ts-expect-error - Vite devサーバー経由でモジュール解決
      const { auth, signInWithEmailAndPassword } = await import('/src/lib/firebase.ts');
      await signInWithEmailAndPassword(auth, email, password);
    },
    { email: TEST_USER.email, password: TEST_USER.password }
  );
  await page.waitForSelector('text=書類一覧', { timeout: 10000 });
}

// ============================================
// 基本テスト（認証不要）
// ============================================

test.describe('認証 - 基本', () => {
  test('ログインページが表示される', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=書類管理ビューアー')).toBeVisible({ timeout: 10000 });
  });

  test('未認証ではログインページにリダイレクトされる', async ({ page }) => {
    await page.goto('/');
    // ログインボタンが表示される（書類一覧ではない）
    const hasLogin = await page
      .locator('button:has-text("Google")')
      .isVisible({ timeout: 10000 })
      .catch(() => false);
    const hasTitle = await page
      .locator('text=書類管理ビューアー')
      .isVisible()
      .catch(() => false);
    expect(hasLogin || hasTitle).toBeTruthy();
  });
});

// ============================================
// Emulator環境テスト（認証必要 + シードデータ必要）
// ============================================

test.describe('認証・書類一覧 @emulator', () => {
  test.beforeEach(async ({ page }) => {
    await loginWithTestUser(page);
  });

  test('ログイン後に書類管理ヘッダーが表示される', async ({ page }) => {
    await expect(page.locator('h1:has-text("書類管理")')).toBeVisible();
  });

  test('統計カードが表示される', async ({ page }) => {
    await expect(page.locator('text=全書類').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=処理完了').first()).toBeVisible();
    await expect(page.locator('text=エラー').first()).toBeVisible();
  });

  test('書類一覧にドキュメントが表示される', async ({ page }) => {
    // テーブル行が1件以上表示される
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
  });

  test('全タブが表示される', async ({ page }) => {
    for (const tabName of ['書類一覧', '顧客別', '事業所別', '書類種別', '担当CM別']) {
      await expect(
        page.locator('[role="tab"]').filter({ hasText: tabName })
      ).toBeVisible();
    }
  });

  test('顧客別タブに切り替えられる', async ({ page }) => {
    await page.locator('[role="tab"]').filter({ hasText: '顧客別' }).click();

    // グループビューがレンダリングされるまで待機（テーブルではなくカード/リストが表示される）
    // シードデータの顧客名が表示される
    await expect(page.locator('text=阿部太郎').first()).toBeVisible({ timeout: 15000 });
  });

  test('事業所別タブに切り替えられる', async ({ page }) => {
    await page.locator('[role="tab"]').filter({ hasText: '事業所別' }).click();

    // 事業所名が表示される
    await expect(page.locator('text=テスト第一事業所').first()).toBeVisible({ timeout: 15000 });
  });

  test('書類一覧タブに戻れる', async ({ page }) => {
    // 別タブに移動
    await page.locator('[role="tab"]').filter({ hasText: '顧客別' }).click();
    await page.waitForTimeout(500);

    // 書類一覧タブに戻る
    await page.locator('[role="tab"]').filter({ hasText: '書類一覧' }).click();
    await page.waitForTimeout(1000);

    // テーブルが表示される
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
  });

  test('PDFアップロードボタンが表示される', async ({ page }) => {
    await expect(page.locator('button:has-text("PDFアップロード")')).toBeVisible();
  });

  test('学習履歴ボタンが表示される', async ({ page }) => {
    await expect(page.locator('button:has-text("学習履歴")')).toBeVisible();
  });
});
