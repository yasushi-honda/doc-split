/**
 * タブレット横向き - サイドバースクロール E2Eテスト
 * タブレット/スマホ横向き（md:以上）で右サイドバーがスクロール可能であることを確認
 */

import { test, expect } from '@playwright/test';
import { loginWithTestUser } from './helpers';

// タブレット横向きViewport設定（iPad横向き相当）
test.use({
  viewport: { width: 1024, height: 600 },
  baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
});

test.describe('タブレット横向き サイドバー @emulator', () => {
  test.beforeEach(async ({ page }) => {
    await loginWithTestUser(page);
  });

  test('書類詳細モーダルの右サイドバーが表示される', async ({ page }) => {
    await page.waitForSelector('table tbody tr', { timeout: 10000 });
    const firstDoc = page.locator('table tbody tr').first();
    await firstDoc.click();

    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // デスクトップレイアウトでは hidden md:flex 内の書類情報ヘッダーが表示
    // モバイル用(md:hidden)とデスクトップ用(hidden md:flex)の2つがあるため、nth(1)で後者を取得
    const docInfo = modal.locator('h3:has-text("書類情報")').nth(1);
    await expect(docInfo).toBeVisible({ timeout: 3000 });

    // 顧客名ラベルが表示されること
    const customerLabel = modal.locator('text=顧客名').first();
    await expect(customerLabel).toBeVisible();
  });

  test('右サイドバーがスクロール可能', async ({ page }) => {
    await page.waitForSelector('table tbody tr', { timeout: 10000 });
    const firstDoc = page.locator('table tbody tr').first();
    await firstDoc.click();

    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(500);

    // サイドバー内のoverflow-y-autoコンテナを確認
    // デスクトップではサイドバーコンテナとその内部コンテンツの両方に md:overflow-y-auto が設定
    const overflowContainers = modal.locator('[class*="overflow-y-auto"]');
    const count = await overflowContainers.count();

    console.log(`overflow-y-auto コンテナ数: ${count}`);
    expect(count).toBeGreaterThan(0);

    // サイドバー側のコンテナのcomputed styleを確認
    const lastContainer = overflowContainers.last();
    const overflowY = await lastContainer.evaluate((el) => {
      return window.getComputedStyle(el).overflowY;
    });

    console.log(`サイドバー overflow-y: ${overflowY}`);
    expect(['auto', 'scroll']).toContain(overflowY);
  });

  test('スマホ横向き(md:以上)でもサイドバーがスクロール可能', async ({ page }) => {
    // スマホ横向き（812x375 = iPhone X横向き相当、幅が768px以上でmd:適用）
    await page.setViewportSize({ width: 812, height: 375 });

    await page.waitForSelector('table tbody tr', { timeout: 10000 });
    const firstDoc = page.locator('table tbody tr').first();
    await firstDoc.click();

    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(500);

    // サイドバー内のoverflow-y-autoコンテナ確認
    const scrollContainers = modal.locator('[class*="overflow-y-auto"]');
    const count = await scrollContainers.count();

    console.log(`overflow-y-auto コンテナ数: ${count}`);
    expect(count).toBeGreaterThan(0);

    // コンテナのcomputed styleを確認
    const sidebarScroll = scrollContainers.last();
    const overflowY = await sidebarScroll.evaluate((el) => {
      return window.getComputedStyle(el).overflowY;
    });
    console.log(`サイドバー overflow-y: ${overflowY}`);
    expect(['auto', 'scroll']).toContain(overflowY);
  });
});
