/**
 * 契約終了した利用者を書類画面から既定で非表示にする E2Eテスト (Issue #1033)
 *
 * 前提データ: scripts/seed-issue-1033-contract-ended.js
 * - 利用者マスター: 契約終了太郎(Issue1033)(isContractEnded:true) / 契約中花子(Issue1033)(isContractEnded:false)
 * - 書類: 契約終了太郎の確認済み書類1件・未確認書類1件、契約中花子の確認済み書類1件
 *   (2026-10-27: 契約終了の利用者は確認済み・未確認を問わず既定で非表示)
 *   (共通の担当CM「検証三郎(Issue1033)」配下)
 */

import { test, expect } from '@playwright/test';
import { loginWithTestUser, clickTab } from './helpers';

async function openFilters(page: import('@playwright/test').Page) {
  const filterButton = page.getByRole('button', { name: 'フィルター' });
  await filterButton.click();
}

test.describe('契約終了した利用者の非表示 (#1033) @emulator', () => {
  test.beforeEach(async ({ page }) => {
    await loginWithTestUser(page);
  });

  test('書類一覧: 契約終了利用者の書類は確認済み・未確認とも既定で非表示', async ({ page }) => {
    await clickTab(page, '書類一覧');

    // 契約中花子の確認済み書類は常に見える
    await expect(page.locator('text=契約中花子(Issue1033)')).toBeVisible({ timeout: 10000 });

    // 契約終了太郎の書類は確認済み・未確認とも既定で非表示
    await expect(page.locator('text=E2E_Issue1033_契約終了太郎_確認済み.pdf')).not.toBeVisible();
    await expect(page.locator('text=E2E_Issue1033_契約終了太郎_未確認.pdf')).not.toBeVisible();

    // 非表示中の補足メッセージが出る
    await expect(page.locator('text=契約終了の利用者の書類 2件を非表示中')).toBeVisible();
  });

  test('一時切替「契約終了の利用者も表示」をONにすると確認済み・未確認とも表示される', async ({ page }) => {
    await clickTab(page, '書類一覧');
    await expect(page.locator('text=契約中花子(Issue1033)')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=E2E_Issue1033_契約終了太郎_未確認.pdf')).not.toBeVisible();

    await openFilters(page);
    const toggle = page.locator('label', { hasText: '契約終了の利用者も表示' }).locator('input[type="checkbox"]');
    await toggle.check();

    await expect(page.locator('text=E2E_Issue1033_契約終了太郎_確認済み.pdf')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=E2E_Issue1033_契約終了太郎_未確認.pdf')).toBeVisible({ timeout: 10000 });
  });

  test('利用者別タブ: 契約終了利用者のグループは既定で表示されない', async ({ page }) => {
    await clickTab(page, '利用者別');

    await expect(page.locator('text=契約中花子(Issue1033)')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=契約終了太郎(Issue1033)')).not.toBeVisible();
  });

  test('担当CM別タブ: 契約終了利用者の小グループは確認済み・未確認とも非表示で、契約中の小グループだけ残る', async ({ page }) => {
    await clickTab(page, '担当CM別');

    const cmHeader = page.locator('button', { hasText: '検証三郎(Issue1033)' }).first();
    await expect(cmHeader).toBeVisible({ timeout: 10000 });
    await cmHeader.click();

    // 契約中花子の小グループは見える(確認済み書類1件)
    const activeGroup = page.locator('button', { hasText: '契約中花子(Issue1033)' }).first();
    await expect(activeGroup).toBeVisible({ timeout: 20000 });
    await expect(activeGroup).toContainText('1件');

    // 契約終了太郎の小グループは全書類が非表示対象のため現れない
    await expect(page.locator('button', { hasText: '契約終了太郎(Issue1033)' })).toHaveCount(0);
  });
});
