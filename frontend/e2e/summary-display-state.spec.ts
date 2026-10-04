/**
 * AI要約 8状態UI E2Eテスト (ADR-0027 PR4c)
 *
 * crossreview指摘反映: 既存 mobile-popup.spec.ts はdev本番URL直書き・`@emulator`タグなしのため
 * 回帰保証にならない。本specは`@emulator`タグ + `loginWithTestUser`ヘルパーを使い、
 * document-detail.spec.ts / mobile-pdf-view.spec.ts と同じ構成で書く。
 *
 * 実行方法:
 *   1. Firebase Emulator起動: firebase emulators:start --only auth,firestore,functions,storage
 *   2. テストユーザー作成: FIRESTORE_EMULATOR_HOST=localhost:8085 node scripts/setup-e2e-user.js
 *   3. シードデータ投入: FIRESTORE_EMULATOR_HOST=localhost:8085 node scripts/seed-adr0027-pr4c-summary-states.js
 *   4. テスト実行: cd frontend && npx playwright test e2e/summary-display-state.spec.ts
 */

import { test, expect, Page, Locator } from '@playwright/test';
import { loginWithTestUser as _loginWithTestUser } from './helpers';

/** summaryDisplayState.tsのSUMMARY_QUEUED_MESSAGEと同文(文言変更時はここも更新する) */
const QUEUED_MESSAGE =
  '要約の作成を受け付けました。バックグラウンドで作成するので、他の操作を続けられます(目安: 数分〜10分)。完了すると自動で表示されます';

async function openDocByFileName(page: Page, fileNameSubstring: string) {
  const row = page.locator(`tbody tr:has-text("${fileNameSubstring}")`).first();
  await expect(row).toBeVisible({ timeout: 10000 });
  await row.click();
  const modal = page.locator('[role="dialog"]');
  await expect(modal).toBeVisible({ timeout: 5000 });
  return modal;
}

/**
 * デスクトップのAI要約アコーディオン見出しボタン。モバイル用トリガーボタン(`md:hidden`)も
 * 同じ文言「AI要約」を含みDOM順で先に現れるため、`.first()`では誤ってそちらを掴む。
 * デスクトップ表示(chromiumプロジェクト、md以上のviewport)では実際に可視な方を選ぶ。
 */
function summaryAccordionHeader(modal: Locator) {
  return modal.locator('button:has-text("AI要約"):visible').first();
}

/**
 * AI要約アコーディオンが開いた状態を保証する。expandedSectionの初期値は'summary'
 * (デフォルト展開)だが、ヘッダーをクリックするとトグルで閉じてしまうため、既に開いている
 * 場合は何もしない。
 */
async function ensureSummaryAccordionExpanded(modal: Locator) {
  const header = summaryAccordionHeader(modal);
  // ヘッダーの直後の兄弟divが展開時のコンテンツ領域(JSX上、expandedSection==='summary'の
  // 条件付きレンダリングでheaderのすぐ後ろに挿入される)。aria-expanded等の属性は
  // このボタンに付与されていないため、DOM構造から展開状態を判定する。
  // Radixダイアログのマウント直後はfade-in/zoom-inアニメーション中で、実際には展開済みでも
  // 一瞬isVisible()がfalseを返しうる(実機で観測)。waitForで短時間リトライしてから
  // 「本当に閉じている」と判定する。
  const content = header.locator('xpath=following-sibling::div[1]');
  const isExpanded = await content
    .waitFor({ state: 'visible', timeout: 2000 })
    .then(() => true)
    .catch(() => false);
  if (!isExpanded) {
    await header.click();
  }
}

