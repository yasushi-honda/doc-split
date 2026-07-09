---
updated: 2026-07-09
---
<!-- session108: Phase C完遂+#548 close+Phase D計画承認を反映 -->

## 現在のミッション
運用コスト圧縮2トラック — #547 Firestore読取egress削減（ADR-0018 detail/main分離）と #548 Gemini 3.5 Flash移行 — を、本番2環境（kanameone / cocoro）で安全に完遂する。

## 背景・why
- 運用コストが収益を圧迫しており「もはや待ったなしの状態」（decision-maker 明言、session106-107）
- #548 は Gemini 2.5 Flash retirement 期限 **2026-10-16** が外部制約
- 進行原則（decision-maker 指示）: 「本番のデータやシステムを破壊しない安全・確実」を最優先しつつ迅速に。dev / read-only 検証はドンドン回し、本番書込は番号単位認可で一点集中
- #547 の egress 実削減は Phase E（親docの大容量フィールド削除）で初めて発生する。Phase C（backfill）/ Phase D（dual-read cutover）はその前提工程

## 完了の定義
- Issue #548 が close される（証明: `gh issue view 548 --json state --jq .state` が `CLOSED`）
- Issue #547 が close される（証明: `gh issue view 547 --json state --jq .state` が `CLOSED`）
- 不変条件: 本番 documents の既存フィールドを破壊しない（backfill の親doc更新は ocrExcerpt 1フィールドのみ・detail/main は create 経由のみ。契約テスト `scripts/lib/backfillScriptContract.test.ts` の PASS を維持）

## 進行中のtasks
- [x] #548 confirmed-replay 統計検証（kanameone 実データ N=60、2.5/3.5 確定2項目完全同値 36.7% PASS、手法上限到達）
- [x] #547 Phase C backfill スクリプト実装・マージ（PR #595、3層レビュー通過）
- [x] #547 dev リハーサル完了（2026-07-09、7項目PASS + stale/並行競合2項目は本番ログ注視で代替。kill→再開の再開安全性実証。記録: PR #595 コメント）
- [x] #547 cocoro backfill 完了（2026-07-09、1,039件・verify PASS）
- [x] #547 kanameone backfill 完了（2026-07-09、9,341件・verify PASS 9,389件 parity一致）
- [x] #548 kanameone / cocoro 本番展開 → **Issue #548 close 済み**（2026-07-09。kanameone=2.5 pin解除、cocoro=1ヶ月分一括反映+Hosting+rules。ロールバック: gemini_model_id_override=gemini-2.5-flash）
- [ ] #547 Phase D **PR-D1**: FE reprocess-clear の detail/main 同時クリア化（3箇所の既存writeBatchに detail deleteField 追加。計画: session108 承認済み impl-plan）
- [ ] #547 Phase D **PR-D2**: Functions 読者切替（getOcrText/regenerateSummary=tx.getAll paired-read、pageResultsReuse/detectSplitPoints/splitPdf=detail読込、dual-readフォールバック）
- [ ] #547 Phase D **PR-D3**: FE 読者切替（モーダルのオンデマンドdetail取得/PdfSplitModal/ocrExcerpt参照化/dead code防御除去）+ ui-verified 必須
- [ ] #547 Phase D **PR-D4**: scripts 読者切替（reprocess-master-matching.js + measure-summary-cost.ts）+ AC9読者ゼロgrep契約テスト
- [ ] #547 Phase D 展開（trigger: 全PR merge + dev AC確認 + 環境ごと番号単位認可。**環境内は Hosting先行 → stale/pending検証ゲート → Functions の順**（旧PWA由来stale再利用の封鎖））
- [ ] #547 Phase E impl-plan 起票 → 実行 → Issue #547 close（trigger: Phase D 展開完了 + AC9ゲートPASS。destructive につき番号認可+devリハーサル必須）

## 🔄 中断点（in-flight）
- 対象タスク: #547 Phase D PR-D1
- 直前の状態: Phase D 計画承認済み（Codex plan review P1×3/P2×2 反映済み、計画全文: セッション scratchpad/phase-d-plan.md → 消失時は本GOAL.mdのタスク分解+ADR-0018で再構成可）。Phase B PR4a により3箇所は writeBatch/chunking/親ocrExcerptクリアまで実装済みで、PR-D1 の残作業は「既存batchへの detail/main deleteField 追加」のみ
- 次の一手: feature ブランチで useDocuments.ts useReprocessDocument / useErrors.ts requestReprocess / DocumentsPage.tsx handleBulkReprocess の3箇所に `batch.update(doc(db,'documents',id,'detail','main'), {ocrResult: deleteField(), pageResults: deleteField()})` を追加（rules は deleteField のみ許可、値上書き不可に注意）
- 検証コマンド: `cd frontend && npm test` / `cd functions && npm run test:rules`（detail update ルール適合）
