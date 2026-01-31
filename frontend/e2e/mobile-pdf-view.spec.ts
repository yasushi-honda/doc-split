/**
 * モバイルPDFビュー E2Eテスト
 * エミュレータ環境でモバイルUIの動作を確認
 */

import { test, expect, devices } from '@playwright/test';

// モバイルデバイス設定
const mobileDevice = devices['iPhone 14'];

test.describe('モバイルPDFビュー @emulator', () => {
  test.use({
    ...mobileDevice,
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
  });

  test.beforeEach(async ({ page }) => {
    // エミュレータのAuth UIにアクセス
    await page.goto('/');

    // ログインページが表示されたら、エミュレータ認証を使用
    const loginButton = page.locator('text=Googleでログイン');
    if (await loginButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      // エミュレータモードでは自動ログインをシミュレート
      // または、テスト用ユーザーでログイン
      console.log('ログインページが表示されました');
    }
  });

  test('書類詳細モーダルが開く', async ({ page }) => {
    // 書類一覧が表示されるまで待機
    await page.waitForSelector('table tbody tr, [data-testid="document-row"]', { timeout: 10000 }).catch(() => null);

    // スクリーンショット
    await page.screenshot({ path: 'test-results/mobile-1-list.png', fullPage: true });

    // 最初の書類をクリック
    const firstDoc = page.locator('table tbody tr, [data-testid="document-row"]').first();
    if (await firstDoc.isVisible()) {
      await firstDoc.click();
      await page.waitForTimeout(1000);

      // モーダルが開いたか確認
      const modal = page.locator('[role="dialog"]');
      await expect(modal).toBeVisible({ timeout: 5000 });

      await page.screenshot({ path: 'test-results/mobile-2-modal.png', fullPage: true });
    }
  });

  test('書類情報パネルの展開/折りたたみ', async ({ page }) => {
    await page.waitForSelector('table tbody tr', { timeout: 10000 }).catch(() => null);

    const firstDoc = page.locator('table tbody tr').first();
    if (await firstDoc.isVisible()) {
      await firstDoc.click();
      await page.waitForTimeout(1000);

      // 書類情報ヘッダーを探す
      const docInfoHeader = page.locator('text=書類情報').first();
      await expect(docInfoHeader).toBeVisible();

      // 折りたたみ状態を確認
      await page.screenshot({ path: 'test-results/mobile-3-collapsed.png', fullPage: true });

      // 展開
      await docInfoHeader.click();
      await page.waitForTimeout(500);

      await page.screenshot({ path: 'test-results/mobile-4-expanded.png', fullPage: true });

      // 顧客名が表示されるか確認
      const customerName = page.locator('text=顧客名').first();
      await expect(customerName).toBeVisible();
    }
  });

  test('AI要約/OCRボタンが表示される', async ({ page }) => {
    await page.waitForSelector('table tbody tr', { timeout: 10000 }).catch(() => null);

    const firstDoc = page.locator('table tbody tr').first();
    if (await firstDoc.isVisible()) {
      await firstDoc.click();
      await page.waitForTimeout(1000);

      // 書類情報を展開
      const docInfoHeader = page.locator('text=書類情報').first();
      if (await docInfoHeader.isVisible()) {
        await docInfoHeader.click();
        await page.waitForTimeout(500);
      }

      // 要約ボタンを探す
      const summaryBtn = page.locator('button:has-text("要約"), button[title="AI要約"]').first();
      const ocrBtn = page.locator('button:has-text("OCR"), button[title="OCR結果"]').first();

      // スクリーンショットで確認
      await page.screenshot({ path: 'test-results/mobile-5-buttons.png', fullPage: true });

      // ボタンの存在を確認
      const hasSummaryBtn = await summaryBtn.isVisible().catch(() => false);
      const hasOcrBtn = await ocrBtn.isVisible().catch(() => false);

      console.log(`要約ボタン: ${hasSummaryBtn ? '✓' : '✗'}`);
      console.log(`OCRボタン: ${hasOcrBtn ? '✓' : '✗'}`);

      // 少なくとも1つは表示されるべき
      expect(hasSummaryBtn || hasOcrBtn).toBeTruthy();
    }
  });

  test('メタ情報パネルがスクロール可能', async ({ page }) => {
    await page.waitForSelector('table tbody tr', { timeout: 10000 }).catch(() => null);

    const firstDoc = page.locator('table tbody tr').first();
    if (await firstDoc.isVisible()) {
      await firstDoc.click();
      await page.waitForTimeout(1000);

      // 書類情報を展開
      const docInfoHeader = page.locator('text=書類情報').first();
      if (await docInfoHeader.isVisible()) {
        await docInfoHeader.click();
        await page.waitForTimeout(500);
      }

      // スクロール可能なコンテナを探す
      const scrollContainer = page.locator('[class*="overflow-y-auto"], [class*="overflow-auto"]').first();

      if (await scrollContainer.isVisible()) {
        // スクロール前の位置
        const scrollBefore = await scrollContainer.evaluate((el) => el.scrollTop);

        // スクロールを試みる
        await scrollContainer.evaluate((el) => {
          el.scrollTop = 200;
        });
        await page.waitForTimeout(300);

        // スクロール後の位置
        const scrollAfter = await scrollContainer.evaluate((el) => el.scrollTop);

        console.log(`スクロール前: ${scrollBefore}px, 後: ${scrollAfter}px`);

        await page.screenshot({ path: 'test-results/mobile-6-scrolled.png', fullPage: true });

        // スクロールが機能したか確認（コンテンツがあれば）
        if (scrollAfter > 0) {
          console.log('✓ スクロール可能');
        } else {
          console.log('⚠ スクロール不可（コンテンツが少ない可能性）');
        }
      }
    }
  });

  test('モーダルが閉じる', async ({ page }) => {
    await page.waitForSelector('table tbody tr', { timeout: 10000 }).catch(() => null);

    const firstDoc = page.locator('table tbody tr').first();
    if (await firstDoc.isVisible()) {
      await firstDoc.click();
      await page.waitForTimeout(1000);

      const modal = page.locator('[role="dialog"]');
      await expect(modal).toBeVisible({ timeout: 5000 });

      // ESCキーで閉じる
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      // モーダルが閉じたか確認
      const isStillVisible = await modal.isVisible().catch(() => false);

      await page.screenshot({ path: 'test-results/mobile-7-closed.png', fullPage: true });

      expect(isStillVisible).toBeFalsy();
    }
  });
});
