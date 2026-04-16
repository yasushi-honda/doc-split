#!/bin/bash
# Cloud Logging log-based metric + Cloud Monitoring alert policy セットアップ
#
# Issue #220 + ADR-0015 Follow-up の運用監視基盤を作成する。
# 一度実行すれば自動監視が開始される。冪等 (既存があれば skip)。
#
# 使用方法:
#   ./scripts/setup-log-based-metrics.sh <project-id> <notification-email> [--dry-run]
#
# 例:
#   ./scripts/setup-log-based-metrics.sh docsplit-kanameone alerts@example.com
#   ./scripts/setup-log-based-metrics.sh docsplit-dev dev@example.com --dry-run
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
  echo "=== DRY-RUN モード: リソース作成をスキップしますが、既存確認の gcloud 呼び出しは実行されます (権限エラー時は dry-run でも失敗します) ==="
  echo ""
fi

# ENV_NAME: ".firebaserc" の alias 命名不統一に対応
# - docsplit-kanameone → kanameone
# - docsplit-cocoro → cocoro
# - doc-split-dev → dev (alias 命名の歴史的経緯でハイフン位置が違う)
ENV_NAME="${PROJECT_ID#docsplit-}"
ENV_NAME="${ENV_NAME#doc-split-}"

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
  "searchindex_oom|ondocumentwritesearchindex memory limit exceeded (#220, #217/PR #218)|resource.type=\"cloud_function\" AND resource.labels.function_name=\"ondocumentwritesearchindex\" AND textPayload:\"Memory limit exceeded\""
  "ocr_page_truncated|OCR per-page text truncated (#220, Issue #205)|resource.type=\"cloud_function\" AND textPayload=~\"\\\\[OCR\\\\].*text truncated\""
  "ocr_aggregate_truncated|OCR aggregate pageResults truncated (#220, Issue #205)|resource.type=\"cloud_function\" AND textPayload=~\"\\\\[OCR\\\\] Aggregate pageResults truncated\""
  "summary_truncated|summary generation truncated (#220, Issue #209)|resource.type=\"cloud_function\" AND textPayload=~\"\\\\[Summary\\\\] truncated\""
  "search_index_silent_failure|removeTokensFromIndex permanent error (#220, ADR-0015)|resource.type=\"cloud_function\" AND resource.labels.function_name=\"ondocumentwritesearchindex\" AND severity=\"ERROR\" AND textPayload:\"Failed to remove tokens\""
)

# ==================================================
# 2. Notification channel 作成 (既存確認)
# ==================================================
echo "--- Notification channel ---"
CHANNEL_DISPLAY_NAME="DocSplit Monitoring Alerts - ${PROJECT_ID#docsplit-}"
EXISTING_CHANNEL=$(gcloud alpha monitoring channels list \
  --project="$PROJECT_ID" \
  --filter="displayName=\"$CHANNEL_DISPLAY_NAME\"" \
  --format="value(name)" 2>/dev/null | head -n1 || true)

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
for metric_def in "${METRICS[@]}"; do
  IFS='|' read -r METRIC_NAME METRIC_DESC METRIC_FILTER <<< "$metric_def"

  if gcloud logging metrics describe "$METRIC_NAME" --project="$PROJECT_ID" >/dev/null 2>&1; then
    echo "✓ $METRIC_NAME は既存 (skip)"
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

  EXISTING_POLICY=$(gcloud alpha monitoring policies list \
    --project="$PROJECT_ID" \
    --filter="displayName=\"$DISPLAY_NAME\"" \
    --format="value(name)" 2>/dev/null | head -n1 || true)

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
    --filter="name=(searchindex_oom OR ocr_page_truncated OR ocr_aggregate_truncated OR summary_truncated OR search_index_silent_failure)" \
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
