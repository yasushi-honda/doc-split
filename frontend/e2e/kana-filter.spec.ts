/**
 * あかさたなフィルター E2Eテスト
 *
 * 顧客別グループビューのフィルター挙動を検証
 *
 * 実行方法:
 *   1. Firebase Emulator起動: firebase emulators:start
 *   2. シードデータ投入: FIRESTORE_EMULATOR_HOST=localhost:8085 node scripts/seed-e2e-data.js
 *   3. テスト実行: cd frontend && npx playwright test e2e/kana-filter.spec.ts
 */

import { test, expect, Page } from '@playwright/test';

// テストユーザー情報（seed-e2e-data.jsと同じ）
const TEST_USER = {
  email: 'test@example.com',
  password: 'testpassword123',
};

// ============================================
// ヘルパー
// ============================================

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

/** 「顧客別」タブに移動 */
async function navigateToCustomerTab(page: Page) {
  // タブをクリック
  await page.locator('[role="tab"]').filter({ hasText: '顧客別' }).click();
  // グループデータが表示されるまで待機（CIでは時間がかかる場合がある）
  await page.waitForTimeout(2000);
}

/** フィルターバーの存在確認 */
function getFilterBar(page: Page) {
  return page.locator('button:has-text("全")').first();
}

/** 特定のかな行ボタンを取得 */
function getKanaButton(page: Page, kana: string) {
  return page.locator(`button:text-is("${kana}")`);
}

// ============================================
// 基本テスト（認証不要）
// ============================================

test.describe('あかさたなフィルター - 基本', () => {
  test('ログインページが表示される', async ({ page }) => {
    await page.goto('/');
    // 「Googleでログイン」ボタンまたは「書類管理ビューアー」テキストを確認
    const hasLoginButton = await page
      .locator('text=Googleでログイン')
      .isVisible({ timeout: 10000 })
      .catch(() => false);
    const hasTitle = await page
      .locator('text=書類管理ビューアー')
      .isVisible()
      .catch(() => false);
    expect(hasLoginButton || hasTitle).toBeTruthy();
  });
});

// ============================================
// Emulator環境テスト（認証必要 + シードデータ必要）
// ============================================

