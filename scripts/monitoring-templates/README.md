# Cloud Monitoring アラートポリシー テンプレート

Issue #220 / ADR-0015 Follow-up の log-based metric + alert 基盤で使用する
Cloud Monitoring アラートポリシーの YAML テンプレート。

## ファイル一覧

| ファイル | メトリクス | 閾値 | 根拠 |
|---|---|---|---|
| `alert-searchindex-oom.yaml` | `searchindex_oom` | 1 件 / 1h | 過去30日実績 0 件 (PR #218)。発生即異常 |
| `alert-ocr-page-truncated.yaml` | `ocr_page_truncated` | 3 件 / 1日 | 過去30日実績 2 件 (0.067件/日) の約45倍余裕 |
| `alert-ocr-aggregate-truncated.yaml` | `ocr_aggregate_truncated` | 1 件 / 1日 | 過去30日実績 0 件。per-page 二段目発動は異常 |
| `alert-summary-truncated.yaml` | `summary_truncated` | 1 件 / 1日 | Issue #209 再発指標 |
| `alert-search-index-silent-failure.yaml` | `search_index_silent_failure` | 1 件 / 24h 窓 (incident は 7d 可視化) | ADR-0015「7日1件以上」を autoClose=7d で代替。GCP API alignmentPeriod 上限 25h のため厳密な 7d rolling ではない |

## 共通パラメータ

- `duration`: `0s` (閾値超過で即発火)
- `autoClose`: `86400s` (24h 無発火で自動クローズ)
- `notificationRateLimit`: **未設定**。GCP API 仕様により metric-based alert policy では指定不可（log-based policy 限定）。metric alert は incident オープン時 1 通、`autoClose` まで再通知されない
- 検出遅延: alignment 1h 以内なら約 3-5 分 (ADR-0015 「5分以内」要件を満たす)

## テンプレートの変数

setup スクリプトが以下を置換:
- `__ENV__`: 環境名 (kanameone / cocoro / dev)
- `__NOTIFICATION_CHANNEL__`: 通知チャネル ID (`projects/{project}/notificationChannels/{id}`)
