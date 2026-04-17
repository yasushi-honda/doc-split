# ハンドオフメモ

**更新日**: 2026-04-17 session9 (Sprint 2-2 完遂: #215 Summary discriminated union 化)
**ブランチ**: main (PR #254 CI success、次セッション冒頭でマージ予定)
**フェーズ**: Phase 8 + 運用監視基盤全環境展開完了 + Summary リファクタ集約 2/2 完了

## ✅ session9 完了サマリー (Sprint 2-2 完遂: #215 Summary discriminated union 化)

session8 で整理した WBS の Sprint 2-2 (Evaluator 分離発動ライン) を PM/PL 視点で完遂。Quality Gate 全段 (`/impl-plan` → `/simplify` → `/safe-refactor` → `/trace-dataflow` → **Evaluator分離** → `/review-pr` 6並列) を順に通過し、Critical 指摘 4 件に対応。13 ファイル変更、347+/61-。

| 順 | Issue/PR | 結果 |
|---|---|---|
| 1 | **`/impl-plan` 策定** | ✅ Acceptance Criteria 8 項目を定義、#178 教訓 4 点 + API 境界 + 後方互換戦略を明文化 |
| 2 | **#215 Summary discriminated union 化 + textCap rename** | ✅ PR #254 (CI success: lint-build-test 5m20s ✅ / CodeRabbit ✅ / GitGuardian ✅、MERGEABLE) |
| 3 | **follow-up 起票** | ✅ Issue #253 (useProcessingHistory.firestoreToDocument 重複解消) + Issue #255 (write-payload regression test + CappedText discriminated union 化) |

### 達成効果 (Sprint 2-2 完遂)

| 効果 | 内容 |
|---|---|
| 🛡️ 型不変条件 | `SummaryField` discriminated union で「truncated=true ⟹ originalLength 必須」を型レベル保証。illegal state が代入不可能 |
| 🔒 XSS 経路排除 | summary + OCR 結果の innerHTML → createElement + textContent 化。`DocumentDetailModal.tsx` で 2 箇所修正 |
| 📑 後方互換 | `normalizeSummary()` で旧フラット形式 (Issue #209 時代) を新ネスト型に自動変換。illegal state は `console.warn` で検知可能化 (silent degradation 解消) |
| 🧹 再処理クリア | `getReprocessClearFields()` で新 summary + 旧 3 キー全て `deleteField()`。再処理時に Firestore 旧フィールドが自然クリーン化 |
| 🏷️ 命名整合性 | `pageTextCap.ts` → `textCap.ts` rename + `MAX_SUMMARY_LENGTH` 用途をファイル命名に反映 |

### Sprint 2-2 Quality Gate 実施記録

| 段階 | 結果 | 指摘・対応 |
|---|---|---|
| `/impl-plan` | ✅ AC 8 項目定義 | 13 ファイル想定 → Evaluator 発動確定 |
| `/simplify` 3 並列 (reuse/quality/efficiency) | Critical 2 件 | JSDoc 強化 2 件採用 (SummaryField 判別タグ + normalizeSummary illegal state 仕様明記)、残 1 件は Follow-up #253 起票で対応 |
| `/safe-refactor` | HIGH/MEDIUM 0 件 | LOW 3 件は対応済 or 別 Issue |
| `/trace-dataflow` (summary 12 レイヤー) | 全 OK | Vertex AI → Firestore → FE → UI のラウンドトリップ完全性確認、マッピング欠落なし |
| **Evaluator 分離** (5+ファイル発動) | REQUEST_CHANGES 3 件 | 4 件修正で対応 (OCR innerHTML→textContent 併修 + getReprocessClearFields unit test + 不正型防御 test + seed-e2e-data.js 新型化) |
| `/review-pr` 6 エージェント並列 | Critical 2 / Important 3 | Critical 2 対応 (silent failure に console.warn 追加 + JSDoc 未再処理残留注記)、Important 3 件は Follow-up #255 起票 |

### CI / マージ結果

- BE: `npm run build` PASS / `npm test` 408 passing / `npm run lint` 0 errors (既存 19 warnings 別ファイル)
- FE: `npm run typecheck` PASS / `npm test` 113 passing (元 99 + 新規 14) / `npm run lint` 0 errors
- PR #254 CI: lint-build-test 5m20s ✅ / CodeRabbit ✅ / GitGuardian ✅ → **次セッション冒頭でマージ予定**

### #178 教訓 4 点チェックリスト (全更新済)

- [x] `shared/types.ts`: `SummaryField` discriminated union 追加、Document 型更新
- [x] 書込パス: `ocrProcessor.ts:287-296` / `regenerateSummary.ts:83-89` で新ネスト書込 + 旧 2 キー delete
- [x] firestoreToDocument: `useDocuments.ts:119` / `useProcessingHistory.ts:122` で `normalizeSummary()` 呼出
- [x] `getReprocessClearFields`: `useDocuments.ts:222-229` で新 summary + 旧 3 キー全 delete

### 次セッション: Sprint 3 (古い bug 消化) 着手予定

**最優先タスク (セッション冒頭)**:
1. **PR #254 マージ** (destructive 操作、ユーザー確認必須): `gh pr merge 254 --squash --repo yasushi-honda/doc-split`
2. マージ後 `git checkout main && git pull` で同期
3. ハンドオフ PR (本 PR) もマージ

**残り WBS**:
- **Sprint 3** 古い bug 消化 (#189/#190/#196/#182/#183) — 並列可、1 日
  - #189: ocrProcessor dateMarker サニタイズ境界外
  - #190: check-master-data.js --fix 500件上限考慮
  - #196: rescueStuckProcessingDocs MAX_RETRY_COUNT 追加
  - #182: pdfOperations fileDateFormatted フォールバック
  - #183: displayFileName サニタイズ
- **Sprint 4** リファクタ (#181/#188/#253) — 1.5 日
  - #253 (session9 follow-up): useProcessingHistory.firestoreToDocument 重複解消 → #181/#188 と同時実施が効率的
- **Sprint 5** テスト補強 (#200/#255) — 1 日
  - #255 (session9 follow-up): ocrProcessor/regenerateSummary write-payload regression test + CappedText discriminated union 化
- **Sprint 6** 条件付き待機 (#237/#238/#239/#251) — 稼働実績・監査要件・false negative 発生で昇格

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
