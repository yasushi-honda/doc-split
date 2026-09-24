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
import { loginWithTestUser, updateDocumentStatusByFileName, createPendingDocumentForE2E } from './helpers';

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

  /**
   * Issue #1031 コアシナリオ(plan-crossreview Medium#6): アップロード中にモーダルを閉じても
   * バックグラウンドで処理が継続し、他画面へ遷移しても操作でき、完了がトーストで通知されること。
   *
   * 実uploadPdf Cloud Functionは`onCall`ハンドラの先頭でCloud Storageへの書き込みを行うが、
   * この実行環境(`firebase emulators:exec --only auth,firestore,functions`、既存CI設定と同じ、
   * Storageエミュレータ非対象)ではStorageアクセスが失敗する(既存pdf-upload.spec.tsの
   * 冒頭コメント「実際のアップロードはCloud Functions(uploadPdf)が必要」の理由と同じ制約)。
   * そのため`page.route`でuploadPdf呼び出し自体をインターセプトし、Firestoreへ直接
   * status:'pending'のdocumentを作成した上で成功レスポンスを返す(Storage保存を要しない
   * バックグラウンド継続UIの契約のみを検証する)。OCR完了(status:'processed'への遷移)も
   * 同様にCIで実行不能な外部Gemini API呼び出しを要するため、firebase-adminで
   * Firestore Emulatorへ直接書き込みシミュレートする。
   */
  test('アップロード中にEscで閉じる→他画面操作可能→バックグラウンドで完了しトースト表示される', async ({ page }) => {
    const fileName = `e2e-background-upload-${Date.now()}.pdf`;

    await page.route('**/uploadPdf', async (route) => {
      const documentId = await createPendingDocumentForE2E(fileName);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ result: { success: true, documentId } }),
      });
    });

    await page.locator('button:has-text("PDFアップロード")').click();
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    await modal.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 e2e-background-upload-test'),
    });
    await modal.getByRole('button', { name: 'アップロード' }).click();

    // documentId確定(pending)まで待つ = インターセプトしたuploadPdf応答+onSnapshot購読の開始を確認
    await expect(modal.getByText('OCR処理待機中...')).toBeVisible({ timeout: 15000 });

    // uploading中でもEscで閉じられる(常時クローズ可能、Issue #1031の中心要件)
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible({ timeout: 5000 });

    // 他画面へ遷移して操作可能なことを確認(モーダルが閉じても他の画面操作をブロックしない)
    await page.locator('a:has-text("エラー履歴")').click();
    await expect(page.locator('h1:has-text("エラー履歴")')).toBeVisible({ timeout: 10000 });

    // バックグラウンドで処理が継続していることをFirestore側から完了させてシミュレートする
    await updateDocumentStatusByFileName(fileName, 'processed');

    // 完了トースト(PdfUploadBackgroundHost経由、モーダル非表示中のみ表示される)
    await expect(page.getByText('PDFのアップロードが完了しました')).toBeVisible({ timeout: 10000 });
  });
});
