# PR-D4 Backfill: Issue #432 provenance backfill scripts

Issue #445 PR-D4 series。Issue #432 P0 collision の構造的予防 (新規 split / rotation) は PR-D2/D3 で完了済 (3 環境展開済)。本 scripts は **既存 docs** に provenance fields を backfill し、過去分の検出可能化 + rotate gate の段階的有効化を実施する。

## 各 phase の動作

| Phase | 動作 | Firestore write | 種別 |
|---|---|---|---|
| **A** | documents collection 全件 stream + 構造 5 分類 + GCS artifact 出力 | なし | read-only |
| **B** | MatchedByHash 候補に対し parent 再 download + 再 split + child sha256 verify | なし | read-only |
| **C** | Phase B verified (derived-bytes-verified) docs に `provenance` 10 fields + `provenanceBackfill` metadata を atomic batch write (GCS sentinel lock + lastUpdateTime precondition + max 100-200 tps) | あり | destructive |
| **D** | Phase C 書込 doc を re-read + 10 fields field-by-field verify (Stage 1) + factory 再 invoke sha256 比較 (Stage 2) + (dev のみ) rotate fixture test | なし (verify のみ) | dev fixture 副作用は env hard gate で構造的排除 |

## 起動方法

GitHub Actions UI → Actions → "PR-D4 Backfill (Issue #445)" → "Run workflow"

| 入力 | 説明 | 例 |
|---|---|---|
| environment | dev / cocoro / kanameone | dev |
| phase | A / B / C / D | A |
| run_id | optional (auto-generated if empty), must match `^[A-Za-z0-9._-]+$` | `20260515T143000Z-dev-pr-d4-v1` |
| rotate_fixture_mode | dev + phase=D のみ true 許可、prod では常に false 強制 | false |

dev → 即実行 (GitHub Environment なし)。cocoro/kanameone → GitHub Environment `pr-d4-prod-{env}` で manual approval。

## 設計判断

