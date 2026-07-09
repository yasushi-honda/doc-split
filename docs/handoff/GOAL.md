---
updated: 2026-07-09
---
<!-- session109: Phase D PR-D3(#601)/PR-D4(#602)実装+マージ完遂を反映 -->

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
- [x] #547 Phase D **PR-D1**: FE reprocess-clear の detail/main 同時クリア化（**PR #598 マージ済み** 2026-07-09。appendReprocessClearToBatch ヘルパー集約 + detail存在ガード + ui-verified実機検証）
- [x] #547 Phase D **PR-D2**: Functions 読者切替（**PR #599 マージ済み** 2026-07-09。readDocWithDetail=readOnly transaction統一、parentDocumentIdゲート、fieldMask。dev実機確認済み）
- [x] #547 Phase D **PR-D3**: FE 読者切替（**PR #601 マージ済み** 2026-07-09。fetchDocumentDetail/resolveDetailFields/useDocumentDetail新設、DocumentDetailModal/PdfSplitModalオンデマンドdetail取得、getOcrExcerpt→ocrExcerpt参照化、searchText dead code除去。code-review high 5エージェント+Codexで検出2件〔documentDetailキャッシュ無効化漏れ/独立ポーリングレース〕修正済み、ui-verified確認済み）
- [x] #547 Phase D **PR-D4**: scripts 読者切替（**PR #602 マージ済み** 2026-07-09。reprocess-master-matching.js/measure-summary-cost.tsをdetail優先+親フォールバックに切替、AC9読者ゼロgrep契約テスト新設〔scripts/lib/detailReaderCutoverContract.test.ts〕。Codexで検出2件〔measure-field-byte-sizes.js検出漏れ/フォールバック順序〕修正済み）
- [ ] #547 Phase D 展開（trigger: 全PR merge済み(D1〜D4完了) + dev AC確認 + 環境ごと番号単位認可。**環境内は Hosting先行 → stale/pending検証ゲート → Functions の順**（旧PWA由来stale再利用の封鎖）→ 展開先: cocoro→kanameone の順で番号認可を仰ぐ）
- [ ] #547 Phase E impl-plan 起票 → 実行 → Issue #547 close（trigger: Phase D 展開完了 + AC9ゲートPASS。destructive につき番号認可+devリハーサル必須。ADR-0018 Phase E行にCodex P2/P3所見〔PdfSplitModalのdetail loading中ブロック欠如/useDocumentDetailのisError未サーフェス〕を確認事項として記録済み）

## 🔄 中断点（in-flight）
- 対象タスク: #547 Phase D 展開（cocoro/kanameone への Hosting→Functions→scripts 展開）
- 直前の状態: PR-D1(#598)/PR-D2(#599)/PR-D3(#601)/PR-D4(#602) 全マージ済み。dev環境はmain push時のCI自動デプロイ対象のため、次回dev push時に全PR分が反映される見込み(要確認)。本番2環境(cocoro/kanameone)はまだ旧FE/旧Functions/旧scriptsのまま
- 次の一手: ① dev環境で全PR反映後のE2E動作確認(念のため) ② cocoro環境への展開可否をdecision-makerに確認(番号単位認可) → Hosting(D1+D3)先行デプロイ→verify --stale=0確認→Functions(D2)→scripts(D4)の順 ③ kanameone環境も同順序で展開 ④ 両環境展開完了後、AC9ゲートPASS確認→Phase E impl-plan起票
- 検証コマンド: `cd functions && npm test`（1,664 passing）/ `cd frontend && npm test`（304 passing）/ `cd scripts && npm test`（45 passing）
