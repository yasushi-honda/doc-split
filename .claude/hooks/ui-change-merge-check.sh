#!/bin/bash
# UI変更を含むPRマージ前にブラウザ確認を促すhook
# 背景: PR #193でUI変更をブラウザ確認なしにマージした教訓
#
# 動作: gh pr merge 実行時にdiffを確認し、.tsx/.css変更があればブロック
# bypass: PRに 'ui-confirmed' ラベルが付いていれば通過（dev環境で確認実施済みの宣言）
# Claudeにフィードバックされ、ブラウザ確認を促す

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')

# 'gh pr merge' で始まるコマンドのみ対象（commit messageに含まれる文字列との誤マッチを防止）
if [[ "$COMMAND" =~ ^[[:space:]]*gh[[:space:]]+pr[[:space:]]+merge[[:space:]] ]]; then
  # 'gh pr merge <N>' の N を抽出（先頭の引数のみ、commit message等の他の数字を拾わない）
  PR_NUMBER=$(echo "$COMMAND" | sed -E 's/^[[:space:]]*gh[[:space:]]+pr[[:space:]]+merge[[:space:]]+([0-9]+).*/\1/' | grep -E '^[0-9]+$' || true)
  if [ -n "$PR_NUMBER" ]; then
    UI_FILES=$(gh pr diff "$PR_NUMBER" --name-only 2>/dev/null | grep -E '\.(tsx|css)$' || true)
    if [ -n "$UI_FILES" ]; then
      # bypass: 'ui-confirmed' ラベル付きなら通過
      HAS_LABEL=$(gh pr view "$PR_NUMBER" --json labels --jq '.labels[].name' 2>/dev/null | grep -E "^ui-confirmed$" || true)
      if [ -n "$HAS_LABEL" ]; then
        echo "[ui-change-merge-check] PR #${PR_NUMBER} has 'ui-confirmed' label, bypassing UI check" >&2
        exit 0
      fi
      echo "UI変更を含むPRです。マージ前にdev環境(doc-split-dev.web.app)でブラウザ確認が必要です。" >&2
      echo "変更UIファイル:" >&2
      echo "$UI_FILES" >&2
      echo "Playwright MCPまたは手動で変更箇所を操作し、問題ないことを確認してください。" >&2
      echo "" >&2
      echo "確認実施後、PRに 'ui-confirmed' ラベルを付与すると bypass されます:" >&2
      echo "  gh pr edit ${PR_NUMBER} --add-label ui-confirmed" >&2
      echo "(初回のみラベル作成が必要: gh label create ui-confirmed --description 'dev環境でUI動作確認実施済み')" >&2
      exit 2
    fi
  fi
fi

exit 0
