# cocoro（ココロマネジメント）

## 基本情報

| 項目 | 値 |
|------|-----|
| プロジェクトID | `docsplit-cocoro` |
| gcloud構成 | `doc-split-cocoro` |
| 認証方式 | サービスアカウント |
| アカウント | `docsplit-deployer@docsplit-cocoro.iam.gserviceaccount.com` |
| 管理者 | `a.itagaki@cocoro-mgnt.com` |
| 許可ドメイン | `cocoro-mgnt.com` |
| URL | https://docsplit-cocoro.web.app |
| PITR | ENABLED（7日間） |

## セットアップ状態

- [x] GCPプロジェクト作成
- [x] Firebase初期化
- [x] Cloud Functions デプロイ（19関数 ACTIVE）
- [x] Firestore Rules デプロイ
- [x] Hosting デプロイ
- [x] Storage CORS設定
- [x] settings/app 設定（gmailAccount: a.itagaki@cocoro-mgnt.com）
- [x] settings/auth 設定（allowedDomains: cocoro-mgnt.com）
- [x] settings/gmail 設定（authMode: oauth, clientId設定済み）
- [x] Secret Manager（client-id/client-secret 保存済み）
- [x] Gmail API 有効化
- [x] マスターデータ投入（顧客5, 書類種別5, 事業所5, ケアマネ2）
- [x] 管理者ユーザー登録（a.itagaki@cocoro-mgnt.com）
- [x] PITR有効化
- [ ] **Gmail OAuth認証（先方操作待ち）**
- [ ] **Gmail監視ラベル設定（先方操作待ち）**

## 運用開始に必要な先方操作

1. `https://docsplit-cocoro.web.app` にアクセス
2. Googleアカウント（`a.itagaki@cocoro-mgnt.com`）でログイン
3. 設定画面 → Gmail連携ボタン → OAuthポップアップで認証
4. Gmail監視対象ラベルを設定
5. → 運用開始

## 注意事項

- OAuth同意画面は `orgInternalOnly: true`（cocoro-mgnt.com組織内ユーザーのみ認証可能）
- SAキーファイルの安全管理に注意

## 履歴

| 日付 | 内容 |
|------|------|
| 2026-02-11 | setup-tenant.sh実行、Firestore設定投入、マスターデータ投入、Secret Manager設定 |
| 2026-02-13 | インフラ構築完了確認。開発者側作業完了、先方のOAuth認証待ち |
