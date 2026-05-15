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
| **actual Cloud Build build SA** (**dev で確認済 session78**: `217393576593-compute@developer.gserviceaccount.com` = Compute Engine default、`roles/editor` 保持で下記 3 roles を全カバー) | Cloud Build 内 container build | `roles/storage.objectViewer` (gcs-staging), `roles/artifactregistry.writer`, `roles/logging.logWriter` | `gcloud builds describe ${BUILD_ID} --format='value(serviceAccount)'`。**cocoro/kanameone でも本番展開前に同コマンドで実 SA を確認し、organization 設定で Compute Engine default から外れている場合は明示 roles 付与必要** |
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

## S1-7 dev rehearsal 達成記録

16 項目中 **15 項目達成** (session78 + session79)、残 #12 (Firebase ID token 取得が必要) は本番展開前 (S2-S7) の rehearsal で実施。

| # | 項目 | 達成 session | 確認内容 |
|---|------|--------------|----------|
| 1 | Artifact Registry repo `pr-d4-backfill` 存在 | session78 | `gcloud artifacts repositories describe pr-d4-backfill` |
| 2 | cleanup policy 適用済 | session78 | keep-latest-2 + delete-all-others |
| 3 | Artifact bucket `doc-split-dev-pr-d4-artifacts` 存在 + asia-northeast1 | session78 | uniform-bucket-level-access |
| 4 | Cloud Run Job runtime SA + 4 roles | session78 | datastore.user / storage.objectAdmin / logging.logWriter / secretmanager.secretAccessor |
| 5 | GitHub deploy SA 7 roles + Environment reviewers (dev は対象外) | session78 | dev は GitHub Environment なしのため §8 確認は cocoro/kanameone 展開時 |
| 6 | **actual Cloud Build SA = `217393576593-compute@developer.gserviceaccount.com`** | session78 | §5 IAM 表に反映済 (本 PR) |
| 7 | workflow_dispatch (env=dev, phase=A) deploy + execute 成功 | session78 | Phase A run `25919919476` / 4m5s |
| 8 | Phase A artifact (manifest + main + chunks) 出力 | session78 | `totalDocs=6` / NeedsManualReview=4 / verifiedExistingProvenance=2 |
| 9 | Phase B 起動 → revalidation 成功 | session78 | `candidatesIn=4` / `candidatesOut=0` (MatchedByHash=0) |
| 10 | Phase C 起動 → atomic backfill + GCS lock | session78 | GCS sentinel lock `1778852359224407` 取得+解除、Firestore 副作用ゼロ |
| 11 | Phase D 起動 (rotate_fixture_mode=false) → verify 成功 | session78 | `verifiedDocs=0` / `manifestUpdateStatus=ok` / `rotateGateTest=null` |
| 12 | Phase D rotate_fixture_mode=true → fixture job + rotate test + cleanup | ⏳ 未達 | Firebase ID token 取得 (admin user の手動 login) + `pr-d4-rotate-token` secret 登録 が必要 |
| 13 | 人為 fail で workflow step failure() 扱い | session79 | feature branch で `ARTIFACT_BUCKET=<TBD>` → `Resolve project / buckets / locations` step で fail、後続 step 全 skipped (run `25922483719`) |
| 14 | env 単位 concurrency (同時 dispatch、後続が前を待つ) | session79 | Run A `25922564576` in_progress / Run B `25922569233` pending を 30 秒後も維持確認 |
| 15 | **negative test** 4 ケースで Validate inputs 即 fail | session79 | run `25922298910` / `25922310147` / `25922318730` / `25922328194`、全 conclusion=failure |
| 16 | `<TBD>` env sourcing 副作用なし | session79 | `bash -n` + `source` (sub-shell) + `switch-client.sh --list` で全 client 正常表示 |

### S1-7 #12 残作業手順 (次セッション or S2 着手時)

1. dev project の admin user (`hy.unimail.11@gmail.com` 等) で Firebase auth login → Firebase ID token 取得
2. `gcloud secrets create pr-d4-rotate-token --data-file=- --project=doc-split-dev` (token を stdin で)
3. `gcloud secrets add-iam-policy-binding pr-d4-rotate-token --member='serviceAccount:pr-d4-backfill-runtime@doc-split-dev.iam.gserviceaccount.com' --role='roles/secretmanager.secretAccessor' --project=doc-split-dev`
4. `gh secret set PR_D4_ROTATE_URL --body 'https://rotatepdfpages-whfgr6jwaa-an.a.run.app'` (dev callable URL、`gcloud functions describe rotatePdfPages --region=asia-northeast1 --project=doc-split-dev --format='value(serviceConfig.uri)'`)
5. `gh workflow run pr-d4-backfill.yml -f environment=dev -f phase=D -f run_id='<前 Phase C の run_id>' -f rotate_fixture_mode=true`

