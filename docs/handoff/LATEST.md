# ハンドオフメモ

**更新日**: 2026-05-15 session72 (**Issue #445 PR-D4 S1-2 (Phase A read-only audit + classify) main merge `cc2616d` (PR #464) + Codex MCP 2nd review GO (BF22 strict adherence + bucket-location default 削除 + overwrite 禁止) 反映、Net 0**)。`scripts/pr-d4-backfill/` 新規ディレクトリ + types + 6 phase-a モジュール (artifactWriter / bucketLocationVerifier / categoryClassifier / docSnapshotter / auditClassify / adapters) + CLI entry (8 source files / 1165 行) + unit test 47 件追加。documents collection を全件 stream → 5 分類予測 → GCS artifact (main + chunks + manifest) JSON 書込 (read-only invariant)。BF22 適合のため orchestrator は per-chunk buffer (≤ 1000 件) のみ保持し flush 設計。`ifGenerationMatch: 0` で artifact overwrite 拒否、run-id 単位の partial failure invariant 確保。全 1198 tests passing (新規 47 + 既存 1151) / Quality Gate 全クリア (TDD + evaluator + pr-review-toolkit:code-reviewer + Codex MCP review 1st NO-GO → 2nd GO)。次セッション最優先: PR-D4 S1-3 (Phase B 実装 = write-free preflight revalidation) 着手
**ブランチ**: `main` (PR #464 squash merge `cc2616d` 完遂、feature ブランチ自動削除済。CI 全 green: CodeRabbit pass / GitGuardian pass / lint-build-test 6m39s pass)
**フェーズ**: Phase 8 + 運用監視基盤全環境展開完了 + (session29-66 累積実績は archive 参照) + **Phase 8 (session67 = PR-D1 / session68 = PR-D2 / session69 = PR-D3 完遂 + 3 環境展開 + #445 close / session70 = PR-D4 impl-plan + ADR 改訂 main merge / session71 = PR-D4 S1-1 基盤層 main merge / session72 = PR-D4 S1-2 Phase A 実装 main merge、Net 0)** = Issue #432 P0 collision の構造的予防 splitPdf + rotatePdfPages 双方で 3 環境稼働 + 既存 docs backfill の Phase A (read-only audit + classify) も main に確定 (Phase B-D 実装は後続セッション)

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

<a id="session70"></a>
## ✅ session70 完了サマリー (2026-05-14: Issue #445 PR-D4 impl-plan v3.1 + ADR-0016 改訂 main merge `1d369bf` (PR #460) + Codex MCP 4 段階 review GO 取得、Net 0)

session69 で取得した PR-D4 (既存 docs Provenance Backfill destructive migration) impl-plan 素案の Codex 1st review NO-GO (Critical 8 + Important 7 + 追加 AC BF8-15 + Phase A-D 改訂指針) を起点に、4 段階 review (1st → 2nd → 3rd → 4th) で Critical 0 + Important ≤ 2 達成、4th = **GO with required amendments** を取得。impl-plan v3.1 + ADR-0016 改訂を main merge し、destructive migration の正式 design 段階を完成。実装着手 (S1 Cloud Run Job container build 以降) は次セッション。

### 経緯

1. **catchup**: session69 handoff 確認、最優先タスク = PR-D4 正式 impl-plan 起票 (Codex 1st review NO-GO 反映必須) を選択
2. **ADR-0016 改訂 v1**: MUST 6 (provenanceBackfill 必須記録) + MUST 7 (既存 valid provenance immutable skip) 追加 + MUST 3 拡張 (rotate gate behavior) + SHOULD 1 改訂 (5 段階 classify + 4 phase 構造) + Implementation Roadmap PR-D4 行更新
3. **impl-plan v1 起票** (`docs/specs/pr-d4-backfill-impl-plan.md`、836 行): 13 章構成 + Phase A-D 詳細 + AC BF8-15 + フェルミ試算 + Cloud Run Job 採用 + lockfile gate + 50+ fixture + dev rehearsal 7-stage × 2 周 + 段階展開フロー
4. **Codex MCP 2nd review** (thread `019e2678-7f18-7a62-bab8-13cc98ca490c`、前 thread session 切れのため新規): **NO-GO**、Critical 4 (child-snapshot-only Phase C 矛盾 / lockfile gate 排他 lock 誤用 / batch retry doc 単位隔離 / consumer contract) + Important 8 + Low 3 + 追加 AC BF16-20 (5 件)
5. **impl-plan v2 改訂**: §4.0 Phase C 書込スコープ表 (本番=MatchedByHash の derived-bytes-verified のみ) + GCS sentinel object 排他 lock + batch precondition failure doc 単位隔離 + ADR Consumer contract 節新設 + Cloud Run Job spec 統一 (2 vCPU/4 GB/N=4) + 全 phase artifact GCS chunking + dev disposable fixture + BF16-20 追加
6. **Codex MCP 3rd review** (同 thread 継続): **NO-GO**、Critical 0 ✅ + Important 7 (GCS lock 解放 generation precondition / lease 60 min 挙動明確化 / null vs absent 表現統一 / Phase C rate limit 共通 token bucket / S6 rollback MUST 7 矛盾 / 本番手動 rotate 緩和 / BF22 全 phase chunking 拡張) + Low 3 + 追加 AC BF21-24 (4 件)
7. **impl-plan v3 改訂**: GCS sentinel lock generation precondition + 自動 takeover 禁止 + 手動解放手順 5 step (runbook 化) + null sentinel 不使用統一 + Firestore write 100-200/sec 共通 token bucket + S6 rollback fixture 限定 + 本番 read-only verification + BF21-24 追加
8. **Codex MCP 4th review (final)** (同 thread 継続): **GO with required amendments**、Critical 0 + Important 1 (BF22 本文反映薄) + Low 3 (§10 Step 2 古い記述 / Phase C "Storage 操作なし" 表現 / Phase C 手順番号 2 重)
9. **impl-plan v3.1 改訂**: §4.2-4.4 全 phase artifact chunking 本文具体化 + §4.3 step renumber + write 操作精緻化 + Status: Final
10. **PR #460 作成 + CI green + main merge** (ユーザー番号認可「PR #460 をマージしてよい」取得):
    - feature branch `feat/issue-445-pr-d4-impl-plan` 作成 → commit `d774612` → push → PR #460 (large tier、`Refs #445`)
    - CI: GitGuardian pass / CodeRabbit pass / lint-build-test 5m12s pass
    - `gh pr merge 460 --squash --delete-branch` → main squash merge `1d369bf`

### 変更ファイル一覧 (2 ファイル: 1 modified + 1 new、+895/-5)

| ファイル | 変更 |
|---------|------|
| `docs/adr/0016-document-identity-and-provenance.md` | +59/-5 (MUST 6/7 追加 + MUST 3 拡張 + SHOULD 1 改訂 + Status Amended + Roadmap PR-D4 行更新 + References 追記) |
| `docs/specs/pr-d4-backfill-impl-plan.md` | **新規 836 行** (13 章 + 11bis/ter/quater Codex review mapping、Phase A-D + AC BF8-24 17 件 + フェルミ + Cloud Run Job + GCS sentinel lock + dev rehearsal + 段階展開フロー) |

### Net 計測 (CLAUDE.md MUST)

- Before: open Issues = 4 (#432 P0 復旧確認待ち、#402 P2、#251 P2、#238 P2)
- After: open Issues = 4 (変化なし)。**#445 は session69 で auto-close 済、本 PR は #432 復旧の design 段階で復旧自体は PR-D4 実装後に判定**
- 本 session 完了時点で **+0 / -0 = Net 0**
- 進捗判定: ✅ 構造的進捗 (destructive migration の design 段階完成、4 段階 Codex review GO で実装着手準備完了)。既存 ~6,264 docs (kanameone 5,725 + cocoro 539) の rotate 復旧経路の正式設計が main 確定

### 設計上の重要決定

- **`provenanceBackfill` field 形状** (ADR MUST 6): method='legacy-observed' + confidence 3 階層 (`derived-bytes-verified` / `child-snapshot-only` / `metadata-only`) + backfilledAt + evidence 5 fields (parentExists / parentSha256MatchedAtBackfill / childSha256ComputedAtBackfill / backfillScriptVersion / classifierCategory)
- **意味論分離**: `provenance.createdAt` = split 完了時刻不変、`provenanceBackfill.backfilledAt` = backfill 実行時刻 (Codex 1st C2 反映、Issue #432 silent corruption 偽装復旧の永続化を防止)
- **Phase C 書込スコープ限定**: 本番は `MatchedByHash` の `derived-bytes-verified` のみ書込、`child-snapshot-only` は dev fixture 限定、`metadata-only` は原則禁止 + 明示 approval (Codex 2nd C1)
- **GCS sentinel object 排他 lock 採用** (Codex 2nd C2 反映、`scripts/lib/lockfileGate.ts` は package-lock 整合性のみで分散 lock 機能なし): 取得 generation 保存 + 解放時 `ifGenerationMatch:<acquiredLockGeneration>` precondition + lease 60 min 自動 takeover 禁止 + 手動解放手順 5 step (runbook 化、PR-D4 実装 PR で作成)
- **batch precondition failure doc 単位隔離** (Codex 2nd C3 反映): batch 全体失敗時に doc 単位 individual update に分解、drift doc のみ `preconditionFailedDocs` 隔離、残り書込継続 (1 件 drift で 19 件巻き込まない)
- **immutable skip field existence 判定** (Codex 3rd I3 反映、Codex 1st C8): `provenance` field exists && `provenanceBackfill` field absent (Firestore で `undefined`) で判定、null sentinel 不使用 (PR-D2/D3 後 verified provenance を低信頼度 backfill で破壊禁止)
- **Cloud Run Job spec 保守的初期** (Codex 2nd I3 反映): 2 vCPU / 4 GB memory / N=4 並行 / Firestore write 100-200/sec 共通 token bucket (impl-plan v1 の 8 vCPU/32 GB は dev rehearsal 実測値で昇格判断)
- **本番 cocoro/kanameone は read-only verification のみ** (Codex 3rd I6 反映): rotate 実 API 検証は dev disposable fixture と CI contract test で担保、本番 doc に rotate side effect を残さない
- **`provenance` Consumer contract** (ADR MUST 6 Consumer contract、Codex 2nd C4 反映): 全 consumer は `provenanceBackfill` 存在を必ず確認、`provenance` 単独で「verified split-time origin」と判定禁止、contract test (BF20) で構造的検証

### 反映を defer した項目

- **PR-D4 実装着手** (S1 Cloud Run Job container build 以降): 別 PR で次セッション
- **dev rehearsal 7-stage × 2 周**: PR-D4 実装 PR の中で実施 (S2-S5 = Phase A-D / S6 = fixture 限定 rollback / S7 = 統合確認)
- **runbook 文書** (`docs/runbooks/pr-d4-backfill-runbook.md`): PR-D4 実装 PR で新規作成 (GCS sentinel lock 手動解放手順 5 step + Phase A-D 各 step 操作手順)

### 次セッション着手項目 (優先順)

1. **catchup** (次セッション、本 session70 handoff 確認)
2. **PR-D4 dev rehearsal S1 着手 (Cloud Run Job container build + push)** ★最優先
   - `functions/src/pdf/provenance.ts` に `createBackfillProvenance()` factory + `assertValidBackfillProvenanceInput()` + `BackfillConfidence` 型 追加 (BF20 helper `isVerifiedOrigin(doc)` も export)
   - `shared/types.ts` に `ProvenanceBackfillMetadata` interface 追加 + `Document` interface 拡張
   - Cloud Run Job container 設計 (`functions/src/scripts/pr-d4-backfill/` 新規ディレクトリ、Phase A/B/C/D 各 entry point)
   - GCS sentinel lock utility (`functions/src/scripts/pr-d4-backfill/lib/gcsSentinelLock.ts` 新規、取得 + 解放 generation precondition + lease 60 min)
   - 50+ fixture 拡張 (`scripts/fixtures/pr-d4/`)
   - rotate gate 拡張 (`functions/src/pdf/pdfOperations.ts` の `rotatePdfPages` legacy guard を `provenanceBackfill` 検査に拡張)
   - dev rehearsal S2-S7 実行 → Codex MCP 5th review (実装 PR 単位) → 2 周目 → PR 作成
3. (期間運用継続) **既存 docs rotation 不可期間**: PR-D4 実装完了まで dev/cocoro/kanameone 既存 docs (~6,264 件合計) は rotation 操作が `failed-precondition` で reject される。ユーザー影響 = rotation 機能のみ (split は不変)
4. (option) **PR-D5 (TypeScript 型 + lint 強化) impl-plan**: PR-D4 完了後の判定 (Codex 4th Q7、Issue #432 close は PR-D4 完遂後 + 残件 Issue 切出 + #432 に residual risk + coverage artifact 貼付)

### 主要 PR / 実行記録

| 項目 | 値 |
|---|---|
| **本 PR (PR-D4 design)** | **PR #460 merged** (squash commit `1d369bf`、1 commit `d774612`、2 files +895/-5) |
| Codex MCP thread (4 段階 review) | 1st: `019e2558-f83f-7a13-aadd-0eab042fd949` / 2nd-4th: `019e2678-7f18-7a62-bab8-13cc98ca490c` |
| Codex 4th 結論 | **GO with required amendments** (Critical 0 + Important 1 + Low 3、本 PR で全件反映) |
| ADR-0016 Status | Accepted (session69) → Amended (session70 = PR-D4 design 反映) |
| Issue Net | **0** (Before 4 → After 4) |
| 構造的進捗 | destructive migration design 段階完成、Codex 4 段階 review GO で次セッション実装着手準備完了 |

### 教訓 (本 session70)

- **destructive migration は AI 単独 impl-plan でも Codex 4 段階 review が必要なケース**: 本 PR で 1st NO-GO → 2nd NO-GO → 3rd NO-GO → 4th GO までかかった。Critical 1st 8 → 2nd 4 → 3rd 0 + Important 1st 7 → 2nd 8 → 3rd 7 → 4th 1 と段階的に潰せた。memory `feedback_destructive_migration_codex_review` の有効性が 2 例目 (PR-D4 計画) で実証 + 4 round 必要性も判明
- **Codex MCP thread session 切れ対応**: 1st review thread `019e2558` は session 切れで継続不可、2nd 以降は新 thread `019e2678` で実施。AI 単独で「1st の Critical 8 + Important 7 全件サマリー」を catchup から復元できたため大過なし、ただし thread 継続性に依存する設計は脆い (memory 化候補)
- **AskUserQuestion + dev rehearsal 着手認可フロー**: ユーザー単一質問で「dev rehearsal 着手 (本日 / 次セッション)」を取得 → 本 session で impl-plan + ADR commit + main merge までを実施、実装着手は次セッションに分離。クリーンな分離点
- **GCS sentinel object 排他 lock vs `scripts/lib/lockfileGate.ts`** の用語混同回避 (Codex 2nd C2): 既存 lockfileGate.ts は package-lock 整合性のみで分散 lock 機能なし。本 PR-D4 で初めて分散 lock を導入し、GCS sentinel + generation precondition + 手動解除手順で正式実装

---

<a id="session69"></a>
## ✅ session69 完了サマリー (2026-05-14: Issue #445 PR-D3 完遂 + PR #458 main merge `aa61fb6` + dev E2E PASS + cocoro/kanameone 本番展開 + Issue #445 close、Net -1)

session68 (PR-D2 完遂、PR #456 main merge `cb8d94a`) で splitPdf 側に確立した provenance 10 fields + atomic batch pattern を、rotatePdfPages に展開。ADR-0016 MUST 3 (rotation in-place 編集禁止 + callable 内 delete 完全撤廃) を実装し、Issue #432 P0 collision の構造的予防を splitPdf + rotatePdfPages 双方で完成させた。

### 経緯

1. **catchup**: session68 handoff 確認、次セッション着手項目から PR-D3 (Issue #445 forward-only) を選択 (dev E2E AC9 は AI 単独完遂困難 + kanameone/cocoro 本番展開は destructive で番号認可必須のため除外)
2. **`/impl-plan`**: T0-T6 タスク分解 + AC1-AC9 + 統合影響分析 + 設計判断 4 件 (path 命名規則 / provenance 更新セマンティクス / delete 撤廃 / AccumulatedSegment 統合) — ADR-0016 MUST 3 で 3 件は確定済、AccumulatedSegment は rotation で accumulate 不要のため対象外
3. **T0 Codex MCP impl-plan 1st セカンドオピニオン** (thread `019e2383-5a67-73d0-ac75-61afb212b90d`):
   - HIGH 4: ADR MUST 3 整合性違反 (案 X path 固定 + 新 generation 上書きは ADR 文面違反) / Storage Versioning 依存 / concurrent write 検出不十分 (3-stage snapshot だけでは不足、Firestore transaction + GCS `ifGenerationMatch` 必要) / エッジケース見落とし (legacy provenance / Storage save 後 commit 失敗 / 空配列 / 重複)
   - MEDIUM 3: AC1 文言不整合 (derivedObjectPath 不変) / grep contract 拡張 / PR-C3c gate 整合性 (sourceSha256 不変テスト必須)
   - LOW 1: `/review-pr 6 並列` やや過剰
   - **設計判断 case X → 案 Y' 切替を強く勧告** (新 path `processed/{docId}/rotations/{rotationId}.pdf`)
4. **ユーザー判断**: 案 Y' へ切替確定 (Recommended、ADR 整合 / versioning 依存解消 / commit 失敗 rollback 容易 / derivedObjectPath AC1 原文一致)
5. **T1-T4 実装**:
   - T1: `provenance.ts` に `createRotationProvenance()` + `assertValidRotationProvenanceInput()` + `CreateRotationProvenanceInput` 型 追加 (10 fields 全入力、source 5 + createdAt は base、derived 4 は newDerived、型表面で sourceSha256 上書き不可)
   - T2: `pdfOperations.ts` の `rotatePdfPages` を全面 refactor (~170 → ~270 行)。8 step (auth → 入力 validation → snapshot + legacy guard → identity drift 検証 + download → PDF load + rotation → 新 path save → metadata + sha256 → provenance build → optimistic locking commit) + 3 helper (`rollbackOrphanRotation` / `mergeRotations` / `unwrapErrorMessage` / `RotationDegrees` / `normalizeRotation` / `normalizeRotationOrFallback`)
   - T3: `rotationProvenance.test.ts` 新規 (33 件、AC1/2/6/14 + mergeRotations 3 branch + sourceMetageneration negative) + `rotatePdfPagesContract.test.ts` 新規 (27 件 grep contract、AC3/4/11/12/13 + 識別性 drift 検証 AC15/16 + 3-way error-code + 入力 validation 事前)
   - T4: ADR-0016 Status: Proposed → Accepted + MUST 3 詳細化 (canonical path 規約 + rollback 例外解釈補足) + data-model.md rotation lifecycle 行修正 (source 5 + createdAt 不変)
6. **T5 6 段階品質ゲート全通過**:
   - **Gate 1 (Codex impl-plan 1st)**: 上記 HIGH 4 + MEDIUM 3 + LOW 1 全件反映
   - **Gate 2 (/simplify 3 並列)**: HIGH 3 (mergeRotations `as` キャスト 4 連 → `normalizeRotation` runtime 検証 / `CleanableStorageFile` reuse / `runTransaction` → `docRef.update(payload, { lastUpdateTime })` precondition で SDK 自動 retry 回避 + TOCTOU race-free + 1 read 節約) + M1 (`unwrapErrorMessage` helper で 5 連 try-catch 簡素化) 反映
   - **Gate 3 (/safe-refactor)**: LOW 1 (gRPC code judge の safety comment 追加) 反映
   - **Gate 4 (Evaluator 分離 REQUEST_CHANGES)**: CRITICAL Q1 (gRPC error code 型保証なし → 3 系統 OR 判定: 数値 code 9/5 + 文字列 code 'failed-precondition'/'not-found' + error.message regex 全防御) + HIGH Q2 (pageRotations 既存値破損で全 rotation abort = 破壊的変更 → 二段階方針: 既存 = warn + 0 fallback / 新規 = strict / 累積 = strict) + MEDIUM (fileUrl.replace 直書き → parseGcsUri で bucket mismatch 検出付き防御強化) 全反映
   - **Gate 5 (/review-pr 5 並列)**: Critical 5 (mergeRotations 累積 strict 化 / rollback details `rollbackFailed` flag + orphanObjectPath / "source 6" 用語不整合 → "source 5 + createdAt" / mergeRotations unit test 追加 9 件 / shared/types.ts L132 docstring 修正 PR-D3 矛盾) + Important 4 (3-way error-code grep contract 拡張 / sourceMetageneration negative case / `assertValidRotationProvenanceInput` で base 9 fields 検証 = defense in depth / pageNumber/degrees 事前 validation で PDF download 前 reject) 反映。`mergeRotations` を `rotationMerge.ts` に切出 (Firebase admin 非依存、test 直接 import 可能化)。`rollbackOrphanRotation` 戻り値型を `RollbackResult` type alias に分離 (extraction logic 互換)
   - **Gate 6 (Codex MCP 2nd セカンドオピニオン)**: MEDIUM (fileUrl ↔ baseProvenance.derivedObjectPath path 一致検証 + download buffer sha256 ↔ derivedSha256 bytes 一致検証で Issue #432 root cause 再発リスク = identity drift で別 object を rotate しつつ provenance source を保持する silent corruption を構造的に排除、AC15/AC16 として記録) + LOW (rotationProvenance.test.ts 冒頭コメント "source 6" drift) 反映 → **APPROVE**
7. **Net 計測** (CLAUDE.md MUST):
   - Before: open Issues = 5 (#445 P1、#432 P0 復旧確認待ち、#402 P2、#251 P2、#238 P2)
   - After: open Issues = 4 (#432 / #402 / #251 / #238)。**#445 は PR #458 main merge の commit body `Closes #445` で auto-close 達成**
   - 本 session 完了時点で **+0 / -1 = Net -1**
   - 進捗判定: ✅ 正の構造的進捗 (Net 減 + 3 環境本番稼働)。Issue #432 (P0) collision の構造的予防が splitPdf + rotatePdfPages 双方で dev/cocoro/kanameone 3 環境稼働開始 (新規クライアント等価運用基盤の構造的予防完了)

### 変更ファイル一覧 (11 ファイル: 8 modified + 3 new)

| ファイル | 変更 |
|---------|------|
| `functions/src/pdf/provenance.ts` | +~120 行 (createRotationProvenance factory + assertValidRotationProvenanceInput + CreateRotationProvenanceInput 型、defense in depth で base 9 fields 検証) |
| `functions/src/pdf/pdfOperations.ts` | +~200/-87 行 (rotatePdfPages 全面 refactor、8 step + 3 helper、4 系統 OR error judge、identity drift 検証) |
| `functions/src/pdf/rotationMerge.ts` | **新規 ~95 行** (RotationDegrees / normalizeRotation / normalizeRotationOrFallback / mergeRotations、Firebase admin 非依存 = test 直接 import 可能化) |
| `shared/types.ts` | DocumentProvenance docstring 修正 (AC14 整合、PR-D3 矛盾解消) |
| `functions/test/rotationProvenance.test.ts` | **新規 ~440 行** (33 件、provenance factory unit + mergeRotations unit + sourceMetageneration negative + base defense in depth) |
| `functions/test/rotatePdfPagesContract.test.ts` | **新規 ~250 行** (27 件 grep contract、AC3/4/11/12/13 + AC15/16 identity drift + 3-way error-code + 入力 validation) |
| `functions/test/storageDeletionGuard.test.ts` | rotatePdfPages entry を構造化ログ grep loop から除外 (PR-D3 で delete 経路撤廃、deleteDocument 側は維持) |
| `functions/test/splitPdfProvenanceContract.test.ts` | import grep regex 緩和 (`createRotationProvenance` 併記許容) |
| `functions/test/storagePathExtraction.test.ts` | rotatePdfPages entry を `parseGcsUri` 期待に変更 |
| `docs/adr/0016-document-identity-and-provenance.md` | Status: Proposed → **Accepted** + MUST 3 詳細化 (canonical path 規約 `processed/{docId}/rotations/{rotationId}.pdf` 明文化 + rollback 例外解釈補足) + Implementation Roadmap PR-D3 ✅ 完遂行 |
| `docs/context/data-model.md` | rotation lifecycle 行修正 (`derived 4 fields のみ更新 / source 5 + createdAt 不変`) |

### Acceptance Criteria 完遂状況 (AC1-AC16)

| AC | 内容 | 状況 | 検証手段 |
|----|------|------|---------|
| AC1 | provenance derived 4 fields update | ✅ | rotationProvenance.test.ts unit |
| AC2 | source 5 + createdAt 不変 (6 fields preserve) | ✅ | unit test (before/after 比較 + 100 chain) |
| AC3 | `.delete(` / `canSafelyDeleteStorageFile` / `_r${timestamp}` grep 0 件 | ✅ | rotatePdfPagesContract.test.ts |
| AC4 | rotation 結果 `processed/{docId}/rotations/{rotationId}.pdf` | ✅ | grep contract |
| AC5 | concurrent write で `HttpsError('aborted')` | ⏳ UNTESTABLE | grep contract (3-way OR judge) + dev E2E / emulator integration defer |
| AC6 | provenance runtime validation で `ProvenanceValidationError` | ✅ | unit test (15+ ケース) |
| AC7 | 既存 splitPdf 系テスト pass | ✅ | npm test 1132 件全 pass |
| AC8 | ADR-0016 Accepted + data-model.md 修正 | ✅ | git diff |
| AC9 | dev E2E (実 rotation + Firestore Console / Storage Console 目視) | ⏳ | **次セッション (手動)** |
| AC10 | 同 docId 並行 rotation で aborted | ⏳ UNTESTABLE | grep contract (lastUpdateTime + 3-way error) + emulator integration defer |
| AC11 | Storage save 後 commit 失敗時 orphan rollback + `HttpsError('internal')` | ✅ | grep contract + `rollbackFailed` details flag |
| AC12 | legacy provenance 無し doc を `failed-precondition` で reject | ✅ | grep contract |
| AC13 | 入力 validation (空配列 / 重複 / 範囲外 / 非整数 pageNumber / 非90倍数 degrees) | ✅ | grep contract + PDF download 前 early abort |
| AC14 | sourceSha256 を rotation で絶対更新しない (型 + 値) | ✅ | unit test (型レベル keys + 100 chain 値レベル) |
| **AC15 (Codex 2nd 追加)** | fileUrl ↔ provenance.derivedObjectPath path 一致検証 | ✅ | grep contract |
| **AC16 (Codex 2nd 追加)** | download buffer sha256 ↔ derivedSha256 bytes 一致検証 | ✅ | grep contract |

### 設計上の重要決定

- **`AccumulatedSegment` discriminated union 化 PR-D2 defer 分**: rotation で accumulate 不要のため PR-D3 でも統合せず、別 follow-up Issue 化候補
- **rollbackOrphanRotation の ADR-0016 MUST 3 例外解釈**: 「callable 内で生成し未 commit な orphan object の rollback delete は ADR 禁止対象外 (自己生成 + 外部公開前 + 他 doc 参照不可能のため、ADR が予防対象とする同 path 共有 docs の物理破壊が原理的に発生しない)」を ADR に明文化
- **identity drift 検証の Issue #432 root cause 再発リスク対応**: Codex 2nd で発見、fileUrl と provenance.derivedObjectPath / derivedSha256 の path + bytes 二重検証で「stale fileUrl で別 object を rotate しつつ provenance source を保持する silent corruption」経路を構造的に閉鎖。AC15/16 として grep contract に lock-in
- **二段階方針 (Evaluator HIGH Q2)**: 既存破損データ (45 度等の非 90 倍数) を warn + 0 fallback で recover、新規 user input は strict 検証。累積は両者 90 倍数なので strict 検証で safe (silent-failure-hunter CRITICAL 1 反映)

### 反映を defer した項目 (follow-up Issue 化候補)

- **review-thread reference labels の rot リスク**: `// Codex HIGH 3:` `// Evaluator CRITICAL Q1:` 等の identifier 削除 (cosmetic 大量変更、本 PR scope 外)
- **`// Step N: ===` 区切りコメント整理**: rotatePdfPages 関数を 6 helper に分解する大規模 refactor (smell ありだが本 PR scope 上限)
- **DocumentProvenance branded type 化** (type-design-analyzer 長期推奨): caller が未検証 base を直接 Firestore から読み込んで渡せる経路を型レベルで完全排除 (現状は assertValidRotationProvenanceInput で base 検証 = defense in depth)
- **RotationDegrees を shared/types.ts に昇格**: PR-D5 で TypeScript 型 + lint 強化と統合
- **bracket counter sentinel assertion**: rotatePdfPagesContract.test.ts の extraction logic 脆弱性 (string literal / regex 内 `(`/`)` で誤動作リスク)、現状動作問題なし
- **pdf-lib `getRotation().angle` vs Firestore `pageRotations` 値の同期保証**: 既存設計由来、PR-D3 で新規導入したわけではない
- **emulator integration test (AC5 / AC10 lock-in)**: 既存方針 (splitPdfIntegration.test.ts と同パターン) に従い別 integration test PR で実装
- **GCS Object Lifecycle rule** (rotations subdirectory の 7 日経過 + Firestore 参照無し object 自動削除): rollback 失敗時 manual cleanup 撤廃、別 infra PR

### 次セッション着手項目 (優先順、本 session69 補追記反映後)

1. **catchup** (次セッション、本 session69 handoff 確認)
2. **PR-D4 (既存 docs backfill) 正式 impl-plan 起票** — destructive migration、Codex MCP 1st review NO-GO + Critical 8 (legacy backfill 再構成不能 / `createdAt` 意味破壊 / Phase B-C 分離不能 / child identity 検証弱 / 既被害 skip 根拠不足 / backfill 後 rotate 副作用 / Phase A→write drift gate 不足 / 既存 provenance 上書きリスク) + Important 7 + 追加 AC BF8-BF15 + Phase A-D 改訂指針 全反映必須。`docs/specs/pr-d4-backfill-impl-plan.md` 正式起票 → ADR-0016 修正 (legacy backfill provenance 信頼度分離 + `backfilledAt` 追加 + `derivedObjectPath` legacy path 明記) → Phase A audit script 設計 → fixture 拡張 50+ → Cloud Run Job 採用検討 → dev rehearsal 7-stage 1 周目 → Codex 2nd review → 2 周目 → PR-D4 PR 作成 → cocoro 539 docs backfill → kanameone 5,725 docs backfill。Codex thread `019e2558-f83f-7a13-aadd-0eab042fd949` 継続
3. (option) **PR-D5 (TypeScript 型 + lint 強化) impl-plan** — fileName identity 旧コードパス禁止 (ADR-0016 MUST 4)、`provenance?` → required 型格上げ (ADR-0016 MAY 1)、RotationDegrees を shared/types.ts に昇格
4. (option) **follow-up reuse/efficiency PRs** (PR-D3 defer 項目): review-thread reference labels rot 整理 / Step N 区切りコメント整理 / DocumentProvenance branded type / bracket counter sentinel / pdf-lib `getRotation().angle` sync / emulator integration test (AC5/AC10) / GCS Object Lifecycle rule (rotations subdirectory 7 日経過 + 参照無し自動削除)
5. (期間運用) **既存 docs rotation 不可期間**: PR-D4 完了まで dev/cocoro/kanameone 既存 docs (~6,264 件合計) は rotation 操作が `failed-precondition` で reject される。ユーザー影響 = rotation 機能のみ (split は不変)、PR-D4 backfill 完了で復帰

> 注: session69 で完了済 (本セッション補追記参照): PR #458 main merge / dev E2E (PR-D2 AC9 + PR-D3 AC9/15/16) / cocoro 本番展開 (Functions+Hosting) / kanameone 本番展開 (Functions+Hosting) / Issue #445 close (Net -1) / PR-D4 Codex 1st review NO-GO 取得。本番展開後の動作確認は `feedback_deploy_proactive_verification` (4 原則 §1) に従い AI から能動依頼しない。

### 補追記 (session69 後半: PR-D3 main merge + dev E2E + 3 環境展開 + PR-D4 Codex 1st review)

session69 前半 (PR-D3 実装 + 6 段階品質ゲート + ローカル変更まで) に続き、`/catchup` 再開後の作業内容:

1. **PR #458 作成 + CI 全 green + main merge**
   - feature branch `feat/issue-445-pr-d3-rotate-pdf-pages` 作成 (CRITICAL: main 直 push 禁止、commit 段階で feature branch)
   - 12 ファイル / +1,323/-130 commit `d0b381e` → push → PR #458 作成 (large tier、`Closes #445` 含む)
   - CI: lint-build-test ✅ (5m17s) / GitGuardian ✅ / CodeRabbit 非ブロッキング
   - ユーザー番号認可「PR #458 をマージしてよい」取得 → `gh pr merge 458 --squash --delete-branch` → main squash merge `aa61fb6`
   - Issue #445 auto-close 達成 (`Closes #445` 反応)

2. **dev デプロイ + dev E2E (PR-D2 AC9 + PR-D3 AC9/15/16) PASS**
   - main push → GitHub Actions Deploy workflow ✅ success (自動)
   - Playwright MCP 経由で `https://doc-split-dev.web.app` にアクセス (既ログイン状態保持)
   - **PR-D3 AC9 (legacy doc rotation reject)**: 既存 doc 介護保険被保険者証.pdf (`fvFiHrYimCvgw4zj9cc5`、provenance 未設定) で rotation 90° + 「このページのみ保存」→ HTTP 400 + `Document is missing provenance fields; backfill required (Issue #445 PR-D4) before rotation` で reject。Issue #432 silent corruption 構造的予防動作確認 ✅
   - **PR-D2 AC9 (新 split で provenance 10 fields 必須)**: 同元 doc を「ページ 1 の後で分割」→ 「分割を実行」→ 全書類 3 → 4 件に増加、元 doc status: 完了 → 分割済。新 child doc `kgn8iMBBxIxnUl1kZtmW` (page 1) を Firestore REST API `:runQuery` で取得 (ユーザー番号認可「dev Firestore read OK」/「A」)、provenance 10 fields 全存在を確認: `createdAt` `2026-05-14T07:36:54.798Z` / `derivedGeneration` `1778744214728703` / `derivedMetageneration` `1` / `derivedObjectPath` `processed/kgn8iMBBxIxnUl1kZtmW/20260514_未判定_未判定_p1.pdf` (canonical docId namespace) / `derivedSha256` `0c500c20...22fd78be` (hex 64) / `sourceBucket` / `sourceGeneration` `1773284718296850` / `sourceMetageneration` `2` / `sourcePath` `original/upload_1773284709869_20230926_Careplan_leaflet.pdf` / `sourceSha256` `f91a0b59...5bbd003be` ✅
   - **PR-D3 AC9 + AC15/16 (rotation 成功経路、provenance 付き doc)**: 上記 child doc `kgn8iMBBxIxnUl1kZtmW` に対し rotation 90° + 「このページのみ保存」実行 → 0 console errors、Firestore で `provenance.derivedObjectPath` が **canonical rotation path** `processed/kgn8iMBBxIxnUl1kZtmW/rotations/b2456e9a-edfa-42a6-b857-76df1dfd3cc7.pdf` に更新 (期待形式 `processed/{docId}/rotations/{rotationId}.pdf` 完全一致 ✅) + `derivedGeneration` / `derivedSha256` 新値 + **`provenance.createdAt` 不変保証 `2026-05-14T07:36:54.798Z` 維持** (rotation 時刻 9:11 と不一致 = 不変) + source 5 fields (sourceBucket/Generation/Metageneration/Path/Sha256) 全不変 + `rotatedAt` 記録 ✅

3. **cocoro 本番展開 (Step 1、ユーザー認可「cocoro 本番展開してよい」相当)**
   - Functions: `gh workflow run "Deploy Cloud Functions" -f environment=cocoro` (run `25856730001`) ✅ success
   - Hosting (cocoro 手動手順、deploy skill SKILL.md 準拠): `cp frontend/.env.cocoro frontend/.env.local` → `npm run build` → `firebase deploy --only hosting -P cocoro` → release complete `https://docsplit-cocoro.web.app`
   - 後片付け: `rm frontend/.env.local` / `./scripts/switch-client.sh dev` / `firebase login:use hy.unimail.11@gmail.com` (既状態)

4. **kanameone 本番展開 (Step 2、ユーザー認可「進めて」相当)**
   - Functions: `gh workflow run "Deploy Cloud Functions" -f environment=kanameone` (run `25858108201`) ✅ success
   - Hosting: `firebase login:use systemkaname@kanameone.com` → `./scripts/switch-client.sh kanameone` → **環境変数 override 発見** (`CLOUDSDK_ACTIVE_CONFIG_NAME=doc-split` が .envrc 経由で固定、Claude Code Bash の direnv 未 hook 仕様により switch-client.sh active config file は kanameone に書換完了するが env var が古いまま) → `CLOUDSDK_ACTIVE_CONFIG_NAME=kanameone ./scripts/deploy-to-project.sh kanameone` で明示指定して deploy-to-project.sh の認証チェック通過 → release complete `https://docsplit-kanameone.web.app`
   - 後片付け: `firebase login:use hy.unimail.11@gmail.com` / `./scripts/switch-client.sh dev` / `rm frontend/.env.local` (`deploy-to-project.sh` は cleanup しない仕様確認、手動削除必要)

5. **PR-D4 (既存 docs backfill destructive migration) impl-plan 素案 + Codex 1st review NO-GO**
   - Plan agent で素案策定 (Phase A read-only audit / Phase B provenance-only backfill / Phase C derivedObjectPath 記録 / Phase D 物理 rewrite defer / フェルミ試算 6,264 docs × 2 MB ~$1-2/client / dev rehearsal 7-stage × 2 周 / 8 弱点候補質問 / MUST-SHOULD-MAY 分類)
   - Codex MCP 1st review (thread `019e2558-f83f-7a13-aadd-0eab042fd949`、`feedback_destructive_migration_codex_review` 教訓に準拠): **NO-GO**。Critical 8 件 (legacy backfill は本来の provenance 再構成不能 / `createdAt` 意味破壊 / Phase B/C 分離不能 → 統合必須 / child object identity 検証弱 / Issue #432 既被害 skip list 根拠不足 / backfill 後 rotate gate 突破副作用 / Phase A→write drift gate 不足 / 既存 valid provenance 上書きリスク) + Important 7 件 (Cloud Run Job 推奨 / child provenance lib 必要 / `derivedObjectPath` 型コメントと legacy path 矛盾 / lockfile gate 判断 / fixture 28 件不足 / rate limit 多次元 / write summary artifact 化) + 追加 AC BF8-BF15 + Phase 改訂 (A=audit + classify / B=write-free preflight revalidation / C=atomic backfill verified docs / D=verify + gate behavior / 物理 rewrite=別 PR-D5+) + フェルミ修正トリガー 7 件 (p95 parent > 20MB / download > 25GB/client / computable < 50% 等)
   - 次セッション着手: 上記 NO-GO 指摘全件反映で正式 impl-plan 起票

### 補追記 教訓 (本 session69 後半)

- **direnv 経由の `CLOUDSDK_ACTIVE_CONFIG_NAME` env var override**: Claude Code Bash は毎回新規サブシェルで direnv hook 未発火。`switch-client.sh` 実行時に file (`~/.config/gcloud/active_config`) は書換るが env var は古いまま。`CLOUDSDK_ACTIVE_CONFIG_NAME=<env> ./scripts/deploy-to-project.sh <env>` で明示指定が安全。memory 化候補 = `feedback_direnv_env_var_in_bash_subshell.md`
- **deploy-to-project.sh は .env.local cleanup しない**: cocoro 手動手順は `rm frontend/.env.local` 明示済だが、kanameone deploy-to-project.sh 経由でも `.env.local` 残存 (build 用 env を最終クライアント値で残してしまう情報漏洩リスク)。デプロイ後の cleanup チェックリストを deploy skill SKILL.md の「後片付けチェックリスト」項目 1 で再確認、手動削除必須
- **PR-D4 destructive migration の Codex セカンドオピニオン有効性 (再確認)**: PR-C (2026-05-11) 時と同様、AI 単独 impl-plan で「legacy backfill provenance 再構成不能」「`createdAt` 意味破壊」「Phase B/C 分離不能」「既被害 skip 根拠不足」等の Critical 級欠陥を全て見落とした。memory `feedback_destructive_migration_codex_review` の有効性が 2 例目で実証。destructive PR の AskUserQuestion 前 Codex MCP 必須化を継続

### 主要 PR / 実行記録 (本 session69 補追記)

| 項目 | 値 |
|---|---|
| **本 PR (PR-D3)** | **PR #458 merged** (squash commit `aa61fb6`、1 commit `d0b381e`、12 files +1,323/-130) |
| Issue #445 close | auto-close via `Closes #445` in commit body |
| dev デプロイ | main push trigger、GitHub Actions Deploy ✅ |
| cocoro Functions deploy | run `25856730001` ✅ |
| cocoro Hosting deploy | manual `firebase deploy --only hosting -P cocoro` ✅ |
| kanameone Functions deploy | run `25858108201` ✅ |
| kanameone Hosting deploy | `CLOUDSDK_ACTIVE_CONFIG_NAME=kanameone ./scripts/deploy-to-project.sh kanameone` ✅ |
| dev E2E PR-D2 AC9 (split provenance 10 fields) | ✅ child doc `kgn8iMBBxIxnUl1kZtmW` で全 fields 確認 |
| dev E2E PR-D3 AC9 (legacy doc rotation reject) | ✅ 元 doc `fvFiHrYimCvgw4zj9cc5` で `failed-precondition` 確認 |
| dev E2E PR-D3 AC15/16 (canonical rotation path + identity drift) | ✅ child doc `kgn8iMBBxIxnUl1kZtmW` で `processed/{docId}/rotations/{rotationId}.pdf` 確認 |
| Codex MCP thread (PR-D4 impl-plan 1st review) | `019e2558-f83f-7a13-aadd-0eab042fd949` (NO-GO、Critical 8 + Important 7 + AC-BF8-15 + Phase 改訂) |
| Issue Net | **-1** (#445 close、Before 5 → After 4) |

---

<a id="session68"></a>
## ✅ session68 完了サマリー (2026-05-14: Issue #445 PR-D2 完遂、splitPdf provenance 10 fields 実装 + 5 段階品質ゲート + main merge `cb8d94a`、Net 0)

session67 (PR-D1 完遂、PR #454 main merge `e21eabe`) で確立した ADR-0016 設計合意 (DocumentProvenance 10 fields interface + Firestore schema) を実装フェーズへ移行。`splitPdf` callable を retry loop + 3-stage source snapshot + accumulate + final drift check + atomic batch.commit に refactor し、新規分割 PDF が常に provenance 10 fields を持つよう構造的に保証。

### 経緯

1. **catchup**: session67 handoff 確認、次セッション着手項目から PR-D2 (Issue #445 forward-only) 選択 (kanameone/cocoro 本番展開は destructive で番号認可必須のため別 PR 建て)
2. **`/impl-plan`**: T0-T8 タスク分解 + AC1-AC10 + 統合影響分析 + リスク評価 (Zod 未導入 → 手動 runtime 検証採用、Frontend は本 PR scope 外 = optional の breaking change なし)
3. **T0 provenance.ts**: `createSplitProvenance()` factory + `assertValidProvenanceInput()` (sha256 hex 64桁 / generation 数値文字列 / path 非空 + gs:// prefix 禁止) + `ProvenanceValidationError`。admin/client Timestamp 互換性のため factory 境界で `as unknown as DocumentProvenance` 1 箇所キャスト
4. **Codex MCP impl-plan review** (新 thread `019e231a-...`): **NO-GO** → High 3 (download→sha256→getMetadata は同一 snapshot ではない / metageneration 両方比較必須 / Firestore partial state) + Medium 4 (gs:// parser / jitter backoff / ifGenerationMatch / download 前後 metadata 変化テスト) + Low 3 全反映方針確認
5. **T1-T4 splitSnapshot.ts + pdfOperations.ts refactor**: `parseGcsUri` / `verifySnapshotConsistency` / `verifyFinalDrift` / `acquireSourceSnapshot` (3-stage getMetadata→download→getMetadata 一致確認) / `backoffSleep` (100/300ms + jitter) / `SourceDriftError`。`splitPdf` を MAX_RETRIES=2 retry loop + `accumulated[]` (Firestore set 遅延) + final drift check + `db.batch().commit()` (child set + parent update 同一 commit) + `cleanupAccumulatedStorageFiles` (ifGenerationMatch precondition、`derivedGeneration=''` 時は unconditional delete fallback) に書換
6. **T5-T8 tests + docs**: provenance.test.ts (18) / splitSnapshot.test.ts (24、acquireSourceSnapshot 4 件含む) / hash.test.ts (4) / splitPdfProvenanceContract.test.ts (15 grep contracts) / splitPdfDocIdNamespace.test.ts (拡張 12 = 旧 PR-B 設計 → 新 PR-D2 atomic batch 設計に書換) / splitPdfPayloadContract.test.ts (UPDATE_ANCHOR を `await docRef.update` → `batch.update(docRef,` 追従) / data-model.md +13 (実装注釈表)
7. **`/simplify` 3 agent 並列**: HIGH 1 (efficiency: Buffer.from(newPdfBytes) 二重 allocation を排除、`file.save(newPdfBytes, ...)` + `sha256Hex(newPdfBytes)` で Uint8Array 直接) + MEDIUM 2 (reuse: sha256Hex 共通 helper `functions/src/utils/hash.ts` 新設) 反映。defer: parseGcsUri 既存 3 callsite migrate / segments loop 並列化 / sleep primitive 抽出 (別 PR)
8. **`/safe-refactor`**: HIGH 0 / MEDIUM 0 / LOW 0 (`as unknown as` cast 1 箇所は admin/client Timestamp 互換性 + コメント明示で許容)
9. **Codex MCP post-impl review** (同 thread `019e231a-...` 継続): **NO-GO** → High 1 (`batch.commit()` 後の `docRef.update()` が別 commit、partial state リスク) + Medium 1 (save 後・accumulated.push 前の orphan window) + Low 2 (unused import `verifySnapshotConsistency` / segments 500 batch limit) 全反映 → **GO**
   - parent update を child set と同一 batch に統合 (1 commit atomic)
   - `inflightEntry` を save 直後に即 accumulated に push、derivedGeneration / payload は後段で fill in
   - cleanup helper を `item.derivedGeneration ? { ifGenerationMatch } : undefined` で precondition optional 化
10. **Evaluator 分離プロトコル** (5+ files = quality-gate.md 発動): **APPROVE** / HIGH 0 / LOW 3 (Storage orphan best-effort 設計明示 / generation='0' falsy 判定 / endPage > PDF ページ数で pdf-lib raw Error) → LOW 3 反映 (`pdfDoc.getPageCount()` で照合し超過時 `HttpsError('invalid-argument')` 早期 abort)
11. **PR #456 作成** + push (6 commits)、CI 全 green (lint-build-test ✅ / CodeRabbit ✅ / GitGuardian ✅)
12. **`/review-pr` 6 agent 並列**:
    - silent-failure-hunter **Critical 3** (segmentsLoop / finalDrift / firestoreBatch の 3 catch で非-HttpsError rethrow → Firebase Functions v2 が INTERNAL に潰す anti-pattern、プロジェクト error-handling-policy 違反) → 全 catch を `HttpsError('internal', '... + 原因 message', { stage, parentDocumentId, ... })` でラップ
    - silent-failure-hunter I-4 (unreachable safety net) → `aborted` → `internal` + console.error 即時可視化
    - code-reviewer **Important 1** (CLAUDE.md #178 MUST 違反: FE `getReprocessClearFields()` に `provenance` 欠落) → `provenance: deleteField()` 追加
    - comment-analyzer Important 3 (hash.ts JSDoc factual error / T-numbering 不整合 / Codex thread ID 切り詰め) → 全修正
    - 6 agent /review-pr で発見した「非-HttpsError throw → INTERNAL 潰れ」は Codex / Evaluator 全層が見落とした class of issue、レビュー深度の補完性実証
    - defer: timeout budget / type AccumulatedSegment discriminated union / emulator integration test (PR-D3 で再検討 or 別 follow-up PR)
13. **再 push + CI green 確認** → ユーザー番号認可「PR #456 をマージしてよい」取得 → `gh pr merge 456 --squash --delete-branch` → main merge `cb8d94a`
14. **main CI/Deploy success**: CI run `25828945451` ✅ (5m18s) / Deploy run `25828945465` ✅ (6m42s) / pages build run `25828944667` ✅ (34s)

### Issue Net 変化

| 項目 | 内容 |
|------|------|
| Close 数 | 0 件 (Issue #445 は PR-D5 まで継続、PR-D2 単独では close せず) |
| 起票数 | 0 件 |
| **Net 変化 (session68 単独)** | **0 件** |

**Net 0 の進捗判定**: ✅ 正の構造的進捗。Issue #432 (P0) collision の **構造的予防完成** — Storage path 衝突は新規クライアント環境で原理的に発生不可能 (`processed/{docId}/{fileName}` namespace + 10 fields provenance による bit-perfect identity 記録)。新規クライアント等価運用基盤 (Issue #445 要件 4) の核心実装完遂。triage 基準 #5 (ユーザー明示指示「推奨で」「OK」「GO」「PR #456 をマージしてよい」) 該当。

### 主要 PR / 実行記録

| 項目 | 値 |
|---|---|
| **本 PR (PR-D2)** | **PR #456 merged** (squash commit `cb8d94a`、6 commits、12 files +1,513/-239) |
| commit (T0-T8 初回) | `02e162a` (8 files +1,360/-235) |
| commit (/simplify HIGH 1 + MEDIUM 2 反映) | `d285a27` (4 files +77/-15) |
| commit (Codex post-impl High + Medium + Low 反映) | `cae3066` (2 files +36/-21) |
| commit (Codex post-impl Low 1 / segments 500 batch limit) | `1b42e36` (1 file +9) |
| commit (Evaluator LOW 3 反映 / endPage 早期 abort) | `2779c65` (1 file +12) |
| commit (/review-pr Critical 3 + Important 3 反映) | `b55cf18` (5 files +73/-22) |
| Codex MCP thread (impl-plan + post-impl 2 段階) | `019e231a-3adc-74a0-b28e-3aee62c5f969` (High 4 + Medium 5 + Low 5、全反映) |
| Evaluator agent | APPROVE (LOW 3 反映済) |
| /review-pr agents | 6 並列 (code-reviewer / pr-test-analyzer / silent-failure-hunter / type-design-analyzer / comment-analyzer / code-simplifier) |
| main CI (post-merge) | run `25828945451` ✅ success (5m18s) |
| main Deploy (post-merge) | run `25828945465` ✅ success (6m42s) |
| main pages build (post-merge) | run `25828944667` ✅ success (34s) |

### AC 達成状況 (PR-D2 impl-plan 10 項目、最終状態)

| AC | 達成 | 根拠 |
|---|---|---|
| AC1 | ✅ | `createSplitProvenance` export + `ProvenanceValidationError` throw (provenance.test.ts 18 tests) |
| AC2 | ✅ | sha256 hex / generation 非数値 / path 空文字 / gs:// prefix 禁止 (5 ケース PASS) |
| AC3 | ✅ | grep contract で 9 input fields + processed/${docId}/ パターン固定 (splitPdfProvenanceContract.test.ts 15 tests) |
| AC4 | ✅ | `acquireSourceSnapshot` の buffer をそのまま sha256Hex に渡し、PDFDocument.load にも同 buffer (変数共有で同一性保証) |
| AC5 | ✅ (部分) | HttpsError('aborted') + child 0 件 (atomic batch) + Storage cleanup (best-effort、ifGenerationMatch precondition + 構造化ログ) |
| AC6 | ✅ | splitPdfPayloadContract.test.ts 5 + splitPdfDocIdNamespace.test.ts 12 + splitPdfProvenanceContract.test.ts 15 全 PASS |
| AC7 | ✅ | tsc clean (functions + frontend) |
| AC8 | ✅ | 1079 passing (前 998 → +81)、regression 0 |
| AC9 | ⏳ | dev 環境 E2E (`https://doc-split-dev.web.app` で実 PDF split 1 件 → Firestore Console で provenance 10 fields 目視) は次セッション実施 |
| AC10 | ✅ | Codex MCP 2 段階セカンドオピニオン GO 取得 (thread `019e231a-...`) |

### 残 Open Issue (5 件、session67 から不変)

| # | タイトル要約 | 状態 | 再開条件 |
|---|---|---|---|
| **#432** | [P0] 分割PDF 設計バグ | **PR-A〜C3c 修復完遂 + PR-D1 (ADR) + PR-D2 (本 `cb8d94a`) 予防完成** | 次セッションで kanameone / cocoro 本番展開判断 (別 PR + 番号認可)、復旧確認後 close |
| **#445** | [P1] データモデル正規化 | **PR-D1 + PR-D2 完遂、PR-D3〜D5 残** | 次セッションで PR-D3 (rotatePdfPages 改修) impl-plan 着手候補 |
| #402 | searchDocuments OOM ガード | 段階1 完了 | 観測データ判断 |
| #251 | summaryGenerator unit test | Scope 2 完了 | sinon 導入伴う他タスク or Vertex AI false negative |
| #238 | force-reindex 孤児 posting 検出 | 未着手 | 観測データ蓄積後 |

### 教訓 (本セッション新規)

- **Codex MCP 2 段階セカンドオピニオン (impl-plan + post-impl、同 thread 継続) が単発レビューでは発見できない根本指摘を補完**: impl-plan 段階で 3-stage snapshot / atomic batch の High 3 件を発見、post-impl 段階でも親 update 別 commit / save 後 orphan window の High + Medium 計 2 件を追加発見。実装後の view で初めて見える "interaction-level" の指摘 (個別 helper は正しいが組み合わせで穴が残る) は impl-plan 段階だけでは見えない。**destructive ではない forward-only 改修でも 2 段階 Codex 必須**として PR-D 系列に固定運用
- **6 agent /review-pr で発見した「非-HttpsError throw → INTERNAL 潰れ」は Codex / Evaluator が全層で見落とした class of issue**: Codex MCP は MUST 5 / batch atomicity / orphan window の構造的問題に集中、Evaluator は AC 検証 + 設計妥当性に集中、silent-failure-hunter は error handling 完全性 (HttpsError 分類 / Promise.allSettled / .cause 保持) に集中。**「review 観点の補完性 = 多層化の正当性」を実証**、5 段階品質ゲート (Codex impl-plan / simplify / safe-refactor / Codex post-impl / Evaluator / review-pr) は冗長ではなく深度別の網
- **`AccumulatedSegment` 二段ライフサイクル sentinel ('' / {}) は discriminated union 化候補 (type-design-analyzer Important)**: 本 PR scope では defer 妥当 (急修正は逆に refactor 範囲拡大 → 別の review round 必要)、PR-D3 で `rotatePdfPages` 改修時に同パターンが必要なら統合して discriminated union 化する想定 → `feedback_review_defer_for_scope_control.md` 候補
- **CLAUDE.md #178 教訓 (派生フィールド追加時の 4 箇所漏れチェック) の自動検知は code-reviewer agent が初発見**: BE 側 (Firestore 書込 + 型定義 + shared/types.ts) は impl-plan / Codex / Evaluator が全カバー、**FE 側の `firestoreToDocument()` + `getReprocessClearFields()` 同期は code-reviewer (CLAUDE.md 準拠チェック専門) が拾った**。プロジェクト固有 MUST の lint 化 (派生フィールド追加時の grep gate) は今後の改善余地

### 次セッション着手項目

1. `/catchup` で本 handoff + Issue 状態確認
2. **dev 環境 E2E 確認 (AC9)** — `https://doc-split-dev.web.app` で実 PDF split 1 件 → Firestore Console で child doc の `provenance` 10 fields 目視 (sourceGeneration / sourceMetageneration / sourceSha256 / sourcePath / sourceBucket / derivedObjectPath / derivedGeneration / derivedMetageneration / derivedSha256 / createdAt が全て存在し数値文字列 / hex / object name として正しい形)
3. **kanameone 本番展開判断** (別 PR + 番号認可必須、Issue #432 close 候補): PR #452 (PR-C3c) の AC15-3 + AC18 + AC-CC1 + AC-PREFLIGHT を使い、kanameone 135 docs CCITTFaxDecode Ambiguous の解消を実機実行
4. **cocoro 本番展開判断** (同上、被害 0 件想定だが survey + dry-run で確認)
5. **PR-D3 (rotatePdfPages 改修) impl-plan** — in-place 編集禁止 + 新 path 書込 + 安全な delete 経路。本 PR の `AccumulatedSegment` を discriminated union 化する統合 refactor も検討候補。Codex MCP セカンドオピニオン (impl-plan + 実装後 2 段階) 必須
6. **PR-D4 (既存 docs backfill) impl-plan** — destructive、kanameone ~5,725 + cocoro ~539 docs、GCS egress + Cloud Functions CPU 秒のフェルミ試算必須、dev リハーサル 7 stages × 2 周必須
7. (option) **follow-up reuse/efficiency PRs**: `parseGcsUri` 既存 3 callsite (ocrProcessor / rotatePdfPages / deleteDocument) migrate / `sleep` primitive を `functions/src/utils/sleep.ts` に統合 (retry.ts / rateLimiter.ts と統一) / segments loop bounded concurrency 並列化 / emulator-based splitPdf integration test harness

---

<a id="session67"></a>
## ✅ session67 完了サマリー (2026-05-13: Issue #445 PR-D1 完遂、ADR-0016 + DocumentProvenance + main merge `e21eabe`、Net 0)

session66 (PR-C3c 完遂、PR #452 main merge `83921b2`) で確立した「過去破壊修復経路」に対して、Codex MCP セカンドオピニオン thread `019e1c1e-...` の根本指摘「新規クライアント運用の根本保証には Firestore で parent-child と Storage object identity を正規化する設計が必須」を受け、本セッションで設計合意フェーズ (PR-D1) を完遂。

### 経緯

1. **catchup**: session66 handoff 確認、次セッション着手項目 1-5 から PR-D1 (Issue #445、read-only/設計) を選択 (1, 2 の本番展開は destructive で番号認可必須のため別建て)
2. **`/impl-plan`**: PR-D1 計画化 (ゴール / 統合影響分析 / タスク T1-T6 / AC1-AC10 / 実行戦略 / 品質ゲート / リスク)
3. **T1 ADR-0016 草案作成** (153 行): Status: Proposed、Context (Issue #432 root cause + Codex 根本指摘) / Decision (MUST 4 + SHOULD 3 + MAY 1) / Consequences (Pros 5 + Cons 4) / Alternatives (A/B/C/D 案、B 採用) / Implementation Roadmap (PR-D1〜D5) / References
4. **T2 Codex MCP セカンドオピニオン** (新 thread `019e1f5d-c93e-7d43-812b-b6d4c3fbef3d`): **GO with required amendments**
   - High 1: rotatePdfPages MUST 3 を「既存 path 上書き禁止 + callable 内旧 path delete 禁止」に書き換え
   - High 2: provenance fields 7 → 10 fields に拡張 (`derivedGeneration` / `derivedMetageneration` / `derivedSha256` 追加 = 子 object identity bit-perfect 証拠)
   - High 3: 新 MUST 5 追加 (splitPdf の sourceSha256 を split 使用 buffer から計算、sourceGeneration を同一 read snapshot で取得、concurrent write race 検出時は再試行)
   - Medium 3: sourcePath を「GCS object name」に文言修正 / PR-D4 destructive protocol を MUST 化 / fileName identity 禁止対象を「Storage identity / path construction / lookup key」に限定
   - Low 2: createdAt audit field 明記 / Consequences「100% 通過」→「通過可能な証拠を保持」に弱める
5. **T3 shared/types.ts**: `DocumentProvenance` interface 10 fields 新規 export + `Document.provenance?: DocumentProvenance` 追加 (+59 行)
6. **T4 docs/context/data-model.md**: PDF分割・回転 表に provenance 行 + 末尾に `### DocumentProvenance` schema セクション (テーブル + TypeScript code block + lifecycle 表 + 注意書き) (+53 行)
7. **T5 tsc + AC 検証**: functions/ ✅ frontend/ ✅、AC1-AC10 全 PASS
8. **`/simplify` 3 agent 並列**: HIGH 1 + MEDIUM 2 + Low 2 全反映
   - HIGH 1 (efficiency): fileUrl backward compat の try 順序・cache 指針 (`derivedObjectPath` primary、旧→新の try 順序は禁止) を ADR Cons に追記
   - MEDIUM 2 (quality): Codex thread ID 露出を types.ts / data-model.md から削除、ADR-0016 MUST 2 参照に置換
   - Low 2 (efficiency 申し送り): PR-D2 (file.save + getMetadata 2 API call) / PR-D4 (GCS egress + concurrent N=8 試算必須) を ADR Roadmap に追記
9. **`/safe-refactor`**: 問題なし (HIGH/MEDIUM/LOW 全 0 件)
10. **T6 PR #454 作成** (3 files, +264/-1、初回 commit `4b357cb`): Test plan に AC1-AC10 + Codex GO + /simplify + /safe-refactor 結果記載
11. **`/review-pr` 3 agent 並列** (実装コードゼロのため pr-test-analyzer / silent-failure-hunter / code-simplifier はスキップ): **Critical 0 / High 0 / Medium 1 / 申し送り 2**、type-design-analyzer **8/10 Approve** / code-reviewer **Approve** / comment-analyzer Medium 1
    - Medium 1: data-model.md createdAt の Timestamp 出所明示 (firebase/firestore vs admin SDK、既存 processedAt / fileDate と同慣習)
    - 申し送り 1 (type-design Enforcement): PR-D2 に `createSplitProvenance()` factory + sha256 hex 長さ / generation 数値文字列 runtime 検証 (Zod / valibot) + unit test 必須化
    - 申し送り 2 (code-reviewer Notable): `derivedSha256` は GCS metadata に含まれない (md5Hash/crc32c のみ) ため「書込時 buffer から compute」で正規化
12. **review 反映 commit `6978082`** (2 files, +2/-2): Medium 1 + 申し送り 2 件を ADR Roadmap + data-model.md に追記
13. **CI green 確認** (lint-build-test pass 5m4s / CodeRabbit skipped / GitGuardian pass) → **ユーザー番号認可「PR #454 のマージOK」取得** → `gh pr merge 454 --squash --delete-branch` → main merge `e21eabe`
14. **main CI/Deploy success**: CI run #25776969014 ✅ / Deploy run #25776969039 ✅ / pages build #25776968420 ✅

### Issue Net 変化

| 項目 | 内容 |
|------|------|
| Close 数 | 0 件 (Issue #445 は PR-D5 まで継続、PR-D1 は設計合意フェーズで未 close) |
| 起票数 | 0 件 |
| **Net 変化 (session67 単独)** | **0 件** |

**Net 0 の進捗判定**: ✅ 正の構造的進捗。Issue #445 (P1、データモデル正規化) の **設計合意フェーズ完遂**、Issue #432 (P0) の根本対策として「将来 collision を構造的に予防する設計」を ADR-0016 で正規化、PR-D2/D3/D4/D5 の実装制約 (factory + runtime 検証 / read snapshot 整合 / GCS egress 試算 / lint CI 時間) を Roadmap に明文化。triage 基準 #5 (ユーザー明示指示「次のアクション 優先順にすすめて」「PR #454 のマージOK」) 該当。

### 主要 PR / 実行記録

| 項目 | 値 |
|---|---|
| **本 PR (PR-D1)** | **PR #454 merged** (squash commit `e21eabe`、2 commits、3 files +266/-3) |
| commit (session67 初回) | `4b357cb` (3 files +264/-1) |
| commit (session67 /review-pr 反映) | `6978082` (2 files +2/-2) |
| CI on `4b357cb` | run `25776697342` ✅ success |
| CI on `6978082` | run `25776790198` ✅ success (5m4s) |
| Codex MCP セカンドオピニオン thread | `019e1f5d-c93e-7d43-812b-b6d4c3fbef3d` (GO with required amendments、High 3 + Medium 3 + Low 2) |
| main CI (post-merge) | run `25776969014` ✅ success |
| main Deploy (post-merge) | run `25776969039` ✅ success |
| main pages build (post-merge) | run `25776968420` ✅ success |

### AC 達成状況 (PR-D1 計画 10 項目、最終状態)

| AC | 達成 | 根拠 |
|---|---|---|
| AC1 | ✅ | ADR-0016 ## section 7 個 (≥ 5) |
| AC2 | ✅ | MUST prefix 8 occurrences (≥ 3) |
| AC3 | ✅ | `DocumentProvenance` in shared/types.ts 2 occurrences (≥ 2) |
| AC4 | ✅ | `Document.provenance?: DocumentProvenance` 追加 (shared/types.ts L83) |
| AC5 | ✅ | data-model.md "PDF分割・回転" 表に provenance 行 |
| AC6 | ✅ | data-model.md `### DocumentProvenance` schema 表 (L633) |
| AC7 | ✅ | functions/ tsc clean (exit 0) |
| AC8 | ✅ | frontend/ tsc clean (exit 0) |
| AC9 | ✅ | cross-reference 10 fields 全て ADR / types / data-model に存在 |
| AC10 | ✅ | `parentDocumentId` vs `provenance.sourcePath` 役割分担 (ADR SHOULD 2) |

### 残 Open Issue (5 件、session66 から不変)

| # | タイトル要約 | 状態 | 再開条件 |
|---|---|---|---|
| **#432** | [P0] 分割PDF 設計バグ | PR-A/B/C1/C2/C2-execution-A/D/C3a/C3b/C3c (session66 main merge `83921b2`) 完遂 | 次セッションで kanameone / cocoro 本番展開判断 (別 PR + 番号認可)、復旧確認後 close |
| **#445** | [P1] データモデル正規化 | **PR-D1 (本 PR `e21eabe`) 完遂、PR-D2〜D5 設計合意済** | 次セッションで PR-D2 (splitPdf 改修) impl-plan 着手候補 |
| #402 | searchDocuments OOM ガード | 段階1 完了 | 観測データ判断 |
| #251 | summaryGenerator unit test | Scope 2 完了 | sinon 導入伴う他タスク or Vertex AI false negative |
| #238 | force-reindex 孤児 posting 検出 | 未着手 | 観測データ蓄積後 |

### 教訓 (本セッション新規)

- **read-only/設計フェーズの PR でも 3 段階品質ゲート (Codex MCP / /simplify / /safe-refactor / /review-pr) を踏むことで Codex GO 後の追加品質指摘を統合できる**: Codex GO + High 3 反映後でも `/simplify` で HIGH 1 (fileUrl backward compat の try 順序未明示) を追加発見、`/review-pr` で Medium 1 (createdAt Timestamp 出所) + 申し送り 2 件を追加発見。「Codex のレビューだけでは十分でないケース」を実証 — 重点観点が異なる review tool は並列実行で漏れを補完する。**設計フェーズだから review を省略してよい、は誤り**。
- **ADR / 型定義 / schema 文書化の 3 層 cross-reference は AI 駆動開発の安全網として機能**: 同じ事実 (provenance 10 fields の意味・必須性) を 3 箇所に書く保守コストよりも、PR-D2 実装者がどの層を読んでも同じ事実に到達できる安全網メリットが上回る (comment-analyzer の Positive Finding)。`/simplify` reuse review でも「冗長ではなく安全網として機能」と判定。
- **Codex MCP セカンドオピニオンは設計フェーズでも実装制約に踏み込む価値あり**: thread `019e1f5d-...` の High 2 指摘 (子 object identity の derived* 4 fields 追加) は型定義のみの PR-D1 段階で発見、これを PR-D2 で発見した場合は実装やり直しコストが発生。「設計合意は早期かつ厳密に固定する」原則 (ADR-0016 で MUST/SHOULD/MAY prefix 明示) の効果実証。
- **`/review-pr` で実装コードゼロの PR は agent 選択を絞り込む**: pr-test-analyzer / silent-failure-hunter / code-simplifier は適用なし、comment-analyzer + type-design-analyzer + code-reviewer の 3 agent で並列実行。「全 agent 並列起動が常に最適ではない」事例 — 変更ファイル種別に応じた scope 選択が CI 時間とレビュー深度のバランスを取る。

### 次セッション着手項目

1. `/catchup` で本 handoff + Issue #432/#445 状態 + open Issue 確認
2. **kanameone 本番展開判断** (本 PR 範囲外、別 PR + ユーザー番号認可必須): PR #452 (PR-C3c) の AC15-3 + AC18 + AC-CC1 + AC-PREFLIGHT を使い、kanameone 135 docs CCITTFaxDecode Ambiguous の解消を実機実行。事前に pdf-feature-survey で本番状態確認 + dry-run で classify plan 確認 + 番号認可付き execute。**復旧後 Issue #432 close 判断**
3. **cocoro 本番展開判断** (同上): cocoro 環境での同等処理。被害 0 件想定だが念のため survey + dry-run で確認
4. **PR-D2 impl-plan 着手** (Issue #445、forward-only): `splitPdf` 改修 (新規 split で provenance 10 fields 書込 + derivedObjectPath canonical 化)。ADR-0016 Roadmap PR-D2 行に記載の前提条件 ①〜④ (file.save + getMetadata 2 API call / derivedSha256 は buffer compute / createSplitProvenance() factory + runtime 検証 / unit test 網羅) を impl-plan で詳細化。Codex MCP セカンドオピニオン (impl-plan + 実装後 2 段階) 必須
5. (option) **reverse orphan 1 件** (`processed/20260413_未判定_未判定_p27-28.pdf`) 調査 (low priority、follow-up)

---


session51-66 は `docs/handoff/archive/2026-05-history.md` 参照。
session29-50 は `docs/handoff/archive/2026-04-history.md` 参照。
