# 納品・アップデート運用ガイド

## 概要

本ドキュメントは、DocSplitの納品フローとアップデート運用について定義する。
AI駆動開発において、このドキュメントを参照することで一貫した運用が可能となる。

## アーキテクチャ方針

### 採用方式: マルチプロジェクト独立デプロイ

```
[doc-split-dev]          [client-a]          [client-b]
  開発・検証        →      本番A        →      本番B
  (SEEDあり)             (SEEDなし)          (SEEDなし)
```

### 方針決定の背景

| 検討項目 | 決定 | 理由 |
|---------|------|------|
| 雛形プロジェクト | 不要 | セットアップスクリプトで代替可能 |
| マルチテナントSaaS | 不採用 | クライアント2社では過剰 |
| CI/CD自動デプロイ | 開発環境のみ | 本番は手動（2社なら十分） |
| 課金 | 各クライアント独立 | 責任分離のため |

### 不採用とした方式

1. **雛形プロジェクト方式**: 管理対象が増え、メリットが薄い
2. **単一プロジェクトマルチテナント**: クライアント独立性が損なわれる
3. **Terraform/IaC**: 規模に対して過剰

---

## プロジェクト構成

### .firebaserc

```json
{
  "projects": {
    "dev": "doc-split-dev",
    "client-a": "<client-a-project-id>",
    "client-b": "<client-b-project-id>"
  }
}
```

### 役割分担

| プロジェクト | 用途 | SEEDデータ | 課金 |
|-------------|------|-----------|------|
| doc-split-dev | 開発・検証 | あり | 開発者 |
| client-a | クライアントA本番 | なし | クライアントA |
| client-b | クライアントB本番 | なし | クライアントB |

---

## 初期納品フロー

### 前提条件

- クライアントがGCPアカウントを持っている
- クライアントが課金アカウントを設定できる
- クライアントのGmail（監視対象）にアクセス可能

### 組織アカウント環境での対応（重要）

**クライアントがGoogle Workspace組織アカウントの場合、以下の制約に注意が必要です。**

#### 「Secure by Default Organizations」の影響

2024年以降、新規にGCPアカウントを作成したクライアントには、Googleの「Secure by Default Organizations」機能が**自動適用**されます。

**適用されるタイミング**:
- 納品日にクライアントが初めてGCPアカウントを作成
- 同時に課金アカウントを初めて設定

**発生する制約**:
1. **別ドメインへのIAMロール付与が不可** (`constraints/iam.allowedPolicyMemberDomains`)
   - 開発者（gmail.com等の外部ドメイン）をプロジェクトオーナーに追加できない

2. **サービスアカウントキーの作成が不可** (`constraints/iam.disableServiceAccountKeyCreation`)
   - サービスアカウントのJSONキーを作成できない

#### 対応方法: サービスアカウント方式（自動化済み）

組織アカウント環境では、**サービスアカウント + JSONキー**方式を採用します。

**手順概要**:
1. クライアントが `client-setup-gcp` スクリプトを実行（1コマンド）
2. スクリプトが自動実行:
   - GCPプロジェクト作成
   - 課金アカウント紐付け
   - 開発者へのオーナー権限付与を試行
   - **組織ポリシー制約を検出したら自動的にサービスアカウント方式にフォールバック**:
     - 組織ポリシー緩和
     - サービスアカウント作成 + Ownerロール付与
     - JSONキー生成
3. クライアントが開発者に「プロジェクトID + JSONキー」を送付
4. 開発者がサービスアカウントで納品・メンテナンス実施

**所要時間**: 約5分（対話に答えるだけ）

**詳細な背景・技術的根拠**:
- ADR-0011: 組織アカウント対応の背景（手動手順）
- ADR-0012: 自動化の実装方針

#### クライアント側作業: 組織ポリシーの緩和（自動化済み・参考情報）

**注意**: 以下の手順は `client-setup-gcp` スクリプトが**自動実行**します。通常は手動操作不要です。

**Step 1**: GCPコンソール > 該当プロジェクト >「IAMと管理」>「組織のポリシー」

