/**
 * 事業所同名解決機能のE2Eテスト
 *
 * TDD: テストを先に書き、失敗を確認してから修正する
 *
 * 実行方法:
 *   1. Firebase Emulator起動: firebase emulators:start
 *   2. シードデータ投入: FIRESTORE_EMULATOR_HOST=localhost:8085 node scripts/seed-e2e-data.js
 *   3. テスト実行: npm run test:e2e:emulator
 */

import { test, expect } from '@playwright/test';
import { loginWithTestUser } from './helpers';

// ============================================
// 基本テスト（認証不要）
// ============================================

test.describe('事業所同名解決機能 - 基本', () => {
  test('ログイン画面が表示される', async ({ page }) => {
    await page.goto('/');

    // ログイン画面の要素を確認
    const hasTitle = await page
      .locator('text=書類管理ビューアー')
      .isVisible()
      .catch(() => false);
    const hasGoogleButton = await page
      .locator('button:has-text("Google")')
      .isVisible()
      .catch(() => false);

    expect(hasTitle || hasGoogleButton).toBeTruthy();
  });
});

// ============================================
// Emulator環境テスト（認証必要）
// ============================================

test.describe('事業所同名解決機能 @emulator', () => {
  test('事業所別タブに切り替えて事業所グループが表示される', async ({ page }) => {
    await loginWithTestUser(page);

    // 事業所別タブをクリック
    const tab = page.locator('[role="tab"]').filter({ hasText: '事業所別' });
    await tab.click();
    await expect(tab).toHaveAttribute('data-state', 'active', { timeout: 5000 });

    // 事業所名が表示される
    await expect(page.locator('text=テスト第一事業所').first()).toBeVisible({ timeout: 20000 });
  });

  test('書類詳細モーダルに事業所名が表示される', async ({ page }) => {
    await loginWithTestUser(page);

    // 書類一覧のテーブル行をクリック
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    await rows.first().click();

    // 詳細モーダルが開く
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // 事業所名フィールドが存在する
    await expect(modal.locator('text=事業所').first()).toBeVisible();
  });
});

// ============================================
// UIコンポーネント確認
// ============================================

test.describe('UIコンポーネント確認', () => {
  test('ログイン画面のレイアウトが正しい', async ({ page }) => {
    await page.goto('/');

    const hasTitle = await page
      .locator('text=DocSplit')
      .isVisible()
      .catch(() => false);
    const hasLoginButton = await page
      .locator('button', { hasText: 'ログイン' })
      .isVisible()
      .catch(() => false);

    expect(hasTitle || hasLoginButton).toBeTruthy();
  });
});
