/**
 * 再処理ボタン E2Eテスト
 *
 * 修正内容の検証:
 *   - #119: AlertDialogAction → Button に変更し、async処理と競合しない
 *   - #120: AlertDialog内のクリックで親Dialogが閉じない
 *
 * 実行方法:
 *   1. Firebase Emulator起動: firebase emulators:start
 *   2. シードデータ投入: FIRESTORE_EMULATOR_HOST=localhost:8085 FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 GCLOUD_PROJECT=doc-split-dev node scripts/seed-e2e-data.js
 *   3. テスト実行: cd frontend && CI=true E2E_BASE_URL=http://localhost:3000 npx playwright test e2e/reprocess-button.spec.ts
 */

import { test, expect } from '@playwright/test';
import { loginWithTestUser } from './helpers';

/** ステータスフィルターで「エラー」に絞り込み、エラー書類の詳細モーダルを開く */
async function openErrorDocument(page: import('@playwright/test').Page) {
  // テーブルが表示されるまで待つ
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 10000 });

  // フィルターボタンをクリックして展開
  await page.locator('button:has-text("フィルター")').click();
  await page.waitForTimeout(300);

  // ステータスフィルターのSelectをクリック（デフォルト: "完了"）
  const statusSelect = page.locator('label:has-text("ステータス")').locator('..').locator('button[role="combobox"]');
  await statusSelect.click();
  await page.waitForTimeout(200);

  // 「エラー」を選択
  await page.locator('[role="option"]:has-text("エラー")').click();
  await page.waitForTimeout(500);

  // エラー書類の行をクリック
  const errorRow = page.locator('tbody tr').first();
  await expect(errorRow).toBeVisible({ timeout: 10000 });
  await errorRow.click();

  // モーダルが開くのを待つ
  const modal = page.locator('[role="dialog"]');
  await expect(modal).toBeVisible({ timeout: 5000 });
  return modal;
}

test.describe('再処理ボタン @emulator', () => {
  test.beforeEach(async ({ page }) => {
    await loginWithTestUser(page);
  });

  test('エラー書類の詳細モーダルに再処理ボタンが表示される', async ({ page }) => {
    const modal = await openErrorDocument(page);

    // ステータスバッジに「エラー」が表示
    await expect(modal.locator('text=エラー').first()).toBeVisible();

    // 再処理ボタンが表示される
    const reprocessButton = modal.locator('button:has-text("再処理")');
    await expect(reprocessButton).toBeVisible();
  });

  test('再処理ボタンをクリックすると確認ダイアログが表示される', async ({ page }) => {
    const modal = await openErrorDocument(page);

    // 再処理ボタンをクリック
    const reprocessButton = modal.locator('button:has-text("再処理")');
    await reprocessButton.click();

    // 確認ダイアログが表示される
    await expect(page.locator('text=再処理を実行しますか？')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('text=この書類のOCR処理を再実行します')).toBeVisible();
  });

  test('確認ダイアログのキャンセルでダイアログが閉じる（#120修正確認）', async ({ page }) => {
    const modal = await openErrorDocument(page);

    // 再処理ボタン→確認ダイアログ表示
    await modal.locator('button:has-text("再処理")').click();
    await expect(page.locator('text=再処理を実行しますか？')).toBeVisible({ timeout: 3000 });

    // キャンセルをクリック
    await page.locator('button:has-text("キャンセル")').click();

    // 確認ダイアログが閉じる
    await expect(page.locator('text=再処理を実行しますか？')).not.toBeVisible({ timeout: 3000 });

    // 親の詳細モーダルはまだ開いている（#120の修正確認）
    await expect(modal).toBeVisible();
  });

  test('再処理を実行ボタンが押せてトーストが表示される（#119修正確認）', async ({ page }) => {
    const modal = await openErrorDocument(page);

    // 再処理ボタン→確認ダイアログ
    await modal.locator('button:has-text("再処理")').click();
    await expect(page.locator('text=再処理を実行しますか？')).toBeVisible({ timeout: 3000 });

    // 「再処理を実行」ボタンをクリック（#119: AlertDialogAction → Button への修正確認）
    const executeButton = page.locator('button:has-text("再処理を実行")');
    await expect(executeButton).toBeEnabled();
    await executeButton.click();

    // 成功トーストが表示される
    await expect(page.locator('text=再処理をリクエストしました')).toBeVisible({ timeout: 5000 });

    // モーダルが自動で閉じる（1.5秒後）
    await expect(modal).not.toBeVisible({ timeout: 5000 });
  });
});
