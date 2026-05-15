# PR-D4 impl-plan: 既存 docs Provenance Backfill (Destructive Migration)

**親 Issue**: [#445](https://github.com/yasushi-honda/doc-split/issues/445) (close 済、PR-D 系列の継続)
**親 ADR**: [ADR-0016](../adr/0016-document-identity-and-provenance.md) (MUST 6/7 + SHOULD 1 + MUST 3 拡張)
**Codex MCP 1st review**: thread `019e2558-f83f-7a13-aadd-0eab042fd949` (NO-GO、Critical 8 + Important 7、本 impl-plan で全件反映)
**Codex MCP 2nd review**: thread `019e2678-7f18-7a62-bab8-13cc98ca490c` (NO-GO、Critical 4 + Important 8 + Low 3 + 追加 AC 5 件 BF16-20、本 v2 で全件反映)
**Codex MCP 3rd review**: thread `019e2678-7f18-7a62-bab8-13cc98ca490c` 継続 (NO-GO、Critical 0 + Important 7 + Low 3 + 追加 AC 4 件 BF21-24、本 v3 で全件反映)
**Codex MCP 4th review (final)**: thread `019e2678-7f18-7a62-bab8-13cc98ca490c` 継続 (**GO with required amendments**、Critical 0 + Important 1 + Low 3、本 v3.1 で全件反映済)
**Status**: **Final v3.1 — Codex GO 取得済、ユーザー番号認可フェーズ準備完了**
**作成日**: 2026-05-14 session70

---

## 1. 目的とスコープ

### 1.1 目的

PR-D2 (splitPdf) + PR-D3 (rotatePdfPages) で **新規生成 doc は provenance 10 fields を必ず持つ** 状態を確立した。一方、**dev/cocoro/kanameone 既存 ~6,264 docs (kanameone 5,725 + cocoro 539 + dev fixtures)** は provenance 不在で、PR-D3 rotate gate により **rotation が `failed-precondition` で reject される運用阻害状態**にある。

PR-D4 は legacy doc に対し best-effort で `provenance` を backfill し、rotation 機能を回復させる。同時に Codex 1st review Critical 1 の指摘に従い **「split 時点正当 provenance」と「legacy backfilled provenance」を厳密に区別** し、Issue #432 silent corruption の被害 doc を「正規」に昇格させる経路を構造的に閉鎖する。

### 1.2 スコープ

**対象**:
- 既存 `documents/{docId}` で `provenance` 不在 + `splitFromPages` 存在 (= 過去の splitPdf で生成された child doc) のもの
- dev / cocoro / kanameone の 3 環境

**スコープ外** (= PR-D5+ defer):
- Storage object の `processed/{fileName}` → `processed/{docId}/{fileName}` 物理移動 (= 物理 rewrite)
- `RepairableMissingFile` 分類 doc の親 PDF からの再生成
- `parentDocumentId` が NULL な孤児 doc の救済

### 1.3 成功基準 (= PR-D4 完了条件)

1. dev / cocoro / kanameone の **`MatchedByHash` 分類 doc 全件**が `provenance` + `provenanceBackfill.confidence = 'derived-bytes-verified'` で書込完了
2. rotate gate 動作確認: `derived-bytes-verified` doc は rotate 成功、`child-snapshot-only` doc は依然 `failed-precondition` で reject。**ただし `child-snapshot-only` doc は本番 Phase C では作成しない (dev fixture でのみ作成、Codex 2nd review C1 反映)**
3. 既存 valid provenance (PR-D2/D3 後 doc、`provenanceBackfill` field absent) は immutable skip (上書き 0 件)
4. 各 phase の summary artifact (JSON) は **GCS bucket に SHA256 manifest 付きで保存** (Codex 2nd review I2 + BF19、artifact size > 数 MB の chunking 対応、GitHub Actions logs / Cloud Logging はメタ情報のみ)

---

## 2. 前提と制約

### 2.1 PR-D2/D3 で確立済の前提

- `provenance` 10 fields の意味論 (ADR-0016 MUST 1/2/3/5)
- `rotatePdfPages` の legacy guard (`provenance` 不在 → `failed-precondition` reject)
- PR-C3c classifier (`scripts/classify-collision-docs.ts` + `scripts/lib/collisionClassifier.ts`、5 分類)
- PR-C3c lockfile gate (`scripts/lib/lockfileGate.ts`)
- PR-C3c source manifest drift 検出 (`scripts/lib/sourceManifestDrift.ts`)

### 2.2 ADR-0016 改訂 (本 impl-plan で実装すべき新規制約)

- **MUST 6**: `provenanceBackfill` field を legacy backfill で必須記録 (method/confidence/backfilledAt/evidence)
- **MUST 7**: **`provenance` field exists && `provenanceBackfill` field absent** の doc は immutable skip (Codex 3rd review I3 反映、null sentinel ではなく field absence で判定)
- **MUST 3 拡張**: rotate gate は `provenanceBackfill` 存在 + `confidence !== 'derived-bytes-verified'` を reject
- **SHOULD 1**: 5 段階 classify + 4 phase 構造 (Phase A audit / B revalidation / C atomic backfill / D verify+gate)

### 2.3 destructive migration プロトコル制約

- CLAUDE.md MUST: 番号認可付き実行
- `feedback_destructive_migration_codex_review`: AskUserQuestion 前 Codex MCP 必須
- ADR-0008: `firebase firestore:delete --all-collections` 等の禁止操作 (本 PR は doc 削除を伴わない、書込のみ)
- PR-C3c プロトコル準拠: dev rehearsal 7-stage × 2 周

---

## 3. データモデル

### 3.1 `provenanceBackfill` field (新規、ADR-0016 MUST 6)

```ts
// shared/types.ts に PR-D4 実装時に追加
export interface ProvenanceBackfillMetadata {
  method: 'legacy-observed';                       // enum で将来拡張余地
  confidence: BackfillConfidence;
  backfilledAt: Timestamp;                         // backfill 実行時刻 (≠ provenance.createdAt)
  evidence: {
    parentExists: boolean;
    parentSha256MatchedAtBackfill: boolean | null; // 再 split 検証実施なら true、未検証 null
    childSha256ComputedAtBackfill: boolean;        // child object から sha256 を実計算したか
    backfillScriptVersion: string;                 // 例: 'pr-d4-v1.0'
    classifierCategory:
      | 'MatchedByHash'
      | 'RepairableMissingFile'
      | 'Ambiguous'
      | 'LostOrUnrecoverable'
      | 'NeedsManualReview';                       // PR-C3c classifier 出力を記録
  };
}

export type BackfillConfidence =
  | 'derived-bytes-verified'   // parent + child 現存、parent から再 split で同 bytes 一致
  | 'child-snapshot-only'      // 現 child sha256/generation 実計算記録、parent 不在 or 再 split sha256 不一致
  | 'metadata-only';           // child GCS metadata のみで sha256 実計算スキップ (cost cut)

// Document interface 拡張 (existing types extension)
export interface DocumentDocument {
  // ... existing fields
  provenance?: DocumentProvenance;
  provenanceBackfill?: ProvenanceBackfillMetadata;  // 新規、PR-D4 で追加
}
```

### 3.2 confidence 階層と rotate gate の対応 (ADR-0016 MUST 3 拡張)

| `provenanceBackfill` | `confidence` | rotate gate 動作 | 意味 |
|---|---|---|---|
| 不在 | — | **allow** | PR-D2/D3 verified provenance (split 完了時刻に正当 bytes 証拠で書込) |
| 存在 | `derived-bytes-verified` | **allow** | parent + child bytes 一致確認済、Issue #432 silent corruption 被害なし |
| 存在 | `child-snapshot-only` | **reject** (`failed-precondition`) | 現 child sha256 記録のみ、壊れた legacy bytes の可能性あり |
| 存在 | `metadata-only` | **reject** (`failed-precondition`) | sha256 実計算スキップ、Issue #432 被害判定不能 |

---

## 4. 4 Phase 構造 (Codex 1st Critical 3/7 + 2nd Critical 1/2/3 反映)

### 4.0 Phase C 書込対象スコープ (Codex 2nd Critical 1 反映)

**本 PR-D4 の Phase C 書込対象**:

| 分類 | Phase C 本番書込 | dev fixture 作成 | rotate gate 期待 |
|------|----------------|----------------|---------------|
| `MatchedByHash` (`derived-bytes-verified`) | ✅ 書込 | 必須 | rotate 成功 |
| `Ambiguous` (`child-snapshot-only`) | **❌ 書込しない** (本 PR scope 外) | **必須** (BF13/BF17 検証用) | rotate `failed-precondition` reject |
| `Ambiguous` (`metadata-only`) | **❌ 書込しない** (PR-D4 では原則禁止、明示 approval 必要) | 任意 (採用時のみ) | rotate `failed-precondition` reject |
| `RepairableMissingFile` | ❌ 書込しない (PR-D5+ で物理 rewrite) | 任意 | rotate `failed-precondition` reject |
| `LostOrUnrecoverable` | ❌ 書込しない (deletion 候補別 PR) | 任意 | rotate `failed-precondition` reject |
| `NeedsManualReview` | ❌ 書込しない | 任意 | rotate `failed-precondition` reject |
| `provenance` 存在 + `provenanceBackfill` absent (= verified) | **❌ immutable skip** (MUST 7) | (作成不要) | rotate 成功 |

**rationale**: 本 PR-D4 は **`MatchedByHash` のみ実 backfill** で rotate gate 復旧を達成する。`child-snapshot-only` は dev fixture で rotate reject 動作を確認するための専用 fixture として作成し、本番 docs に記録しない。`Ambiguous` doc を本番で `child-snapshot-only` として記録する判断は別 PR で再検討する (壊れた legacy bytes の取り扱い方針が未確定なため)。


### 4.1 Phase A (audit + classify、read-only)

**目的**: 全 docs を **現状 GCS state** で再 audit + 5 分類し、artifact 出力 (Codex Critical 5 反映、PR-C artifact は使わない)

**入力**: なし (Firestore + GCS 全件読込)

**処理**:
1. `documents` collection を全件 stream で読み (cursor pagination)
2. 各 doc について 5 分類判定 (PR-C3c classifier 流用、`scripts/lib/collisionClassifier.ts`)
3. `provenance` 不在 + `provenanceBackfill` 不在 → 候補
4. `provenance` 存在 + `provenanceBackfill` 不在 → **immutable skip** 記録 (MUST 7)
5. `provenanceBackfill` 存在 → 既 backfilled、再 backfill 候補から除外
6. classify summary を JSON artifact 出力

**出力**: GCS path `gs://{env-bucket}/pr-d4-backfill-artifacts/{run-id}/phase-a-classify-summary.json` + SHA256 manifest `gs://{env-bucket}/pr-d4-backfill-artifacts/{run-id}/manifest.json` (Codex 2nd review I2 + BF19 反映、artifact size > 数 MB は chunking)

**artifact 構造** (chunking 規則: candidates 配列を 1000 docs/chunk で分割し `phase-a-classify-summary-chunk-{0,1,2,...}.json` として保存、main artifact は metadata + chunk pointers のみ):
```json
{
  "phase": "A",
  "schemaVersion": "pr-d4-v1.0",
  "env": "dev",
  "scriptVersion": "pr-d4-v1.0",
  "runId": "20260514T100000Z-dev-pr-d4-v1",
  "snapshotStartedAt": "2026-05-14T10:00:00Z",
  "snapshotCompletedAt": "2026-05-14T10:15:00Z",
  "bucketLocation": "asia-northeast1",
  "cloudRunJobLocation": "asia-northeast1",
  "egressFreeAssertion": true,
  "totalDocs": 6264,
  "categoryDistribution": {
    "MatchedByHash": 4800,
    "RepairableMissingFile": 320,
    "Ambiguous": 800,
    "LostOrUnrecoverable": 200,
    "NeedsManualReview": 144
  },
  "alreadyBackfilled": 0,
  "verifiedExistingProvenance": 0,
  "chunks": [
    { "path": "gs://.../phase-a-classify-summary-chunk-0.json", "sha256": "...", "docCount": 1000 },
    { "path": "gs://.../phase-a-classify-summary-chunk-1.json", "sha256": "...", "docCount": 1000 }
  ]
}
```

**chunk 1 件 (1000 candidates 含む) の構造**:
```json
{
  "schemaVersion": "pr-d4-v1.0",
  "chunkIndex": 0,
  "candidates": [
    {
      "docId": "abc123",
      "category": "MatchedByHash",
      "firestoreUpdateTime": "2026-05-13T08:00:00Z",
      "parentDocId": "parent-xyz",
      "childObjectPath": "processed/old_filename.pdf",
      "childGeneration": "1234567890",
      "childMetageneration": "1",
      "parentObjectPath": "original/upload_xxx.pdf",
      "parentGeneration": "9876543210",
      "parentMetageneration": "1"
    }
    // ... 1000 件
  ]
}
```

**bucket location 確認 (Codex 2nd review I4 反映、BF19 連動)**:
- Phase A 起動時に Cloud Run Job が動いている region と target bucket の location が同一であることを確認
- 不一致なら abort + ログ記録 (egress 課金前提が崩れる)
- artifact `bucketLocation` / `cloudRunJobLocation` / `egressFreeAssertion` field に記録

**write 操作**: なし (read-only)

**rate limit**: Firestore read 1000/sec 上限を絶対超えない (Firestore SDK の自動 throttle に委譲)

---

### 4.2 Phase B (write-free preflight revalidation、Codex Critical 7 反映)

**目的**: Phase A artifact の各 candidate について **Firestore `updateTime` + GCS `generation`/`metageneration`** を再照合し drift があれば skip。**write は一切しない**。

**入力**: Phase A artifact (`phase-a-classify-summary-*.json`)

**処理**:
1. **Phase A artifact を chunk 単位 streaming read** (Phase A manifest の sha256 で各 chunk を verify、全 chunk を一括メモリロードしない、BF22 反映)
2. 各 candidate (chunk 内) を読込
3. Firestore `getDocument()` で `updateTime` 取得し artifact 値と比較 → drift なら skip
4. GCS `child.getMetadata()` で `generation`/`metageneration` 取得し artifact 値と比較 → drift なら skip
5. `MatchedByHash` のみ: parent も同様に再照合 + 親 PDF 再 download + page selection で再 split → child sha256 と一致確認
6. revalidated candidates を **chunk 単位で GCS に出力** (Phase A と同じ chunking 規則: 1000 docs/chunk)、main artifact は metadata + chunk pointers + sha256 manifest

**出力 (BF22 chunking 適用)**: GCS path `gs://{env-bucket}/pr-d4-backfill-artifacts/{run-id}/phase-b-revalidation-summary.json` (main) + `gs://.../phase-b-revalidation-summary-chunk-{N}.json` (chunks) + `gs://.../manifest.json` (Phase A manifest を Phase B chunk 情報で update)

**main artifact 構造**:
```json
{
  "phase": "B",
  "schemaVersion": "pr-d4-v1.0",
  "env": "dev",
  "runId": "20260514T100000Z-dev-pr-d4-v1",
  "phaseAArtifactRef": "gs://.../phase-a-classify-summary.json",
  "phaseAManifestSha256": "...",
  "revalidationStartedAt": "...",
  "revalidationCompletedAt": "...",
  "candidatesIn": 6264,
  "driftSkipped": {
    "firestoreUpdateTimeChanged": 12,
    "childGenerationChanged": 3,
    "parentGenerationChanged": 8
  },
  "candidatesOut": 6241,
  "chunks": [
    { "path": "gs://.../phase-b-revalidation-summary-chunk-0.json", "sha256": "...", "docCount": 1000 }
  ]
}
```

**chunk 構造** (1000 revalidated candidates 含む):
```json
{
  "schemaVersion": "pr-d4-v1.0",
  "chunkIndex": 0,
  "revalidated": [
    {
      "docId": "abc123",
      "category": "MatchedByHash",
      "computedConfidence": "derived-bytes-verified",
      "computedProvenance": {
        "sourceGeneration": "9876543210",
        "sourceMetageneration": "1",
        "sourceSha256": "...",
        "sourcePath": "original/upload_xxx.pdf",
        "sourceBucket": "...",
        "derivedObjectPath": "processed/old_filename.pdf",
        "derivedGeneration": "1234567890",
        "derivedMetageneration": "1",
        "derivedSha256": "...",
        "createdAt": "<= original document.createdAt から取得 (split 完了時刻)>"
      },
      "evidence": {
        "parentExists": true,
        "parentSha256MatchedAtBackfill": true,
        "childSha256ComputedAtBackfill": true
      }
    }
    // ... 1000 件
  ]
}
```

**write 操作**: business document Firestore write なし。GCS artifact write のみ (BF22)

**rate limit (Codex 1st Important 6 + 2nd I3 反映、多次元制御 + 保守的 spec)**:
- Firestore read: 1000/sec (default)
- Firestore write (Phase C): **100-200/sec で開始** (Codex 2nd L2 反映、500/sec 理論上限は使わず実測で上げる)
- GCS download (parent PDF): **N=4 並行で開始** (Codex 2nd I3 反映、p95 PDF サイズ確認後に N=8 へ昇格判断)
- sha256 計算 CPU + pdf-lib regeneration CPU: Cloud Run Job spec 統一 (§7.1 参照)

**`createdAt` の取り扱い (Codex 1st Critical 2 反映)**:
- `provenance.createdAt` は **document.createdAt (= split 完了時刻)** から取得
- `Timestamp.now()` を入れない (createdAt 意味破壊禁止)
- `provenanceBackfill.backfilledAt = Timestamp.now()` で別 field に分離記録
- document.createdAt が不在 / 不正な doc は `Ambiguous` 降格 (= 本 PR Phase C スコープ外、§4.0 参照)

---

### 4.3 Phase C (atomic backfill verified docs、Codex Critical 3 反映)

**目的**: Phase B revalidated candidates に対し **atomic batch で `provenance` 10 fields + `provenanceBackfill` metadata を一括書込** (Phase B/C 分離不能 = atomic record 必須)

**入力**: Phase B artifact (`phase-b-revalidation-summary-*.json`)

**処理**:
1. **GCS sentinel object 排他 lock 取得** (Codex 2nd Critical 2 + 3rd I1/I2/BF21 反映、`scripts/lib/lockfileGate.ts` は package-lock 確認のみで分散 lock 機能なしのため):
   - `gs://{env-bucket}/pr-d4-backfill-locks/{env}-phase-c.lock` を `ifGenerationMatch:0` precondition で create
   - 既存ロック検出 (= generation > 0) → abort (並行 backfill 検出) + 既存 lock の `runId/jobId/startedAt/lockOwner` をログ記録 (人間判断材料)
   - lock body には `{ runId, jobId, startedAt, expectedDuration, lockOwner: 'github-actions-run-{N}' }` を JSON で記録
   - **取得 generation を保存** (`acquiredLockGeneration` 変数、後段の解放で precondition 必須、BF21)
2. **lease 60 min 挙動 (Codex 3rd I2 反映、自動 takeover 禁止)**:
   - lease 有効期限 = 60 min。**期限切れでも自動 takeover しない** (旧 job が遅れて完了する可能性 + 新 job 起動で並走リスク)
   - 期限切れ lock の **手動解放のみ**、解放条件は runbook (`docs/runbooks/pr-d4-backfill-runbook.md`、PR-D4 実装 PR で作成) に以下を明記:
     - (a) Cloud Run Job execution が確実に終了していること (Cloud Console / `gcloud run jobs executions describe` で確認)
     - (b) lock body の `runId/jobId/startedAt` を `gsutil cat` で取得し人間が照合
     - (c) 解放実行時に lock 取得時 generation を再取得し `ifGenerationMatch:<generation>` 付き delete (= stale lock 解放中に別 job が lock 取った場合、解放は失敗する = 安全)
   - **代替案**: Firestore lease doc (`backfillLocks/{env}-phase-c`) は観測性 (Console 表示) で優れるが、本 PR では GCS sentinel 採用 (Cloud Run Job が GCS 認証済 + storageGuard.ts と同じ utility でテスト可能、Codex 3rd Q5)
3. **lockfile gate 確認** (PR-C3c `scripts/lib/lockfileGate.ts` 流用、package-lock 整合性確認のみ、§7.3 参照、Codex 2nd C2 で本来の lock 機能と分離明文化)
4. **Phase B artifact を chunk 単位 streaming read** (Phase B manifest sha256 verify、BF22)
5. batch 単位 (20 docs/batch、Firestore atomic batch 上限 500 の余裕値) で以下を実行:
   - 各 doc に `lastUpdateTime` precondition 設定 (再 drift 検出)
   - **batch 直前 immutable skip 確認** (Codex 2nd I1 反映、field existence で判定): 各 doc を再読込し `provenance exists && provenanceBackfill is undefined` → skip 記録 + batch から除外
   - `provenance` 10 fields + `provenanceBackfill` metadata を atomic update
   - **precondition 失敗時の doc 単位隔離 (Codex 2nd Critical 3 反映)**:
     - batch 全体が失敗 → 失敗 batch を **doc 単位の個別 update に分解して再実行**
     - 個別 update で precondition pass → 書込継続 (drift なし doc を巻き込まない)
     - 個別 update で precondition 失敗 (drift あり) → `preconditionFailedDocs` に隔離 + 該当 doc は Phase C スキップ (Phase B 再実行対象として artifact 化)
     - 個別 update の retry max = 3 (timeout / network error 等の transient 対策)
6. **Phase C artifact 出力** (BF22 chunking 適用): GCS path `gs://{env-bucket}/pr-d4-backfill-artifacts/{run-id}/phase-c-backfill-summary.json` (main) + chunks (writtenDocs / preconditionFailedDocs を chunk 単位で保存) + manifest sha256 update
7. 全 batch 完了後 GCS sentinel lock 解放: `gcs.bucket.file('...').delete({ preconditionOpts: { ifGenerationMatch: <step 1 で保存した acquiredLockGeneration> } })` (BF21、generation precondition 必須、stale lock 上書きで他 Job lock を消す事故防止)。lease 期限切れの自動 cleanup は **行わない** (上記 step 2 参照)

**書込内容例** (`MatchedByHash` doc):
```ts
batch.update(docRef, {
  provenance: createBackfillProvenance({  // PR-D4 で provenance.ts に追加
    base: { /* Phase B で計算済の 10 fields */ },
    confidence: 'derived-bytes-verified',
  }),
  provenanceBackfill: {
    method: 'legacy-observed',
    confidence: 'derived-bytes-verified',
    backfilledAt: Timestamp.now(),
    evidence: {
      parentExists: true,
      parentSha256MatchedAtBackfill: true,
      childSha256ComputedAtBackfill: true,
      backfillScriptVersion: 'pr-d4-v1.0',
      classifierCategory: 'MatchedByHash',
    },
  },
}, { lastUpdateTime: <Phase B artifact 記録値> });
```

**出力**: `phase-c-backfill-summary-{env}-{timestamp}.json`
```json
{
  "phase": "C",
  "env": "dev",
  "phaseBArtifactRef": "phase-b-revalidation-summary-dev-20260514T101500Z.json",
  "backfillStartedAt": "...",
  "backfillCompletedAt": "...",
  "candidatesIn": 6241,
  "writtenDocs": 6238,
  "preconditionFailedDocs": [
    { "docId": "...", "reason": "lastUpdateTime drift", "retryCount": 3 }
  ],
  "skippedImmutable": 0,
  "lockfileSnapshot": { /* PR-C3c 形式 */ },
  "chunks": [
    { "path": "gs://.../phase-c-backfill-summary-chunk-0.json", "sha256": "...", "writtenDocCount": 1000 }
  ]
}
```

**chunk 構造** (Phase A/B と同じ chunking 規則: 1000 docs/chunk、BF22):
```json
{
  "schemaVersion": "pr-d4-v1.0",
  "chunkIndex": 0,
  "writtenDocs": [
    { "docId": "abc123", "writeStatus": "ok", "newProvenanceBackfillSha256": "...", "lastUpdateTimeAfter": "..." }
    // ... 1000 件
  ]
}
```

**write 操作 (Codex 4th L2 反映、表現精緻化)**: Firestore `documents/{docId}` への update のみ。**business document Storage object への操作 (rewrite/delete/create) はなし**。GCS lock object (sentinel) と GCS artifact object (phase summary + chunks + manifest) の create/delete は除外

**rate limit (Codex 3rd I4 反映、500/sec 古い記述削除 + 共通 token bucket)**:
- **Firestore write は 100-200/sec を batch / individual update 共通の global token bucket で守る** (§4.2 / §6.1 と整合)
- batch 20 docs × 5-10 batch/sec = 100-200 docs/sec 上限
- batch fallback の個別 update も同じ token bucket を通過 (BF23 lock-in、Codex 3rd 追加 AC)
- dev rehearsal 実測値で 500/sec への昇格判断 (本 impl-plan v1 の 500/sec 想定は v3 で削除)

**immutable skip 動作 (MUST 7 + Codex 1st Critical 8 + Codex 3rd I3 反映、field existence で判定)**:
- batch 直前に再度 doc 状態を取得し **`provenance` field exists && `provenanceBackfill` field is undefined (Firestore で field absent)** を検出 → skip 記録 + batch から除外
- **`null` sentinel は使わない** (Codex 3rd I3、Firestore で `undefined` は field absent + `null` は明示書込で別意味、MUST 7 は field absent で判定)
- これは Phase A で記録済だが Phase A→C の間で PR-D2 の新 split が走ったケースのガード

---

### 4.4 Phase D (verify + gate behavior)

**目的**: backfill 後の Firestore + GCS 整合確認 + rotate gate 動作確認

**入力**: Phase C artifact

**処理**:
1. Phase C で書込 doc 全件を再読込し `provenance` + `provenanceBackfill` の存在 + 値整合確認
2. **dev 環境のみ**: **disposable fixture doc** (= テスト専用に作成された doc、本番 docs に副作用を残さない、Codex 2nd Important 6 + 3rd I6 反映) で実 rotate API call → `derived-bytes-verified` 成功 + `child-snapshot-only` `failed-precondition` reject 確認
   - rotate 試行で生成された新 Storage object は test cleanup hook で必ず削除
   - test fixture doc は `BF13_test_fixture_<timestamp>` 等の prefix で識別可能にし、Phase D 完了後に Firestore Console で目視削除 (script 自動削除は ADR-0008 削除制約により慎重に判断)
3. cocoro / kanameone: **read-only verification のみ** (Codex 3rd I6 反映、本 script は本番 doc に rotate side effect を残さない)。rotate gate 実動作はユーザーが通常業務で必要な rotate を行った際の事後観測で代替
4. coverage 比率算出 (`derived-bytes-verified` / 全 candidates)
5. **integration test (BF13/BF17 構造的 lock-in)**: emulator 上で rotate gate behavior を contract test 化し、PR-D4 PR の CI で permanent 検証 (本番 doc 副作用なし)
6. **Phase D artifact 出力** (BF22 chunking 適用): GCS path `gs://{env-bucket}/pr-d4-backfill-artifacts/{run-id}/phase-d-verify-summary.json` (main: verifiedDocs / fieldsConsistent / fieldsMismatch / rotateGateTest / coverageRatio) + chunks (verification 詳細を chunk 単位で保存) + manifest sha256 update

**出力**: `phase-d-verify-summary-{env}-{timestamp}.json`
```json
{
  "phase": "D",
  "env": "dev",
  "phaseCArtifactRef": "...",
  "verifyStartedAt": "...",
  "verifyCompletedAt": "...",
  "verifiedDocs": 6238,
  "fieldsConsistent": 6238,
  "fieldsMismatch": [],
  "rotateGateTest": {
    "derivedBytesVerified": { "docId": "...", "result": "200 OK" },
    "childSnapshotOnly": { "docId": "...", "result": "400 failed-precondition" }
  },
  "coverageRatio": {
    "derivedBytesVerified": 0.766,
    "childSnapshotOnly": 0.128,
    "metadataOnly": 0,
    "skipped": 0.106
  }
}
```

---

## 5. Acceptance Criteria (AC BF8-15、PR-D2/D3 AC1-7 を継承)

| AC | 内容 | 検証手段 |
|----|------|---------|
| **BF8** | Phase A artifact 出力で 5 分類分布が記録される (categoryDistribution + alreadyBackfilled + verifiedExistingProvenance) | Phase A script unit test + dev rehearsal artifact 確認 |
| **BF9** | Phase B revalidation で Firestore updateTime / GCS generation drift 検出 doc が `driftSkipped` に記録 + Phase C 入力候補から除外 | Phase B script unit test (drift 模擬 fixture) |
| **BF10** | Phase C atomic backfill 後、書込 doc 全件で `provenance.createdAt === document.createdAt` (split 完了時刻不変、Codex Critical 2) | Phase D verification + dev rehearsal Firestore 直読 |
| **BF11** | Phase C atomic backfill 後、書込 doc の `provenanceBackfill.confidence` 分布が Phase B 期待と一致 | Phase D verification |
| **BF12** | rotate gate test: `provenanceBackfill.confidence === 'derived-bytes-verified'` doc で rotate 成功 | Phase D 実 rotate API call (dev) |
| **BF13** | rotate gate test: `provenanceBackfill.confidence === 'child-snapshot-only'` doc で `failed-precondition` reject | Phase D 実 rotate API call (dev) + integration test |
| **BF14** | 既存 valid provenance (**`provenance` field exists && `provenanceBackfill` field absent**、Codex 3rd I3 反映で field existence 表現) は immutable skip (上書き 0 件) | Phase A `verifiedExistingProvenance` カウント + Phase C `skippedImmutable` カウント + dev rehearsal 確認 |
| **BF15** | cocoro 539 docs + kanameone 5,725 docs それぞれの coverage 比率を Phase D summary artifact 化 | GitHub Actions / Cloud Run logs に保存 |
| **BF16** (Codex 2nd 追加) | Phase C は **GCS sentinel object 排他 lock** を取得し、Cloud Run retry / 二重 workflow trigger でも同一 env+phase の並走が不可能 (Phase C §4.3 step 1 参照) | dev rehearsal で workflow_dispatch 二重起動試行 → 後発 abort 確認 + integration test |
| **BF17** (Codex 2nd 追加) | `child-snapshot-only` 記録方針 (本番 Phase C 書込しない、dev fixture のみ作成) を dev fixture で検証 + rotate gate `failed-precondition` reject を確認 | dev fixture + integration test (本 PR-D4 CI で contract test) |
| **BF18** (Codex 2nd 追加) | Phase C batch precondition failure は **doc 単位に隔離**され、同 batch 内の非 drift doc は書込継続される (Phase C §4.3 step 4 参照) | dev rehearsal で人工 drift 注入 (1 doc を Firestore Console で update) → 残 19 docs 書込成功 + 1 doc が `preconditionFailedDocs` 隔離確認 |
| **BF19** (Codex 2nd 追加) | Phase A/B 含む全 phase artifact は **GCS bucket に schemaVersion + SHA256 manifest 付きで保存** (chunking 規則: candidates 配列 1000 docs/chunk) | dev rehearsal artifact 検証 + S7 stage で Firestore Console + GCS Console 両方目視 |
| **BF20** (Codex 2nd 追加 + 3rd L3 表現分離) | **現存 consumer** (rotate gate / 自動復旧 gate / migration script) が `provenanceBackfill` 存在 doc を **「verified split-time origin」と誤認しない** ことを contract test で検証 (ADR-0016 MUST 6 Consumer contract 反映) + **future consumer 用 helper / contract fixture** を `functions/src/pdf/provenance.ts` に export (`isVerifiedOrigin(doc): boolean` 等) | 現存 consumer = unit test + integration test 各 1 件以上 / future consumer = helper export + JSDoc 契約明文化 |
| **BF21** (Codex 3rd 追加) | GCS sentinel lock は **取得 generation を保存** し、解放は **`ifGenerationMatch:<lockGeneration>` precondition 付き delete のみ許可**。stale lock 手動解除は **Cloud Run Job 終了確認 + lock body の runId/jobId/generation 照合** を runbook 条件にする (§7.3 + §4.3 step 1/5 連動) | dev rehearsal で stale lock 模擬 (Cloud Run Job 強制 kill) + 別 Job 起動 → abort 確認 → 手動解放手順 runbook 通り実行 → 別 Job 再起動成功 |
| **BF22** (Codex 3rd 追加) | Phase **B/C/D** artifact も GCS 保存 + manifest + sha256 verify + chunked streaming 処理 (Phase A と同等)。全 chunk を一括メモリロードしない | dev rehearsal 各 phase artifact GCS Console 目視 + chunk streaming 実装の unit test |
| **BF23** (Codex 3rd 追加) | Phase C の batch fallback **個別 update も同じ global write rate limiter (token bucket) を通過** する (突発書込 rate 増加防止) | unit test (rate limiter mock) + dev rehearsal Cloud Logging で実測 |
| **BF24** (Codex 3rd 追加) | dev rollback rehearsal は **PR-D4 が書いた `provenance` と `provenanceBackfill` の両方を対象 fixture から除去** し、**既存 verified provenance (`provenanceBackfill` absent) には適用しない** | S6 rollback script の対象 query を test fixture に限定 (`fixtureId.startsWith('BF_')` 等) |

---

## 6. フェルミ試算と修正トリガー (Codex Important 6 反映)

### 6.1 フェルミ試算 (impl-plan 段階の暫定値、Phase A 完了時に確定値で更新)

**前提値** (audit-storage-mismatch.js の出力 + Issue #445 body から):
- kanameone 既存 docs: 5,725
- cocoro 既存 docs: 539
- dev 既存 docs: ~10 (fixtures)
- 平均 parent PDF サイズ (推定): 2 MB (要 Phase A 確定)
- 平均 child PDF サイズ (推定): 0.5 MB
- sha256 計算速度: 200 MB/sec (Cloud Run Job 1 vCPU 想定)

**egress + 計算コスト** (kanameone 5,725 docs 想定):
- parent download: 5,725 × 2 MB = 11.45 GB
- child download: 5,725 × 0.5 MB = 2.86 GB
- 合計 egress: ~14.3 GB
- GCS egress 単価 (asia-northeast1 → 同 region): $0/GB (内部通信、課金なし、**bucket location 確認必須 = §4.1 BF19**)
- sha256 計算 CPU: 14.3 GB / 200 MB/sec = ~72 sec (1 vCPU 換算)
- **pdf-lib 再 split CPU (Codex 2nd I5 反映)**: 親 PDF download → load → page selection → child save の処理時間。p95 doc あたり 推定 800 ms (実測必須、Phase A/B で `pdfLibRegenerationP95Ms` 記録)
  - 5,725 docs × 800 ms = ~76 min (1 vCPU 換算)、N=4 並行で ~19 min 実時間
  - **sha256 だけでなく pdf-lib regen が支配的になる可能性あり、修正トリガー追加 (§6.2 #8)**
- **暫定総コスト: $2-5/client (Firestore write + Cloud Run Job CPU 秒、Cloud Run Job spec 統一後の試算)**

**Cloud Run Job spec 統一 (Codex 2nd I3 反映、impl-plan v1 の 8vCPU/32GB と 1vCPU/2GB の矛盾解消)**:
- **保守的初期 spec**: **2 vCPU / 4 GB memory / N=4 並行**
- 1 doc あたり parent + child = 2.5 MB (memory peak)、N=4 で 10 MB ピーク (memory 余裕、pdf-lib heap も含む)
- Firestore write 100-200/sec で開始 (Codex 2nd L2、20 docs/batch × 5-10 batch/sec)
- dev rehearsal Phase A/B 完了後の実測値で N=8 / Firestore write 500/sec への昇格判断

### 6.2 修正トリガー 7 件 (Phase A 完了時にフェルミ再計算、いずれかに該当したら計画修正)

| # | トリガー | 修正方針 |
|---|---------|---------|
| 1 | p95 parent サイズ > 20 MB | concurrent N=4 に減 (memory pressure) |
| 2 | 合計 download > 25 GB/client | 中断 + cocoro/kanameone 個別実行 + Cloud Storage egress cost 想定超過確認 |
| 3 | computable (`MatchedByHash`) < 50% | Phase C 規模再評価、PR-D5 の物理 rewrite 優先度上げ |
| 4 | parent 不在比率 > 30% | Ambiguous 増加で `child-snapshot-only` 比率上昇、rotate 復旧率低下 → ユーザー再相談 |
| 5 | sha256 計算 timeout > 60 min | Cloud Run Job 上限見直し or 分割実行 |
| 6 | Firestore updateTime drift 比率 > 5% (Phase B) | 並行運用 doc が多い → Phase A↔B 間隔短縮 or 業務時間外実行 |
| 7 | Phase C precondition 失敗 retry max 超過 docs > 1% | Phase A↔C 間隔短縮 + ユーザー再相談 |
| **8** (Codex 2nd I5 追加) | pdf-lib regeneration p95 ms/doc > 2000 ms | concurrent N=2 に減 + 物理 rewrite (PR-D5+) 優先度上げ + Phase B 親 PDF download 戦略再検討 |

---

## 7. 実装ホスト判断 (Codex Important 1 反映)

### 7.1 Cloud Run Job 採用 (vs Cloud Functions vs ローカル script)

**比較表**:

| 観点 | Cloud Functions Gen2 | **Cloud Run Job** | ローカル script |
|------|---------------------|-------------------|---------------|
| timeout | 540 sec 上限 | 24 hr 上限 | 制限なし |
| CPU/memory | 1 vCPU / 2 GB max | 8 vCPU / 32 GB | ローカル PC 依存 |
| network egress | GCS 内部通信 (無料) | GCS 内部通信 (無料) | 外部経由 (有料) |
| 番号認可フロー | GitHub Actions trigger | GitHub Actions trigger | 手動実行 |
| 既存 prior art | scripts/audit-storage-mismatch.js (Cloud Functions 経由) | なし (本 PR が初) | scripts/classify-collision-docs.ts |
| 監査ログ | Cloud Logging | Cloud Logging | ローカル log |

**採用**: **Cloud Run Job** (kanameone 5,725 docs の処理時間が Cloud Functions 540s timeout を超える可能性 + 監査ログ完備)。**spec は §6.1 で統一**: 保守的初期 = **2 vCPU / 4 GB memory / N=4 並行** (Codex 2nd I3 反映、impl-plan v1 の 8 vCPU/32 GB 想定はオーバースペック)。dev rehearsal の実測値で昇格判断

### 7.2 GitHub Actions workflow 設計

```yaml
# .github/workflows/pr-d4-backfill.yml (PR-D4 実装時に作成、本 impl-plan では design only)
name: PR-D4 Backfill (manual trigger only)
on:
  workflow_dispatch:
    inputs:
      env:
        type: choice
        options: [dev, cocoro, kanameone]
      phase:
        type: choice
        options: [A, B, C, D]
      phase_input_artifact:
        type: string
        description: "Required for B/C/D, GCS path of previous phase output"
      dry_run:
        type: boolean
        default: true

jobs:
  backfill:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Cloud Run Job
        run: gcloud run jobs execute pr-d4-backfill --region=asia-northeast1 ...
```

**運用**: dev で 7 stages × 2 周 → cocoro → kanameone の段階展開、各 Phase 完了で次 Phase 認可フェーズに移行

### 7.3 排他 lock 設計 (Codex 1st Important 4 + 2nd Critical 2 反映)

**重要**: PR-C3c の `scripts/lib/lockfileGate.ts` は **package-lock.json / pdf-lib version 一致確認のみ** で **分散 lock 機能はない** (Codex 2nd Critical 2 で誤用判明)。本 PR-D4 では以下 2 種類の lock を **別 mechanism で実装**:

| Lock 種類 | 目的 | 実装 |
|---------|------|------|
| **package-lock 整合性** | pdf-lib version drift で sha256 計算結果が変わるリスク防止 | PR-C3c `scripts/lib/lockfileGate.ts` 流用 (本来用途) |
| **分散排他 lock** | Cloud Run Job retry / 二重 workflow trigger による同 env+phase 並走防止 | **GCS sentinel object** `gs://{env-bucket}/pr-d4-backfill-locks/{env}-phase-c.lock` を `ifGenerationMatch:0` precondition で create (§4.3 step 1) |

**GCS sentinel lock の lease lifecycle (Codex 3rd I1/I2/BF21 反映)**:
- 取得: `gcs.bucket.file('...').save(JSON.stringify({ runId, jobId, startedAt, expectedDuration, lockOwner }), { preconditionOpts: { ifGenerationMatch: 0 } })` → **取得 generation を変数 `acquiredLockGeneration` に保存**
- 失敗 (= 既存 lock 検出) → abort + lock body の `lockOwner` / `runId` / `jobId` / `startedAt` をログ記録 (人間判断材料)
- **正常解放**: Phase C 正常終了で `gcs.bucket.file('...').delete({ preconditionOpts: { ifGenerationMatch: acquiredLockGeneration } })` (BF21 必須)
- **自動解放なし** (Codex 3rd I2): lease 60 min 超過でも自動 takeover しない、手動解放のみ
- **手動解放手順** (`docs/runbooks/pr-d4-backfill-runbook.md` に明記、PR-D4 実装 PR で作成):
  1. Cloud Run Job execution の終了確認 (`gcloud run jobs executions describe <execution-id>` で `status.conditions[0].state == 'TERMINATED'`)
  2. `gsutil cat gs://{env-bucket}/pr-d4-backfill-locks/{env}-phase-c.lock` で lock body 取得
  3. `runId/jobId/startedAt` を Cloud Run logs と照合し正当性確認
  4. `gsutil stat ...` で現在 generation 取得
  5. `gsutil -h "x-goog-if-generation-match:<generation>" rm gs://...` で precondition 付き delete
- **代替案として Firestore lease doc も同等** (Codex 3rd Q5): 観測性 (Firestore Console で lock 状態確認) で優れるが、本 PR は GCS sentinel 採用 (storageGuard.ts utility 流用 + dev rehearsal の test path 短縮)


---

## 8. fixture 拡張 (Codex Important 5 反映、現 28 → 50+)

PR-D2/D3 で integration fixtures が 28 件存在 (`scripts/fixtures/`)。PR-D4 で以下 22+ 件を追加:

| 分類 | fixture 内容 | 対応 confidence |
|------|------------|----------------|
| MatchedByHash | parent + child 現存、再 split sha256 一致 (basic) | derived-bytes-verified |
| MatchedByHash | parent + child 現存、splitFromPages [3,5] (multi-page range) | derived-bytes-verified |
| MatchedByHash | 大容量 parent (50 MB) + child (10 MB) | derived-bytes-verified (rate limit test) |
| RepairableMissingFile | child object 不在、parent 現存 | (skip、PR-D5+) |
| Ambiguous | parent 不在、child 現存 | child-snapshot-only |
| Ambiguous | parent metadata 取得不能 | child-snapshot-only |
| Ambiguous | parent + child 現存だが再 split sha256 不一致 (= 過去破損疑い) | child-snapshot-only |
| LostOrUnrecoverable | parent + child 両方不在 | (skip) |
| LostOrUnrecoverable | child object 損傷 (PDF parse error) | (skip) |
| NeedsManualReview | splitFromPages 不在 (= split 履歴なし疑い) | (skip) |
| Concurrent write | Phase A↔B 間で parent generation 変化 | drift skip |
| Concurrent write | Phase A↔B 間で Firestore updateTime 変化 | drift skip |
| Concurrent write | Phase B↔C 間で precondition 失敗 → retry 成功 | (retry path test) |
| Immutable | `provenance` 存在 + `provenanceBackfill` 不在 (PR-D2/D3 後 doc) | immutable skip (MUST 7) |
| Already backfilled | `provenanceBackfill` 存在 (再 backfill 防止) | skip |
| Edge: empty splitFromPages | splitFromPages = [] | NeedsManualReview skip |
| Edge: invalid pageNumber | splitFromPages = [-1, 0] | NeedsManualReview skip |
| Edge: parent moved | parent path changed (move) | Ambiguous |
| Edge: child moved | child path changed (move) | Ambiguous |
| Edge: dual parent | 同 child から複数 parent への参照 | NeedsManualReview |
| Rate limit | 100 docs 並行 backfill | (Phase C rate limit test) |
| Rate limit | Firestore precondition retry 3 連続失敗 | (Phase C abort path test) |

---

## 9. dev rehearsal 7-stage × 2 周 (PR-C3c プロトコル準拠)

### 9.1 7 stages

| Stage | 内容 | 完了条件 |
|-------|------|---------|
| S1 | Cloud Run Job container build + push | image tag 出力 |
| S2 | Phase A 実行 (dev、dry-run なし) | `phase-a-classify-summary-dev-*.json` 生成、5 分類分布が想定範囲 |
| S3 | Phase B 実行 (dev、dry-run なし) | `phase-b-revalidation-summary-dev-*.json` 生成、drift skip rate < 1% |
| S4 | Phase C 実行 (dev、dry-run なし) | `phase-c-backfill-summary-dev-*.json` 生成、precondition 失敗 0 件 |
| S5 | Phase D 実行 (dev、dry-run なし) | `phase-d-verify-summary-dev-*.json` 生成、rotate gate test 期待通り |
| S6 (Codex 3rd I5/BF24 + 12th I1 反映) | rollback rehearsal (dev): **PR-D4 が書いた fixture 限定** (`PR_D4_ROLLBACK_FIXTURE_PREFIX_ALLOWLIST = ['BF_', 'BF13_test_fixture_']`) で `provenance` と `provenanceBackfill` の **両方を `FieldValue.delete()` で field-only 削除** + 再 Phase C → 同結果再現。**既存 verified provenance (`provenanceBackfill` absent) には適用しない**。実装: `scripts/pr-d4-backfill/rollback/` 配下 + workflow yaml の `phase=E` + 3 段 hard gate (workflow + index.ts + orchestrator) + prefix allowlist 2 段適用 | rollback script (`phase=E`) 動作確認 + immutable skip 動作確認 + dry-run default + confirm 明示で実 delete |
| S7 | 統合確認: Firestore Console で代表 doc 5 件目視 + GitHub Actions logs + GCS Console で artifact + manifest 目視 | ユーザー目視 OK |

### 9.2 2 周目 (1 周目で発覚した issue 修正後の再実行)

1 周目完了後、Codex MCP 4th review (本 v3 後の確認 review) を取得し、Critical 0 + Important ≤ 2 が条件。指摘あれば修正後 2 周目実施。2 周目完了で cocoro 展開へ。

---

## 10. 段階展開フロー

| Step | 環境 | 実行内容 | 認可形式 |
|------|------|---------|---------|
| 1 | dev | dev rehearsal 7-stage × 2 周 | impl-plan 承認時に dev 着手認可 |
| 2 | (review) | Codex MCP 4th/final review GO 後 (本 impl-plan v3 で Critical 0 + Important ≤ 2 達成済) | 4th review GO 後にユーザー番号認可フェーズへ |
| 3 | cocoro | Phase A → B → C → D (各 phase でユーザー番号認可) | 各 phase 単位で `cocoro phase X 実行してよい` |
| 4 | (verify) | cocoro で **read-only verification** (Phase D Firestore + GCS 整合確認のみ実施)。rotate API 動作確認は **ユーザーが通常業務で必要な rotate を実施した際の事後観測** で代替 (本 script は本番に rotate side effect を残さない、Codex 3rd I6 反映) | ユーザー目視 OK |
| 5 | kanameone | Phase A → B → C → D (各 phase でユーザー番号認可) | 各 phase 単位で `kanameone phase X 実行してよい` |
| 6 | (verify) | kanameone で **read-only verification** (cocoro と同方針、本 script は本番に rotate side effect を残さない、Codex 3rd I6 反映) | ユーザー目視 OK |
| 7 | (close) | PR-D4 PR merge + Issue #432 close 判断 (ユーザー相談) | ユーザー認可 |

---

## 11. 反映済の Codex 1st review 指摘マッピング

### 11.1 Critical 8 件

| # | Codex 指摘 | 本 impl-plan / ADR 反映先 |
|---|-----------|-------------------------|
| C1 | legacy backfill 本来の provenance 再構成不能 → `legacy-observed-provenance` 格下げ必須 | ADR-0016 MUST 6 (`provenanceBackfill.method = 'legacy-observed'` + confidence 階層) + 本 §3.1 |
| C2 | `createdAt` 意味破壊 → `backfilledAt` 別 field 必須 | ADR-0016 MUST 6 (`backfilledAt`) + 本 §4.2 (`provenance.createdAt` は document.createdAt から取得) + AC BF10 |
| C3 | Phase B (provenance-only) / Phase C (derivedObjectPath) 分離不能 → 統合必須 | 本 §4.3 Phase C で 10 fields atomic 書込 + ADR-0016 SHOULD 1 改訂 |
| C4 | child object identity 検証弱 → `derivedGeneration/Metageneration/Sha256` 現物計算記録 | 本 §4.2 Phase B で child sha256 実計算 + §3.1 evidence.childSha256ComputedAtBackfill |
| C5 | Issue #432 既被害 skip list 根拠不足 → 現在 state から再分類必須 | 本 §4.1 Phase A で PR-C artifact 不使用、現状 GCS state から再 audit |
| C6 | backfill 後 rotate gate 突破副作用 → low confidence は依然 reject | ADR-0016 MUST 3 拡張 + AC BF12/BF13 |
| C7 | Phase A→write drift gate 不足 → 全件再照合必須 | 本 §4.2 Phase B (write-free preflight revalidation) + AC BF9 |
| C8 | 既存 valid provenance 上書きリスク → immutable skip 必須 | ADR-0016 MUST 7 + 本 §4.3 Phase C 再 drift 検出 + AC BF14 |

### 11.2 Important 7 件

| # | Codex 指摘 | 本 impl-plan 反映先 |
|---|-----------|-------------------|
| I1 | Cloud Run Job 推奨 (Cloud Functions 540s timeout 制約回避) | 本 §7.1 (Cloud Run Job 採用) |
| I2 | child provenance lib 必要 (`createBackfillProvenance()` factory) | 本 §4.3 (`createBackfillProvenance()` を `functions/src/pdf/provenance.ts` に追加、PR-D4 実装段) |
| I3 | `derivedObjectPath` 型コメントと legacy path 矛盾 | 本 §3.1 (legacy backfill 時は当時の path をそのまま記録 = `processed/{fileName}` 等、コメント明文化) |
| I4 | lockfile gate 判断 | 本 §7.3 (PR-C3c lockfile gate 流用) |
| I5 | fixture 28 件不足 → 50+ 必要 | 本 §8 (fixture 拡張表 22+ 件追加) |
| I6 | rate limit 多次元 (Firestore × GCS × CPU) | 本 §4.1/4.2/4.3 + §6.2 (multi-dim rate limit) |
| I7 | write summary artifact 化 | 本 §4.1〜4.4 (各 phase の summary JSON artifact) |

### 11.3 AC BF8-15 + Phase 改訂

- AC BF8-15: 本 §5 で全件記載
- Phase 改訂: 本 §4 Phase A-D + ADR-0016 SHOULD 1 改訂
- 物理 rewrite = PR-D5+ defer: 本 §1.2 スコープ外 + ADR-0016 PR-D Roadmap

### 11.4 フェルミ修正トリガー 7 件 + Codex 2nd で 1 件追加 (計 8 件)

本 §6.2 で全件表化 (Codex 2nd I5 で pdf-lib regen p95 > 2000 ms を追加)

---

## 11bis. Codex MCP 2nd review (thread `019e2678`) 反映マッピング

### 11bis.1 Critical 4 件

| # | Codex 2nd 指摘 | 本 v2 反映先 |
|---|--------------|------------|
| C1 | `child-snapshot-only` Phase C 矛盾 (Phase C は verified-bytes only なのに BF13 で reject 確認すると無意味) | §4.0 Phase C 書込スコープ表 + 成功基準 §1.3 #2 (本番=verified-bytes only / dev fixture=child-snapshot-only) + ADR MUST 6 confidence 階層注記 |
| C2 | `lockfileGate.ts` は排他 lock ではない (package-lock 整合性のみ) | §7.3 排他 lock 設計 (GCS sentinel object 採用) + §4.3 Phase C step 1 |
| C3 | Phase C batch retry が 1 件 drift で 20 件巻き込む | §4.3 Phase C step 4 (precondition 失敗時 doc 単位隔離) + BF18 |
| C4 | provenance 10 fields 意味論衝突 (consumer 側で誤認リスク) | ADR MUST 6 Consumer contract 節追加 + BF20 (downstream consumer contract test) |

### 11bis.2 Important 8 件

| # | Codex 2nd 指摘 | 本 v2 反映先 |
|---|--------------|------------|
| I1 | `null` vs field absent 混同 | ADR MUST 7 (field existence で判定) + §4.3 Phase C step 4 (batch 直前 immutable skip 確認) |
| I2 | Phase A artifact 巨大化 (chunking 不足) | §4.1 Phase A artifact GCS 保存 + chunking 規則 (1000 docs/chunk) + SHA256 manifest + BF19 |
| I3 | Cloud Run Job spec 矛盾 (8 vCPU/32GB vs 1 vCPU/2GB) | §6.1 + §7.1 で統一 (2 vCPU / 4 GB / N=4 保守的初期) |
| I4 | GCS egress $0 前提に bucket location 確認必須 | §4.1 Phase A artifact `bucketLocation` / `cloudRunJobLocation` / `egressFreeAssertion` field + BF19 |
| I5 | sha256 より pdf-lib 再 split が支配的になる可能性 | §6.1 (pdf-lib regen CPU 試算追加) + §6.2 #8 修正トリガー追加 |
| I6 | BF12 実 rotate API call は dev disposable fixture 限定 | §4.4 Phase D step 2 (disposable fixture + cleanup) + BF12 注記 |
| I7 | ADR と impl-plan の `provenanceBackfill.evidence` schema 不一致 (`classifierCategory`) | ADR MUST 6 schema に `classifierCategory` 追加 |
| I8 | ADR SHOULD 番号重複 | ADR SHOULD 重複削除 |

### 11bis.3 Low 3 件

| # | Codex 2nd 指摘 | 本 v2 反映先 |
|---|--------------|------------|
| L1 | typo `integunlation` → `integration` | 本 §11bis 末尾 typo fix |
| L2 | Firestore write 500/sec 強すぎ → 100-200/sec から | §4.2 / §4.3 / §6.1 |
| L3 | `metadata-only` 採用条件曖昧 | ADR MUST 6 confidence 階層注記 (PR-D4 では原則禁止、明示 approval 必要) |

### 11bis.4 追加 AC 5 件 (BF16-20)

§5 AC 表で全件追加済 (BF16 GCS sentinel lock / BF17 child-snapshot-only dev fixture / BF18 batch precondition doc 単位隔離 / BF19 artifact GCS chunking + manifest / BF20 consumer contract test)

### 11bis.5 typo / 用語整備

- impl-plan v1 §8 fixture 拡張 表内 `integunlation` → `integration` (Codex 2nd L1)
- §6.1 / §7.1 / §7.3 で「lockfile gate」と「排他 lock」を分離した用語使用に統一

---

## 11ter. Codex MCP 3rd review (thread `019e2678` 継続) 反映マッピング (v3)

### 11ter.1 Critical 件数

**0 件** (v2 の Critical 4 全件解消、Codex 3rd review 結論: Critical なし)

### 11ter.2 Important 7 件

| # | Codex 3rd 指摘 | 本 v3 反映先 |
|---|--------------|------------|
| I1 | GCS sentinel lock 解放に generation precondition 必須 | §4.3 step 5 (`ifGenerationMatch:<acquiredLockGeneration>` 付き delete) + §7.3 lifecycle + BF21 |
| I2 | lease 60 min 超過挙動曖昧 (自動 takeover vs 手動解放混在) | §4.3 step 2 (自動 takeover 禁止、手動解放のみ + Cloud Run Job 終了確認 + lock body 照合) + §7.3 手動解放手順 |
| I3 | `null` 表現が plan に残存 (§2.2 / BF14 / immutable skip) | §2.2 MUST 7 / §4.3 immutable skip 動作 / BF14 全て field absent 表現に統一 |
| I4 | Phase C rate limit 500/sec 古い記述残存 | §4.3 rate limit を 100-200/sec batch/individual 共通 token bucket で統一 + BF23 |
| I5 | S6 rollback が MUST 7 と矛盾 | §9.1 S6 を fixture 限定 + provenance/provenanceBackfill 両方削除 + BF24 |
| I6 | 本番 cocoro/kanameone 手動 rotate API 検証が Phase D 方針と衝突 | §4.4 Phase D step 3 / §10 Step 4/6 を read-only verification + ユーザー通常業務 rotate 事後観測に変更 |
| I7 | BF19 全 phase artifact chunking schema が Phase A しか具体化されていない | BF22 追加 (Phase B/C/D も同等の chunking + manifest + sha256 verify + streaming) |

### 11ter.3 Low 3 件

| # | Codex 3rd 指摘 | 本 v3 反映先 |
|---|--------------|------------|
| L1 | 次アクション「2nd review」が古い | §13 step 1 を「4th review (final review)」に更新 |
| L2 | §12.1 N=8 が古い | §12.1 を N=4 / Firestore write 100-200/sec 保守的初期値に更新 |
| L3 | BF20 future PR consumer は CI 検証不能 | BF20 を「現存 consumer = unit/integration test」「future consumer = helper export + JSDoc 契約明文化」に分離 |

### 11ter.4 追加 AC 4 件 (BF21-24)

§5 AC 表で全件追加済 (BF21 GCS sentinel lock generation precondition + 手動解除条件 / BF22 全 phase artifact GCS chunking + manifest + streaming / BF23 batch fallback 個別 update も共通 token bucket / BF24 rollback rehearsal fixture 限定)

### 11ter.5 質問 1-7 (Codex 3rd) 反映

- Q1 (反映状況): v3 で全件反映を意図 (本 §11ter)
- Q2 (新たな致命的欠陥): Codex 3rd で「データ破壊級なし、運用上の並走リスクは BF21 で解消」確認、v3 で BF21 追加済
- Q3 (Phase checkpoint): §10 Step 5 で「Phase A→B はまとめてもよい、人間判断は Phase B 後」+ Phase A 例外停止条件 (computable < 50% / parent 不在 > 30% / bucket location 不一致 / download > 25 GB) を §6.2 修正トリガー連動
- Q4 (CI minimum scope): BF12/BF13/BF17/BF18/BF20/BF21 を CI integration test に含める方針を §5 で明記
- Q5 (GCS vs Firestore lease): GCS sentinel 採用根拠 + Firestore 代替案を §7.3 で明文化
- Q6 (認可フェーズ提示順): §13 step 2 で提示順序明記
- Q7 (Issue #432 close): §13 step 5 で「PR-D4 完遂後 + 残件 Issue 切出 + #432 に residual risk + coverage artifact 貼付」明記

---

## 11quater. Codex MCP 4th review (final、thread `019e2678` 継続) 反映マッピング (v3.1)

### 11quater.1 結論

**GO with required amendments** (Critical 0 + Important 1 + Low 3、GO 条件 Critical 0 + Important ≤ 2 達成)。本 v3.1 で Important 1 + Low 3 の文書修正を全件反映。

### 11quater.2 Important 1 件

| # | Codex 4th 指摘 | 本 v3.1 反映先 |
|---|--------------|---------------|
| I1 | BF22 本文反映が AC 表中心、Phase B/C/D の artifact schema 本文がまだ薄い | §4.2 Phase B 出力例 chunking 適用 (main + chunk + manifest 構造) + §4.3 Phase C 出力例 chunks 追加 + chunk 構造例 + §4.4 Phase D step 6 (artifact 出力 + chunking) 追加 |

### 11quater.3 Low 3 件

| # | Codex 4th 指摘 | 本 v3.1 反映先 |
|---|--------------|---------------|
| L1 | §10 Step 2 の `Codex MCP 2nd review` 古い記述 | §10 Step 2 を `Codex MCP 4th/final review GO 後` に更新 |
| L2 | Phase C "Storage 操作なし" が GCS lock/artifact と厳密には矛盾 | §4.3 write 操作を「business document Storage object への操作なし。GCS lock object (sentinel) と GCS artifact object の create/delete は除外」に精緻化 |
| L3 | Phase C 手順番号 2 重 (`2.` × 2) | §4.3 step 番号を 1-7 に renumber (1 lock 取得 / 2 lease 挙動 / 3 lockfile gate / 4 Phase B chunk read / 5 batch / 6 artifact 出力 / 7 lock 解放) |

### 11quater.4 ユーザー認可フェーズで強調すべき設計判断 5 点 (Codex 4th Q4 提案)

1. **本番で書く対象は `MatchedByHash` / `derived-bytes-verified` のみ** (§4.0 Phase C 書込スコープ表参照)
2. **既存 PDF Storage object の rewrite/delete/create はしない**。GCS 操作は **lock/artifact のみ** (§4.3 write 操作精緻化)
3. **Phase A-D は個別認可**。特に **Phase B 後に coverage / drift / cost を見て Phase C を判断** (§10 段階展開フロー)
4. **Phase C は GCS sentinel lock + generation precondition + manual stale unlock 手順で並走を防ぐ** (§4.3 step 1-2/7 + §7.3 lifecycle + BF21)
5. **本番 Phase D は read-only verification のみ**。rotate 実 API 検証は dev disposable fixture と CI contract test で担保 (§4.4 Phase D step 2-3 + §10 Step 4/6 + BF13/BF17)

### 11quater.5 追加 AC 提案

なし (Codex 4th: BF21-24 で十分)

---

## 12. リスクと未解決事項

### 12.1 未解決

- **Phase A 確定値待ち**: 平均 parent サイズ・computable 比率は dev/cocoro/kanameone 各環境の Phase A 出力を待ってから cost 試算を確定
- **dev fixture の代表性**: dev 環境の 10 件 fixture が cocoro/kanameone の実 doc 分布を完全には反映しない → cocoro Phase A 完了時に再評価
- **rate limit の実測値**: 保守的初期 concurrent **N=4 / Firestore write 100-200/sec** (Codex 3rd I3/L2)、dev rehearsal Cloud Run Job 実行時に Cloud Logging で thread pool / GCS request rate / pdf-lib regen p95 を観測して N=8 / 500/sec への昇格判断

### 12.2 リスク

- **Phase C precondition retry storm**: Firestore updateTime drift が連続して precondition 失敗が累積 → Phase A↔C 間隔短縮 (業務時間外実行) で軽減
- **Cloud Run Job container build 失敗**: 既存 docker image build pipeline が integration test 連動 → S1 で別途検証
- **rollback 試行 (S6) で provenance 再 backfill 不能**: 1 周目で発覚したら 2 周目前に修正 (rollback script の実装上の bug 検証)

---

## 13. 次アクション (順序)

1. **本 impl-plan v3 を Codex MCP 4th review (final review) に提示** → Critical 0 + Important ≤ 2 が GO 条件 (Codex 3rd review 反映確認)
2. **4th review GO 後、ユーザー番号認可フェーズ提示** (`AskUserQuestion`)
   - 提示順序 (Codex 3rd Q6 反映): まず「書く対象は MatchedByHash のみ」「Storage delete/create は lock/artifact 以外なし」「各 phase 個別認可」「Phase B 後に coverage/drift/cost を見て C 判断」「rollback/retry/lock の停止条件」を先に提示。thread サマリーは Critical/Important がどう潰れたかの表に絞る
3. **dev rehearsal 7-stage × 2 周** (PR-D4 実装着手、本 impl-plan を spec として実装)
4. **PR-D4 PR 作成 → cocoro 段階展開 → kanameone 段階展開**
5. **PR-D4 完了後**: Issue #432 close 判断 (ユーザー相談、Codex 3rd Q7 = PR-D5 完遂を待つ必要薄い、ただし `RepairableMissingFile` / `Ambiguous` / 物理 rewrite 残件を別 issue 切出 + #432 に residual risk と coverage artifact を貼る) + PR-D5 (TypeScript 型 + lint 強化) impl-plan 起票