**Step 2**: `iam.allowedPolicyMemberDomains` を緩和
1. 検索バーで `iam.allowedPolicyMemberDomains` を検索
2. 「ポリシーを管理」→「親をオーバーライド」を選択
3. 「すべてのドメインを許可」を選択
4. 「ポリシーの適用」: **「交換」**を選択
5. 「ポリシーを設定」をクリック

**Step 3**: `iam.disableServiceAccountKeyCreation` を緩和
1. 検索バーで `iam.disableServiceAccountKeyCreation` を検索
2. 「ポリシーを管理」→「親をオーバーライド」を選択
3. **「オフ」**を選択
4. 「ポリシーを設定」をクリック

**Step 4**: サービスアカウント作成
1. 「IAMと管理」>「サービスアカウント」>「サービスアカウントを作成」
2. 名前: `docsplit-deployer`
3. ロール: **「オーナー」**を選択
4. 完了後、「キー」タブ →「鍵を追加」→「新しい鍵を作成」
5. 形式: **JSON**
6. ダウンロードしたJSONキーファイルを開発者に安全に共有

**重要**: プロジェクトレベルでのポリシー緩和のため、組織全体への影響はありません。

#### 開発者側作業: サービスアカウントで納品

```bash
# Step 1: キーファイルを安全な場所に配置
mkdir -p ~/.gcp-keys
mv ~/Downloads/<project-id>-xxxxx.json ~/.gcp-keys/<project-id>-key.json
chmod 600 ~/.gcp-keys/<project-id>-key.json

# Step 2: 環境変数設定
export GOOGLE_APPLICATION_CREDENTIALS=~/.gcp-keys/<project-id>-key.json

# Step 3: 初回デプロイ実行（以降は通常フロー）
./scripts/setup-tenant.sh <project-id> <admin-email> --with-gmail
```

#### セキュリティ強化（初回デプロイ後・推奨）

初回デプロイ完了後、Ownerロールから最小権限の6ロールに縮小：

```bash
# Ownerを削除
gcloud projects remove-iam-policy-binding <project-id> \
  --member="serviceAccount:docsplit-deployer@<project-id>.iam.gserviceaccount.com" \
  --role="roles/owner"

# 最小権限6ロールを付与
for role in \
  roles/firebase.admin \
  roles/cloudfunctions.developer \
  roles/iam.serviceAccountUser \
  roles/storage.admin \
  roles/datastore.owner \
  roles/serviceusage.serviceUsageAdmin; do
  gcloud projects add-iam-policy-binding <project-id> \
    --member="serviceAccount:docsplit-deployer@<project-id>.iam.gserviceaccount.com" \
    --role="$role"
done
```

**参考**: https://cloud.google.com/resource-manager/docs/secure-by-default-organizations

---

### Gmail連携方式の選択ガイド

Gmail連携を設定する場合、クライアント環境に応じて最適な方式を選択します。

```
クライアントはGoogle Workspaceを利用？
  ├─ YES → Workspace管理者の協力が得られる？
  │          ├─ YES → 方式2: SA + DWD（--with-gmail相当、最も安全）
  │          └─ NO  → 方式3: IAP + アプリ内OAuth（--gmail-iap）★推奨
  └─ NO（個人Gmail） → 方式1: OAuth CLI（--with-gmail）
```

| 方式 | コマンド | 事前準備 | クライアント操作 |
|------|---------|---------|----------------|
| 方式1: OAuth CLI | `--with-gmail` | GCPコンソールでOAuth client手動作成 + auth-code取得 | なし |
| 方式2: SA + DWD | setup-gmail-service-account.sh | Workspace管理者にDWD設定依頼 | Admin Console操作 |
| 方式3: IAP + アプリ内OAuth | `--gmail-iap` | なし（全自動） | アプリで「Gmail連携」ボタン押下 |

> **方式3の注意**: IAP OAuth Admin APIは2026年3月に廃止予定。作成済みclientは永続的に動作するが、新規作成は手動フォールバックが必要になる。詳細: [ADR-0013](../adr/0013-iap-oauth-api-gmail-setup.md)

### 納品シナリオ

**シナリオ1（Gmail連携なし）**: プロジェクトID + 管理者メールのみで基本納品（約10分）
**シナリオ2（Gmail連携・手動OAuth）**: OAuth設定 + Claude Code自動納品（約15分）
**シナリオ3（Gmail連携・IAP自動作成）**: プロジェクトID + 管理者メールのみで完全自動（約12分） ★推奨

