import { test, expect, devices } from '@playwright/test'

// モバイルデバイスでテスト
test.use({ ...devices['iPhone 14'] })

test.describe('モバイル ポップアップ機能', () => {
  test.beforeEach(async ({ page }) => {
    // 本番環境にアクセス
    await page.goto('https://doc-split-dev.web.app/')

    // ログインが必要な場合はスキップ（認証済みの状態を想定）
    // 実際のテストではログイン処理が必要
  })

  test('AI要約ポップアップが開閉できる', async ({ page }) => {
    // ログイン画面が表示されたらスキップ
    const loginButton = page.locator('text=Googleでログイン')
    if (await loginButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      test.skip()
      return
    }

    // 書類一覧が表示されるまで待機
    await page.waitForSelector('[data-testid="document-list"], .document-card, [class*="card"]', { timeout: 10000 })

    // 最初の書類をクリック
    const firstDoc = page.locator('[data-testid="document-item"], .document-card, [class*="card"]').first()
    if (await firstDoc.isVisible()) {
      await firstDoc.click()
    }

    // モーダルが開くまで待機
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 })

    // AI要約ボタンをクリック
    const summaryButton = page.locator('button:has-text("要約")')
    await expect(summaryButton).toBeVisible()
    await summaryButton.click()

    // ポップアップが表示される
    await expect(page.locator('text=AI要約').last()).toBeVisible()

    // ×ボタンで閉じる
    const closeButton = page.locator('[class*="rounded-full"]:has(svg)').last()
    await closeButton.click()

    // ポップアップが閉じたことを確認
    await expect(page.locator('.fixed.inset-0.z-\\[9999\\]')).not.toBeVisible({ timeout: 3000 })
  })
})
