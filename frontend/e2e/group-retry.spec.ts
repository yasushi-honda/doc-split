/**
 * グループビュー再試行ボタン E2Eテスト (#524)
 *
 * 検証内容:
 *   - 顧客別タブ: error 書類の行に「再試行」ボタンが表示され、確認ダイアログ経由で再処理できる
 *   - 担当CM別タブ: 顧客サブグループ配下の error 行にも「再試行」が表示される
 *
 * 前提データ: scripts/seed-e2e-data.js の seedGroupRetryTestData
 * (顧客「組合花子」/ 担当CM「五十嵐恵」配下に error 2 件 + processed 1 件。
 *  functions emulator の updateDocumentGroups トリガーが documentGroups を生成する)
 */

import { test, expect } from '@playwright/test';
import { loginWithTestUser, clickTab } from './helpers';

test.describe('グループビュー再試行 (#524) @emulator', () => {
  test.beforeEach(async ({ page }) => {
    await loginWithTestUser(page);
  });

  test('顧客別タブの error 行から再処理を実行できる', async ({ page }) => {
    await clickTab(page, '顧客別');

    // 顧客グループを展開
    const groupHeader = page.locator('button', { hasText: '組合花子' }).first();
    await expect(groupHeader).toBeVisible({ timeout: 10000 });
    await groupHeader.click();

    // error 行に「再試行」ボタンが表示される
    const retryButton = page.locator('button:has-text("再試行")').first();
    await expect(retryButton).toBeVisible({ timeout: 10000 });
    await retryButton.click();

    // 確認ダイアログ（対象ファイル名 + リセット内容の説明）
    await expect(page.locator('text=再処理を実行しますか？')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('text=エラー状態の書類のOCR処理を再実行します')).toBeVisible();

    // 実行 → 成功トースト
    await page.locator('button:has-text("再処理を実行")').click();
    await expect(page.locator('text=再処理をリクエストしました')).toBeVisible({ timeout: 5000 });
  });

  test('担当CM別タブの顧客サブグループ配下 error 行に再試行ボタンが表示されキャンセルできる', async ({ page }) => {
    await clickTab(page, '担当CM別');

    // 担当CMグループを展開
    const cmHeader = page.locator('button', { hasText: '五十嵐恵' }).first();
    await expect(cmHeader).toBeVisible({ timeout: 10000 });
    await cmHeader.click();

    // 顧客サブグループを展開
    const customerHeader = page.locator('button', { hasText: '組合花子' }).first();
    await expect(customerHeader).toBeVisible({ timeout: 10000 });
    await customerHeader.click();

    // error 行の「再試行」→ ダイアログ表示 → キャンセルで閉じる
    const retryButton = page.locator('button:has-text("再試行")').first();
    await expect(retryButton).toBeVisible({ timeout: 10000 });
    await retryButton.click();

    await expect(page.locator('text=再処理を実行しますか？')).toBeVisible({ timeout: 3000 });
    await page.locator('button:has-text("キャンセル")').click();
    await expect(page.locator('text=再処理を実行しますか？')).not.toBeVisible({ timeout: 3000 });
  });
});
