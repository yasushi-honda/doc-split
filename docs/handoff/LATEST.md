# ハンドオフメモ

**更新日**: 2026-04-18 session11 (Phase 1 完遂: #259 summaryWritePayloadContract 直接書込検知強化)
**ブランチ**: main (PR #261 マージ済、clean)
**フェーズ**: Phase 8 + 運用監視基盤全環境展開完了 + Summary リファクタ集約 3/3 完了 + #255 follow-up #259 完遂

## ✅ session11 完了サマリー (Phase 1 完遂: #259 直接書込パターン caller 検知)

session10 で完遂した #255 (CappedText discriminated union 化) の follow-up Issue #259 を本セッションで完遂。`/review-pr` 6 並列で検出された Critical 3 + Important 4 を全て同 PR で対応。Suggestion 系は #262 に集約 follow-up 化。

| 順 | フェーズ | 結果 |
|---|---|---|
| 1 | **Phase 1 (#259) 着手 — 計画策定** | ✅ `/impl-plan` AC 5 項目定義、案 A (代替パターン併用) 採用 |
| 2 | **TDD 実装 → /simplify HIGH 2 件即時対応** | ✅ 共通ヘルパー `hasPatternsAdjacent` 抽出 + `\b` word boundary 追加 |
| 3 | **PR #261 作成 → /review-pr 6 並列** | ✅ Critical 3 / Important 4 / Suggestion 多数 検出 |
| 4 | **Critical + Important 全 7 件を同 PR で対応** | ✅ commit `e1cfc48` |
| 5 | **Follow-up #262 起票 + CI SUCCESS → squash merge** | ✅ commit `8ca9da5`、Issue #259 自動クローズ |

### 達成効果 (Phase 1 完遂)

| 効果 | 内容 |
|---|---|
| 🛡️ バイパス検知 | `.update()` のみ → `.update/.set/.create` 全 Firestore 書込呼出に拡張。`set({ summary }, { merge: true })` 経路で派生フィールド整合をバイパスする anti-pattern も caller として検知 |
| 🚨 silent universal-true 防御 | `hasPatternsAdjacent` 空配列で `Array.prototype.every` の vacuous truth により全 source を caller 誤分類する silent failure を明示 throw で阻止 |
| 🔍 identity 比較 | caller 集計を count → identity (deep.equal sorted) 比較に強化。rename + 別ファイル新規追加で count 維持されたまま identity 乖離する silent drift を検知 |
| 🧪 lock-in 強化 | 16 fixture テスト (positive 5 / negative 4 / 境界 3 / regression 3 / 防御 2) で grep-based 検知の挙動を多層 lock-in。ADJACENCY_WINDOW_LINES 境界 / OR 合成 / word boundary を全て regression 保護 |
| 📦 共通化 | `hasPatternsAdjacent(source, ...patterns)` を抽出。3 つ目のコピペ発生前に抑止、将来の追加契約 (#258 等) でも再利用可能 |

### Phase 1 Quality Gate 実施記録

| 段階 | 結果 | 指摘・対応 |
|---|---|---|
| `/impl-plan` | ✅ AC 5 項目定義 | 1 ファイル想定 → Evaluator / safe-refactor 不発動 |
| `/simplify` 3 並列 | Reuse HIGH 1 / Quality HIGH 1 | 共通ヘルパー抽出 + `\b` 追加で即時対応、word boundary lock-in fixture 追加 |
| `/safe-refactor` | ⏭️ スキップ (test 1 ファイル変更、production code 無変更、3+ 基準未満) | — |
| **Evaluator 分離** | ⏭️ スキップ (test 1 ファイル変更、5+ 基準未満) | — |
| `/review-pr` 6 エージェント並列 | Critical 3 / Important 4 / Suggestion 8+ | Critical (set/create バイパス + 空 patterns + identity vs count) + Important (境界 fixture + regression fixture + magic number + コメント 3 箇所) を全て同 PR で対応、Suggestion 系は Issue #262 に集約 |

### CI / マージ結果

- BE: `npm run build` PASS / `npm test` 434 passing (元 423 + #259 規模 11) / `npm run lint` 0 errors (既存 19 warnings 別ファイル)
- PR #261 CI: lint-build-test SUCCESS / GitGuardian SUCCESS → MERGED `8ca9da5`
- 本 PR は test ファイルのみ、production code 変更なし → kanameone / cocoro 本番環境への影響ゼロ

### 教訓 (PM/PL 視点)

| 教訓 | 内容 |
|---|---|
| `/review-pr` の高 ROI | 6 並列で Critical 3 + Important 4 を一発検出。pr-test-analyzer の C1 (`.set()` バイパス) は契約の盲点を的確に発見 → #178 教訓カバーが厚くなった |
| 共通化のタイミング | 3 つ目のコピペ発生前 (= 2 関数共通) で抽出するのが最適。Reuse HIGH 指摘を即時対応で抑止 |
| Critical 対応の機械性 | agent 指摘がコード例付きの場合、設計判断追加なしの機械的修正で済む → セカンドオピニオン不要、再 review-pr も軽量で十分 |
| 1 セッション 1 PR | 中規模 follow-up は context 温存しつつ完遂可能。Phase 2 (#251) 着手は次セッションで安全マージン確保 |

### 次セッション着手予定: Phase 2 (#251) — handoff 計画本命

**最優先タスク** (session10 から継続):
- **#251**: `generateSummaryCore` の unit test 追加 + `buildSummaryPrompt` 別モジュール分離
  - rateLimiter.acquire() 順序検証
  - trackGeminiUsage の両値呼出検証
  - capPageText wiring 検証
  - malformed Vertex response の silent failure 検出
  - `summaryPromptBuilder.ts` 新設で firebase-admin 依存切り離し → pure function unit test 可能化
  - 規模: 中 (3-5 ファイル)、TDD + Quality Gate 標準フロー、所要 ~1.5h 想定

**残り WBS** (session10 から継続):
- **Phase 3 (#258)**: CappedText / SummaryField / PageOcrResult 型統合 — 大 (5+ ファイル)、Evaluator 分離プロトコル必須
- **Sprint 3 (#253)**: useProcessingHistory.firestoreToDocument 重複を useDocuments 側に集約
- **Sprint 4 (#237)**: search tokenizer FE/BE/script 3 箇所重複共通化
- **Sprint 5**: 運用監視拡充 (#220 / #239 / #238)
- **Sprint 6**: テスト補強 (#200) + bug 消化 (#196)
- **新規 follow-up**: #262 (grep-based 既知制限 + diagnostics 強化、本セッション起票)

---

## ✅ session10 完了サマリー (Phase 0.5 マージ修復 + Phase 1.2 #255 完遂)

session9 終了時の handoff 誤記録（PR #256 が PR #254 より先にマージされ、handoff は「#215 完遂」と記録しつつ実装は未マージという矛盾状態）を **catchup で発見・修復**。Phase 0.5 として PR #254 をマージし、続けて #255 follow-up を Phase 1.2 として完遂。

| 順 | フェーズ | 結果 |
|---|---|---|
| 1 | **Phase 0.5: PR #254 マージ修復** | ✅ Codex セカンドオピニオン取得 → PR #254 マージ (`8bfafae`) → dev 環境で AI要約/OCR表示の回帰検証 PASS（baseline / post-merge スクリーンショット完全一致） |
| 2 | **Phase 1.2: #255 CappedText discriminated union 化** | ✅ PR #257 MERGED (`60b70f5`)。Quality Gate 全段通過 (impl-plan → simplify → safe-refactor → evaluator → review-pr 6並列) |
| 3 | **Follow-up 起票** | ✅ Issue #258 (CappedText/SummaryField/PageOcrResult 型設計統合) + Issue #259 (直接書込 caller 検知強化) |

### 達成効果 (Phase 1.2 完遂)

| 効果 | 内容 |
|---|---|
| 🛡️ 上流型安全 | `CappedText` を discriminated union 化 (`{text, truncated:false}` または `{text, truncated:true, originalLength}`)。`truncated=false` 時の `originalLength` アクセスは tsc エラーになり、#178/#209 系の silent failure を構造的に排除 |
| 📦 契約テスト | `summaryWritePayloadContract.test.ts` 新設 (grep-based)。同一 `update()` ブロック近接保証 (≤30 行) + paths 実在検証 + caller 増加検知の 3 重防御 |
| 🧪 テスト品質 | `assertTruncated` 型述語ヘルパー追加で `if (result.truncated) { ... }` の if-guard を排除 → バグ時にアサート群がスキップされる false negative リスクを構造的に解消 |

### Phase 1.2 Quality Gate 実施記録

| 段階 | 結果 | 指摘・対応 |
|---|---|---|
| `/impl-plan` | ✅ AC 7 項目定義 | 5+ ファイル → Evaluator 発動確定 |
| `/simplify` 3 並列 (reuse/quality/efficiency) | Reuse 1 件指摘 | false positive 判定で skip (利用箇所 1 箇所のみ、Premature abstraction) |
| `/safe-refactor` | LOW 1 件のみ | 型 narrowing 都合の if-guard 反復、後段 evaluator で根本解決 |
| **Evaluator 分離** (5+ファイル発動) | REQUEST_CHANGES MEDIUM 1 件 | `assertTruncated` 型述語ヘルパー化で if-guard 排除、false negative リスク解消 |
| `/review-pr` 6 エージェント並列 | Critical 1 / MEDIUM 1 / Suggestion 多数 | Critical (同一 update() ブロック保証) + MEDIUM (paths 実在検証) を本 PR で対応、Suggestion は #258/#259 で follow-up |

### CI / マージ結果

- BE: `npm run build` PASS / `npm test` 418 passing (元 408 + #255 規模 10) / `npm run lint` 0 errors (既存 19 warnings)
- PR #257 CI: lint-build-test 5m13s ✅ / CodeRabbit ✅ / GitGuardian ✅ → MERGED `60b70f5`
- PR #254 CI: lint-build-test 5m20s ✅ / CodeRabbit ✅ / GitGuardian ✅ → MERGED `8bfafae`
- dev 環境回帰検証: AI要約「この書類は、田中太郎さんの介護保険被保険者証...」+ OCR結果 107文字 が baseline と完全一致

### 教訓 (handoff PR 運用規約の改善)

前セッションで「handoff docs (PR #256) が実装 PR (#254) より先にマージされる」事故が発生。本セッションで Codex セカンドオピニオンを介して修復したが、再発防止のため以下を今後の規約に組み込むべき:

| 規約 | 内容 |
|---|---|
| 依存先明記 | handoff PR 説明に `Depends on #xxx` を必ず記載 |
| Draft / blocked label | 依存先未マージなら Draft または `blocked` label でブロック |
| マージ順序 | handoff 更新は実装 PR 内に同梱 or 実装 merge 後に限定 |
| 未実装確認 | CLAUDE.md「未実装確認プロトコル」を handoff レビュー時にも適用 (`[ ]` 発見 → ソース実在 + git log 確認) |

### 次セッション着手予定: Phase 1.1 (#251)

**最優先タスク**:
- **#251**: `generateSummaryCore` の unit test 追加 + `buildSummaryPrompt` 別モジュール分離
  - rateLimiter.acquire() 順序検証
  - trackGeminiUsage の両値呼出検証
  - capPageText wiring 検証
  - malformed Vertex response の silent failure 検出
  - `summaryPromptBuilder.ts` 新設で firebase-admin 依存切り離し → pure function unit test 可能化

**残り WBS**:
- **Sprint 3 (#253)**: `useProcessingHistory.firestoreToDocument` 重複を `useDocuments` 側に集約 — 文脈新鮮、FE リファクタ
- **Sprint 4 (#237)**: search tokenizer の FE/BE/script 3 箇所重複共通化 — 大粒、要 `/impl-plan` + `/check-api-impact`
- **Sprint 5**: 運用監視拡充 (#220 OOM/truncated metric / #239 force-reindex audit log / #238 force-reindex 孤児 posting 検出) — 独立 3 件、並列可
- **Sprint 6**: テスト補強 (#200 統合テスト) + bug 消化 (#196 rescueStuckProcessingDocs)
- **新規 follow-up**: #258 (型設計統合) / #259 (contract test 強化) — 条件付き待機

---

## ✅ session8 完了サマリー (Sprint 2-1 完遂: #214 generateSummary 共通化)

catchup から PM/PL 視点で積み残し 14 件を WBS 化し、Sprint 2-1 に着手。文脈温かい Summary リファクタ集約の前半 (#214) を完遂。Quality Gate 3 段 (`/simplify` → `/safe-refactor` → `/review-pr` 6 並列) を順に通過し、Important 指摘 3 件を PR review フォローアップ commit で対応。

| 順 | Issue/PR | 結果 |
|---|---|---|
| 1 | **WBS 計画** | ✅ 14 件を Sprint 2/Phase 2-5 + 条件付き待機 3 件に分類、依存関係・並列可否・想定工数・Quality Gate レベルを整理 |
| 2 | **#214 generateSummary 共通化** | ✅ PR #250 マージ (commit `27017dd`) — 新設 `functions/src/ocr/summaryGenerator.ts` の `generateSummaryCore()` に集約、caller 2 箇所は try/catch の形 (empty 返却 / rethrow) のみ差別化 |
| 3 | **follow-up 起票** | ✅ Issue #251 (generateSummaryCore unit test + buildSummaryPrompt 別モジュール分離 + silent-failure-hunter 指摘の error handling 改善) |

### 達成効果 (Sprint 2-1 完遂)

| 効果 | 内容 |
|---|---|
| 🛡️ 重複排除 | `ocrProcessor.generateSummary` と `regenerateSummary.generateSummaryInternal` のほぼ完全同一実装を 1 関数に集約、prompt 改変が 1 ファイル編集で両経路反映 |
| 🎯 閾値単一化 | `MIN_OCR_LENGTH_FOR_SUMMARY=100` 定数を core から export、caller 同期漏れを構造的に防止 |
| 🔒 fallback 一本化 | `DEFAULT_DOCUMENT_TYPE_LABEL='書類'` を非 export でコア内に閉じ込め、type-design-analyzer 指摘の double fallback を解消 |
| 🚨 precondition safety net | `generateSummaryCore` 冒頭に短文ガード assertion を追加、将来 caller が precondition を忘れた場合の silent bug を throw に変換 |
| 📑 契約テスト拡張 | `summaryBuilderCallerContract.test.ts` に CORE_DELEGATE_PATTERN を追加、「caller は generateSummaryCore 経由」「builder bypass 不在」を grep で対称に検証、sanity も BUILDER と対称化 |

### Sprint 2-1 Quality Gate 実施記録

| 段階 | 結果 | 指摘 |
|---|---|---|
| `/simplify` 3 並列 (reuse/quality/efficiency) | Critical 0 | Minor 2 件採用 (閾値・fallback 定数化 + CORE sanity 拡張)、1 件見送り (buildSummaryPrompt export: firebase-admin 依存チェーンで test 実行不可、別 Issue 化) |
| `/safe-refactor` | HIGH/MEDIUM/LOW すべて 0 件 | 修正不要判定 |
| `/review-pr` 6 エージェント並列 | Critical 0 | Important 3 件採用 (precondition assertion + fallback 一本化 + JSDoc 対称性)、4 件見送り→ #251 |

### CI / マージ結果

- `npm test`: 407 passing (元 406 + CORE sanity 複数回呼出 1 件)
- `npm run lint`: 0 errors (既存 19 warnings は別ファイルの no-useless-escape、本 PR 影響外)
- `npm run build`: PASS
- PR #250 CI: lint-build-test 4m55s ✅、CodeRabbit ✅、GitGuardian ✅ → squash merge

### 次セッション: Sprint 2-2 (#215) 着手予定

**Sprint 2-2 概要**: `Summary` フィールドの discriminated union 化 + `pageTextCap.ts` → `textCap.ts` rename。

- 5-7 ファイル変更想定 (shared/types.ts / summaryGenerator.ts / FE useDocuments.ts の firestoreToDocument + getReprocessClearFields / textCap 周辺) → **Evaluator 分離プロトコル発動ライン**
- #178 教訓 4 点チェック必須 (firestoreToDocument / 書込パス / getReprocessClearFields / shared/types.ts)
- API 境界 FE↔BE 確認必須 (cross-layer.md)
- `/trace-dataflow` で summary 全レイヤー到達確認

**残り WBS** (ハンドオフ session8 時点):
- Sprint 2-2: #215 (1 日、Evaluator 発動)
- Sprint 3 bug 一括: #189/#190/#196 (1 日、並列可)
- Sprint 4 displayFileName + リファクタ: #183/#182/#181/#188 (2 日)
- Sprint 5 テスト + 雛形: #200/#152 (1 日、並列可)
- Sprint 6 条件付き待機: #237/#238/#239/#251 (稼働実績・監査要件・false negative 発生で昇格)

## ✅ session7 完了サマリー (Sprint 1 Follow-up B 完遂: 本番 2 環境 A2/A3 展開)

session6 末尾で誤診した「Owner 認証ブロッカー」を session7 開始時に払拭し、プロジェクト playbook に沿って A2/A3 を連続実施・完遂。所要時間は session playbook 通り各 ~15 分。

| 順 | タスク | 結果 |
|---|---|---|
| 1 | **A2 kanameone** (`switch-client.sh kanameone` → SA 作成 → 3 roles → Secret → setup dispatch) | ✅ Run ID `24547741800` (1m22s), 5 metrics + 5 alert policies (全 ENABLED) + 1 channel (`hy.unimail.11@gmail.com`) |
| 2 | **A3 cocoro** (`switch-client.sh doc-split-cocoro` → SA 作成 → 3 roles → Secret → setup dispatch) | ✅ Run ID `24548562806` (1m12s), 5 metrics + 5 alert policies (全 ENABLED) + 1 channel (`hy.unimail.11@gmail.com`) |
| 3 | docs 展開状況テーブル更新 + ハンドオフ記録 | ✅ 本 PR |

### session7 で確認した cocoro の実体

事前懸念「`docsplit-deployer` SA の setIamPolicy 権限が不足している可能性」は杞憂。`gcloud projects get-iam-policy` で確認したところ `roles/owner` を保持しており、SA 作成・roles 付与・キー発行を全て deployer SA で完遂できた (cocoro-mgnt.com Workspace 管理者への一時付与依頼は不要だった)。

### session7 で採用した通知先ポリシー

全 3 環境 (dev/kanameone/cocoro) の Cloud Monitoring notification channel を `hy.unimail.11@gmail.com` に統一 (HEALTH_REPORT_TO と同じ運用)。クライアント側管理者アドレスへの切替は Cloud Monitoring の channel update で後から可能 (docs の「通知先の調整」参照)。

## ✅ session6 完了サマリー (Sprint 1 Follow-up B: dev 監視展開 + テンプレ API 制約 3 件修正)

**WBS Phase A (A1-A4)** のうち A1 (dev setup dispatch) + A4 (ハンドオフ) 完遂。A2/A3 (kanameone/cocoro) は本番 Owner 権限未保持のため次セッション持越し。

| 順 | Issue/PR | 結果 |
|---|---|---|
| 1 | **A1 dev setup dispatch** | ✅ 5 metrics + 5 alert policies + 1 channel 作成完了 (Run ID `24540263296`) |
| 2 | **PR #243** setup-gcloud に alpha component 明示インストール | ✅ マージ (commit `1d4db55`) |
| 3 | **PR #244** notificationRateLimit を全 5 テンプレから削除 | ✅ マージ (commit `2631282`) |
| 4 | **PR #245** search_index_silent_failure alignmentPeriod を 25h 制約内に | ✅ マージ (commit `2a964dc`) |
| 5 | **A4 ハンドオフ更新** | ✅ 本 PR |

### session6 で解決した 3 つの API 制約違反

| # | 現象 | 原因 | 修正 |
|---|------|------|------|
| 1 | `gcloud alpha` が Y/n プロンプトで失敗 | 非対話環境で alpha component 未インストール | workflow の setup-gcloud に `install_components: 'alpha'` 追加 (PR #243) |
| 2 | policy 作成で `notificationRateLimit` invalid | API 仕様: log-based policy 限定 | 全 5 テンプレから削除、doc 注記追加 (PR #244) |
| 3 | `alignmentPeriod: 604800s` > 25h 上限 | API 制約: 最大 `90000s` | `86400s` (24h 検知) + `autoClose: 7d` (incident 継続可視化) へ変更 (PR #245) |

### Codex セカンドオピニオン
PR #245 で Codex (MCP thread `019d98a8`) を使用し、他 4 テンプレートに追加制約違反がないことを確認。「ADR-0015 の厳密な 7d rolling は GCP API 制約で不可、autoClose=7d による incident 継続可視化で代替、厳密 weekly 集計が必要なら scheduled query / health-report で担保」の方針に到達。

### 達成効果 (A1 dev 完遂)

- ✅ dev 環境で 5 metrics (ocr_aggregate_truncated / ocr_page_truncated / search_index_silent_failure / searchindex_oom / summary_truncated) 稼働
- ✅ 5 alert policies (全 ENABLED) + 1 notification channel (hy.unimail.11@gmail.com)
- ✅ 冪等性検証済: skip → create の混在でも適切に動作
- ✅ 削除 SOP (`teardown-log-based-metrics.sh`) で 1 コマンド ロールバック可能

## ✅ 過去セッション完了サマリー (Sprint 1: WBS 計画 → 段階消化)

PM/PL 視点で catchup の積み残し 12 件を WBS 化し、Sprint 1 (直前セッション文脈が温かい 2 件) を完遂。

| 順 | Issue/PR | 結果 |
|---|---|---|
| 1 | **WBS 計画** | ✅ 12 件を 5 テーマ × 4 Sprint に分類、依存関係と並列可否を整理 |
| 2 | **#228 summaryBuilderCallerContract docstring 整理** | ✅ PR #234 マージ (commit `230b7b5`) — describe 重複解消 + 既知 limitation 明記 + 昇格条件明記、7 tests passing |
| 3 | **#229 search_index drift 復旧 SOP + force-reindex スクリプト** | ✅ PR #235 マージ (commit `1e2b751`) — **5 エージェントレビュー + Evaluator 分離で Critical 3 件解消済み**、1028 insertions |

### 達成効果

| 効果 | 内容 |
|---|---|
| 🛡️ 復旧手段整備 | `scripts/force-reindex.js` で特定 docId / 一括 drift scan に対応、dry-run default (ADR-0008 準拠) |
| 📖 SOP 文書化 | `docs/context/search-index-recovery.md` に Mermaid 状態遷移図 + 手順 + Escalation 基準 |
| 🏗️ workflow 統合 | `run-ops-script.yml` に 4 choice + build ステップ追加、GitHub Actions 経由実行可能に |
| 🎯 tokenizer drift 防止 | production (`functions/src/utils/tokenizer.ts`) を compiled lib/ から require、3箇所重複リスクを最小化 |
| 🧾 ADR-0015 Risk #3 解消 | Follow-up 表 + References + Negative 更新、dev 検証のみ残存を明記 |
| 🔍 レビュープロトコル完全実践 | 5 エージェント並列 (code-reviewer/pr-test-analyzer/silent-failure-hunter/comment-analyzer) + Evaluator 独立 = 6 並列 |

### Sprint 1 の方法論ハイライト

- **レビュー Critical 指摘の自己検出**: 復旧スクリプトが drift を**拡大**させるリスク (silent-failure-hunter L192) を merge 前に catch
- **Evaluator 分離プロトコルの威力**: AC 7 件を個別 PASS/FAIL 判定、processedAt 欠如などの見落とされたエッジケースを抽出
- **再レビュー**: Critical 修正後に silent-failure-hunter を再度呼び出し APPROVE 判定を確認してからマージ

## 🔴 次セッションで実施する Follow-up

### A. #229 関連: dev 環境での force-reindex 動作検証 ✅ 完了 (2026-04-17 session5)

Run ID `24519045429` (GitHub Actions run-ops-script.yml, environment=dev, script=`force-reindex --all-drift`) で検証:

```
プロジェクト: doc-split-dev
モード: dry-run (書き込みなし)
[MODE] 全 drift scan (dry-run)
---
走査: 3 件 / drift: 0 件 / 再 index: 0 件 / 失敗: 0 件
完了
```

- ✅ AC1: `--all-drift --dry-run` (default) exit 0、drift 0 件
- ✅ build ステップ成功（tsc 通過、`functions/lib/` 生成）
- ⏭ AC2 (`--sample=5`): dev の走査対象が 3 件で検証意味が薄いためスキップ。
  workflow choice 拡張は #238 (orphan-scan) / #239 (audit log) 対応時に合わせて追加する方針。
  本番 (kanameone/cocoro) 初回展開時に走査件数が大きいタイミングで実体検証可能。

### B. #220 関連: 監視基盤 dev/本番展開 — ✅ 全 3 環境 (dev/kanameone/cocoro) 完遂 (session7)

- ✅ **A1 dev** (session6): 5 metrics + 5 alert policies + 1 channel 稼働
- ✅ **A2 kanameone** (session7): 同上 (Run ID `24547741800`)
- ✅ **A3 cocoro** (session7): 同上 (Run ID `24548562806`)

全環境で以下が同一スペックで稼働: `searchindex_oom` / `ocr_page_truncated` / `ocr_aggregate_truncated` / `summary_truncated` / `search_index_silent_failure`。通知先は全て `hy.unimail.11@gmail.com`。

### B. 過去セッション履歴 (session5 時点の記述)

session5 で **dev 環境の SA + Secret + workflow 切り替え + dry-run 動作検証** を完了。実リソース作成 (setup) のみ次セッション持ち越し。

**session5 完了内容** (PR #241 マージ commit `6d0fbc2`):

- ✅ 専用 SA 作成: `docsplit-monitoring-admin@doc-split-dev.iam.gserviceaccount.com` (Option 2 採用、最小権限)
- ✅ 3 roles 付与: `roles/logging.configWriter`, `roles/monitoring.alertPolicyEditor`, `roles/monitoring.notificationChannelEditor`
- ✅ GitHub Secret `MONITORING_SA_KEY_DEV` 登録 (stdin リダイレクトで鍵内容を conversation context 未露出)
- ✅ `.github/workflows/setup-monitoring.yml` の `credentials_json` を `MONITORING_SA_KEY_{DEV,KANAMEONE,COCORO}` に切り替え
- ✅ `docs/context/monitoring-setup.md` に採用方針 + 展開状況 + セットアップコマンド追記
- ✅ **dry-run dispatch 成功** (Run ID `24535367804`, action=dry-run): notification channel 1 + 5 metrics + 5 alert policies の既存確認スキーム通過

**次セッションで実施する残作業**:

1. **dev で setup 実行** (~5 分): HEALTH_REPORT_TO と同メールアドレスを `notification_email` に渡して dispatch
   ```
   GitHub Actions → "Setup Monitoring (log-based metrics + alerts)"
     environment: dev
     action: setup
     notification_email: <HEALTH_REPORT_TO と同一>
   ```
   AC3b: 5 metrics + 5 alert policies + 1 channel が実体作成されること
   AC4: `gcloud alpha monitoring policies list --filter='userLabels.source="docsplit-monitoring-setup"'` で 5 件確認

2. **kanameone / cocoro 展開** (~各 10 分): dev と同じ順序 (SA 作成 → 3 roles → キー発行 → `MONITORING_SA_KEY_{KANAMEONE,COCORO}` 登録 → setup dispatch)
   手順は `docs/context/monitoring-setup.md` のセットアップ手順セクション参照

**展開状況テーブル** (`docs/context/monitoring-setup.md` 参照):
- ✅ dev: SA + Secret 登録済み、dry-run 検証済み
- ⏳ kanameone: 未セットアップ
- ⏳ cocoro: 未セットアップ

### C. 本セッションで起票した Follow-up Issue (PR #235 スコープ外として分離)

| # | 観点 | 優先度 |
|---|------|--------|
| #237 | search tokenizer の FE/BE/script 3箇所重複を共通化 (`migrate-search-index.js` が MD5、production が 32bit hash で drift 潜在リスク) | P2 (P1 昇格条件: 3箇所のいずれかで挙動差分発覚時) |
| #238 | force-reindex に `--orphan-scan` モード追加 (documents 削除済だが search_index に残る posting を検出・削除) | P2 (実質 P3、drift 実発生で優先度↑) |
| #239 | force-reindex 実行結果を Cloud Logging に構造化 audit log として出力 (現状 stdout のみ) | P2 (実質 P3、監査要件発生で優先度↑) |

## 📋 残り積み残し Issue (catchup 時点、#228/#229 クローズ後)

**Phase 2 (古い bug 消化、1日)**:
| # | タイトル | ラベル |
|---|---|---|
| #189 | ocrProcessor dateMarker サニタイズ境界外 | bug, P2 |
| #190 | check-master-data.js --fix 500件上限考慮 | bug, P2 |
| #196 | rescueStuckProcessingDocs MAX_RETRY_COUNT 追加 | bug, P2 |
| #182 | pdfOperations fileDateFormatted フォールバック | bug, P2 |
| #183 | displayFileName サニタイズ | bug, P2 |

**Phase 3 (テスト補強、0.5日)**:
| # | タイトル | ラベル |
|---|---|---|
| #200 | checkGmailAttachments/splitPdf 統合テスト | enhancement, P2 |

**Phase 4 (リファクタ、1.5日)**:
| # | タイトル | ラベル |
|---|---|---|
| #188 | loadMasterData 共通関数抽出 | enhancement |
| #181 | generateDisplayFileName shared 統合 | enhancement, P2 |
| #214 | generateSummary 共通化 | enhancement, P2 |
| #215 | summary 切り詰めメタ discriminated union 化 | enhancement, P2 |

**Phase 5 (低優先)**:
| # | タイトル | ラベル |
|---|---|---|
| #152 | dev 環境 Firestore 初期設定 | enhancement, P2 |

**継続 Follow-up**:
| # | タイトル | 備考 |
|---|---|---|
| #220 | OOM/truncated metric + alert | PR #231 完了済、SA 権限 + dev/本番展開が Follow-up (上記 §B) |

### Sprint 2 推奨 (次セッション)

優先度高い順 (Follow-up B 残件は session7 で完遂したため除外):

1. **Sprint 2 (Summary リファクタ集約、1.5 日)**: #214 (generateSummary 共通化) → #215 (discriminated union 化)
2. **Phase 2 (古い bug 消化、1 日)**: #189/#190/#196/#182/#183
3. **Phase 3 (テスト補強、0.5 日)**: #200 checkGmailAttachments/splitPdf 統合テスト
4. **Phase 4 リファクタ (1.5 日)**: #188/#181/#237 (tokenizer 3箇所共通化、drift 実発生で優先度↑)

### Follow-up B 残件 (A2/A3) 実施プレイブック — ✅ session7 で使用完了

session7 で実際に以下の手順を用いて A2/A3 を完遂。手順は汎用 SOP として本番環境再セットアップ時に再利用可能。

### 正しい手順の前提

- `scripts/clients/kanameone.env` に `GCLOUD_CONFIG="kanameone"` / `EXPECTED_ACCOUNT="systemkaname@kanameone.com"` が整備済
- `scripts/clients/cocoro.env` に `GCLOUD_CONFIG="doc-split-cocoro"` / `EXPECTED_ACCOUNT="docsplit-deployer@docsplit-cocoro.iam.gserviceaccount.com"` (SA 方式) が整備済
- `gcloud config configurations list` で確認可能: `kanameone` config は `systemkaname@kanameone.com` (Owner) で、`doc-split-cocoro` config は deployer SA で事前認証済
- **`gcloud auth list` の結果だけで権限判断しないこと** (PR #247 で CLAUDE.md に「環境別 gcloud 操作の必須プロトコル」として明記済)

### A2 (kanameone) 実施手順

1. **named config 切替**: `./scripts/switch-client.sh kanameone`
2. **切替確認**: `gcloud config list` で account=`systemkaname@kanameone.com`, project=`docsplit-kanameone` になっていること
3. **SA 作成 + 3 roles 付与**:
   ```bash
   PROJECT_ID=docsplit-kanameone
   SA_NAME=docsplit-monitoring-admin
   SA="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
   gcloud iam service-accounts create "$SA_NAME" --display-name="DocSplit Monitoring Admin" --project="$PROJECT_ID"
   for role in roles/logging.configWriter roles/monitoring.alertPolicyEditor roles/monitoring.notificationChannelEditor; do
     gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role="$role" --condition=None --quiet
   done
   ```
4. **キー発行 + Secret 登録 + 鍵削除**:
   ```bash
   gcloud iam service-accounts keys create /tmp/monitoring-sa-kanameone.json --iam-account="$SA" --project="$PROJECT_ID"
   gh secret set MONITORING_SA_KEY_KANAMEONE --repo yasushi-honda/doc-split < /tmp/monitoring-sa-kanameone.json
   rm /tmp/monitoring-sa-kanameone.json
   ```
5. **dev 環境に戻す**: `./scripts/switch-client.sh dev`
6. **setup dispatch**:
   ```bash
   gh workflow run setup-monitoring.yml --repo yasushi-honda/doc-split \
     -f environment=kanameone -f action=setup -f notification_email=hy.unimail.11@gmail.com
   ```
   ※ `notification_email` はクライアント側通知先を別途協議して決定。dev と同じにするか、kanameone 側の管理メールにするか確認
7. **AC 検証**: Run ID を控え、ログで `5 metrics + 5 alert policies + 1 channel` の作成を確認

### A3 (cocoro) 実施手順

A2 と同じ流れ。Step 1 を `./scripts/switch-client.sh cocoro` に、Step 3 以降のプロジェクト ID を `docsplit-cocoro` に、Secret を `MONITORING_SA_KEY_COCORO` に置換。

**注意 (cocoro の特殊性)**: `AUTH_TYPE="service_account"` で docsplit-deployer SA が使われる。この SA が `setIamPolicy` と `iam.serviceAccountAdmin` を持っているか事前確認。持っていなければ cocoro 側 Workspace (`cocoro-mgnt.com`) の管理者に一時付与してもらうか、Google Cloud Console 上で手動付与が必要。

### session7 で実施済の運用作業

- kanameone/cocoro の `docsplit-monitoring-admin` SA 作成 + 3 roles + キー発行 + Secret 登録完了
- GitHub Secret: `MONITORING_SA_KEY_KANAMEONE` / `MONITORING_SA_KEY_COCORO` (既存 `MONITORING_SA_KEY_DEV` と合わせて 3 環境分揃う)

**展開状況** (`docs/context/monitoring-setup.md`):
- ✅ dev: SA + Secret + setup 完了 (session6, 2026-04-17)
- ✅ kanameone: SA + Secret + setup 完了 (session7, 2026-04-17)
- ✅ cocoro: SA + Secret + setup 完了 (session7, 2026-04-17)

---

## 過去履歴

500 行超過防止のため、2026-04-16 session3 以前は別ファイルに移動:

- [docs/handoff/archive/2026-04-history.md](archive/2026-04-history.md) — session1-3 詳細、Issue #217/#219/#213 系、04-14 以前の変更履歴

## Git状態 (2026-04-18 session10 終了時)

- ブランチ: main (本 PR マージ後)
- 未コミット変更: なし
- 最新コミット: `60b70f5` refactor(textCap): CappedText を discriminated union 化 + 書込契約テスト (#255) (#257)
- session10 マージ済 PR:
  - #254 refactor(summary): 型不変条件を discriminated union 化 + pageTextCap → textCap rename (#215) — session9 持ち越し分を Phase 0.5 で修復マージ
  - #257 refactor(textCap): CappedText を discriminated union 化 + 書込契約テスト (#255) — Phase 1.2 完遂
- session10 起票 Issue: #258 (型設計統合 follow-up) / #259 (contract test 強化 follow-up)
- CI: ✅ 全 PR で lint-build-test + CodeRabbit + GitGuardian pass
- ADR 数: 16 本 (session10 では新規 ADR なし、handoff 更新のみ)

## Git状態 (2026-04-17 session7 終了時)

- ブランチ: main (本 PR マージ後)
- 最新コミット: `e5eb15b` docs(handoff): A2/A3 「Owner 認証ブロッカー」の誤診を訂正 (#248) → 本 PR で更新
- session7 マージ予定 PR: 本 PR (A2/A3 完遂記録のみ、コード変更なし)
- CI: pending (本 PR 作成時点)
- ADR 数: 16 本 (session7 では新規 ADR なし)

## Git状態 (2026-04-17 session6 終了時)

- ブランチ: main
- 未コミット変更: なし (本ハンドオフ PR マージ後)
- 最新コミット: `2a964dc` fix(monitoring): search_index_silent_failure の alignmentPeriod を 25h 制約内に (#245)
- session6 マージ済 PR:
  - #243 setup-gcloud に alpha component 明示インストール
  - #244 notificationRateLimit を全 5 テンプレから削除
  - #245 search_index_silent_failure alignmentPeriod を 25h 制約内に
- CI: ✅ 全 PR で lint-build-test + CodeRabbit + GitGuardian pass
- ADR 数: 16 本 (session6 では新規 ADR なし、monitoring-setup.md / README.md 記述更新のみ)

## Git状態 (2026-04-17 session5 終了時)

- 最新コミット: `6d0fbc2` feat(monitoring): workflow credentials を専用 SA 用 Secret に切り替え + dev セットアップ完了記録 (#241)
- session5 マージ済 PR: #240 (handoff 更新), #241 (監視 SA/Secret/workflow 切替)
- CI: ✅ 成功 (PR #240/#241 両方で lint-build-test + CodeRabbit pass)
