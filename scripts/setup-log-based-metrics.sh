#!/bin/bash
# Cloud Logging log-based metric + Cloud Monitoring alert policy セットアップ
#
# Issue #220 + ADR-0015 Follow-up の運用監視基盤を作成する。
# 一度実行すれば自動監視が開始される。冪等 (既存は既定で変更しない = skip)。
# 既存 metric の filter が定義と食い違う場合は警告する。反映は UPDATE_EXISTING_METRICS=1 を付けて再実行 (#981)。
#
# 使用方法:
#   ./scripts/setup-log-based-metrics.sh <project-id> <notification-email> [--dry-run]
#
# 例:
#   ./scripts/setup-log-based-metrics.sh docsplit-kanameone alerts@example.com
#   ./scripts/setup-log-based-metrics.sh docsplit-dev dev@example.com --dry-run
#   UPDATE_EXISTING_METRICS=1 ./scripts/setup-log-based-metrics.sh docsplit-kanameone alerts@example.com  # 既存metricのfilter差分を更新
#
# 確認:
#   gcloud logging metrics list --project=<project-id>
#   gcloud alpha monitoring policies list --project=<project-id>
#
# 削除: ./scripts/teardown-log-based-metrics.sh <project-id>

set -euo pipefail

PROJECT_ID="${1:-}"
NOTIFICATION_EMAIL="${2:-}"
DRY_RUN="${3:-}"

if [ -z "$PROJECT_ID" ] || [ -z "$NOTIFICATION_EMAIL" ]; then
  echo "Usage: $0 <project-id> <notification-email> [--dry-run]"
  echo "Example: $0 docsplit-kanameone alerts@example.com"
  exit 1
fi

# 未知の 3rd 引数を reject して typo による silent 作成を防ぐ
case "$DRY_RUN" in
  ""|--dry-run) ;;
  *)
    echo "ERROR: 未知の 3rd 引数 '$DRY_RUN' (指定可能: --dry-run または省略)"
    exit 2
    ;;
esac

DRY=""
if [ "$DRY_RUN" = "--dry-run" ]; then
  DRY="[DRY-RUN] "
  echo "=== DRY-RUN モード: リソース作成・更新をスキップしますが、既存確認の gcloud 呼び出しは実行されます (権限エラー時は dry-run でも失敗します) ==="
  echo ""
fi

# ENV_NAME: ".firebaserc" の alias 命名不統一に対応
# - docsplit-kanameone → kanameone
# - docsplit-cocoro → cocoro
# - doc-split-dev → dev (alias 命名の歴史的経緯でハイフン位置が違う)
ENV_NAME="${PROJECT_ID#docsplit-}"
ENV_NAME="${ENV_NAME#doc-split-}"

