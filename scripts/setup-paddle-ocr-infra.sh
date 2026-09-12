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
  "resourcemanager.projects.getIamPolicy"
)

if [ "$DRY_RUN" != true ]; then
  # gcloud に project レベルの testIamPermissions を直接叩くサブコマンドが存在しないため
  # (`gcloud projects test-iam-permissions` は無効なコマンド、実測確認済み)、
  # Cloud Resource Manager API v3 を直接叩く。
  #
  # silent-failure-hunter指摘(CRITICAL)反映: curlはHTTPエラー(401/403/404/429/5xx)でも
  # 有効なJSONエラーボディをexit 0で返すため、-w '%{http_code}' で明示的にHTTPステータスを
  # 確認する。確認しないと、認証切れ等の実エラーが「4権限とも権限不足」という誤った
  # 診断に化けてしまう(実際には権限があってもトークン失効等で誤検知しうる)。
  # トークン取得もcurl引数内のnested command substitutionにせず独立したstatementにする
  # (set -e下でネストした$()の失敗はエラーとして伝播しないため)。
  ACCESS_TOKEN=$(gcloud auth print-access-token --account="$EXPECTED_ACCOUNT")
  PERMISSIONS_JSON=$(printf '"%s",' "${REQUIRED_PERMISSIONS[@]}")
  PERMISSIONS_JSON="[${PERMISSIONS_JSON%,}]"

  TESTIAM_RESPONSE_FILE="$(mktemp)"
  HTTP_STATUS=$(curl -s -o "$TESTIAM_RESPONSE_FILE" -w '%{http_code}' \
    --connect-timeout 10 --max-time 30 \
    -X POST \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    "https://cloudresourcemanager.googleapis.com/v3/projects/${PROJECT_ID}:testIamPermissions" \
    -d "{\"permissions\": ${PERMISSIONS_JSON}}")

  if [ "$HTTP_STATUS" != "200" ]; then
    echo "ERROR: testIamPermissions API呼出しが失敗しました(HTTP $HTTP_STATUS)" >&2
    cat "$TESTIAM_RESPONSE_FILE" >&2
    rm -f "$TESTIAM_RESPONSE_FILE"
    exit 1
  fi

  HELD_PERMISSIONS=$(jq -r '.permissions[]? // empty' "$TESTIAM_RESPONSE_FILE")
  rm -f "$TESTIAM_RESPONSE_FILE"

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
  # silent-failure-hunter指摘(HIGH)反映: `2>/dev/null || true`だと認証切れ等の実エラーも
  # 「未有効」と誤認しうる。set -euo pipefailの下でエラーをそのまま伝播させる
  # (「未有効」は空出力+exit 0であり、これはエラー扱いにならない)。
  ENABLED=$(gcloud services list --enabled --project="$PROJECT_ID" --account="$EXPECTED_ACCOUNT" \
    --filter="config.name:$api" --format="value(config.name)")
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
#
# code-reviewer指摘(Important)反映: 比較ロジック自体はread-onlyなので、
# --dry-run でも常に実行する(以前は`[ "$DRY_RUN" != true ]`で丸ごとスキップしており、
# 既存repoに対する--dry-runが実際には何もチェックせず常に汎用的な
# "適用する予定"メッセージを出すだけになっていた)。mutatingな
# set-cleanup-policies 呼出のみを DRY_RUN で個別にガードする。
APPLY_POLICY=false
if [ "$REPO_EXISTS" = false ]; then
  if [ "$DRY_RUN" = true ]; then
    echo "[DRY-RUN] cleanup policy(keep-latest-2 + delete-all-others)を新規repoに適用する予定"
  else
    APPLY_POLICY=true
  fi
