---
name: reference-dev-drive-root-folder-misconfiguration
description: dev環境のGoogle Driveエクスポート先ルートフォルダが外部共有ドライブを指していた設定ミスの根本原因・調査方法・修正手順
metadata:
  type: reference
---

dev環境（doc-split-dev）のFirestore `settings/drive`ドキュメントは、`rootFolderId`（エクスポート先ルートフォルダ）に外部の実在共有ドライブの実フォルダを指定していた。2026-07-21頃（Drive連携Phase1 MVP開発時）に設定され、以降devでのDriveエクスポートテストのたびに、その外部共有ドライブ内へ合成テストデータ（架空事業所・顧客名のフォルダ、テスト用PDF）が作成され続けていた。2026-09-16セッションで発見・修正。

## 調査方法（再発時・類似調査に転用可）

- `settings/drive`ドキュメントは `mcp__plugin_firebase_firebase__firestore_get_document` で直接読める（`projects/<project-id>/databases/(default)/documents/settings/drive`）。`rootFolderId`/`rootFolderName`/`template`（フォルダ階層テンプレート、`type: fixed`のvalueが固定文字列セグメント）を確認する
- Drive上の実フォルダ構造の再帰確認は、read-only ops-script `investigate-issue811-root-cause --list-children`（GitHub Actions `run-ops-script.yml`、`exec_args_json: {"folderId": "<id>"}`）が使える。`trashed`込みで子フォルダ一覧を返す
- 疑わしいフォルダ配下の顧客名・事業所名は、`grep -rl "<名前>" scripts/samples/ scripts/*.ts` 等で`scripts/seed-dev-data.ts`等の既知fixtureと突合すれば、合成テストデータか実データかを判別できる

## 修正手順（rootFolderId変更）

- Firestoreを直接編集せず、アプリ自身の設定画面（`/settings` → 「Google Drive」タブ → 「フォルダを変更する」）から、Google Picker経由の正規UIで変更する。フォルダ選択と同時に自動保存される（「設定を保存」ボタンとは独立）
- Google Picker（`frontend/src/lib/googlePicker.ts`、ADR-0022 Decision 2）は`setEnableDrives(true)`の`DocsView(FOLDERS)`のみで構成されており、**「マイドライブ」を閲覧・選択するタブがUIに存在しない**。共有ドライブのみが選択候補になる（アプリの設計自体が共有ドライブ運用を前提にしている）
- **共有ドライブ（Shared Drive）はGoogle Workspaceの機能であり、個人のGmailアカウントでは新規作成できない**。dev連携アカウントが個人アカウントの場合、専用サンドボックス用の共有ドライブは別途Workspaceアカウントで作成してもらう必要がある
- 共有ドライブのルート直下は選択不可（アプリ側のバリデーション、`SettingsPage.tsx`）。1階層以上のサブフォルダを新規作成してから選択する

## 関連

- 恒久対応・実施記録: `[[feedback_dev_drive_external_shared_drive_no_write_test]]`
- 実施履歴の詳細: `docs/handoff/GOAL.md`（2026-09-16セッションの該当節）
