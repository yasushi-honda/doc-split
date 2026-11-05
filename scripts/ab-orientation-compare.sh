#!/usr/bin/env bash
# run-ops-script.yml から呼ぶ。補正なし=タグorientoff(旧リビジョン・トラフィック0)、補正あり=現行のURLを解決して実行する。
# 出力は件数と固定の帯のみ(ADR-0031)。環境変数: PROJECT_ID, STORAGE_BUCKET。引数はそのままスクリプトへ渡す。
set -euo pipefail
SVC_JSON=$(gcloud run services describe paddle-ocr --project="$PROJECT_ID" --region=asia-northeast1 --format=json)
AB_ON_URL=$(echo "$SVC_JSON" | jq -r '.status.url')
AB_OFF_URL=$(echo "$SVC_JSON" | jq -r '[.status.traffic[] | select(.tag=="orientoff") | .url][0] // empty')
if [ -z "$AB_OFF_URL" ]; then echo "ERROR: タグ orientoff が見つかりません"; exit 1; fi
cd "$(dirname "$0")"
AB_ON_URL="$AB_ON_URL" AB_OFF_URL="$AB_OFF_URL" NODE_PATH=../functions/node_modules \
  FIREBASE_PROJECT_ID="$PROJECT_ID" npx ts-node ab-orientation-compare.ts "$@"
