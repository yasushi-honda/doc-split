#!/bin/bash
#
# Mac用ラッパー: Finderからダブルクリックで実行可能
#

# スクリプトのディレクトリに移動
cd "$(dirname "$0")"

# 実体のスクリプトを実行
./client-setup-gcp.sh

# 完了後、Enterキーで閉じる
echo ""
read -p "Enterキーを押してウィンドウを閉じてください..."