### 手順

```bash
# ========================================
# Step 1: クライアント側作業（約5分）
# ========================================
# クライアントが client-setup-gcp スクリプトを実行
# - Mac: client-setup-gcp.command をダブルクリック
# - Linux: ./scripts/client-setup-gcp.sh
# - Windows: client-setup-gcp.bat をダブルクリック
#
# スクリプトが自動実行:
# - GCPプロジェクト作成
# - 課金アカウント紐付け
# - 開発者をプロジェクトオーナーに追加（可能な場合）
# - 組織ポリシー制約がある場合、自動的にサービスアカウント方式に切替:
#   - 組織ポリシー緩和
#   - サービスアカウント作成 + Ownerロール付与
#   - JSONキー生成（ホームディレクトリに保存）
#
# クライアントから開発者へ:
# - プロジェクトID（例: docsplit-abc-kaigo）
# - 管理者メールアドレス
# - JSONキーファイル（組織アカウント環境の場合のみ）
# - マスターデータCSV（任意）

# ========================================
# Step 2: 開発者側作業 - Claude Code自動納品（約10分）
# ========================================
# 1. GitHub Pages納品フォームにアクセス
#    https://yasushi-honda.github.io/doc-split/#/claude-code-delivery
#
# 2. フォームに入力:
#    - プロジェクトID（クライアントから受領）
#    - 管理者メール（クライアントから受領）
#    - OAuth情報（Gmail連携時のみ、事前にGCP Consoleで設定）
#    - CSV パス（マスターデータ受領時のみ）
#
# 3. プロンプト生成 → コピー → Claude Codeに貼り付け
#
# 4. Claude Codeが自動実行:
#    - Firebase設定
#    - API有効化
#    - 管理者ユーザー登録
#    - Firestoreルール設定
#    - Cloud Functionsデプロイ
#    - Hostingデプロイ
#    - Gmail OAuth設定（シナリオ2のみ）
#    - マスターデータ投入（CSVあれば）

# ========================================
# Step 3: 手動セットアップ（スクリプト直接実行の場合）
# ========================================

# 2-1. クライアントのGCPプロジェクトに切替
gcloud config set project <client-project-id>

# 2-2. セットアップスクリプト実行

# シナリオ2: Gmail OAuth込みで一括（手動OAuth方式）
./scripts/setup-tenant.sh <client-project-id> <admin-email> --with-gmail --client-id=X --client-secret=Y --auth-code=Z --yes

# シナリオ3: Gmail IAP自動作成（Workspace管理者非協力時）★推奨
./scripts/setup-tenant.sh <client-project-id> <admin-email> --gmail-iap --yes

# Claude Code / CI用（非対話モード、Gmail連携なし）
./scripts/setup-tenant.sh <client-project-id> <admin-email> --yes

# または、Gmail設定を後から行う場合
./scripts/setup-tenant.sh <client-project-id> <admin-email>
./scripts/setup-gmail-auth.sh <client-project-id>
./scripts/setup-gmail-auth.sh <client-project-id> --client-id=X --client-secret=Y --auth-code=Z

# ※ .firebasercへのエイリアス追加は自動で行われます

# ========================================
# Step 3: クライアント側作業 - データ準備
# ========================================
# クライアントがマスターデータCSV準備
# - 顧客一覧
# - 書類種別
# - 事業所
# - ケアマネ（任意）

# ========================================
# Step 4: 開発者側作業 - データ投入
# ========================================
FIREBASE_PROJECT_ID=<client-project-id> node scripts/import-masters.js --customers <customers.csv>
FIREBASE_PROJECT_ID=<client-project-id> node scripts/import-masters.js --documents <documents.csv>
FIREBASE_PROJECT_ID=<client-project-id> node scripts/import-masters.js --offices <offices.csv>
# ケアマネ（任意）
# FIREBASE_PROJECT_ID=<client-project-id> node scripts/import-masters.js --caremanagers <caremanagers.csv>

# ========================================
# Step 5: 検証 & 動作確認
# ========================================
# 自動検証スクリプトで設定状態を確認
./scripts/verify-setup.sh <client-project-id>

# クライアントと共に本番環境で動作確認
# 問題なければ運用開始
```

