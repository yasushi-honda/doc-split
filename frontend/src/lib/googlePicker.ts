/**
 * Google Picker連携ヘルパー(ADR-0022, Phase 1)
 *
 * Drive接続後のエクスポート先ルートフォルダ選択に使用する。
 * `window.google.picker` へのアクセスを伴う部分は `openFolderPicker` に閉じ込め、
 * Pickerのコールバックレスポンスを保存ペイロードへ変換する部分は純粋関数として
 * 分離する（testing.md §6: モック最小化。window.google依存部は単体テスト対象外
 * とし、変換ロジックのみテストする）。
 *
 * 参照: https://developers.google.com/workspace/drive/picker/guides/web-picker
 *       https://developers.google.com/workspace/drive/picker/reference/picker.docsview
 */

export interface PickedFolder {
  rootFolderId: string
  rootFolderName: string
}

/**
 * PickerのcallbackへPickerBuilderが渡すResponseObjectを、settings/drive保存用の
 * ペイロードへ変換する（純粋関数、window.google非依存）。
 *
 * `google.picker.Action.PICKED` の実値は `'picked'`、`Document.ID`/`.NAME` の実値は
 * `'id'`/`'name'`（公式リファレンスで確認済み）。
 */
export function pickerResponseToRootFolder(data: unknown): PickedFolder | null {
  const response = data as {
    action?: string
    docs?: Array<{ id?: string; name?: string }>
  }

  if (response?.action !== 'picked') return null

  const doc = response.docs?.[0]
  if (!doc?.id) return null

  return {
    rootFolderId: doc.id,
    rootFolderName: doc.name ?? '',
  }
}

/**
 * Google Picker(フォルダ選択専用View)を構築して表示する。
 * `drive.file`スコープのaccess_token取得後に呼び出すこと。
 *
 * Shared Drive内フォルダの表示には`setEnableDrives(true)`が必須（ADR-0022 Decision 2、
 * `doc-split-dev`環境での実機検証済み）。Shared Driveのルート自体は選択不可なので、
 * 呼び出し元UIで「1階層以上のサブフォルダを選択」の制約文言を案内すること。
 */
export function openFolderPicker(options: {
  accessToken: string
  developerKey: string
  appId: string
  onPicked: (folder: PickedFolder) => void
}): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const google = (window as any).google
  if (!google?.picker) return

  const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
    .setSelectFolderEnabled(true)
    .setEnableDrives(true)
    .setMimeTypes('application/vnd.google-apps.folder')

  const picker = new google.picker.PickerBuilder()
    .addView(view)
    .setOAuthToken(options.accessToken)
    .setDeveloperKey(options.developerKey)
    .setAppId(options.appId)
    .setCallback((data: unknown) => {
      const folder = pickerResponseToRootFolder(data)
      if (folder) options.onPicked(folder)
    })
    .build()

  picker.setVisible(true)
}
