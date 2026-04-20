# ハンドオフメモ

**更新日**: 2026-04-20 session21 (Phase 2 Cluster B: AggregateInvariantContext 観測性強化 完遂、22 指摘解消)
**ブランチ**: main (PR #319 マージ済、clean)
**フェーズ**: Phase 8 + 運用監視基盤全環境展開完了 + #288 follow-up bundle 完遂 + session19 follow-up Phase 1 (session20) + Phase 2 (session21) 完遂

<a id="session21"></a>
## ✅ session21 完了サマリー (Phase 2 Cluster B: AggregateInvariantContext 観測性強化 完遂)

session20 ハンドオフの「次セッション予定」通り **Cluster B (#303 + #304)** を PM/PL WBS で完遂。PR #319 で 3 commits (初回実装 + 5エージェントレビュー対応 + CodeRabbit 対応) を squash merge。**22 指摘 (事前 Evaluator 11 + 5エージェント 9 + CodeRabbit 2) 全解消**。

| 順 | フェーズ | 結果 |
|---|---|---|
| 1 | `/impl-plan`: WBS + AC 11 件策定 | ✅ Option C (rename のみ) + Option A (fallback 直接書込) 固定、承認後着手 |
| 2 | **#304 リネーム実装**: interface/caller/contract test 6 箇所追従 | ✅ commit 39bb043 |
| 3 | **#303 fallback 実装 (TDD Red→Green)** | ✅ commit 39bb043 (new contract test 5 assertions) |
| 4 | `/simplify` 3 並列 + Evaluator 全 11 AC PASS | ✅ Stringly-typed 指摘 → type-only import 採用 |
| 5 | PR #319 作成、`/review-pr` 5 エージェント並列 | ✅ silent-failure-hunter "Do not merge as-is" Critical C1 |
| 6 | **レビュー対応** (Critical 2 + Important 7) | ✅ commit 8aeee16 (fallback 観測性・対称性・情報欠損解消) |
| 7 | CodeRabbit レビュー (Major 1 + Minor 2) | ✅ commit 3125b1b (ErrorLog schema 連動 + test-strategy 追従) |
| 8 | CI 3/3 green → squash merge | ✅ `f5537ad` MERGED、Issue #304/#303 CLOSED |

### 設計判断
- **#304 Option 採否**: C (rename のみ) 採用。A (interface 分離) は caller 1 箇所で過剰、B (brand type) は contract test で grep 誤用検知済のため cost-benefit で見送り。JSDoc に採否理由記録 + caller 2+ で Option A 再評価トリガー明文化
- **#303 fallback**: Option A (`admin.firestore().collection('errors').add()` 直接書込) 採用。B (re-throw) は dev throw と競合のため NG

### レビュー対応の核心 (commit 8aeee16)
silent-failure-hunter は "silent path を closing しているつもりで新たな silent path を作る" パターンを指摘:
- **C1**: `.add().catch(() => {})` → `.catch((writeErr) => console.error(...))` で PERMISSION_DENIED 等の operational signal を surface
- **I1**: 外側 `catch {}` → `catch (fallbackSetupErr) { console.error(...) }` で require/admin.firestore() 同期失敗を区別化
- **I2**: fallback Promise を `.then(() => undefined).catch(...)` で正規化し drainSink に push、主経路と対称化 (Cloud Functions freeze 時の partial delivery リスク解消)
- **I3**: `String(loadErr)` → `loadErr instanceof Error` 分岐で name/message/code 抽出、`[object Object]` silent 情報欠損を解消

### CodeRabbit 対応 (commit 3125b1b)
- **Major**: fallback record 型を `Omit<ErrorLog, ...> & { loaderError; documentId: string | null }` で ErrorLog 本体と連動。shape drift も tsc で検知可能化 (従来は union 値 drift のみ)
- **Minor**: docs/context/test-strategy.md の既存例リストに textCapErrorLoggerFallbackContract.test.ts 追加
- **Minor (false positive)**: silent-swallow alternation 指摘は 2nd commit で既に AND 化済

### メトリクス
- テスト: **570 → 580 passing (+10)** (rename regression guard 1 + fallback contract 5 + schema lock-in 2 + silent-swallow AND/outer catch/drainSink push 2)
- 変更: 9 files、+409 / -62 lines
- tsc 0 errors / lint 0 errors / CI 3/3 green

### Quality Gate 実施記録 (22 指摘解消)
| Stage | Source | Count |
|-------|--------|-------|
| 事前検証 | `/simplify` 3 並列 + Evaluator (11 AC PASS) | 11 |
| 5 エージェント並列レビュー | silent-failure-hunter Critical 1 + Important 3 / pr-test-analyzer Important 2 / comment-analyzer Critical 1 + Important 2 | 9 |
| CodeRabbit | Major 1 (ErrorLog schema 連動) + Minor 1 (docs 追従) | 2 |

### Lessons Learned (次セッションに持ち込む教訓)
1. **silent path を closing しているつもりで新たな silent path を作る pattern に警戒** — `.catch(() => {})` / bare `catch {}` は regression の温床。fallback path でも observability を surface する console.error を必ず残す
2. **fallback path も主経路と対称化を検討** — fire-and-forget の「最終手段 (last resort)」は partial delivery リスクを生む。drainSink 等の drain 機構がある場合は fallback Promise も push して完了保証に揃える方が設計として一貫
3. **type-only import の Omit/Pick で ErrorLog 本体と連動** — union 値の drift だけでなく interface shape drift も tsc で検知可能化。従来の inline type annotation より強い schema lock-in。circular dependency 回避のため type-only (runtime erased)
4. **ScheduleWakeup の cache 境界** — 270s 以下で cache 温存、300s 以上は amortize。CI ~5min 待機は 270s → 180s の 2 段が効率的
5. **CodeRabbit Minor は commit 粒度に注意** — 同一 PR 複数 commits で前 commit 時点の指摘が来る。「既に解消済」の判断を false positive として記録

### 見送り (follow-up 候補、今回 Issue 化せず)
- **Option A/B/C 採否の ADR 化**: JSDoc inline で当面十分、caller 2+ で再評価
- **ocrProcessor.ts 旧 `pendingLogs:` key の direct regression guard**: 現状 tsc + positive assertion で間接カバー、必要性低
- **`ErrorLogFallback = Pick<ErrorLog, ...> & { loaderError }` 型 export 化**: 既に Omit 形で inline 実装済、errorLogger.ts refactor 不要になった

### 次セッション着手候補 (優先度順)

**Phase 1 follow-up** (全 P2 enhancement、小粒で独立):
- **#312** contract test helper API 改善 (boolean → enum, string\|null 戻り値, Local alias 削除, ExtractOptions export 再検討)
- **#313** contract test 共通定数集約 + 抽出キャッシュ (SAFE_LOG_ERROR_CALL 統一、40% 削減)
- **#315** withNodeEnv helper 強化 (ESLint guard / positive assert / literal union narrow)
- **#317** test-strategy.md 継続改善 (二段防御具体例 / 命名規則マッピング / 委譲なし明記)

**その他 P2** (状況に応じて):
- #299 ts-node/esm 環境整備 + 動的 safeLogError invocation test (#303 完遂で fallback 動作のみ未 runtime 検証)
- #262 summaryWritePayloadContract diagnostics 強化
- #251 summaryGenerator unit test + buildSummaryPrompt 分離
- #239 force-reindex 監査ログ構造化

---

<a id="session20"></a>
## ✅ session20 完了サマリー (Phase 1 Contract test 共通基盤整備 完遂)

session19 で起票した #288 follow-up 6 件のうち、**Phase 1 (contract test 共通基盤整備)** を PM/PL WBS 3 PR 段階で完遂。Quality Gate (`/simplify` → `/review-pr` 並列 + Evaluator 分離) を全 PR で実施、Critical 指摘は全て本 PR 内で対応、低優先度を follow-up Issue 化。

| 順 | フェーズ | 結果 |
|---|---|---|
| 1 | **WBS 全体設計 (`/impl-plan`)** | ✅ 10 Issue を 5 Cluster に分解、Phase 1 (4 Issue) を 3 PR に分割 |
| 2 | **PR #311 (#302 + #307)**: brace/paren helper + SummaryField fixture 集約 | ✅ MERGED (`8fbed2e`) |
| 3 | **PR #314 (#306)**: withNodeEnv / withNodeEnvAsync helper 化 | ✅ MERGED (`f6d0cb0`) |
| 4 | **PR #316 (#308)**: docs/context/test-strategy.md + docstring 統一 | ✅ MERGED (`101a84a`) |
| 5 | **follow-up 4 件起票 (#312/#313/#315/#317)** | ✅ 全 P2 enhancement で整理済 |

### PR #311 設計ポイント (Closes #302 #307)
- **`extractBraceBlock(source, anchor, options?)`**: 5 ファイルで重複していた brace-nesting 抽出を共通化。`anchor: RegExp | string` 両対応 + `startAfterAnchor` option で制御フロー近接性 lock-in (#302 codex Low 1 追加対応)
- **`extractParenBlock`**: paren-nesting 版で `safeLogError(...)` 引数ブロック抽出の偽陽性回避
- **`makeInvalidPage` / `makeMixedPages`**: `as unknown as SummaryField` cast を 9 箇所 → 1 箇所に局所化 (Firestore 旧データ由来の discriminated union 違反再現 fixture)
- **silent PASS 防御**: silent-failure-hunter Critical C1/C2 を受け、prodBranch 空文字時に `to.not.match(/throw/)` が silent PASS する経路を `to.not.equal('')` non-empty guard で防御

### PR #314 設計ポイント (Closes #306)
- **`withNodeEnv<T>(value, fn): T` + `withNodeEnvAsync`**: `original === undefined` 時 `delete` で完全復元 (`"undefined"` 文字列化バグ防止)、`try/finally` で throw 経路も保護、async 版は `return await fn()` で race 回避
- **helper 単体 test 先取り (11件)**: PR #311 教訓 (pr-test-analyzer I3) を受け、nested 呼出 LIFO 順 / async reject / async 同期 throw / 戻り値透過を直接 lock-in
- **5 箇所の `try/finally` NODE_ENV toggle を helper 経由に統一** (Phase 2 由来 2 + Phase 3 由来 3)

### PR #316 設計ポイント (Closes #308)
- **`docs/context/test-strategy.md` 新規 (119 行、5 章構成)**: contract test 3 系統 (grep-based / `@ts-expect-error` / runtime pattern) の役割・手法・使い分けを一元化、共通 helper マッピング、選定フロー、docstring テンプレート、参考 Issue
- **9 contract test docstring を 4 節構造に統一**: 「目的 / 背景 / 方式 / 将来委譲」、reinvent されていた共通説明を `test-strategy.md §2.X 参照` に置換 (summary 系 3 ファイルは `/simplify` Reuse agent 指摘で scope 追加)
- **silent PASS 警告と non-empty guard 推奨 (§2.1) を明文化**: PR #311 review C1/C2 実例を引用

### Quality Gate 実施記録
- **PR #311 (Phase 1 PR-1)**: `/simplify` 3 並列 (4 件 skip 判断) → Evaluator 分離 APPROVE → `/review-pr` 6 並列 (**Critical 2 + Important 3**、全て本 PR 内対応: C1/C2 guard 追加 / helper 単体 test 新設 / CAP count tripwire / コメント簡素化)
- **PR #314 (Phase 1 PR-2)**: `/simplify` 3 並列 Green → `/review-pr` 6 並列 (**Critical 0 + Important 4**、本 PR 内対応: async 戻り値/同期throw/nested test + docstring 整合性修正)
- **PR #316 (Phase 1 PR-3)**: `/simplify` 3 並列 (summary 系 3 ファイル scope 追加判断) → `/review-pr` 4 並列 (**Critical 1 + Important 3**、本 PR 内対応: test-strategy.md 事実不整合修正 + 情報損失復活 3 件)

### メトリクス
- テスト: **548 → 570 passing (+22)**
- 新設ファイル: helpers 3 (`extractBraceBlock.ts` + `textCapFixtures.ts` + `withNodeEnv.ts`) + 単体 test 2 (`extractBraceBlock.test.ts` + `withNodeEnv.test.ts`) + docs 1 (`test-strategy.md`)
- 変更ファイル: 9 contract test (docstring 統一 + helper 経由移行)
- Quality Gate: Critical 指摘 3 件全て本 PR 内解決、follow-up は P2 低優先度のみ

### Follow-up Issues 起票 (4 件、累計 open へ追加)

| # | タイトル | 由来 |
|---|---------|------|
| **#312** | contract test helper API 改善 (boolean→enum, string\|null 戻り値, Local alias 削除, ExtractOptions export 再検討) | PR #311 `/review-pr` (type-design + code-simplifier + silent-failure-hunter + pr-test-analyzer) |
| **#313** | contract test 共通定数集約 + 抽出キャッシュ (SAFE_LOG_ERROR_CALL 統一 / textCapProdInvariantContract 抽出キャッシュ 40%削減) | PR #311 `/simplify` Q4 + E2 |
| **#315** | withNodeEnv helper 強化 (ESLint guard / positive assert / literal union narrow) | PR #314 `/review-pr` (silent-failure-hunter + type-design) |
| **#317** | test-strategy.md 継続改善 (二段防御具体例 / 命名規則マッピング表 / 委譲なし明記 / §2.1 適用範囲) | PR #316 `/review-pr` (pr-test-analyzer + silent-failure-hunter + comment-analyzer) |

### Lessons Learned (次セッションに持ち込む教訓)
1. **silent PASS 防御パターン (PR #311 教訓)**: grep-based contract test で `expect(block).to.not.match(...)` は空文字で silent PASS する。`expect(block).to.not.equal('')` guard を各 it 先頭に置くこと
2. **helper 単体 test の先取り (PR #311 → PR #314 反映)**: 新規 helper は contract test 経由の間接検証だけでは helper 固有挙動 (復元順序 / async 経路 / option) を保護できない。`helpers/*.test.ts` を初手から配置する
3. **scope 拡張判断 (PR #316)**: `/simplify` Reuse agent が「同パターン適用可能」と指摘した場合、低コストなら本 PR 内対応が follow-up churn を減らす (summary 系 3 ファイルを scope に追加で 9 ファイル統一感実現)
4. **PM/PL 段階分割の有効性**: 10 Issue を 1 PR にまとめると Evaluator 発動条件超過、5+ ファイル横断で review 負荷増。段階的な 3 PR 分割で各 PR に焦点を絞り、前 PR の教訓を次 PR に反映するループが機能

### 次セッション予定: Phase 2 着手 (#303 + #304)

WBS 当初計画通り **Cluster B: AggregateInvariantContext 観測性強化** を対象:
- **#304** AggregateInvariantContext の pendingLogs 型設計改善 (drainSink リネーム / brand type)
- **#303** handleAggregateInvariantViolation の errorLogger require 失敗時 errors collection fallback

想定: 2-3 ファイル、`/impl-plan` → `/simplify` + `/safe-refactor`、Evaluator 不要規模、1 セッション完遂見込み。実装本体の変更を含むため silent-failure-hunter 活躍領域。

---

<a id="session19"></a>
## ✅ session19 完了サマリー (#293 + #294 + #297 完遂、#299 見送り、follow-up 6 件起票)

session18 で独立化した #288 follow-up cluster (4 Issues: #293/#294/#297/#299) を Phase 1〜4 に PM/PL WBS 分解して進行。**Phase 2-3 完遂、Phase 4 は Cloud Functions Node v20 縛りと CI 環境差分で計画通り見送り判断**。Quality Gate 6 段階 (/impl-plan → /simplify → /safe-refactor → Evaluator → /review-pr → /codex review) を Phase 2 で full 実施、Phase 3 で軽量 flow 適用。

| 順 | フェーズ | 結果 |
|---|---|---|
| 1 | **Phase 0: 現状把握** | ✅ textCap.ts / ocrProcessor.ts / capPageText dev-assert / contract test 構造 把握 |
| 2 | **Phase 1: 設計判断** | ✅ Option B' (context.pendingLogs mutable array) 採用、既存戻り値 signature 維持 |
| 3 | **Phase 2 (#293+#297 統合): caller try/catch + pendingLogs drain** | ✅ PR #301 MERGED (`9cb42b7`) |
| 4 | **Phase 3 (#294): integration/mixed-input + @ts-expect-error 型契約 + caller wrapper runtime** | ✅ PR #305 MERGED (`4be6889`) |
| 5 | **Phase 4 (#299): 動的 safeLogError invocation test** | ⏸️ PR #309 close (CI Node v20 ESM race condition、3 回失敗ルール該当) |
| 6 | **Follow-up 6 件起票 (#302-#304, #306-#308)** | ✅ 全て P2 enhancement で整理済 |

### Phase 2 設計ポイント (PR #301)
- **Option B' 採用根拠**: Option A (戻り値 `{results, pendingLogs}` 変更) は既存 textCap.test.ts 10+ 箇所の戻り値直接使用を破壊、Option B (signature async 化) は内部 map runningTotal 順序依存で diff 拡大、throw → warn+return 緩和は #284 契約 (dev throw) 破壊
- **`AggregateInvariantContext.pendingLogs?: Promise<void>[]`** 追加、`handleAggregateInvariantViolation` が prod 分岐で push、未渡し時 fire-and-forget (後方互換維持)
- **caller (ocrProcessor.ts:150)**: try/catch + `await Promise.allSettled(pendingInvariantLogs)` で #297 flush 保証、dev throw を捕捉して他ページ処理継続 (#293 silent-failure-hunter S2 対応)
- **catch 内 functionName suffix**: `:aggregateCap:invariant` (既知 invariant) と `:aggregateCap:unexpected` (実装バグ) で codex 指摘の catch boundary 過大リスクを suffix 分類で triage
- **allSettled rejected 件数防御監視**: 将来 safeLogError reject 経路追加時の silent 防止 (silent-failure-hunter #3 採用)

### Phase 3 設計ポイント (PR #305)
- **tsd 導入見送り → `@ts-expect-error` 代替**: devDep + CI 設定コストが #294 scope 超過、既存 pageOcrResult.types.test.ts パターン踏襲で同等 lock-in
- **processDocument フル E2E → runtime pattern test 代替**: admin 依存で unit test 不能。`aggregateWithCallerWrapper` として caller wrapper パターンを inline 再現、spy 注入で動的検証。**PR #301 Evaluator HIGH 指摘 (AC-4/AC-5 動的 assert 不在) への部分解消**
- **`LogErrorParams` 型統一**: errorLogger.ts からの import で inline 重複 5 箇所解消
- **`makeInvalidPage` / `makeMixedPages` helper**: 新規 3 箇所のキャスト/パターン重複吸収 (既存 8 箇所は別 Issue #307 へ分離)
- **strict assert 化**: `oneOf([0, 2])` → `.equal(0)` + unit test 環境 (admin 未初期化) 前提明示、regression 見逃し解消

### Phase 4 見送り根拠 (Issue #299 待機)
- **PR #298 試行 (2 回) + PR #309 再試行 (1 回) = 通算 3 回失敗** (CLAUDE.md 3 回失敗ルール該当)
- **CI Node v20 (Cloud Functions ランタイム縛り) vs ローカル Node v24 の差分**: `createRequire(import.meta.url)` が CI では ESM race condition 発動、ローカルでは安定
- **代替達成**: Phase 3 の runtime pattern test (4 cases) で AC-4/AC-5 動的検証済、silent failure 検知の主目的は達成
- **再起動条件**: Cloud Functions v22 ランタイム移行時 / #303 errorLogger fallback と bundle 化 / prod 動的 verify 規制要件化

### Follow-up Issues 起票 (6 件、累計 7 件 open)

| # | タイトル | 推奨順 |
|---|---------|--------|
| **#302** | contract test brace-nesting helper 5 ファイル横断共通化 | **推奨 #1** (新規 contract test 追加で雪だるま化予防) |
| **#306** | `withNodeEnv` helper で NODE_ENV toggle 独立性担保 | **推奨 #2** (Mocha 並列化準備) |
| **#307** | `makeInvalidPage` fixture で cast 重複 8 箇所統一 | 推奨 #3 |
| #303 | errorLogger require 失敗時 errors collection fallback | #299 と bundle 候補 |
| #304 | AggregateInvariantContext drainSink リネーム + brand type | Type 設計改善 |
| #308 | contract test docstring 共通 pattern を docs/context 抽出 | 低 |
| #299 | ts-node/esm 環境整備 + 動的 test | **待機中** (再起動条件 3 つ) |

### Quality Gate 実施記録
- **PR #301 (Phase 2)**: /impl-plan → /simplify (3 並列、10 指摘 3 採用) → /safe-refactor (5 観点 clean) → Evaluator (APPROVED WITH SUGGESTIONS、1 採用) → /review-pr (6 エージェント、Critical 0、3 採用) → /codex review (APPROVE WITH SUGGESTIONS、2 採用) = 累計 9 件採用、本体 2 ファイル + test 3 ファイル
- **PR #305 (Phase 3)**: /simplify (3 並列、7 指摘 4 採用) → /review-pr (4 エージェント軽量) → /codex review (APPROVE WITH SUGGESTIONS、3 採用) = 累計 6 件採用、test 3 ファイルのみ
- **PR #309 (Phase 4)**: ローカル 555 PASS → CI Fail → 即 PR close、Issue コメントで Lessons Learned 記録

### Lessons Learned (Issue #299 にも記録)
1. **Cloud Functions プロジェクトでは CI Node version と揃えたローカル POC が必須**。ローカル v24 PASS は CI v20 PASS を保証しない
2. `createRequire(import.meta.url)` 経路は Node ESM/CJS race condition に脆弱。Cloud Functions 環境では `sinon`/`proxyquire` 等の明示的依存注入が安定
3. 3 回失敗ルールで即撤退判断、無理押しなし。PR #298/#309 の通算 3 回で判断
4. Quality Gate 6 段階を PM/PL の定型プロセスとして運用: 設計判断 → impl-plan → simplify → safe-refactor → Evaluator → review-pr → codex → 採否判断 → merge → follow-up 起票

---

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

## 過去のセッション

session14 以前は [archive/2026-04-history.md](./archive/2026-04-history.md) を参照 (2026-04-20 session19 で session12 + session14 を追加アーカイブ)。
