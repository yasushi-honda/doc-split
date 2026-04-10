#!/bin/bash
# Firestore ネイティブバックアップ設定スクリプト
#
# 日次バックアップ（7日保持）+ 週次バックアップ（8週保持）を設定する。
# 一度実行すれば自動的にスケジュール実行される。
#
# 使用方法:
#   ./scripts/setup-firestore-backup.sh <project-id>
#   ./scripts/setup-firestore-backup.sh docsplit-cocoro
#   ./scripts/setup-firestore-backup.sh docsplit-kanameone
#
# 確認:
#   gcloud firestore backups schedules list --database='(default)' --project=<project-id>
#
# コスト目安: データ量数MB以下の場合、月数円未満（$0.18/GB/月）

set -euo pipefail

PROJECT_ID="${1:-}"

if [ -z "$PROJECT_ID" ]; then
  echo "Usage: $0 <project-id>"
  echo "Example: $0 docsplit-cocoro"
  exit 1
fi

echo "=== Firestore バックアップ設定 ==="
echo "プロジェクト: $PROJECT_ID"
echo ""

# 既存スケジュール確認
echo "--- 既存スケジュール確認 ---"
EXISTING=$(gcloud firestore backups schedules list \
  --database='(default)' \
  --project="$PROJECT_ID" \
  --format='value(name)' 2>/dev/null || true)

if [ -n "$EXISTING" ]; then
  echo "既にスケジュールが設定されています:"
  gcloud firestore backups schedules list \
    --database='(default)' \
    --project="$PROJECT_ID"
  echo ""
  echo "追加設定は不要です。上書きする場合は先に削除してください。"
  exit 0
fi

# 日次バックアップ（7日保持）
echo "--- 日次バックアップ設定（7日保持）---"
gcloud firestore backups schedules create \
  --database='(default)' \
  --recurrence=daily \
  --retention=7d \
  --project="$PROJECT_ID"
echo "✅ 日次バックアップ設定完了"

# 週次バックアップ（8週保持）
echo ""
echo "--- 週次バックアップ設定（8週保持、日曜）---"
gcloud firestore backups schedules create \
  --database='(default)' \
  --recurrence=weekly \
  --retention=8w \
  --day-of-week=SUN \
  --project="$PROJECT_ID"
echo "✅ 週次バックアップ設定完了"

# 設定確認
echo ""
echo "=== 設定済みスケジュール ==="
gcloud firestore backups schedules list \
  --database='(default)' \
  --project="$PROJECT_ID"

echo ""
echo "完了。以降は自動でバックアップが取得されます。"
echo ""
echo "バックアップ一覧確認:"
echo "  gcloud firestore backups list --project=$PROJECT_ID"
echo ""
echo "復元（新しいDBに復元）:"
echo "  gcloud firestore databases restore --source-backup=BACKUP_NAME --destination-database=NEW_DB_ID --project=$PROJECT_ID"
