---
updated: 2026-07-09
---
<!-- session110: Phase D cocoro/kanameone本番展開完遂 + CodexセカンドオピニオンによるPhase E前AC具体化を反映 -->

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
- [x] #547 Phase D 展開（2026-07-09 session110完遂。dev: E2E確認PASS〔OCR結果アコーディオン/PDF分割モーダル/処理履歴OCR抜粋、コンソールエラー0件〕。cocoro: Hosting→verify PASS〔新規処理1件のbackfill漏れを検出・--execute再実行で解消→再verify全件parity一致〕→Functions全関数update成功。kanameone: Hosting→verify一発PASS〔9,435件全件parity一致〕→Functions全関数update成功。副産物: kanameone Hosting用GitHub Actions workflow新設〔PR #606、Firebase CLIブラウザ認証不要化〕）
- [x] #547 Phase E 着手前 AC9ゲート内容確認（2026-07-09 session110、Codexセカンドオピニオン via `/codex plan` MCP版・effort high。AC9正体特定: `scripts/lib/detailReaderCutoverContract.test.ts` が定義する「scripts配下で許可リスト外の親`ocrResult/pageResults`直接参照ゼロ」契約、`cd scripts && npm test` 45 passingで記録上PASS済み〔今回read-only制約のため再実行はせず記録確認のみ〕。**ただしAC9はPhase E全体の十分条件ではないとの指摘あり**、詳細は次項）
- [ ] #547 Phase E impl-plan 起票 → 実行 → Issue #547 close（trigger: 下記4点をAcceptance Criteria候補としてimpl-planに組込み。destructive につき番号認可+devリハーサル必須）
  - **[High]** FE側の同等契約テスト（親`ocrResult/pageResults`直接参照ゼロ）の有無を確認、なければAC9同等のgrep契約テストをFEにも追加
  - **[High]** Phase E直前に両本番（cocoro/kanameone）で `backfill-detail-subcollection --verify` を再実行し `detailMissing=0/mismatch=0/staleDetail=0/inPipeline=0` を再確認（session110時点の記録はスナップショットでありPhase E直前のライブ状態ではない）
  - **[Medium]** トリガーストーム評価: Phase Eの全件`FieldValue.delete()`で`onDocumentWrite`/search index系トリガーが全件発火するため、レート制御・影響評価を設計に含める（ADR-0018 Phase E行に前提として明記済み）
  - **[Medium]** FE既知リスク2件の修正 or 明示受容判断: `PdfSplitModal`のdetail loading中操作ブロック欠如（`frontend/src/components/DocumentDetailModal.tsx`）/ `useDocumentDetail`のisLoading・isError未サーフェス

## 🔄 中断点（in-flight）
- 対象タスク: #547 Phase E `/impl-plan` フル起票
- 直前の状態: Phase D展開が cocoro/kanameone 両本番環境で完遂（2026-07-09 session110）。AC9ゲート内容をCodexセカンドオピニオンで特定・記録済み。Phase E自体は destructive（親docフィールド削除）につき未着手
- 次の一手: ① 上記4点（FE契約テスト有無/直前再verify/トリガーストーム評価/FE既知リスク2件）をAcceptance Criteriaに組み込んで `/impl-plan` フル起票 ② dev リハーサル必須 ③ 番号単位認可を得てから本番実行
- 検証コマンド: `cd functions && npm test`（1,664 passing）/ `cd frontend && npm test`（304 passing）/ `cd scripts && npm test`（45 passing）
