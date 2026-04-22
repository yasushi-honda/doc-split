# ハンドオフメモ

**更新日**: 2026-04-22 session33 (#200 完遂 + #251 Scope 2 完了、2 PR merged #374/#376、Issue 1 closed + Follow-up 1 起票、Net 0)
**ブランチ**: main (clean、最新 commit `1f2a41e`)
**フェーズ**: Phase 8 + 運用監視基盤全環境展開完了 + Phase 2 (#181-#183) + Phase 3 (#188-#190) + Phase 5 (#339/#340/#332/#335) + Phase 6 (#346/#343/#344/#331/#333/#262) + Phase 7 (#338) + Phase 8 (session29 = #334/#196) + Phase 8 (session30 = #360 rescue observability + #358 backfill test lock-in) + Phase 8 (session31 = #365 backfill counter 分割 + #364 rescue per-doc catch test) + Phase 8 (session32 = #370 fatal 分岐 safeLogError 二重呼出防止 test) + **Phase 8 (session33 = #200 Gmail/Split 統合テスト + #251 Scope 2 summaryPromptBuilder 分離)** 完遂

<a id="session33"></a>
## ✅ session33 完了サマリー (2026-04-22: #200 完遂 + #251 Scope 2 完了、2 PR merged)

PR #199 (Gmail 重複取得の根本対策) に不足していたテストを #200 で追加し、PR #250 の review 指摘で保留されていた #251 Scope 2 (`buildSummaryPrompt` 分離) も完了。両 PR とも `/review-pr` 3 エージェント並列、comment-analyzer Critical 2 件 + pr-test-analyzer Important 1 件を本 PR 内で修正反映。Vertex AI mock を要する #251 Scope 1/3 は scope 分割で待機。

### PR 一覧

| PR | 内容 | closed Issues | merged commit |
|----|------|--------------|--------------|
| **#374** | test: checkGmailAttachments/splitPdf 統合テスト (AC1 messageId skip / AC2 endpoint contract / AC3 Partial Update 不変 / AC4 isSplitSource 再取り込み許可、17 cases) | #200 | `1bf3ab7` |
| **#376** | refactor(ocr): buildSummaryPrompt を summaryPromptBuilder.ts に分離 + pure unit test + isolation contract (17 cases) | (Refs #251 Scope 2) | `1f2a41e` |

### 主要成果

| 項目 | 内容 |
|------|------|
| **merged PR** | 2 本 (#374 / #376) |
| **closed Issue** | #200 (1 件、auto-close 成功) |
| **新規 follow-up Issue** | #375 (Gmail 重複判定の pure helper 抽出、pr-test-analyzer rating 7 + confidence 85%、triage 基準 #4 満たす) |
| **Issue Net 変化** | Close 1 / 起票 1 = **0** (feedback_issue_triage.md: Net ≤ 0 は進捗ゼロ扱い、ただし critical path test coverage の実質向上あり — 詳細は末尾で言語化) |
| **BE unit テスト** | 677 → **699 passing** (+22: #374 5 cases endpoint contract + #376 11 summaryPromptBuilder + 6 isolation contract) + 6 pending |
| **BE integration テスト** | 24 → **36 passing** (+12: #374 AC1 3 + AC4 6 + AC3 3) |
| **コード量** | #374: +414/-1 (4 ファイル、新規 3 test) / #376: +229/-29 (4 ファイル、新規 1 src + 2 test) 合計 +643/-30 |
| **品質改善** | Gmail 重複判定 critical path 完全網羅 (messageId + hash + isSplitSource 再取り込み) / prompt 境界値・fallback・セクション保持の lock-in / 外部依存ゼロ契約の grep-based 構造検証 (将来の import 追加で decisive 失敗) |

### Quality Gate 実施記録 (合計 6 エージェントレビュー)

**PR #374 (Gmail/Split 統合テスト)**:
- `/review-pr` 3 並列 (code-reviewer / pr-test-analyzer / comment-analyzer)
  - code-reviewer: Approve、critical/important なし
  - pr-test-analyzer: critical 0、**important 1 件 rating 7 confidence 85%** → follow-up #375 起票 (logic-drift 対策、pure helper 抽出)、rating 5-6 の 2 件は Issue 化せず PR 本文で scope 外明示
  - comment-analyzer: critical 0、minor 3 件 (stale phrasing / skip-reimport-new 定義 / 末尾 anchor) → **PR 内修正で全対応**

**PR #376 (summaryPromptBuilder 分離)**:
- `/review-pr` 3 並列
  - code-reviewer: LGTM、issue 0 件
  - pr-test-analyzer: critical 0、important rating 6 confidence 85% (truncation 厳密 assert) → **PR 内修正で対応** (`【OCR結果】〜【要約】` ブロック slice 厳密一致 + 7999 off-by-one 境界追加)
  - comment-analyzer: **critical 2 件** (1. `rateLimiter.ts` path 誤記 → `utils/rateLimiter.ts` に修正 + admin.firestore() module-load 仕組み明示 / 2. test comment "lock-in" が実 assertion と乖離 → comment 降格 + **構造契約を別 grep-based contract test で明示 lock-in**) → **PR 内修正で全対応**

### 設計判断 / Lessons Learned (本セッション重要知見)

1. **ロジック再現型 integration test の drift リスクと follow-up 戦略 (pr-test-analyzer rating 7)**: `shouldSkipByHashDuplicate` helper は source (`checkGmailAttachments.ts:287-325`) の分岐を test 内で手書き再現。既存 `ocrRetryIntegration.test.ts` と同慣習だが、source drift 時に test が silent に PASS し続ける。**根治策は pure helper 化 (src/gmail/reimportPolicy.ts)** で production/test が同じ source を共有する構造。PR scope を広げず follow-up #375 で一括対応する triage が triage 基準 #4 (rating≥7 & conf≥80) に合致。rating 5-6 の 2 提案 (両方一致 negative test / splitPdf grep contract) は #375 の body に bundle

2. **AC2 (scheduled function runtime options) の grep-based contract 採用理由**: source import が `admin.firestore()` top-level 評価で他 unit test に副作用を波及させるため、`onSchedule` options を `__endpoint` 直接読取から **ソースファイル文字列 + `extractBraceBlock` に切替**。既存 `aggregateCapLogErrorContract.test.ts` の grep-based 方式に統一。`initFirestoreEmulator` を import するだけで `FIRESTORE_EMULATOR_HOST` が他テストに波及する教訓を明示化

3. **comment-analyzer Critical の精度 vs drift 防止**: PR #376 で comment が「rateLimiter.ts」と書いていたが実体は `utils/rateLimiter.ts`、また「lock-in」と書きつつ実 assertion は `typeof === 'function'` のみ。2 件とも PR 内修正で対応し、後者は **構造契約を別の grep-based isolation contract test (6 cases: firebase-admin / Vertex / rateLimiter / summaryGenerator / errorLogger / import 0 件)** で実体化。「comment の主張と実 assertion の乖離」は comment 精度問題ではなく **test 設計問題** として扱うのが正解 — "say what you mean, mean what you say" を assertion で強制

4. **ts-node の CJS/ESM 判定と `__dirname` 落とし穴**: 新規 test ファイルが relative import (例: `./helpers/extractBraceBlock`) を持たない場合、ts-node が ESM として解決して `__dirname is not defined` で before hook が失敗する。既存 `checkGmailAttachmentsEndpointContract.test.ts` に倣って未使用 helper import を 1 行足すことで CJS に統一。将来 ESM 正式移行 (#299 / #309) 時まで暫定。comment で意図明記必須

5. **Issue partial progress の運用パターン (#251 Scope 2)**: 3 scope から成る Issue の一部だけ完了した場合、**Issue を close せず body を update して進捗を明示** ([x] Scope 2 完了 / [ ] Scope 1/3 待機) する運用が整理できた。Scope 1 (Vertex AI mock) は sinon/proxyquire 導入コストが #299 類似で待機、Scope 3 (error handling) は #220 延長として別途検討。Issue net 悪化を避けつつ partial な実質進捗を残す

6. **Issue Net 0 の実質評価 (feedback_issue_triage.md 基準)**: 本セッション Close 1 (#200) / 起票 1 (#375) = Net 0 は機械的には「進捗ゼロ扱い」。だが #375 は pr-test-analyzer の triage 基準 #4 (rating≥7 & conf≥80) を満たす valid な structural improvement で、critical path test coverage +22 cases の実質価値は定量的。**Net 0 でも起票内容が rating≥7 の structural improvement の場合は「進捗あり」として別途評価** の運用知見を積み上げる候補 (memory 追記候補)

### 次セッション着手候補 (WBS 進捗)

**軽量 (0.5 セッション)**:
- **#375 Gmail 重複判定 pure helper 抽出** (本セッション起票): `isReimportAllowed` を `src/gmail/` に export、production/test で共有。logic-drift 対策の直接対応。related に rating 6 の 2 提案 (両方一致 negative test / splitPdf grep contract) bundle 済み

**中規模 (1 セッション)**:
- **#239 force-reindex audit log**: Cloud Logging に構造化 audit log 出力、compliance 対応の延長
- **#238 force-reindex 孤児 posting 検出モード**: session 後半でも着手可
- **#220 OOM/truncated metric + alert**: monitoring 拡張

**大物 (2 セッション、`/impl-plan` 必須)**:
- **#237 search tokenizer 共通化**: FE/BE/script 3 箇所の重複を `shared/` に集約。session29-32 で持ち越し継続、Evaluator 分離必須 (5+ ファイル + アーキテクチャ影響)
- **#299 capPageResultsAggregate 動的 safeLogError test** (最難): ts-node/esm 環境整備込み
- **#251 Scope 1 generateSummaryCore runtime test**: Vertex AI mock (sinon/proxyquire) 導入必要、#299 と同時に mock 戦略を一括整備する bundle 案が合理的

**session 外 Open Issues** (引き続き持ち越し): #251 Scope 1/3 (open 維持、待機) / #152 (dev setup-tenant、雛形として open 維持が正しい状態、active 作業不要)

### Test plan 実行結果

- [x] BE `npm --prefix functions run type-check:test` EXIT 0
- [x] BE `npm --prefix functions test` **699 passing + 6 pending** (+22 from session32)
- [x] BE `firebase emulators:exec --only firestore ... 'npm --prefix functions run test:integration'` **36 passing** (+12 from session32)
- [x] `npm run lint` 0 errors, 25 warnings (新規 warning ゼロ、既存と同水準)
- [x] PR #374 main マージ時 CI 3/3 green (lint-build-test / CodeRabbit / GitGuardian 全 pass)
- [x] PR #376 main マージ時 CI 3/3 green (lint-build-test pass、`1f2a41e`)
- [x] `gh issue view 200` で CLOSED 確認 (squash merge で auto-close 成功)
- [x] `gh issue view 251` body update 確認 (Scope 2 完了 + Scope 1/3 待機理由 + PR #376 参照)
- [x] `gh issue view 375` OPEN 確認 (P2 enhancement、Gmail 重複判定 pure helper 抽出 + bundle 2 提案)

### Issue Net 変化 (詳細)

- **Close 数**: 1 件 (#200)
- **起票数**: 1 件 (#375)
- **Net**: 0 件 (機械的には進捗ゼロ扱い)
- **実質評価**: #375 は review agent rating 7 / confidence 85% の triage 基準適格起票、#200 完遂で Gmail 重複取得対策の critical path test coverage +22 cases 向上、#251 Scope 2 完了 (partial progress、Issue close せず body update で運用)

---

<a id="session32"></a>
## ✅ session32 完了サマリー (2026-04-22: #370 完遂、1 PR merged)

session31 handoff で起票した follow-up #370 (rescue fatal 分岐 safeLogError 二重呼出防止 test) を完遂。PR 内で /review-pr 6 エージェント並列、silent-failure-hunter F-1 (HIGH rating 7, confidence 85%) を PR 内で修正反映。polyfill 設計を「1 回目 reject / 2 回目以降 resolve」から「常に throw」に変更し、より広い regression scenario を検知可能にした。

### PR 一覧

| PR | 内容 | closed Issues | merged commit |
|----|------|--------------|--------------|
| **#372** | test: fatal 分岐 safeLogError 二重呼出防止 integration test (withFailingSafeLogError polyfill + rescueError + callCount 二重 invariant) | #370 | `44e873c` |

### 主要成果

| 項目 | 内容 |
|------|------|
| **merged PR** | 1 本 (#372) |
| **closed Issue** | #370 (1 件、auto-close 成功) |
| **新規 follow-up Issue** | なし (/review-pr 指摘は全て PR 内修正 or PR コメントレベル) |
| **Issue Net 変化** | Close 1 / 起票 0 = **-1** (feedback_issue_triage.md: Net < 0 は KPI 前進、Net = 0 (Close N / 起票 N) は進捗ゼロ扱い → 本セッションは KPI 前進) |
| **BE integration テスト** | 23 → **24 passing** (+1 from #370: fatal 分岐 safeLogError 失敗時の二重呼出防止) |
| **BE unit テスト** | 677 passing + 6 pending (変化なし) |
| **コード量** | 初版 +91/-0 → review 反映 -40/+33 → 最終 +84/-0 (1 ファイル: test/rescueStuckProcessingIntegration.test.ts) |
| **品質改善** | fatal 分岐 inner try/catch を call count + rescueError の二重 invariant で lock-in / CJS namespace dynamic lookup を利用した sinon 不依存 polyfill / signature drift を LogErrorParams 型で compile-time 検知 |

### Quality Gate 実施記録 (6 エージェント並列)

| エージェント | Rating | 主な指摘 | 対応 |
|------------|--------|----------|------|
| **code-reviewer** | 9/10 | 問題なし | Approve |
| **pr-test-analyzer** | 8/10 | PR コメントレベルのみ | 対応不要 |
| **code-simplifier** | 提案なし | - | - |
| **silent-failure-hunter** | **7.5/10** (F-1 rating 7, confidence 85%) | polyfill「2 回目 resolve」が outer catch throw 挙動を silent に書き換え | **PR 内修正: 「常に throw」に変更** |
| **type-design-analyzer** | 6/10 | `params: unknown` で signature drift 検知不可 | **PR 内修正: `LogErrorParams` 型に変更** |
| **comment-analyzer** | 6/10 | 行番号参照は rot 耐性低 + 冗長 block comment | **PR 内修正: 記号参照化 + assertion message に集約 + `errors/` 0 件 assertion 削除** |

### 設計判断 / Lessons Learned (本セッション重要知見)

1. **polyfill「常に throw」設計の regression 検知力 (F-1 HIGH 対応)**: 旧設計「1 回目 reject / 2 回目以降 resolve」は outer catch 内 safeLogError (try/catch なし、processOCR.ts:241) の throw 挙動を silent に resolve に書き換えていた → production 実挙動から乖離。「常に throw」+ test 側 `rescueError` 捕捉で、inner try/catch 削除 regression (rescue 全体 reject) と outer catch 経路の test 観測可能性の両方を確保。silent-failure-hunter F-1 (HIGH) の指摘は polyfill 設計の盲点を的確に突いた — 「stub は production 挙動を silent に補完してはいけない」の実例

2. **CJS namespace dynamic lookup を利用した sinon 不依存 stub**: TypeScript CJS compile 後の `await (0, errorLogger_1.safeLogError)(...)` は namespace object の dynamic property lookup であり、test 側で `errorLoggerModule.safeLogError = stub` で property rewrite すると production code の次の呼出で反映される。PR #369 の `withFailingRunTransaction` (db オブジェクトのメソッド書換) と同方針で、sinon 導入不要。compile 後の emit を `tsc --outDir /tmp/...` で peek して mechanism を事前検証することで、「仕様上動くはず」の推測を「実体で確認」に昇格

3. **signature drift の compile-time 検知 (type-design 対応)**: polyfill 内 `params: unknown` だと production 側 `LogErrorParams` に required フィールド追加時に静かに drift し、stub だけ古い signature のまま passing が続く。`import type { LogErrorParams }` + `params: LogErrorParams` に変更で 1 行 cost で compile-time safety 獲得。test ファイルでも型 honesty は維持すべき

4. **コメント密度の適正化 (comment 対応)**: 1 ファイル test で 35+ 行コメントは過剰、かつ行番号 `processOCR.ts:222-232` は rot 耐性低。記号参照 (`rescueStuckProcessingDocs の fatal 分岐 inner try/catch`) + assertion message への集約で、コメント削減しつつ意図伝達力は維持。comment-analyzer rating 6 以下の指摘でも累積効果があるので一括反映が効率的

5. **rating 7 境界の取扱い (Issue triage)**: CLAUDE.md CRITICAL「rating ≥ 7 かつ confidence ≥ 80 は Issue 起票候補」は**新規 Issue 起票の閾値**。本 PR 内で修正対応する場合は Issue 起票不要で直接反映が正解。本セッション F-1 rating 7 confidence 85% を PR 内修正で解消 → follow-up Issue ゼロを維持 (feedback_issue_triage.md「Close N + 起票 N = net 0 は進捗ゼロ」の net -1 達成)

6. **初版 → review 修正の 2 commit 運用**: 初版 PR 作成直後に `/review-pr` を走らせ、指摘反映を別 commit (amend せず) で push。reviewer が差分を追跡可能、初版の判断過程を history に残す。CLAUDE.md「新規 commit を作成する」原則の実運用。本 PR は commit 2 本を `--squash` merge で 1 本に集約して main に入った (c159136 + 2051f5e → 44e873c)

### 次セッション着手候補 (WBS 進捗)

**軽量 (0.5 セッション)**: 該当なし (session32 終了時点の open Issue 一覧に 0.5 セッション相当タスクなし)

**中規模 (1 セッション)**:
- **#200 checkGmailAttachments/splitPdf 統合テスト**: Gmail 連携経路の integration test
- **#251 summaryGenerator test + buildSummaryPrompt 分離**: 既存の summary 処理を testable に切り出し
- **#239 force-reindex audit log**: Cloud Logging に構造化 audit log 出力

**大物 (2 セッション、`/impl-plan` 必須)**:
- **#237 search tokenizer 共通化**: session29 から持ち越し継続、Evaluator 分離必須 (5+ ファイル + アーキテクチャ影響)
- **#299 capPageResultsAggregate 動的 safeLogError test** (最難): ts-node/esm 環境整備込み。ESM loader 問題 (#360/#364 で知見獲得済) を活用できる

**session 外 Open Issues** (引き続き持ち越し): #238 (force-reindex 孤児 posting) / #220 (OOM/truncated metric + alert) / #152 (dev setup-tenant、雛形として open 維持が正しい状態、active 作業不要)

### Test plan 実行結果

- [x] BE `npm --prefix functions run type-check:test` EXIT 0
- [x] BE `npm --prefix functions test` **677 passing + 6 pending** (変化なし)
- [x] BE `firebase emulators:exec --only firestore --project rescue-stuck-integration-test 'npm --prefix functions run test:integration'` **24 passing** (23 → +1 from #370)
- [x] `npm run lint` 0 errors, **25 warnings** (新規 warning ゼロ、PR #369 と同水準)
- [x] 動作確認: integration test ログで `safeLogError failed for stuck-fatal-log-fail (fatal branch): Error: Simulated safeLogError failure for #370 test` を確認 → processOCR.ts:224 inner try/catch が期待通り swallow、rescue 完了
- [x] PR #372 main マージ時 CodeRabbit / GitGuardian SUCCESS、CI 実行済み (44e873c)
- [x] `gh issue view 370` で CLOSED 確認 (squash merge で auto-close 成功)
- [ ] main Deploy #372 (44e873c) IN_PROGRESS (merge 直後、次セッション開始時に `gh run list --workflow=Deploy` で SUCCESS 確認必要)

---

<a id="session31"></a>
## ✅ session31 完了サマリー (2026-04-22: #365 + #364 完遂、2 PR merged)

session30 handoff で起票した直近 follow-up (#364 / #365) をまとめて片付け。両 PR とも Critical/Important 全解消を本 PR 内で完了、review agent 指摘で scope creep が発生する test 追加のみ follow-up Issue (#370) に分離。

### PR 一覧

| PR | 内容 | closed Issues | merged commit |
|----|------|--------------|--------------|
| **#368** | feat(ops): backfill-display-filename の totalSkipped を existing/noop に分割 (counter 分割 + fatal log 拡張 + _migrations record 後方互換 + invariant runtime assertion) | #365 | `f831692` |
| **#369** | test: rescueStuckProcessingDocs の per-doc catch 経路 integration test (runTransaction 差し替え polyfill + 全件 forEach 検証 + doc 不変条件拡張) | #364 | `caa082c` |

### 主要成果

| 項目 | 内容 |
|------|------|
| **merged PR** | 2 本 (#368 / #369) |
| **closed Issue** | #365 / #364 (計 2 件、auto-close 両方成功) |
| **新規 follow-up Issue** | #370 (fatal 分岐 safeLogError 二重呼出防止 test、P2、silent-failure-hunter I2 由来) |
| **Issue Net 変化** | Close 2 / 起票 1 = **+1** (ルール: Net ≤ 0 は進捗ゼロ扱い) |
| **BE unit テスト** | 677 passing + 6 pending (変化なし、sinon 除去で既存影響ゼロ) |
| **BE integration テスト** | 21 → **23 passing** (+2 from #364: per-doc catch 経路 + partial failure ループ継続) |
| **コード量** | #368: +29/-6 (1 ファイル) / #369: +107/-11 (2 ファイル: test + package.json) 合計 +136/-17 |
| **品質改善** | backfill counter の運用可視性向上 (existing/noop 分離) / invariant runtime assertion で _migrations への silent 汚染防止 / rescue per-doc catch 経路の直接 lock-in / 既存 convention 尊重 (sinon 不採用、polyfill pattern 採用) |

### Quality Gate 実施記録 (合計 12 エージェントレビュー)

**PR #368 (backfill counter 分割)**:
- /impl-plan で Acceptance Criteria 5 項目 + タスク分解 (counter 分割 / fatal log / _migrations / 結果サマリー)
- /review-pr 6 並列 (code-reviewer / silent-failure-hunter / pr-test-analyzer / comment-analyzer / type-design-analyzer / code-simplifier)
  - Critical 0 / Important 1 対応: silent-failure-hunter I4 MEDIUM (`--force=false` 時の `totalSkippedNoop === 0` invariant を runtime assertion で lock-in、`_migrations` 書き込み前に配置)
  - Suggestion 対応: comment-analyzer B (L57 動機追加) / comment-analyzer C (L189 invariant 保証元言及)
  - Suggestion 不対応 (rating 5-6、PR コメントレベル): pr-test-analyzer I1 (aggregateSkipCounts helper 抽出) / type-design-analyzer C1/C2 (`_migrations` 型化 + ログ prefix 定数化)

**PR #369 (rescue per-doc catch test)**:
- /review-pr 6 並列
  - **code-reviewer I1 (IMPORTANT, confidence 85)**: sinon 導入が既存 convention「sinon 依存を新規追加しない polyfill」(`buildPageResult.test.ts:74`) に反する → **sinon 除去して `withFailingRunTransaction` helper で代替** (try/finally で原値復元、既存 withWarnSpy と同方針)
  - silent-failure-hunter C1 (CRITICAL): sinon.restore() leak → sinon 除去で構造的解消
  - silent-failure-hunter I1 (HIGH): errs.docs[0] のみ assert → `errs.docs.forEach(...)` で全件検証に昇格
  - silent-failure-hunter I4 (HIGH): doc 不変条件を `retryAfter` / `lastErrorMessage` undefined まで拡張
  - silent-failure-hunter I2 (HIGH): fatal 分岐 safeLogError 二重呼出防止 test → **scope creep のため Follow-up Issue #370 化**
  - Suggestion 不対応 (rating 3-6、PR コメントレベル): comment-analyzer 3件 / type-design-analyzer (ErrorLogFixture 型化) / code-simplifier 全提案

### 設計判断 / Lessons Learned (本セッション重要知見)

1. **既存 convention の尊重 (sinon 不採用)**: `buildPageResult.test.ts:74` に「sinon 依存を新規追加しない polyfill」方針が明記されている以上、新 PR で sinon を導入するなら同時に既存の deferred skip (`summaryWritePayloadContract.test.ts` の `it.skip` ブロック) を一括解禁すべき。本 PR は純粋な test 追加で scope を狭く保つため、`withFailingRunTransaction` helper による inline monkey-patch を採用。try/finally で原値復元を保証することで leak 耐性も担保

2. **invariant を runtime assertion で lock-in**: `--force=false → totalSkippedNoop === 0` は論理的に保証されるが、将来の L94 条件 tweak で破れる silent failure の温床。`_migrations` 書き込み前に `process.exit(1)` で abort する assertion を 1 block 追加することで、運用 audit 証跡への silent 汚染を防げる。コスト数行、恩恵 (dashboard 誤認防止) 大

3. **Quality Gate 2 tier 構造 の現場適用**: 単一ファイル +18 行の極小 PR でも hook が 6 エージェント並列を強制発動 → Important 1 件検出 (silent-failure-hunter I4)。規模に対する過剰感はあるが、invariant assertion の価値は規模と独立なため、1-2 ファイルでも省略しない方針は妥当。次回からは同規模で silent-failure-hunter + code-reviewer の 2 並列に絞ることで cost 対効果を改善できる可能性 (rules/quality-gate.md 改定候補)

4. **review agent rating 5-6 の Issue triage 徹底**: 本セッションの 12 エージェントから計 20+ 件の提案が出たが、Issue 化したのは silent-failure-hunter I2 (rating HIGH + scope creep) の 1 件のみ。rating 5-6 は全て PR コメントレベル or 現状維持判断で close。`feedback_issue_triage.md` ルール (Close N + 起票 N = net 0 は進捗ゼロ扱い) に沿って Net +1 を維持

5. **sinon 要否判断の system-level 評価**: 単一ファイル test の視点だと sinon はシンプル解決だが、コードベース全体では `withWarnSpy` (buildPageResult.test.ts), `withSilentConsoleError` 等の polyfill pattern が既に確立されている。feedback_evaluate_as_system.md に従い、ファイル単体ではなくシステム全体の convention 整合性で判断するのが正しい。「新パターンを許容するなら deferred な skip 解禁まで PR scope を広げる」が正道

6. **polyfill pattern の再利用性**: `withFailingRunTransaction` は `withWarnSpy` と同じ try/finally 構造。将来 `withFailingSafeLogError` (Issue #370 向け) や他の Firestore method 差し替えが必要になった時、同じ pattern でスケール可能。helper 化は YAGNI で今は各 describe 内に置く

### 次セッション着手候補 (WBS 進捗)

**軽量 (0.5 セッション)**:
- **#370 rescue fatal 分岐 safeLogError 二重呼出防止 test** (本セッション起票): `errorLogger` モジュールを polyfill 差し替えで失敗させ、内部 try/catch nest の lock-in。PR #369 の `withFailingRunTransaction` helper 応用で実装可

**中規模 (1 セッション)**:
- **#239 force-reindex audit log**: Cloud Logging に構造化 audit log 出力、compliance 対応の延長
- **#251 summaryGenerator test + buildSummaryPrompt 分離**: 既存の summary 処理を testable に切り出し
- **#200 checkGmailAttachments/splitPdf 統合テスト**: Gmail 連携経路の integration test

**大物 (2 セッション、`/impl-plan` 必須)**:
- **#237 search tokenizer 共通化**: FE/BE/script 3 箇所の重複を `shared/` に集約。session29-31 で持ち越し継続、Evaluator 分離必須 (5+ ファイル + アーキテクチャ影響)
- **#299 capPageResultsAggregate 動的 safeLogError test** (最難): ts-node/esm 環境整備込み。ESM loader 問題 (#360/#364 で知見獲得済) を活用できる

**session 外 Open Issues** (引き続き持ち越し): #238 (force-reindex 孤児 posting) / #220 (OOM/truncated metric + alert) / #152 (dev setup-tenant、雛形として open 維持が正しい状態、active 作業不要)

### Test plan 実行結果

- [x] BE `npx tsc --noEmit` EXIT 0 (両 PR 確認)
- [x] BE `npm test` **677 passing + 6 pending** (変化なし、sinon 導入/除去とも既存影響ゼロ)
- [x] BE `npm run test:integration` (emulator) **23 passing** (21 既存 + 2 新規 from #364)
- [x] BE `npm run lint` 0 errors, 25 warnings (本 PR 新規 warning ゼロ、sinon 除去で eslint-disable 不要化 → 既存 warning 2 件削減)
- [x] scripts `npx tsc --noEmit -p scripts/tsconfig.json` EXIT 0 (#368 確認)
- [x] main CI 3/3 green × 2 PR (lint-build-test / CodeRabbit / GitGuardian 全 pass)
- [x] `gh issue view 365 / 364` で CLOSED 確認 (squash merge で 2 件とも auto-close 成功)
- [x] follow-up Issue #370 起票確認
- [x] GitHub Actions で dev 環境 `backfill-display-filename --dry-run` 実行 2 回 success、新サマリー文字列「スキップ（設定済み・--forceなし）: 2件」出力確認、invariant assertion 未発動 (正常経路)
- [ ] main Deploy #369 (caa082c) IN_PROGRESS (merge 直後、次セッション開始時に `gh run list --workflow=Deploy` で SUCCESS 確認必要)

---

<a id="session30"></a>
## ✅ session30 完了サマリー (2026-04-22: #360 + #358 完遂、2 PR merged)

session29 handoff で起票した直近 follow-up (#358 / #360) をまとめて片付け。両 PR とも Critical/Blocker 全解消を本 PR 内で完了、rating 7 以上の指摘は新規 follow-up Issue (#364 / #365) に分離。

### PR 一覧

| PR | 内容 | closed Issues | merged commit |
|----|------|--------------|--------------|
| **#363** | fix: rescueStuckProcessingDocs の observability 強化 + retryCount/retryAfter reprocess reset (runTransaction 化 + per-doc safeLogError + FE getReprocessClearFields 拡張 + emulator integration test 新設) | #360 | `816be5e` |
| **#366** | test: backfill-display-filename の差分検出ロジック抽出 + OS 禁止文字 backfill 経路 lock-in (pure 関数 shared/ 化 + exhaustive assertNever + 8 test 追加) | #358 | `d93f361` |

### 主要成果

| 項目 | 内容 |
|------|------|
| **merged PR** | 2 本 (#363 / #366) |
| **closed Issue** | #360 / #358 (計 2 件、auto-close 両方成功) |
| **新規 follow-up Issue** | #364 (per-doc catch 経路 integration test、P2) / #365 (totalSkipped カウンタ分割、P2) |
| **BE テスト** | 670 → **677 passing** (+7 from #358) + 6 pending |
| **BE integration テスト** | 13 → **21 passing** (+8 from #360: rescue の pending/error/異常値/境界値 各分岐) |
| **FE テスト** | 33 → **34 passing** (+1 from #360: getReprocessClearFields の retryCount/retryAfter lock-in) |
| **コード量** | #363: +419/-38 (8 ファイル) / #366: +149/-7 (4 ファイル) 合計 +568/-45 |
| **品質改善** | rescue 経路の observability (errors/ 経由で ErrorsPage 可視化) / reprocess 経路の retry drift 防止 / backfill の silent 書き換え検知強化 / 運用 grep 契約の定数化 |

### Quality Gate 実施記録 (合計 13 エージェントレビュー + evaluator)

**PR #363 (rescue observability)**:
- /impl-plan で Acceptance Criteria 6 項目 + タスク分解 (A: FE / B: BE / C: integration test / D: Quality Gate)
- /simplify 3 並列 (reuse/quality/efficiency) → 推奨 8 項目を本 PR 内で対応 (定数集約 / closure mutation → return value / any → StuckDocFixture interface / cleanupCollections helper 化 / after hook 削除 / eslint-disable 理由コメント等)
- /review-pr 6 並列 + evaluator (5+ ファイル発動) → Important 7 項目を本 PR 内で対応 (fatalReached safeLogError を try-catch wrap で二重記録防止 / `as const` で literal type 保持 / test fixture を `STUCK_PROCESSING_THRESHOLD_MS / 2` で定数依存化 / `retryCount > MAX_RETRY_COUNT` 異常値 integration test 追加等)

**PR #366 (backfill test lock-in)**:
- /simplify 3 並列 → 推奨 3 項目を本 PR 内で対応 (pure 関数を `shared/detectDisplayFileNameChange.ts` に配置 / exhaustive `assertNever` 導入 / totalChanged ⊆ totalUpdated 包含関係コメント)
- /review-pr 6 並列 (evaluator は 4 ファイルで発動条件未達) → Important 3 項目を本 PR 内で対応 (assertNever throw 前に progress log 出力 / newDisplayFileName non-empty 前提を JSDoc 明示 / `_migrations.changedCount` Firestore path 参照補強)

### 設計判断 / Lessons Learned (本セッション重要知見)

1. **runTransaction 化の正当化**: maxInstances=1 現状でも retryCount 最新性保証のため tx が必要。rescue 実行中に handleProcessingError が同一 doc を更新するケースで stale 値起因 off-by-one を防ぐ。handleProcessingError と同一パターンに揃えることで将来の並行処理拡張時にも整合

2. **ESM loader 回避の helper パターン**: `test/helpers/initFirestoreEmulator.ts` を integration test の最初に `import './helpers/initFirestoreEmulator';` することで、ES module の depth-first module resolution を利用して `admin.initializeApp()` を `processOCR.ts` 評価前に確実に実行する。mocha の glob pattern (`test/*Integration.test.ts`) だと ESM loader に回されて `admin.initializeApp is not a function` になる罠あり → explicit file list で回避

3. **運用 grep 契約の test lock-in**: 運用監視が依存する文字列 (`STUCK_RESCUE_FATAL_MESSAGE_PREFIX = 'Processing timed out, max retries exceeded' as const`) を `constants.ts` に集約し、`as const` で literal type 保持 + test `.include()` で silent drift を検知。ErrorsPage フィルタ / Cloud Logging alert の前提が変わった時に CI で即座に落ちる

4. **silent-failure-hunter I1 の二重記録防止**: fatalReached 分岐内の `safeLogError` 呼出を try-catch で wrap し、失敗を outer catch に伝播させない。伝播すると outer catch 内の `safeLogError` が再度呼ばれ、同一 docId への errors/ 書き込みが重複する。errors 記録の idempotency を保つ重要パターン

5. **純粋関数 shared/ 配置の原則**: Firestore/Admin SDK 非依存の関数は `shared/` に置き、scripts/functions 両方から直接 import する。`scripts/ → functions/src/` 参照は唯一事例 → 慣例違反で将来の firebase-functions 依存追加で scripts ビルド破綻リスクあり。`functions/src/utils/backfillDisplayFileName.ts` は shared からの re-export に置換済み

6. **exhaustive switch + assertNever**: 新規 enum 拡張時に silent fallthrough を compile-time で検知する defensive pattern。ただし runtime throw 時は operator が partial-apply 状況を把握できるよう progress サマリー (`processed/updated/skipped/changed` + uncommitted batch size) を `console.error` で先に出力してから throw

7. **Issue triage (feedback_issue_triage.md 準拠)**: review agent の rating 5-6 は Issue 化せず PR コメント/TODO で扱う、rating 7 以上を Follow-up Issue 化。本セッションは #364 (rating 7 MEDIUM) / #365 (効率推奨) を follow-up 化。Close 数 = 起票数にならないよう (net 進捗ゼロ回避)

8. **動作改善の PR body 明示**: #366 では `--force` 時の noop skip 挙動が新動作 (元は SET log + 無意味な updatedAt 書き込み)。silent regression 化しないよう PR body に "動作変更の明示" セクションを作り、旧挙動との差分をテーブル化。数万件規模での write 削減効果 + listener ノイズ削減を定量化

### 次セッション着手候補 (WBS 進捗)

**軽量 (0.5 セッション)**:
- **#364 rescue per-doc catch test** (本セッション起票): emulator で意図的に runTransaction 失敗を誘発する fixture を作成。sinon 新規導入 or emulator rule で書き込み拒否する方法を検討。#360 I1 の完全 lock-in
- **#365 totalSkipped カウンタ分割** (本セッション起票): scripts の counter を `totalSkippedExisting` / `totalSkippedNoop` に分離。運用可視性向上、独立性高い

**中規模 (1 セッション)**:
- **#239 force-reindex audit log**: Cloud Logging に構造化 audit log 出力、compliance 対応の延長
- **#251 summaryGenerator test + buildSummaryPrompt 分離**: 既存の summary 処理を testable に切り出し
- **#200 checkGmailAttachments/splitPdf 統合テスト**: Gmail 連携経路の integration test

**大物 (2 セッション、`/impl-plan` 必須)**:
- **#237 search tokenizer 共通化**: FE/BE/script 3 箇所の重複を `shared/` に集約。session29 handoff でも大物として持ち越し、本セッションも未着手。Evaluator 分離必須 (5+ ファイル + アーキテクチャ影響)
- **#299 capPageResultsAggregate 動的 safeLogError test** (最難): ts-node/esm 環境整備込み。ESM loader 問題 (本セッション #360 で副産物として知見獲得) を活用できる

**session 外 Open Issues** (引き続き持ち越し): #238 (force-reindex 孤児 posting) / #220 (OOM/truncated metric + alert) / #152 (dev setup-tenant)

### Test plan 実行結果

- [x] BE `npx tsc --noEmit` EXIT 0 (両 PR 確認)
- [x] BE `npm test` **677 passing + 6 pending** (670 → +7 from #358)
- [x] BE `npm run test:integration` (emulator) **21 passing** (13 既存 + 8 新規 from #360)
- [x] FE `npx tsc --noEmit` EXIT 0
- [x] FE `npm test` (vitest) **34 passing** (33 → +1 from #360 FE test)
- [x] scripts `npx tsc --noEmit -p scripts/tsconfig.json` EXIT 0
- [x] main CI 3/3 green × 2 PR (lint-build-test / CodeRabbit / GitGuardian 全 pass)
- [x] `gh issue view 360 / 358` で CLOSED 確認 (squash merge で 2 件とも auto-close 成功)
- [x] follow-up Issue #364 / #365 起票確認
- [ ] main Deploy IN_PROGRESS (merge 直後、次セッション開始時に `gh run list --workflow=Deploy` で SUCCESS 確認必要)

---

<a id="session29"></a>
## ✅ session29 完了サマリー (2026-04-22: #334 + #196 完遂、3 PR merged)

PM/PL 視点で session28 残 10 Open Issue から戦略軸分類 → **推奨順 (#196 bug fix → #237 refactor)** をユーザー選定。本セッションは #196 まで完遂し、#237 は次セッション大物として持ち越し (impl-plan から fresh start 推奨)。

### PR 一覧

| PR | 内容 | closed Issues | merged commit |
|----|------|--------------|--------------|
| **#357** | refactor: backfill-display-filename を shared/ 統合 + silent bug 解消 (ts-node 最小導入、OS 禁止文字 + epoch/NaN drop 修正) | #334 | `78fb907` |
| **#359** | fix: rescueStuckProcessingDocs に MAX_RETRY_COUNT チェック + retryAfter 追加 (429 多発時の無限 rescue ループ + 即再処理連鎖の silent bug 修正) | #196 | `16569a6` |
| **#361** | chore: tracked な .claude/scheduled_tasks.lock を削除 | — | `2114a21` |

### 主要成果

| 項目 | 内容 |
|------|------|
| **merged PR** | 3 本 (#357 / #359 / #361) |
| **closed Issue** | #334 / #196 (計 2 件、auto-close 両方成功) |
| **新規 follow-up Issue** | #358 (backfill 差分検出テスト + OS禁止文字 lock-in)、#360 (rescue observability + FE getReprocessClearFields 対応) |
| **BE テスト** | 662 → **670 passing** (+8: #196 MAX_RETRY_COUNT チェック 5 + retryAfter 3) + 6 pending |
| **FE テスト** | 128 passing (変化なし) |
| **コード量** | +181 / -101 行 (3 PR 合計、実質純増は #196 test 8 件追加 + rescue 修正) |
| **品質改善** | scripts .ts 化による shared 集約完遂 / 運用スクリプトの silent bug 2 件修正 / rescue の無限ループ + retryAfter 連鎖 bug 修正 / errors/ コレクションへの fatal 記録追加 |

### Quality Gate 実施記録 (合計 10 エージェントレビュー)

**PR #357 (shared 統合)**:
- 実装時 3 並列: code-reviewer / silent-failure-hunter / evaluator → Critical 0 / Important 5 → 全て対応
- /review-pr 4 並列: comment-analyzer / pr-test-analyzer / type-design-analyzer / code-simplifier → comment 5 + pr-test Important 2 + type-design 3 + simplifier 5 → 本 PR 内対応 + Follow-up #358

**PR #359 (rescue bug fix)**:
- /review-pr 4 並列: code-reviewer / silent-failure-hunter / pr-test-analyzer / code-simplifier → **silent-failure-hunter C1 (Blocker)**: errors/ コレクション未記録 → safeLogError 呼出追加で対応 / pr-test-analyzer C2 (CLAUDE.md MUST 違反: 更新対象外フィールド保持テスト欠落) → Follow-up #360 化 / 3 エージェント一致指摘 (test-local const → export import) → constants.ts 分離で対応

**PR #361 (chore)**: `/review-pr` スキップ (設定変更のみ、rules/quality-gate.md の適用対象外)

### 設計判断 / Lessons Learned (本セッション重要知見)

1. **Option A' (最小導入パターン)**: scripts の shared 統合で、全 .js → .ts 移行ではなく「対象 1 ファイルのみ + 最小 devDep」という Option A' が ROI で勝る。他 Option (B shared JS化 / C dist build step) は回帰リスクか運用忘却リスクで却下。session26-28 の shared 集約路線に乗せる形で完結

2. **side-effect-free な constants.ts 分離パターン**: test から定数 export を import しようとすると `admin.firestore()` の top-level 実行で firebase 未初期化エラー。定数のみを別ファイル `functions/src/ocr/constants.ts` に分離し、ocrProcessor.ts では re-export で後方互換。これは test drift 防止と side-effect 分離の two-in-one パターン

3. **silent bug 修正は observability とセットで**: PR #359 の /review-pr で silent-failure-hunter が Critical 指摘 (safeLogError 未呼出で ErrorsPage 不可視) → これを放置すると「無限ループ silent」を「terminal state silent」に変えただけ。修正範囲を「bug の表面挙動」でなく「observability 経由でユーザーが認識できる状態」に広げるべき

4. **star re-export の drift 防止 vs leak リスク**: PR #357 の functions/src/utils/timestampHelpers.ts を `export * from shared/` に変更。新エクスポート追加時の drift 防止が得だが、shared/ に内部 helper を足すと silent leak する構造的弱さもある。shared/ の export は全て public API 扱いにする規約を README に書く follow-up が必要 (type-design-analyzer 指摘、#360 に含めていないので次セッションで検討)

5. **--force silent 書き換え対策の実装パターン**: PR #357 の backfill.ts で shared 版サニタイズ適用が既存 displayFileName を書き換える可能性があったため、(a) 起動時警告バナー、(b) CHANGE ログで old→new 差分出力、(c) totalChanged カウンタを `_migrations` に記録 の 3 段で operator に silent 書き換えを検知可能にした

6. **rules/error-handling.md「状態復旧 > ログ記録」の実運用**: #196 fix で error 確定時の safeLogError 追加を rules に従って「status 更新 → 独立 try-catch で safeLogError」の順に配置。handleProcessingError の既存パターンと整合

7. **境界値 ±1 ルールの実運用**: pr-test-analyzer が `currentRetryCount = 3` (MAX_RETRY_COUNT-2、最後の救済チャンス) の欠落を指摘。±1 ルールは 4-5-6 三点を押さえるのが定石

8. **PR 作成直後の `.claude/scheduled_tasks.lock` 混入パターン**: `git add -A` の貪欲 stage で Claude Code Cron hook の session-local lock が tracked 対象に。`.gitignore` を追加しても既存 tracked には効かないため `git rm --cached` + chore PR が必要だった。今後は git add を specific path に絞るのが安全

### 次セッション着手候補 (WBS 進捗)

**#237 tokenizer 共通化** (次セッション最優先、大物):
- search tokenizer の FE/BE/script 3 箇所重複を shared/ に共通化
- 既存 #334 / #338 の shared 集約路線の延長、Evaluator 必須 (5+ ファイル + アーキテクチャ影響)
- **`/impl-plan` 必須** (設計判断: shared 配置場所、既存 3 箇所の差分吸収)
- 想定規模: 5-10 ファイル、2 セッション相当
- Fresh session で impl-plan から入るのが品質確保に有利

**#358 backfill テスト追加** (本日起票、軽量):
- PR #357 で follow-up 化した pr-test-analyzer I1 (差分検出純粋関数抽出 + テスト) + I2 (OS 禁止文字 backfill 経路統合テスト)
- 想定規模: 1-2 ファイル、0.5 セッション

**#360 rescue observability + FE reprocess clear** (本日起票、中規模):
- silent-failure-hunter I1/I2: rescue outer try/catch の safeLogError + transactional 化
- code-reviewer I3: FE `getReprocessClearFields()` に `retryCount`/`retryAfter` 追加 (#178 派生フィールド教訓の延長)
- pr-test-analyzer: Firestore stub 使った integration test + `lastErrorMessage` 文字列 lock-in
- 想定規模: 3-5 ファイル (FE + BE 横断)、/check-api-impact 推奨、1 セッション

**session 外 Open Issues** (引き続き持ち越し): #239 / #238 / #251 / #299 (最難) / #220 / #200 / #152

### Test plan 実行結果

- [x] BE `npx tsc --noEmit` EXIT 0 (全 PR 確認)
- [x] BE `npm test` **670 passing + 6 pending** (662 → +8: #196 境界値含む)
- [x] FE `npx tsc --noEmit` EXIT 0
- [x] FE `npm test` (vitest) **128 passing** (変化なし)
- [x] scripts `npx tsc --noEmit --project tsconfig.json` EXIT 0
- [x] main CI 3/3 green × 3 PR (lint-build-test / CodeRabbit / GitGuardian 全 pass)
- [x] `gh issue view 334 / 196` で CLOSED 確認 (squash merge で 2 件とも auto-close 成功)
- [x] GitHub Actions "Run Operations Script" で dev 環境 `backfill-display-filename --dry-run` 実行成功 (AC6 該当データなしで PASS、workflow install step も実動作確認)
- [x] follow-up Issue #358 / #360 起票確認
- [x] scheduled_tasks.lock tracked 除去 確認 (`git ls-files | grep scheduled` = 0)

---

**過去セッション (session15〜28) は `docs/handoff/archive/2026-04-history.md` に移管済み** (session33 handoff 時に session28 を追加移管、2026-04-22)。

直近前セッション (LATEST 保持):
- **session32** (2026-04-22): #370 完遂 (1 PR #372)、polyfill 「常に throw」設計で silent-failure-hunter F-1 対応
- **session31** (2026-04-22): #365 + #364 完遂 (2 PR #368/#369)、sinon 不採用で既存 convention 尊重
- **session30** (2026-04-22): #360 + #358 完遂 (2 PR #363/#366)、Quality Gate 13 エージェント+evaluator
- **session29** (2026-04-22): #334 + #196 完遂 (3 PR #357/#359/#361)、silent bug 修正 + scripts .ts 化
