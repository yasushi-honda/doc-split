# 健全性レポート

毎日自動で各クライアント環境の稼働状況を収集し、HTMLレポートをメール配信するシステムです。

## 配信スケジュール

| 項目 | 値 |
|------|-----|
| 配信時刻 | 毎日 09:00 JST |
| 実行基盤 | GitHub Actions（cron） |
| 対象環境 | cocoro / kanameone |
| 形式 | HTMLメール + アーティファクト保存（30日間） |

## レポート内容

### Cloud Functions

全関数の稼働状態を表示します。

| 表示 | 意味 |
|------|------|
| N/N 稼働中（緑） | 全関数が正常稼働 |
| X/N 稼働中（赤） | 一部関数が停止。関数名と状態を表示 |

### Cloud Scheduler

| 列 | 内容 |
|----|------|
| ジョブ名 | checkGmailAttachments / processOCR |
| スケジュール | cron式 |
| 最終実行 | 最後に実行された日時 |
| 状態 | ENABLED（緑）/ PAUSED等（赤） |

### 書類（Documents）

Firestoreの`documents`コレクションをステータス別に集計します。

| カード | 意味 | 正常時の色 |
|--------|------|-----------|
| 処理済み | OCR完了した書類 | 緑 |
| 待機中 | 処理待ちの書類 | 黄（0なら緑） |
| 処理中 | OCR処理中の書類 | 黄（0なら緑） |
| エラー | 処理失敗した書類 | 赤（0なら緑） |
| 分割済み | PDF分割済みの書類 | 緑 |

### エラー書類

エラーステータスの書類がある場合、直近5件のファイル名とエラー内容を表示します。

### ストレージ

Cloud Storageの合計使用容量を表示します。

## 異常時の対応

| レポートの異常 | 考えられる原因 | 対応 |
|---------------|---------------|------|
| Functions が N/N 未満 | 関数デプロイ失敗・クラッシュ | Firebase Consoleでログ確認、再デプロイ |
| Scheduler が PAUSED | 手動で一時停止された | `gcloud scheduler jobs resume` で再開 |
| 待機中が増加 | processOCRが停止 or Gemini制限 | Functions ログ確認、時間をおいて確認 |
| エラーが増加 | OCR処理失敗 | エラー内容を確認し、再処理 or マスターデータ更新 |
| ストレージが急増 | 大量の書類アップロード | 不要ファイルの整理を検討 |

### エラー書類の再処理

```bash
# 状況確認（変更なし）
FIREBASE_PROJECT_ID=<project-id> node scripts/fix-stuck-documents.js --include-errors --dry-run

# pendingにリセット（OCRポーリングが自動で再処理）
FIREBASE_PROJECT_ID=<project-id> node scripts/fix-stuck-documents.js --include-errors
```

## 手動実行

GitHub Actionsの画面から手動でレポートを生成できます。

1. リポジトリの **Actions** タブを開く
2. 左メニューから **Health Report** を選択
3. **Run workflow** をクリック
4. `dry_run` を選択:
   - `true`: メール送信なし（アーティファクトのみ保存）
   - `false`: 実際にメール送信

## 設定変更

### 配信先の変更

GitHub Secretsの `HEALTH_REPORT_TO` を更新します。

### 監視対象の追加

`.github/workflows/health-report.yml` の `CLIENT_PROJECTS` 環境変数に追加します。

```yaml
CLIENT_PROJECTS: 'cocoro:docsplit-cocoro,kanameone:docsplit-kanameone,new-client:docsplit-new'
```

新しいクライアントを追加する場合は、監視用サービスアカウントにそのプロジェクトへのREAD権限の付与も必要です。

## 技術構成

```
scripts/health-report/
  generate-report.js          # メインスクリプト
  lib/
    gcp-collector.js           # gcloud CLIでFunctions/Scheduler/Storage取得
    firestore-collector.js     # firebase-admin SDKでドキュメント集計
    report-formatter.js        # HTMLレポート生成
    mailer.js                  # nodemailer + Gmail SMTP
```
