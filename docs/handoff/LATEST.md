# ハンドオフメモ

**更新日**: 2026-05-15 session76 (**Issue #445 PR-D4 S1-5 (Phase D verify + rotate gate 拡張) main merge `8a31c93` (PR #472) + Codex MCP review 11 round 反映、Net 0**)。`scripts/pr-d4-backfill/phase-d/` 新規 7 source files + 5 test files (65 unit tests) + `functions/src/pdf/rotateGate.ts` pure helper + `pdfOperations.ts` rotate gate guard = 17 files / +4470/-4。BF12/BF13/BF15/BF22 + 保全式 (verifiedDocs + mismatchedDocCount === candidatesIn / streamingDocsObserved === candidatesIn / estateRotateReadyCoverage + notRotateReady === 1.0) を orchestrator runtime throw でアサート。2 系統 coverage (backfillAttemptCoverage 分母 = Phase C candidatesIn、estateRotateReadyCoverage 分母 = Phase A totalDocs)。CAS update 3 段構造 (main 'pending' → manifest CAS → 別 status file)。Stage 1 (field 単位検証) + Stage 2 (factory 再 invoke sha256 比較) で false positive 構造的排除 (cross-process determinism 反映)。dev fixture rotate test は env hard gate + prefix allowlist + generation precondition + try/finally cleanup + cleanup 失敗 artifact 記録、本番では `rotateGateTest: null` で副作用ゼロ。`shouldRejectRotateForBackfill` pure helper は fail-closed (null / malformed / 不明 confidence / derived-bytes-verified の evidence 不完全 全 reject)。全 1370 tests passing (新規 65 + 既存 1305) / Quality Gate 全クリア (TDD + evaluator + code-reviewer + Codex MCP **1st-11th** = Critical 8 + Important 12 + Suggestion 全反映 → **11th GO**)。**次セッション最優先: PR-D4 S1-6 (Dockerfile + workflow) 着手**

**更新日 (前)**: 2026-05-15 session75 (**Issue #445 PR-D4 S1-4 (Phase C atomic backfill) main merge `b543774` (PR #469) + Codex MCP 1st/2nd NO-GO → 3rd GO 反映、Net 0**)。`scripts/pr-d4-backfill/phase-c/` 新規 9 source files + 7 test files (60 unit tests)。GCS sentinel 排他 lock (BF16/BF21) + 20 docs/batch + lastUpdateTime precondition + immutable skip (verified existing + already backfilled の 2 reason、BF14) + batch fallback の doc 単位 retry max=3 (BF18) + global write rate limiter (BF23) + 保全式 candidatesIn = writtenDocs + preconditionFailedDocs + skippedImmutable + unprocessableDocs + outOfScopeDocs (Evaluator HIGH 反映)。Hard-gate で MatchedByHash + derived-bytes-verified 以外を本番書込から構造的に除外 (impl-plan §4.0)。lock 順序は finalize → release (Codex 2nd Critical 反映、release 前 finalize で artifact 整合性保証)。全 1305 tests passing (新規 60 + 既存 1245) / Quality Gate 全クリア (TDD + evaluator + pr-review-toolkit:code-reviewer + Codex MCP 1st NO-GO → 2nd NO-GO → 3rd GO)。次セッション最優先: PR-D4 S1-5 (Phase D 実装 = verify + rotate gate behavior、BF12/BF13/BF15) 着手
**ブランチ**: `main` (PR #472 squash merge `8a31c93` 完遂、feature ブランチ自動削除済。CI 全 green: CodeRabbit pass / GitGuardian pass / lint-build-test pass)
**フェーズ**: Phase 8 + 運用監視基盤全環境展開完了 + (session29-66 累積実績は archive 参照) + **Phase 8 (session67 = PR-D1 / session68 = PR-D2 / session69 = PR-D3 完遂 + 3 環境展開 + #445 close / session70 = PR-D4 impl-plan + ADR 改訂 main merge / session71 = PR-D4 S1-1 基盤層 main merge / session72 = PR-D4 S1-2 Phase A 実装 main merge / session73 = PR-D4 S1-3 Phase B 実装 main merge / session74 = PR-D4 S1-4 Phase C 実装 main merge / session76 = PR-D4 S1-5 Phase D 実装 main merge、Net 0)** = Issue #432 P0 collision の構造的予防 splitPdf + rotatePdfPages 双方で 3 環境稼働 + 既存 docs backfill の Phase A (read-only audit) + Phase B (write-free preflight revalidation) + Phase C (atomic backfill verified docs) + Phase D (verify + rotate gate 拡張) が全て main に確定

<a id="session76"></a>
## ✅ session76 完了サマリー (2026-05-15: Issue #445 PR-D4 S1-5 Phase D 実装 main merge `8a31c93` (PR #472) + Codex MCP review 11 round 反映、Net 0)

session75 で整理した残ロードマップに従い、PR-D4 S1-5 (Phase D 実装) に着手。`scripts/pr-d4-backfill/phase-d/` 新規 7 source files + `functions/src/pdf/rotateGate.ts` pure helper + `pdfOperations.ts` rotate gate guard + 5 test files (65 unit tests) = 17 files / +4470/-4 LoC。Phase D verify + rotate gate 拡張 (BF12/BF13/BF15) を実装し、Codex MCP review 11 round (impl-plan 段階 7 + 実装段階 4) で Critical 8 + Important 12 + Suggestion 全件反映後、**11th GO** 判定取得。**PR #472 を squash merge** (`8a31c93` main 確定、feature branch 自動削除、main 同期完了)。

### 経緯

1. **catchup**: session75 handoff 確認、次セッション最優先 = PR-D4 S1-5 (Phase D) 着手を選択
2. **TaskCreate** (8 件) + **feature branch 作成** (`feat/pr-d4-phase-d`、main 直 push 禁止 = CLAUDE.md 4 原則 §4)
3. **/impl-plan**: Phase D 実装計画策定 (scope: rotate gate 拡張 + Phase D verify orchestrator + integration test + Phase D artifact 出力 + index.ts CLI 拡張)
4. **Codex MCP impl-plan review 7 round** (thread `019e29e8-7e59-7512-a86f-7a8fb5a3cf93`):
   - 1st NO-GO: Critical 2 (Phase D 10 fields 証明力不足 / factory 再 invoke false positive) + Important 5
   - 2nd GO with Important fixes (3 件): rotate gate helper malformed validation 強化 / parentSha256MatchedAtBackfill 型 union / CAS 失敗タイミング
5. **TDD 実装** (RED→GREEN→REFACTOR、各 module 独立):
   - `rotateGate.ts` (pure helper、20 tests): fail-closed gate、null / malformed / 不明 confidence / derived-bytes-verified の evidence 3 field 全 true 必須
   - `pdfOperations.ts`: AC12 legacy guard 直後に `shouldRejectRotateForBackfill` 呼出 + grep contract 2 件追加
   - `phase-d/types.ts`: PhaseDVerifySummary / Chunk / VerifiedDoc / FieldMismatchDoc / RotateGateTestResult / CoverageRatio / FinalizeStatus + MismatchType
   - `phase-d/artifactReader.ts`: manifest chain authority (phaseA/B/C ref 取得) + Phase A/B/C 全 main artifact sha256 verify + Phase B in-memory index 構築
   - `phase-d/docVerifier.ts`: Stage 1 (provenance 10 fields field-by-field + provenanceBackfill 単位検証) + Stage 2 (factory 再 invoke で sha256 比較、observed backfilledAt 必須)
   - `phase-d/artifactWriter.ts`: writePhaseDChunk + finalizePhaseDArtifact (main `manifestUpdateStatus: 'pending'` + manifest CAS + 別 status file `phase-d-finalize-status.json`)
   - `phase-d/rotateGateFixtureTester.ts`: dev disposable fixture rotate test (env hard gate + prefix allowlist BF13_test_fixture_<runId>_<kind>_<uuid> + try/finally cleanup + fixtureCleanupFailures[])
   - `phase-d/verifyOrchestrator.ts`: 統合フロー (Phase C streaming → per-doc Firestore re-read → verifyDoc → per-chunk flush → rotate fixture test (dev のみ) → coverage 2 系統 → finalize) + 保全式 runtime throw
   - `phase-d/adapters.ts`: FirestoreDocReaderImpl + GcsFixtureStoreImpl + HttpsRotateApiCallerImpl (rotate 成功後 Firestore re-read で実 path + GCS metadata で generation 取得)
   - `index.ts`: --phase D CLI ブランチ + exit code policy (3=CAS fail, 4=verification failure)
6. **Quality Gate 3 並列起動** (evaluator + code-reviewer + Codex MCP 8th-11th):
   - **evaluator** (REQUEST_CHANGES): HIGH 2 (保全式空ブロック / sha256 mismatch カウント漏れ) + MEDIUM 2 + LOW 1 + エッジケース 3
   - **code-reviewer**: HIGH 2 (rating 8) + MEDIUM 4 + LOW 4、起票候補 4 件
   - **Codex MCP 8th**: GO with Important fixes (3 件)
   - **Codex MCP 9th** (実装完了後 1st review): NO-GO with Critical 3 (CLI 構文エラー / fixture cleanup orphan / 保全式集計誤り) + Important 4
   - **Codex MCP 10th** (反映後): NO-GO with Important 1 (BF15 backfillAttemptCoverage 分母誤り、phaseC.candidatesIn を使うべき)
   - **Codex MCP 11th** (10th 反映後): **GO** (PR merge blocker なし)
7. **追加 test**: BF15 denominator 検証 (Phase C candidatesIn=7 / writtenDocs=2 / preconditionFailed=2 / skippedImmutable=3 で正しい分母をアサート) + hasVerificationFailure 判定 2 件
8. **commit**: `25af030`、17 files / +4470/-4
9. **PR #472 作成** (`https://github.com/yasushi-honda/doc-split/pull/472`): CI 全 green (lint-build-test pass / CodeRabbit pass / GitGuardian pass)
10. **PR #472 squash merge** (ユーザー番号認可「PR #472 — merge 可」取得): `8a31c93` main merge、feature branch 自動削除、main 同期完了

### 設計上の重要決定 (Codex MCP 7th/8th/9th/10th/11th review 反映)

- **Phase D verify が provenance 10 fields を field-by-field 比較** (Codex 7th Critical 1): Phase C `newProvenanceBackfillSha256` だけでは 10 fields を証明不能。Phase B `computedProvenance` を docId join で expected として読み込む
- **Stage 1 + Stage 2 の 2 段階 verify** (Codex 7th Critical 2): factory 再 invoke の false positive 回避のため、observed field 単位検証を先に実施、Stage 1 pass のみ sha256 比較。observed `backfilledAt` を Stage 2 で必ず渡す (省略時 Timestamp.now() で hash 不一致回避)
- **rotate gate fail-closed + pure helper 化** (Codex 7th Important 1 + Suggestion 1): `shouldRejectRotateForBackfill(raw: unknown)` で type + invariant + evidence 検証。null も reject (malformed)
- **CAS 失敗時 3 段構造** (Codex 8th Important 3): main artifact は `manifestUpdateStatus: 'pending'` で書込 (overwrite 回避)、CAS 結果は別 file `phase-d-finalize-status.json` に記録
- **dev fixture cleanup hook の必須条件 5 件** (Codex 7th Important 2): env hard gate + prefix allowlist + generation precondition + try/finally + cleanup 失敗 artifact 記録
- **2 系統 coverage の分母分離** (Codex 7th Important 4 + 10th Important 1): backfillAttemptCoverage 分母 = Phase C **candidatesIn** (Phase B revalidated 全件、書込試行母集団) ≠ writtenDocs。estateRotateReadyCoverage 分母 = Phase A totalDocs (BF15 主指標)
- **doc 単位保全式** (Codex 9th Critical 3): `verifiedDocs + mismatchedDocCount === candidatesIn` (= Phase C writtenDocs)、`streamingDocsObserved === candidatesIn` で chunk truncation 検出、orchestrator runtime throw
- **fixture cleanup orphan 防止** (Codex 9th Critical 2): rotatePdfPages callable response に path/generation が含まれないため、rotate 成功後 Firestore re-read で fileUrl 取得 + GCS metadata で generation 確定
- **Phase A/B main artifact sha256 verify** (Codex 9th Important 2 + code-reviewer M2): readPhaseACountReadOnly / readPhaseBCandidatesIndex に `expectedMainSha256: string` 引数追加、chain authority 完全性
- **CLI exit code policy** (Codex 9th Important 3): 0=clean / 2=arg error / 3=CAS fail / 4=verification failure (hasVerificationFailure フラグで判定)

### 変更ファイル一覧 (17 files: 11 new + 6 modified、+4470/-4)

| ファイル | 区分 | LoC |
|---------|------|----:|
| `functions/src/pdf/rotateGate.ts` | new | 117 |
| `functions/src/pdf/pdfOperations.ts` | modified | +15/-0 |
| `functions/test/rotateGate.test.ts` | new | 222 |
| `functions/test/rotatePdfPagesContract.test.ts` | modified | +17/-0 |
| `functions/test/prD4PhaseDDocVerifier.test.ts` | new | 430 |
| `functions/test/prD4PhaseDArtifactReader.test.ts` | new | 331 |
| `functions/test/prD4PhaseDArtifactWriter.test.ts` | new | 238 |
| `functions/test/prD4PhaseDRotateGateFixtureTester.test.ts` | new | 215 |
| `functions/test/prD4PhaseDVerifyOrchestrator.test.ts` | new | 690 |
| `scripts/pr-d4-backfill/index.ts` | modified | +131/-4 |
| `scripts/pr-d4-backfill/types.ts` | modified | +240/-0 |
| `scripts/pr-d4-backfill/phase-d/adapters.ts` | new | 291 |
| `scripts/pr-d4-backfill/phase-d/artifactReader.ts` | new | 217 |
| `scripts/pr-d4-backfill/phase-d/artifactWriter.ts` | new | 223 |
| `scripts/pr-d4-backfill/phase-d/docVerifier.ts` | new | 462 |
| `scripts/pr-d4-backfill/phase-d/rotateGateFixtureTester.ts` | new | 255 |
| `scripts/pr-d4-backfill/phase-d/verifyOrchestrator.ts` | new | 380 |

### 教訓 (本セッション新規)

- **destructive migration の Codex MCP review は impl-plan + 実装で 11 round 必要**: Phase D は production callable 挙動変更を含み、本番 5,725 docs / 539 docs に rotate gate 影響あり。Codex review 1st-7th (impl-plan)、8th GO with Important、9th-10th NO-GO with Critical/Important (CLI / cleanup / 保全式 / BF15 denominator) → 11th GO。**3-4 round 想定では足りない、destructive scope では 10+ round 想定で work estimation する**
- **production callable 挙動変更の gate test は pure helper 化必須**: Codex 7th Suggestion 1 で `shouldRejectRotateForBackfill(raw: unknown)` を切り出し、unit test と production を同じ helper で contract 化。grep contract も追加して構造的 lock-in
- **保全式は field 単位レコード vs doc 単位カウントを明示分離**: `fieldsMismatch.length` (field レコード) と `mismatchedDocCount` (Set 由来 doc 数) は別概念。混同すると 1 doc が複数 field mismatch を起こす経路で保全式破綻 (Codex 9th Critical 3 で発見、`fieldsMismatchDocs` を doc 単位 ID 集合に再設計)
- **空ブロック保全式アサートは無効、必ず実 throw / console.error 化**: 「保全式アサート」とコメントしていても空 if block は dead code (Evaluator HIGH で発見)。runtime check は throw で stop the world に
- **coverage 比率は分母の意味論を明示する**: `backfillAttemptCoverage` (試行母集団) vs `estateRotateReadyCoverage` (env 全体) で別 metric を出す。Codex 10th で「writtenDocs を分母にしていた」誤りを発見

### Net 計測 (CLAUDE.md MUST)

- Before: open Issues = 4 (#432 P0、#402 P2、#251 P2、#238 P2)
- After: open Issues = 4 (変化なし)
- 本 session 完了時点で **+0 / -0 = Net 0**
- 進捗判定: ✅ 構造的進捗 (Issue #432 P0 復旧経路の **Phase D verify + rotate gate 拡張が main 確定**、PR-D4 series の全 module 実装 (Phase A/B/C/D + rotate gate) が完了し、残りは S1-6 Dockerfile + S1-7 container build/push で S1 完了条件達成)

### 次セッション着手項目

1. `/catchup` で本 handoff + Issue #432 状態 + open Issue 確認
2. **PR-D4 S1-6 着手** (Dockerfile + `.github/workflows/pr-d4-backfill.yml`):
   - Dockerfile: `ts-node --transpile-only` 固定運用、通常 `tsc` / `ts-node` (transpile-only なし) は本 scripts 経路で使わない方針をコメント明記 (Codex 11th 指摘)
   - workflow_dispatch + env / phase / rotate-fixture-mode 選択
   - exit code 3 / 4 を workflow 失敗扱い
3. **PR-D4 S1-7**: container build + push (dev で実行) → image tag 取得 (= S1 完了条件)
4. **PR-D4 S2-S7**: dev rehearsal 7-stage × 2 周 → Codex MCP 12th review GO 確認 → cocoro / kanameone 段階展開 (各 phase ユーザー番号認可)
5. **PR-C3 kanameone execute** (PR-D4 完了後): 135 Ambiguous (CCITTFaxDecode) の classify → execute

---

<a id="session75"></a>
## ✅ session75 完了サマリー (2026-05-15: Issue #432 残対応ロードマップ整理 + 順守規範明文化、実装作業なし、Net 0)

session74 で PR-D4 S1-4 (Phase C atomic backfill) を main merge 完了した状態で、ユーザーから過去エラー画像 (`No such object: docsplit-kanameone.firebasestorage.app/processed/20260509_未判定_未判定_p3.pdf`) を提示され「対応完了はいつまでか」との質問。**現状は新規エラー発生なし**(PR-D2/D3 構造的予防が 3 環境展開済) を確認のうえ、完全閉鎖までの残作業と所要 session を明文化。AI 側の順守規範 (4 原則 / destructive migration 多段 review / 本番動作確認の能動依頼禁止 等) を確認しコミット。実装作業は本セッションでは実施せず (残 context 13% で着手不適)、次セッション以降に持ち越し。

### 確認した残作業と完了見込み

| ステップ | 内容 | session 数目安 | 性質 |
|---|---|---|---|
| **PR-D4 S1-5** | Phase D 実装 (verify + rotate gate behavior、BF12/BF13/BF15) | 1 | TDD + Codex review |
| **PR-D4 S1-6** | Dockerfile + `pr-d4-backfill.yml` workflow_dispatch | 0.5 | 設定 |
| **PR-D4 S1-7** | container build + push (= S1 完了条件) | 0.5 | dev 検証 |
| **PR-D4 S2-S7** | dev リハーサル 7-stage × 2 周 + Codex MCP 5th review | 1-2 | read-only |
| **PR-D4 本番展開** | cocoro → kanameone 段階展開 (phase ごと番号認可) | 1-2 | destructive |
| **PR-C3 kanameone** | 135 Ambiguous (CCITTFaxDecode) の execute (dev リハーサル完遂済) | 1-2 | destructive |
| **合計** | Issue #432 構造的閉鎖まで | **5-8 session** | |

### 確認した本件特定エラーの位置付け

- `20260509_未判定_未判定_p3.pdf` は Issue #432 起票の発端 (2026-05-10 検出) と同一文字列
- 当時 3 docs が同 fileName を共有 (`M7i4Nx6khiYEo2KTGJHg` / `U4Lf5ZPNA4IyH73SXE2P` / 3 件目未特定)
- session61 PR-C2 (PR #442) で **RepairableMissingFile 4 件を docId namespace に regenerate**、post-audit (run 25714003425) で fileUrl 孤児 4→0 確認済
- ユーザー報告「現在はエラー出てない」= 構造的予防 (PR-D2/D3) と過去復旧 (PR-C2) で **新規ユーザー被害は停止状態**
- 残るのは「過去 silent 破壊 docs の検出可能化 (PR-D4 = provenance backfill)」+「135 Ambiguous の事後復旧 (PR-C3)」

### 確認・コミットした順守規範

- **AI 駆動開発 4 原則**: executor 動作 / hook ブロックは立ち止まれの合図 / destructive 操作は番号単位の明示認可のみ / main 直 push 禁止
- **destructive migration**: impl-plan 段階で Codex MCP セカンドオピニオン必須 (1 round 想定禁止、3-4 round 想定で work estimation) / dev フルリハーサル 7-stage × 2 周必須 / 本番展開は `PR #番号 — タイトル (N files, +X/-Y)` 形式で番号認可依頼
- **Quality Gate**: 5+ファイル/新機能/アーキ変更 → Evaluator 分離 / 3+ファイル → `/simplify` + `/safe-refactor` / TDD RED→GREEN→REFACTOR
- **抑制ルール**: 本番動作確認は AI から能動的に依頼しない / 約束・確約化リスク表現はユーザー承認後 / 同一機能 3 連続失敗 → 元設計再レビュー

### 教訓 (本セッション)

- **「対応完了見込み」質問にはロードマップ + session 数 + 完了条件で答える**: 確約日付は AI 側で出さない (実 session 着手タイミングはユーザー判断 + destructive phase は番号認可待ちで伸縮するため)
- **新規エラー停止と完全閉鎖は別概念**: ユーザーが「エラー出てない」と言っても構造的閉鎖 (provenance 100% backfilled + Ambiguous 解消) は別軸で進める必要あり、両者を混同しない
- **残 context 低下時の判断**: 13% で PR-D4 S1-5 (multi-hour impl-plan + Codex review + TDD) 着手は不適、handoff 更新で次セッション渡しが適切

### Net 計測 (CLAUDE.md MUST)

- Before: open Issues = 4 (#432 P0、#402 P2、#251 P2、#238 P2)
- After: open Issues = 4 (変化なし)
- **Net 0** (実装作業なし、整理・確認 session)

### 次セッション着手項目 (session74 から不変)

1. `/catchup` で本 handoff + Issue #432 状態 + open Issue 確認
2. **PR-D4 S1-5 着手** (Phase D 実装、verify + rotate gate behavior、BF12/BF13/BF15): Phase C 書込 doc 全件再読込 + `provenance` + `provenanceBackfill` の field 整合 verify + `derived-bytes-verified` doc で rotate API call (dev fixture) → 成功 + `child-snapshot-only` (dev fixture) で `failed-precondition` reject 確認 + integration test (本番 doc 副作用なし) + coverage 比率 artifact 出力
3. **PR-D4 S1-6**: Dockerfile + `.github/workflows/pr-d4-backfill.yml` (workflow_dispatch + env/phase 選択)
4. **PR-D4 S1-7**: container build + push (dev で実行) → image tag 取得 (= S1 完了条件)
5. **PR-D4 S2-S7**: dev rehearsal 7-stage × 2 周 → Codex MCP 5th review GO 確認 → cocoro / kanameone 段階展開 (各 phase ユーザー番号認可)
6. **PR-C3 kanameone execute** (PR-D4 完了後): 135 Ambiguous (CCITTFaxDecode) の classify → execute

---

<a id="session74"></a>
## ✅ session74 完了サマリー (2026-05-15: Issue #445 PR-D4 S1-4 Phase C 実装 main merge `b543774` (PR #469) + Codex MCP 1st/2nd NO-GO → 3rd GO 反映、Net 0)

session73 で main 確定した PR-D4 S1-3 Phase B (write-free preflight revalidation) の出力を **消費する Phase C** = atomic backfill verified docs を実装。`scripts/pr-d4-backfill/phase-c/` 新規 9 source files + 7 test files (60 unit tests)。Phase B artifact streaming read → ≤20 docs/batch grouping → 各 doc を再読込 + immutable skip 判定 (新規 + 既 backfilled 両方) + Hard-gate (MatchedByHash + derived-bytes-verified 以外を outOfScopeDocs) + Firestore atomic batch update (lastUpdateTime precondition) → 失敗時 doc 単位 retry (max=3) で precondition 失敗 doc を隔離 → per-chunk artifact 出力 → finalize (main + manifest CAS) → lock release。本番 Firestore への 5 fields write (`provenance` + `provenanceBackfill`) が含まれる初めての PR-D4 series PR。Codex MCP review = 1st NO-GO (hard-gate / unprocessable 集計) → 2nd NO-GO (lock 順序 / idempotency) → **3rd GO** の 3 段階で安全性を構造的に固めて main merge。

### 経緯

1. **catchup**: session73 handoff 確認、次セッション最優先 = PR-D4 S1-4 (Phase C) 着手を選択
2. **feature branch 作成** (`feat/pr-d4-phase-c`): main 直 push 禁止 (CLAUDE.md 4 原則 §4)
3. **TaskCreate** (13 件): types → rateLimiter → immutableSkipChecker → lockManager → batchWriter → individualRetryWriter → artifactWriter → backfillOrchestrator → adapters → index → Quality Gate → Codex review → PR/handoff
4. **TDD 実装** (RED→GREEN、各モジュール独立):
   - `types.ts`: Phase C schemas 追加 (PhaseCBackfillSummary / PhaseCBackfillChunk / PhaseCWrittenDoc / PhaseCPreconditionFailedDoc / PhaseCImmutableSkippedDoc / PhaseCOutOfScopeDoc / PhaseCUnprocessableDoc / PhaseCLockBody / PhaseCRateLimiterConfig) + 定数 (BATCH_SIZE=20 / RETRY_MAX=3 / DEFAULT_RATE_LIMITER=100/sec)
   - `rateLimiter.ts` (10 tests): TokenBucketRateLimiter + RateLimiter interface (DI 抽象化、clock 注入で deterministic test)
   - `immutableSkipChecker.ts` (6 tests): field existence 判定、null sentinel 禁止 (Codex 3rd I3)、`verified existing` + `already backfilled` の 2 reason
   - `lockManager.ts` (9 tests): GCS sentinel acquire (ifGenerationMatch:0) + release (acquired generation 付き)、LockObjectStore interface
   - `batchWriter.ts` (14 tests): 20 docs/batch + lastUpdateTime precondition + Hard-gate (out-of-scope filter) + immutable skip 再確認 + atomic update、buildBackfillRecord + sha256ProvenanceBackfill を export (DRY)
   - `individualRetryWriter.ts` (8 tests): batch fallback の doc 単位 retry max=3 + 隔離、unprocessableDocs (caller-bug 経路) を preconditionFailedDocs (drift 経路) と別観測軸に分離
   - `artifactReader.ts` (Phase C 専用、Phase B 用): Phase B manifest 読込 + main artifact sha256 verify + chunks streaming
   - `artifactWriter.ts` (4 tests): writePhaseCChunk (docCount = 全カテゴリ合計、BF22 完全性) + finalizePhaseCArtifact (main + manifest CAS update)
   - `backfillOrchestrator.ts` (9 tests): 統合フロー (lock acquire → stream → batch → fallback → flush → finalize → release)、保全式アサート、lock 順序検証
   - `adapters.ts`: production wire (GcsLockStoreImpl + FirestoreBatchAdapterImpl + FirestoreIndividualAdapterImpl、unit test 対象外)
   - `index.ts`: `--phase C` ブランチ追加 (--job-id / --lock-owner / --expected-duration-sec)
5. **Quality Gate 3 並列起動** (evaluator + code-reviewer + Codex MCP review):
   - evaluator (REQUEST_CHANGES): HIGH 1 (missingDocs 集計欠落、保全式不成立) + MEDIUM 2 (lockReleasedAt 順序 / acquire read-after-write gap)
   - code-reviewer (rating 7-8): #1 sha256 cross-process determinism + #3 caller-bug 経路の drift 誤分類 + #4 ProvenanceValidationError 隔離分類 + #5 lock held 時 release=0 test 不足
   - Codex MCP 1st review: **NO-GO 判定**
     - **Critical**: C1 = batchWriter に MatchedByHash + derived-bytes-verified の Hard-gate なし (child-snapshot-only が書込可能、impl-plan §4.0 違反) / C2 = ProvenanceValidationError + missing doc を missingDocs 隔離 + orchestrator が artifact / counter に未反映で silent drop
     - **Important**: I1 = lock generation を save→getMetadata 2 RTT 取得 (race window) / I2 = catch ブロック release 失敗 swallow / I3 = chunk docCount が writtenDocs のみ
6. **Codex 1st 反映** (commit `111b9d1`、+482/-70):
   - batchWriter に Hard-gate (out-of-scope filter) 追加、`PhaseCOutOfScopeDoc` 新型
   - missingDocs を `PhaseCUnprocessableDoc { docId, reason: 'missing' | 'validation', message? }` に統合 + orchestrator が `totalUnprocessable` / `totalOutOfScope` を集計
   - 保全式 candidatesIn = writtenDocs + preconditionFailedDocs + skippedImmutable + unprocessableDocs + outOfScopeDocs を `PhaseCBackfillSummary` + `RunPhaseCResult` + test でアサート
   - chunk docCount を全カテゴリ合計に変更 (BF22 完全性)
   - individualRetryWriter の caller-bug 経路 ('lastUpdateTime drift' 誤分類) を unprocessableDocs に分離
   - GcsLockStoreImpl.acquire で generation を numeric digit string strict validation
   - catch ブロックの release 失敗を console.error で通知
   - sha256ProvenanceBackfill JSDoc に cross-process determinism 注意明記 (memory `feedback_deterministic_cross_process.md`)
7. **Codex MCP 2nd review**: **NO-GO 判定**
   - **Critical**: lock release を finalize 前に行うと production-unsafe (Codex 1st 反映で lock 順序を逆にしてしまった = Evaluator MEDIUM 反映の副作用)。finalize 失敗時に別 run が同 env lock 取得可能 + writes committed + manifest.phaseC 未反映の中途半端状態を許容
   - **Important**: `provenanceBackfill !== undefined` (= 既 backfilled) を skip しない (idempotency 欠如、同 run retry や別 Phase C run 同時実行で既 backfilled doc を上書き)
8. **Codex 2nd 反映** (commit `ce506a0`、+120/-47):
   - lock 順序を `finalize → release` に戻す (artifact 整合性優先)、`lockReleasedAt` は finalize 直前の nowProvider (= release 要求時刻) として JSDoc 明示
   - immutableSkipChecker に `'already backfilled (provenanceBackfill present)'` reason 追加、null sentinel 禁止 (Codex 3rd I3 維持) + `PhaseCImmutableSkippedDoc.reason` union 拡張
   - orchestrator test 追加: lock 順序 (eventOrder で main-written → manifest-written → lock-released)、既 backfilled doc skip 動作
9. **Codex MCP 3rd review**: **GO 判定** (Critical + Important 全件解消、minor 2 件のみ = JSDoc 整合性)
10. **Codex 3rd minor 反映** (commit `828f4ae`、+4/-3): immutableSkipChecker JSDoc「null 含む」→「null 除外」、backfillOrchestrator JSDoc「try/finally」→「try/catch best-effort」
11. **commit 4 件 (`6d7749d` + `111b9d1` + `ce506a0` + `828f4ae`)**: 18 files / +3995/-3
12. **PR #469 作成** + CI 全 green (lint-build-test pass / CodeRabbit pass / GitGuardian pass)
13. **PR #469 squash merge** (ユーザー番号認可「#469 をマージしてよい」取得): `b543774` main merge、feature branch 自動削除、main 同期完了

### 変更ファイル一覧 (18 files: 16 new + 2 modified、+3995/-3)

| ファイル | 区分 | LoC |
|---------|------|----:|
| `scripts/pr-d4-backfill/phase-c/types.ts` | (types.ts 内 Phase C section) | +201 |
| `scripts/pr-d4-backfill/phase-c/rateLimiter.ts` | new | 101 |
| `scripts/pr-d4-backfill/phase-c/immutableSkipChecker.ts` | new | 58 |
| `scripts/pr-d4-backfill/phase-c/lockManager.ts` | new | 142 |
| `scripts/pr-d4-backfill/phase-c/batchWriter.ts` | new | 286 |
| `scripts/pr-d4-backfill/phase-c/individualRetryWriter.ts` | new | 186 |
| `scripts/pr-d4-backfill/phase-c/artifactReader.ts` | new | 89 |
| `scripts/pr-d4-backfill/phase-c/artifactWriter.ts` | new | 156 |
| `scripts/pr-d4-backfill/phase-c/backfillOrchestrator.ts` | new | 285 |
| `scripts/pr-d4-backfill/phase-c/adapters.ts` | new | 207 |
| `scripts/pr-d4-backfill/index.ts` | modified | +68/-3 (--phase C 経路) |
| `functions/test/prD4PhaseCRateLimiter.test.ts` | new | 207 |
| `functions/test/prD4PhaseCImmutableSkipChecker.test.ts` | new | 73 |
| `functions/test/prD4PhaseCLockManager.test.ts` | new | 209 |
| `functions/test/prD4PhaseCBatchWriter.test.ts` | new | 506 |
| `functions/test/prD4PhaseCIndividualRetryWriter.test.ts` | new | 251 |
| `functions/test/prD4PhaseCArtifactWriter.test.ts` | new | 282 |
| `functions/test/prD4PhaseCBackfillOrchestrator.test.ts` | new | 459 |

### Net 計測 (CLAUDE.md MUST)

- Before: open Issues = 4 (#432 P0、#402 P2、#251 P2、#238 P2)
- After: open Issues = 4 (変化なし)
- 本 session 完了時点で **+0 / -0 = Net 0**
- 進捗判定: ✅ 構造的進捗 (Issue #432 P0 復旧経路の **Phase C atomic backfill が main 確定**、Phase D 実装が安全に積み上げ可能。これで PR-D4 series の全 Firestore 書込みコード = Phase C が確定し、残りは Phase D verify + Cloud Run Job container 化のみ)

### 設計上の重要決定 (Codex MCP 1st/2nd NO-GO → 3rd GO 反映)

- **Hard-gate (Codex 1st Critical 1 反映)**: batchWriter で `category === 'MatchedByHash' && computedConfidence === 'derived-bytes-verified'` 以外を `outOfScopeDocs` に分類し、reReadForBatch / commitBatch を呼ばずに skip。Phase B 実装は MatchedByHash のみ revalidated[] に入れるが、dev fixture / Phase B のバグ / 将来 Phase B 拡張で異種候補が混入しても本番書込しない構造的ガード。impl-plan §4.0 を型レベルで lock-in
- **observability 完全性 (Codex 1st Critical 2 反映)**: `missingDocs` を `PhaseCUnprocessableDoc { reason: 'missing' | 'validation' }` に統合し、`PhaseCOutOfScopeDoc { reason, observedCategory, observedConfidence }` と合わせて全 5 カテゴリで分類。保全式 `candidatesIn = writtenDocs + preconditionFailedDocs + skippedImmutable + unprocessableDocs + outOfScopeDocs` を artifact + orchestrator test で構造的に保証 (silent drop 防止)
- **lock 順序 finalize → release (Codex 2nd Critical 1 反映)**: lock release を finalize の **後** に固定。Codex 1st 反映で Evaluator MEDIUM (lockReleasedAt が finalize 開始時刻) を解消しようとして lock 順序を逆にしたが、Codex 2nd でこれが production-unsafe window (finalize 失敗時に別 run が同 env lock 取得可能 + writes committed + manifest.phaseC 未反映) と判明 → 元の順序に戻し、`lockReleasedAt` field 意味を「release 要求時刻」と JSDoc 明示で trade-off
- **idempotency (Codex 2nd Important 1 反映)**: immutableSkipChecker に `'already backfilled (provenanceBackfill present)'` reason 追加。`provenanceBackfill !== undefined && !== null` (null sentinel 禁止 = Codex 3rd I3 維持) → skip。これにより同 run retry / 別 Phase C run 同時実行で既 backfilled doc を再書込する経路を構造的に閉鎖
- **rate limiter 共通通過 (BF23)**: TokenBucketRateLimiter を RateLimiter interface に抽象化し、batchWriter (batch size 分一括 acquire) と individualRetryWriter (各 attempt 1 token acquire) が同一インスタンスを共有。突発書込 rate 増加防止を構造的に保証
- **cross-process determinism 注意 (code-reviewer #1 反映)**: sha256ProvenanceBackfill JSDoc に「Phase D verification 時は `createBackfillProvenance` factory 再 invoke で metadata 再構築してから sha256 比較、Firestore data() 直 stringify は使わない (key insertion order が cross-process で異なる可能性)」と明記 (memory `feedback_deterministic_cross_process.md`)
- **caller-bug 観測軸分離 (code-reviewer #3 反映)**: individualRetryWriter で `lastUpdateTimePreconditions` Map entry 不在 / `ProvenanceValidationError` を `preconditionFailedDocs.reason='lastUpdateTime drift'` と誤分類していたのを、`unprocessableDocs.reason='missing' | 'validation'` に分離。drift (Firestore 状態変化) と caller-bug (実装側の問題) を別観測軸で artifact 化

### 教訓 (本セッション新規)

- **Codex MCP review は destructive migration では複数 round 必須**: Phase C は本番 Firestore write を含む初の PR で、Codex MCP review が 1st NO-GO (Critical 2) → 2nd NO-GO (Critical 1) → 3rd GO の 3 round 必要だった。**1 round で済む期待をせず、3 round 想定で work estimation する**。前 session (Phase A/B) は 2 round で完了したが、destructive write を含む phase は安全性が指数的に複雑化するため余裕を持つ
- **review 反映の副作用検証必須**: Codex 1st 反映で Evaluator MEDIUM (lockReleasedAt 順序) を解消するため lock 順序を逆にしたが、これが Codex 2nd Critical (production-unsafe window) を引き起こした。**review 指摘を反映する際、その反映が別の invariant を壊さないか毎回 Codex review に再投入する**。impl-plan §4.3 の元設計 (finalize → release) は理由があって設計されており、Evaluator が見落とした観点 (artifact 整合性) を Codex 2nd が補完した
- **保全式 (invariant equation) は AC strict adherence の最強検証**: `candidatesIn = writtenDocs + preconditionFailedDocs + skippedImmutable + unprocessableDocs + outOfScopeDocs` を artifact + test で書き出すと、新カテゴリ追加忘れや silent drop が即時 fail する。**多状態を扱う module では、入力 = 出力カテゴリ合計の保全式を明示すること**。Codex 1st Critical 2 (silent drop) を発見できたのも保全式の欠如が顕在化したから
- **依存性逆転 interface は production / test 両方で機能**: RateLimiter / LockObjectStore / FirestoreBatchAdapter / FirestoreIndividualAdapter / ArtifactStorageReader / ArtifactStorageWriter の 6 interface で抽象化したことで、unit test (in-memory fake) と production wire (adapters.ts) を完全分離。60 unit tests は Firebase / GCS 接続なしで動作、production 動作検証は dev rehearsal S2 stage に分離

### 次セッション着手項目

1. `/catchup` で本 handoff + Issue #432 状態 + open Issue 確認
2. **PR-D4 S1-5 着手** (Phase D 実装、verify + gate behavior、BF12/BF13/BF15): Phase C 書込 doc 全件再読込 + `provenance` + `provenanceBackfill` の field 整合 verify + `derived-bytes-verified` doc で rotate API call (dev fixture) → 成功 + `child-snapshot-only` (dev fixture) で `failed-precondition` reject 確認 + integration test (本番 doc 副作用なし) + coverage 比率 artifact 出力
3. **PR-D4 S1-6**: Dockerfile + `.github/workflows/pr-d4-backfill.yml` (workflow_dispatch + env/phase 選択)
4. **PR-D4 S1-7**: container build + push (dev で実行) → image tag 取得 (= S1 完了条件)
5. **PR-D4 S2-S7**: dev rehearsal 7-stage × 2 周 → Codex MCP 5th review GO 確認 → cocoro / kanameone 段階展開 (各 phase ユーザー番号認可)

---

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

session29-71 は `docs/handoff/archive/2026-04-history.md` / `docs/handoff/archive/2026-05-history.md` 参照。
