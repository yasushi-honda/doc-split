# kanameone（カナメワン）

## 基本情報

| 項目 | 値 |
|------|-----|
| プロジェクトID | `docsplit-kanameone` |
| gcloud構成 | `doc-split` |
| 認証方式 | 個人アカウント |
| アカウント | `hy.unimail.11@gmail.com` |
| URL | https://docsplit-kanameone.web.app |
| PITR | ENABLED（7日間） |

## セットアップ状態

- [x] GCPプロジェクト作成
- [x] Firebase初期化
- [x] Cloud Functions デプロイ
- [x] Firestore Rules デプロイ
- [x] Hosting デプロイ
- [x] Storage CORS設定
- [x] settings/app 設定
- [x] settings/auth 設定
- [x] settings/gmail 設定
- [x] Gmail OAuth認証
- [x] 監視ラベル設定
- [x] マスターデータ投入
- [x] PITR有効化

**verify-setup.sh**: 16/16（全項目通過）

## 運用状態

運用中

## 履歴

| 日付 | 内容 |
|------|------|
| 2026-02-13 | マルチクライアント安全運用機構テスト完了（verify-setup 16/16） |