test.describe('AI要約 8状態UI (デスクトップ) @emulator', () => {
  test.beforeEach(async ({ page }) => {
    await _loginWithTestUser(page);
  });

  test('generated: 要約本文 + 「再生成」ボタンが表示される', async ({ page }) => {
    const modal = await openDocByFileName(page, 'E2E_PR4c_generated.pdf');
    await ensureSummaryAccordionExpanded(modal);
    await expect(modal.locator('text=PR4c検証用の生成済み要約テキストです。')).toBeVisible();
    await expect(modal.locator('text=AI生成・要確認')).toBeVisible();
    await expect(modal.locator('button:has-text("再生成")')).toBeVisible();
  });

  test('queued: 手動依頼の案内文言が表示され、生成ボタンは出ない(受付済み)', async ({ page }) => {
    const modal = await openDocByFileName(page, 'E2E_PR4c_queued');
    await ensureSummaryAccordionExpanded(modal);
    await expect(modal.locator(`text=${QUEUED_MESSAGE}`)).toBeVisible();
    await expect(modal.locator('button:has-text("今すぐ生成")')).toHaveCount(0);
    await expect(modal.locator('button:has-text("AI要約を生成")')).toHaveCount(0);
  });

  test('queued(再生成依頼中): 案内文言 + 旧要約が薄く保持される', async ({ page }) => {
    const modal = await openDocByFileName(page, 'E2E_PR4c_regenerate_queued');
    await ensureSummaryAccordionExpanded(modal);
    await expect(modal.locator(`text=${QUEUED_MESSAGE}`)).toBeVisible();
    await expect(modal.locator('text=PR4c検証用の旧要約テキストです。')).toBeVisible();
  });

  test('generated-with-failure: 旧要約 + 「前回の要約です。今回の再作成は失敗しました」 + 理由 + 「再試行」', async ({ page }) => {
    const modal = await openDocByFileName(page, 'E2E_PR4c_generated_with_failure');
    await ensureSummaryAccordionExpanded(modal);
    await expect(modal.locator('text=PR4c検証用の旧要約テキストです。')).toBeVisible();
    await expect(modal.locator('text=前回の要約です。今回の再作成は失敗しました')).toBeVisible();
    await expect(modal.locator('text=固有名詞')).toBeVisible();
    await expect(modal.locator('button:has-text("再試行")')).toBeVisible();
  });

  test('generated-with-failure(skipped): 再生成がskippedでも旧要約を「生成済み」に見せず失敗理由を併記する', async ({ page }) => {
    const modal = await openDocByFileName(page, 'E2E_PR4c_generated_skipped_rerun');
    await ensureSummaryAccordionExpanded(modal);
    await expect(modal.locator('text=PR4c検証用の旧要約テキストです。')).toBeVisible();
    await expect(modal.locator('text=前回の要約です。今回の再作成は失敗しました')).toBeVisible();
    await expect(modal.locator('text=要約の対象外、または原文を読み込めなかったため、再作成できませんでした')).toBeVisible();
  });

  test('absent(ocrResultUrlオフロード): detail側ocrResultが空でも「AI要約を生成」が出る(要約済みなら先頭8,000字の注記)', async ({ page }) => {
    const modal = await openDocByFileName(page, 'E2E_PR4c_absent_ocr-url-offload');
    await ensureSummaryAccordionExpanded(modal);
    await expect(modal.locator('button:has-text("AI要約を生成")')).toBeVisible();
  });

  test('generated(オフロード): 「長い書類のため、先頭約8,000字を要約しています」の注記が出る', async ({ page }) => {
    const modal = await openDocByFileName(page, 'E2E_PR4c_generated_offload');
    await ensureSummaryAccordionExpanded(modal);
    await expect(modal.locator('text=長い書類のため、先頭約8,000字を要約しています')).toBeVisible();
  });

  test('failed(fabrication_suspected): 専用エラーメッセージ + 「再試行」ボタンが表示される', async ({ page }) => {
    const modal = await openDocByFileName(page, 'E2E_PR4c_failed_fabrication');
    await ensureSummaryAccordionExpanded(modal);
    await expect(modal.locator('text=固有名詞')).toBeVisible();
    await expect(modal.locator('button:has-text("再試行")')).toBeVisible();
  });

  test('absent(detail/mainオフロード): OCR本文がdetail/main経由でも「AI要約を生成」ボタンが表示される', async ({ page }) => {
    // codex pass1指摘反映の非回帰確認: 親document.ocrResultが空でも、resolveDetailFields()経由の
    // 100字以上判定でabsent(kind=6)になり、skipped扱いにならないことを確認する
    const modal = await openDocByFileName(page, 'E2E_PR4c_absent_detail-offload');
    await ensureSummaryAccordionExpanded(modal);
    await expect(modal.locator('button:has-text("AI要約を生成")')).toBeVisible();
  });

  test('absent(skipped+OCR十分): Sarashina L2ゲートのallowlist除外でも手動生成ボタンが維持される', async ({ page }) => {
    // codex review P2指摘反映: summaryState==='skipped'を無条件でunavailableに倒すと、
    // allowlist除外(OCR長とは無関係)された長文文書でも既存のregenerateSummary手動生成経路
    // (Sarashina L2ゲートとは独立、Geminiを呼ぶ)を失ってしまっていた。OCR結果が十分な場合は
    // summaryState==='skipped'でもabsentとして生成ボタンを提示することを確認する
    const modal = await openDocByFileName(page, 'E2E_PR4c_skipped_allowlist_long_ocr');
    await ensureSummaryAccordionExpanded(modal);
    await expect(modal.locator('button:has-text("AI要約を生成")')).toBeVisible();
  });
});

