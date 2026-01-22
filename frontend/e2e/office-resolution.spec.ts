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

import { test, expect, Page } from '@playwright/test';

// テストユーザー情報（seed-e2e-data.jsと同じ）
const TEST_USER = {
  email: 'test@example.com',
  password: 'testpassword123',
};

// ============================================
// 認証ヘルパー
// ============================================

/**
 * Emulator環境でメール/パスワードログイン
 * Firebase Auth Emulatorではメール/パスワード認証が使用可能
 */
async function loginWithTestUser(page: Page) {
  // ログインページにアクセス
  await page.goto('/');

  // Emulator環境ではGoogleログインの代わりに
  // Firebase UIのメール/パスワードフォームを使用するか、
  // または直接FirebaseのsignInWithEmailAndPassword APIを呼び出す

  // ここではページ内でFirebase認証を直接実行
  await page.evaluate(
    async ({ email, password }) => {
      // @ts-expect-error - Firebase SDKはグローバルに存在
      const { auth } = await import('/src/lib/firebase.ts');
      // @ts-expect-error - Firebase SDKはグローバルに存在
      const { signInWithEmailAndPassword } = await import('firebase/auth');
      await signInWithEmailAndPassword(auth, email, password);
    },
    { email: TEST_USER.email, password: TEST_USER.password }
  );

  // ログイン後、書類一覧ページが表示されるまで待機
  await page.waitForSelector('text=書類一覧', { timeout: 10000 });
}

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
  // Emulator環境でのみ実行
  test.skip(
    ({ }, testInfo) => !testInfo.project.name.includes('emulator'),
    'Emulator環境でのみ実行'
  );

  test('確認待ちタブに事業所未確定ドキュメントが表示される', async ({ page }) => {
    // ログイン
    await loginWithTestUser(page);

    // 確認待ちタブをクリック
    await page.click('[role="tab"]:has-text("確認待ち")');

    // 事業所バッジが表示される
    const officeBadge = page.locator('text=事業所').first();
    await expect(officeBadge).toBeVisible({ timeout: 10000 });
  });

  test('詳細モーダルに「要確認」バッジが表示される', async ({ page }) => {
    await loginWithTestUser(page);

    // 確認待ちタブ→行クリック
    await page.click('[role="tab"]:has-text("確認待ち")');
    await page.locator('tbody tr:has-text("事業所")').first().click();

    // 詳細モーダルが開く
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible();

    // 事業所欄に「要確認」バッジ
    const badge = modal.locator('text=要確認');
    await expect(badge).toBeVisible();
  });

  test('詳細モーダルに「事業所を確定」ボタンが表示される', async ({ page }) => {
    await loginWithTestUser(page);

    // 確認待ちタブ→行クリック
    await page.click('[role="tab"]:has-text("確認待ち")');
    await page.locator('tbody tr:has-text("事業所")').first().click();

    // 詳細モーダル
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible();

    // 「事業所を確定」ボタンが表示される
    const confirmButton = modal.locator('button:has-text("事業所を確定")');
    await expect(confirmButton).toBeVisible();
  });

  test('事業所解決モーダルが開き候補リストが表示される', async ({ page }) => {
    await loginWithTestUser(page);

    // 確認待ちタブ→行クリック
    await page.click('[role="tab"]:has-text("確認待ち")');
    await page.locator('tbody tr:has-text("事業所")').first().click();

    // 「事業所を確定」ボタンをクリック
    await page.locator('button:has-text("事業所を確定")').click();

    // 事業所解決モーダルが開く
    const resolveModal = page.locator('[role="dialog"]:has-text("事業所の確定")');
    await expect(resolveModal).toBeVisible();

    // 候補リストが表示される
    await expect(resolveModal.locator('text=事業所候補を選択')).toBeVisible();
  });

  test('事業所を選択して確定できる', async ({ page }) => {
    await loginWithTestUser(page);

    // 確認待ちタブ→行クリック
    await page.click('[role="tab"]:has-text("確認待ち")');
    await page.locator('tbody tr:has-text("テスト事業所")').first().click();

    // 「事業所を確定」ボタンをクリック
    await page.locator('button:has-text("事業所を確定")').click();

    // 候補を選択
    const resolveModal = page.locator('[role="dialog"]:has-text("事業所の確定")');
    await resolveModal.locator('[role="radio"]').first().click();

    // 確定ボタンをクリック
    await resolveModal.locator('button:has-text("確定する")').click();

    // モーダルが閉じる
    await expect(resolveModal).not.toBeVisible({ timeout: 5000 });
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
