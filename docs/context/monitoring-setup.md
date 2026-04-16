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
| `search_index_silent_failure` | `Failed to remove tokens` (severity=ERROR) | 7 日以内に 1 件以上 | ADR-0015 再評価トリガー条件1 (`#220 metric で severity=ERROR ログが 7日間に 1件以上発生`) と一致 |

### アラートポリシー共通パラメータ

- `duration`: 0s (閾値超過で即発火)
- `autoClose`: 24h 無発火で自動クローズ
- `notificationRateLimit`: **未設定**。Cloud Monitoring API の仕様により metric-based alert policy では指定不可（log-based policy 限定）。Cloud Monitoring のデフォルト再通知挙動に依存。まれな事象 (OOM / truncated) のため実害なし
- **検出遅延**:
  - `searchindex_oom` (alignment 1h): 約 3-5 分
  - `ocr_*_truncated` / `summary_truncated` (alignment 24h): 数分〜最大数時間 (Cloud Monitoring の rolling 評価依存)
  - `search_index_silent_failure` (alignment 7日): 同上、即時検知には向かない

ADR-0015 要件「5 分以内」は `searchindex_oom` のみ厳密に満たす。他は「日次〜週次で必ず検出」を目標とする。

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

本番前の動作確認。**リソース作成はスキップするが、既存確認の `gcloud describe/list` 呼び出しは実行する** (権限エラー時は dry-run でも失敗する)。
```bash
./scripts/setup-log-based-metrics.sh <project-id> <notification-email> --dry-run
```

未知の引数 (例: `--dryrun`, `-n`, `--DRY-RUN`) は reject される (typo による silent 作成防止)。

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

# アラートポリシー一覧 (user_labels で本 script が作成したもののみ識別)
gcloud alpha monitoring policies list --project=<project-id> \
  --filter='userLabels.source="docsplit-monitoring-setup"'

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

**オプション 2: 専用 SA 新規作成** (最小権限原則、採用方針):
- SA 名: `docsplit-monitoring-admin@<project>.iam.gserviceaccount.com`
- 上記 3 roles のみ付与 (`roles/logging.configWriter`, `roles/monitoring.alertPolicyEditor`, `roles/monitoring.notificationChannelEditor`)
- キー発行 → GitHub Secrets に登録
- `setup-monitoring.yml` の `credentials_json` は以下の Secret を参照する:
  - `MONITORING_SA_KEY_DEV` (dev)
  - `MONITORING_SA_KEY_KANAMEONE` (kanameone)
  - `MONITORING_SA_KEY_COCORO` (cocoro)

### セットアップ手順 (環境ごとに 1 回)

```bash
# 1. SA 作成
gcloud iam service-accounts create docsplit-monitoring-admin \
  --display-name="DocSplit Monitoring Admin (log-based metrics + alerts)" \
  --project=<project-id>

# 2. 3 roles 付与
SA="docsplit-monitoring-admin@<project-id>.iam.gserviceaccount.com"
for role in \
  roles/logging.configWriter \
  roles/monitoring.alertPolicyEditor \
  roles/monitoring.notificationChannelEditor; do
  gcloud projects add-iam-policy-binding <project-id> \
    --member="serviceAccount:$SA" --role="$role" --condition=None --quiet
done

# 3. キー発行 → Secret 登録 → 鍵ファイル削除
gcloud iam service-accounts keys create /tmp/monitoring-sa.json \
  --iam-account=$SA --project=<project-id>
gh secret set MONITORING_SA_KEY_<ENV> --repo yasushi-honda/doc-split \
  < /tmp/monitoring-sa.json
rm /tmp/monitoring-sa.json
```

### 展開状況

- ✅ dev: SA + Secret 登録済み (2026-04-17)
- ⏳ kanameone: 未セットアップ
- ⏳ cocoro: 未セットアップ

## 通知先の調整

Cloud Monitoring の notification channel の email アドレスを変更する場合:
1. 対象 channel の ID を特定 (上記確認コマンド)
2. `gcloud alpha monitoring channels update <CHANNEL_ID> --update-channel-labels=email_address=<new-email> --project=<project>`

または teardown → setup で再作成。

## gcloud alpha 依存について

本 script は `gcloud alpha monitoring` (channels/policies) を使用している。2026-04-16 時点の `gcloud` CLI では Cloud Monitoring の `channels` / `policies` サブコマンドは GA 化されておらず alpha track のみ利用可。alpha は予告なく変更される可能性があるため:

- 定期的に `gcloud beta monitoring` または `gcloud monitoring` の利用可能性を確認する
- 破壊的変更があった場合は本 script を更新する
- 代替手段として Google Cloud Monitoring API (REST / gRPC) 直接呼び出しも検討可能

## 関連ドキュメント

- [ADR-0015](../adr/0015-search-index-silent-failure-policy.md): silent failure 対処方針
- Issue #220: log-based metric + alert (本タスクの起票元)
- Issue #229: 復旧 SOP + force reindex (ADR-0015 Follow-up)
- Issue #217 / PR #218: OOM 応急対処 (searchindex_oom の対象)
- Issue #205 / PR #208: OCR 切り詰め防御 (ocr_*_truncated の対象)
- Issue #209 / PR #212: summary 切り詰め防御 (summary_truncated の対象)
- Issue #219 / PR #222: silent failure 監視可能化 (search_index_silent_failure の対象)
