# ADR-0011: 組織アカウント環境でのサービスアカウント納品方式

## ステータス

承認済み (2026-02-11)

## コンテキスト

### 問題

DocSplitの納品先クライアントがGoogle Workspace組織アカウントを使用している場合、2024年以降にGoogleが導入した「Secure by Default Organizations」機能により、以下の制約が自動適用される：

1. **ドメイン制限** (`constraints/iam.allowedPolicyMemberDomains`)
   - 組織外のドメイン（gmail.com等）のユーザーにIAMロールを付与できない
   - 開発者（外部ドメイン）をプロジェクトオーナーに追加できない

2. **サービスアカウントキー作成禁止** (`constraints/iam.disableServiceAccountKeyCreation`)
   - セキュリティ強化のため、サービスアカウントのJSONキーを作成できない
   - CI/CDやローカル開発での認証が困難

### トリガー条件

以下のいずれかに該当する場合、組織リソースが自動プロビジョニングされ、「Secure by Default」が適用される：

- ドメインのユーザーが初めてGCPにログインしたとき
- 組織リソースが関連付けられていない請求先アカウントを作成したとき

**納品時の典型的なシナリオ**:
- 納品日にクライアントが初めてGCPアカウントを作成
- 同時に課金アカウントを初めて設定
- → 自動的に「Secure by Default」が適用される

### 従来の納品方式の課題

| 方式 | 問題点 |
|------|--------|
| 開発者を直接オーナーに追加 | ドメイン制限により不可能 |
| Workload Identity Federation | セットアップが複雑、クライアント側の理解が必要 |
| Domain-wide Delegation | 組織管理者権限が必要、設定が複雑 |

## 決定

### 採用方式: オーナーロール付きサービスアカウント + JSONキー

クライアントのGCPプロジェクト内にサービスアカウントを作成し、開発者に共有する方式を採用する。

**フロー**:
1. クライアントがGCPプロジェクトを作成
2. プロジェクトレベルで組織ポリシーをオーバーライド（緩和）
3. サービスアカウント作成 + Ownerロール付与
4. JSONキーを作成し、開発者に安全に共有
5. 開発者がサービスアカウントで納品・メンテナンス・アップデート実施
6. （推奨）初回デプロイ後、権限を最小化

### 組織ポリシーのオーバーライド

プロジェクトレベルで以下の2つのポリシーを緩和：

| ポリシー | オーバーライド内容 | 理由 |
|---------|-------------------|------|
| `iam.allowedPolicyMemberDomains` | 「すべてのドメインを許可」に変更 | サービスアカウント作成に必要（技術的制約） |
| `iam.disableServiceAccountKeyCreation` | 「オフ」に変更 | JSONキー発行に必要 |

**スコープ**: 組織全体ではなく、**プロジェクトレベルのみ**で適用。他のプロジェクトへの影響なし。

### 権限管理方針

#### 初回デプロイ時（推奨）

**Ownerロール**を使用：
- 理由: OAuth設定、API有効化、IAM設定等で広範な権限が必要
- リスク軽減: プロジェクトスコープのみ、JSONキーは安全に保管

#### 初回デプロイ後（推奨）

最小権限の6ロールに縮小：
```
roles/firebase.admin
roles/cloudfunctions.developer
roles/iam.serviceAccountUser
roles/storage.admin
roles/datastore.owner
roles/serviceusage.serviceUsageAdmin
```

### 将来的な改善（オプション）

初回デプロイが完了し、運用が安定した後、以下への移行を検討：
- Workload Identity Federation（キーレス認証）
- GitHub Actions等のCI/CD環境での自動デプロイ

## 結果

### メリット

| 項目 | 詳細 |
|------|------|
| **シンプル** | クライアント側の理解が容易、GUIで完結 |
| **迅速** | 約15分で納品可能 |
| **柔軟** | メンテナンス・バグフィックス・アップデート全てに対応 |
| **分離** | プロジェクト単位で権限管理、他への影響なし |

### デメリットと軽減策

| デメリット | 軽減策 |
|----------|--------|
| JSONキーの管理が必要 | 暗号化保管、定期ローテーション |
| Ownerロールは過剰 | 初回デプロイ後に最小権限へ縮小 |
| 組織ポリシーの緩和 | プロジェクトレベルのみ、最小限の変更 |

