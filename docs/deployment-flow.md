# 納品フロー

クライアントへの納品は、**GCPプロジェクト移譲方式**を採用しています。各クライアントに独立したGCPプロジェクトを作成し、完全にデータ分離された環境を提供します。

## 納品フロー全体像

```mermaid
flowchart TD
    subgraph Preparation["1. 事前準備"]
        A1["クライアント情報収集"]
        A2["GCPプロジェクト作成"]
        A3["請求アカウント設定"]
    end

    subgraph Setup["2. 初期設定 (自動)"]
        B1["setup-tenant.sh 実行"]
        B2["API有効化"]
        B3["Firebase設定"]
        B4["管理者登録"]
        B5["デプロイ"]
    end

    subgraph Gmail["3. Gmail連携設定"]
        C1["OAuth設定"]
        C2["setup-gmail-auth.sh 実行"]
    end

    subgraph Data["4. データ投入"]
        D1["マスターデータCSV準備"]
        D2["import-masters.js 実行"]
    end

    subgraph Handover["5. 引き渡し"]
        E1["動作確認"]
        E2["管理者への説明"]
        E3["プロジェクト権限移譲"]
    end

    A1 --> A2 --> A3
    A3 --> B1
    B1 --> B2 --> B3 --> B4 --> B5
    B5 --> C1 --> C2
    C2 --> D1 --> D2
    D2 --> E1 --> E2 --> E3
```

## 1. 事前準備

### 必要な情報

| 項目 | 例 | 用途 |
|------|-----|------|
| クライアント名 | 株式会社ABC | プロジェクト名 |
| 管理者メール | admin@abc.co.jp | 初期管理者 |
| 監視Gmail | docs@abc.co.jp | 書類取得元 |
| マスターデータ | CSV | 顧客・書類種別等 |

### GCPプロジェクト作成

```bash
# プロジェクト作成
gcloud projects create abc-docsplit --name="ABC DocSplit"

# 請求アカウント紐付け
gcloud billing projects link abc-docsplit --billing-account=XXXXXX-XXXXXX-XXXXXX

# Firebaseプロジェクト追加
firebase projects:addfirebase abc-docsplit
```

## 2. 初期設定（自動化）

### setup-tenant.sh の実行

```bash
./scripts/setup-tenant.sh abc-docsplit admin@abc.co.jp docs@abc.co.jp
```

このスクリプトが自動実行する内容：

```mermaid
flowchart LR
    subgraph Step1["Step 1"]
        A["GCP API有効化<br/>(9個)"]
    end

    subgraph Step2["Step 2"]
        B["Firebase設定"]
    end

    subgraph Step3["Step 3"]
        C["環境変数生成<br/>(frontend/.env)"]
    end

    subgraph Step4["Step 4"]
        D["管理者ユーザー<br/>Firestore登録"]
    end

    subgraph Step5["Step 5"]
        E["セキュリティルール<br/>インデックス デプロイ"]
    end

    subgraph Step6["Step 6"]
        F["Cloud Functions<br/>デプロイ"]
    end

    subgraph Step7["Step 7"]
        G["Hosting<br/>デプロイ"]
    end

    A --> B --> C --> D --> E --> F --> G
```

### 有効化されるAPI

| API | 用途 |
|-----|------|
| cloudfunctions.googleapis.com | Cloud Functions |
| firestore.googleapis.com | Firestore |
| storage.googleapis.com | Cloud Storage |
| aiplatform.googleapis.com | Vertex AI (Gemini) |
| gmail.googleapis.com | Gmail連携 |
| secretmanager.googleapis.com | 認証情報管理 |
| cloudscheduler.googleapis.com | 定期実行 |
| cloudbuild.googleapis.com | Functions ビルド |
| pubsub.googleapis.com | メッセージング |

## 3. Gmail連携設定

### OAuth認証の設定

```mermaid
sequenceDiagram
    participant Admin as 設定担当者
    participant GCP as GCP Console
    participant Script as setup-gmail-auth.sh
    participant Google as Google OAuth
    participant Secret as Secret Manager

    Admin->>GCP: OAuth クライアントID作成
    GCP-->>Admin: Client ID / Secret

    Admin->>Script: スクリプト実行
    Script->>Admin: 認証URL表示
    Admin->>Google: ブラウザでアクセス
    Google-->>Admin: 認証コード

    Admin->>Script: 認証コード入力
    Script->>Google: トークン取得
    Google-->>Script: Refresh Token

    Script->>Secret: 認証情報保存
    Note over Secret: gmail-oauth-client-id<br/>gmail-oauth-client-secret<br/>gmail-oauth-refresh-token
```

### 実行コマンド

```bash
./scripts/setup-gmail-auth.sh abc-docsplit
```

## 4. マスターデータ投入

### CSVフォーマット

**customers.csv**
```csv
name,furigana,isDuplicate,careManagerName,notes
山田太郎,ヤマダタロウ,false,佐藤花子,
```

**documents.csv**
```csv
name,category,keywords
提供票,介護保険,提供票;サービス提供票
```

### インポート実行

```bash
# 個別インポート
node scripts/import-masters.js --customers data/customers.csv

# 一括インポート
node scripts/import-masters.js --all data/
```

## 5. 引き渡し

### 動作確認チェックリスト

| 項目 | 確認方法 |
|------|----------|
| ログイン | 管理者メールでGoogleログイン |
| 書類一覧表示 | トップページ表示 |
| マスター確認 | マスターページでデータ表示 |
| Gmail連携 | 設定ページでステータス確認 |
| エラーログ | エラー履歴ページ |

### 管理者への説明事項

1. **日常操作**
   - 書類の検索・閲覧
   - PDF分割機能の使い方

2. **管理機能**
   - ユーザー追加・削除
   - マスターデータ編集
   - Gmail監視設定

3. **注意事項**
   - 月額コスト目安（〜3,000円）
   - エラー発生時の対処

### プロジェクト権限移譲

```bash
# オーナー権限付与
gcloud projects add-iam-policy-binding abc-docsplit \
  --member="user:owner@abc.co.jp" \
  --role="roles/owner"

# 自分の権限削除（任意）
gcloud projects remove-iam-policy-binding abc-docsplit \
  --member="user:your-email@example.com" \
  --role="roles/owner"
```

## 納品所要時間の目安

| フェーズ | 所要時間 |
|----------|----------|
| 事前準備 | 15分 |
| 初期設定（自動） | 10分 |
| Gmail連携設定 | 10分 |
| マスターデータ投入 | 5分 |
| 動作確認・説明 | 30分 |
| **合計** | **約1時間** |

## トラブルシューティング

### よくある問題

| 問題 | 原因 | 対処 |
|------|------|------|
| ログインできない | ホワイトリスト未登録 | users コレクションに追加 |
| Gmail取得されない | OAuth認証エラー | setup-gmail-auth.sh 再実行 |
| OCRエラー | Gemini API制限 | しばらく待って再実行 |
| デプロイ失敗 | 権限不足 | IAMロール確認 |