test.describe('AI要約 8状態UI (モバイル) @emulator', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    isMobile: true,
    hasTouch: true,
  });

  test.beforeEach(async ({ page }) => {
    await _loginWithTestUser(page, 'h1:has-text("書類管理")');
  });

  /** 書類行を開き、モバイル用「AI要約」ボタンでポップアップを表示する */
  async function openMobileSummaryPopup(page: Page, fileNameSubstring: string) {
    const row = page.locator(`tbody tr:has-text("${fileNameSubstring}")`).first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.click();
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    await page.locator('button:has-text("要約")').first().click();
    const popup = page.locator('#mobile-popup-container');
    await expect(popup).toBeVisible({ timeout: 5000 });
    return popup;
  }

  // pr-test-analyzer指摘反映: モバイルのMobileContentPopupはデスクトップJSXとは別に文言・
  // 分岐を手組みDOMで実装しており(#193型の重複リスク)、generating以外のkindがモバイル側で
  // 一度も検証されていなかった。デスクトップと同じ代表状態をモバイル側でも検証する。
  test('generated: 要約本文 + 「再生成」ボタンが表示される', async ({ page }) => {
    const popup = await openMobileSummaryPopup(page, 'E2E_PR4c_generated.pdf');
    await expect(popup.locator('text=PR4c検証用の生成済み要約テキストです。')).toBeVisible();
    await expect(popup.locator('text=AI生成・要確認')).toBeVisible();
    await expect(popup.locator('button:has-text("再生成")')).toBeVisible();
  });

  test('queued: 手動依頼の案内文言が表示され、生成ボタンは出ない', async ({ page }) => {
    const popup = await openMobileSummaryPopup(page, 'E2E_PR4c_queued');
    await expect(popup.locator(`text=${QUEUED_MESSAGE}`)).toBeVisible();
    await expect(popup.locator('#generate-summary-btn')).toHaveCount(0);
  });

  test('generated-with-failure: 旧要約 + 失敗併記 + 「再試行」ボタン', async ({ page }) => {
    const popup = await openMobileSummaryPopup(page, 'E2E_PR4c_generated_with_failure');
    await expect(popup.locator('text=PR4c検証用の旧要約テキストです。')).toBeVisible();
    await expect(popup.locator('text=前回の要約です。今回の再作成は失敗しました')).toBeVisible();
    await expect(popup.locator('button:has-text("再試行")')).toBeVisible();
  });

  test('generated(オフロード): 先頭約8,000字の注記が出る', async ({ page }) => {
    const popup = await openMobileSummaryPopup(page, 'E2E_PR4c_generated_offload');
    await expect(popup.locator('text=長い書類のため、先頭約8,000字を要約しています')).toBeVisible();
  });

  test('failed(fabrication_suspected): 専用エラーメッセージ + 「再試行」ボタンが表示される', async ({ page }) => {
    const popup = await openMobileSummaryPopup(page, 'E2E_PR4c_failed_fabrication');
    await expect(popup.locator('text=固有名詞')).toBeVisible();
    await expect(popup.locator('button:has-text("再試行")')).toBeVisible();
  });

  // pr-test-analyzer指摘反映: unavailable kind(seed-adr0027-pr4c-summary-states.jsの
  // pr4c-skippedフィクスチャ)がE2Eで一度も参照されていなかった
  test('unavailable(skipped): 「OCR結果が短いため要約を生成できません」が表示される', async ({ page }) => {
    // ".pdf"まで含めて一致させる(substringマッチのため"E2E_PR4c_skipped_allowlist_long_ocr.pdf"
    // と衝突しないようにする)
    const popup = await openMobileSummaryPopup(page, 'E2E_PR4c_skipped.pdf');
    await expect(popup.locator('text=OCR結果が短いため要約を生成できません')).toBeVisible();
  });

  test('generating: ポーリングによる親の再レンダリング後も「生成中」表示が消えない (crossreview指摘の回帰テスト)', async ({
    page,
  }) => {
    // モバイルのMobileContentPopupは、handleGenerateSummaryがuseCallback化されておらず
    // 親レンダーのたびに新しい関数参照になるため、主effectが再実行されDOMを再構築する。
    // 修正前はisGeneratingSummary専用の別effectが値不変で再実行されず、ボタン文言が
    // 生成中から通常表示に戻ってしまう構造的バグがあった(codex crossreviewで実装確認済み)。
    // ポップアップは position:fixed; inset:0 の全画面バックドロップで背後の要素へのクリックを
    // 一切受け付けないため(実際のモーダル挙動として正しい)、手動クリックで親の再レンダリングを
    // 誘発することはできない。代わりに、この状態(summaryState==='processing')でuseDocument()が
    // 実際に使う5秒間隔のポーリング(computeDocumentRefetchInterval)を待ち、react-queryの
    // refetchが返す新しいデータ参照による自然な親再レンダリングを再現する。
    const popup = await openMobileSummaryPopup(page, 'E2E_PR4c_generating');
    await expect(popup.locator('text=生成中')).toBeVisible();

    // pr-test-analyzer指摘反映: 「消えていない」という消極的アサーションだけでは、
    // ポーリング自体が発火しなくなった場合でも(何も起きないため)偶然passしうる。
    // 待機ウィンドウ中に実際にFirestore emulatorへの往復が発生したこと(=ポーリングが
    // 本当に発火したこと)を独立して確認し、テストの診断力を補強する。
    let firestoreRequestSeenDuringWait = false;
    const onRequest = (req: { url(): string }) => {
      if (req.url().includes(':8085')) firestoreRequestSeenDuringWait = true;
    };
    page.on('request', onRequest);

    // 5秒間隔ポーリングが最低1回発火するのを待つ(回帰テスト本体)
    await page.waitForTimeout(6500);
    page.off('request', onRequest);

    expect(firestoreRequestSeenDuringWait).toBe(true);
    // 再レンダリング後も「生成中」表示が消えていないことを確認
    await expect(popup.locator('text=生成中')).toBeVisible();
  });
});