### 納品チェックリスト

手動確認用のチェックリスト:

- [ ] GCPプロジェクト作成完了
- [ ] 課金アカウント紐付け完了
- [ ] setup-tenant.sh 実行完了
- [ ] Firebase Authentication 設定完了
- [ ] Gmail OAuth 設定完了
- [ ] Firestore ルール デプロイ完了
- [ ] Cloud Functions デプロイ完了
- [ ] Firebase Hosting デプロイ完了
- [ ] 管理者ユーザー登録完了
- [ ] マスターデータ投入完了
- [ ] 動作確認完了

**自動検証**: `./scripts/verify-setup.sh <project-id>` で上記の多くを自動確認できます。

---

## アップデートフロー

### 環境切り替え（デプロイ前の必須手順）

複数クライアント環境を管理する場合、デプロイ前に対象環境に切り替えます。

```bash
# クライアント一覧を確認
./scripts/switch-client.sh --list

# 対象クライアントに切替
./scripts/switch-client.sh <alias>
```

**安全機構**: `deploy-to-project.sh` はデプロイ前にgcloud構成とアカウントの一致を自動検証します。不一致の場合はデプロイを中止し、`switch-client.sh` での修正を案内します。

クライアント定義ファイル（`scripts/clients/*.env`）で各環境の認証情報を宣言的に管理:

| ファイル | プロジェクト | gcloud構成 | 認証方式 |
|---------|------------|-----------|---------|
| `dev.env` | doc-split-dev | doc-split | 個人アカウント |
| `kanameone.env` | docsplit-kanameone | doc-split | 個人アカウント |
| `cocoro.env` | docsplit-cocoro | doc-split-cocoro | サービスアカウント |

### 通常のアップデート（バグフィックス・機能追加）

```bash
# ========================================
# Step 1: 開発環境で修正・テスト
# ========================================
# 開発ブランチで作業
git checkout -b feature/xxx

# 開発環境にデプロイしてテスト
./scripts/deploy-to-project.sh dev

# テスト完了後、mainにマージ
git checkout main
git merge feature/xxx
git push origin main

# ========================================
# Step 1.5: 対象クライアントに環境切替
# ========================================
./scripts/switch-client.sh <alias>

# ========================================
# Step 2: 全クライアントに一括デプロイ（推奨）
# ========================================
# Hostingのみ
./scripts/deploy-all-clients.sh

# Hosting + ルール（スキーマ変更時）
./scripts/deploy-all-clients.sh --rules

# 全コンポーネント
./scripts/deploy-all-clients.sh --full

# dry-runで対象確認
./scripts/deploy-all-clients.sh --dry-run

# ========================================
# Step 2': 個別クライアントにデプロイ（必要な場合）
# ========================================
./scripts/deploy-to-project.sh client-a
./scripts/deploy-to-project.sh client-b

# ========================================
# Step 3: 動作確認
# ========================================
# 各クライアント環境で動作確認
```

### 部分デプロイ（Functionsのみ等）

```bash
# Functionsのみ
firebase deploy --only functions -P client-a

# Hostingのみ（deploy-to-project.sh推奨）
./scripts/deploy-to-project.sh client-a

# Hosting + ルール（スキーマ変更時）
./scripts/deploy-to-project.sh client-a --rules

# 全コンポーネント
./scripts/deploy-to-project.sh client-a --full

# ルールのみ（手動）
firebase deploy --only firestore:rules,storage -P client-a
```

### ⚠️ デプロイ対象の判断基準（AI向け必読）

| 変更内容 | 必要なデプロイ | コマンド |
|---------|---------------|---------|
| フロントエンドのみ | Hosting | `./scripts/deploy-to-project.sh <alias>` |
| **Firestoreスキーマ変更** | **Hosting + Rules** | `./scripts/deploy-to-project.sh <alias> --rules` |
| Functions追加/変更 | Full | `./scripts/deploy-to-project.sh <alias> --full` |
| 全て | Full | `./scripts/deploy-to-project.sh <alias> --full` |

**Firestoreスキーマ変更の例**:
- 新フィールド追加（例: `verified`, `verifiedBy`, `verifiedAt`）
- フィールドの書き込み権限変更
- 新コレクション追加

