# ハンドオフメモ

**更新日**: 2026-05-13 session64 (**Issue #432 PR-C3b 実装 + dev 実証 + Quality Gate 4 並列 review fix 完遂、Net 0、PR #450 進行中**。session63 の PR-C3a (read-only) を base に PR-C3b 第二段階を実装。`scripts/lib/pdfPageVisualFingerprint.ts` を v2 化 (denylist + image filter encoded bytes hash、AC21)、`scripts/fixtures/` に固定 synthetic fixture 6 種 (CCITT/JBIG2/JPX/DCT/encrypted/simple、AC16/AC20) を deterministic 生成、`scripts/pdf-feature-survey.ts` に `--expect-*` fail-fast guard (AC20)、`scripts/verify-pdf-determinism.ts` の child cwd + TS_NODE_PROJECT 修正 + 実 fixture --paths 検証経路実装 (AC17 拡張)。dev workflow runs #25765691451 (verify --paths PASS 6/6) + #25765692757 (survey --expect-* all satisfied) success 完遂。Quality Gate 4 並列 (code-reviewer / silent-failure-hunter / comment-analyzer / type-design-analyzer) で Critical 3 (getStreamBytesForHash bare catch / runChildFingerprint child stdout 検証 / fixture header docstring 事実誤認) + Important 6 (proc.error/signal 区別 / --check 例外連鎖 / v1 reject test / classifier reason 動的化 / survey JSON doc / workflow inputs 上限 / verify cwd why) を反映 (commit `c82ef53`)。次セッションは PR-C3c (AC15 classify gate + AC18 provenance 6 fields + AC19 MatchedByHash/RepairableMissingFile 分離) and/or PR-D1 並行着手候補)
**ブランチ**: `fix/issue-432-pr-c3b-fingerprint-v2` (PR #450、2 commits = 実装 `96745a4` + review fix `c82ef53`、CI 進行中)
**フェーズ**: Phase 8 + 運用監視基盤全環境展開完了 + (session29-58 累積実績は archive 参照) + Phase 8 (session59-60 = Issue #432 PR-C2 v2 段階完遂、Net 0) + Phase 8 (session61 = Issue #432 PR-C2-execution A 部分完遂 + CCITTFaxDecode 設計限界判明、Net 0) + Phase 8 (session62 = Issue #432 PR-C3 計画 AC 21 項目再起案 + session61 post-audit + PR-D #445 起票、Net +1) + Phase 8 (session63 = Issue #432 PR-C3a 実装 + dev 実証 + main merge、Net 0) + **Phase 8 (session64 = Issue #432 PR-C3b 実装 + dev 実証 + Quality Gate 4 並列 review fix、Net 0、merge 待ち)** 進行中

<a id="session64"></a>
## ✅ session64 完了サマリー (2026-05-13: Issue #432 PR-C3b 実装 + dev 実証 + Quality Gate review fix、Net 0、merge 待ち)

session63 の PR-C3a (read-only verifier/survey、main merge 済) を base に **PR-C3b 第二段階** を完遂。`pdf-page-visual-v2` (denylist + image filter encoded bytes hash) + 固定 synthetic fixture 6 種 + survey `--expect-*` fail-fast guard + verify `--paths` 経路実装。kanameone 135 docs CCITTFaxDecode Ambiguous 倒れの解消経路を技術的に開く。Quality Gate 4 並列 review で Critical 3 + Important 6 を反映 (PR #450 merge 前)。

### 経緯

1. **catchup**: session63 handoff 確認、次セッション着手候補「PR-C3b (コード変更のみ) and/or PR-D1 (read-only/設計) 並行可能」のうち PR-C3b を選択 (#432 P0 系列優先)
2. **`/impl-plan`**: 9 タスクに分解 (T1 fingerprint v2 / T2 固定 synthetic fixture / T3 survey --expect-* / T4 verify コメント / T5 tests / T6 classifier 型 additive / T7 workflow CI / T8 dev 実証 / T9 Quality Gate + merge)
3. **branch 作成**: `fix/issue-432-pr-c3b-fingerprint-v2`
4. **1st commit `96745a4` 実装** (15 files +775/-90):
   - `scripts/lib/pdfPageVisualFingerprint.ts` v2 化 (HASH_ALGORITHM bump、METADATA_DENYLIST 10 keys、PAGE_TREE_SCOPED_DENYLIST `/Parent`、OUTLINE_SCOPED_DENYLIST 4 keys、`getStreamBytesForHash` で image filter encoded bytes hash)
   - `scripts/fixtures/generate-fixtures.ts` (新規 349 行、deterministic 6 fixture 生成 + `--check` byte 単位再現性検証)
   - `scripts/fixtures/{simple,with-dctdecode,with-ccittfaxdecode,with-jbig2decode,with-jpxdecode,encrypted}.pdf` (1026〜1240 bytes 各々、git commit)
   - `scripts/pdf-feature-survey.ts` に `--expect-filter` / `--expect-subtype` / `--expect-encrypted` / `--expect-acroform` 追加 (fail-fast、exit 1)
   - `scripts/verify-pdf-determinism.ts` の child cwd + TS_NODE_PROJECT 修正 (TS5109 回避、local + CI 両対応)
   - `scripts/lib/collisionClassifier.ts` `FingerprintAlgorithm` を `'v1' | 'v2'` union 拡張 (additive、breaking change なし)
   - `.github/workflows/run-ops-script.yml` に script choice 2 件追加
   - tests: `functions/test/pdfPageVisualFingerprint.test.ts` に v2 専用 describe block 4 つ (8 新 test)、`collisionClassifier.test.ts` で `unsupported-resource-filter` → `optional-content` 置換、`executeCollisionMigrationGate.test.ts` で makePlan default v2 化
5. **PR #450 作成** + 1st commit push
6. **dev workflow runs 並列 trigger** (PR branch `fix/issue-432-pr-c3b-fingerprint-v2`):
   - run `25765691451`: `verify-pdf-determinism --paths fixtures/*.pdf` → **success** (verdict PASS 6/6、CCITT/JBIG2/JPX/DCT は kind='ok' で cross-process invariant、encrypted は kind='unsupported' で同 reason 一致、artifact 取得)
   - run `25765692757`: `pdf-feature-survey --expect-filter /CCITTFaxDecode,/JBIG2Decode,/JPXDecode,/DCTDecode --expect-subtype /Image --expect-encrypted` → **success** (all expects satisfied、artifact 取得)
   - **AC17 拡張 (real fixture cross-process invariance)** + **AC20 (fixture が survey で /Filter assert)** dev 実証完了
7. **Quality Gate 4 並列 review** (code-reviewer / silent-failure-hunter / comment-analyzer / type-design-analyzer):
   - **silent-failure-hunter**: Critical 3 + High 5 + Medium 6 + Low 3 検出
   - **comment-analyzer**: Critical 1 + Important 5 + Nit 6
   - **code-reviewer**: Approve with 2 Important fixes
   - **type-design-analyzer**: No type-design changes required for merge (Enc 8 / Inv 8 / Useful 9 / Enforce 7)
8. **2nd commit `c82ef53` review fix** (7 files +150/-33):
   - **Critical 3**: getStreamBytesForHash bare catch → UnsupportedEncodingError specific / runChildFingerprint child stdout の parsed.kind ∈ {'ok','unsupported'} + hex 64-char 検証 / generate-fixtures header docstring の `updateMetadata=false` 言及削除 (pdf-lib API 不存在)
   - **Important 6**: spawnSync proc.error/proc.signal 区別 (HIGH-2) / --check 例外連鎖 (HIGH-3) / v1 plan reject test 追加 (MEDIUM-3) / classifier reason 文字列を evidence.algorithm 動的化 (I1/I4) / survey header JSON example に expectations 追記 (I5) / workflow inputs 上限 comment 更新 (I2、10→25 GitHub 2025-12-04 拡張) / verify cwd 修正コメント why 補強 (I3、TS5109 具体的故障モード明示)
9. **Defer to PR-C3c** (review で identified、本 PR scope 外): HIGH-1/4/5 / MEDIUM-1/2/4/5/6 / LOW 全 3 件 / FileResult/VerifyResult discriminated union 化
10. **Local verification 最終確認**: `npx tsc --noEmit` (scripts + functions) pass / `npm test` 965 passing (前 964 + v1 reject test 1) / `generate-fixtures --check` 6/6 OK / `verify --paths` verdict PASS 6/6

### Issue Net 変化

| 項目 | 内容 |
|------|------|
| Close 数 | 0 件 (Issue #432 は未 close、PR-C3b は第二段階) |
| 起票数 | 0 件 |
| **Net 変化 (session64 単独)** | **0 件** |

**Net 0 の進捗判定**: ✅ 正の構造的進捗。Issue #432 (P0) 根本対策 PR-C3 計画 (AC 21 項目) の **AC21 (denylist scope 限定) + AC16 (人工 fixture 拡張) + AC20 (fixture が survey で /Filter assert) + AC17 拡張 (real fixture cross-process invariance)** を達成、kanameone 135 docs CCITTFaxDecode Ambiguous 倒れの解消経路を技術的に開く。後続 PR-C3c の precondition 全充足 (AC18 provenance 6 fields + AC19 MatchedByHash/RepairableMissingFile 分離 + classify survey gate + execute provenance gate)。triage 基準 #5 (ユーザー明示指示「次のアクション優先順にすすめて」) 該当。

### 主要 PR / 実行記録

| 項目 | 値 |
|---|---|
| 本 PR (PR-C3b) | **PR #450** (`fix/issue-432-pr-c3b-fingerprint-v2`、2 commits、merge 待ち) |
| 1st commit (実装) | `96745a4` (15 files +775/-90) |
| 2nd commit (Quality Gate review fix) | `c82ef53` (7 files +150/-33) |
| dev workflow #1 (verify --paths) | `25765691451` ✅ success、verdict PASS 6/6 |
| dev workflow #2 (survey --expect-*) | `25765692757` ✅ success、all expects satisfied |

### AC 達成状況 (PR-C3 計画 21 項目中、本 PR で達成分)

| AC | 達成 | 根拠 |
|---|---|---|
| AC13 | ✅ 維持 | v2 plan algorithm 固定値照合、execute gate 既存 (PR-C2) |
| AC16 | ✅ **完全達成** | `scripts/fixtures/` に CCITT/JBIG2/JPX/DCT/encrypted 固定 synthetic + simple baseline の 6 種、deterministic byte 単位安定 (`--check` で 6/6 OK 確認) |
| AC17 | ✅ **拡張完全達成** | dev run #25765691451 で 実 fixture verdict PASS 6/6、cross-process invariance 実証完了 |
| AC20 | ✅ **完全達成** | `pdf-feature-survey --expect-*` fail-fast guard + dev run #25765692757 で all satisfied |
| AC21 | ✅ **完全達成** | denylist scope 限定実装 (METADATA / PAGE_TREE / OUTLINE)、未知 key 包含 (描画影響あり前提の安全側) |

### 残 Open Issue (5 件、session63 から不変)

| # | タイトル要約 | 状態 | 再開条件 |
|---|---|---|---|
| **#432** | [P0] 分割PDF 設計バグ | **PR-A/B/C1/C2/C2-execution-A/D/C3a/C3b + post-audit 完了 (C3b は merge 待ち)** | 次セッションで PR-C3c 着手 (classify survey gate + execute provenance gate + AC18/AC19 分離) |
| **#445** | [P1] データモデル正規化 | 設計フェーズ | 次セッションで PR-D1 着手候補 |
| #402 | searchDocuments OOM ガード | 段階1 完了 | 観測データ判断 |
| #251 | summaryGenerator unit test | Scope 2 完了 | sinon 導入伴う他タスク or Vertex AI false negative |
| #238 | force-reindex 孤児 posting | drift 未観測 | ADR-0015 silent failure metric ERROR or 削除済書類ヒット報告 |

### Quality Gate review 持越し (PR-C3c で対応)

- HIGH-1: verifyOne parent throw 時の child 短絡 (parent throw は library bug シナリオのみ、CRITICAL-1+HIGH-2 fix でカバー範囲拡大)
- HIGH-4: pdf-feature-survey aggregate partial parse failure 集計 (file-level errors への page-level errors 集約)
- HIGH-5: surveyGcs error message 取り違え (download vs surveyFile)
- MEDIUM-1/2/4/5/6: PDFRef dangling silent / PDFNull lock test / TOCTOU / surveyFile page accessor catch / fixture self-consistency check
- LOW 全 3 件: 空 catch / 空 dir silent / userUnit silent
- N2 系統的: PR 履歴コメント reduce (PR-C3c マージ後 一括棚卸推奨)
- type-design-analyzer: FileResult/VerifyResult discriminated union 化 (PR-C3c の consumer 設計と統合)

### 次セッション着手項目

1. **PR-C3c** (Issue #432、dev fixture 対象 destructive、要 codex セカンドオピニオン): classify-collision-docs に survey gate (AC15) + execute-collision-migration に provenance gate (AC18) + AC19 MatchedByHash/RepairableMissingFile 分離設計実装 + dev フルリハーサル 6 stage v2 再走
2. **PR-D1** (Issue #445、read-only/設計): データモデル設計 ADR (fileName identity 排除 + docId namespace identity + provenance fields 必須化) + TypeScript 型定義 + Firestore schema 文書化 — PR-C3c と並行可能
3. **Issue #432 reverse orphan 1 件** (`processed/20260413_未判定_未判定_p27-28.pdf`) 調査 (low priority、follow-up)

### 教訓 (本セッション新規)

- **pdf-lib API 仕様の前提を docstring に書く前にコード or 公式 d.ts で確認する**: `updateMetadata=false で save` と書いたが `SaveOptions` に該当 field なし。pdf-lib `PDFDocument.save(options)` は `useObjectStreams / addDefaultPage / objectsPerTick / updateFieldAppearances` のみ。「公式に存在しないメカニズムを前提にした設計は禁止」(CLAUDE.md MUST) に該当する潜在的事案を review (comment-analyzer C1) で catch。今後 pdf-lib 公式 .d.ts を参照してから docstring 化する。
- **bare `catch` は CRITICAL の温床**: silent-failure-hunter CRITICAL-1 で `getStreamBytesForHash` の bare catch を指摘。本物の構造異常を encoded bytes で「偽 PASS」させ MatchedByHash 誤判定リスクを生んでいた。CLAUDE.md「empty catch blocks are never acceptable」+ feedback_overcorrection_regression.md と同型の事案、TypeScript で `instanceof UnsupportedEncodingError` specific の捕捉に書き換え。
- **test 側に入れた pattern が production スクリプト側に反映漏れする**: silent-failure-hunter HIGH-2 で `proc.error` / `proc.signal` 区別が test ファイルに既に入っていたのに production verify-pdf-determinism.ts に欠けていた事案を catch。同 codebase 内の pattern 同期は機械的にできないため、review agent の存在価値が高い。
- **PR 履歴コメントは将来 rot の温床**: comment-analyzer N2 系統的問題として「(PR-C3a で...)」「(PR-C3b 修正)」のような注釈は git blame で十分復元可能。PR-C3 完了後の一括棚卸を計画。

---



<a id="session63"></a>
## ✅ session63 完了サマリー (2026-05-12: Issue #432 PR-C3a 実装 + dev 実証 + main merge、Net 0)

session62 で確定した PR-C3 計画 (AC 21 項目) の **第一段階 PR-C3a** を完遂。read-only な 2 script (PDF feature survey + cross-process determinism verifier) を実装、Quality Gate 4 種 (simplify/safe-refactor/review-pr/codex review) を経て dev 実証 + main merge。AC17 (C3b 着手前 main merge + dev cross-process invariance 実証) を達成し、後続 PR-C3b/c/d/e の前提を整備。

### 経緯

1. **catchup**: session62 handoff 確認、次セッション着手候補「PR-C3a (read-only) and/or PR-D1 (read-only) 並行着手」のうち PR-C3a を選択 (#432 P0 系列優先)
2. **branch 作成**: `fix/issue-432-pr-c3a-feature-survey-determinism`
3. **実装** (commit `7c28eb7`、3 files +1041/-1):
   - `scripts/pdf-feature-survey.ts` (新規): catalog/page/XObject feature 列挙、local + GCS 両対応、JSON artifact 出力
   - `scripts/verify-pdf-determinism.ts` (新規): pdf-page-visual-v1 fingerprint の same-process + cross-process invariance 実証、--synthetic で pdf-lib 生成 fixture 3 件内蔵 + --paths で既存 fixture も可
   - `.github/workflows/run-ops-script.yml`: script choice 4 件 (`pdf-feature-survey --source gcs --prefix original/`, `--prefix processed/`, `--prefix processed/ --limit 200`, `verify-pdf-determinism --synthetic`) + artifact upload 2 件
4. **/simplify** 3 並列レビュー: Critical 3 反映 (GCS 数千件 OOM 回避 = pagination + 8 並列 download + buffer 即解放 / silent download error → FileResult.errors 伝播 / firebase-admin 動的 require → static import)
5. **/safe-refactor**: LOW 1 (未使用 import `PDFRawStream` 削除)
6. **PR #447 作成** + 1st commit push、dev workflow run #25744877076 (verdict PASS 3/3) — ただし artifact upload `if` 条件が `== 'verify-pdf-determinism'` で完全一致判定だったため 0 件 (workflow_dispatch の入力 script が引数付き文字列 `verify-pdf-determinism --synthetic`)
7. **/review-pr** 4 並列 (code-reviewer + silent-failure-hunter + comment-analyzer + type-design-analyzer): Critical 4 + Important 3 検出
   - silent-failure-hunter HIGH 3: `surveyLocalPaths` の stat/readdir error 処理 / `runChildFingerprint` の writeFileSync を try 範囲内 / same-process mismatch を独立 `kind: 'non-deterministic'` に分離
   - comment-analyzer CRITICAL 1: synthetic fixture B の comment rot 修正 (実装は opacity + 円のみ、image XObject 未生成と明記)
   - code-reviewer Important 3: parseArgs `next===undefined` guard (両 script) / surveyLocalPaths 非再帰の docstring 明示 / verdict `totals` に ok / unsupportedPass / nonDeterministic 内訳追加
   - artifact upload `if` 条件を `startsWith` に修正 (commit `ac350ec`、3 files +139/-40)
8. **/codex review** (大規模 PR セカンドオピニオン、新 thread `019e1cd9-1dbc-7f43-80ef-527592566526`): Critical なし、Important 3 件 (AC17 は synthetic 経路のみで実 PDF `--paths` 経路は PR-C3b で追加 / AC20 の `--expect-*` assert は PR-C3b/c で fixture と一緒に / VerifyResult/FileResult discriminated union 化は PR-C3c consumer 設計と統合) — 全件 scope crawl 回避で PR description 明記 + 持越し
9. **dev 再実証**: workflow run #25745219139 (2m2s) で **verdict PASS / totals.ok=3 / totals.nonDeterministic=0 / totals.fail=0**、3 fixture 全件で same-process hex == cross-process hex 完全一致 (例: simple.pdf hex = `2754cd06...23d5` を parent + child 両プロセスで再現)、artifact 取得確認
10. **CI lint-build-test 異常 + 復旧**: 2nd commit (ac350ec) の CI run #25745221506 が「Install Playwright browsers」で 35 分超 stuck (前回 run は 7m17s で完遂)。ユーザー判断 Cancel + re-run を選択。空 commit `279ab15` push で新規 CI run #25746991318 をトリガー、**6m10s で success 完遂**
11. **PR #447 squash merge** (`62896c5`、ユーザー番号認可「#447 をマージしてよい」取得後)、main deploy success 1m54s (run 25747858380)
12. **handoff size 削減**: session56-58 を `docs/handoff/archive/2026-05-history.md` へ移動 (session62 で「次セッション持越し」と明示済の作業を消化)、LATEST.md footer 「session51-55 → session51-58 archive」と更新

### Issue Net 変化

| 項目 | 内容 |
|------|------|
| Close 数 | 0 件 (Issue #432 は未 close、PR-C3a は前提実装、続 PR-C3b/c/d/e あり) |
| 起票数 | 0 件 (本セッション新規 Issue なし) |
| **Net 変化 (session63 単独)** | **0 件** |

**Net 0 の進捗判定**: ✅ 正の構造的進捗。Issue #432 (P0) 根本対策 PR-C3 計画 (AC 21 項目) の AC17 (cross-process invariance dev 実証 + main merge) を達成し、AC15/AC16/AC20 の前提となる read-only 検証基盤を整備。後続 PR-C3b 着手の precondition 全充足。triage 基準 #5 (ユーザー明示指示「次のアクション優先順にすすめて」) 該当。

### 主要 PR / 実行記録

| 項目 | 値 |
|---|---|
| 本 PR (PR-C3a) | **PR #447 merged** (`62896c5`、squash、3 commits) |
| 1st commit (実装) | `7c28eb7` (3 files +1041/-1) |
| 2nd commit (review fix + artifact upload startsWith) | `ac350ec` (3 files +139/-40) |
| 3rd commit (CI re-trigger) | `279ab15` (empty) |
| 1st CI run | `25744872543` ✅ success 7m17s |
| Stuck CI run | `25745221506` ⚠️ Playwright install 35m+ → cancelled |
| Final CI run | `25746991318` ✅ success 6m10s |
| dev workflow #1 (verdict PASS、artifact 0 件 = if 条件 bug) | `25744877076` |
| dev workflow #2 (verdict PASS、artifact 取得確認) | `25745219139` |
| main deploy | `25747858380` ✅ success 1m54s |
| Codex MCP thread (PR-C3a review 用、新規) | `019e1cd9-1dbc-7f43-80ef-527592566526` (read-only) |

### AC 達成状況

| AC | 達成 | 根拠 |
|---|---|---|
| AC15 | ✅ 前提整備 | `pdf-feature-survey` を CI choice + artifact 化、PR-C3c classify gate の必須入力に消費可能 |
| AC16 | ✅ 前提整備 | `verify-pdf-determinism --synthetic` で pdf-lib 生成可能な 3 fixture 内蔵、生成不能 feature の synthetic 補完は PR-C3b で fixture 追加時に併せて実施 |
| AC17 | ✅ **完全達成** | dev run #25745219139 で verdict PASS 3/3 ok、main merge 済 (`62896c5`)、C3b 着手 precondition 全充足 |
| AC20 | 🟡 前提整備 | survey で feature 分布列挙可能、`--expect-*` parser guard は PR-C3b/c で fixture と一緒に追加予定 (Codex Important 反映) |

### Codex Important 持越し (PR-C3b/c で対応予定)

- 実 PDF `--paths` 経路で cross-process invariance 実証 (PR-C3b の fixture 追加と統合)
- pdf-feature-survey の `--expect-*` fail-fast parser guard (AC20 strict assert、PR-C3b/c で実装)
- `FileResult` / `VerifyResult` の discriminated union 化 (PR-C3c の classify-gate consumer 設計と統合、null fan-out → kind 判別で compile-time safety 強化)

### 残 Open Issue (5 件、session62 から不変)

| # | タイトル要約 | 状態 | 再開条件 |
|---|---|---|---|
| **#432** | [P0] 分割PDF 設計バグ | **PR-A/B/C1/C2/C2-execution-A/D/C3a + post-audit 完了** | 次セッションで PR-C3b 着手 (pdf-page-visual-v2 + denylist + 人工 fixture 拡張) |
| **#445** | [P1] データモデル正規化 (Issue #432 根本対策) | 設計フェーズ | 次セッションで PR-D1 (ADR + 型定義) 着手候補 |
| #402 | searchDocuments OOM ガード + 計測ログ | 段階1 完了、段階2/3 観測待ち | 観測データ判断 |
| #251 | summaryGenerator unit test + buildSummaryPrompt 分離 | Scope 2 完了、Scope 1/3 待機 | sinon 導入伴う他タスク or Vertex AI false negative |
| #238 | force-reindex 孤児 posting 検出モード | drift 実発生未観測 | ADR-0015 silent failure metric ERROR or 削除済書類ヒット報告 |

### 次セッション着手項目

1. **PR-C3b** (Issue #432、コード変更のみ): `scripts/lib/pdfPageVisualFingerprint.ts` v2 実装 (denylist 方式 = `/Author`/`/CreationDate`/`/ModDate`/`/ID` 等 metadata 除外 + Page tree `/Parent` / outline `/First`/`/Last` / navigation `/Prev`/`/Next` の scope 限定除外、AC21) + 人工 fixture 拡張 (CCITT/JBIG2/JPX/encrypted の固定 synthetic 補完、AC16/AC20) + `pdf-feature-survey --expect-*` parser guard 追加 + `verify-pdf-determinism --paths` 経路で実 fixture cross-process 実証 (AC17 拡張)
2. **PR-D1** (Issue #445、read-only/設計フェーズ): データモデル設計 ADR (fileName identity 排除 + docId namespace identity + provenance fields 必須化) + TypeScript 型定義 (型レベルで旧 identity を禁止) + Firestore schema 文書化 — PR-C3b と並行可能
3. **Issue #432 reverse orphan 1 件** (`processed/20260413_未判定_未判定_p27-28.pdf`、session61 発見) 調査 (low priority、follow-up)

### 教訓 (本セッション新規)

- **artifact upload `if` 条件は startsWith 必須**: workflow_dispatch の `inputs.script` choice が引数付き文字列 (`pdf-feature-survey --source gcs --prefix processed/` 等) の場合、完全一致 `== 'pdf-feature-survey'` では false になり artifact が 0 件。`startsWith(github.event.inputs.script, 'pdf-feature-survey')` で判定する。本 session で 1st commit でこれを見落とし、2nd commit で修正
- **CI hang 対処は cancel + 新 commit push**: GitHub Actions の cancel は即時ではなく Playwright install 中だと反映に時間がかかる。空 commit `git commit --allow-empty` を push して新規 CI run をトリガーする方が早い (旧 run は自然 cancel される)
- **block comment 内の `*/` は構文壊滅**: JSDoc 内に `/Resources/XObject/*/Filter` のような PDF パスを書くと `*/` がコメント終端と解釈され、後続テキストがコード扱いに。`/<name>/Filter` のような meta 表現に書き換える必要

---

<a id="session62"></a>
## ✅ session62 完了サマリー (2026-05-12: Issue #432 PR-C3 再起案 + post-audit + PR-D 起票、Net +1)

session61 の handoff 確認後、ユーザー指摘「いまのアプローチで本当に大丈夫か?」「破壊的にならず、kaname 問題解消、dev 主体、各クライアント等価運用」の 4 要件を構造的に満たすか再点検。Codex MCP セカンドオピニオン 2 thread を経由して PR-C3 計画の重大盲点を発見、AC を 12→21 項目に拡充。並行で session61 で execute した 4 docs の親 PDF provenance を遡及検証し、`verdict: suspect` 4/4 (rotation 痕跡) を確定。データモデル正規化 (fileName を identity に使わない) の根本対策を PR-D Issue #445 として起票。

### 経緯

1. **問題提起**: ユーザー指摘「破壊的にならず、kaname の問題対応を修正できて、dev が主となり他の各クライアントは基本は dev の内容を反映されているだけの状態。新しいクライアントが追加されても問題なく等しく運用が可能な状況となっているか?」→ 現 PR-C3 計画 (先行 Codex thread `019e1b56-...`) に 4 弱点を私が検出 (dev fixture 特化 / feature survey gate 未明記 / cross-process determinism 未検証 / kanameone 直行順序)
2. **Codex MCP セカンドオピニオン #1 (`019e1bc6-...`)**: 私の 4 弱点を Critical 2 (feature survey gate / cross-process determinism) + Important 2 に再評価、私の検出漏れ Critical 2 件追加 (親 PDF provenance gate / v2 fingerprint denylist 厳密化)、根本指摘 E (PR-C3 は修復アルゴリズム、新規クライアント運用には PR-D データモデル正規化が必須)
3. **案 D 採択**: B (post-audit) → A (PR-C3 再起案) + PR-D 並行起票
4. **Task #1 (post-audit)**: `scripts/audit-session61-parent-provenance.js` 新規 (read-only)、`.github/workflows/run-ops-script.yml` choice 追加 + `--out` 強制付与 + artifact upload。CI SA に `roles/logging.viewer` 未付与確認 (Cloud Logging 経路 scope 外)。dev で graceful skip (target docs 不在で exit 0) → kanameone 実機で **verdict: suspect 4/4** (parent metageneration=2 + updated≠timeCreated + rotatedAt 痕跡 + Storage path `_r<timestamp>` suffix = rotation 後親から regenerate)。**PR #444 merged**
5. **被害深刻度確認**: ユーザー質問「PDF ファイル自体が完全破損して復旧不可能など深刻なことは?」→ handoff archive 全体 (4498 行) + Issue #432 全 3 コメント grep 確認で **本番 LostOrUnrecoverable 0 件**、reverse orphan 1 件は Storage 実体生存。「完全復旧不可能」ケースなし確定
6. **Task #2 (PR-C3 再起案)**: `/impl-plan` で 5 段階分割 (C3a-C3e) + AC 17 項目 (旧 12 + Codex #1 + Critical 2 反映) を起案
7. **Codex MCP セカンドオピニオン #2 (`019e1c1e-...`)**: 新 thread で再評価 → **Critical 4 件追加 (AC18-21)**。特に **AC19 = 私の重大見落とし**: 初稿は「provenance verified 必須」を全 destructive action に課す設計だったが、それだと legacy 135 docs 全件 Ambiguous 降格で PR-C3 主目的失敗 → 正解は「MatchedByHash migrate-to-namespace は provenance 不要 (v2 fingerprint 一致が証拠)、RepairableMissingFile + collision loser regenerate のみ provenance verified 必須」の分離
8. **AC 21 項目最終形確定**: Issue #432 [#issuecomment-4430509019](https://github.com/yasushi-honda/doc-split/issues/432#issuecomment-4430509019) に追記
9. **Task #3 (PR-D 起票)**: Issue #445 起票、fileName identity 排除 + docId namespace identity + provenance fields 必須化 + rotatePdfPages 構造的修正 + backfill + 型/lint 禁止の 5 段階分割 (PR-D1〜D5)、PR-C3 との並行可能性明示 (PR-D 未完成でも PR-C3 は legacy Ambiguous 降格 or MatchedByHash 救済で動作)

### Issue Net 変化

| 項目 | 内容 |
|------|------|
| Close 数 | 0 件 |
| 起票数 | 1 件 (Issue #445 - ユーザー明示指示 #5 + rating 9 + confidence 95、構造的予防の長期 Issue) |
| **Net 変化 (session62 単独)** | **+1 件** |

**Net +1 の進捗判定**: 構造的予防策の起票 + 長期戦略の文書化として KPI 例外 (CLAUDE.md「Net ≤ 0 は進捗ゼロ扱い」の triage 基準 #5 該当)。session61 復旧の安全性確認 + PR-C3 計画の致命的盲点修正 + 新規クライアント運用の根本対策設計確立で、本セッションは Issue #432 全体の終結に向けた構造進捗大 (執行可能設計に到達)。

### Codex MCP セカンドオピニオン 2 段階で得た核心修正

#### 修正 1: AC19 (RepairableMissingFile / MatchedByHash の分離)

| 分類 | destructive action | provenance 要否 | 根拠 |
|---|---|---|---|
| **MatchedByHash** | `migrate-to-namespace` | **不要** | actual と expected の v2 fingerprint 一致自体が証拠 |
| **RepairableMissingFile** | `regenerate-from-parent` | **verified 必須** | 親 PDF 内容と過去 split の整合が必要 |
| **collision loser** | `regenerate-from-parent` | **verified 必須** | 同上 |
| **Ambiguous** | — (operator approval) | — | — |

→ kaname 135 docs の大半は MatchedByHash で救済可能、誤復旧リスクが残る operation のみ provenance gate で守る分離。

#### 修正 2: AC18 (provenance verified 6 fields 全一致)

```
parentDocumentId + splitFromPages + sourcePath + sourceBucket + generation + metageneration + sourceSha256
```

すべて一致して初めて `verified`。1 fields でも mismatch → Ambiguous + manual approval 降格。

#### 修正 3: AC20 (人工 fixture + 固定 synthetic 補完)

pdf-lib は CCITT/JBIG2/JPX/encrypted のネイティブ生成困難 → 生成不能 feature は固定 synthetic/minimal fixture or PII なし公開合成 sample で補完、fixture が survey で実際の `/Filter` を含むことを assert する test 必須。

#### 修正 4: AC21 (denylist scope 限定)

`/Parent` `/Prev` `/Next` `/First` `/Last` のグローバル除外禁止、Page tree / outline navigation / internal structural refs のみ scope 限定で除外。

### session61 復旧 4 docs の評価 (Task #1 結果)

| op | docId | parent | verdict | reasons |
|---|---|---|---|---|
| op-0136 | Lso7jEXzWxBjU4Cj6zqR | Xe6jCKoTk4yflHqefDtb | suspect | parent.metageneration=2 + updated≠timeCreated + rotatedAt 痕跡 + path `_r1778338356121` |
| op-0137 | M7i4Nx6khiYEo2KTGJHg | EkZ6bwIM3ji17UugWeEr | suspect | 同上 (path `_r1778339907915`) |
| op-0138 | U4Lf5ZPNA4IyH73SXE2P | FIGbegoDvfaUTO2cYHkI | suspect | 同上 (path `_r1778338966269`) |
| op-0139 | gifjllJ57Sx58TktzHCf | EkZ6bwIM3ji17UugWeEr | suspect | 同上 (path `_r1778339907915`) |

**3 親 PDF いずれも fileUrl が rotation 後の path (`_r<timestamp>` suffix) を指す**。session61 execute は rotation 後の親から regenerate しており、Codex 指摘「split 時の親と現在の親が同一」を満たしていない。視覚比較による rotation 前 内容との照合は backup 不在で構造的不能、ユーザー判断で **「rotation がページ内容保持 (向きのみ) なら復旧結果は実質正しい」前提で運用継続、将来予防 (PR-C3 + PR-D) に集中**の割り切り。

### 主要 PR / 実行記録

| 項目 | 値 |
|---|---|
| Task #1 PR | **PR #444 merged** (`6d42ad9`、audit script 334 行 + workflow 21 行) |
| Task #2 成果 | Issue #432 [#issuecomment-4430509019](https://github.com/yasushi-honda/doc-split/issues/432#issuecomment-4430509019) (AC 21 項目 + 5 段階分割 + provenance 設計) |
| Task #3 成果 | **Issue #445 起票** ([P1] データモデル正規化、bug+enhancement+P1) |
| Codex MCP thread (旧) | `019e1bc6-bbd9-7580-9442-08f8f534fd72` (PR-C3 6 提案 + Critical 2 + 根本指摘 E) |
| Codex MCP thread (新) | `019e1c1e-0fc8-70d1-a633-051f7521c4ee` (PR-C3 再起案再評価、Critical 4 件追加) |
| 本 PR (session62 handoff) | `docs/session62-handoff` (本 PR、handoff 追記) |
| kanameone audit run id | 25730687772 (✅ verdict suspect 4/4 確定) |
| dev smoke test run id | 25730427085 (✅ graceful skip exit 0) |

### Codex Important 指摘 (PR-C3 実装時注意)

- denylist 対象 dict scope を Page tree / outline / annotation で別管理 (実装時の lint check)
- image XObject survey で `/Filter` 配列, 複数 filter, `/DecodeParms` 配列, indirect object, `/Alternates`, `/SMaskInData`, `/Matte`, `/OPI` を可視化
- `metageneration` 変化での mismatch 判定は自動復旧率低下するため runbook 明記

### handoff サイズ最適化 (次セッション持越し)

LATEST.md が現時点 649 行 (目標 500 行超過)。session56-58 (PR-A/B/D + PR-C1 完遂) を archive/2026-05-history.md へ移動する作業を次セッション開始時に実施 (本セッションは session62 entry 追加優先で size 削減は持越し)。

### 残 Open Issue (5 件)

| # | タイトル要約 | 状態 | 再開条件 |
|---|---|---|---|
| **#432** | [P0] 分割PDF 設計バグ | **PR-A/B/C1/C2/C2-execution-A/D + post-audit 完了、PR-C3 計画 AC 21 項目確定** | 次セッションで PR-C3a (read-only) 着手 |
| **#445** | [P1] データモデル正規化 (Issue #432 根本対策) | **本セッション起票、設計フェーズ** | 次セッションで PR-D1 (ADR + 型定義) 着手候補 |
| #402 | searchDocuments OOM ガード + 計測ログ | 段階1 完了、段階2/3 観測待ち | 観測データ判断 |
| #251 | summaryGenerator unit test + buildSummaryPrompt 分離 | Scope 2 完了、Scope 1/3 待機 | sinon 導入伴う他タスク or Vertex AI false negative |
| #238 | force-reindex 孤児 posting 検出モード | drift 実発生未観測 | ADR-0015 silent failure metric ERROR or 削除済書類ヒット報告 |

### 次セッション着手項目

PR-C3a と PR-D1 は両方 read-only で並行可能。ユーザー判断:

1. **PR-C3a 実装** (Issue #432): `scripts/verify-pdf-determinism.ts` 新規 (cross-process invariance 検証、pdf-lib `embedPdf` の encoded bytes 保持を実証) + `scripts/pdf-feature-survey.ts` 新規 (本番 PDF の `/Filter` 分布事前列挙)。AC17 先行で C3b 着手前に main merge 必須。dev run で実証完了が完了条件
2. **PR-D1 実装** (Issue #445): データモデル設計 ADR 起案 + Firestore schema 文書化 + TypeScript 型定義 (fileName を identity に使わない型強制の設計)
3. **handoff サイズ最適化**: session56-58 を archive/2026-05-history.md へ移動 (LATEST.md を 500 行以下に削減)
4. **Issue #432 reverse orphan 1 件** (`processed/20260413_未判定_未判定_p27-28.pdf`) 調査 (low priority、follow-up)

<a id="session61"></a>
## ✅ session61 完了サマリー (2026-05-12: Issue #432 PR-C2-execution A 部分完遂、Net 0)

session60 で merge した PR-C2 v2 (pdf-page-visual-v1 fingerprint) を kanameone 本番に classify 実行したところ、**135 docs 全件 CCITTFaxDecode 未対応で Ambiguous 倒れ**。dev fixture には CCITTFaxDecode サンプルがなく Codex MCP セカンドオピニオン (Important 4: DCTDecode/JPXDecode 未対応) でも見落とした。ユーザー判断で「A + B ハイブリッド」採用、A = RepairableMissingFile 4 件のみ番号認可付き execute (✅ 全件成功)、B = 残 135 Ambiguous は PR-C3 で対応。

### 経緯

1. **PR #440 (session59-60 handoff) merge** (`da9a348`、squash merge、CI 全 SUCCESS)
2. **新ブランチ `fix/issue-432-pr-c2-execution` 作成**、PR-C2-execution 着手
3. **cocoro classify dry-run** (GitHub Actions workflow_dispatch、CI SA 経由): `totalGroups: 0 / collisionDocs: 0 / orphans: 0` ✅ (被害ゼロ環境、期待通り)
4. **kanameone classify dry-run** (CI SA 経由): `totalGroups: 45 / totalCollisionDocs: 135 / totalOrphans: 4`、`byClassification: { MatchedByHash: 0, Ambiguous: 135, RepairableMissingFile: 4, LostOrUnrecoverable: 0 }`
5. **Ambiguous 135 件の reason 分析**: ほぼ全件 `unsupported-pdf-feature: unsupported-resource-filter (page 0 resources canonical digest failed: /CCITTFaxDecode stream encoding not supported)`
   - **/CCITTFaxDecode = CCITT Group 3/4 FAX 圧縮**、スキャナ生成 PDF / FAX 出力で最頻出。kanameone のスキャン書類は大半がこの形式
   - PR-C2 `canonicalPageResourceDigest` が image stream decode 不能で例外 → `unsupported-resource-filter` で**設計通り** Ambiguous に降格 → Gate 0 (AC13) で destructive action reject
6. **ユーザー判断「A + B ハイブリッド」採用** (4 原則 §1 = AI は executor、ユーザーが decision-maker):
   - A = RepairableMissingFile 4 件 (op-0136 ~ op-0139) のみ番号認可で execute (リスク最小、orphan 解消で部分的に主目的達成)
   - B = 残 135 Ambiguous は PR-C3 で CCITTFaxDecode 対応 / 別 hash 戦略 / image-render-hash 等を Codex MCP セカンドオピニオン経由で設計
7. **workflow 改修 3 件 (本 PR の 3 commits)**:
   - `a187835` ci: classify-collision-docs の plan JSON を artifact 化 (log secret masking で `{` → `***` の回避)
   - `111d485` ci: execute-collision-migration を workflow_dispatch に追加 (plan artifact + 入力 opIds から approval.json を動的生成、`exec_args_json` 1 input 追加)
   - `f7e8567` ci: --operations フィルタ追加 (approval 外 op を gate-rejected exit 1 にしないため、approvedOperationIds に二重 filter)
8. **kanameone execute (番号認可済)** (CI SA 経由):
   - Filter: op-0136, op-0137, op-0138, op-0139 (Processing 4/139)
   - ✅ op-0136 Lso7jEXzWxBjU4Cj6zqR (regenerate-from-parent): regenerated from parent and saved to docId namespace
   - ✅ op-0137 M7i4Nx6khiYEo2KTGJHg: 同上
   - ✅ op-0138 U4Lf5ZPNA4IyH73SXE2P: 同上
   - ✅ op-0139 gifjllJ57Sx58TktzHCf: 同上
   - Summary: `executed: 4`、gate-rejected: 0
9. **post-audit (`audit-storage-mismatch`)** (CI SA 経由):
   - **fileUrl orphans: 4 → 0** ✅ (PR-C2 主目的部分達成)
   - **reverse orphans: 1 件新規発見** (`processed/20260413_未判定_未判定_p27-28.pdf` - Storage 実体あり Firestore 参照なし)
   - **fileName collisions: 45 → 47** (旧 Ambiguous 45 + 新 2 = PR-C2 復旧 4 docs が 2 fileName で 2 groups 増。docId namespace で物理 path は別なので正常副作用)

### Issue Net 変化

| 項目 | 内容 |
|------|------|
| Close 数 | 0 件 |
| 起票数 | 0 件 (Issue #432 にコメント追記のみ予定、reverse orphan 1 件は #432 内 follow-up に集約) |
| **Net 変化 (session61 単独)** | **0 件** |

**Net 0 の進捗判定**: ✅ 正の構造的進捗。Issue #432 (P0) の被害 4 docs を自動復旧 (silent breakage を実復旧で完遂)。残 135 Ambiguous は CCITTFaxDecode 設計限界として明確化し、PR-C3 の Codex セカンドオピニオン経由設計フェーズに移行可能。reverse orphan 1 件は新規発見だが Issue #432 と関連が薄く、別途調査して Issue 化判断 (rating ≥ 7 + confidence ≥ 80 のみ起票)。

### dev → kanameone での設計限界判明 (PR-C2 教訓 #3 の再演)

session60 handoff の教訓「fixture が本番欠陥を隠蔽するアンチパターン」(#3) を **再び** 踏襲。dev fixture には CCITTFaxDecode サンプルを含めず、Codex MCP セカンドオピニオン (Important 4: DCTDecode/JPXDecode 未対応) で他 image filter は指摘されたが、**CCITTFaxDecode は明示的に列挙されなかった**。

PR-C3 設計時の対策:
- **kanameone 実 PDF を dev fixture に含める** (個人情報マスク版を最小限取得して `tests/fixtures/kanameone-sample-ccittfaxdecode.pdf` として)
- **本番 PDF feature 分布の事前調査** (`pdf-feature-survey.ts` 等で全本番 PDF の `/Resources/XObject/*/Filter` を列挙し、未対応 filter の存在を classify 前に検出)
- これは Codex セカンドオピニオン Suggestion: 「暗号化/AcroForm/optional content/encryption は自動復旧対象外、Ambiguous 明示」の延長

### workflow 改修詳細 (commits)

| commit | 内容 | 行数 |
|---|---|---|
| `a187835` | `ci(run-ops-script): classify-collision-docs の plan JSON を artifact 化` — log secret masking 回避、`actions/upload-artifact@v4` で plan-output.json 取得経路確立 | +20/-1 |
| `111d485` | `ci(run-ops-script): execute-collision-migration を workflow_dispatch に追加` — script choice 2 件 + `exec_args_json` input + Parse step (jq validate, planRunId 数字 / opId `op-NNNN` 正規表現) + Download artifact step (`actions/download-artifact@v4` with `run-id`) + Generate approval JSON step (plan の op 抽出 + `gs://<bucket>/<path>` で approvedPaths 展開 + opId 数の整合検証) + Run script step に分岐追加 | +114/-0 |
| `f7e8567` | `ci(run-ops-script): execute-collision-migration に --operations フィルタ追加` — plan 内の approval 外 op を gate-rejected で exit 1 にしないため、approvedOperationIds に二重 filter (approval + operations) | +8/-0 |

### 復旧した 4 docs の詳細 (番号認可 + execute 結果)

| operationId | docId | parentDocumentId | splitFromPages | sourcePath (orphan、削除なし、404 silent skip) | destPath (新規 write、復旧完了) |
|---|---|---|---|---|---|
| op-0136 | `Lso7jEXzWxBjU4Cj6zqR` | `Xe6jCKoTk4yflHqefDtb` | 1-2 | `processed/20260509_未判定_未判定_p1-2.pdf` | `processed/Lso7jEXzWxBjU4Cj6zqR/20260509_未判定_未判定_p1-2.pdf` |
| op-0137 | `M7i4Nx6khiYEo2KTGJHg` | `EkZ6bwIM3ji17UugWeEr` | 3 | `processed/20260509_未判定_未判定_p3.pdf` | `processed/M7i4Nx6khiYEo2KTGJHg/20260509_未判定_未判定_p3.pdf` |
| op-0138 | `U4Lf5ZPNA4IyH73SXE2P` | `FIGbegoDvfaUTO2cYHkI` | 3 | `processed/20260509_未判定_未判定_p3.pdf` | `processed/U4Lf5ZPNA4IyH73SXE2P/20260509_未判定_未判定_p3.pdf` |
| op-0139 | `gifjllJ57Sx58TktzHCf` | `EkZ6bwIM3ji17UugWeEr` | 1-2 | `processed/20260509_未判定_未判定_p1-2.pdf` | `processed/gifjllJ57Sx58TktzHCf/20260509_未判定_未判定_p1-2.pdf` |

### 主要 PR / 実行記録

| 項目 | 値 |
|---|---|
| **本 PR** (session61) | `fix/issue-432-pr-c2-execution` PR #442 (4 commits + dev フルリハーサル commit) |
| classify planId (kanameone) | `plan-2026-05-12T04-21-39-187Z-eca5b3f3` |
| classify run id (kanameone) | 25713096820 |
| execute --dry-run run id (kanameone) | 25713588277 (4 ops `all gates passed; would execute`) |
| execute (destructive) run id (kanameone) | 25713911985 (4 ops ✅ executed) |
| post-audit run id (kanameone) | 25714003425 (orphans 4→0、reverse 1 件発見) |

### dev フルリハーサル (本セッション中盤、ユーザー指摘で追加実施)

ユーザー指摘「`dev → クライアント` 順序を飛ばしていないか」を受け、kanameone 実行後に dev で workflow 改修部分のフルパス再検証を実施。過去の PR-C1/PR-C2 でも `dev execute まで通したことがない` 共通の見落としを補完する目的。

| Stage | Run ID | Result |
|---|---|---|
| 1. setup-collision-fixture --dev | 25717762881 | ✅ 5 docs (excl. parent) covering 4 classifications |
| 2. classify-collision-docs | 25717863184 | ✅ planId `dba3864a`、`MatchedByHash:1, Ambiguous:2, RepairableMissingFile:2, LostOrUnrecoverable:1` (session60 と同一構成、cross-process determinism 再現確認) |
| 3. execute --dry-run | 25717985363 | ✅ 2 ops (op-0003, op-0006 = RepairableMissingFile) `all gates passed`、gate-rejected: 0 |
| 4. execute (destructive、dev fixture 対象) | 25718095580 | ✅ 2 ops `regenerated from parent and saved to docId namespace` |
| 5. audit-storage-mismatch | 25718205231 | ✅ fileUrl orphan: 1 (LostOrUnrecoverable 1 件、execute 対象外で設計通り残存) |
| 6. cleanup | 25718319642 | ✅ fixture cleanup completed |

**dev フルリハーサルの意義**: 本 PR で新規追加した workflow 改修 (Parse exec args / Download artifact / Generate approval JSON / --operations filter) の動作を dev fixture で実機検証。session58 (PR-C1)、session60 (PR-C2 v2) では `execute まで dev で通したことがない` 共通の見落としがあり、本セッションで初めて補完。次セッション以降の PR-C3 開発でも本 workflow を再利用できる信頼性を確立。

### dev フルリハーサル順序を初動で見落とした reflexion

ユーザー指摘前は「session60 handoff『dev fixture 再実行不要』」を字義解釈し cocoro → kanameone へ直行。session60 計画時点では **本 PR の workflow 改修は計画外**で、session61 で新規 CI コードを追加した時点で前提が変わったことに気づくべきだった。kanameone 実行 4 docs 復旧は結果的に成功したが、プロセスとしては「destructive 実行を含む CI 改修の dev 事前検証なし」という基本安全ルール違反。同パターンが PR-C1 / PR-C2 でも繰り返されており、今回 dev フルリハーサルで構造的に補完。memory `feedback_destructive_ci_dev_rehearsal.md` 新規追記候補。

### 残 Open Issue (4 件)

| # | タイトル要約 | 状態 | 再開条件 |
|---|---|---|---|
| **#432** | [P0] 分割PDF 設計バグ | **PR-A/B/C1/C2/C2-execution-A/D 完了、PR-C3 必要** (CCITTFaxDecode + 135 Ambiguous + reverse orphan 1 件) | 次セッションで PR-C3 計画 (Codex MCP セカンドオピニオン) |
| #402 | searchDocuments OOM ガード + 計測ログ | 段階1 完了、段階2/3 観測待ち | 観測データ判断 |
| #251 | summaryGenerator unit test + buildSummaryPrompt 分離 | Scope 2 完了、Scope 1/3 待機 | sinon 導入伴う他タスク or Vertex AI false negative |
| #238 | force-reindex 孤児 posting 検出モード | drift 実発生未観測 | ADR-0015 silent failure metric ERROR or 削除済書類ヒット報告 |

### 次セッション着手項目 (PR-C3 計画 — Codex MCP 起案済)

PR-C2-execution A 完遂直後 (session61 後半) に Codex MCP セカンドオピニオン (read-only, threadId `019e1b56-5cc7-76d0-b156-83549e833a71`) を取得済。**主な発見: CCITT decoder の自前実装 (or 外部ライブラリ追加) は不要**。画像 XObject を decode せず raw encoded bytes + Filter + DecodeParms + 描画関連 dict keys を hash すれば CCITT/JBIG2/DCT/JPX 全て同じ枠でカバー可能。

#### 推奨案: `pdf-page-visual-v2` (encoded resource fingerprint) 3 段構え

| 段階 | 内容 | 目的 |
|---|---|---|
| **主** | `pdf-page-visual-v2` encoded resource fingerprint | `/Subtype /Image` の binary stream は decode せず、encoded bytes + Filter + DecodeParms + Width/Height/BitsPerComponent/ColorSpace/ImageMask/Decode/SMask/Mask を canonical hash。Form XObject (content stream) は v1 同様 decoded/canonical 側で扱う |
| **補助** | PDF feature survey (`pdf-feature-survey.ts` 新規) | classify の **前段 gate** として全本番 PDF の filter/subtypes/encryption/AcroForm 等を集計、未対応 feature を事前検出。dev fixture の偏りを構造的に防ぐ |
| **fallback** | OCR hint + 手動 UI (将来 PR) | v2 でも Ambiguous に残る docs に対し OCR digest / suggestedWinner / page count を operator hint として提示。destructive 主証拠には使わない (PII + 偽陽性リスク) |

#### 4 選択肢評価 (Codex 結論)

| 選択肢 | 評価 | 採否 |
|---|---|---|
| a (CCITT decoder 実装) | バグ面が広い、画像仕様差で偽陽性/偽陰性 | **却下** → a の変形「encoded bytes hash」を採用 |
| b (pdfjs-dist render → image hash) | CI Canvas/worker/font 安定化コスト高、render determinism 検証必要 | 主戦略には不採用、最終 fallback 候補 |
| c (OCR text hash) | 開発コスト最小だが destructive 主証拠には弱い (OCR vendor 差・PII) | operator hint に限定 |
| d (手動 UI) | 信頼性高いが 135 docs 運用負荷大 | 残 Ambiguous の運用 fallback (将来 PR) |

#### PR-C3 分割 5 段階

| PR | 内容 | destructive |
|---|---|---|
| **PR-C3a** | feature survey + CI workflow + runbook | read-only (生存 path 確認のみ) |
| **PR-C3b** | `pdf-page-visual-v2` 実装 + tests + dev fixture 拡張 (CCITT/JBIG2/DCT/JPX sample) | コード変更のみ |
| **PR-C3c** | classify/execute integration + dev フルリハーサル 6 stage 再走 (v2 で) | dev fixture 対象 |
| **PR-C3d** | kanameone classify artifact → limited destructive execute | **kanameone 番号認可必須** |
| **PR-C3e** | 残 Ambiguous の OCR hint / manual follow-up | 必要時のみ |

#### Acceptance Criteria (Codex 起案 12 項目要約)

1. `pdf-page-visual-v2` が CCITTFaxDecode を含む kanameone sample で `kind: ok` 返す
2. 同 parent+range を別 process で regenerate しても fingerprint 一致 (cross-process determinism、session59 教訓)
3. 異なる page range / image bytes / geometry / visible resources は不一致 (偽陽性防止)
4. `/Encrypt`, `/AcroForm`, `/OCProperties`, visible annotations は引き続き unsupported (operator UI へ)
5. `/DCTDecode`, `/JPXDecode`, `/JBIG2Decode`, `/CCITTFaxDecode` の image XObject は decode 不能でも raw encoded hash で処理可能
6. unknown filter は feature survey で検出 + Ambiguous reason に filter 名を明示
7. classify plan は `hashAlgorithm: "pdf-page-visual-v2"` + `pdfLibVersion: "1.17.1"` を記録 (AC13)
8. execute は v1 plan / pdf-lib version mismatch / env mismatch / path 未認可を reject
9. dev フルリハーサル 6 stage 通過 (session61 確立フロー再利用)
10. kanameone は first run を read-only survey + classify artifact のみに限定
11. destructive execute は operationId + exact path approval のみ通す
12. plan artifact/log に OCR text や PDF content bytes を出さない (PII 保護)

#### Codex 指摘: PR-C2 v2 で見落とした盲点 7 件

1. **resource stream を decoded bytes にする必要なし** ← 今回の核心 (encoded bytes hash で十分)
2. `unsupported-resource-filter` を「外部 decoder 不足」と扱うと CCITT/JBIG2/JPX の沼に入る
3. OCR hash は便利だが PII + 偽陽性で destructive proof には弱い
4. feature survey が classify 前段 gate になっていないと dev fixture の偏りを再演 (session58/60/61 共通教訓)
5. `actual+expected` のどちらが unsupported かだけでなく filter/subtype/object path を plan に出さないと operator 判断不能
6. Form XObject (content stream) と Image XObject (encoded binary) を分けて扱う (Form は decoded/canonical 側に残す)
7. image stream dict の描画 keys と metadata keys を分ける (過剰な偽陰性/偽陽性回避)

#### dev fixture 拡張 (PR-C3b)

- kanameone 実 PDF から **PII マスク済み CCITTFaxDecode sample** を最低 1 parent (これが session58/60/61 で欠けていた最大の盲点)
- 同 parent から split range を作り、actual Storage と expected regenerate が v2 で match する fixture
- 別ページだがテンプレが似た negative fixture (偽陽性防止)
- DCTDecode JPEG image PDF
- 可能なら JBIG2Decode / JPXDecode sample
- annotations / AcroForm / encryption は unsupported fixture として維持

#### リスクと緩和策

| リスク | 緩和策 |
|---|---|
| Ambiguous 残存 (CCITT 以外の特殊 PDF) | feature survey で事前把握 + 20 件以下は runbook、50 件超は operator UI |
| 偽陽性 destructive (誤マッチング) | `pageCount` + `splitFromPages` + parent id + v2 fingerprint を precondition 多重化、post-audit + sample visual inspection |
| pdfjs-dist 重量級依存 | 採用せず fallback のみに留める |
| PII 漏洩 (artifact/log) | plan/audit JSON に OCR text や PDF bytes を出さない、metadata のみ |

#### reverse orphan 1 件 (PR-C3 と別件扱い、PR-C3a 後に単独調査)

対象: `gs://docsplit-kanameone.firebasestorage.app/processed/20260413_未判定_未判定_p27-28.pdf`

- 「Firestore 参照なし Storage 実体あり」= 135 Ambiguous の逆向き問題
- 原因仮説: rotatePdfPages delete 副作用残骸 / deleteDocument の orphan / 過去手動操作 / PR-B 前の旧 path 残存
- 判断材料: Cloud Logging で該当 path/filename/`p27-28`/日付周辺の split/rotate/delete invocation 検索、Storage metadata (createdAt/generation/md5)、parent candidate `20260413...` の v2 fingerprint 一致確認
- 扱い: 別 artifact `reverse-orphan-investigation.json` を出し、復元すべき parent/docId が特定できれば PR-C3 follow-up で restore、特定不能なら exact path approval で削除

### Issue #432 への次回コメント案 (本 PR merge 後に追記)

- PR-C2-execution A 完遂報告: 4 docs 自動復旧、fileUrl orphan 4→0 confirmed
- B 残作業: 135 docs Ambiguous (`/CCITTFaxDecode`) は PR-C3 で別 hash 戦略
- reverse orphan 1 件新規発見: 別途調査予定

---

session51-58 は `docs/handoff/archive/2026-05-history.md` 参照。
session29-50 は `docs/handoff/archive/2026-04-history.md` 参照。