### セキュリティ考慮事項

1. **JSONキーの保管**
   - 暗号化されたストレージに保管
   - チーム内での共有は最小限に
   - 定期的なローテーション

2. **権限の最小化**
   - 初回デプロイ後、速やかに6ロールへ縮小
   - 定期的な権限レビュー

3. **監査ログ**
   - Cloud Audit Logsでサービスアカウントの操作を監視
   - 異常なアクセスを検知

## 実装

### クライアント側手順（GCPコンソール）

#### Step 1: 組織ポリシーの緩和

1. GCPコンソール > 該当プロジェクト > 「IAMと管理」>「組織のポリシー」
2. `iam.allowedPolicyMemberDomains` を検索
   - 「ポリシーを管理」→「親をオーバーライド」
   - 「すべてのドメインを許可」を選択
   - 「ポリシーの適用」: 「交換」
   - 保存
3. `iam.disableServiceAccountKeyCreation` を検索
   - 「ポリシーを管理」→「親をオーバーライド」
   - 「オフ」を選択
   - 保存

#### Step 2: サービスアカウント作成

1. 「IAMと管理」>「サービスアカウント」
2. 「サービスアカウントを作成」
   - 名前: `docsplit-deployer`
   - ID: `docsplit-deployer`（自動生成）
   - 説明: `DocSplit deployment and maintenance`
3. 「作成して続行」

#### Step 3: Ownerロール付与

1. ロール選択: `オーナー`
2. 「続行」→「完了」

#### Step 4: JSONキー作成

1. 作成したサービスアカウントをクリック
2. 「キー」タブ →「鍵を追加」→「新しい鍵を作成」
3. キーのタイプ: `JSON`
4. 「作成」→ キーファイルがダウンロードされる

#### Step 5: 開発者へ共有

- プロジェクトID
- サービスアカウントメールアドレス
- JSONキーファイル（暗号化して送信）

### 開発者側手順

```bash
# Step 1: キーファイルを安全な場所に配置
mkdir -p ~/.gcp-keys
mv ~/Downloads/<project-id>-xxxxx.json ~/.gcp-keys/<project-id>-key.json
chmod 600 ~/.gcp-keys/<project-id>-key.json

# Step 2: 環境変数設定
export GOOGLE_APPLICATION_CREDENTIALS=~/.gcp-keys/<project-id>-key.json

# Step 3: 初回デプロイ実行
cd /path/to/doc-split
./scripts/setup-tenant.sh <project-id> <admin-email> --with-gmail

# Step 4: （推奨）初回デプロイ後、権限を最小化
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

## 実績

### 初回適用プロジェクト

- **プロジェクトID**: docsplit-cocoro
- **組織ID**: 120439346338
- **適用日**: 2026-02-11
- **結果**: 成功。納品・メンテナンス・アップデート全てに対応可能

### はまりポイント（教訓）

1. **別ドメインへのIAMロール付与が不可**
   - 症状: `The policy contains invalid list value(s): [user:xxx@gmail.com]`
   - 原因: `constraints/iam.allowedPolicyMemberDomains` によるドメイン制限
   - 解決: プロジェクトレベルで「すべてのドメインを許可」に変更

2. **サービスアカウントキー作成が不可**
   - 症状: `Key creation is not allowed on this service account. constraints/iam.disableServiceAccountKeyCreation`
   - 原因: セキュリティポリシーによるキー作成禁止
   - 解決: プロジェクトレベルでポリシーを「オフ」に変更

3. **「Secure by Default Organizations」の自動適用**
   - トリガー: 納品日のGCPアカウント初回作成 + 課金アカウント初回設定
   - 参考: https://cloud.google.com/resource-manager/docs/secure-by-default-organizations

## 関連

- ADR-0005: マルチクライアントデプロイ方針
- docs/context/delivery-and-update-guide.md: 納品フロー詳細
- scripts/setup-tenant.sh: セットアップスクリプト

## 変更履歴

- 2026-02-11: 初版作成（docsplit-cocoroプロジェクトでの実績を基に）
