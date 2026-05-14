# ハンドオフメモ

**更新日**: 2026-05-15 session73 (**Issue #445 PR-D4 S1-3 (Phase B write-free preflight revalidation) main merge `6cafbba` (PR #466) + Codex MCP 2nd review GO (manifest CAS update + parent download 遅延) 反映、Net 0**)。`scripts/pr-d4-backfill/phase-b/` 新規 (7 source files) + 6 test files (47 unit tests)。Phase A artifact streaming read → drift 検出 + child download + sha256 計算 + parent metadata HEAD → drift なしのみ parent bytes download + 再 split + child sha256 一致確認 → derived-bytes-verified のみ revalidated[] に追加。production Firestore / production GCS への write ゼロ (write-free invariant)。`ArtifactStorageWriter.writeJson` に optional `precondition.ifGenerationMatch` 拡張で manifest CAS update 経路を実装、orchestrator を drift → bytes download の順に refactor。全 1245 tests passing (新規 47 + 既存 1198) / Quality Gate 全クリア (TDD + evaluator + pr-review-toolkit:code-reviewer + Codex MCP review 1st NO-GO → 2nd GO)。次セッション最優先: PR-D4 S1-4 (Phase C 実装 = atomic backfill + GCS sentinel lock + batch precondition failure 隔離) 着手
**ブランチ**: `main` (PR #466 squash merge `6cafbba` 完遂、feature ブランチ自動削除済。CI 全 green: CodeRabbit pass / GitGuardian pass / lint-build-test pass)
**フェーズ**: Phase 8 + 運用監視基盤全環境展開完了 + (session29-66 累積実績は archive 参照) + **Phase 8 (session67 = PR-D1 / session68 = PR-D2 / session69 = PR-D3 完遂 + 3 環境展開 + #445 close / session70 = PR-D4 impl-plan + ADR 改訂 main merge / session71 = PR-D4 S1-1 基盤層 main merge / session72 = PR-D4 S1-2 Phase A 実装 main merge / session73 = PR-D4 S1-3 Phase B 実装 main merge、Net 0)** = Issue #432 P0 collision の構造的予防 splitPdf + rotatePdfPages 双方で 3 環境稼働 + 既存 docs backfill の Phase A (read-only audit) + Phase B (write-free preflight revalidation) が main に確定 (Phase C-D 実装は後続セッション)

<a id="session73"></a>
## ✅ session73 完了サマリー (2026-05-15: Issue #445 PR-D4 S1-3 Phase B 実装 main merge `6cafbba` (PR #466) + Codex MCP 1st NO-GO → 2nd GO 反映、Net 0)

session72 で main 確定した PR-D4 S1-2 Phase A (read-only audit) の出力を **消費する Phase B** = write-free preflight revalidation を実装。`scripts/pr-d4-backfill/phase-b/` 新規 7 source files + 6 test files (47 unit tests)。Phase A artifact streaming read → 各 MatchedByHash 候補に drift 検出 + child download + sha256 計算 + parent metadata HEAD only → drift なしのみ parent bytes download + 再 split + child sha256 一致確認 → derived-bytes-verified のみ revalidated[] に追加 → Phase B artifact (main + chunks + manifest 追記) を GCS 書込。Codex MCP 1st review で **NO-GO 判定** (Critical: manifest CAS 412 + Important: parent download 順序) を取得し、`ArtifactStorageWriter.writeJson` に optional `precondition.ifGenerationMatch` 追加 + orchestrator を drift → bytes download の順に refactor 反映後の 2nd review で **GO** に転換。

### 経緯

1. **catchup**: session72 handoff 確認、次セッション最優先 = PR-D4 S1-3 (Phase B) 着手を選択
2. **feature branch 作成** (`feature/pr-d4-s1-3-phase-b`): main 直 push 禁止 (CLAUDE.md 4 原則 §4)
3. **TaskCreate** (11 件): types → driftDetector → artifactReader → childRevalidator → parentReSplitVerifier → artifactWriter → orchestrator → adapters → CLI → Quality Gate の段階分解
4. **TDD 実装** (RED→GREEN→REFACTOR、各モジュール独立):
   - `types.ts`: Phase B schemas 追加 (PhaseBRevalidatedCandidate / PhaseBRevalidatedChunk / PhaseBRevalidationSummary / PhaseBDriftSkipped) + BackfillConfidence import 追加
   - `driftDetector.ts` (12 tests): pure function、3 種 drift 分類 (Firestore updateTime / child generation / parent generation) の優先順位 firstmost-fail 設計
   - `artifactReader.ts` (8 tests): manifest 読込 + main artifact sha256 verify (eager) + chunks 1 つずつ streaming + sha256 verify (BF22 維持)
   - `childRevalidator.ts` (5 tests): child download + sha256 (raw bytes、provenance.derivedSha256 canonical 値)
   - `parentReSplitVerifier.ts` (7 tests): parent download + `regenerateChildPdf` (scripts/lib/pdfRegenerator.ts 流用) + child sha256 一致確認、graceful degrade (PDF parse 失敗 → matched=false)
   - `artifactWriter.ts` (7 tests): per-chunk flush + main + manifest 追記
   - `revalidationOrchestrator.ts` (8 tests): BF22 per-chunk buffer + Firestore re-fetch + child download + parent metadata HEAD → drift detect → drift OK + child 存在のみ parent bytes download + verify
   - `adapters.ts`: Firebase admin SDK + GCS wrapper、`GcsObjectDownloader` (download + getMetadataOnly)、`FirestoreReReaderImpl` (createdAt 不在で null 返却)
   - `index.ts`: --phase B 対応 + Phase B 起動コード
5. **evaluator + pr-review-toolkit:code-reviewer 並列起動**:
   - evaluator (REQUEST_CHANGES): **HIGH 1** = createdAt 不在 doc の epoch (1970-01-01) silent fallback が derived-bytes-verified で Phase C に流れる経路 + MEDIUM 2 件 (child orphan で parent download 無駄 / phaseAManifestSha256 命名)
   - code-reviewer (HIGH 3 件): **H1** computedProvenance.createdAt (ISO string) → createBackfillProvenance(Timestamp) 型整合性 + **H2** epoch silent fallback (同 evaluator HIGH 1) + **H3** orchestrator が manifest を 2 回 read
   - 全件反映: `adapters.fetchDoc` で createdAt 不在時 null 返却、`artifactReader` が `manifest` + `manifestGeneration` を返し orchestrator は二重 read 廃止、`PhaseAArtifactStream.phaseAManifestSha256` の JSDoc 修正、child orphan で parent download スキップ、`createdAt` ISO 化と Phase C Timestamp 変換責務分離の JSDoc 明文化
6. **Codex MCP 1st review** (read-only sandbox): **NO-GO 判定**
   - **Critical**: Phase B `finalizePhaseBArtifact` が既存 manifest を update するが、`ArtifactStorageWriter.writeJson` は `ifGenerationMatch: 0` で既存 object 拒否のため 412 PreconditionFailed 確定 → manifest CAS update 経路の実装が必要
   - **Important**: parent bytes download が drift 検出より先 → child drift 時にも parent PDF download cost 発生
   - **Suggestion**: manifest update は専用 writer に分け CAS で他者上書き検出
7. **refactor 反映**:
   - `ArtifactStorageWriter.writeJson` signature 拡張: 第 3 引数 optional `precondition: { ifGenerationMatch: number }` (省略 = 0 = 新規 only、>0 = CAS)
   - `ArtifactStorageReader.readJson` 戻り値を `{ content, generation }` に変更し、Phase A reader が manifest generation を返す
   - `PhaseAArtifactStream.manifestGeneration` field 追加、`FinalizePhaseBInput.manifestGeneration` 必須化、finalize で `writer.writeJson(manifestPath, content, { ifGenerationMatch: input.manifestGeneration })`
   - `ParentObjectDownloader.getMetadataOnly` 追加 + orchestrator を `child download → parent metadata HEAD → drift detect → drift OK + child 存在のみ parent bytes download` の順に refactor
   - production adapter (`GcsArtifactStorageWriter.writeJson` / `GcsArtifactReader.readJson` / `GcsObjectDownloader.getMetadataOnly`) 実装更新
   - test fake (FakeStorageReader / FakeStorageWriter / InMemoryStorage / FakeParentDownloader / CountingParentDl) を新 signature に追随、InMemoryStorage は 412 PreconditionFailed simulation を追加
   - test 追加 (createdAt 不在時 fetchDoc null 経路 / child orphan 時 parent download 呼ばれない経路 / manifest CAS update ifGenerationMatch 確認)
8. **Codex MCP 2nd review**: **GO 判定** (Critical + Important 全件解消、write-free invariant + per-chunk buffer + sourceSha256 実 parent bytes + createdAt document.createdAt 由来 + Phase C 入力形状 確認済)
9. **commit (`5e64baa`)**: 19 files / +2615/-42 / TDD + evaluator + code-reviewer + Codex MCP 1st→2nd 反映を一括
10. **PR #466 作成** + CI 全 green (lint-build-test pass / CodeRabbit pass / GitGuardian pass)
11. **PR #466 squash merge** (ユーザー番号認可「PR #466 をマージして」取得): `6cafbba` main merge、feature branch 自動削除、main 同期完了

### 変更ファイル一覧 (19 files: 13 new + 6 modified、+2615/-42)

| ファイル | 区分 | LoC |
|---------|------|----:|
| `scripts/pr-d4-backfill/phase-b/artifactReader.ts` | new | 100 |
| `scripts/pr-d4-backfill/phase-b/driftDetector.ts` | new | 64 |
| `scripts/pr-d4-backfill/phase-b/childRevalidator.ts` | new | 67 |
| `scripts/pr-d4-backfill/phase-b/parentReSplitVerifier.ts` | new | 89 |
| `scripts/pr-d4-backfill/phase-b/artifactWriter.ts` | new | 142 |
| `scripts/pr-d4-backfill/phase-b/revalidationOrchestrator.ts` | new | 247 |
| `scripts/pr-d4-backfill/phase-b/adapters.ts` | new | 130 |
| `scripts/pr-d4-backfill/types.ts` | modified | +101/-1 |
| `scripts/pr-d4-backfill/phase-a/artifactWriter.ts` | modified | +23/-7 (writeJson signature 拡張) |
| `scripts/pr-d4-backfill/phase-a/adapters.ts` | modified | +16/-7 (writeJson precondition 対応) |
| `scripts/pr-d4-backfill/index.ts` | modified | +97/-32 (--phase B 対応) |
| `functions/test/prD4ArtifactReader.test.ts` | new | 210 |
| `functions/test/prD4DriftDetector.test.ts` | new | 184 |
| `functions/test/prD4ChildRevalidator.test.ts` | new | 91 |
| `functions/test/prD4ParentReSplitVerifier.test.ts` | new | 155 |
| `functions/test/prD4PhaseBArtifactWriter.test.ts` | new | 197 |
| `functions/test/prD4RevalidationOrchestrator.test.ts` | new | 540 |
| `functions/test/prD4ArtifactWriter.test.ts` | modified | +6/-2 |
| `functions/test/prD4AuditClassify.test.ts` | modified | +6/-1 |

### Net 計測 (CLAUDE.md MUST)

- Before: open Issues = 4 (#432 P0、#402 P2、#251 P2、#238 P2)
- After: open Issues = 4 (変化なし)
- 本 session 完了時点で **+0 / -0 = Net 0**
- 進捗判定: ✅ 構造的進捗 (Issue #432 P0 復旧経路の **Phase B write-free preflight revalidation が main 確定**、Phase C/D 実装が安全に積み上げ可能)

### 設計上の重要決定 (Codex MCP 1st NO-GO → 2nd GO 反映)

- **manifest CAS update (Codex Critical 反映)**: Phase B が既存 Phase A manifest を update する経路で `ifGenerationMatch: 0` (overwrite 禁止) が 412 確定 fail させていた問題を、`ArtifactStorageWriter.writeJson` の signature 拡張 (`precondition.ifGenerationMatch` optional) で compare-and-swap update に変更。reader が manifest GCS generation を取得し、finalize で同じ generation を渡すことで「Phase B 実行中に他者が manifest を書換えていれば 412 fail」の race-safe 設計に。Phase A 既存パス (`writeJson(path, content)` 省略 = 0) は互換維持
- **parent download 遅延 (Codex Important 反映)**: orchestrator を `child download → parent metadata HEAD → drift detect → drift OK + child 存在のみ parent bytes download` の順に refactor。`ParentObjectDownloader.getMetadataOnly` 追加で HEAD-only 経路を提供。drift / child orphan の場合は parent PDF download (大容量 / cross-region egress potential) を構造的に回避
- **createdAt epoch silent fallback 構造的閉鎖 (evaluator + code-reviewer HIGH)**: `FirestoreReReaderImpl.fetchDoc` で `createdAt` 不在 / 不正型の場合 null 返却。orchestrator は null 受領で `driftSkipped.firestoreUpdateTimeChanged++` で除外。これにより 1970-01-01 epoch を `provenance.createdAt` に書込んで Phase C に流す経路が型・実装の両レベルで閉鎖。ADR-0016 Critical 2 (split 完了時刻 ≠ backfill 実行時刻) を強化
- **write-free invariant 維持**: Phase B は production Firestore / production GCS への write を一切しない。GCS への write は artifact bucket の chunks / main / manifest のみ。Codex MCP 2nd review でも明示確認
- **Phase C 連携設計の責務分離**: `PhaseBRevalidatedCandidate.computedProvenance.createdAt` を **ISO string** で保持 (Phase B level)。Phase C caller (S1-4 で実装) で `Timestamp.fromDate(new Date(...))` 変換して `createBackfillProvenance()` factory に渡す責務分割を JSDoc に明文化

### 教訓 (本セッション新規)

- **interface 拡張時の Phase 間 contract 検証必須**: Phase A の `ArtifactStorageWriter.writeJson(path, content)` は新規書込専用に最適化 (`ifGenerationMatch: 0` 強制) されていたが、Phase B で同 interface を使う manifest update 経路が 412 で fail する構造的バグを Codex 1st review が発見。**Phase 間で同一 interface を別目的で使う場合、各 Phase の write semantics を contract レベルで確認する**。今後の Phase C/D 着手時に同種の Phase 跨ぎ interface 拡張があれば impl-plan 段階で signature 検討する
- **silent fallback (epoch / null) は型または invariant で構造的に閉鎖**: createdAt 不在時の `new Date(0).toISOString()` (1970-01-01) は型上は valid だが意味論破壊。**「該当値を生成する fallback コードを書いたら、それが consumer 側で fail-safely 弾かれる経路を全 invariant パスで検証」** を Codex review チェックリストに追加。今回は adapters で null 返却 + orchestrator で counter 加算で構造的閉鎖
- **drift 検出の cost-aware ordering**: drift 検出は **「最も cheap な metadata 取得 → 最も expensive な download/compute」** の順に並べる。今回 child は sha256 計算が必要なため download 必須だが、parent は HEAD で drift 検出可能 → drift fail なら bytes download を skip できる。Phase C/D も同じパターンで「drift 検出と heavy compute の分離」を impl-plan に組込むこと
- **大規模 stage の段階分解の有効性確認**: session71 (S1-1) で確立した「sub-stage 単位の独立 PR」パターンを session72 (Phase A) / 73 (Phase B) で実証。各 PR が 1245 tests を保ちながら 19 files / 2615 行規模でも 1 セッション内 main merge 可能。**1 機能 1 phase レベルまで scope 絞ること**が安全な完遂条件と再確認

### 次セッション着手項目

1. `/catchup` で本 handoff + Issue #432 状態 + open Issue 確認
2. **PR-D4 S1-4 着手** (Phase C 実装、atomic backfill verified docs): Phase B artifact streaming read (chunk 単位 sha256 verify) + **GCS sentinel object 排他 lock** (`pr-d4-backfill-locks/{env}-phase-c.lock` を `ifGenerationMatch:0` で create、既存 lock 検出で abort) + **atomic batch write** (`provenance` 10 fields + `provenanceBackfill` metadata を `Timestamp.fromDate(new Date(...))` 変換しつつ書込) + **batch precondition failure doc 単位隔離** (個別 update で precondition 失敗なら `preconditionFailedDocs` 配列に隔離して continue) + **global write rate limiter** (100-200/sec で開始、Codex 2nd L2 反映)。createBackfillProvenance() factory 経由で 10 fields + metadata 完全構築。本番 Phase C 書込対象は MatchedByHash かつ derived-bytes-verified のみ (impl-plan §4.0)
3. **PR-D4 S1-5** (Phase D 実装、verify + gate behavior): Phase C 書込 doc 全件再読込 + rotate gate test (derived-bytes-verified allow / child-snapshot-only reject)
4. **PR-D4 S1-6**: Dockerfile + `.github/workflows/pr-d4-backfill.yml` (workflow_dispatch + env/phase 選択)
5. **PR-D4 S1-7**: container build + push (dev で実行) → image tag 取得 (= S1 完了条件)
6. **PR-D4 S2-S7**: dev rehearsal 7-stage × 2 周 → Codex MCP 5th review GO 確認 → cocoro / kanameone 段階展開 (各 phase ユーザー番号認可)

---

<a id="session72"></a>
## ✅ session72 完了サマリー (2026-05-15: Issue #445 PR-D4 S1-2 Phase A 実装 main merge `cc2616d` (PR #464) + Codex MCP 1st NO-GO → 2nd GO 反映、Net 0)

session71 で main 確定した PR-D4 S1-1 基盤層 (型 + factory) を消費する **最初の caller** = Phase A (read-only audit + classify) を実装。`scripts/pr-d4-backfill/` 新規ディレクトリ + types + 6 phase-a モジュール + CLI entry + 5 test files (47 tests) を追加。documents collection 全件 stream → 構造 5 分類 → GCS artifact (main + chunks + manifest) JSON 書込。Firestore / production GCS への write 経路ゼロ (read-only invariant 確認済)。Codex MCP 1st review で **NO-GO 判定** (Critical: BF22 違反 + Important: bucket-location default + overwrite 許容) を取得し、per-chunk streaming flush 設計に refactor + 明示必須 / `ifGenerationMatch: 0` 反映後の 2nd review で **GO** に転換。

### 経緯

1. **catchup**: session71 handoff 確認、次セッション最優先 = PR-D4 S1-2 (Phase A) 着手を選択
2. **feature branch 作成** (`feature/pr-d4-s1-2-phase-a`): main 直 push 禁止 + commit 前ブランチ切替 (CLAUDE.md 4 原則 §4)
3. **TaskCreate** (10 件): types → bucket-location-verifier → artifact-writer → doc-snapshotter → category-classifier → audit-classify orchestrator → CLI → quality gate → PR/handoff の段階分解
4. **TDD 実装** (5 module × 各 RED→GREEN→REFACTOR):
   - `types.ts`: PhaseAClassifySummary / PhaseAClassifyChunk / BackfillManifest / ArtifactChunkPointer interfaces + 定数 (PR_D4_ARTIFACT_SCHEMA_VERSION / PR_D4_CANDIDATES_PER_CHUNK=1000)
   - `bucketLocationVerifier.ts` (7 tests): Cloud Run vs target bucket region 検証 (Codex 2nd I4 / BF19)
   - `artifactWriter.ts` (初版 9 tests → refactor 後 8 tests): per-chunk flush + main + manifest 書込
   - `categoryClassifier.ts` (13 tests): 構造分類 (Phase A は hash 計算しない、Phase B が verify)
   - `docSnapshotter.ts` (9 tests): Firestore + GCS HEAD → PhaseADocSnapshot (DI 化、F-B4 bucket 不一致時 skip)
   - `auditClassify.ts` (10 tests): orchestrator (initial 8 → BF22 refactor 後 10、streaming flush + 順序 invariant test 追加)
   - `adapters.ts`: Firebase admin SDK + GCS wrapper (production wiring、unit test 対象外)
   - `index.ts`: CLI entry (--env / --phase / --cloud-run-location / --bucket-location 明示必須)
5. **evaluator + pr-review-toolkit:code-reviewer 並列起動**:
   - evaluator (APPROVE with notes): MEDIUM 1 (snapshotCompletedAt 二重取得) + MEDIUM 2 (bucketName 命名) + LOW (classifier 順序依存) → 全件反映
   - code-reviewer (No critical/high): M1 (readArg flag-as-value bug) + M2 (updateTime cast 簡素化) + L1 (satisfies no-op) + L3 (bucketLocation 型 string | undefined) → 全件反映
6. **Codex MCP 1st review (read-only sandbox)**: **NO-GO 判定**
   - **Critical**: orchestrator が全 `candidates: PhaseACandidate[]` をメモリ保持していて BF22 「全 chunk を一括メモリロードしない」未達 → orchestrator 側 per-chunk flush 設計に refactor 必要
   - **Important 1**: `--bucket-location` default `asia-northeast1` で実 bucket location 確認せず assume してしまう → 明示必須に
   - **Important 2**: artifact run-id 再利用時に overwrite 可能 → `ifGenerationMatch: 0` で既存 object 拒否
7. **refactor 反映**:
   - `artifactWriter.ts` を `writePhaseAChunk` (per-chunk flush) + `finalizePhaseAArtifact` (main + manifest) の 2 関数に分離
   - `auditClassify.ts` orchestrator を per-chunk buffer (≤ PR_D4_CANDIDATES_PER_CHUNK 件) のみ保持 + buffer 満杯時 / 終了時に flush する設計に変更
   - test 書き換え + BF22 streaming 動作確認 test 2 件追加 (1500/1200 docs で per-chunk flush + 書込順序 invariant 確認)
   - `index.ts`: --cloud-run-location / --bucket-location default 削除 → 未指定なら FATAL exit
   - `adapters.ts`: GcsArtifactStorageWriter.save() に `preconditionOpts: { ifGenerationMatch: 0 }` 追加
8. **Codex MCP 2nd review**: **GO 判定** (BF22 解消 + Important 2 件全反映を確認)
9. **commit (`5492642`)**: 13 files / +2220/-0 / TDD + evaluator + code-reviewer + Codex MCP 1st→2nd 反映を一括
10. **PR #464 作成** + CI 全 green (lint-build-test 6m39s / CodeRabbit pass / GitGuardian pass)
11. **PR #464 squash merge** (ユーザー番号認可「PR #464 をマージしてよい」取得): `cc2616d` main merge、feature branch 自動削除、main 同期完了

### 変更ファイル一覧 (13 ファイル: 全 new, +2220/-0)

| ファイル | LoC |
|---------|----:|
| `scripts/pr-d4-backfill/types.ts` | 153 |
| `scripts/pr-d4-backfill/index.ts` | 131 |
| `scripts/pr-d4-backfill/phase-a/artifactWriter.ts` | 156 |
| `scripts/pr-d4-backfill/phase-a/bucketLocationVerifier.ts` | 82 |
| `scripts/pr-d4-backfill/phase-a/categoryClassifier.ts` | 139 |
| `scripts/pr-d4-backfill/phase-a/docSnapshotter.ts` | 137 |
| `scripts/pr-d4-backfill/phase-a/auditClassify.ts` | 192 |
| `scripts/pr-d4-backfill/phase-a/adapters.ts` | 175 |
| `functions/test/prD4ArtifactWriter.test.ts` | 199 |
| `functions/test/prD4BucketLocationVerifier.test.ts` | 71 |
| `functions/test/prD4CategoryClassifier.test.ts` | 152 |
| `functions/test/prD4DocSnapshotter.test.ts` | 213 |
| `functions/test/prD4AuditClassify.test.ts` | 420 |

### Net 計測 (CLAUDE.md MUST)

- Before: open Issues = 4 (#432 P0、#402 P2、#251 P2、#238 P2)
- After: open Issues = 4 (変化なし)
- 本 session 完了時点で **+0 / -0 = Net 0**
- 進捗判定: ✅ 構造的進捗 (Issue #432 P0 復旧経路の **Phase A read-only audit + classify が main 確定**、後続 Phase B-D が安全に積み上げ可能)

### 設計上の重要決定 (Codex MCP 1st NO-GO → 2nd GO 反映)

- **BF22 streaming 厳密適合 (Codex Critical 反映)**: orchestrator は `candidates` 全件配列を保持せず、per-chunk buffer (≤ PR_D4_CANDIDATES_PER_CHUNK=1000 件) のみ。buffer が満杯になった時点で `writePhaseAChunk` flush + chunkPointer 蓄積、buffer reset。streaming 完了後に残 buffer flush + `finalizePhaseAArtifact` (main + manifest)。これにより 6,264 docs 程度の現状規模だけでなく、将来 1M+ docs 環境でも constant-memory で動作。test 1500/1200 件で per-chunk flush + 書込順序 invariant を確認
- **bucket-location 明示必須 (Codex Important 1 反映)**: `--cloud-run-location` / `--bucket-location` の default `asia-northeast1` を削除。未指定なら FATAL exit (egress 課金前提 = region 一致を caller に強制確認させる)。operator が region を意識せず asia-northeast1 assume してしまう経路を構造的に閉鎖
- **artifact overwrite 禁止 (Codex Important 2 反映)**: `GcsArtifactStorageWriter.writeJson()` で `preconditionOpts: { ifGenerationMatch: 0 }` を強制。既存 object overwrite は 412 Precondition Failed で reject。同一 run-id re-run は新 run-id 発行を caller に強制 → Phase B が「古い chunk + 新 partial main」を読む経路を閉鎖
- **構造分類 vs hash 検証の責務分離**: Phase A は **構造的状態だけ** (parent/child 存在 + splitFromPages 存在) で 5 分類を予測。hash 計算 (再 split + fingerprint compare) は Phase B 担当。PR-C3c `collisionClassifier.ts` の `classifyOrphan` / `classifyCollisionGroup` は hash evidence を入力に取るため流用不可、Phase A 専用の独立 pure function (`classifyForPhaseA`) を別実装。DRY 違反ではなく **入力契約の違いによる正当な分離**
- **DI 設計**: DocumentSource / ParentFetcher / BucketProber / ArtifactStorageWriter の 4 interface を auditClassify.ts が消費し、production wiring は adapters.ts に集約 (Firebase admin SDK + @google-cloud/storage)。unit test は in-memory mock で 47 件全 PASS (実 Firebase 接続不要)、production 動作検証は dev rehearsal S2 stage で実施予定

### 教訓 (本セッション新規)

- **Codex MCP review は read-only Phase でも価値発見**: Phase A は "read-only audit" で destructive migration よりリスク低い前提だったが、Codex 1st review で BF22 違反 (orchestrator メモリ保持) という設計レベル指摘を発見。「scope が読みだけだから review 軽め」という安易な省略は危険。Quality Gate (TDD + evaluator + code-reviewer) を通過しても、impl-plan AC との **strict adherence** は別観点として独立 review すべき
- **AC strict adherence は impl-plan 段階で全文一致確認**: BF22 「全 chunk を一括メモリロードしない」を impl-plan 段階で「writer 側は 1000 docs/chunk で分割保存」と緩く解釈していたため、orchestrator 側の全 candidates 保持を見落とし。AC 表現が「全 ... しない」型の negative constraint は実装側で **どこで invariant が壊れうるか** を impl-plan 段階で書き出す必要あり (memory `feedback_ac_negative_constraint.md` 候補)
- **per-chunk streaming 設計の test 補完**: writer 関数を 2 分割 (`writePhaseAChunk` + `finalizePhaseAArtifact`) し orchestrator 側で buffer 管理する設計は、test 観点で「chunk 連番性」「順序 invariant」「最終 buffer flush」が writer 単体テストでは確認不能。orchestrator integration test で 1500/1200 件 streaming 確認を追加する必要あり、これを忘れると BF22 適合の証跡が test に残らない
- **大規模新規ディレクトリ (8 source + 5 test) でも 1 PR で完遂可能**: session71 教訓 (1500+ 行 S1 全体を 1 セッションで完遂しようとすると破綻) を踏まえ、S1-2 = Phase A のみに scope 絞込んで実装。13 files / +2220 行 / 47 tests でも TDD + evaluator + code-reviewer + Codex MCP 1st→2nd review で 1 セッション内 main merge まで完遂可能と確認。**スコープを「1 機能 1 phase」レベルまで絞ること**が安全な 1 セッション完遂条件

### 次セッション着手項目

1. `/catchup` で本 handoff + Issue #432 状態 + open Issue 確認
2. **PR-D4 S1-3 着手** (Phase B 実装、write-free preflight revalidation): Phase A artifact streaming read (chunk 単位 sha256 verify + chunked memory load) + 各 candidate について Firestore `updateTime` + GCS `generation`/`metageneration` を再照合し drift があれば skip + `MatchedByHash` の場合は parent 再 download + page selection で再 split → child sha256 と一致確認 (実 hash verify はここで実施)。output = `phase-b-revalidation-summary.json` + chunks + manifest 追記
3. **PR-D4 S1-4** (Phase C 実装、atomic backfill verified docs): Phase B artifact から `MatchedByHash + derived-bytes-verified` 候補のみを atomic batch write (provenance 10 fields + provenanceBackfill metadata)。GCS sentinel object 排他 lock + batch precondition failure doc 単位隔離 + global write rate limiter (BF16 / BF18 / BF23)
4. **PR-D4 S1-5** (Phase D 実装、verify + gate behavior): Phase C 書込 doc 全件再読込 + rotate gate test (derived-bytes-verified allow / child-snapshot-only reject)
5. **PR-D4 S1-6**: Dockerfile + `.github/workflows/pr-d4-backfill.yml` (workflow_dispatch + env/phase 選択)
6. **PR-D4 S1-7**: container build + push (dev で実行) → image tag 取得 (= S1 完了条件)
7. **PR-D4 S2-S7**: dev rehearsal 7-stage × 2 周 → Codex MCP 5th review GO 確認 → cocoro / kanameone 段階展開 (各 phase ユーザー番号認可)

---

<a id="session71"></a>
## ✅ session71 完了サマリー (2026-05-15: Issue #445 PR-D4 S1-1 基盤層 main merge `e487d4e` (PR #462) + Codex MCP 4th review 反映、Net 0)

session70 で確定した PR-D4 impl-plan v3.1 + ADR-0016 改訂を spec として、PR-D4 全体 (S1 Cloud Run Job container build + push 完了条件 image tag) のうち **S1-1 = 型 + factory + unit test の基盤層のみ** を実装。Phase A-D / Dockerfile / GitHub Actions workflow は別セッション (S1-2 以降) に defer。Codex MCP 4th review = GO with required amendments を取得し、High 1 + Medium 1 + Low 1 を本セッション内で全件反映 (Medium 2 = Phase C caller スコープに defer 明示)。

### 経緯

1. **catchup**: session70 handoff 確認、次セッション最優先 = PR-D4 dev rehearsal S1 着手を選択
2. **scope 絞込**: S1 全体 (Phase A-D + Dockerfile + workflow + build/push) は 1 セッションで収まらないため、**S1-1 = 基盤層 (型 + factory + test)** に scope を限定。Phase A-D 実装は別セッション
3. **feature branch 作成** (`feat/pr-d4-backfill-s1-foundation`): main 直 push 禁止 + commit 前ブランチ切替 (CLAUDE.md 4 原則 §4)
4. **TDD 実装**:
   - shared/types.ts: `ProvenanceBackfillMetadata` interface + `BackfillConfidence` (3 階層) + `BackfillClassifierCategory` (5 メンバー: PR-C3c classifier 4 + PR-D4 fallback `NeedsManualReview`) + `Document.provenanceBackfill?` optional field 追加
   - functions/test/provenance.test.ts: 15 cases テストファースト (RED)
   - functions/src/pdf/provenance.ts: `CreateBackfillProvenanceInput` + `createBackfillProvenance()` + `assertConfidenceEvidenceConsistency()` 実装 (GREEN)
   - test 33 passing 確認
5. **/simplify (3 並列 Agent: reuse / quality / efficiency)**:
   - Reuse: `BackfillClassifierCategory` の JSDoc「5 分類出力」記述が classifier (4 メンバー) と不一致 → fix
   - Quality / Efficiency: clean
6. **/safe-refactor**: HIGH/MEDIUM/LOW 0 件で対象外
7. **first commit (`ccb1aa4`)**: 3 files / +475/-4 / TDD + /simplify fix
8. **push + PR #462 作成** (`feat: PR-D4 S1-1 — backfill factory 基盤 + 15 tests (#445)`)
9. **CI 1 回目**: lint-build-test pass (6m11s) + CodeRabbit pass + GitGuardian pass
10. **/codex review (MCP 4th)** — Bash 版 timeout (stuck 20+ min) → MCP 版 short prompt で再試行 → **GO with required amendments** 取得
    - **High 1**: `provenanceFields.createdAt` 省略時に `createSplitProvenance` fallback `Timestamp.now()` が走り ADR Critical 2 違反 → compile-time (`Omit + Required`) + runtime guard 二重 enforce
    - **Medium 1**: `assertConfidenceEvidenceConsistency` の boolean check が truthiness (`!evidence.parentExists` 等)、TS bypass 経由で `parentExists: 1` 等の non-boolean truthy が素通り → 全 case で strict (`!== true` / `!== false`) に変更
    - **Medium 2**: classifierCategory ↔ confidence invariant 未強制 → **スコープ外** (Phase C caller = S1-4 で enforce、impl-plan §4.0 で dev fixture が Ambiguous→child-snapshot-only を意図的に許容)
    - **Low 1**: provenanceBackfill の null vs undefined 判定 → shared/types.ts JSDoc に「truthiness check 禁止 / field 存在チェック or `!= null` (loose) 推奨」明文化
11. **defense in depth test 4 件追加** (createdAt 省略 / parentExists=1 / childSha256ComputedAtBackfill="yes" / metadata-only=1): test 37 passing
12. **second commit (`56139c2`)**: 3 files / +117/-18 / Codex 4th 指摘全件反映
13. **CI 2 回目**: lint-build-test pass (5m59s)
14. **PR #462 squash merge** (ユーザー番号認可「PR #462 をマージしてよい」取得): `e487d4e` main merge、feature branch 自動削除、main 同期完了

### 変更ファイル一覧 (3 ファイル: 1 modified + 2 modified、合算 +574/-4)

| ファイル | 変更 |
|---------|------|
| `shared/types.ts` | +90/-0 (`ProvenanceBackfillMetadata` interface + `BackfillConfidence` + `BackfillClassifierCategory` 型 export + `Document.provenanceBackfill?` optional + Consumer 判定方法 JSDoc) |
| `functions/src/pdf/provenance.ts` | +162/-4 (import 拡張 + `CreateBackfillProvenanceInput` + `assertConfidenceEvidenceConsistency` strict boolean + `createBackfillProvenance` factory + runtime guard) |
| `functions/test/provenance.test.ts` | +326/-0 (`makeBackfillInput` / `makeBackfillFields` helper + 正常系 3 + 時刻 3 + sha256 lowercase 1 + validation 8 + defense in depth 4 = 19 cases) |

### Net 計測 (CLAUDE.md MUST)

- Before: open Issues = 4 (#432 P0 復旧待ち、#402 P2、#251 P2、#238 P2)
- After: open Issues = 4 (変化なし)
- 本 session 完了時点で **+0 / -0 = Net 0**
- 進捗判定: ✅ 構造的進捗 (Issue #432 復旧経路の **PR-D4 全実装の基盤層が main 確定**、Phase A-D 実装が後続セッションで安全に積み上げ可能に)

### 設計上の重要決定 (Codex 4th review 反映)

- **`createdAt` compile-time + runtime 二重 enforce**: `CreateBackfillProvenanceInput.provenanceFields` 型を `Omit<CreateSplitProvenanceInput, 'createdAt'> & { createdAt: Timestamp }` で必須化 + factory 内 runtime check (TS bypass 防御)。**ADR Critical 2 (split 完了時刻 ≠ backfill 実行時刻) を構造的に enforce**、`createSplitProvenance` の Timestamp.now() fallback が走る経路を閉鎖
- **strict boolean check (defense in depth)**: `evidence.parentExists !== true` / `childSha256ComputedAtBackfill !== true` (derived-bytes-verified case) / `!== false` (metadata-only case) で hostile input (TS bypass 経由 `1`, `"yes"`) を runtime block。**ADR Critical 6 (低 confidence を verified に昇格させない) を強化**
- **classifierCategory ↔ confidence invariant は Phase C caller に分離** (Medium 2 スコープ判定): factory level では両方を独立に受け取り、dev fixture が `Ambiguous → child-snapshot-only` を作成できる柔軟性を保つ。本番 Phase C (S1-4) で `MatchedByHash → derived-bytes-verified` のみ書込制約を caller 側で適用
- **null vs undefined Consumer contract**: `provenanceBackfill?` 型表面では `undefined` のみ allowed (`strictNullChecks` 下)、しかし Firestore 経由で `null` 混入可能性あり → Consumer は `'provenanceBackfill' in doc` または `!= null` (loose) で判定、truthiness check (`if (provenanceBackfill)`) は **使わない** (空オブジェクト判定の事故防止)

### 教訓 (本セッション新規)

- **Codex MCP review は本変更 (3 ファイル / +475 行) でも価値発見**: Quality Gate (TDD + /simplify + /safe-refactor) を通過した state でも、Codex 4th review が High 1 件 (createdAt 必須化抜け = ADR Critical 2 違反の温存) を発見。**factory pattern 採用時に既存 factory (createSplitProvenance) の optional field を継承するパターンは ADR 制約と矛盾しうるリスク**を構造的に確認。今後は新規 factory 追加時に「親 factory の optional field を派生先で必須化する必要があるか」を impl-plan / Codex review チェックリストに追加
- **Codex Bash 版が長時間 stuck 時の MCP 版 fallback**: Bash 版 codex CLI が 20+ 分 stuck (output 0 byte)、TaskStop → MCP 版 (`mcp__codex__codex`) を short prompt で再試行で正常応答。MCP 版も 1 回 timeout したが、prompt 簡素化 + read-only sandbox 明示で次の試行で成功。**Codex 経路は Bash → MCP → 諦めて PR 後追い の 3 段階 fallback** が運用パターンとして確立
- **大規模 stage の段階分解**: S1 (Cloud Run Job container build + push) を 1 セッションで完遂しようとすると Phase A-D 全実装 + Dockerfile + workflow + build/push = 1500+ 行コードで破綻。**S1-1 = 基盤層 (型 + factory + test) のみに scope 絞込** で commit 単位を小さく保ち、後続セッション (S1-2 〜 S1-7) を独立 PR で積み上げ可能に。impl-plan の stage 定義は完了条件であって 1 セッション分解の単位ではない、**実装着手時に sub-stage に分割して PR を分ける** ことを今後の destructive migration impl-plan 着手プロトコルに追加

### 次セッション着手項目

1. `/catchup` で本 handoff + Issue #432 状態 + open Issue 確認
2. **PR-D4 S1-2 着手** (Phase A 実装、read-only): `scripts/pr-d4-backfill/` ディレクトリ作成 + entry point (`index.ts`) + Phase A 本体 (audit + 5 分類 classify、現状 GCS state から再分類 = Codex 1st Critical 5 反映)。出力 = `phase-a-classify-summary-*.json` + chunking (1000 docs/chunk) + manifest + bucket location 確認 (Codex 2nd I2/I4 反映)
3. **PR-D4 S1-3〜S1-5**: Phase B (write-free preflight revalidation) → Phase C (atomic backfill + GCS sentinel lock + batch precondition failure doc 単位隔離) → Phase D (verify + rotate gate behavior、本番は read-only verification のみ)
4. **PR-D4 S1-6**: Dockerfile + `.github/workflows/pr-d4-backfill.yml` (workflow_dispatch + env/phase 選択)
5. **PR-D4 S1-7**: container build + push (dev で実行) → image tag 取得 (= S1 完了条件)
6. **PR-D4 S2-S7**: dev rehearsal 7-stage × 2 周 → Codex MCP 5th review GO 確認 → cocoro / kanameone 段階展開 (各 phase ユーザー番号認可)

---

session29-70 は `docs/handoff/archive/2026-04-history.md` / `docs/handoff/archive/2026-05-history.md` 参照。
