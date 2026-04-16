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
| `alert-search-index-silent-failure.yaml` | `search_index_silent_failure` | 1 件 / 7日 | ADR-0015 再評価トリガーと一致 |

## 共通パラメータ

- `duration`: `0s` (閾値超過で即発火)
- `autoClose`: `86400s` (24h 無発火で自動クローズ)
- `notificationRateLimit.period`: `3600s` (通知の暴走抑制)
- 検出遅延: alignment 1h 以内なら約 3-5 分 (ADR-0015 「5分以内」要件を満たす)

## テンプレートの変数

setup スクリプトが以下を置換:
- `__ENV__`: 環境名 (kanameone / cocoro / dev)
- `__NOTIFICATION_CHANNEL__`: 通知チャネル ID (`projects/{project}/notificationChannels/{id}`)
