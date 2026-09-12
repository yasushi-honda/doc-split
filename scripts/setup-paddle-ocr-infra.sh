#!/bin/bash
# PaddleOCR Cloud Run 基盤準備 (ADR-0025 PR3)
#
# 既知3クライアント(dev/kanameone/cocoro)専用。新規クライアント展開(setup-tenant.sh)には
# 統合しない(v2でADMIN_EMAILを実行者アカウントと誤用する設計バグが発覚したため、v3で
# 意図的に対象外とした。詳細: ~/.claude/plans/fuzzy-moseying-book.md)。
#
# 作成するもの:
#   1. API有効化: run.googleapis.com / artifactregistry.googleapis.com (既に有効なら no-op)
#   2. Artifact Registry repo: paddle-ocr (docker, asia-northeast1) + cleanup policy
#      (keep-latest-2 + delete-all-others)。repoを本スクリプトが新規作成した場合のみ
#      policyを適用する。既存repoで期待値と異なるpolicyが見つかった場合は、
#      --replace-cleanup-policy を明示指定しない限り上書きせず失敗する
#      (既存artifactの削除方針を無断で変えないため)。
#   3. 無権限runtime SA: paddle-ocr-runtime@<project-id>.iam.gserviceaccount.com
#      (role付与ゼロ)
#
# 作成しないもの(意図的、PR4に委譲):
#   - Cloud Run サービス本体
#   - roles/run.invoker 付与(対象サービスが実在しないと付与できない)
#
# 使用方法:
#   ./scripts/switch-client.sh <dev|kanameone|cocoro>   # 先に named config を切替(推奨)
#   ./scripts/setup-paddle-ocr-infra.sh <dev|kanameone|cocoro> [--dry-run] [--replace-cleanup-policy]
#
# 冪等。再実行しても既存リソースは作り直さない。
#
# 実行前に、実行者アカウントへ以下2ロールを一時付与すること(恒久付与ではない、
# docs/context/delivery-and-update-guide.md「PaddleOCR基盤準備のbootstrap権限」参照):
#   roles/artifactregistry.admin
#   roles/iam.serviceAccountCreator
#
# 確認:
#   gcloud artifacts repositories describe paddle-ocr --location=asia-northeast1 --project=<project-id>
#   gcloud iam service-accounts describe paddle-ocr-runtime@<project-id>.iam.gserviceaccount.com

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REGION="asia-northeast1"
REPO="paddle-ocr"
RUNTIME_SA_NAME="paddle-ocr-runtime"

usage() {
  echo "Usage: $0 <dev|kanameone|cocoro> [--dry-run] [--replace-cleanup-policy]"
  echo "Example: $0 dev --dry-run"
  exit 1
}

ALIAS="${1:-}"
[ -z "$ALIAS" ] && usage

# alias を固定許可し、任意pathのsourceを防ぐ
case "$ALIAS" in
  dev|kanameone|cocoro) ;;
  *)
    echo "ERROR: 未知のalias '$ALIAS' (指定可能: dev, kanameone, cocoro)" >&2
    usage
    ;;
esac
shift

DRY_RUN=false
REPLACE_CLEANUP_POLICY=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --replace-cleanup-policy) REPLACE_CLEANUP_POLICY=true ;;
    *)
      echo "ERROR: 未知の引数 '$arg'" >&2
      usage
      ;;
  esac
done

ENV_FILE="$SCRIPT_DIR/clients/${ALIAS}.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE が見つかりません" >&2
  exit 1
fi

# shellcheck source=/dev/null
source "$ENV_FILE"

if [ -z "${PROJECT_ID:-}" ] || [ -z "${EXPECTED_ACCOUNT:-}" ]; then
  echo "ERROR: $ENV_FILE に PROJECT_ID/EXPECTED_ACCOUNT が設定されていません" >&2
  exit 1
fi

if [ "$DRY_RUN" = true ]; then
  echo "=== DRY-RUN モード: mutatingなgcloud呼出は一切実行しません(既存確認のread-only呼出のみ実行) ==="
  echo ""
