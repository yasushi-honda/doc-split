---
updated: 2026-07-09
---

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
- [x] #547 dev リハーサル前半（--audit 160件整合 / --dry-run 件数一致）
- [ ] #547 dev リハーサル後半（canary `--execute --limit 10` → 全量 → 2周目書込0件=冪等 → `--verify` PASS。9項目チェックリストは PR #595 コメント）
- [ ] #547 cocoro backfill 実行（trigger: dev リハーサル全PASS + 番号単位認可 + バックアップ鮮度確認）
- [ ] #547 kanameone backfill 実行（trigger: 同上。9,355件）
- [ ] #548 kanameone / cocoro 本番展開 → Issue #548 close（trigger: 番号単位展開認可。検証材料は充足済み）
- [ ] #547 Phase D dual-read cutover → Phase E 親doc大容量フィールド削除（egress実削減）→ Issue #547 close（ADR-0018 ロードマップ。着手時に /impl-plan 必須）

## 🔄 中断点（in-flight）
- 対象タスク: #547 dev リハーサル後半
- 直前の状態: PR #595 マージ済み。dev で `--audit`（160件: detail+excerpt 12 / excerpt-only 148 / stale 0）と `--dry-run`（audit と件数一致）まで完了。実書込（--execute）は未実施
- 次の一手: GitHub Actions "Run Operations Script" → 環境 dev → `backfill-detail-subcollection --execute --limit 10`（canary）を実行し、書込カウンタとログを確認
- 検証コマンド: `gh run list --workflow=run-ops-script.yml --limit 3`（直近実行の成否）/ dev で `--audit` 再実行（残対象件数の減少確認）
