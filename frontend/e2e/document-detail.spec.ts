/**
 * 書類詳細モーダル E2Eテスト
 *
 * 書類行クリック→詳細モーダル表示→メタ情報確認を検証
 *
 * 実行方法:
 *   1. Firebase Emulator起動: firebase emulators:start
 *   2. シードデータ投入: FIRESTORE_EMULATOR_HOST=localhost:8085 node scripts/seed-e2e-data.js
 *   3. テスト実行: cd frontend && npx playwright test e2e/document-detail.spec.ts
 */

import { test, expect } from '@playwright/test';
import { loginWithTestUser } from './helpers';

// ============================================
// Emulator環境テスト（認証必要 + シードデータ必要）
// ============================================

test.describe('書類詳細モーダル @emulator', () => {
  test.beforeEach(async ({ page }) => {
    await loginWithTestUser(page);
  });

  test('書類行をクリックすると詳細モーダルが開く', async ({ page }) => {
    // テーブル行が表示されるまで待機
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });

    // 最初の行をクリック
    await rows.first().click();

    // モーダルが表示される
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });
  });

  test('詳細モーダルにメタ情報が表示される', async ({ page }) => {
    // 詳細確認用ドキュメントの行をクリック
    const row = page.locator('tbody tr:has-text("阿部太郎")').first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.click();

    // モーダルが表示される
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // 顧客名が表示される
    await expect(modal.locator('text=阿部太郎')).toBeVisible();
  });

  test('詳細モーダルに書類種別が表示される', async ({ page }) => {
    const row = page.locator('tbody tr:has-text("阿部太郎")').first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.click();

    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // 書類種別が表示される
    await expect(modal.locator('text=請求書').first()).toBeVisible();
  });

  test('詳細モーダルを閉じることができる', async ({ page }) => {
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    await rows.first().click();

    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // ESCキーで閉じる
    await page.keyboard.press('Escape');

    // モーダルが閉じる
    await expect(modal).not.toBeVisible({ timeout: 5000 });
  });

  test('領収書の詳細モーダルが開ける', async ({ page }) => {
    // 領収書のドキュメント行
    const row = page.locator('tbody tr:has-text("山本八郎")').first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.click();

    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // 領収書の情報が表示される
    await expect(modal.locator('text=山本八郎').first()).toBeVisible();
    await expect(modal.locator('text=領収書').first()).toBeVisible();
  });
});