# 既存確認の list 系 gcloud を fail-closed で実行する (#978)。
# 権限不足・一時障害を「既存なし」と誤認すると、通知チャネル・metric・alert policy を重複作成しうる
# (--dry-run も同経路のため「全部作成予定」と誤表示する)。失敗時は STDERR を残したまま中断する。
list_names() {
  local out
  if ! out="$(gcloud "$@")"; then
    echo "ERROR: 'gcloud $*' が失敗しました。権限不足または一時障害で既存リソースの有無を判定できないため、重複作成を避けて中断します" >&2
    return 1
  fi
  printf '%s\n' "$out"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_DIR="$SCRIPT_DIR/monitoring-templates"

echo "=== Log-based metric + Alert policy セットアップ ==="
echo "プロジェクト: $PROJECT_ID"
echo "通知先メール: $NOTIFICATION_EMAIL"
echo ""

# ==================================================
# 1. メトリクス定義
# ==================================================
# 各メトリクスを "名前|説明|ログフィルタ" で定義
METRICS=(
  "searchindex_oom|ondocumentwritesearchindex memory limit exceeded (#220, #217/PR #218, #936でcloud_run_revisionへ修正)|resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"ondocumentwritesearchindex\" AND textPayload:\"Memory limit exceeded\""
  "ocr_page_truncated|OCR per-page text truncated (#220, Issue #205, #936でcloud_run_revisionへ修正)|resource.type=\"cloud_run_revision\" AND textPayload=~\"\\\\[OCR\\\\].*text truncated\""
  "ocr_aggregate_truncated|OCR aggregate pageResults truncated (#220, Issue #205, #936でcloud_run_revisionへ修正)|resource.type=\"cloud_run_revision\" AND textPayload=~\"\\\\[OCR\\\\] Aggregate pageResults truncated\""
  "summary_truncated|summary generation truncated (#220, Issue #209, #936でcloud_run_revisionへ修正)|resource.type=\"cloud_run_revision\" AND textPayload=~\"\\\\[Summary\\\\] truncated\""
  # search_index_silent_failure / claim_divergent_backlog_stale は severity 条件を付けない(#981): functions/src は素の
  # console.error/console.warn を使い、gen2 の Cloud Logging では DEFAULT severity で記録されるため textPayload で検知する。
  "search_index_silent_failure|removeTokensFromIndex permanent error (#220, ADR-0015, #936でcloud_run_revisionへ修正)|resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"ondocumentwritesearchindex\" AND textPayload:\"Failed to remove tokens\""
  "drive_folder_divergent|driveFolderClaim claim divergent detected (Issue #871 恒久対応)|resource.type=\"cloud_run_revision\" AND textPayload:\"[driveFolderClaim] claim divergent detected\""
  "drive_folder_divergent_record_failed|markDivergent()自体の書込み失敗、claimにもメトリクスにも残らない経路 (Issue #871 恒久対応)|resource.type=\"cloud_run_revision\" AND textPayload:\"divergent記録に失敗しました\""
  "claim_divergent_backlog_stale|divergent claim が3日以上未解決のまま滞留 (Issue #871 恒久対応、日次sweep)|resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"drivefolderclaimdivergentsweep\" AND textPayload:\"[driveFolderClaim] divergent backlog stale\""
  "processocr_completed|processOCR cycle完了 or メンテナンスゲート閉鎖によるskip(ADR-0025 PR6、tick重複対策concurrency:1導入後の健全性監視。absence条件で本メトリクスが一定時間出現しない=OCR処理停止を検知。ADR-0019のgroupAggregationGate閉鎖(実績最大約25分、PR #781でドレイン待機20分に設定)は正当なOCR確定処理skipであり誤検知させないため、gate閉鎖ログもheartbeatとして本メトリクスに含める)|resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"processocr\" AND (textPayload:\"OCR processing (polling) completed\" OR textPayload:\"[maintenanceGate] groupAggregation gate closed\")"
  "processocr_error|processOCR document処理エラー(ADR-0025 PaddleOCR Pass1全面切替後の事後監視、Step0④ベースラインerror率0%実績を踏まえ発生即異常として検知。console.error()はfirebase-functions/logger未使用のためCloud Loggingのseverityは自動付与されずDEFAULTのまま記録される実測を確認済み、severity条件は付けない)|resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"processocr\" AND textPayload:\"Error processing document\""
  # Issue #984: 検索インデックスの書込み劣化を、性質の異なる2本の metric に分けて検知する。
  # どちらも searchIndexer.ts が引数1個の単一文字列で出す固定文言(第2引数を渡すと textPayload に当たらなくなる)。
  # - search_index_token_skipped: 高頻度トークンが Firestore の 1MiB 上限に達してスキップされた(フォールバック)。
  #   kanameone では段階2(根本対応)まで 2026 年の新規書類のたびに出るため、常時 > 0 が正常。アラートは付けない
  #   (常時 open のアラートは新規の劣化を覆い隠す)。観測は tokenIds= の内訳で行う(SOP: monitoring-setup.md)。
  # - search_index_write_failed: サイズ超過以外の索引書込み失敗(UNAVAILABLE 等の一時障害・権限障害、および
  #   サイズ超過の判定関数が SDK/バックエンドの文言変更で外れた場合)。発生 0 が正常なので通常のアラートを付ける。
  "search_index_token_skipped|高頻度トークンが1MiB上限に達してスキップされた(Issue #984。kanameoneでは段階2まで常時発生が正常、アラートなし)|resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"ondocumentwritesearchindex\" AND textPayload:\"[searchIndexer] token skipped: document size limit\""
  "search_index_write_failed|サイズ超過以外の検索インデックス書込み失敗(Issue #984。発生0が正常)|resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"ondocumentwritesearchindex\" AND textPayload:\"[searchIndexer] index write failed\""
)

# ==================================================
# 2. Notification channel 作成 (既存確認)
# ==================================================
echo "--- Notification channel ---"
CHANNEL_DISPLAY_NAME="DocSplit Monitoring Alerts - ${PROJECT_ID#docsplit-}"
CHANNEL_LIST="$(list_names alpha monitoring channels list \
  --project="$PROJECT_ID" \
  --filter="displayName=\"$CHANNEL_DISPLAY_NAME\"" \
  --format="value(name)")"