## S2-S7 dev rehearsal × 2 周 達成記録

impl-plan §9.2 で要求された 2 周完走の達成記録。round 1 = session78、round 2 = session80 (2026-05-16)。**Phase A-D の reproducibility は完全一致 (totalDocs / candidatesIn / candidatesOut / writtenDocs / manifestUpdate 全 metric)**、ただし **S6 (rollback rehearsal) は実装 gap で両 round 未達**、S7 はユーザー目視 task。

### Round 1 (session78、2026-05-15)

| Stage | Phase | Run ID | 所要 | 主要 metric |
|-------|-------|--------|------|-------------|
| S2 | A | 25919919476 | 4m5s | totalDocs=6, NeedsManualReview=4, verifiedExistingProvenance=2 |
| S3 | B | (round1) | 3m35s | candidatesIn=4, candidatesOut=0, MatchedByHash=0 |
| S4 | C | (round1) | 3m28s | candidatesIn=0, writtenDocs=0, GCS lock=1778852359224407 取得+解除 |
| S5 | D | (round1) | 3m28s | verifiedDocs=0, manifestUpdateStatus(finalize)=ok, rotateGateTest=null |

### Round 2 (session80、2026-05-16)

| Stage | Phase | Run ID | 所要 | 主要 metric |
|-------|-------|--------|------|-------------|
| S2 | A | 25926785292 | 4m0s | totalDocs=6, NeedsManualReview=4, verifiedExistingProvenance=2 ← round 1 と一致 |
| S3 | B | 25927039470 | 3m15s | candidatesIn=4, candidatesOut=0, skippedNonMatchedByHash=4 ← round 1 と一致 |
| S4 | C | 25927219665 | 3m45s | candidatesIn=0, writtenDocs=0, GCS lock=1778860371030620 取得+解除 ← round 1 と一致 |
| S5 | D | 25927417193 | 3m0s | verifiedDocs=0, manifestUpdateStatus(finalize)=ok, rotateGateTest=null ← round 1 と一致 |

**run_id chain**: `20260515T154040Z-dev-pr-d4-v1` (Phase A→B→C→D 全 phase で同一 run_id 継承、`manifest.json` schema validation pass)。

### S6 (rollback rehearsal) 実装 gap

- **要求** (impl-plan BF24 / §9.1 S6): PR-D4 が書いた fixture 限定 (`fixtureId.startsWith('BF_')`) で `provenance` と `provenanceBackfill` の **両方を削除** + 再 Phase C → 同結果再現
- **現状**: `grep -rEn rollback scripts/pr-d4-backfill/` 空、stand-alone rollback script 未実装。`GcsFixtureStoreImpl.cleanupFixture` (`scripts/pr-d4-backfill/phase-d/adapters.ts:153`) は fixture doc + GCS object **delete** であり、provenance fields の **delete (FieldValue.delete)** + 既存 verified provenance の **immutable skip** を検証しない (Codex MCP 12th review 確認)

### S7 (統合確認)

ユーザー manual task: Firestore Console + GCS Console + Actions logs の目視。round 2 完了時点で artifact bucket `gs://doc-split-dev-pr-d4-artifacts/pr-d4-backfill-artifacts/20260515T154040Z-dev-pr-d4-v1/` 配下に 7 objects (manifest + Phase A-D summary + chunk + finalize-status) 完備。

## Codex MCP 12th review 結果 (2026-05-16、thread `019e2d49-0b38-7ea2-bcd7-15af13bcb73b`)

**Final verdict: GO with required amendments**

- Critical findings: 0 件
- Important findings: 2 件
  - I1: S6 rollback script は **stand-alone 必須** (`cleanupFixture` では BF24 充足できない、provenance field delete + immutable skip 非適用の検証が別途必要)
  - I2: #12 (S1-7 残) は本番 workflow の機械的前提ではないが、cocoro/kanameone **destructive Phase C 前の GO 根拠としては完了推奨** (cocoro/kanameone は `rotate_fixture_mode=false` 強制なので Phase A/B/D の機械実行は依存しない)
- Low findings: 1 件
  - L1: README S1-7 #12 gate を明文化 (Phase A/B 可、Phase C 前必須)

### Codex 12th 推奨 PR scope (S6 rollback script 実装)

- file: `scripts/pr-d4-backfill/rollback-fixtures.ts` 新規 (or 既存 `index.ts` に `phase=ROLLBACK_DEV_FIXTURES` 追加)
- 仕様:
  - dev-only hard gate (env validation)
  - `run_id` 必須
  - fixture prefix allowlist: `BF_` / `BF13_test_fixture_`
  - dry-run default true、明示 confirm required
  - Firestore update: 対象 fixture の `provenance` と `provenanceBackfill` のみ `FieldValue.delete()`
  - doc delete / GCS delete は **行わない** (cleanup と区別)
  - 既存 verified provenance (`provenance` exists && `provenanceBackfill` absent) は **必ず skip** + artifact 記録