### deploy/execute 分離 (Codex review C3)
固定 job 名 `pr-d4-backfill-{env}` を `gcloud run jobs deploy` で静的 spec (image / runtime SA / 6h timeout / max-retries=0) のみ deploy。per-run の args (`--env`, `--phase`, `--run-id`, location) と env vars (`FIREBASE_PROJECT_ID`, `STORAGE_BUCKET`, `ARTIFACT_BUCKET`) は `gcloud run jobs execute --args --update-env-vars` の **execution-level override** で渡す ([公式仕様](https://docs.cloud.google.com/run/docs/execute/jobs#override-job-configuration))。複数 workflow_dispatch が同 env で起動しても per-run args が混在しない。

### env 単位 concurrency (Codex review C4)
workflow に `concurrency.group: pr-d4-backfill-${env}` + `cancel-in-progress: false` を設定。同一 env での deploy→execute mutation を直列化し、固定 job 名の image race を防止。

### 2 job 分離 (Codex review I8)
`deploy-dev` (GitHub Environment なし) と `deploy-prod` (cocoro/kanameone のみ `environment: pr-d4-prod-{env}`) を分離。conditional environment の null 挙動未確定リスクを回避。

### dev fixture 専用 job (Codex review I9)
phase=D + env=dev + rotate_fixture_mode=true のときのみ `pr-d4-backfill-dev-fixture` (Secret bind 付き) を使用。通常 job には `PR_D4_ROTATE_AUTH_TOKEN` を bind しないことで state leak を構造的に排除。

## exit code 一覧

| code | 意味 | workflow 扱い |
|---|---|---|
| 0 | clean | success |
| 1 | fatal (uncaught exception) | failure() |
| 2 | arg error | failure() |
| 3 | manifest CAS fail (Phase B/C/D) | failure() |
| 4 | verification failure (Phase D) | failure() |

3 と 4 の識別は workflow logs 経由でユーザー目視 (本 PR では識別 logic 非実装)。

## blocking prerequisites (S1-7 dev で初回 setup、cocoro/kanameone は S2 番号認可下で同操作)

以下を全て完了させてから workflow_dispatch を起動すること。**本 PR (S1-6) は workflow / Dockerfile / .env の整備のみで、下記 GCP 側 resource は dev で S1-7、本番で S2 に provision する**。

### 1. Artifact Registry repo 作成
```bash
gcloud artifacts repositories create pr-d4-backfill \
  --repository-format=docker \
  --location=asia-northeast1 \
  --project=<project-id>
```

### 2. cleanup policy 適用 (最新 2 件保持、`rules/gcp.md` MUST)
`cleanup-policy.json`:
```json
[
  {
    "name": "keep-latest-2",
    "action": { "type": "Keep" },
    "mostRecentVersions": { "keepCount": 2 }
  },
  {
    "name": "delete-all-others",
    "action": { "type": "Delete" },
    "condition": { "tagState": "any" }
  }
]
```
```bash
gcloud artifacts repositories set-cleanup-policies pr-d4-backfill \
  --location=asia-northeast1 \
  --policy=cleanup-policy.json \
  --no-dry-run \
  --project=<project-id>
```

### 3. Artifact bucket 作成 (Phase A/B/C/D 出力先)
```bash
gcloud storage buckets create gs://<artifact-bucket-name> \
  --location=asia-northeast1 \
  --project=<project-id> \
  --uniform-bucket-level-access
```

### 4. Cloud Run Job runtime SA 作成 + 権限付与
```bash
RUNTIME_SA="pr-d4-backfill-runtime@<project-id>.iam.gserviceaccount.com"
gcloud iam service-accounts create pr-d4-backfill-runtime \
  --display-name="PR-D4 Backfill Runtime" \
  --project=<project-id>

for role in \
  "roles/datastore.user" \
  "roles/storage.objectAdmin" \
  "roles/logging.logWriter" \
  "roles/secretmanager.secretAccessor"; do
  gcloud projects add-iam-policy-binding <project-id> \
    --member="serviceAccount:$RUNTIME_SA" \
    --role="$role"
done
```

### 5. IAM 三層必要権限表

| SA | 用途 | 必要 roles | 確認方法 |
|---|---|---|---|
| **GitHub deploy SA** (`secrets.GCP_SA_KEY_*` の identity) | workflow 起動 → Cloud Build submit + Cloud Run Jobs deploy/execute + Artifact Registry push | `roles/cloudbuild.builds.editor`, `roles/run.developer`, `roles/iam.serviceAccountUser` (runtime SA ActAs), `roles/artifactregistry.reader` (2025-01-13 以降必須), `roles/artifactregistry.writer`, `roles/storage.admin` (Cloud Build source staging bucket への create/write), `roles/logging.logWriter` | `gcloud projects get-iam-policy --flatten='bindings[].members' --filter='bindings.members:<sa>'` |
| **actual Cloud Build build SA** (典型: `{project_number}-compute@developer.gserviceaccount.com` だが organization 設定で外れる可能性) | Cloud Build 内 container build | `roles/storage.objectViewer` (gcs-staging), `roles/artifactregistry.writer`, `roles/logging.logWriter` | **S1-7 で `gcloud builds describe ${BUILD_ID}` log から実 build SA を確認**。Compute Engine default 前提が崩れる場合あり |
| **Cloud Run Job runtime SA** (`pr-d4-backfill-runtime@<project-id>.iam.gserviceaccount.com`) | container 内 ts-node 実行 ID | `roles/datastore.user` (Firestore read/write), `roles/storage.objectAdmin` (production STORAGE_BUCKET + ARTIFACT_BUCKET), `roles/logging.logWriter`, `roles/secretmanager.secretAccessor` (Phase D fixture のみ) | 上記 4 番で provision |

### 6. Phase D fixture only: Secret Manager
```bash
echo -n "<rotate-callable-auth-token>" | gcloud secrets create pr-d4-rotate-token \
  --data-file=- \
  --project=<project-id>
gcloud secrets add-iam-policy-binding pr-d4-rotate-token \
  --member="serviceAccount:$RUNTIME_SA" \
  --role="roles/secretmanager.secretAccessor" \
  --project=<project-id>
```

### 7. GitHub Actions secrets 登録
GitHub Settings → Secrets and variables → Actions:
- `GCP_SA_KEY_DEV` (dev、JSON SA key)
- `GCP_SA_KEY_KANAMEONE` (kanameone)
- `GCP_SA_KEY` (cocoro、将来 `GCP_SA_KEY_COCORO` に移行)
- `PR_D4_ROTATE_URL` (dev fixture only、rotate callable URL、comma を含まないこと)

### 8. GitHub Environments 作成 (cocoro/kanameone) — **MUST: required reviewers ≥ 1**
GitHub Settings → Environments:
- `pr-d4-prod-cocoro`: **required reviewers ≥ 1 (MUST)** + (option) wait timer
- `pr-d4-prod-kanameone`: **required reviewers ≥ 1 (MUST)** + (option) wait timer

reviewer 未登録だと environment gate は機能せず workflow が **承認なしで即実行**される (silent-failure-hunter I1 指摘の silent risk)。S1-7 rehearsal で確認コマンド:

```bash
# reviewer ≥ 1 でなければ即時 silent 実行リスク
gh api repos/yasushi-honda/doc-split/environments/pr-d4-prod-cocoro \
  --jq '.protection_rules[] | select(.type=="required_reviewers") | .reviewers | length'
gh api repos/yasushi-honda/doc-split/environments/pr-d4-prod-kanameone \
  --jq '.protection_rules[] | select(.type=="required_reviewers") | .reviewers | length'
```

### 9. `scripts/clients/<env>.env` 3 fields 設定
- **dev**: 本 PR で実値記載済 (ARTIFACT_BUCKET / CLOUD_RUN_LOCATION / BUCKET_LOCATION)
- **cocoro / kanameone**: `<TBD>` placeholder。S2 番号認可下で実値書込 PR を別途作成

## S1-7 dev rehearsal 確認項目

1. ✅ Artifact Registry repo `pr-d4-backfill` 存在 (`gcloud artifacts repositories describe pr-d4-backfill`)
2. ✅ cleanup policy 適用済 (`gcloud artifacts repositories describe ... --format=json | jq '.cleanupPolicies'`)
3. ✅ Artifact bucket 存在 + asia-northeast1 location
4. ✅ Cloud Run Job runtime SA + 4 roles (datastore.user, storage.objectAdmin, logging.logWriter, secretmanager.secretAccessor) 付与済
5. ✅ GitHub deploy SA 7 roles 確認 (上記表 1 行目) + **GitHub Environment `pr-d4-prod-{env}` の required reviewers ≥ 1 確認** (silent-failure-hunter I1: 上記 §8 の `gh api` コマンドで `reviewers | length ≥ 1`)
6. ✅ **actual Cloud Build build SA を `gcloud builds describe` log から確認**、本 README の IAM 表に追記
7. ✅ workflow_dispatch (env=dev, phase=A) で Cloud Build submit + Cloud Run Jobs deploy + Phase A execute 成功
8. ✅ Phase A artifact (manifest + main + chunks) が ARTIFACT_BUCKET に出力
9. ✅ Phase B 起動 → revalidation 成功
10. ✅ Phase C 起動 → atomic backfill (dev fixture docs に provenance 書込) 成功 + GCS lock の同時起動拒否確認
11. ✅ Phase D 起動 (rotate_fixture_mode=false) → verify 成功
12. ✅ Phase D 起動 (rotate_fixture_mode=true) → fixture job (`pr-d4-backfill-dev-fixture`) 経由 + rotate test 成功 + fixture cleanup 成功
13. ✅ exit code non-zero failure 確認 (人為 fail: 例 ARTIFACT_BUCKET 不正で Phase A fail → workflow step failure() 扱い)
14. ✅ env 単位 concurrency 確認 (2 つの workflow_dispatch を同時起動 → 後続が前を待つ動作)
15. ✅ **negative test** (`Validate inputs` の bash logic 検証、pr-test-analyzer I3): 4 ケースを `gh workflow run` で dispatch して即 fail を確認:
    - `run_id="invalid value"` (空白含む) → fail expected
    - `run_id="$(printf 'a%.0s' {1..121})"` (121 文字) → fail expected
    - `rotate_fixture_mode=true` + `phase=A` → fail expected
    - `rotate_fixture_mode=true` + `env=cocoro` → fail expected (prod 経路)
16. ✅ **`<TBD>` env での既存 sourcing 副作用なし確認** (pr-test-analyzer I1): cocoro/kanameone の `<TBD>` placeholder 状態で既存スクリプトが shell error を出さないことを確認:
    ```bash
    bash -n scripts/clients/cocoro.env  # syntax check
    bash -n scripts/clients/kanameone.env
    # source 実行 (`<TBD>` 値が他スクリプトで eval されないこと)
    ( source scripts/clients/cocoro.env && echo "ARTIFACT_BUCKET=$ARTIFACT_BUCKET" )
    ```

## cocoro/kanameone 本番展開時の番号認可手順

各 phase 開始前に CLAUDE.md 4 原則 §3 (番号単位明示認可) に従う:

```
PR #<番号> — PR-D4 backfill (N files, +X/-Y)
  <env> Phase <X> を実行してよい
```

実施前に `<TBD>` placeholder を実値で埋める PR (本 PR の続き or 別 PR) を作成 → 番号認可 → workflow_dispatch 起動 → GitHub Environment `pr-d4-prod-<env>` で manual approval。

## References

- Issue #432 (P0 root cause): https://github.com/yasushi-honda/doc-split/issues/432
- Issue #445 (PR-D4 設計、CLOSED): https://github.com/yasushi-honda/doc-split/issues/445
- ADR-0008 (Firestore 削除禁止): `docs/adr/`
- `rules/gcp.md` (IAM 二重構造 + Artifact Registry cleanup policy)
- session74-76 handoff: `docs/handoff/archive/2026-05-history.md`
- Codex MCP review threads (S1-6 impl-plan 3 round): `019e2a81-a4f0-7960-aeb6-ebf62e841ed4`
- Cloud Run Jobs execution override 公式: https://docs.cloud.google.com/run/docs/execute/jobs#override-job-configuration