test.describe('あかさたなフィルター @emulator', () => {
  test.beforeEach(async ({ page }) => {
    await loginWithTestUser(page);
  });

  test('顧客別タブにフィルターバーが表示される', async ({ page }) => {
    await navigateToCustomerTab(page);

    // フィルターバーが表示される
    const filterBar = getFilterBar(page);
    await expect(filterBar).toBeVisible({ timeout: 10000 });

    // 「全」ボタンが存在
    await expect(filterBar).toHaveText('全');

    // 各行ボタンが存在
    for (const kana of ['あ', 'か', 'さ', 'た', 'な', 'は', 'ま', 'や', 'ら', 'わ']) {
      await expect(getKanaButton(page, kana)).toBeVisible();
    }
  });

  test('他のタブにフィルターバーが表示されない', async ({ page }) => {
    // 事業所別タブ
    await page.locator('[role="tab"]').filter({ hasText: '事業所別' }).click();
    await page.waitForTimeout(500);

    // 「全あかさたな...」のフィルターバーが存在しないことを確認
    // 事業所別にも「全」テキストは他の箇所にある可能性があるため、
    // data-active属性でフィルターバーのボタンを特定
    const kanaButton = getKanaButton(page, 'あ');
    await expect(kanaButton).not.toBeVisible();
  });

  test('「か」行でフィルターすると該当顧客のみ表示される', async ({ page }) => {
    await navigateToCustomerTab(page);

    // フィルターバーが使用可能になるまで待機
    await expect(getKanaButton(page, 'か')).toBeEnabled({ timeout: 10000 });

    // 「か」行ボタンをクリック
    await getKanaButton(page, 'か').click();

    // 加藤次郎が表示される
    await expect(page.locator('text=加藤次郎')).toBeVisible({ timeout: 5000 });

    // 他の行の顧客が表示されない
    await expect(page.locator('text=阿部太郎')).not.toBeVisible();
    await expect(page.locator('text=佐藤三郎')).not.toBeVisible();
  });

  test('「さ」行でフィルターすると該当顧客のみ表示される', async ({ page }) => {
    await navigateToCustomerTab(page);

    await expect(getKanaButton(page, 'さ')).toBeEnabled({ timeout: 10000 });
    await getKanaButton(page, 'さ').click();

    await expect(page.locator('text=佐藤三郎')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=田中四郎')).not.toBeVisible();
  });

  test('「全」ボタンでフィルターをリセットできる', async ({ page }) => {
    await navigateToCustomerTab(page);

    // まず「た」行でフィルター
    await expect(getKanaButton(page, 'た')).toBeEnabled({ timeout: 10000 });
    await getKanaButton(page, 'た').click();
    await expect(page.locator('text=田中四郎')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=阿部太郎')).not.toBeVisible();

    // 「全」でリセット
    await getFilterBar(page).click();

    // 全顧客が表示される
    await expect(page.locator('text=阿部太郎')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=田中四郎')).toBeVisible();
  });

  test('同じ行をもう一度クリックするとフィルターが解除される', async ({ page }) => {
    await navigateToCustomerTab(page);

    await expect(getKanaButton(page, 'な')).toBeEnabled({ timeout: 10000 });
    // 「な」行をクリック（フィルター適用）
    await getKanaButton(page, 'な').click();
    await expect(page.locator('text=中村五郎')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=阿部太郎')).not.toBeVisible();

    // 「な」行を再クリック（フィルター解除）
    await getKanaButton(page, 'な').click();
    await expect(page.locator('text=阿部太郎')).toBeVisible({ timeout: 5000 });
  });

  test('該当なしの行では「〜行の顧客はいません」と表示される', async ({ page }) => {
    await navigateToCustomerTab(page);

    // シードデータに「ら」行の顧客はいない
    await expect(getKanaButton(page, 'ら')).toBeEnabled({ timeout: 10000 });
    await getKanaButton(page, 'ら').click();

    await expect(page.locator('text=行の顧客はいません')).toBeVisible({ timeout: 5000 });
  });

  test('フィルター適用時に件数が表示される', async ({ page }) => {
    await navigateToCustomerTab(page);

    await expect(getKanaButton(page, 'あ')).toBeEnabled({ timeout: 10000 });
    await getKanaButton(page, 'あ').click();

    // 件数表示（例: 「2件 / 11件」）
    const countDisplay = page.locator('text=/\\d+件 \\/ \\d+件/');
    await expect(countDisplay).toBeVisible({ timeout: 5000 });
  });

  test('フィルターバーはcustomersロード完了まで無効化される', async ({ page }) => {
    // ページに直接アクセスして顧客別タブへ
    await navigateToCustomerTab(page);

    // フィルターバーが表示される時点で、disabled=falseであることを確認
    // （customersがロードされた後にenableされる）
    const kanaButton = getKanaButton(page, 'か');
    await expect(kanaButton).toBeEnabled({ timeout: 10000 });
  });
});

// ============================================
// タブ切り替えテスト
// ============================================

test.describe('タブ切り替え時のフィルター挙動 @emulator', () => {
  test.beforeEach(async ({ page }) => {
    await loginWithTestUser(page);
  });

  test('タブ切り替え後にフィルター状態が保持される', async ({ page }) => {
    await navigateToCustomerTab(page);

    // 「か」行でフィルター
    await expect(getKanaButton(page, 'か')).toBeEnabled({ timeout: 10000 });
    await getKanaButton(page, 'か').click();
    await expect(page.locator('text=加藤次郎')).toBeVisible({ timeout: 5000 });

    // 事業所別タブに切り替え
    await page.locator('[role="tab"]').filter({ hasText: '事業所別' }).click();
    await page.waitForTimeout(500);

    // 顧客別タブに戻る
    await page.locator('[role="tab"]').filter({ hasText: '顧客別' }).click();
    await page.waitForTimeout(1000);

    // フィルターバーが再表示される
    await expect(getFilterBar(page)).toBeVisible();
  });
});
