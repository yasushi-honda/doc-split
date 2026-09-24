/**
 * 契約終了した利用者を書類画面から既定で非表示にする E2Eテスト (Issue #1033)
 *
 * 前提データ: scripts/seed-issue-1033-contract-ended.js
 * - 顧客マスター: 契約終了太郎(Issue1033)(isContractEnded:true) / 契約中花子(Issue1033)(isContractEnded:false)
 * - 書類: 契約終了太郎の確認済み書類1件・未確認書類1件、契約中花子の確認済み書類1件
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

  test('書類一覧: 契約終了利用者の確認済み書類は既定で非表示、未確認書類は表示され続ける', async ({ page }) => {
    await clickTab(page, '書類一覧');

    // 契約中花子の確認済み書類は常に見える
    await expect(page.locator('text=契約中花子(Issue1033)')).toBeVisible({ timeout: 10000 });

    // 契約終了太郎の確認済み書類は既定で非表示、未確認書類は表示される
    await expect(page.locator('text=E2E_Issue1033_契約終了太郎_確認済み.pdf')).not.toBeVisible();
    await expect(page.locator('text=E2E_Issue1033_契約終了太郎_未確認.pdf')).toBeVisible({ timeout: 10000 });

    // 非表示中の補足メッセージが出る
    await expect(page.locator('text=契約終了の利用者の書類 1件を非表示中')).toBeVisible();
  });

  test('一時切替「契約終了の利用者も表示」をONにすると確認済み書類が表示される', async ({ page }) => {
    await clickTab(page, '書類一覧');
    await expect(page.locator('text=E2E_Issue1033_契約終了太郎_未確認.pdf')).toBeVisible({ timeout: 10000 });

    await openFilters(page);
    const toggle = page.locator('label', { hasText: '契約終了の利用者も表示' }).locator('input[type="checkbox"]');
    await toggle.check();

    await expect(page.locator('text=E2E_Issue1033_契約終了太郎_確認済み.pdf')).toBeVisible({ timeout: 10000 });
  });

  test('顧客別タブ: 契約終了利用者のグループは既定で表示されない', async ({ page }) => {
    await clickTab(page, '顧客別');

    await expect(page.locator('text=契約中花子(Issue1033)')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=契約終了太郎(Issue1033)')).not.toBeVisible();
  });

  test('担当CM別タブ: 展開すると契約終了利用者の確認済み書類だけが小グループ件数から消える', async ({ page }) => {
    // 契約終了太郎は確認済み書類1件(非表示対象)+未確認書類1件(表示し続ける対象)を持つため、
    // 小グループ自体は未確認書類の分だけ残り、件数が2件→1件に減ることを確認する
    // (小グループが丸ごと消えるのは、対象顧客の全書類が非表示になる場合のみ)
    await clickTab(page, '担当CM別');

    const cmHeader = page.locator('button', { hasText: '検証三郎(Issue1033)' }).first();
    await expect(cmHeader).toBeVisible({ timeout: 10000 });
    await cmHeader.click();

    // 契約中花子の小グループは見える(確認済み書類1件)
    const activeGroup = page.locator('button', { hasText: '契約中花子(Issue1033)' }).first();
    await expect(activeGroup).toBeVisible({ timeout: 20000 });
    await expect(activeGroup).toContainText('1件');

    // 契約終了太郎の小グループは未確認書類の分だけ残り、1件と表示される(2件ではない)
    const endedGroup = page.locator('button', { hasText: '契約終了太郎(Issue1033)' }).first();
    await expect(endedGroup).toBeVisible();
    await expect(endedGroup).toContainText('1件');

    // 展開(顧客→フォルダの2階層)すると未確認書類のみが見え、確認済み書類は見えない。
    // 確認済み書類(documentType=請求書)は非表示のためフォルダ自体が現れず、
    // 未確認書類(documentType=ケアプラン)のフォルダのみが残る
    await endedGroup.click();
    const folder = page.locator('button', { hasText: 'ケアプラン' }).first();
    await expect(folder).toBeVisible({ timeout: 5000 });
    await folder.click();
    await expect(page.locator('text=E2E_Issue1033_契約終了太郎_未確認.pdf')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=E2E_Issue1033_契約終了太郎_確認済み.pdf')).not.toBeVisible();
  });
});
