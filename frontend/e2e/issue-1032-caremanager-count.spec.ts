/**
 * 担当CM別の件数不正確 E2Eテスト (Issue #1032)
 *
 * 検証内容:
 *   - 担当CM別タブでCMグループを展開すると、無限スクロール(pageSize=100)で
 *     複数ページ(本テストでは150件=2ページ)にまたがる書類でも、実Firestore
 *     (emulator)からの自動全件読み込みが完了し、正確な利用者別・書類種別
 *     フォルダ別の件数が表示されることを確認する。
 *   - GroupDocumentList.test.tsx(コンポーネント単体テスト、useGroupDocumentsを
 *     モック)では検証できない「実Firestoreに対する複数ページ取得が実際に
 *     動作し、最終的に正しい件数へ収束するか」を担保する。
 *
 * 前提データ: scripts/seed-issue-1032-caremanager.js
 * (担当CM「検証太郎(Issue1032)」配下、利用者「検証花子(Issue1032)」90件
 *  (請求書45/ケアプラン45)+「検証次郎(Issue1032)」60件(請求書30/ケアプラン30)
 *  = 計150件。functions emulatorのupdateDocumentGroupsトリガーがdocumentGroupsを生成)
 */

import { test, expect } from '@playwright/test';
import { loginWithTestUser, clickTab } from './helpers';

test.describe('担当CM別の件数不正確 (#1032) @emulator', () => {
  test.beforeEach(async ({ page }) => {
    await loginWithTestUser(page);
  });

  test('CM展開後、全150件の自動読み込み完了を待つと利用者別・フォルダ別の件数が正確に表示される', async ({ page }) => {
    await clickTab(page, '担当CM別');

    const cmHeader = page.locator('button', { hasText: '検証太郎(Issue1032)' }).first();
    await expect(cmHeader).toBeVisible({ timeout: 10000 });
    await cmHeader.click();

    // 全ページ(150件、pageSize=100につき2ページ)の自動読み込み完了を待つ。
    // 完了前は「件数を集計中」ローディングのままCustomerSubGroupが描画されない
    // (GroupDocumentList.tsx isFullyLoaded判定)ため、利用者行が見えることが
    // 完了の証跡になる。
    const customerA = page.locator('button', { hasText: '検証花子(Issue1032)' }).first();
    const customerB = page.locator('button', { hasText: '検証次郎(Issue1032)' }).first();
    await expect(customerA).toBeVisible({ timeout: 20000 });
    await expect(customerB).toBeVisible({ timeout: 20000 });

    // 利用者別の件数(90件/60件、部分読み込みではなく全件読み込み後の確定値)
    await expect(customerA).toContainText('90件');
    await expect(customerB).toContainText('60件');

    // 花子(90件)を展開し、書類種別フォルダ別の内訳(請求書45件/ケアプラン45件)を確認
    await customerA.click();
    const invoiceFolder = page.locator('button', { hasText: '請求書' }).first();
    const carePlanFolder = page.locator('button', { hasText: 'ケアプラン' }).first();
    await expect(invoiceFolder).toContainText('45件');
    await expect(carePlanFolder).toContainText('45件');
  });
});
