#!/bin/bash
# Cloud Logging log-based metric + Cloud Monitoring alert policy 削除
#
# setup-log-based-metrics.sh で作成したリソースを削除する。
# 削除順序: policies → metrics → channel (逆順)
#
# 使用方法:
#   ./scripts/teardown-log-based-metrics.sh <project-id> [--yes]
#
# --yes 無しの場合は確認プロンプトが表示される。

set -euo pipefail

PROJECT_ID="${1:-}"
AUTO_YES="${2:-}"

if [ -z "$PROJECT_ID" ]; then
  echo "Usage: $0 <project-id> [--yes]"
  exit 1
fi

# 未知の 2nd 引数を reject して typo で確認プロンプトが silent skip されるのを防ぐ
case "$AUTO_YES" in
  ""|--yes) ;;
  *)
    echo "ERROR: 未知の 2nd 引数 '$AUTO_YES' (指定可能: --yes または省略)"
    exit 2
    ;;
esac

# ENV_NAME: setup 側と同じ strip ロジック (dev の alias 命名不統一に対応)
ENV_NAME="${PROJECT_ID#docsplit-}"
ENV_NAME="${ENV_NAME#doc-split-}"
CHANNEL_DISPLAY_NAME="DocSplit Monitoring Alerts - $ENV_NAME"

echo "=== Log-based metric + Alert policy 削除 ==="
echo "プロジェクト: $PROJECT_ID"
echo ""

if [ "$AUTO_YES" != "--yes" ]; then
  read -r -p "本当に削除しますか? (yes/no): " CONFIRM
  [ "$CONFIRM" = "yes" ] || { echo "中止しました"; exit 0; }
fi

# 1. Alert policies 削除 (最初に削除しないと metric/channel が使用中になる)
# user_labels で本 script が作成したポリシーのみ識別 (他用途の "[env]" displayName を誤削除しない)
echo "--- Alert policies 削除 ---"
POLICIES=$(gcloud alpha monitoring policies list \
  --project="$PROJECT_ID" \
  --filter="userLabels.source=\"docsplit-monitoring-setup\"" \
  --format="value(name)" 2>/dev/null || true)

if [ -n "$POLICIES" ]; then
  while IFS= read -r policy; do
    echo "削除: $policy"
    gcloud alpha monitoring policies delete "$policy" \
      --project="$PROJECT_ID" \
      --quiet
  done <<< "$POLICIES"
else
  echo "(該当なし)"
fi
echo ""

# 2. Log-based metrics 削除
echo "--- Log-based metrics 削除 ---"
METRIC_NAMES=(
  searchindex_oom
  ocr_page_truncated
  ocr_aggregate_truncated
  summary_truncated
  search_index_silent_failure
)
for metric in "${METRIC_NAMES[@]}"; do
  if gcloud logging metrics describe "$metric" --project="$PROJECT_ID" >/dev/null 2>&1; then
    echo "削除: $metric"
    gcloud logging metrics delete "$metric" --project="$PROJECT_ID" --quiet
  else
    echo "(skip, 不在): $metric"
  fi
done
echo ""

# 3. Notification channel 削除
echo "--- Notification channel 削除 ---"
CHANNEL=$(gcloud alpha monitoring channels list \
  --project="$PROJECT_ID" \
  --filter="displayName=\"$CHANNEL_DISPLAY_NAME\"" \
  --format="value(name)" 2>/dev/null | head -n1 || true)

if [ -n "$CHANNEL" ]; then
  echo "削除: $CHANNEL"
  gcloud alpha monitoring channels delete "$CHANNEL" \
    --project="$PROJECT_ID" \
    --quiet
else
  echo "(該当なし)"
fi

echo ""
echo "削除完了。"
