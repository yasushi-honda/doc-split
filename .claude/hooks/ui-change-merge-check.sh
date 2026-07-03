#!/bin/bash
# UI変更を含むPRマージ前にブラウザ確認を必須化するhook
# 背景: PR #193でUI変更をブラウザ確認なしにマージした教訓
#   (tsc/test/buildのPASSだけではPopover位置・レイアウト崩れ・スクロール挙動を検出できない)
#
# 動作: gh pr merge 実行時に対象PRのdiffを確認し、.tsx/.css変更を含む場合は
#   1. PRのCI checksが全てPASSしている (gh pr checks は全成功時のみ exit 0)
#   2. PRに ui-verified ラベルが付与されている
#      (Playwright MCP/手動でのブラウザ確認済み宣言。確認証跡=確認内容・viewport・
#       スクリーンショットをPRコメント/bodyに記録した上で付与すること)
#   の両方を満たす場合のみマージを許可する。
#
# 2026-07-03 decision-maker指示によりアップデート:
#   従来は無条件ブロック(人間がマージする運用)だったが、「AI側でテストやチェックが
#   間違いなく通ったのであればマージを許可する」方針に変更。
#   あわせて2つのすり抜け穴を修正:
#   - PR番号抽出がコマンド全体の最初の数字を拾っていた
#     (前段コマンドのポート番号等を誤認しチェックがすり抜ける。PR #530マージで実際に発生)
#   - 番号なし `gh pr merge` (カレントブランチ形式) が無条件通過していた

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')

# トリガーはコマンド位置 (行頭 / ; & | $( の直後) の "gh pr merge" のみ。
# コミットメッセージや PR body 中の説明文 (`gh pr merge` 等のインライン記述) に
# 反応する false positive を防ぐ
MERGE_INVOCATION=$(echo "$COMMAND" | grep -oE '(^|[;&|]|\$\() *gh pr merge( +[0-9]+)?' | head -1)

if [ -n "$MERGE_INVOCATION" ]; then
  # PR番号は "gh pr merge" の直後から抽出する (コマンド先頭の無関係な数字を拾わない)
  PR_NUMBER=$(echo "$MERGE_INVOCATION" | grep -oE '[0-9]+' | head -1)

  if [ -z "$PR_NUMBER" ]; then
    # 番号を特定できない形式は安全側でブロック
    echo "gh pr merge のPR番号を特定できません。'gh pr merge <番号>' 形式で実行してください。" >&2
    exit 2
  fi

  UI_FILES=$(gh pr diff "$PR_NUMBER" --name-only 2>/dev/null | grep -E '\.(tsx|css)$' || true)
  if [ -n "$UI_FILES" ]; then
    # 条件1: CI checks 全PASS
    if ! gh pr checks "$PR_NUMBER" >/dev/null 2>&1; then
      echo "UI変更PR #${PR_NUMBER}: CI checksが未完了または失敗しています。全checks PASS後にマージしてください。" >&2
      exit 2
    fi

    # 条件2: ui-verified ラベル (ブラウザ確認済み宣言)
    if ! gh pr view "$PR_NUMBER" --json labels -q '.labels[].name' 2>/dev/null | grep -qx 'ui-verified'; then
      echo "UI変更PR #${PR_NUMBER}: ブラウザ確認が未宣言です。" >&2
      echo "変更UIファイル:" >&2
      echo "$UI_FILES" >&2
      echo "Playwright MCPまたは手動で変更箇所を操作確認し、証跡(確認内容・viewport・スクリーンショット)を" >&2
      echo "PRコメント/bodyに記録した上で 'gh pr edit ${PR_NUMBER} --add-label ui-verified' を実行してからマージしてください。" >&2
      exit 2
    fi

    echo "UI変更PR #${PR_NUMBER}: CI全PASS + ui-verified確認済み。マージを許可します。" >&2
  fi
fi

exit 0
