#!/bin/bash
# E2Eテスト実行スクリプト
# Firebase Emulatorを起動してテストを実行

set -e

echo "🚀 E2Eテスト環境を準備中..."

# カレントディレクトリを取得
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# .env.testをコピー
echo "📝 テスト用環境変数を設定..."
cp "$PROJECT_ROOT/frontend/.env.test" "$PROJECT_ROOT/frontend/.env.local"

# Emulatorでテストを実行
echo "🔥 Firebase Emulatorを起動してテストを実行..."
cd "$PROJECT_ROOT"

firebase emulators:exec \
  --only auth,firestore,storage \
  --project doc-split-dev \
  "npm run test:e2e:emulator"

# 元の.env.localを復元
echo "🔄 環境変数を復元..."
cp "$PROJECT_ROOT/frontend/.env.dev" "$PROJECT_ROOT/frontend/.env.local"

echo "✅ E2Eテスト完了"