EXISTING_CHANNEL="$(head -n1 <<< "$CHANNEL_LIST")"

if [ -n "$EXISTING_CHANNEL" ]; then
  echo "✓ 既存チャネル利用: $EXISTING_CHANNEL"
  CHANNEL_NAME="$EXISTING_CHANNEL"
else
  echo "${DRY}チャネル作成: $CHANNEL_DISPLAY_NAME (email: $NOTIFICATION_EMAIL)"
  if [ -z "$DRY" ]; then
    CHANNEL_NAME=$(gcloud alpha monitoring channels create \
      --project="$PROJECT_ID" \
      --display-name="$CHANNEL_DISPLAY_NAME" \
      --type=email \
      --channel-labels="email_address=$NOTIFICATION_EMAIL" \
      --format="value(name)")
    echo "✓ 作成完了: $CHANNEL_NAME"
  else
    CHANNEL_NAME="projects/$PROJECT_ID/notificationChannels/DRY_RUN_CHANNEL"
  fi
fi
echo ""

# ==================================================
# 3. Log-based metric 作成
# ==================================================
echo "--- Log-based metrics ---"
# 存在確認は describe の成否ではなく list の結果で行う: describe は権限不足・一時障害でも失敗するため
# 「存在しない」と区別できず、既存 metric の重複作成を試みてしまう (#978)。
EXISTING_METRICS="$(list_names logging metrics list --project="$PROJECT_ID" --format="value(name)")"
for metric_def in "${METRICS[@]}"; do
  IFS='|' read -r METRIC_NAME METRIC_DESC METRIC_FILTER <<< "$metric_def"

  if grep -qxF "$METRIC_NAME" <<< "$EXISTING_METRICS"; then
    # 既存 metric は既定では書き換えない(冪等性維持)。ただし filter がこの定義と食い違う場合は
    # 「スクリプトの定義だけ直っても本番は旧 filter のまま」になる(#981)ため、差分を警告する。
    # 反映する場合は UPDATE_EXISTING_METRICS=1 を付けて再実行する(差分のある metric のみ更新)。
    if ! CURRENT_FILTER="$(gcloud logging metrics describe "$METRIC_NAME" --project="$PROJECT_ID" --format='value(filter)' 2>/dev/null)" || [ -z "$CURRENT_FILTER" ]; then
      # 権限/一時エラーを「filter 差分」と誤認して更新しないよう、取得失敗時は何もしない
      echo "⚠ $METRIC_NAME の filter を取得できませんでした (skip)"
      continue
    fi
    if [ "$CURRENT_FILTER" = "$METRIC_FILTER" ]; then
      echo "✓ $METRIC_NAME は既存 (skip、filter 一致)"
    elif [ "${UPDATE_EXISTING_METRICS:-}" = "1" ]; then
      echo "${DRY}$METRIC_NAME は既存だが filter が定義と異なるため更新 ..."
      echo "    現在: $CURRENT_FILTER"
      echo "    定義: $METRIC_FILTER"
      if [ -z "$DRY" ]; then
        gcloud logging metrics update "$METRIC_NAME" \
          --project="$PROJECT_ID" \
          --description="$METRIC_DESC" \
          --log-filter="$METRIC_FILTER" >/dev/null
        echo "✓ 更新完了"
      fi
    else
      echo "⚠ $METRIC_NAME は既存だが filter が定義と異なります (skip)。反映するには UPDATE_EXISTING_METRICS=1 を付けて再実行してください"
      echo "    現在: $CURRENT_FILTER"
      echo "    定義: $METRIC_FILTER"
    fi
  else
    echo "${DRY}$METRIC_NAME を作成 ..."
    if [ -z "$DRY" ]; then
      gcloud logging metrics create "$METRIC_NAME" \
        --project="$PROJECT_ID" \
        --description="$METRIC_DESC" \
        --log-filter="$METRIC_FILTER" >/dev/null
      echo "✓ 作成完了"
    fi
  fi
