# cocoro（ココロマネジメント）

## 基本情報

| 項目 | 値 |
|------|-----|
| プロジェクトID | `docsplit-cocoro` |
| gcloud構成 | `doc-split-cocoro` |
| 認証方式 | ハイブリッド（SA + 開発者アカウント） |
| SA | `docsplit-deployer@docsplit-cocoro.iam.gserviceaccount.com` (owner) |
| 開発者 | `hy.unimail.11@gmail.com` (editor) |
| 管理者 | `a.itagaki@cocoro-mgnt.com` |
| 許可ドメイン | `cocoro-mgnt.com` |
| URL | https://docsplit-cocoro.web.app |
| PITR | ENABLED（7日間） |
| OAuth Client | `271145290122-uqr7skughf8qgnosub114fbdoumn74on.apps.googleusercontent.com` (Web Application) |

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

## 運用体制

cocoro は Google Workspace 組織（cocoro-mgnt.com）配下のプロジェクトのため、外部ユーザーに owner 権限を付与できない（`ORG_MUST_INVITE_EXTERNAL_OWNERS`）。SA + 開発者のハイブリッド運用とする。

| 操作 | 担当 | 手段 |
|------|------|------|
| 日常のデプロイ・設定変更 | 開発者 (editor) | CLI / GCPコンソール |
| GCPコンソールUI操作 | 開発者 (editor) | コンソール |
| IAMポリシー変更 | SA (owner) | CLI |
| プロジェクトレベル設定 | SA (owner) | CLI |

**SA単独運用を避ける理由**: GCPコンソールでしか実行できない操作がある（標準OAuth Webクライアント作成等）。

## 注意事項

- OAuth同意画面は `orgInternalOnly: true`（cocoro-mgnt.com組織内ユーザーのみ認証可能）
- SAキーファイルの安全管理に注意
- OAuth Webクライアント作成/変更はGCPコンソールのみ（パブリックAPI非対応）

## 履歴

| 日付 | 内容 |
|------|------|
| 2026-02-11 | setup-tenant.sh実行、Firestore設定投入、マスターデータ投入、Secret Manager設定 |
| 2026-02-13 | インフラ構築完了確認。開発者側作業完了、先方のOAuth認証待ち |
| 2026-02-13 | Google Sign-in修正（Web Application OAuth Client作成）、開発者editor権限付与、Gmail OAuth client統一 |
