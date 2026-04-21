#!/bin/bash
# 運用スクリプトのローカル実行をブロックし、GitHub Actions経由を促すhook
# 背景: ADC未設定でローカル実行→失敗→「GitHub Actionsがあった」のループを繰り返す教訓
#
# 対象: check-master-data, fix-stuck-documents, backfill-display-filename 等
# ブロック条件: FIREBASE_PROJECT_ID= を含むnodeコマンド
# 例外: GitHub Actionsワークフローのトリガー（gh workflow run）はブロックしない

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')

# git commitのメッセージ内テキストは除外
if echo "$COMMAND" | grep -qE '^git (commit|log|diff|show|blame)'; then
  exit 0
fi

# FIREBASE_PROJECT_ID=xxx ... scripts/X.(js|ts) パターンを検出 (#334 で .ts 化対応)
# interpreter (node / npx ts-node / ts-node 直接 / yarn ts-node 等) を問わず広く検知
if echo "$COMMAND" | grep -qE 'FIREBASE_PROJECT_ID=\S+\s+.*scripts/[a-zA-Z0-9_-]+\.(js|ts)'; then
  SCRIPT_NAME=$(echo "$COMMAND" | grep -oE 'scripts/[a-zA-Z0-9_-]+\.(js|ts)' | sed 's/scripts\///' | sed -E 's/\.(js|ts)//')
  echo "⚠️ 運用スクリプトはGitHub Actions経由で実行してください（ADC不要）。" >&2
  echo "" >&2
  echo "実行方法:" >&2
  echo "  gh workflow run 'Run Operations Script' -f environment=<env> -f script='<script>'" >&2
  echo "" >&2
  echo "例:" >&2
  echo "  gh workflow run 'Run Operations Script' -f environment=kanameone -f script='$SCRIPT_NAME'" >&2
  echo "" >&2
  echo "ワークフロー: https://github.com/yasushi-honda/doc-split/actions/workflows/run-ops-script.yml" >&2
  exit 2
fi

exit 0