done
echo ""

# ==================================================
# 4. Alert policy 作成
# ==================================================
echo "--- Alert policies ---"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

for template in "$TEMPLATE_DIR"/alert-*.yaml; do
  TEMPLATE_NAME="$(basename "$template" .yaml)"
  # alert-searchindex-oom.yaml → "[kanameone] searchindex_oom..."
  # displayName マッチで既存確認する
  POLICY_FILE="$TMPDIR/$TEMPLATE_NAME.yaml"

  sed \
    -e "s|__ENV__|$ENV_NAME|g" \
    -e "s|__NOTIFICATION_CHANNEL__|$CHANNEL_NAME|g" \
    "$template" > "$POLICY_FILE"

  DISPLAY_NAME=$(awk -F'"' '/^displayName:/ {print $2; exit}' "$POLICY_FILE")

  POLICY_LIST="$(list_names alpha monitoring policies list \
    --project="$PROJECT_ID" \
    --filter="displayName=\"$DISPLAY_NAME\"" \
    --format="value(name)")"
  EXISTING_POLICY="$(head -n1 <<< "$POLICY_LIST")"

  if [ -n "$EXISTING_POLICY" ]; then
    echo "✓ $DISPLAY_NAME は既存 (skip)"
  else
    echo "${DRY}$DISPLAY_NAME を作成 ..."
    if [ -z "$DRY" ]; then
      gcloud alpha monitoring policies create \
        --project="$PROJECT_ID" \
        --policy-from-file="$POLICY_FILE" >/dev/null
      echo "✓ 作成完了"
    fi
  fi
done
echo ""

# ==================================================
# 5. 設定確認サマリー
# ==================================================
if [ -z "$DRY" ]; then
  echo "=== 作成済みリソース ==="
  echo ""
  echo "メトリクス:"
  gcloud logging metrics list \
    --project="$PROJECT_ID" \
    --filter="name=(searchindex_oom OR ocr_page_truncated OR ocr_aggregate_truncated OR summary_truncated OR search_index_silent_failure OR drive_folder_divergent OR drive_folder_divergent_record_failed OR claim_divergent_backlog_stale OR processocr_completed OR processocr_error OR search_index_token_skipped OR search_index_write_failed)" \
    --format="table(name,description.segment(0,60))"
  echo ""
  echo "アラートポリシー:"
  # user_labels で本 script が作成したポリシーのみ識別 (teardown と整合)
  gcloud alpha monitoring policies list \
    --project="$PROJECT_ID" \
    --filter="userLabels.source=\"docsplit-monitoring-setup\"" \
    --format="table(displayName.segment(0,80),enabled)"
  echo ""
  echo "通知チャネル:"
  echo "  $CHANNEL_NAME"
fi

echo ""
echo "完了。"
echo ""
echo "削除する場合: ./scripts/teardown-log-based-metrics.sh $PROJECT_ID"