fi

echo "=== PaddleOCR基盤準備 (ADR-0025 PR3) ==="
echo "alias: $ALIAS"
echo "project: $PROJECT_ID"
echo "expected account: $EXPECTED_ACCOUNT"
echo ""

# ==================================================
# Preflight 1: ambient状態を信用せず、現在activeなアカウントを明示確認
# ==================================================
CURRENT_ACCOUNT=$(env -u CLOUDSDK_ACTIVE_CONFIG_NAME gcloud config get-value account 2>/dev/null)
if [ "$CURRENT_ACCOUNT" != "$EXPECTED_ACCOUNT" ]; then
  echo "ERROR: 現在のアカウントが期待値と異なります" >&2
  echo "  期待: $EXPECTED_ACCOUNT" >&2
  echo "  実際: $CURRENT_ACCOUNT" >&2
  echo "  修正方法: ./scripts/switch-client.sh $ALIAS" >&2
  exit 1
fi

# ==================================================
# Preflight 2: project実在確認(read-only)
# ==================================================
if ! gcloud projects describe "$PROJECT_ID" --account="$EXPECTED_ACCOUNT" >/dev/null 2>&1; then
  echo "ERROR: project '$PROJECT_ID' の確認に失敗しました(account=$EXPECTED_ACCOUNT)" >&2
  exit 1
fi
echo "✓ preflight: account/project一致確認済み"

# ==================================================
# Preflight 3: 必要IAM権限の事前確認(dry-runでない場合のみ、変更開始前に実施)
# ==================================================
REQUIRED_PERMISSIONS=(
  "serviceusage.services.enable"
  "artifactregistry.repositories.create"
  "artifactregistry.repositories.update"
  "iam.serviceAccounts.create"
)

