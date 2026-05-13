# ハンドオフメモ

**更新日**: 2026-05-14 session68 (**Issue #445 PR-D2 完遂: splitPdf provenance 10 fields 必須化 + 3-stage source snapshot + concurrent write 検出 + atomic batch.commit + cleanup helper + 5 段階品質ゲート全通過 + main merge `cb8d94a` + main CI/Deploy success、Net 0**。session67 で確立した ADR-0016 設計合意を実装フェーズへ移行。Codex MCP 2 段階セカンドオピニオン (impl-plan + post-impl、thread `019e231a-...`) で計 High 4 + Medium 5 + Low 5 を発見・全反映、`/simplify` 3 agent 並列で HIGH 1 (sha256Hex 抽出) + MEDIUM 2 (Buffer.from dedup) を反映、`/safe-refactor` 0 件、Evaluator 分離プロトコル (5+ files 発動) で APPROVE + LOW 3 反映 (endPage > PDF ページ数 invalid-argument 早期 abort)、`/review-pr` 6 agent 並列で Critical 3 (HttpsError ラップで INTERNAL 潰れ防止) + Important 3 (FE provenance クリア + 軽微 cleanup) を反映。Issue #432 P0 collision の構造的予防を確立 (Storage path 衝突は新規クライアント環境で原理的に発生不可能、source identity bit-perfect 証拠 5 fields + child identity 4 fields + audit 1 field = 10 fields の Firestore 永続化基盤完成)。次セッション着手候補: dev E2E 確認 (AC9) / kanameone・cocoro 本番展開判断 (別 PR + 番号認可) / PR-D3 (rotatePdfPages 改修) impl-plan)
**ブランチ**: `main` (PR #456 squash merge 完了、`cb8d94a`、main CI run `25828945451` ✅、main Deploy run `25828945465` ✅、pages build run `25828944667` ✅)
**フェーズ**: Phase 8 + 運用監視基盤全環境展開完了 + (session29-66 累積実績は archive 参照) + **Phase 8 (session67 = Issue #445 PR-D1 完遂 = ADR-0016 + DocumentProvenance 設計合意 / session68 = Issue #445 PR-D2 完遂 = splitPdf provenance 10 fields 実装、Net 0)** = Issue #432 P0 collision の構造的予防完成 (新規クライアント等価運用基盤の核心実装)

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

<a id="session66"></a>
## ✅ session66 完了サマリー (2026-05-13: Issue #432 PR-C3c AC15-3 強化 + Codex GO + main merge `83921b2` 完遂、Net 0)

session65 で実装した PR-C3c 初版が Codex MCP セカンドオピニオン (実装後 review、thread `019e1e7b-...`) で **NO-GO 判定**: 「計画書 v2 の AC15-3 (現在 GCS 状態との再計算照合) と実装の乖離」(loadAndValidateSurveyArtifact が artifact 内部の自己整合性のみで、survey T1 と classify T2 の drift 検出不能)。本セッションで AC15-3 強化 + dev リハーサル 2 周成功 + Codex 新 thread GO 判定 + main merge を完遂。

### 経緯

1. **catchup**: session65 handoff 確認、次セッション着手指示 1-9 をタスク化 (TaskCreate × 9)
2. **AC15-3 強化実装** (commit `eabab2a`、+733/-12、4 files):
   - `scripts/lib/sourceManifestDrift.ts` (新規 162 行): SourceManifestEntry vs CurrentGcsState の pure functions (`compareSurveyManifestToCurrentGcs` / `hasManifestDrift` / `formatDriftError` + 6 ステップ runbook 定数)
   - `scripts/classify-collision-docs.ts`: `fetchCurrentGcsState` (listing + getMetadata 並列 8、bytes/sha256 非計算で軽量) + `verifySurveyManifestAgainstCurrentGcs` (local skip / bucket+prefix mismatch fail-fast / drift exit 2 + runbook 出力) を追加、`main()` で `loadAndValidateSurveyArtifact` 直後に呼出
   - `scripts/execute-collision-migration.ts`: write phase precondition drift exit 1 メッセージに同 runbook を追加 (AC15-3 drift と precondition drift は同根 = concurrent write)
   - `functions/test/sourceManifestDrift.test.ts` (新規 19 tests): pure functions 全分岐カバー
3. **tsc + npm test**: tsc clean / **1018 passing** (前 998 → +19 + 1 微差、regression 0)
4. **commit + push** → CI run `25772551392` ✅ success
5. **dev リハーサル 7 stages (2 周目、AC15-3 強化版)** 全 success:
   - Stage 3 で `AC15-3 PASS: 4 survey entries match current GCS state (no drift)` ログ確認
   - Stage 5 destructive で `executed:4 + skipped:2` (regen×2 + migrate×1 + mark-error×1 + manual-review×2)
   - Stage 6 idempotency `skipped:6` (4 already-applied + 2 manual-review)
6. **Codex MCP セカンドオピニオン (新 thread、AC15-3 強化後の最終 review)**: **GO 判定 (AC15-3 充足)** + High 1 件指摘 (local survey artifact が GCS classify を bypass する穴) + 設計判断 5 項目すべて妥当判定 (local skip / bucket-prefix fail-fast / getMetadata 失敗を drift 扱い / generation 不一致時に metageneration 比較 skip / bytes/sha256 非計算軽量化)
7. **Codex review High 1 件反映** (commit `032c04e`、+11/-2): `ALLOW_LOCAL_SURVEY_ARTIFACT=1` 環境変数 opt-in 必須化、それ以外は exit 2 で reject
8. **PR #452 ready for review** + body に session66 追記 → ユーザー番号認可「PR #452 をマージしてよい」取得 → **squash merge `83921b2`** → main CI/Deploy success
9. **handoff (session66)**: session61-65 を archive へ移動、LATEST.md を 595 行 → ~150 行 に削減

### Issue Net 変化

| 項目 | 内容 |
|------|------|
| Close 数 | 0 件 (Issue #432 は未 close、kanameone 本番展開後に close 判断) |
| 起票数 | 0 件 |
| **Net 変化 (session66 単独)** | **0 件** |

**Net 0 の進捗判定**: ✅ 正の構造的進捗。Issue #432 (P0) 根本対策 PR-C3 計画 (AC 21 項目) **全達成**、kanameone 135 docs CCITTFaxDecode Ambiguous 倒れの解消経路を **dev リハーサル 7 stages × 2 周 destructive 実証** で構造的に確立。本番展開判断は別 PR + 番号認可 (本セッション scope 外)。triage 基準 #5 (ユーザー明示指示「次のアクション優先順にすすめて」「PR #452 をマージしてよい」) 該当。

### 主要 PR / 実行記録

| 項目 | 値 |
|---|---|
| **本 PR (PR-C3c)** | **PR #452 merged** (squash commit `83921b2`、7 commits、13 files +2,372/-122) |
| commit (session66 AC15-3 強化) | `eabab2a` (4 files +733/-12) |
| commit (session66 Codex High 反映) | `032c04e` (1 file +11/-2) |
| CI on `032c04e` | run `25773523830` ✅ success |
| dev リハーサル 2 周目 Stage 1-7 | runs `25772656560` - `25773276670` 全 ✅ |
| Codex MCP セカンドオピニオン thread (新、AC15-3 強化後) | 結果ファイル `/tmp/codex-ac153-result.log` (GO + High 1) |
| main CI (post-merge) | run `25773711722` ✅ success |
| main Deploy (post-merge) | run `25773711749` ✅ success |

### AC 達成状況 (PR-C3 計画 21 項目、最終状態)

| AC | 達成 | 根拠 |
|---|---|---|
| AC13 / AC13 拡張 | ✅ | hashAlgorithm + pdfLibVersion 記録 + execute gate (PR-C2/C3a) |
| AC15-1 / AC15-2 | ✅ | classify `--survey-artifact` 必須 + expectations 検証 (PR-C3c session65) |
| **AC15-3** | ✅ **新規完遂** | **session66 強化**: 自己整合性 + 現在 GCS state 照合 (listing + getMetadata 並列 8、drift 5 種検出) |
| AC16 / AC17 / AC20 / AC21 | ✅ | 固定 synthetic fixture 6 種 + cross-process invariance + survey `--expect-*` + denylist scope 限定 (PR-C3b) |
| AC18-1/18-2/18-3 | ✅ | provenance 6 fields 完備 + runtime 親 PDF sha256+metadata 照合 (PR-C3c session65) |
| AC19-1/19-2 | ✅ | 4 category → action マッピング + provenanceRequired 必須 (PR-C3c session65) |
| AC-SCHEMA-1/2 | ✅ | `schemaVersion='collision-plan-v3'` literal 比較 (PR-C3c session65) |
| AC-CC1-1/CC1-2 | ✅ | classify plan に lockfileHash + pdfLibLockfileVersion 記録 + execute gate (PR-C3c session65) |
| AC-PREFLIGHT-1/2 | ✅ | 2-pass preflight + 全件通過後 write phase (PR-C3c session65) |
| AC-SURVEY-MANIFEST | ✅ | survey + classify + execute で sourceManifestRef 受け渡し (PR-C3c session65+66) |
| AC-INVARIANT | ✅ | action ↔ provenanceRequired invariant gate (PR-C3c session65) |
| AC-NONRESTRICTIVE-1 | ✅ | dev リハーサル 2 周目 Stage 3 `Provenance computed: 2 | failed: 0` |
| AC-PRD-BRIDGE | 🟡 | PR-D2 (Issue #445) で Firestore 永続化、ADR-0016 で記録予定 (本 PR 範囲外) |

### 残 Open Issue (5 件、session65 から不変)

| # | タイトル要約 | 状態 | 再開条件 |
|---|---|---|---|
| **#432** | [P0] 分割PDF 設計バグ | **PR-A/B/C1/C2/C2-execution-A/D/C3a/C3b/C3c (session66 main merge `83921b2`) 完遂** | 次セッションで kanameone / cocoro 本番展開判断 (別 PR + 番号認可)、復旧確認後 close |
| **#445** | [P1] データモデル正規化 | 設計フェーズ | 次セッションで PR-D1 (ADR-0016 + 型定義) 着手候補 |
| #402 | searchDocuments OOM ガード | 段階1 完了 | 観測データ判断 |
| #251 | summaryGenerator unit test | Scope 2 完了 | sinon 導入伴う他タスク or Vertex AI false negative |
| #238 | force-reindex 孤児 posting 検出 | 未着手 | 観測データ蓄積後 |

### 教訓 (本セッション新規)

- **Evaluator APPROVE と Codex MCP NO-GO の判定差は AC 解釈の差**: session65 で確立した知見 (handoff archive 参照)。session66 で AC15-3 強化 + 新 thread Codex で GO 判定取得、両者の判定が一致したことで「計画書文面 ↔ 実装 ↔ Codex 一次解釈」の 3 者整合を実証。**5 段階 review (計画書 → 実装 → Quality Gate → Evaluator → Codex MCP) が destructive migration の必須プロセス**として確立。
- **Codex review High 1 件 (local artifact bypass) は env var opt-in で塞ぐ pattern**: `ref.bucket === 'local'` の早期 return が GCS classify を silent bypass する穴を、`ALLOW_LOCAL_SURVEY_ARTIFACT=1` 明示 opt-in で reject default に転換。通常 workflow 経路 (GCS bucket) は影響なし、test/CI debug の例外パスのみ env var で承認。**operator 誤投入の silent bypass を構造的に塞ぐ pattern** として今後の destructive script 設計の参考に。
- **AC15-3 強化の pure functions 分離は Codex review fix を 1 commit で確定できる利点**: I/O 部分 (listing + getMetadata) と純粋比較ロジック (drift 検出) を `sourceManifestDrift.ts` に分離したことで、19 unit tests で全分岐を 7 秒 (test suite 全体 11 秒) でカバー。Codex High 反映時 (commit `032c04e`) は I/O 関数 1 か所のみ修正で済み、pure functions test は再実行のみで passing 維持。
- **dev リハーサル 7 stages × 2 周は AC15-3 強化のリグレッション安全網として機能**: session65 で 1 周、session66 で 2 周目を実施。session65 と同じ 6 ops (MatchedByHash 1 + RepairableMissingFile 2 + Ambiguous 2 + LostOrUnrecoverable 1) を再現、Stage 3 で AC15-3 PASS ログ + Stage 5 で executed:4 + Stage 6 idempotency で skipped:6 を確認。**destructive migration の dev フルリハーサル 2 周は CI green の延長線として運用可能**。

### 次セッション着手項目

1. `/catchup` で本 handoff + Issue #432 状態 + open Issue 確認
2. **kanameone 本番展開判断** (本 PR 範囲外、別 PR + ユーザー番号認可必須): PR #452 の AC15-3 + AC18 + AC-CC1 + AC-PREFLIGHT を使い、kanameone 135 docs CCITTFaxDecode Ambiguous の解消を実機実行。事前に pdf-feature-survey で本番状態確認 + dry-run で classify plan 確認 + 番号認可付き execute。**復旧後 Issue #432 close 判断**
3. **cocoro 本番展開判断** (同上): cocoro 環境での同等処理。被害 0 件想定だが念のため survey + dry-run で確認
4. **PR-D1 着手** (Issue #445、read-only/設計): データモデル設計 ADR-0016 (fileName identity 排除 + docId namespace identity + provenance fields 必須化) + TypeScript 型定義 + Firestore schema 文書化 — 本番展開と並行可能
5. (option) **reverse orphan 1 件** (`processed/20260413_未判定_未判定_p27-28.pdf`) 調査 (low priority、follow-up)

---

session51-65 は `docs/handoff/archive/2026-05-history.md` 参照。
session29-50 は `docs/handoff/archive/2026-04-history.md` 参照。
