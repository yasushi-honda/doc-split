# dev（開発環境）

## 基本情報

| 項目 | 値 |
|------|-----|
| プロジェクトID | `doc-split-dev` |
| gcloud構成 | `doc-split` |
| 認証方式 | 個人アカウント |
| アカウント | `hy.unimail.11@gmail.com` |
| URL | https://doc-split-dev.web.app |
| PITR | DISABLED（開発環境のため） |

## セットアップ状態

- [x] GCPプロジェクト作成
- [x] Firebase初期化
- [x] Cloud Functions デプロイ
- [x] Firestore Rules デプロイ
- [x] Hosting デプロイ
- [x] settings/app 設定
- [x] settings/auth 設定
- [x] settings/gmail 設定
- [x] Gmail OAuth認証
- [x] マスターデータ投入（サンプル）
- [ ] PITR有効化（開発環境のため無効）

**verify-setup.sh**: 9/10（PITRのみDISABLED）

## 履歴

| 日付 | 内容 |
|------|------|
| 2026-02-13 | マルチクライアント安全運用機構テスト完了（Phase 1-8全通過） |