if [ "$DRY_RUN" != true ]; then
  # gcloud に project レベルの testIamPermissions を直接叩くサブコマンドが存在しないため
  # (`gcloud projects test-iam-permissions` は無効なコマンド、実測確認済み)、
  # Cloud Resource Manager API v3 を直接叩く。
  PERMISSIONS_JSON=$(printf '"%s",' "${REQUIRED_PERMISSIONS[@]}")
  PERMISSIONS_JSON="[${PERMISSIONS_JSON%,}]"
  HELD_PERMISSIONS=$(curl -s -X POST \
    -H "Authorization: Bearer $(gcloud auth print-access-token --account="$EXPECTED_ACCOUNT")" \
    -H "Content-Type: application/json" \
    "https://cloudresourcemanager.googleapis.com/v3/projects/${PROJECT_ID}:testIamPermissions" \
    -d "{\"permissions\": ${PERMISSIONS_JSON}}" | jq -r '.permissions[]? // empty')

  MISSING_PERMISSIONS=()
  for perm in "${REQUIRED_PERMISSIONS[@]}"; do
    if ! echo "$HELD_PERMISSIONS" | grep -qx "$perm"; then
      MISSING_PERMISSIONS+=("$perm")
    fi
  done

  if [ ${#MISSING_PERMISSIONS[@]} -gt 0 ]; then
    echo "ERROR: 以下のIAM権限が不足しています($EXPECTED_ACCOUNT @ $PROJECT_ID):" >&2
    printf '  - %s\n' "${MISSING_PERMISSIONS[@]}" >&2
    echo "  bootstrap権限の付与手順: docs/context/delivery-and-update-guide.md 参照" >&2
    exit 1
  fi
  echo "✓ preflight: 必要IAM権限を保持していることを確認済み"
fi
echo ""

# ==================================================
# 1. API有効化
# ==================================================
echo "--- API有効化 ---"
for api in run.googleapis.com artifactregistry.googleapis.com; do
  ENABLED=$(gcloud services list --enabled --project="$PROJECT_ID" --account="$EXPECTED_ACCOUNT" \
    --filter="config.name:$api" --format="value(config.name)" 2>/dev/null || true)
  if [ -n "$ENABLED" ]; then
    echo "✓ $api は既に有効 (skip)"
  else
    if [ "$DRY_RUN" = true ]; then
      echo "[DRY-RUN] $api を有効化する予定"
    else
      gcloud services enable "$api" --project="$PROJECT_ID" --account="$EXPECTED_ACCOUNT"
      echo "✓ $api を有効化しました"
    fi
  fi
done
echo ""

# ==================================================
# 2. Artifact Registry repo + cleanup policy
# ==================================================
echo "--- Artifact Registry repo ---"

EXPECTED_KEEP_COUNT=2
EXPECTED_DELETE_TAGSTATE="ANY"

REPO_EXISTS=false
if gcloud artifacts repositories describe "$REPO" --location="$REGION" \
    --project="$PROJECT_ID" --account="$EXPECTED_ACCOUNT" >/dev/null 2>&1; then
  REPO_EXISTS=true
fi

if [ "$REPO_EXISTS" = true ]; then
  echo "✓ repo '$REPO' は既存 (skip create)"
else
  if [ "$DRY_RUN" = true ]; then
    echo "[DRY-RUN] repo '$REPO' を作成する予定 (docker, $REGION)"
  else
    gcloud artifacts repositories create "$REPO" \
      --repository-format=docker \
      --location="$REGION" \
      --description="PaddleOCR Cloud Run service images (ADR-0025)" \
      --project="$PROJECT_ID" \
      --account="$EXPECTED_ACCOUNT"
    echo "✓ repo '$REPO' を作成しました"
  fi
fi

# cleanup policy: repoを本スクリプトが新規作成した場合のみ無条件適用。
# 既存repoの場合は期待値と一致するか確認し、異なれば --replace-cleanup-policy 必須。
APPLY_POLICY=false
if [ "$DRY_RUN" != true ]; then
  if [ "$REPO_EXISTS" = false ]; then
    APPLY_POLICY=true
  else
    CURRENT_POLICY_JSON=$(gcloud artifacts repositories describe "$REPO" --location="$REGION" \
      --project="$PROJECT_ID" --account="$EXPECTED_ACCOUNT" --format="json(cleanupPolicies)" 2>/dev/null)
    CURRENT_KEEP_COUNT=$(echo "$CURRENT_POLICY_JSON" | jq -r '.cleanupPolicies["keep-latest-2"].mostRecentVersions.keepCount // empty')
    CURRENT_KEEP_TYPE=$(echo "$CURRENT_POLICY_JSON" | jq -r '.cleanupPolicies["keep-latest-2"].action // empty')
    CURRENT_DELETE_TAGSTATE=$(echo "$CURRENT_POLICY_JSON" | jq -r '.cleanupPolicies["delete-all-others"].condition.tagState // empty')
    CURRENT_DELETE_TYPE=$(echo "$CURRENT_POLICY_JSON" | jq -r '.cleanupPolicies["delete-all-others"].action // empty')

    if [ "$CURRENT_KEEP_COUNT" = "$EXPECTED_KEEP_COUNT" ] && [ "$CURRENT_KEEP_TYPE" = "KEEP" ] \
        && [ "$CURRENT_DELETE_TAGSTATE" = "$EXPECTED_DELETE_TAGSTATE" ] && [ "$CURRENT_DELETE_TYPE" = "DELETE" ]; then
      echo "✓ cleanup policyは既に期待値と一致 (skip)"
    elif [ "$REPLACE_CLEANUP_POLICY" = true ]; then
      echo "既存repoのcleanup policyが期待値と異なりますが、--replace-cleanup-policy指定のため上書きします"
      echo "  現在値: keepCount=$CURRENT_KEEP_COUNT keepType=$CURRENT_KEEP_TYPE deleteTagState=$CURRENT_DELETE_TAGSTATE deleteType=$CURRENT_DELETE_TYPE"
      APPLY_POLICY=true
    else
      echo "ERROR: 既存repo '$REPO' のcleanup policyが期待値と異なります" >&2
      echo "  現在値: keepCount=$CURRENT_KEEP_COUNT keepType=$CURRENT_KEEP_TYPE deleteTagState=$CURRENT_DELETE_TAGSTATE deleteType=$CURRENT_DELETE_TYPE" >&2
      echo "  期待値: keepCount=$EXPECTED_KEEP_COUNT keepType=KEEP deleteTagState=$EXPECTED_DELETE_TAGSTATE deleteType=DELETE" >&2
      echo "  上書きする場合は --replace-cleanup-policy を明示指定してください" >&2
      exit 1
    fi
  fi
fi

if [ "$APPLY_POLICY" = true ]; then
  POLICY_FILE="$(mktemp)"
  trap 'rm -f "$POLICY_FILE"' EXIT
  cat > "$POLICY_FILE" <<EOF
[
  {"name": "keep-latest-2", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": $EXPECTED_KEEP_COUNT}},
  {"name": "delete-all-others", "action": {"type": "Delete"}, "condition": {"tagState": "$EXPECTED_DELETE_TAGSTATE"}}
]
EOF
  gcloud artifacts repositories set-cleanup-policies "$REPO" \
    --location="$REGION" --project="$PROJECT_ID" --account="$EXPECTED_ACCOUNT" \
    --policy="$POLICY_FILE" --no-dry-run
  echo "✓ cleanup policyを適用しました(keep-latest-2 + delete-all-others)"
elif [ "$DRY_RUN" = true ]; then
  echo "[DRY-RUN] cleanup policy(keep-latest-2 + delete-all-others)を適用する予定"
fi
echo ""

# ==================================================
# 3. 無権限runtime SA
# ==================================================
echo "--- runtime SA ---"
RUNTIME_SA="${RUNTIME_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

SA_EXISTS=false
if gcloud iam service-accounts describe "$RUNTIME_SA" \
    --project="$PROJECT_ID" --account="$EXPECTED_ACCOUNT" >/dev/null 2>&1; then
  SA_EXISTS=true
fi

if [ "$SA_EXISTS" = true ]; then
  echo "✓ runtime SA は既存 (skip): $RUNTIME_SA"
else
  if [ "$DRY_RUN" = true ]; then
    echo "[DRY-RUN] runtime SA '$RUNTIME_SA' を作成する予定(role付与なし)"
  else
    gcloud iam service-accounts create "$RUNTIME_SA_NAME" \
      --display-name="PaddleOCR Runtime (no roles)" \
      --description="ADR-0025: PaddleOCR Cloud Run 実行用。Firestore/Storage/Vertexへの権限は一切付与しない" \
      --project="$PROJECT_ID" --account="$EXPECTED_ACCOUNT"

    # IAM伝播遅延による偽陰性を防ぐため、作成直後は短いretryでdescribeを確認する
    PROPAGATED=false
    for i in 1 2 3; do
      if gcloud iam service-accounts describe "$RUNTIME_SA" \
          --project="$PROJECT_ID" --account="$EXPECTED_ACCOUNT" >/dev/null 2>&1; then
        PROPAGATED=true
        break
      fi
      sleep 2
    done
    if [ "$PROPAGATED" = true ]; then
      echo "✓ runtime SA '$RUNTIME_SA' を作成しました(role付与なし)"
    else
      echo "WARN: runtime SA作成後、${i}回のretryでもdescribe確認できませんでした(IAM伝播遅延の可能性、後で手動確認すること)" >&2
    fi
  fi
fi
echo ""

echo "=== 完了 ==="
echo "[NEXT / PR4] Cloud Runサービス作成後に以下を実行すること(付与先は都度実測確認):"
echo "  gcloud functions describe processOCR --gen2 --region=$REGION --project=$PROJECT_ID \\"
echo "    --account=$EXPECTED_ACCOUNT --format='value(serviceConfig.serviceAccountEmail)'"
echo "  gcloud run services add-iam-policy-binding paddle-ocr \\"
echo "    --region=$REGION --project=$PROJECT_ID --account=$EXPECTED_ACCOUNT \\"
echo "    --member=\"serviceAccount:<上記で確認した実行SA>\" --role=\"roles/run.invoker\""