- unit tests:
  - target query allowlist
  - field delete 確認
  - immutable skip 動作確認
  - non-dev reject
  - dry-run no-write
- dev rehearsal: rollback 実行 → Phase C 再実行 → Round 1/2 と同 metrics 再現を artifact/log で記録

## cocoro/kanameone 本番展開 gating (Codex 12th 反映)

Codex 12th verdict に基づく phase 別 GO 状態:

| Phase | cocoro/kanameone GO 状態 | 根拠 |
|-------|------------------------|------|
| A (classify) | ✅ **GO** (番号認可下で実行可) | read-only + artifact write、現 gap による破壊リスク低 |
| B (revalidate) | ✅ **GO** (番号認可下で実行可) | read-only + artifact write、Phase A artifact ref のみ |
| C (atomic backfill) | ⚠️ **GO with required amendments** | **S6 rollback script 実装 + dev rehearsal + #12 rotate fixture 完了が前提** |
| D (verify) | ⚠️ **GO with required amendments** | Phase C 前提条件と同様 (cocoro/kanameone は `rotate_fixture_mode=false` 強制で fixture test 不要) |

実施前提:
1. `<TBD>` placeholder を実値で埋める PR (cocoro/kanameone の ARTIFACT_BUCKET / CLOUD_RUN_LOCATION / BUCKET_LOCATION)
2. GitHub Environment `pr-d4-prod-<env>` で required reviewers ≥ 1 事前確認 (§8 の `gh api` コマンド)
3. Phase A/B は本 amendment 状態でも即実行可、Phase C/D は S6 + #12 + Codex 13th review 後

## Phase 間連携: run_id 継承 (session78 rehearsal で発見)

**MUST**: Phase B/C/D の workflow_dispatch UI で input `run_id` には **Phase A 完走時の run_id を明示的にコピー入力**する。空入力 (auto-generate) を使うと:

- Phase B が Phase A artifact (`<run_id>/phase-a-classify-summary.json`) を 404 で読めず即 fail
- Phase C/D も同様に上流 phase artifact を参照する

これは workflow yaml 上の暗黙 contract (artifact chain は `gs://<artifact-bucket>/<run_id>/...` で run_id ごとに分離)。session78 rehearsal で Phase A 後に新 run_id で Phase B を起動した結果、manifest 404 を 1 回経験。

### 推奨フロー (4 phase 連続実行)

```
1. Phase A 起動 (run_id 空欄 → auto-generate、例: 20260515T143000Z-dev-pr-d4-v1)
2. Phase A 完走 → workflow logs から RUN_ID を copy (echo "Computed: run_id=..." 行)
3. Phase B 起動 (run_id に上記 RUN_ID を貼付)
4. Phase B 完走 → 同 run_id
5. Phase C 起動 (同 run_id) ← 番号認可 (destructive: provenance write)
6. Phase D 起動 (同 run_id) ← 通常 mode = read-only verify
```

または、初回から固定 run_id を入力する運用 (例: `20260515T143000Z-cocoro-pr-d4-v1` を全 phase 共通)。

## cocoro/kanameone 本番展開時の番号認可手順

各 phase 開始前に CLAUDE.md 4 原則 §3 (番号単位明示認可) に従う:

```
PR #<番号> — PR-D4 backfill (N files, +X/-Y)
  <env> Phase <X> を実行してよい
```

実施前に `<TBD>` placeholder を実値で埋める PR (本 PR の続き or 別 PR) を作成 → 番号認可 → workflow_dispatch 起動 → GitHub Environment `pr-d4-prod-<env>` で manual approval。

**Phase 別 gate** (Codex 12th 反映、上記 §cocoro/kanameone 本番展開 gating 参照):
- Phase A/B: 本 amendment 状態でも番号認可下で実行可
- Phase C/D: S6 rollback script 実装 PR merge + dev rehearsal + #12 rotate fixture 完了 + Codex 13th review GO 取得 後

## References

- Issue #432 (P0 root cause): https://github.com/yasushi-honda/doc-split/issues/432
- Issue #445 (PR-D4 設計、CLOSED): https://github.com/yasushi-honda/doc-split/issues/445
- ADR-0008 (Firestore 削除禁止): `docs/adr/`
- `rules/gcp.md` (IAM 二重構造 + Artifact Registry cleanup policy)
- session74-76 handoff: `docs/handoff/archive/2026-05-history.md`
- Codex MCP review threads (S1-6 impl-plan 3 round): `019e2a81-a4f0-7960-aeb6-ebf62e841ed4`
- Cloud Run Jobs execution override 公式: https://docs.cloud.google.com/run/docs/execute/jobs#override-job-configuration
