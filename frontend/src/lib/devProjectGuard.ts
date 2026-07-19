// dev サーバーが誤って本番プロジェクトを向く事故防止（frontend/.env の手動書き換え残置が過去3回再発）。
// allowlist方式: devモードでは doc-split-dev 以外を検知したら警告のみ出す（意図的なclient向けdebugを妨げないためblockはしない）
export const DEV_ALLOWED_PROJECT_ID = 'doc-split-dev'

export function checkDevProjectGuard(projectId: string, isDev: boolean): void {
  if (!isDev || projectId === DEV_ALLOWED_PROJECT_ID) {
    return
  }

  const message = `[env-guard] dev サーバーが本番相当のプロジェクト "${projectId}" を向いています（想定: ${DEV_ALLOWED_PROJECT_ID}）。frontend/.env / frontend/.env.local を確認してください。`
  console.error(message)

  if (typeof document === 'undefined') {
    return
  }

  const showBanner = () => {
    const banner = document.createElement('div')
    banner.textContent = `⚠ DEV SERVER POINTING AT "${projectId}" (expected ${DEV_ALLOWED_PROJECT_ID}) — see console`
    banner.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:999999;background:#dc2626;color:#fff;font:bold 13px monospace;text-align:center;padding:6px;'
    document.body.prepend(banner)
  }

  if (document.body) {
    showBanner()
  } else {
    document.addEventListener('DOMContentLoaded', showBanner, { once: true })
  }
}
