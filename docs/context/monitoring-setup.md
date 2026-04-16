# 監視基盤セットアップ運用手順

Issue #220 + ADR-0015 Follow-up で構築した log-based metric + Cloud Monitoring alert policy の運用手順。

## 構成概要

- **5 種メトリクス** (log-based) を各環境で作成
- **5 種アラートポリシー** (Cloud Monitoring) をメトリクスと対になる形で作成
- **通知チャネル** 1 つ (email、環境ごと) を作成し全ポリシーで共有

関連コード:
- `scripts/setup-log-based-metrics.sh`: 作成 (冪等、`--dry-run` 対応)
- `scripts/teardown-log-based-metrics.sh`: 削除 (policies → metrics → channel の順)
- `scripts/monitoring-templates/`: alert policy YAML テンプレート
- `.github/workflows/setup-monitoring.yml`: workflow_dispatch 実行基盤

## メトリクス仕様

| メトリクス | ログフィルタ | 閾値 | 閾値根拠 |
|---|---|---|---|
| `searchindex_oom` | `ondocumentwritesearchindex` の "Memory limit exceeded" | 1h 以内に 1 件以上 | PR #218 で 0 件維持、再発即異常 |
| `ocr_page_truncated` | `[OCR] ... text truncated` (WARN) | 24h 以内に 3 件以上 | 過去30日実績 0.067件/日の約45倍 |
| `ocr_aggregate_truncated` | `[OCR] Aggregate pageResults truncated` (WARN) | 24h 以内に 1 件以上 | per-page 二段目発動は異常 |
| `summary_truncated` | `[Summary] truncated` (WARN) | 24h 以内に 1 件以上 | Issue #209 再発指標 |
| `search_index_silent_failure` | `Failed to remove tokens` (severity=ERROR) | 7 日以内に 1 件以上 | ADR-0015 再評価トリガーと一致 |

### アラートポリシー共通パラメータ

- `duration`: 0s (閾値超過で即発火)
- `autoClose`: 24h 無発火で自動クローズ
- `notificationRateLimit`: 1h (通知暴走抑制)
- **検出遅延**: 約 3-5 分 (Cloud Monitoring 標準評価遅延)

## 運用手順

### 初回セットアップ

**GitHub Actions 経由 (推奨)**:
1. Actions → "Setup Monitoring (log-based metrics + alerts)"
2. `environment`: 対象環境を選択
3. `action`: `setup`
4. `notification_email`: 通知先アドレス (HEALTH_REPORT_TO と同一推奨)
5. Run workflow

**ローカル実行 (トラブルシューティング時)**:
```bash
./scripts/setup-log-based-metrics.sh <project-id> <notification-email>
# 例: ./scripts/setup-log-based-metrics.sh docsplit-kanameone alerts@example.com
```

### Dry-run (構文検証)

本番前の動作確認。実リソースは作成せず、既存確認のみ実行:
```bash
./scripts/setup-log-based-metrics.sh <project-id> <notification-email> --dry-run
```

### 冪等性

スクリプトは既存リソースがあれば skip する。再実行しても副作用なし。
ただし**更新は自動では行われない**。既存リソースを変更する場合は先に teardown が必要。

### ロールバック / 削除

**GitHub Actions**:
- `action`: `teardown` を選択して実行

**ローカル**:
```bash
./scripts/teardown-log-based-metrics.sh <project-id> [--yes]
```

削除順序: **policies → metrics → channel** (依存関係の逆順)。

### 確認コマンド

```bash
# メトリクス一覧
gcloud logging metrics list --project=<project-id> \
  --filter='name=(searchindex_oom OR ocr_page_truncated OR ocr_aggregate_truncated OR summary_truncated OR search_index_silent_failure)'

# アラートポリシー一覧
gcloud alpha monitoring policies list --project=<project-id> \
  --filter='displayName:"[<env>]"'

# 通知チャネル
gcloud alpha monitoring channels list --project=<project-id> \
  --filter='displayName:"DocSplit Monitoring Alerts"'
```

## 必要な権限

**初回セットアップを実行する SA または ユーザーアカウント**:
- `roles/logging.configWriter` (log-based metric 作成)
- `roles/monitoring.alertPolicyEditor` (alert policy 作成)
- `roles/monitoring.notificationChannelEditor` (notification channel 作成)
- `roles/serviceusage.serviceUsageConsumer` (API 利用)

**既存の `docsplit-cloud-build@<project>.iam.gserviceaccount.com` の権限**:
```
roles/logging.logWriter
```
→ **configWriter を含まないため、本セットアップは実行不可**。

### 権限不足の解消手順

**オプション 1: 既存 SA に 3 roles 追加** (最小変更、ただし deploy SA が監視変更権限を持つ副作用):
```bash
PROJECT_ID=docsplit-kanameone
SA="docsplit-cloud-build@${PROJECT_ID}.iam.gserviceaccount.com"

for role in \
  roles/logging.configWriter \
  roles/monitoring.alertPolicyEditor \
  roles/monitoring.notificationChannelEditor; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SA" --role="$role"
done
```

**オプション 2: 専用 SA 新規作成** (最小権限原則、Codex 推奨、要 Secret 登録):
- SA 名: `docsplit-monitoring-admin@<project>`
- 上記 3 roles のみ付与
- キー発行 → GitHub Secrets に `MONITORING_SA_KEY_<ENV>` として登録
- workflow の `credentials_json` を SA 別に差し替え

本 PR では script と workflow の枠組みのみを提供し、**権限付与はフォローアップタスクとして別 PR で実施**する。

## 通知先の調整

Cloud Monitoring の notification channel の email アドレスを変更する場合:
1. 対象 channel の ID を特定 (上記確認コマンド)
2. `gcloud alpha monitoring channels update <CHANNEL_ID> --update-channel-labels=email_address=<new-email> --project=<project>`

または teardown → setup で再作成。

## 関連ドキュメント

- [ADR-0015](../adr/0015-search-index-silent-failure-policy.md): silent failure 対処方針
- Issue #220: log-based metric + alert (本タスクの起票元)
- Issue #229: 復旧 SOP + force reindex (ADR-0015 Follow-up)
- Issue #217 / PR #218: OOM 応急対処 (searchindex_oom の対象)
- Issue #205 / PR #208: OCR 切り詰め防御 (ocr_*_truncated の対象)
- Issue #209 / PR #212: summary 切り詰め防御 (summary_truncated の対象)
- Issue #219 / PR #222: silent failure 監視可能化 (search_index_silent_failure の対象)
