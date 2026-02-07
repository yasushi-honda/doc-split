/**
 * PDFアップロード E2Eテスト
 *
 * アップロードモーダルのUI表示・操作を検証
 * ※実際のアップロードはCloud Functions（uploadPdf）が必要なため、
 *   モーダルUI操作のみテスト
 *
 * 実行方法:
 *   1. Firebase Emulator起動: firebase emulators:start
 *   2. シードデータ投入: FIRESTORE_EMULATOR_HOST=localhost:8085 node scripts/seed-e2e-data.js
 *   3. テスト実行: cd frontend && npx playwright test e2e/pdf-upload.spec.ts
 */

import { test, expect } from '@playwright/test';
import { loginWithTestUser } from './helpers';

// ============================================
// Emulator環境テスト（認証必要）
// ============================================

test.describe('PDFアップロード @emulator', () => {
  test.beforeEach(async ({ page }) => {
    await loginWithTestUser(page);
  });

  test('アップロードボタンをクリックするとモーダルが開く', async ({ page }) => {
    await page.locator('button:has-text("PDFアップロード")').click();

    // モーダルが表示される
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });
  });

  test('アップロードモーダルにファイル選択エリアがある', async ({ page }) => {
    await page.locator('button:has-text("PDFアップロード")').click();

    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // ファイル入力要素が存在する
    const fileInput = modal.locator('input[type="file"]');
    await expect(fileInput).toBeAttached();
  });

  test('アップロードモーダルを閉じることができる', async ({ page }) => {
    await page.locator('button:has-text("PDFアップロード")').click();

    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // ESCキーで閉じる
    await page.keyboard.press('Escape');

    await expect(modal).not.toBeVisible({ timeout: 5000 });
  });

  test('PDF以外のファイルは選択できない', async ({ page }) => {
    await page.locator('button:has-text("PDFアップロード")').click();

    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // ファイル入力のaccept属性を確認
    const fileInput = modal.locator('input[type="file"]');
    const accept = await fileInput.getAttribute('accept');
    expect(accept).toContain('pdf');
  });
});
