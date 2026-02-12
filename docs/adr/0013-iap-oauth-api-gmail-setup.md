# ADR-0013: IAP OAuth API活用によるGmail連携自動化

## ステータス

承認済み (2026-02-13)

## コンテキスト

### 問題

Gmail連携のセットアップにおいて、OAuth クライアントIDの作成はGCPコンソールでの手動操作が必要だった。特にWorkspace管理者の協力が得られない環境では、開発者がクライアントのGCPプロジェクトで手動作成する必要があり、納品の自動化ボトルネックとなっていた。

### 既存の方式

| 方式 | 制約 |
|------|------|
| 方式1: OAuth 2.0（手動） | GCPコンソールでOAuth client手動作成が必要 |
| 方式2: Service Account + DWD | Workspace管理者のAdmin Console操作が必要 |

### 発見

docsplit-cocoro案件で以下を確認:
- **IAP OAuth Admin API**（`gcloud iap oauth-brands` / `gcloud iap oauth-clients`）を使用すると、サービスアカウント経由でOAuth clientをプログラマティックに作成可能
- GCPコンソール操作が一切不要
- PR #104でマージ済みの**アプリ内OAuth連携フロー**と組み合わせることで、CLIでのauth-code取得も不要に

## 決定

**方式3: IAP API自動作成 + アプリ内OAuth連携**を新規オプション（`--gmail-iap`）として追加する。

### フロー

```
setup-tenant.sh --gmail-iap
  ↓
1. IAP API有効化
2. OAuth Brand作成（gcloud iap oauth-brands create）
3. OAuth Client作成（gcloud iap oauth-clients create）
4. Secret Manager に client-id / client-secret 保存
5. Firestore settings/gmail に oauthClientId 保存
  ↓
クライアントがアプリ設定画面で「Gmail連携」ボタン押下
  ↓
アプリ内OAuth連携フロー（PR #104）でrefresh-token取得・保存
  ↓
Gmail自動取得開始
```

### 既存方式との違い

| | 方式1（--with-gmail） | 方式3（--gmail-iap） |
|---|---|---|
| OAuth client | 手動作成済み前提 | IAP APIで自動作成 |
| auth-code | 事前取得必須 | 不要（アプリ内で後から取得） |
| refresh-token | setup-gmail-auth.shが取得・保存 | Cloud Functionが保存（ユーザーがアプリで承認時） |
| ユーザー操作 | 開発者がCLIで認証 | クライアントがアプリUIで承認 |

## リスク

### IAP API廃止予定（2026年3月）

Google Cloud IAP OAuth Admin API は2026年3月に廃止予定。

**影響範囲**:
- **作成済みOAuth clientへの影響: なし** — IAP APIで作成したOAuth clientは標準のGoogle OAuth clientであり、廃止後も永続的に動作する
- **新規作成: 不可** — 廃止後は`--gmail-iap`でのOAuth client自動作成ができなくなる

**対応方針**:
- 2026年3月までは`--gmail-iap`を積極的に活用
- 廃止後はGCPコンソール手動作成にフォールバック（方式1相当）

### orgInternalOnly制約

IAP APIで作成したOAuth clientは`orgInternalOnly=true`が設定される。同一Workspaceドメインのユーザーのみがアプリ内OAuth連携フローで承認可能。

**対応**: ドキュメントに制約を明記。個人Gmailの場合は方式1を案内。

## 廃止後の展望（2026年4月以降）

### 代替API出現の可能性

AI駆動開発の普及により、GCPリソースのプログラマティック管理需要は急増している。GoogleがOAuth client作成をコンソール手動操作のみに限定し続ける可能性は低い。

**根拠となる動向**:

1. **Google Auth Platform（2025年4月〜）**: GoogleはOAuth管理を独立プラットフォームに統合中。REST API/CLIの追加可能性が高い
2. **IAM OAuth Clients API（`gcloud iam oauth-clients`）**: 現在はWorkforce Identity Federation限定だが、スコープ拡大の可能性あり
3. **Terraform/IaCコミュニティの要望**: issue #16452で汎用OAuth client作成API要望。IaC需要は増大
4. **Google Cloud Next等**: 2026年4月以降に新APIが発表される可能性

### 移行戦略

| 時期 | 対応 |
|------|------|
| 2026年3月まで | `--gmail-iap`で新規作成可能。積極的に活用 |
| 2026年4月以降（新API未登場） | 作成済みclientは継続利用。新規作成は手動（GCPコンソール）にフォールバック |
| 新API登場時 | `--gmail-iap`内のgcloudコマンドを新APIに差し替え。フローは同一 |

## 結果

- `setup-tenant.sh --gmail-iap` で完全自動化された Gmail連携セットアップが可能に
- Workspace管理者の協力不要
- クライアント操作はアプリ内の「Gmail連携」ボタン押下のみ
- IAP API廃止リスクは明記の上、移行パスを確保

## 関連

- [ADR-0003: 認証設計](./0003-authentication-design.md)
- [PR #104: Gmail OAuth アプリ内連携フロー](https://github.com/yasushi-honda/doc-split/pull/104)
- [IAP OAuth Admin API](https://cloud.google.com/iap/docs/reference/rest)
