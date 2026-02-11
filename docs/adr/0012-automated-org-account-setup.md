# ADR-0012: 組織アカウント環境の納品プロセス自動化

## ステータス

承認済み (2026-02-11)

## コンテキスト

### 問題

ADR-0011で組織アカウント環境でのサービスアカウント納品方式を確立したが、以下の課題が残っていた：

| 課題 | 影響 |
|------|------|
| 組織ポリシー緩和がGCPコンソールでの手動GUI操作 | クライアント側の理解と操作が必要 |
| サービスアカウント作成・JSONキー生成が手動 | 手順が複雑、ミスが発生しやすい |
| 所要時間が約15分 | クライアント側の負担が大きい |

### トリガー

- 実際のクライアント納品（docsplit-cocoro）で組織ポリシー対応に手惑った
- クライアント側の操作をさらに簡素化・高速化する要望

## 決定

### 採用方式: クライアント側スクリプトの自動フォールバック

`client-setup-gcp.sh`（+ .bat）を改善し、組織ポリシーによる権限付与失敗を**自動検出**し、サービスアカウント方式に自動的にフォールバックする。

**フロー**:

```
1. GCPプロジェクト作成
2. 課金アカウント紐付け
3. 開発者へのオーナー権限付与を試行
   ↓
   成功 → 従来フロー（プロジェクトIDを開発者に連絡）
   ↓
   失敗（組織ポリシー検出）→ 自動フォールバック:
     4a. 組織ポリシー緩和（gcloud org-policies）
     4b. サービスアカウント作成 + Ownerロール付与
     4c. JSONキー生成（ホームディレクトリに保存）
   ↓
   完了メッセージ表示（JSONキー送付を案内）
```

### 実装の要点

#### 1. 組織ポリシー制約の自動検出

```bash
# エラーメッセージを取得
IAM_ERROR=$(gcloud projects add-iam-policy-binding ... 2>&1)

# 組織ポリシー制約を検出
if echo "$IAM_ERROR" | grep -q "constraints/iam.allowedPolicyMemberDomains"; then
    # 自動フォールバック開始
fi
```

#### 2. 組織ポリシー緩和の自動化

gcloudコマンドでYAMLベースのポリシー設定を適用：

```bash
# iam.allowedPolicyMemberDomains を「すべてのドメインを許可」に変更
gcloud org-policies set-policy /tmp/allow-all-domains.yaml --project=$PROJECT_ID

# iam.disableServiceAccountKeyCreation を「オフ」に変更
gcloud org-policies set-policy /tmp/disable-key-creation-off.yaml --project=$PROJECT_ID
```

#### 3. サービスアカウント自動作成

```bash
# サービスアカウント作成
gcloud iam service-accounts create docsplit-deployer ...

# Ownerロール付与
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:docsplit-deployer@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/owner"

# JSONキー生成（ホームディレクトリに保存）
gcloud iam service-accounts keys create ~/docsplit-deployer-$PROJECT_ID.json ...
chmod 600 ~/docsplit-deployer-$PROJECT_ID.json
```

#### 4. 分岐した完了メッセージ

```bash
if [ "$USE_SERVICE_ACCOUNT" = true ]; then
    # サービスアカウント方式の場合
    echo "1. 以下のファイルを開発者に安全に送付してください:"
    echo "   - プロジェクトID: $PROJECT_ID"
    echo "   - JSONキー: $KEY_FILE"
else
    # 従来フロー
    echo "1. 開発者にプロジェクトID「$PROJECT_ID」を連絡してください"
fi
```

## 結果

### メリット

| 項目 | 改善前（ADR-0011） | 改善後（本ADR） |
|------|-------------------|----------------|
| **クライアント側操作** | GCPコンソールでGUI操作が必要 | スクリプト実行のみ（対話に答えるだけ） |
| **所要時間** | 約15分 | **約5分** |
| **ミスの発生** | 手動操作でミスの可能性あり | 自動化でミス最小化 |
| **理解の必要性** | 組織ポリシー概念の理解が必要 | スクリプトが自動判断 |

### クライアント側の体験

**従来（ADR-0011）**:
```
1. スクリプト実行
2. 権限付与失敗のエラー → 困惑
3. 開発者に連絡 → 手順書を受領
4. GCPコンソールにログイン
5. 「IAMと管理」→「組織のポリシー」を探す
6. ポリシーを検索・変更（複数回）
7. サービスアカウント作成（GUI操作）
8. JSONキーダウンロード
9. 開発者に送付
```

**改善後（本ADR）**:
```
1. スクリプト実行
2. 対話に答える（プロジェクトID、課金アカウント等）
3. 完了メッセージに従ってJSONキーを開発者に送付
```

### 技術的な利点

- **冪等性**: 既にポリシーが緩和されている場合もエラーにならない
- **フェイルセーフ**: 組織ポリシー緩和に失敗した場合は従来の手動手順を案内
- **クロスプラットフォーム**: sh版（Mac/Linux）とbat版（Windows）の両方で実装

### デメリットと軽減策

| デメリット | 軽減策 |
|----------|--------|
| gcloud org-policies にはOrganization Administrator権限が必要 | プロジェクト作成者は通常この権限を持っている |
| 自動化により問題の可視性が下がる | エラー時は詳細なエラーメッセージとADR-0011へのリンクを表示 |

## 関連

- ADR-0011: 組織アカウント対応の背景と手動手順
- `scripts/client-setup-gcp.sh`: sh版スクリプト（Mac/Linux）
- `scripts/client-setup-gcp.bat`: bat版スクリプト（Windows）
- `docs/context/delivery-and-update-guide.md`: 納品フロー全体のガイド

## 変更履歴

- 2026-02-11: 初版作成（sh版・bat版の自動化実装完了）
