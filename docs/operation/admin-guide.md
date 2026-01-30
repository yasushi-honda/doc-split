# DocSplit 管理者ガイド

## 管理者機能

管理者（role: admin）は以下の追加機能にアクセスできます：

- 設定画面
- マスターデータ管理
- ユーザー管理

## 設定画面

### Gmail設定

| 項目 | 説明 |
|---|---|
| 監視ラベル | 監視対象のGmailラベル（複数指定可） |
| ラベル条件 | AND（全ラベル一致）/ OR（いずれかのラベル） |
| 監視アカウント | 監視対象のGmailアドレス |

### ユーザー管理

ログインを許可するユーザーをホワイトリストで管理します。

**ユーザー追加:**
1. 「ユーザー追加」をクリック
2. Googleアカウントのメールアドレスを入力
3. ロール（admin / user）を選択
4. 「追加」をクリック

**ユーザー削除:**
1. 一覧から対象ユーザーの「削除」をクリック
2. 確認ダイアログで「削除」をクリック

### 通知設定

エラー発生時の通知先メールアドレスを設定します。

## マスターデータ管理

### 顧客マスター

| フィールド | 説明 |
|---|---|
| 名前 | 顧客名 |
| ふりがな | 検索用のふりがな |
| 担当ケアマネ | 担当のケアマネジャー |
| 許容表記（エイリアス） | OCRマッチングで認識する別表記 |

**許容表記（エイリアス）について:**
- 「山田 太郎」と「山田　太郎」（全角スペース）など、表記ゆれを登録
- 確定時に「この表記を記憶する」にチェックすると自動追加
- 一度登録すると、次回から同じ表記が自動マッチ

### 書類マスター

| フィールド | 説明 |
|---|---|
| 書類名 | 書類の種類名 |
| 日付マーカー | 日付を探す際の目印（例: "発行日"） |
| カテゴリ | 分類用のカテゴリ |
| 許容表記（エイリアス） | OCRマッチングで認識する別表記 |

### 事業所マスター

| フィールド | 説明 |
|---|---|
| 名前 | 事業所名 |
| 許容表記（エイリアス） | OCRマッチングで認識する別表記 |

**同名事業所について:**
- 支店名など同じ名前の事業所がある場合、OCR処理で候補として表示
- ユーザーが手動で正しい事業所を選択

### ケアマネマスター

| フィールド | 説明 |
|---|---|
| 名前 | ケアマネジャー名 |

## 自動処理スケジュール

Cloud Functionsによる自動処理のスケジュール：

| 関数 | 間隔 | 説明 |
|------|------|------|
| checkGmailAttachments | 5分 | Gmailから新着添付ファイルを取得 |
| processOCR | 1分 | 処理待ち書類のOCR実行 |

※processOCRは1分間隔で実行されるため、書類アップロード後1〜2分でOCR処理が完了します。

## 監視・トラブルシューティング

### ログの確認

**Firebase Console:**
```
https://console.firebase.google.com/project/doc-split-dev/functions/logs
```

**GCP Console:**
```
https://console.cloud.google.com/logs/query?project=doc-split-dev
```

### よくあるエラー

#### Gmail API エラー

```
error_type: gmail_fetch_failed
```

**原因:**
- OAuth トークンの期限切れ
- Gmail API のクォータ超過
- ネットワークエラー

**対処:**
1. Cloud Functions のログを確認
2. Secret Manager の認証情報を更新（必要な場合）
3. Gmail API のクォータを確認

#### OCR エラー

```
error_type: ocr_failed
```

**原因:**
- Gemini API のレート制限
- 画像品質の問題
- PDFの破損

**対処:**
1. エラー履歴画面から「再処理」を実行
2. レート制限の場合は時間をおいて再試行
3. PDFが破損している場合は手動で対応

#### マッチング失敗

```
error_type: matching_failed
```

**原因:**
- マスターデータに該当がない
- OCR結果の精度が低い
- 類似度が閾値（70%）未満

**対処:**
1. マスターデータを確認・追加
2. 書類詳細から手動で修正

### Gemini API コスト監視

日次のAPI使用量は Firestore の `/stats/gemini/daily` に記録されます。

確認方法:
```javascript
// Firestore Console から確認
/stats/gemini/daily/{YYYY-MM-DD}
{
  inputTokens: number,
  outputTokens: number,
  totalRequests: number,
  estimatedCost: number
}
```

### 定期メンテナンス

**推奨作業:**
1. 週次: エラー履歴の確認・対応
2. 月次: Gemini API コストの確認
3. 月次: Storage 使用量の確認

## 緊急時対応

### Functions の停止

```bash
# すべての Functions を無効化
firebase functions:config:set maintenance.enabled=true
firebase deploy --only functions
```

### データのバックアップ

```bash
# Firestore エクスポート
gcloud firestore export gs://doc-split-dev-backups/$(date +%Y%m%d)
```

### ロールバック

```bash
# 前バージョンへのロールバック
firebase hosting:rollback

# Functions は自動ロールバック不可（再デプロイが必要）
```
