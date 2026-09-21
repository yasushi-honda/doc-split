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
| `alert-drive-folder-divergent.yaml` | `drive_folder_divergent` | 1 件 / 24h 窓 (incident は 7d 可視化) | Issue #871 恒久対応。実績: 約2.5週間で2件、発生自体が異常 |
| `alert-drive-folder-divergent-record-failed.yaml` | `drive_folder_divergent_record_failed` | 1 件 / 24h 窓 (incident は 7d 可視化) | Issue #871 恒久対応。`markDivergent()`書込み失敗はclaimにもメトリクスにも残らない経路があるため高優先度 |
| `alert-claim-divergent-backlog-stale.yaml` | `claim_divergent_backlog_stale` | 1 件 / 24h 窓 (incident は 7d 可視化) | Issue #871 恒久対応。日次sweepが3日超の未解決滞留を検知した回のみ発火(「新規発生」検知だけでは放置を検知できないギャップを埋める) |
| `alert-processocr-stalled.yaml` | `processocr_completed` | **absence**条件: 20分間ログ欠落 | ADR-0025 PR6、Issue #966。`processOCR`の`concurrency:1`導入に伴う健全性監視(原因を問わずOCR処理停止を検知)。閾値超過型ではなく**ログの欠落**を検知する点が他テンプレートと異なる |
| `alert-processocr-error-spike.yaml` | `processocr_error` | 1 件 / 1h | ADR-0025 PaddleOCR Pass1全面切替(2026-09-19)後の一時的事後監視(`lifecycle: temporary`、`review_by: 2026-10-03`)。log-based metricのフィルタにseverity条件は付けていない(`console.error()`はfirebase-functions/logger未使用のためCloud Loggingで自動的にERROR severityへ昇格されずDEFAULTのまま記録される実測を確認済み、当初`severity="ERROR"`を含めていたが構造的に一致しない欠陥がFable 5.1セカンドオピニオンで判明し修正)。実データ確認(2026-09-19、dev/kanameone/cocoro直近30日とも該当ログ0件、陽性検証材料なし)。`Error processing document`ログは transient エラー(自動リトライで最終的に成功する一時失敗)でも無条件に出力されるため、将来transientエラーが増えた場合は誤発火しうる。**観察期間終了後に削除 or 恒久化を再判断**すること |
| `alert-processocr-request-timeout.yaml` | `processocr_request_timeout` | 1 件 / 1h | processOCRが900秒のrequest timeoutで強制終了(HTTP 504、Cloud Runリクエストログの`httpRequest.status=504`)。PaddleOCR実測(1ページ約13〜19秒)で約46ページ以上の大型文書が予算超過しうる(2026-09-21 kanameoneで実発生・自動回復)。アプリログを残さないため`processocr_error`では検知できない。実ログでフィルタの陽性検証済み。恒久運用 |
| `alert-search-index-write-failed.yaml` | `search_index_write_failed` | 1 件 / 24h 窓 (incident は 7d 可視化) | Issue #984。サイズ超過と判定できなかった索引書込み失敗(`index write failed`。一時障害・権限障害、および判定関数が SDK/バックエンドの文言変更で外れた場合)を検知。0 が正常。なお高頻度トークンのスキップ(`token skipped`)は別 metric `search_index_token_skipped` で観測のみ行い、kanameone では段階2まで常時発生するためアラートは付けていない |

**見送り(2026-09-19)**: Cloud Run標準メトリクス`run.googleapis.com/request_latencies`を使ったp95閾値監視は、`processOCR`が1分間隔・`concurrency:1`で1 tick内に最大5件を直列処理する設計(`processOCR.ts`)のため、「1 tickの所要時間」であって「PaddleOCR呼び出し自体のlatency」ではなく、5分windowのp95が実処理を含むtickの混入で日常的に閾値超過し誤発火する設計不備がFable 5.1セカンドオピニオンで指摘され、適用直後に撤回した(cocoro/kanameoneとも削除済み)。正しい設計(文書単位の処理時間をログ化してlog-based metric化する等)は別タスクとして再検討する。

## 共通パラメータ

- `duration`: `0s` (閾値超過で即発火)。例外: `alert-processocr-stalled.yaml`は`conditionAbsent`(絶対条件)のため`duration: 1200s`(1サイクル最大900秒+次tick待ち最大60秒=960秒に対するマージン)
- `autoClose`: `86400s` (24h 無発火で自動クローズ)
- `notificationRateLimit`: **未設定**。GCP API 仕様により metric-based alert policy では指定不可（log-based policy 限定）。metric alert は incident オープン時 1 通、`autoClose` まで再通知されない
- 検出遅延: alignment 1h 以内なら約 3-5 分 (ADR-0015 「5分以内」要件を満たす)。`alert-processocr-stalled.yaml`はabsence条件のため約20-21分(上表参照)

## テンプレートの変数

setup スクリプトが以下を置換:
- `__ENV__`: 環境名 (kanameone / cocoro / dev)
- `__NOTIFICATION_CHANNEL__`: 通知チャネル ID (`projects/{project}/notificationChannels/{id}`)
