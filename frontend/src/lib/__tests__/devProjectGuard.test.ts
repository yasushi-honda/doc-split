/**
 * devProjectGuard テスト
 *
 * dev サーバーが誤って本番相当のプロジェクトを向いてしまう事故（frontend/.env の
 * 手動書き換え残置が過去3回再発）を検知する env-guard ロジックの回帰防止。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkDevProjectGuard, DEV_ALLOWED_PROJECT_ID } from '../devProjectGuard';

describe('checkDevProjectGuard', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    document.body.innerHTML = '';
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('dev環境で許可されたprojectId(doc-split-dev)なら警告を出さない', () => {
    checkDevProjectGuard(DEV_ALLOWED_PROJECT_ID, true);

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(document.body.children.length).toBe(0);
  });

  it('dev環境で許可外のprojectIdならconsole.errorとバナー表示の両方を行う', () => {
    checkDevProjectGuard('docsplit-kanameone', true);

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0][0]).toContain('docsplit-kanameone');
    expect(consoleErrorSpy.mock.calls[0][0]).toContain(DEV_ALLOWED_PROJECT_ID);

    const banner = document.body.firstElementChild;
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('docsplit-kanameone');
    expect(banner?.textContent).toContain(DEV_ALLOWED_PROJECT_ID);
  });

  it('本番ビルド(isDev=false)では許可外のprojectIdでも警告を出さない', () => {
    checkDevProjectGuard('docsplit-kanameone', false);

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(document.body.children.length).toBe(0);
  });
});
