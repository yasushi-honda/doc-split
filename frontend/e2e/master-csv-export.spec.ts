/**
 * マスター一括修正用のCSVダウンロード/編集機能 E2Eテスト (Issue #1036)
 *
 * 前提データ: scripts/seed-issue-1036-csv-export.js
 * - 顧客マスター: 検証太郎(Issue1036)(id=issue1036-cust-1、担当ケアマネ=検証花子(Issue1036)、
 *   備考=初期備考(Issue1036)、別表記=初期別表記(Issue1036))
 */

import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { loginWithTestUser } from './helpers';

const CUSTOMER_ID = 'issue1036-cust-1';
const CUSTOMER_NAME = '検証太郎(Issue1036)';

test.describe('マスター一括修正用のCSVダウンロード/編集機能 (#1036) @emulator', () => {
  test.beforeEach(async ({ page }) => {
    await loginWithTestUser(page);
    await page.getByRole('link', { name: 'マスター' }).click();
    await page.waitForURL('**/masters');
    await expect(page.locator(`text=${CUSTOMER_NAME}`)).toBeVisible({ timeout: 10000 });
  });

  test('エクスポート→改行を含む備考・別表記を編集して再インポート→ID一致で反映され、名前は変更されない', async ({ page }) => {
    // 1. エクスポートしたCSVの中身を確認(id列・headers英語名・既存値)
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'エクスポート' }).click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    if (!downloadPath) throw new Error('download path is null');
    const exportedContent = fs.readFileSync(downloadPath, 'utf-8').replace(/^\uFEFF/, '');

    expect(exportedContent.split('\n')[0]).toBe('id,name,furigana,careManagerName,notes,aliases');
    expect(exportedContent).toContain(CUSTOMER_ID);
    expect(exportedContent).toContain(CUSTOMER_NAME);
    expect(exportedContent).toContain('検証花子(Issue1036)');
    expect(exportedContent).toContain('初期備考(Issue1036)');
    expect(exportedContent).toContain('初期別表記(Issue1036)');

    // 2. 改行を含む備考・別表記を書き換え、名前変更を試み、担当ケアマネ列は空欄にしたCSVを作成
    const editedCsv =
      'id,name,furigana,careManagerName,notes,aliases\n' +
      `${CUSTOMER_ID},検証太郎(改名試行),ケンショウタロウ(Issue1036),,"更新後備考1行目\n更新後備考2行目",新別表記A|新別表記B\n`;

    await page.getByRole('button', { name: 'CSVインポート' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await page.locator('input[type="file"]').setInputFiles({
      name: 'edited-customers.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(editedCsv, 'utf-8'),
    });

    // 3. プレビューで「ID一致」区分として表示され、名前は変更されていないこと
    await expect(dialog.locator('text=IDが一致（既存データを更新）')).toBeVisible({ timeout: 10000 });
    await expect(dialog).toContainText(CUSTOMER_NAME);
    await expect(dialog).not.toContainText('検証太郎(改名試行)');

    // 4. インポート実行(ID一致は既定で上書きON)
    await dialog.getByRole('button', { name: /件追加/ }).click();
    await expect(dialog.locator('text=インポート完了')).toBeVisible({ timeout: 10000 });
    await dialog.getByRole('button', { name: '閉じる' }).click();
    await expect(dialog).not.toBeVisible();

    // 5. 一覧の顧客名が変わっていないこと(改名が反映されていないこと)
    await expect(page.locator(`text=${CUSTOMER_NAME}`)).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=検証太郎(改名試行)')).not.toBeVisible();

    // 6. 再エクスポートして、改行を含む備考のラウンドトリップ・別表記の置換・
    //    空欄にした担当ケアマネ列が元の値のまま残っていることを確認
    const downloadPromise2 = page.waitForEvent('download');
    await page.getByRole('button', { name: 'エクスポート' }).click();
    const download2 = await downloadPromise2;
    const downloadPath2 = await download2.path();
    if (!downloadPath2) throw new Error('download path is null');
    const reExportedContent = fs.readFileSync(downloadPath2, 'utf-8').replace(/^\uFEFF/, '');

    expect(reExportedContent).toContain(CUSTOMER_NAME); // 名前は変わっていない
    expect(reExportedContent).not.toContain('検証太郎(改名試行)');
    expect(reExportedContent).toContain('検証花子(Issue1036)'); // 空欄にした担当ケアマネは元の値のまま
    expect(reExportedContent).toContain('"更新後備考1行目\n更新後備考2行目"'); // 改行を含む備考がラウンドトリップ
    expect(reExportedContent).toContain('新別表記A|新別表記B'); // 別表記が置換されている
    expect(reExportedContent).not.toContain('初期別表記(Issue1036)');
  });
});