**2026-01-31教訓**: 新フィールド（verified等）追加後、Firestoreルールをクライアント環境にデプロイし忘れ、パーミッションエラーが発生。**スキーマ変更時は必ず `--rules` を使用すること。**

### 緊急修正（Hotfix）

```bash
# 1. mainから直接修正
git checkout main

# 2. 修正実施

# 3. 開発環境で最低限の確認
firebase deploy -P dev

# 4. 即座に本番デプロイ
firebase deploy -P client-a
firebase deploy -P client-b

# 5. コミット・プッシュ
git add .
git commit -m "fix: 緊急修正の内容"
git push origin main
```

---

## 新規クライアント追加フロー

```bash
# 1. クライアントがGCPプロジェクト作成・課金設定

# 2. クライアント定義ファイルを作成
# scripts/clients/<alias>.env を新規作成（既存ファイルを参考に）
# 必須項目: CLIENT_NAME, PROJECT_ID, GCLOUD_CONFIG, EXPECTED_ACCOUNT, AUTH_TYPE

# 3. セットアップ実行（.firebasercへのエイリアス追加も自動、PITR自動有効化含む）

# シナリオ3: IAP自動作成 ★推奨（Workspace管理者非協力時）
./scripts/setup-tenant.sh <new-client-project-id> <admin-email> --gmail-iap --yes

# シナリオ2: 手動OAuth方式
./scripts/setup-tenant.sh <new-client-project-id> <admin-email> --with-gmail --client-id=X --client-secret=Y --auth-code=Z --yes

# Gmail設定を後から行う場合
# ./scripts/setup-tenant.sh <new-client-project-id> <admin-email>
# ./scripts/setup-gmail-auth.sh <new-client-project-id>

# 4. マスターデータ投入
FIREBASE_PROJECT_ID=<new-client-project-id> node scripts/import-masters.js --customers <customers.csv>
FIREBASE_PROJECT_ID=<new-client-project-id> node scripts/import-masters.js --documents <documents.csv>
FIREBASE_PROJECT_ID=<new-client-project-id> node scripts/import-masters.js --offices <offices.csv>

# 5. セットアップ検証（PITR・authMode整合性チェック含む）
./scripts/verify-setup.sh <new-client-project-id>

# 6. 動作確認
```

---

## 責任分担

### 開発者の責任

| 項目 | 内容 |
|------|------|
| 初期セットアップ | setup-tenant.sh実行、Gmail設定支援 |
| バグフィックス | 修正・テスト・デプロイ |
| 機能追加 | 開発・テスト・デプロイ |
| アップデート | 各クライアントへのデプロイ |
| ドキュメント | 運用手順書の更新 |

### クライアントの責任

| 項目 | 内容 |
|------|------|
| GCPプロジェクト | 作成・課金管理 |
| マスターデータ | 準備・更新 |
| ユーザー管理 | 許可ユーザーの追加・削除 |
| 日常運用 | 書類処理・エラー対応 |
| Gmail | 監視対象アカウントの管理 |
| 個人情報の取扱い同意 | AI/デジタルシステムへの個人情報（要配慮個人情報を含む場合は特に）取込について、ご利用者からの同意取得 |

---

## トラブルシューティング

### デプロイ失敗時

```bash
# ログ確認
firebase functions:log -P client-a

# 再デプロイ
firebase deploy -P client-a
```

### クライアント環境のみで発生する問題

```bash
# 1. クライアント環境のログを確認
firebase functions:log -P client-a

# 2. Firestore データを確認
# Firebase Console > Firestore

# 3. 開発環境で再現テスト
# 必要に応じてSEEDデータを調整
```

---

## 🚨 重要: データ削除の禁止事項（ADR-0008）

### 絶対に実行してはいけないコマンド

```bash
# 本番環境で以下は絶対禁止
firebase firestore:delete --all-collections -P <client-alias>
firebase firestore:delete / --recursive -P <client-alias>
```

**2026-01-30教訓**: 本番環境で `--all-collections` を誤実行し、settings, users, mastersを含む全データを喪失。PITR/バックアップ未設定のため復元不可能となった。

### 許可される削除操作（特定コレクションのみ）

