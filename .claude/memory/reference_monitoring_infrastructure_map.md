---
name: reference-monitoring-infrastructure-map
description: doc-splitの監視基盤(log-based metric + Cloud Monitoringアラート)の運用手順・マスター文書・専用workflowの所在。監視系の変更前に必ず参照する
metadata:
  type: reference
---

監視基盤(log-based metric + Cloud Monitoringアラート)を新規追加・変更する際は、着手前に以下を必ず確認する。

## マスター文書

`docs/context/monitoring-setup.md` — メトリクス仕様一覧・アラートポリシー共通パラメータ・運用手順(セットアップ/dry-run/冪等性/ロールバック)・確認コマンドの正本。新しいメトリクス/アラートを追加したら必ずこのファイルも更新する(2026-09-19、`processocr_error`追加時に更新漏れがFableセカンドオピニオンで指摘された実績あり)。

## 関連コード・専用workflow

- `scripts/setup-log-based-metrics.sh` / `scripts/teardown-log-based-metrics.sh`: 作成・削除の実処理(冪等)
- `scripts/monitoring-templates/*.yaml`: アラートポリシーのYAMLテンプレート(README.md併記)
- **`.github/workflows/setup-monitoring.yml`**: 監視設定の実行専用workflow。専用の最小権限サービスアカウント(`MONITORING_SA_KEY_KANAMEONE`/`MONITORING_SA_KEY_DEV`/`MONITORING_SA_KEY_COCORO`、2026-04登録済み)を使い、`logging.configWriter`/`monitoring.alertPolicyEditor`/`monitoring.notificationChannelEditor`のみを持つ。**汎用オペレーション実行workflow(`.github/workflows/run-ops-script.yml`)には監視設定の実行経路を追加しない**——汎用デプロイ用サービスアカウントは監視API書き込み権限を持たない設計であり、重複実装すると権限不足エラー・無駄なIAM調査を招く(2026-09-19、実際に発生し全面撤回した事例あり、[[feedback_check_existing_implementation_before_new_infra]])

## 既知の設計上の注意点

- log-based metricのフィルタにseverity条件を含める場合、対象コードがfirebase-functions/loggerを使っているかを先に確認する。`functions/src`は素の`console.error`/`console.warn`を多用しており、これらは自動的にCloud Loggingのseverityへ昇格されずDEFAULTのまま記録される(実測確認済み)。既存メトリクス`search_index_silent_failure`(`severity="ERROR"`)・`claim_divergent_backlog_stale`(`severity="WARNING"`)にも同種の不一致があった(2026-09-20に実測確認、GitHub Issue #981 / PR #985でseverity条件を除去し3環境へ反映済み)
- Cloud Run標準メトリクス(`run.googleapis.com/request_latencies`等)を使う場合、対象のCloud Functions/Cloud Runが「1回の呼び出し内で複数件を直列処理する」設計かどうかを確認する。`processOCR`は1分間隔・`concurrency:1`で1 tick内に最大5件(`BATCH_SIZE`)を直列処理するため、標準latencyメトリクスは「1 tickの所要時間」であって「1文書あたりの処理時間」ではない

## 関連

- [[feedback_check_existing_implementation_before_new_infra]] — 本ファイル作成の直接の契機(グローバルmemory)
