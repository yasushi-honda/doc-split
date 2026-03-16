#!/bin/bash
# UI変更を含むPRマージ前にブラウザ確認を促すhook
# 背景: PR #193でUI変更をブラウザ確認なしにマージした教訓
#
# 動作: gh pr merge 実行時にdiffを確認し、.tsx/.css変更があればブロック
# Claudeにフィードバックされ、ブラウザ確認を促す

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')

if [[ "$COMMAND" == *"gh pr merge"* ]]; then
  PR_NUMBER=$(echo "$COMMAND" | grep -oE '[0-9]+' | head -1)
  if [ -n "$PR_NUMBER" ]; then
    UI_FILES=$(gh pr diff "$PR_NUMBER" --name-only 2>/dev/null | grep -E '\.(tsx|css)$' || true)
    if [ -n "$UI_FILES" ]; then
      echo "UI変更を含むPRです。マージ前にdev環境(doc-split-dev.web.app)でブラウザ確認が必要です。" >&2
      echo "変更UIファイル:" >&2
      echo "$UI_FILES" >&2
      echo "Playwright MCPまたは手動で変更箇所を操作し、問題ないことを確認してからマージしてください。" >&2
      exit 2
    fi
  fi
fi

exit 0