```bash
# テストデータの削除（documentsコレクションのみ）
firebase firestore:delete documents --recursive -P <client-alias>
```

### 削除前の必須確認チェックリスト

- [ ] 削除対象コレクション名を**3回確認**
- [ ] `--all-collections` は**絶対に使わない**
- [ ] 本番環境であることを認識

---

## 🔧 障害復旧: Firestore設定消失時の手順

> **注意**: initTenantSettings関数は初回セットアップ限定のため、設定消失時の復旧にはFirestoreコンソールでの手動復旧が必要です。

### 復旧が必要な設定

| 設定 | パス | 説明 |
|------|------|------|
| 認証設定 | `settings/auth` | allowedDomains |
| アプリ設定 | `settings/app` | gmailAccount, targetLabels等 |
| Gmail認証設定 | `settings/gmail` | authMode（**重要**） |
| ユーザー | `users/{uid}` | 管理者権限 |
| マスターデータ | `masters/*/items` | 顧客・書類種別・事業所・ケアマネ |

### settings/gmail の正しい設定

**重要**: `authMode` は環境に合わせて設定する。

```javascript
// OAuth認証の場合（Secret Managerに gmail-oauth-* がある場合）
{
  authMode: "oauth"
}

// Service Account認証の場合（Domain-wide Delegation設定済みの場合）
{
  authMode: "service_account",
  delegatedUserEmail: "<監視対象Gmailと同じアカウント>"
}
```

**確認方法**:
```bash
# Secret Managerにgmail-oauth-*があるか確認
gcloud secrets list --project=<project-id> | grep gmail-oauth

# あれば authMode: "oauth" を使用
# なければ authMode: "service_account" を使用
```

### 初回セットアップ用Cloud Function（initTenantSettings）

**⚠️ 初回セットアップ限定**: これらの関数は初回のみ実行可能です。設定やadminユーザーが既に存在する場合は403エラーを返します。

```bash
# 初回セットアップ時のみ（既に設定が存在する場合は実行不可）
curl "https://asia-northeast1-<project-id>.cloudfunctions.net/initTenantSettings"
curl "https://asia-northeast1-<project-id>.cloudfunctions.net/registerAdminUser?uid=<UID>&email=<EMAIL>"
```

**注意**: initTenantSettingsはデフォルト値で設定を作成するため、クライアント固有の設定（ラベル、Gmailアカウント等）は**設定画面から手動で再設定**が必要。

**設定消失時の復旧**: 既存設定がある場合はこの関数では復旧できません。Firestoreコンソールから直接`settings/auth`、`settings/app`、`settings/gmail`を再作成してください。

---

## 関連ドキュメント

| ドキュメント | 用途 |
|-------------|------|
| docs/operation/setup-guide.md | セットアップ詳細手順 |
| docs/operation/admin-guide.md | 管理者向けガイド |
| docs/operation/user-guide.md | エンドユーザー向けガイド |
| scripts/setup-tenant.sh | セットアップスクリプト |
| scripts/setup-gmail-auth.sh | Gmail認証設定スクリプト |

---

## 過去受信分の巻取り対応

### 概要

クライアント納品時に、Gmail連携開始前の過去受信分を一括インポートする場合がある。
**正式な巻取りスクリプト（`import-historical-gmail.js`）を使用すること。**

### 巻取りスクリプト（推奨）

```bash
# 使用方法
node scripts/import-historical-gmail.js <project-id> --after YYYY-MM-DD --before YYYY-MM-DD [--dry-run]

# 例: 2026年1月のメールを取得（dry-runで確認）
node scripts/import-historical-gmail.js docsplit-kanameone --after 2026-01-01 --before 2026-01-31 --dry-run

# 実行
node scripts/import-historical-gmail.js docsplit-kanameone --after 2026-01-01 --before 2026-01-31
```

**前提条件**:
- `setup-gmail-auth.sh` が完了していること
- アプリ設定画面でGmailアカウントとラベルが設定済みであること

**処理内容**:
1. 指定期間・ラベルのGmailを検索
2. 添付PDFをCloud Storageに保存
3. 正規スキーマでFirestoreにドキュメント作成（`status: pending`）
4. 次回の`processOCR`実行時にOCR処理される

**トラブルシューティング: Storage書き込みエラー**

