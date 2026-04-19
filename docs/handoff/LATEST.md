# ハンドオフメモ

**更新日**: 2026-04-20 session18 (#288 observability follow-up bundle 完遂、Phase 1/2 merged + Phase 3 scope 縮減)
**ブランチ**: main (PR #295 + #296 マージ済、clean)
**フェーズ**: Phase 8 + 運用監視基盤全環境展開完了 + #288 observability follow-up bundle 完遂 (Phase 1/2 merged + Phase 3 #299 へ独立化)

<a id="session18"></a>
## ✅ session18 完了サマリー (#288 observability follow-up bundle 完遂)

session17 で起票した #288 (aggregate cap observability follow-up bundle、8 項目) を 3 Phase に PM/PL WBS 分解して完遂。silent-failure-hunter S1 (CRITICAL) 指摘 (PR #290 由来) が本体、Phase 1/2 で解消。Phase 3 (動的 invocation test) は ts-node/mocha/tsconfig の CI 環境差異で scope 縮減判断し、#299 に独立化。

| 順 | フェーズ | 結果 |
|---|---|---|
| 1 | **Phase 0: Issue 分割 + #288 整理コメント** | ✅ #293 (item 7) / #294 (item 8) / item 3/4/5 見送り整理 |
| 2 | **Phase 1 (#288 item 2): warn log に pageNumber 付与** | ✅ PR #295 MERGED (`48d9c86`) |
| 3 | **Phase 2 (#288 item 6): prod invariant violation を safeLogError emit** | ✅ PR #296 MERGED (`9206c28`) |
| 4 | **Phase 3 (#288 item 1): 動的 invocation test** | 🔁 PR #298 → **scope 縮減** → #299 独立化 |
| 5 | **#288 close + follow-up Issue 整理** | ✅ #288 Closed、#293/#294/#297/#299 open 状態で scope 継承 |

### Phase 1 設計ポイント (PR #295)
- aggregate cap 発動時の `console.warn` message に `page=<N>` 付与（欠落時 `page=unknown`）で運用側の特定性向上
- `T extends SummaryField` に pageNumber は含まれないため `(page as { pageNumber?: number }).pageNumber` optional 読取りで型契約を保ったまま実装
- pr-test-analyzer Rating 7/10 指摘 (境界値 pageNumber=0 / 非 number fallback) を本 PR で全て採用 → 最終 Rating 向上

### Phase 2 設計ポイント (PR #296)
- `assertAggregatePageInvariant` の `NODE_ENV === 'production'` silent early return を `handleAggregateInvariantViolation` helper に分岐集約
  - dev: `throw new Error(...)` (#284 契約維持)
  - prod: `void safeLogError({source:'ocr', functionName:'capPageResultsAggregate', documentId})` fire-and-forget
- `AggregateInvariantContext { documentId?: string }` interface 新設、caller (`ocrProcessor.ts:152`) から docId 伝搬 → errors collection triage 可能化
- errorLogger は top-level `admin.firestore()` 依存のため **prod path 限定の dynamic require + try/catch fallback** (buildPageResult.ts 方針と整合、unit test 環境影響回避)
- 新規 grep-based contract (`textCapProdInvariantContract.test.ts`, 9 cases): anchor 保護 / prod 分岐 / safeLogError 呼出 / source / functionName / documentId / helper 呼出 regression / throw 残存なし / dev throw 維持

### Phase 3 スコープ縮減 (#299 独立化)
PR #298 で動的 test 7 cases を実装したが CI で tsc 環境差異が解消困難:
- 試行1: `createRequire(import.meta.url)` → CI TS1470 (import.meta in CJS output)
- 試行2: 同上 + `@ts-expect-error` → CI TS2578 (Unused directive)

根本原因: ローカル ts-node は mocha esm-utils 経由で ESM mode 実行、CI tsc は package.json type 未設定 + tsconfig module:NodeNext を CJS 出力と判定。両モードで diagnostics が異なり `@ts-expect-error` が片方で機能・片方で unused。解決策 (mocharc で ts-node/esm 明示 / proxyquire 導入 / tsconfig.test 分離) はいずれも scope 拡大のため #299 に分離。

### レビュー指摘対応（5 エージェント + Codex）
- silent-failure-hunter S1 (CRITICAL): 本体で解消
- silent-failure-hunter S2 + Codex MED (documentId 欠落): 本 PR で解消（signature 拡張）
- Codex MED (helper 未使用回帰 contract): grep contract 追加
- Codex HIGH (flush 保証): #297 で follow-up (caller の await chain で通常経路は flush 保証、instance crash 耐性は別対応)
- pr-test-analyzer Important × 3 (valid+throwOnLoad / fallback message 内容 / pageNumber propagation): 1-2 は本 PR 対応、3 は scope 外
- comment-analyzer Suggestion: コメント簡略化で対応

### 達成効果
- **テスト数**: 511 → 523 passing (Phase 1 で +12、Phase 2 で +11 = grep contract 9 + runtime 2)
- **tsc exit 0** / **lint errors 0**
- **silent failure elimination**: #209 型 Firestore 旧データの prod silent 伝播を observable 化、triage 可能な documentId 付き errors collection 記録
- **静的 lock-in 完成**: assertAggregatePageInvariant → helper → safeLogError の経路を 9 grep assertions で mutation resistance

### マージ済 PR
- PR #295 (`48d9c86`): feat(textCap): aggregate cap warn に pageNumber 付与 (#288 item 2)
- PR #296 (`9206c28`): feat(textCap): prod invariant violation を safeLogError で観測可能に (#288 item 6)

### 起票済 follow-up Issue
- **#293**: caller try/catch 方針整理 (#288 item 7) — dev throw が processDocument 全体を abort させる問題
- **#294**: integration/mixed-input テスト (#288 item 8) — ocrProcessor 経由 end-to-end + mixed-input + tsd 型固定
- **#297**: fire-and-forget flush 保証 (Codex HIGH follow-up) — instance crash 耐性、Option A/B/C 設計検討
- **#299**: 動的 safeLogError invocation test (ts-node/esm 環境整備込み) — Phase 3 scope 継承、7 test cases draft 含む

### 教訓 (PM/PL 視点)

| 教訓 | 内容 |
|---|---|
| **Aggregate Issue の PM/PL 分割 ROI** | #288 を 3 Phase + 4 独立 Issue に分割したことで、セッション内に merge 可能な本体対応 (Phase 1/2) と技術的 deadlock の可能性がある部分 (Phase 3) を切り分けられた。もし一括 PR にしていれば CI 環境差異で全体が stuck していた |
| **設計判断のセカンドオピニオン ROI 再確認** | Codex HIGH 指摘 (fire-and-forget flush 保証) は Claude と silent-failure-hunter が見落とした観点。セッション内で解消か follow-up 化の判断材料として機能、PR body の Risks 欄に明示的に記録できた |
| **技術的デッドロック判断の PM/PL 役割** | Phase 3 CI 環境差異は 2 試行で TS1470 → TS2578 の相反 error。3 回目を試すより scope 縮減で独立 Issue 化する判断が「Small & Verifiable」原理に整合。試行回数でストップラインを設定することが PM として重要 |
| **dynamic require + try/catch fallback の設計価値** | buildPageResult.ts の「unit test から import しても admin 初期化エラーが発生しない」方針を踏襲することで、errorLogger top-level 依存を prod path 限定で遅延 load。既存方針の再利用が scope 縮小に貢献 |

### 次セッション着手候補 (優先度順)

**最優先** (本 session follow-up):
- **#293** (caller try/catch 方針整理): dev throw が processDocument abort させる問題。#297 と併せて設計検討が自然 (中規模、設計判断あり)
- **#299** (動的 invocation test + ts-node/esm 環境整備): grep contract の mutation 耐性を runtime 補強。mocharc / proxyquire / tsconfig.test 分離のいずれかを選定 (中規模、環境整備含む)

**P2 他 (継続)**:
- **#297**: flush 保証 (Codex HIGH、Option A/B/C 設計検討)
- **#294**: integration/mixed-input テスト (#288 item 8、integration/tsd)
- **#262**: summaryWritePayloadContract diagnostics 強化
- **#251**: summaryGenerator unit test + buildSummaryPrompt 分離
- **#239 / #238**: force-reindex 機能拡張
- **#220**: OOM/truncated metric + alert

---

<a id="session17"></a>
## ✅ session17 完了サマリー (Phase 3 #278+#284 + Phase 4 #279 完遂)

session16 で策定した WBS 4 Phase のうち残 2 Phase (#278+#284 統合、#279) を完遂し、**1 日 WBS の 4/4 全消化**。Phase 3 は 6 ファイル変更で Evaluator 分離プロトコル発動対象、Phase 4 は軽量 test-only PR で contrast 構成。

| 順 | フェーズ | 結果 |
|---|---|---|
| 1 | **Phase 3 (#278+#284): PageOcrResult 3 重定義解消 + `as T` cast 排除** | ✅ PR #290 MERGED (`0878173`) |
| 2 | **Phase 3 Evaluator 修正** | ✅ contract test ENV_GATE 緩和、aggregate 固有関数名検出、short-path dev-assert 追加 |
| 3 | **Phase 4 (#279): buildPageResult console.warn 副作用検証** | ✅ PR #291 MERGED (`23b9c62`) |

### Phase 3 設計ポイント (PR #290)
- `buildPageResult.PageOcrResult` → `RawPageOcrResult` にリネーム、`pdfOperations.ts` ローカル → `SplitPageInput` に分離 → `PageOcrResult` 定義は `shared/types.ts:430` の 1 箇所に限定
- `capPageResultsAggregate` 戻り値型を `Array<CappedAggregatePage<T>>` (= `Omit<T,'text'|'truncated'|'originalLength'> & SummaryField`) 化し `as T` cast を 0 箇所に削減 → narrow 型 T の silent 契約違反を tsc で検知可能に
- `assertAggregatePageInvariant` dev-assert (prod no-op) 追加、`capPageText` の dev-assert とペアで型契約を runtime で lock-in
- contract test (`textCapAsCastContract.test.ts`) で cast 不在 + 命名 + dev-assert 存在を grep lock-in

### Evaluator 指摘への対応 (MEDIUM+LOW 3 件)
1. **ENV_GATE false-pass リスク** → pattern を `[!=]==` 緩和 + count >= 2 + aggregate 固有関数名 `assertAggregatePageInvariant` を独立検出
2. **short-path invariant 未検証** → `rebuilt = page` path でも dev-assert を適用、Firestore 旧データ (`originalLength` 残存) を早期検知
3. **dev-assert 呼び出し重複** → map 末尾 1 回に DRY 化、分岐追加時の漏れ防止

### Phase 4 設計ポイント (PR #291)
- `buildPageResult` の `console.warn` 副作用 (label/originalLength/cap 値) を 3 test で lock-in
- `sinon` 依存追加せず、`textCap.test.ts` (#283) の `withWarnSpy` polyfill を踏襲 (try/finally で console.warn 確実復元)

### 達成効果
- **テスト数**: 496 → 509 passing (+13、Phase 3 で +10、Phase 4 で +3)
- **tsc exit 0** / **lint errors 0** (warnings は既存ファイルのみ)
- **型契約の silent divergence リスク根絶**: PageOcrResult 3 重定義解消 + `as T` cast 排除 + dev-assert の二段防御

### follow-up Issue (#288 にコメント追記)
PR #290 の silent-failure-hunter + pr-test-analyzer レビューで判明した 3 項目を #288 (observability follow-up bundle) に記録:
1. **prod 環境 invariant violation の observability 格上げ** (critical): 現状 prod は assert no-op。`safeLogError` 化が必要
2. **capPageResultsAggregate caller の try/catch 方針整理** (medium): dev throw が processDocument 全体を abort させる
3. **integration/mixed-input テスト** (rating 5-6): ocrProcessor 経由の end-to-end と mixed input 分岐

### マージ済 PR
- PR #290 (`0878173`): refactor(textCap): PageOcrResult 3重定義解消 + as T cast 排除 (#278 + #284)
- PR #291 (`23b9c62`): test(ocr): buildPageResult の console.warn 副作用検証追加 (#279)

### 次セッション着手候補 (優先度順)
1. **#288**: aggregate cap observability follow-up bundle (上記 3 項目。prod observability 格上げは critical)
2. **#262**: summaryWritePayloadContract diagnostics 強化
3. **#251**: summaryGenerator unit test + buildSummaryPrompt 分離
4. **#237**: search tokenizer FE/BE/script 共通化 (横断変更、`/batch` 候補)
5. **#239 / #238**: force-reindex 機能拡張
6. **#220**: OOM/truncated log-based metric + alert

---

<a id="session16"></a>
## ✅ session16 完了サマリー (Phase 1 #276 + Phase 2 #283 完遂、セカンドオピニオン ROI 実証)

session15 の WBS で予定されていた follow-up 消化を PM/PL 視点で 4 Phase に分解 (#276 → #283 → #284+#278 → #279)、**Phase 1 + 2 を 1 セッションで完遂**。特筆は Phase 2 で `/codex` セカンドオピニオンと silent-failure-hunter が独立に同じ設計バグ (re-cap degradation gate の検知漏れ) を発見し、merge 前に修正できた点。ROI 明確。

| 順 | フェーズ | 結果 |
|---|---|---|
| 1 | **WBS 策定 (4 Phase 分解)** | ✅ #276 (scope 小) → #283 (中) → #284+#278 (大, evaluator 発動) → #279 (小) 順に確定 |
| 2 | **Phase 1 (#276): handleProcessingError safeLogError 契約テスト** | ✅ PR #286 MERGED (`358f021`) |
| 3 | **Phase 2 (#283): aggregate cap observability 強化 (Option A+B)** | ✅ PR #287 MERGED (`2f915ea`) |
| 4 | **Phase 2 の設計バグ修正** | ✅ re-cap degradation gate を `text.length` 比較へ変更 (Codex + silent-failure-hunter 独立発見) |
| 5 | **Follow-up 起票** | ✅ #288 (observability follow-up bundle) |

### 達成効果 (Phase 1 + 2 完遂)

| 効果 | 内容 |
|---|---|
| 🛡️ silent failure lock-in 契約群の拡張 | Phase 1 #276 と Phase 2 #283 で grep-based 契約 (brace/paren-nesting 抽出) を 2 箇所に拡張。handleProcessingError 末尾 + aggregate cap ブロックの safeLogError 呼出 + params を static lock-in |
| 🐛 設計バグ merge 前発見 | Phase 2 の `if (capped.truncated && !page.truncated)` gate は `page.truncated=true` の再 cap 時にさらに短縮される「追加データロス」を silent に通過させる欠陥。`capped.text.length < page.text.length` へ修正し、実際の text 長さ変化を基準化 |
| 🔍 セカンドオピニオン ROI 実証 | `/review-pr` 3 並列 + `/codex review` (MCP) が同じバグを独立発見。CLAUDE.md「3 ファイル+または 200 行+で /codex review」ルールの具体的価値を検証 |
| 📋 Rule-of-Three 保守性 | `extractSafeLogErrorArgs` が Phase 1+2 で 2 箇所に複製。rule-of-three 未達で現状維持、Phase 3/4 第 3 契約テスト追加時に共通 helper へ抽出予定と明示 |

### Phase 1 (#276) Quality Gate 実施記録

| 段階 | 結果 | 指摘・対応 |
|---|---|---|
| `/impl-plan` | ✅ 2 option 比較 → Option B (関数スコープ grep) 選定 | console.error と safeLogError が 50 行離れているため ANCHOR_WINDOW_LINES=8 適用不可 |
| 実装 (1 テストファイル、149 → 261 行) | ✅ extractFunctionBody + extractSafeLogErrorArgs + params 4 項目 | lock-in: safeLogError 一時削除 → 6 件 fail 確認 |
| `/review-pr` 4 並列 (code-reviewer + pr-test + comment + silent-failure) | Critical 0 / Important 4 採用 | functionName regex 緩さ + error param 未検証 + 行番号 rot + #178/#209 analogy 不正確 → 全件反映 (scope 縮約 + error 追加 + 行番号削除 + issue 参照修正) |
| `/simplify` + `/safe-refactor` | ⏭️ 1 ファイルにつきスキップ | 3 ファイル基準未満 |

### Phase 2 (#283) Quality Gate 実施記録

| 段階 | 結果 | 指摘・対応 |
|---|---|---|
| `/impl-plan` | ✅ AC 5 項目 + Option A+B 併用 + 4 ファイル分解 | TDD: B (warn log test) → A (textCap 実装) → D (contract test) → C (ocrProcessor 格上げ) |
| 実装 (4 ファイル、+292/-1) | ✅ textCap per-page warn + ocrProcessor safeLogError 格上げ + contract test | lock-in: safeLogError 削除 → 6 件 fail 確認 |
| `/simplify` 3 並列 (reuse + quality + efficiency) | 1 件採用 | 冗長 console.warn(error.message) 削除 (safeLogError 内部で logError が console.error 出すため) |
| `/safe-refactor` | ✅ 型安全性・エラー処理問題なし | DRY 1 件受諾 (Rule-of-Three 未達) |
| `/review-pr` 3 並列 + `/codex review` | Critical 0 / Important 3 採用 | re-cap degradation gate 設計バグ (Codex + silent-failure-hunter 独立一致) + await 契約未化 + runningTotal assertion 不足 → 全件反映 |
| CodeRabbit 自動レビュー | Nitpick 2 件 | await lock-in は既対応、stale comment 1 件修正 |

### CI / マージ結果

- BE: `npm test` 465 → **496 passing** (+31 = Phase 1 #276 contract 14 + Phase 2 textCap warn 4 + Phase 2 contract 12 + 追加テスト 1)
- FE: 回帰なし
- PR #286 CI: lint-build-test SUCCESS (~4m) / CodeRabbit pass / GitGuardian pass → MERGED `358f021`
- PR #287 CI: lint-build-test SUCCESS (5m27s) / CodeRabbit pass / GitGuardian pass → MERGED `2f915ea`
- 本 PR 群は observability 強化 + test 追加のみ、Firestore 書込 shape 完全互換 → kanameone / cocoro 本番環境への影響ゼロ

### 教訓 (PM/PL 視点)

| 教訓 | 内容 |
|---|---|
| **セカンドオピニオン ROI は大規模ほど顕著** | Phase 2 (4 ファイル/292 行) で Codex が silent-failure-hunter と独立に同じ設計バグを発見。4 レビュアー (内部 3 + Codex) で 1 つの重要バグに収束したことは CLAUDE.md「大規模 PR → /codex review」ルールの有効性を実証。今後も 3+ ファイル規模は必ず取得推奨 |
| **TDD 順序の設計判断** | Phase 2 で B (test) → A (src) → D (contract) → C (src 格上げ) の 4 段 TDD を採用。各ステップで RED 確認 → GREEN 実装 → lock-in 再確認の循環が bug-free progress を保証。contract test の lock-in は一時的 src 破壊での RED 検証で実効性担保 |
| **Rule-of-Three の明示採用** | Phase 1+2 で `extractSafeLogErrorArgs` が 2 箇所複製。DRY 原理主義ではなく「3 箇所目で抽出」と明示することで、Phase 3/4 (#278/#279) での共通 helper 化 (functions/test/helpers/sourceExtractors.ts) への自然な発展経路を確保 |
| **gate 設計は実際の挙動基準で記述** | Phase 2 re-cap degradation の原因は `page.truncated` フラグのみで gate を組んだこと。`text.length` という「実際の変化」基準へ移行することで silent failure を解消。一般則: 状態フラグだけでなく実際の副作用の有無を gate 条件に含める |
| **CodeRabbit の rate limit を踏まえた PR 管理** | session 内で PR を連続作成すると CodeRabbit rate limit 到達 (54 分待機)。commit まとめ粒度を意識し、小修正は後続 commit として既存 PR に追加する方が CodeRabbit の活用効率が良い |

### 次セッション着手予定 (session17)

**最優先タスク** (Phase 3 - evaluator 発動対象):
- **#284 + #278 (Phase 3、5-6 ファイル、/impl-plan → evaluator 分離プロトコル発動)**: `capPageResultsAggregate` の `as T` cast 排除 (#284) + `PageOcrResult` 型 3 重定義解消 (#278) の統合実装。型変更が広範囲に波及するため `rules/quality-gate.md` evaluator 起動必須

**Phase 4 (小規模、Phase 3 後)**:
- **#279 (小、~30min)**: buildPageResult の console.warn 副作用検証テスト (sinon.spy 代替の manual spy、Phase 2 `withWarnSpy` helper 再利用検討)

**session16 起票 follow-up Issue**:
- **#288**: aggregate cap observability follow-up bundle (動的 safeLogError invocation test / warn log に pageNumber 追加 / extractAggregateCapBlock refactor 耐性 / capPageResultsAggregate caller enforcement / mutation meta-test 自動化)

**session15 起票 follow-up Issue** (継続):
- **#262 (Phase 4、~1h)**: summaryWritePayloadContract grep-based 既知制限 + diagnostics 強化
- **#251 (Phase 4、~1.5h、2-3 ファイル)**: generateSummaryCore unit test + buildSummaryPrompt 別モジュール分離
- **#237 (Phase 5、大規模、Codex + Evaluator 必須)**: search tokenizer FE/BE/script 3 箇所重複共通化
- **#220 / #239 / #238 (Phase 6)**: 運用監視拡充

---

<a id="session15"></a>
## ✅ session15 完了サマリー (Phase 2 #264 完遂: capPageResultsAggregate SummaryField generic 化、follow-up 2 Issue 起票)

session14 の WBS Phase 2 として handoff に明記されていた **#264 (capPageResultsAggregate generic を新 PageOcrResult discriminated union に対応)** を本セッションで完遂。#258 Evaluator MEDIUM 指摘のクリーン化で、discriminated union 不変条件 (truncated=false ⟹ originalLength 不在) を型レベル + runtime + test の三段防御で lock-in。5 並列レビュー (session12 の 3→4 並列構成を hook 要件で 5 並列に拡張) + Codex GO 判定 + regression 1 件発見/修正で session 内 1 PR 完遂。

| 順 | フェーズ | 結果 |
|---|---|---|
| 1 | **WBS 策定 (PM/PL 視点、10 タスク分解)** | ✅ 本セッション Must = Phase 2 #264 単独、余力は follow-up 消化、残は次セッション持越 |
| 2 | **Phase 2-A (/impl-plan)** | ✅ AC 7 項目定義、Option A (generic SummaryField 化 + stripSummaryFields helper) 固定 |
| 3 | **Phase 2-B (TDD Red)** | ✅ 既存 fixture を SummaryField 準拠化 (6 箇所) + #264 不変条件テスト 3 件追加 |
| 4 | **Phase 2-C (TDD Green + Refactor)** | ✅ generic `<T extends SummaryField>` + stripSummaryFields + 明示分岐、TODO コメント削除 |
| 5 | **Phase 2-D (全 Quality 確認)** | ✅ BE 464 passing / tsc / lint / type-check:test / FE 134 回帰なし |
| 6 | **Phase 2-E (/review-pr 3 並列 → 5 並列)** | ✅ pr-test-analyzer が regression 発見 + 修正、hook 要件で silent-failure-hunter + comment-analyzer 追加 |
| 7 | **regression 修正 + 再 cap 経路テスト追加** | ✅ `isTruncated = page.truncated \|\| capped.truncated` で input truncated 情報保存挙動を復元 |
| 8 | **Phase 2-F (/codex review MCP 版)** | ✅ **GO 判定、必須対応なし** |
| 9 | **Phase 2-G (PR #282 作成 → CI SUCCESS → squash merge)** | ✅ `dcce086`、Issue #264 自動クローズ |
| 10 | **Follow-up 起票** | ✅ #283 (observability) + #284 (as T cast 排除) |

### 達成効果 (Phase 2 完遂)

| 効果 | 内容 |
|---|---|
| 📐 discriminated union 不変条件の 3 段防御 | 型レベル (`<T extends SummaryField>`) + runtime (stripSummaryFields で originalLength 排除 + 明示分岐構築) + test (hasOwnProperty + typeof lock-in) の三段で truncated=false ⟹ originalLength 不在を強制 |
| 🛡️ regression 発見/修正 | pr-test-analyzer Important #1 (入力 truncated=true 再 cap 経路テスト) 追加で、`if (capped.truncated)` 単独分岐では input truncated=true + text cap 内のケースで truncated 情報 + originalLength が消失する regression を発見、`\|\|` 合成で修正 |
| 🧪 idempotent + 情報保存 | 4 ケース (T,T)(T,F)(F,T)(F,F) 全てで情報保存を Codex が GO 判定で検証 |
| 📊 type-design-analyzer スコア | Invariant Expression 3/5 → 4/5、他軸維持 (Encapsulation 4/5 / Usefulness 5/5 / Enforcement 4/5 / Blast radius 4/5) |

### Phase 2 Quality Gate 実施記録

| 段階 | 結果 | 指摘・対応 |
|---|---|---|
| `/impl-plan` | ✅ AC 7 項目定義、Option A 固定 | 既存 fixture の SummaryField 準拠化必要を impl-plan で事前発見 |
| `/simplify` / `/safe-refactor` | ⏭️ スキップ | 実質 2 ファイル変更 (ocrProcessor.ts はコメント 1 語削除のみ)、3+ 基準未満 |
| Evaluator 分離 | ⏭️ スキップ | 5+ ファイル未満、新機能なし |
| `/review-pr` 3 並列 (type-design + pr-test + code-reviewer) | type-design APPROVE / pr-test Important 2 採用 + regression 発見 / code-reviewer issues なし | Invariant Expression 3→4 改善確認、regression 修正コミット |
| hook 要件で追加 2 並列 (silent-failure-hunter + comment-analyzer) | Important 5 件 (本 PR 2 対応 + 3 follow-up 起票) | SF-1/CA-1/CA-2/S2 JSDoc 精度向上、SF-2 → #283、SF-3 + Codex → #284 |
| `/codex review` MCP 版 | ✅ **GO 判定、必須対応なし** | 4 ケース (T,T)(T,F)(F,T)(F,F) idempotent + 情報保存確認、戻り値型改善は follow-up 候補 (#284 に集約) |

### CI / マージ結果

- BE: `npm test` 461 → **465 passing** (+4 = 不変条件 3 + 再 cap 経路 1)
- FE: `npm test` 134 passing 回帰なし
- PR #282 CI: lint-build-test SUCCESS (5m44s) / CodeRabbit pass / GitGuardian pass → MERGED `dcce086`
- 本 PR は型表現 + runtime 分岐変更のみ、Firestore 書込 shape 完全互換 → kanameone / cocoro 本番環境への影響ゼロ

### 教訓 (PM/PL 視点)

| 教訓 | 内容 |
|---|---|
| **pr-test-analyzer Important は regression 検知装置として機能** | 入力 truncated=true の再 cap 経路テスト提案 (rating 7) がそのまま regression を炙り出した。「新実装での挙動変化点 (if 分岐 → 合成) 近傍に lock-in テストを書く」という観点は bug 直前検知の典型パターン |
| **hook 要件 (PR 作成後) と /review-pr の両立** | CLAUDE.md `/review-pr` 3 並列 + hook 要件の 5 並列を両立。PR 作成前に type-design/pr-test/code-reviewer、作成後に silent-failure/comment-analyzer を追加することで重複回避と完全カバレッジを両立。Important 5 件中 2 件本 PR 対応 + 3 件 follow-up 起票で scope 明確化 |
| **Codex GO 判定の補強効果** | /review-pr 5 並列が複数の Important 指摘を出した状態で Codex が GO 判定 (必須対応なし) を出したことで「Important は scope 内か scope 外か」の判断が構造化。scope 外 (observability / 将来 misuse 防御) を follow-up 化する採用判定に根拠を持たせられた |
| **WBS 策定 + Must/Should 区分の価値** | session 開始時に「本セッション Must = Phase 2 単独」「余力 Should = #276/#279」「次回持越 = 5+ ファイル規模」と明示したことで、PR マージ後のコンテキスト温存判断 (余力タスク次セッション送り) が機械的に可能に。最後の 20% でエラー発生 (公式データ) の回避 |
| **docstring と実装の乖離は silent failure の温床** | silent-failure-hunter I1 で「JSDoc が "robustness 担保" と主張しているのに実装は値バリデーションなし」を指摘。今後は JSDoc の claim を実装の実能力に一致させる、または明示的に不足を記述する運用で対応 |

### 次セッション着手予定 (session16)

**最優先タスク** (余力消化 + Phase 3):
- **#276 (scope 小、~30min)**: handleProcessingError の safeLogError 呼出契約テスト (test 1 ファイル追加、既存 summaryCatchLogErrorContract の grep-based パターン再利用)
- **#279 (scope 小、~30min)**: buildPageResult の console.warn 副作用検証テスト (sinon.spy)
- **#262 (Phase 3、~1h)**: summaryWritePayloadContract grep-based 既知制限 + diagnostics 強化

**Phase 4 以降 (WBS 優先度順)**:
- **#251 (Phase 4、~1.5h、2-3 ファイル)**: generateSummaryCore unit test + buildSummaryPrompt 別モジュール分離
- **#278 (Phase 4 併走、3-5 ファイル想定、/simplify + /safe-refactor 必要)**: PageOcrResult 型 3 重定義解消 (#284 統合候補)
- **#237 (Phase 5、大規模、Codex + Evaluator 必須)**: search tokenizer FE/BE/script 3 箇所重複共通化 (別セッション集中)
- **#220 / #239 / #238 (Phase 6)**: 運用監視拡充 (#283 統合候補で再編)

**session15 起票 follow-up Issue**:
- **#283**: capPageResultsAggregate truncation 発動時の warn log + errors collection 記録 (silent-failure-hunter I2、observability、#220 統合候補)
- **#284**: `as T` cast 排除 (戻り値型を `Omit<T, ...> & SummaryField` 化 + dev-assert) (Codex + silent-failure-hunter I3 + comment-analyzer I2 複合、#278 統合候補)

**session14 起票 follow-up Issue** (未着手、session16 の余力消化対象):
- **#276**: handleProcessingError の safeLogError 呼出契約テスト
- **#278**: PageOcrResult 型 3 重定義解消 (shared / buildPageResult / pdfOperations)
- **#279**: buildPageResult の console.warn 副作用検証

---

<a id="session14"></a>
## ✅ session14 完了サマリー (Phase 1A + 1B 完遂: #271 + #267 + #273、follow-up 3 Issue 起票)

session13 で完遂した Phase A (#266 + #253) の follow-up 消化スプリント第 2 弾。PM/PL 視点で 10 open Issue を 6 Phase に分解した WBS を策定し、**Phase 1A (即効性 2 タスク: #271 + #267) + Phase 1B (FE test 1 タスク: #273) を 1 セッションで完遂**。CLAUDE.md (グローバル + プロジェクト) 多層適用、各 PR で review 指摘を採用/follow-up 分類して scope 明確化。

| 順 | フェーズ | 結果 |
|---|---|---|
| 1 | **WBS 策定 (10 Issue → 6 Phase)** | ✅ Phase 1A/1B/2/3/4/5/6 順序確定、Codex 要否判定 (Phase 2・5 のみ) |
| 2 | **Phase 1A 計画 (/impl-plan #271+#267)** | ✅ AC 定義、同一ファイル編集競合回避で直列順序決定 |
| 3 | **Phase 1A-1 (#271): handleProcessingError safeLogError 統合** | ✅ PR #275 MERGED (`97d680e`) |
| 4 | **Phase 1A-2 (#267): PageOcrResult 型不変条件 + 振る舞いテスト** | ✅ PR #277 MERGED (`e84f3b9`) |
| 5 | **Phase 1B 計画 (/impl-plan #273)** | ✅ AC 定義、4 describe ブロック構成 |
| 6 | **Phase 1B (#273): useProcessingHistory.test.ts 新設** | ✅ PR #280 MERGED (`d728628`) |
| 7 | **Follow-up 起票** | ✅ #276 + #278 + #279 |

### 達成効果 (Phase 1A + 1B 完遂)

| 効果 | 内容 |
|---|---|
| 🛡️ silent failure SSoT 完成 | handleProcessingError の try/catch fallback を `safeLogError` helper に統合。#266 で導入した catch 句 fallback の SSoT 化が 100% 完成 |
| 📐 型不変条件 CI enforcement | `tsconfig.test.json` + `type-check:test` スクリプト新設。`@ts-expect-error` directive が ts-node/register 下で silent に無視される問題を構造的に解決。#258 discriminated union (truncated=false ⟹ originalLength 不在) を CI で lock-in |
| 🧪 buildPageResult pure 化 | ocrProcessor.ts L133-149 の local closure を `src/ocr/buildPageResult.ts` に分離。firebase-admin top-level 初期化の副作用排除で unit test から import 可能に |
| 🧪 FE refactor 回帰ネット整備 | session13 PR #272 (#253) で firestoreToDocument を集約した refactor の pr-test-analyzer Important 指摘に対応。useProcessingHistory.test.ts 新設 (18 tests)、isCustomerConfirmed デュアルリード (Phase 6/7 + 矛盾 + mixed state) を static lock-in |
| 🔍 境界値 / mixed state カバレッジ | review で追加: MAX_PAGE_TEXT_LENGTH ちょうど / +1 の境界値、migration 期 Phase 6 needs=true と Phase 7 customerConfirmed=false 混在配列、矛盾状態 (customerConfirmed vs needs 優先順位) |

### Phase 1A-1 (#271) Quality Gate 実施記録

| 段階 | 結果 | 指摘・対応 |
|---|---|---|
| `/impl-plan` | ✅ 直列順序 + AC 定義 | ocrProcessor.ts 同一ファイル編集競合回避 |
| 実装 (1 ファイル -4 行正味) | ✅ safeLogError 呼出に置換 | logError 直接 import 削除 |
| `/simplify` / `/safe-refactor` | ⏭️ スキップ | 1 ファイル、session13 #253 同判断 |
| `/review-pr` 2 並列 (silent-failure-hunter + code-reviewer) | Critical 0 / Important 0 / Suggestion 1 | handleProcessingError の safeLogError 呼出を保証する契約テストギャップ → #276 起票 |

### Phase 1A-2 (#267) Quality Gate 実施記録

| 段階 | 結果 | 指摘・対応 |
|---|---|---|
| `/impl-plan` | ✅ AC 定義 + Phase 分解 | 型テスト + 振る舞いテスト 2 layer 構成 |
| 実装 (6 ファイル +186/-34) | ✅ buildPageResult 分離 + 型/振る舞い test | `ts-node/register` silent 問題を `tsconfig.test.json` で解決 |
| 負検証 | ✅ | @ts-expect-error 削除で tsc TS2339 失敗確認、enforcement 実効性担保 |
| `/simplify` / `/safe-refactor` | ⏭️ スキップ | src 2 ファイル変更、3+ 基準未満 |
| `/review-pr` 3 並列 (type-design + pr-test + code-reviewer) | Critical 0 / Important 1 採用 / Suggestion 採用 2 却下 1 | 境界値テスト (text.length === MAX / MAX+1) 採用、tsconfig コメント追加、PageOcrResult 3 重定義 → #278 起票、console.warn 検証 → #279 起票 |

### Phase 1B (#273) Quality Gate 実施記録

| 段階 | 結果 | 指摘・対応 |
|---|---|---|
| `/impl-plan` | ✅ AC 定義 + 4 describe ブロック | applyConfirmedFilter export 化で unit test 可能化 |
| 実装 (2 ファイル +182/-1) | ✅ 16 tests (isCustomerConfirmed 5 + normalizeCandidate 4 + applyConfirmedFilter 4 + 統合 3) | makeDoc factory + vitest |
| `/simplify` / `/safe-refactor` | ⏭️ スキップ | 2 ファイル、session13 #253 同判断 |
| `/review-pr` 2 並列 (pr-test + code-reviewer) | Critical 0 / Important 2 採用 / Suggestion 1 見送り | isCustomerConfirmed に矛盾状態 lock-in 2 cases 追加 (16 → 18 tests) + applyConfirmedFilter に migration 期 mixed state fixture 追加 (既存 test の期待値更新、test 数不変)、Timestamp 固定化は ROI 低で見送り |

### CI / マージ結果

- BE: `npm test` 450 → 461 passing (+11 = 境界値 2 + 振る舞い 7 + 型 2)
- FE: `npm test` 116 → **134** passing (+18 = デュアルリード 5 + 矛盾 2 + normalizeCandidate 4 + applyConfirmedFilter 4 + 統合 3)
- PR #275 CI: SUCCESS → MERGED `97d680e` / 1 ファイル -4 行
- PR #277 CI: SUCCESS → MERGED `e84f3b9` / 6 ファイル +219/-34
- PR #280 CI: SUCCESS → MERGED `d728628` / 2 ファイル +200/-1
- いずれも status 遷移 / Firestore 書込スキーマ変更なし → kanameone / cocoro 本番環境への影響ゼロ

### 教訓 (PM/PL 視点)

| 教訓 | 内容 |
|---|---|
| **ts-node/register の strict type check 限界** | `@ts-expect-error` directive が tsconfig include 外のテストでは silent に無視される問題を #267 実装中に発見。`tsconfig.test.json` + `type-check:test` pre-step で構造的解決。今後の型契約テストすべてで利用可能な基盤 |
| **WBS 粒度の segment 感** | 10 Issue を 6 Phase に分解、scope × 鮮度 × ROI でマトリクス化。Phase 1A/1B は「follow-up 消化 + session 内 3 PR 完遂」の速度感に最適化、Phase 2 以降は Codex セカンドオピニオン (現行 Quality Gate 規定発動条件該当のため)で別セッション推奨と切り分け |
| **Review Important は 1 コミット追加で採用が常道** | pr-test-analyzer Important は PR scope 内の test 追加で必ず対応。Suggestion は実害評価で採用/follow-up/見送りに分類。今回 3 PR 合計で採用 3 件 / 見送り 1 件 / follow-up 3 件起票と綺麗に分類 |
| **review 指摘起点の follow-up Issue が Sprint 1 ネタになる** | session12→13 で 3 件、session13→14 で 2 件、session14→次回で 3 件と follow-up が再生産。`/handoff` 時に常に 10 open Issue 維持の安定運用パターンが確立 |
| **pre-existing flaky の扱い** | `KanaFilterBar.test.tsx` timeout が本 PR 起因でないことを main reverted 確認で立証、PR 本文に明記。「本 PR scope 外の pre-existing」と切り分けることで CI 不安定化責任を回避 |

### 次セッション着手予定 (session15)

**最優先タスク** (Phase 2):
- **#264 (Phase 2)**: capPageResultsAggregate generic を新 PageOcrResult discriminated union に対応 (~1.5h、3-5 ファイル想定、**Codex セカンドオピニオン (現行 Quality Gate 規定発動条件該当のため)**)
  - Option A (推奨): `<T extends SummaryField>` 化 + `stripSummaryFields` helper
  - Option B: ocrProcessor 専用 specialize
  - #258 Evaluator MEDIUM 指摘の clean 化

**後続 Phase (WBS 優先度順)**:
- **#262 (Phase 3)**: summaryWritePayloadContract grep-based 既知制限 + diagnostics 強化 (~1h)
- **#251 (Phase 4)**: generateSummaryCore unit test + buildSummaryPrompt 別モジュール分離 (~1.5h、2-3 ファイル)
- **#237 (Phase 5)**: search tokenizer FE/BE/script 3 箇所重複共通化 (大規模、Codex + Evaluator 必須、別セッション集中)
- **#220 / #239 / #238 (Phase 6)**: 運用監視拡充スプリント (OOM/truncated metric + alert、force-reindex 構造化 audit log、孤児 posting 検出)

**session14 起票 follow-up Issue** (残存):
- **#276**: handleProcessingError の safeLogError 呼出を保証する契約テスト追加 (#271 follow-up)
- **#278**: PageOcrResult 型の 3 重定義 (shared / buildPageResult / pdfOperations) 解消 (#267 review follow-up)
- **#279**: buildPageResult の console.warn 副作用検証追加 (#267 follow-up)

**session13 以前の残存 follow-up**:
- **#262 / #264 / #267 以外の起票済 P2 Issue** は session15 以降で scope 順に消化

---


## ✅ session12 完了サマリー (Phase 3 完遂: #258 型統合 + bridge code 削除 + dev-assert)

session11 で完遂した #259 (summaryWritePayloadContract 直接書込検知強化) に続き、session10 の handoff で「次セッション最優先」と記録されていた Phase 3 (#258) を本セッションで完遂。type-design-analyzer の 5 軸評価で指摘された Encapsulation 2/5 / Enforcement 3/5 を改善。`/review-pr` 4 並列で検出された Critical/Important を本 PR で対応 + 別 Issue 化、Codex セカンドオピニオンで GO 判定取得。

| 順 | フェーズ | 結果 |
|---|---|---|
| 1 | **Phase 3 (#258) 着手 — WBS + 計画策定** | ✅ `/impl-plan` AC 7 項目定義、3 Phase (型統合 + union 化 + dev-assert) |
| 2 | **Phase 1: CappedText → SummaryField 統合** | ✅ 5 ファイルの import 統一、capPageText 戻り値型 SummaryField 化 |
| 3 | **Phase 2: PageOcrResult discriminated union 化 + bridge code 削除** | ✅ ocrProcessor.ts L146-149 削除、`{...capped, ...meta}` spread に簡略化 |
| 4 | **Phase 3: dev-assert 追加 (NODE_ENV !== 'production')** | ✅ originalLength 不変条件 verify、prod no-op |
| 5 | **Evaluator 分離 (rules/quality-gate.md, 5+ ファイル)** | ✅ APPROVE、MEDIUM 1 件 → #264 起票 |
| 6 | **`/simplify` 3 並列** | ✅ 提案全て scope 外/既対処で却下 (path alias は ts-node 設定問題で却下) |
| 7 | **`/safe-refactor` (code-reviewer)** | ✅ HIGH 1 件 → #264 関連でコメント明示、LOW 対処済 |
| 8 | **`/review-pr` 4 並列 (重複回避で 6→4)** | ✅ type-design APPROVE、test-analyzer + silent-failure-hunter 指摘 → #266/#267 起票 + dev-assert テスト整理 |
| 9 | **`/codex review` セカンドオピニオン (MCP 版)** | ✅ GO 判定、必須対応なし |
| 10 | **CI SUCCESS → squash merge** | ✅ commit `3ee1489`、Issue #258 自動クローズ |

### 達成効果 (Phase 3 完遂)

| 効果 | 内容 |
|---|---|
| 📐 型 SSoT 確立 | `CappedText` 削除、`SummaryField` (shared) を Single Source of Truth 化。caller 5 ファイル全てで統一 |
| 🛡️ 不変条件型レベル保証 | `PageOcrResult = SummaryField & {meta}` で truncated=true ⟹ originalLength 必須を caller に伝播 |
| 🧹 bridge code 削除 | `capped.truncated ? capped.originalLength : result.text.length` (ocrProcessor.ts:146-149) を削除、`...capped` spread で union 不変条件が自動伝播 |
| 🚨 silent failure 早期検知 | dev-assert で「内部不整合 (再cap 経路追加等)」を即時検知、prod は no-op |
| 📊 type-design-analyzer スコア | Encapsulation 2/5 → 4/5 / Enforcement 3/5 → 4/5 (Invariant 5/5 / Usefulness 5/5 維持) |

### Phase 3 Quality Gate 実施記録

| 段階 | 結果 | 指摘・対応 |
|---|---|---|
| `/impl-plan` | ✅ AC 7 項目定義、3 Phase 分解 | scope 確定 (capPageResultsAggregate と pdfOperations.ts 自前型は別 Issue) |
| **Evaluator 分離** | APPROVE | MEDIUM 1 件 (capPageResultsAggregate) → #264 起票、LOW 1 件 (dev-assert contract test) → コメント補強 |
| `/simplify` 3 並列 | 提案全て却下 | path alias 統一提案は ts-node + tsconfig-paths 未設定で却下 (workflow.md「エージェント報告は鵜呑みにしない」適用) |
| `/safe-refactor` | HIGH 1 / LOW 1 | HIGH = #264 関連でコメント明示、LOW = PageOcrMeta export で対処 |
| `/review-pr` type-design-analyzer | APPROVE | Encapsulation +2 / Enforcement +1 改善確認 |
| `/review-pr` pr-test-analyzer | I1 対応済、C1/I2/I3 → #267 | dev-assert contract test (false negative リスク) を削除、本体実呼出 1 件のみ残存 |
| `/review-pr` silent-failure-hunter | C1 → #266、I1 → #264、I2 受容 | Vertex AI catch swallow は既存問題、本 PR scope 外 |
| `/review-pr` comment-analyzer | コメント圧縮対応済 | dev-assert テストブロック 8 行コメント / Option A/B 列挙を削除 |
| `/codex review` セカンドオピニオン | **GO** | 必須対応なし、PR description に「Firestore 実データ完全統一は #264/#267 後」明記推奨 → 反映 |

### CI / マージ結果

- BE: `npm run build` PASS / `npm test` 435 passing (元 434 + dev-assert 1) / `npm run lint` 0 errors (既存 19 warnings)
- FE: `npm run build` PASS / `npm test` 113 passing (回帰なし) / `npm run lint` 0 errors
- PR #265 CI: lint-build-test SUCCESS (5m30s) / GitGuardian SUCCESS / CodeRabbit pass → MERGED `3ee1489`
- 本 PR は型表現変更 + テスト追加、Firestore 書込形式は完全互換 → kanameone / cocoro 本番環境への影響ゼロ

### 教訓 (PM/PL 視点)

| 教訓 | 内容 |
|---|---|
| 7 段階品質ゲートの効果 | Evaluator → simplify → safe-refactor → review-pr 4 並列 → codex で多層レビュー。Codex GO で「APPROVE 偏重バイアス」を最終排除、安心してマージ可能 |
| 並列レビューの重複削減 | review-pr は 6 並列 fork だが、code-reviewer/code-simplifier は /safe-refactor + /simplify と重複 → 4 並列 (type-design / pr-test / silent-failure / comment) に絞ることで context 節約 |
| エージェント報告の verify 重要性 | /simplify HIGH 提案 (path alias 統一) は ts-node 設定確認で却下。workflow.md「エージェント結果の検証」が機能、安易な採用回避 |
| follow-up Issue の即時起票 | レビュー指摘で本 PR scope 外と判断したものは即 Issue 化 (#264 / #266 / #267)。コメント補強で TODO リンク → 追跡可能性確保 |
| 型設計 5 軸評価の威力 | type-design-analyzer の Encapsulation 2→4 / Enforcement 3→4 は明確な改善指標。before/after 比較で価値が定量化 |

### 次セッション着手予定

**最優先タスク** (P2 enhancement、scope 順):
- **#253**: useProcessingHistory.firestoreToDocument 重複を useDocuments 側に集約 (FE 2 ファイル、scope 小、~30 分)
- **#262**: summaryWritePayloadContract の grep-based 既知制限 + diagnostics 強化 (test 強化、~1h)
- **#267**: PageOcrResult 型不変条件 + buildPageResult 振る舞いテスト (本 PR follow-up、~1h)

**残り WBS** (優先度順):
- **#264**: capPageResultsAggregate generic を新 PageOcrResult 対応に書き直し (本 PR follow-up、~1h、Evaluator HIGH 関連)
- **#266**: Vertex AI catch 句で logError 追加 (silent failure 対策、~30 分、横展開要確認)
- **#251**: generateSummaryCore unit test + buildSummaryPrompt 別モジュール分離 (中規模、~1.5h)
- **Sprint 4 (#237)**: search tokenizer FE/BE/script 3 箇所重複共通化 (大規模)
- **Sprint 5**: 運用監視拡充 (#220 / #239 / #238)
- **Sprint 6**: テスト補強 (#200) + bug 消化 (#196)

---


## 過去のセッション

session11 以前は [archive/2026-04-history.md](./archive/2026-04-history.md) を参照 (2026-04-20 session18 で session11 を追加アーカイブ)。