else
  CURRENT_POLICY_JSON=$(gcloud artifacts repositories describe "$REPO" --location="$REGION" \
    --project="$PROJECT_ID" --account="$EXPECTED_ACCOUNT" --format="json(cleanupPolicies)")

  # 部分一致(特定フィールドのみ比較)だと、余分な条件(olderThan/packageNamePrefixes等)や
  # 余分なポリシーの追加を見逃す(codex review high effort指摘)。cleanupPolicies全体を
  # 正規化(キーソート)した上で完全一致比較する。
  EXPECTED_POLICIES_JSON=$(jq -n \
    --argjson keepCount "$EXPECTED_KEEP_COUNT" \
    --arg tagState "$EXPECTED_DELETE_TAGSTATE" \
    '{
      "delete-all-others": {"action": "DELETE", "condition": {"tagState": $tagState}, "id": "delete-all-others"},
      "keep-latest-2": {"action": "KEEP", "id": "keep-latest-2", "mostRecentVersions": {"keepCount": $keepCount}}
    }')
  CURRENT_POLICIES_NORMALIZED=$(echo "$CURRENT_POLICY_JSON" | jq -S '.cleanupPolicies // {}')
  EXPECTED_POLICIES_NORMALIZED=$(echo "$EXPECTED_POLICIES_JSON" | jq -S '.')

  if [ "$CURRENT_POLICIES_NORMALIZED" = "$EXPECTED_POLICIES_NORMALIZED" ]; then
    echo "✓ cleanup policyは既に期待値と完全一致 (skip)"
  elif [ "$REPLACE_CLEANUP_POLICY" = true ]; then
    if [ "$DRY_RUN" = true ]; then
      echo "[DRY-RUN] 既存repoのcleanup policyが期待値と異なります。--replace-cleanup-policy指定のため上書きする予定"
      echo "  現在値: $(echo "$CURRENT_POLICIES_NORMALIZED" | jq -c '.')"
      echo "  適用予定値: $(echo "$EXPECTED_POLICIES_NORMALIZED" | jq -c '.')"
    else
      echo "既存repoのcleanup policyが期待値と異なりますが、--replace-cleanup-policy指定のため上書きします"
      echo "  現在値: $(echo "$CURRENT_POLICIES_NORMALIZED" | jq -c '.')"
      APPLY_POLICY=true
    fi
  else
    echo "ERROR: 既存repo '$REPO' のcleanup policyが期待値と完全には一致しません(余分な条件・余分なポリシーの可能性を含む)" >&2
    echo "  現在値: $(echo "$CURRENT_POLICIES_NORMALIZED" | jq -c '.')" >&2
    echo "  期待値: $(echo "$EXPECTED_POLICIES_NORMALIZED" | jq -c '.')" >&2
    echo "  上書きする場合は --replace-cleanup-policy を明示指定してください" >&2
    if [ "$DRY_RUN" != true ]; then
      exit 1
    fi
    echo "  [DRY-RUN] 実際の実行ではここで上記エラーにより失敗します" >&2
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
  # 「無権限runtime SA」という前提が事後的なrole付与で崩れていないか確認する
  # (codex review high effort指摘: 既存SAを無条件でskipすると、手動/部分プロビジョニング
  # 等で付与済みのStorage/Firestore/Vertex等のroleがPR4のCloud Run実行にそのまま残る)
  #
  # code-reviewer指摘(Important)反映: `2>/dev/null || true`だと
  # resourcemanager.projects.getIamPolicy権限が欠けている場合(cocoro等の狭いスコープの
  # 実行者)でもエラーが握り潰され「role無し」と誤認して偽の"確認済み"表示に化ける
  # (silent-failure-hunterが排除させたのと同一のfail-openパターンの再導入だったため削除)。
  # 同権限はREQUIRED_PERMISSIONSに追加済みでpreflightが先に保証するが、二重の安全として
  # ここでもエラーはset -e下でそのまま伝播させる。
  EXISTING_ROLES=$(gcloud projects get-iam-policy "$PROJECT_ID" --flatten="bindings[].members" \
    --filter="bindings.members:${RUNTIME_SA}" --format="value(bindings.role)" \
    --account="$EXPECTED_ACCOUNT")
  if [ -n "$EXISTING_ROLES" ]; then
    echo "ERROR: 既存runtime SA '$RUNTIME_SA' に以下のプロジェクトレベルroleが付与されています(無権限という前提が崩れています)" >&2
    while IFS= read -r role; do echo "  - $role" >&2; done <<< "$EXISTING_ROLES"
    echo "  意図しない権限であれば手動で剥奪してください:" >&2
    echo "  gcloud projects remove-iam-policy-binding $PROJECT_ID --member=serviceAccount:$RUNTIME_SA --role=<role>" >&2
    exit 1
  fi
  echo "✓ runtime SA は既存 (skip): $RUNTIME_SA (プロジェクトレベルroleなしを確認済み)"
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