Application Default Credentials使用時に `billing account disabled` エラーが発生する場合、サービスアカウントキーを使用する：

```bash
# 1. firebase-adminsdkサービスアカウントのキーを作成
gcloud iam service-accounts keys create /tmp/sa-key.json \
  --iam-account=firebase-adminsdk-fbsvc@<project-id>.iam.gserviceaccount.com \
  --project=<project-id>

# 2. Secret Managerアクセス権を付与（初回のみ）
for secret in gmail-oauth-client-id gmail-oauth-client-secret gmail-oauth-refresh-token; do
  gcloud secrets add-iam-policy-binding $secret \
    --project=<project-id> \
    --member="serviceAccount:firebase-adminsdk-fbsvc@<project-id>.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor" --quiet
done

# 3. キーを使用して実行
GOOGLE_APPLICATION_CREDENTIALS=/tmp/sa-key.json node scripts/import-historical-gmail.js <project-id> ...

# 4. 終了後、キーを削除（セキュリティのため）
rm /tmp/sa-key.json
```

### 必須設定: Storage CORS

**重要**: Storage バケットに CORS 設定がないと、ブラウザから PDF を閲覧できない。

```bash
# CORS設定ファイル作成（プロジェクトルートに cors-<alias>.json）
cat > cors-<alias>.json << 'EOF'
[
  {
    "origin": ["https://<project-id>.web.app", "http://localhost:5173", "http://localhost:4173"],
    "method": ["GET", "HEAD"],
    "maxAgeSeconds": 3600,
    "responseHeader": ["Content-Type", "Content-Length", "Content-Disposition"]
  }
]
EOF

# CORS設定を適用
gsutil cors set cors-<alias>.json gs://<project-id>.firebasestorage.app
```

### ドキュメントスキーマの注意点

Firestoreの `documents` コレクションには、以下のフィールドが必須：

| フィールド | 説明 | 例 |
|-----------|------|-----|
| `fileUrl` | Storage URL（gs://形式） | `gs://bucket/path/file.pdf` |
| `fileName` | 表示用ファイル名 | `書類名.pdf` |
| `totalPages` | 総ページ数 | `1` |
| `mimeType` | MIMEタイプ | `application/pdf` |
| `status` | 処理ステータス | `pending`, `completed` |

**よくある問題**: 巻取りスクリプトで以下の別名フィールドを使用すると、フロントエンドで表示できない。

| 誤ったフィールド名 | 正しいフィールド名 |
|-------------------|-------------------|
| `storagePath` | `fileUrl`（gs://形式で保存） |
| `originalFileName` | `fileName` |
| `pageCount` | `totalPages` |

### マイグレーションスクリプト

既存データのフィールド名を修正する場合：

```bash
# dry-run で確認
node scripts/migrate-document-fields.js <project-id> --dry-run

# 実行
node scripts/migrate-document-fields.js <project-id>
```

### Storage パス

ファイルの保存先パスによって、Storage ルールでの許可が必要：

| パス | 用途 | ルールで許可 |
|------|------|-------------|
| `original/` | Gmail取得時の原本 | ✅ |
| `processed/` | OCR処理後 | ✅ |
| `documents/` | 巻取り対応用 | ✅（2026-01-25追加） |

### 巻取り対応チェックリスト

- [ ] Storage CORS 設定完了
- [ ] ドキュメントスキーマ確認（fileUrl, fileName, totalPages）
- [ ] Storage ルールでパス許可確認
- [ ] ブラウザでPDF閲覧テスト

---

## 変更履歴

| 日付 | 内容 |
|------|------|
| 2026-02-13 | マルチクライアント安全運用機構追加（switch-client.sh、認証安全チェック、PITR自動有効化、クライアント定義ファイル） |
| 2026-02-13 | Gmail連携方式3（IAP API自動作成）追加、方式選択ガイド追加（ADR-0013参照） |
| 2026-02-11 | 組織アカウント環境での対応セクション追加（ADR-0011参照） |
| 2026-02-05 | ヘルプページ追加、セットアップ情報タブ追加 |
| 2026-01-25 | 過去受信分の巻取り対応セクション追加 |
| 2026-01-20 | 初版作成 - 納品・アップデートフロー確定 |
