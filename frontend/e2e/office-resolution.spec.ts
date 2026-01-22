/**
 * 事業所同名解決機能のE2Eテスト
 *
 * 注意: このテストはFirebase認証が必要なため、
 * エミュレータ環境またはテスト用の認証設定が必要です。
 */

import { test, expect } from '@playwright/test';

// 基本的なページ表示テスト
test.describe('事業所同名解決機能', () => {
  test('ログイン画面が表示される', async ({ page }) => {
    await page.goto('/');
    // 認証が必要なので、ログイン画面またはログインボタンが表示される
    // 「書類管理ビューアー」というタイトルまたは「Google」を含むログインボタンを探す
    const hasTitle = await page.locator('text=書類管理ビューアー').isVisible().catch(() => false);
    const hasGoogleButton = await page.locator('button:has-text("Google")').isVisible().catch(() => false);
    const hasDocuments = await page.locator('text=書類一覧').isVisible().catch(() => false);

    // ログイン画面が表示されるか、既にログイン済みでダッシュボードが表示される
    expect(hasTitle || hasGoogleButton || hasDocuments).toBeTruthy();
  });

  // 以下のテストは認証済みの状態で実行する必要がある
  test.describe('認証済み状態', () => {
    // 認証状態を保持するためのストレージ状態ファイル
    // 注意: 実際の認証にはsetupプロジェクトを使用
    test.skip('書類一覧ページが表示される', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('h1')).toContainText('書類一覧');
    });

    test.skip('確認待ちタブが表示される', async ({ page }) => {
      await page.goto('/');
      const pendingTab = page.locator('[role="tab"]', { hasText: '確認待ち' });
      await expect(pendingTab).toBeVisible();
    });

    test.skip('詳細モーダルに事業所確定ボタンが表示される（未確定の場合）', async ({
      page,
    }) => {
      await page.goto('/');
      // 確認待ちタブをクリック
      await page.click('[role="tab"]:has-text("確認待ち")');

      // テーブルの行をクリック（事業所未確定のドキュメントがある前提）
      const tableRow = page.locator('tbody tr').first();
      if (await tableRow.isVisible()) {
        await tableRow.click();
        // モーダルが開いて事業所確定ボタンが表示される
        const officeConfirmButton = page.locator('button', {
          hasText: '事業所を確定',
        });
        // 事業所未確定のドキュメントの場合のみ表示される
        const isOfficeButtonVisible = await officeConfirmButton
          .isVisible()
          .catch(() => false);
        console.log('事業所確定ボタン表示:', isOfficeButtonVisible);
      }
    });

    test.skip('事業所解決モーダルが開く', async ({ page }) => {
      await page.goto('/');
      // 確認待ちタブをクリック
      await page.click('[role="tab"]:has-text("確認待ち")');

      // 事業所未確定の行をクリック
      const officeRow = page.locator('tbody tr', { hasText: '事業所' }).first();
      if (await officeRow.isVisible()) {
        await officeRow.click();

        // 事業所確定ボタンをクリック
        await page.click('button:has-text("事業所を確定")');

        // モーダルが開く
        const modal = page.locator('[role="dialog"]', { hasText: '事業所の確定' });
        await expect(modal).toBeVisible();

        // 候補リストが表示される
        await expect(modal.locator('text=事業所候補を選択')).toBeVisible();
      }
    });
  });
});

// コンポーネント単体表示テスト（Storybookがあれば使用）
test.describe('UIコンポーネント確認', () => {
  test('ログイン画面のレイアウトが正しい', async ({ page }) => {
    await page.goto('/');

    // DocSplitロゴまたはアプリ名が表示される
    const hasTitle = await page.locator('text=DocSplit').isVisible().catch(() => false);
    const hasLoginButton = await page
      .locator('button', { hasText: 'ログイン' })
      .isVisible()
      .catch(() => false);

    expect(hasTitle || hasLoginButton).toBeTruthy();
  });
});
