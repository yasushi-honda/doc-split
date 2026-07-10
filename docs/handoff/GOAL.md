---
updated: 2026-07-10
---
<!-- session112: PR #611マージ完了(squash、コミットb1e8297)。/code-review high(8 finder+20件1-vote検証)+Codexセカンドオピニオン(MCP high)でマージ前修正6件を実装、ローカルemulator+Playwright MCPでUI正常系確認・ui-verifiedラベル付与、CI全PASS確認後に番号単位認可を得てマージ。次: 本番実行(cocoro先行→kanameone、destructiveにつき番号単位認可必須) -->

## 現在のミッション
運用コスト圧縮2トラック — #547 Firestore読取egress削減（ADR-0018 detail/main分離）と #548 Gemini 3.5 Flash移行 — を、本番2環境（kanameone / cocoro）で安全に完遂する。

## 背景・why
- 運用コストが収益を圧迫しており「もはや待ったなしの状態」（decision-maker 明言、session106-107）
- #548 は Gemini 2.5 Flash retirement 期限 **2026-10-16** が外部制約
- 進行原則（decision-maker 指示）: 「本番のデータやシステムを破壊しない安全・確実」を最優先しつつ迅速に。dev / read-only 検証はドンドン回し、本番書込は番号単位認可で一点集中
- #547 の egress 実削減は Phase E（親docの大容量フィールド削除）で初めて発生する。Phase C（backfill）/ Phase D（dual-read cutover）はその前提工程

## 完了の定義
- Issue #548 が close される（証明: `gh issue view 548 --json state --jq .state` が `CLOSED`。**達成済み、2026-07-09**）
- **#547 Phase E が完了し、egress実削減効果が発生する**（証明: 本体 `documents/{docId}` から `ocrResult`/`pageResults` が `FieldValue.delete()` で削除され、一覧クエリの転送量が実測で減少）。**注: Issue #547自体は2026-07-07 Phase B完遂時点で既にclose済み**（ADR-0018記載の意図的運用: 「Phase C以降は別途decision-maker起点指示+`/impl-plan`で着手」）。Phase C/D/Eの進捗はIssue再オープンではなく本GOAL.md + ADR-0018で追跡する
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
- [x] #547 Phase E impl-plan フル起票・承認完了（session111、2026-07-10。GOAL.md記載4点ACを起点に、Codexセカンドオピニオン2周実施。1周目でPhase E後もdual-writeが止まらず親フィールドが再発生する重大な設計ギャップを検出（ocrProcessor.ts:391-410でmergedがocrResult/pageResultsを含み本体へも書込み続ける実装をコードで実証確認）→ dual-write停止(PR-E1)をPhase Eスコープへ前倒し統合する方針に転換。2周目で7指摘、うち2件（getReprocessClearFields()のdeleteFieldは維持すべき/splitPdfのitem.payloadは親・detail共有のため分離が必要）をコード検証で確認・計画反映。全17件のAcceptance Criteriaで承認済み）
- [x] #547 Phase E **PR-E1**: dual-write停止（親への「値」set/update停止、`deleteField()`によるクリアは維持） — `ocrProcessor.ts`/`pdfOperations.ts`splitPdf(parentPayload/detailPayload分離)/`checkGmailAttachments.ts`/`uploadPdf.ts`/`import-historical-gmail.js`/`seed-dev-data.ts`改修 + 書込み側契約テスト新設。**devリハーサル中に見落とし発見・修正**: `create-pending-doc.ts`(Issue #562、Phase B完了後追加され網羅的監査対象外だった運用スクリプト)が本体へocrResult直書きしていたため追加修正+契約テスト追加
- [x] #547 Phase E **PR-E2**: 削除実行基盤 — migration marker機構(`_migrations/adr0018PhaseEPreflight`) + documentGroupsトリガーdiff最適化(`isAggregationUnchanged()`) + 削除スクリプト`scripts/delete-legacy-ocr-fields.ts`(状態別5分類ロジック、Firestoreのみの軽量manifest=GCS不要) + `--rollback`実装 + FE契約テスト新設 + PdfSplitModal/DocumentDetailModal強化(loading/error gate)。GitHub Actions `run-ops-script.yml`にdelete-legacy-ocr-fields選択肢追加
- [x] #547 Phase E: ADR-0018 Amended追記完了（Phase E/F区分改訂、Codex 7th/8th review記録を含む）
- [x] #547 Phase E: devリハーサル完遂（2026-07-10、dev環境`doc-split-dev`、GitHub Actions経由。全項目PASS: dry-run/mark-preflight/execute canary/verify/rollback/execute全件160件/**PR-E1実効性実証**(修正版create-pending-docで新規OCR処理後も親フィールド非復活を確認)/**documentGroups負荷実測**(全160件`Updated 0 groups`、下流write完全ゼロ)/**search_index負荷実測**(全件unchanged)/**kill→再開試験**(削除中にジョブキャンセル→87件処理済みで中断→再実行で残り73件削除、二重削除エラーなし、detail/main不在0件=部分破損なし)。実装: featureブランチ`feature/adr-0018-phase-e-dual-write-stop`にコミット2件、push済み（未PR）
- [x] #547 Phase E: PR作成（**PR #611**、session111）
- [x] #547 Phase E: `/code-review high`（8 finder + 20件1-vote検証）+ Codexセカンドオピニオン（MCP high）でバランス判定 → マージ前修正必須6件を特定・実装・push済み（session112、コミット2459986）。follow-up8件はPRコメントで記録（新規Issue化基準未達のため対応不要）
- [x] #547 Phase E: UI確認（`ui-verified`ラベル）— ローカルFirebase Emulators + Vite dev server + Playwright MCPでDocumentDetailModal/PdfSplitModalの正常系（loading/errorゲート非発火時の表示）を実機確認、証跡をPRコメントに記録、ラベル付与済み。isDetailError時のUI矛盾表示(follow-up扱い)の再検証はfirestore.rules一時変更がauto-mode権限classifierにブロックされたため実施せず(即revert確認済み、session111時点で同手法により一度検証済みのためdecision-maker判断でスキップ)
- [x] #547 Phase E: PRマージ（**PR #611マージ完了**、squash、コミット`b1e8297`、featureブランチ削除済み。番号単位明示認可取得済み）
- [ ] #547 Phase E: 本番実行（cocoro先行→kanameone後続、destructiveにつき番号単位認可必須。手順: `--mark-preflight --marked-by <name>` → `--dry-run`確認 → `--execute --limit 10`canary → `--verify` → `--execute`全件 → `--verify`最終確認。GitHub Actions `run-ops-script.yml`経由）

## 🔄 中断点（in-flight）
- 対象タスク: #547 Phase E 本番実行（cocoro先行→kanameone後続）
- 直前の状態: PR #611マージ完了（session112、2026-07-10、コミット`b1e8297`）。dual-write停止(PR-E1)+削除実行基盤(PR-E2)がmainに統合済み。dev環境のテストデータ`phase-e-devcheck-001`(意図的に壊れた不一致状態、実害なし)/`phase-e-devcheck-002`(正常)が残存 — 後片付けは任意
- 次の一手: cocoro環境で `--mark-preflight --marked-by <name>` → `--dry-run`確認 → `--execute --limit 10`canary → `--verify` → 問題なければ `--execute`全件 → `--verify`最終確認（GitHub Actions `run-ops-script.yml`経由）。**destructive delete のため各ステップ実行前に番号単位認可を得ること**。cocoro完了後、同手順をkanameoneで実施
- mainへの統合: コミット`b1e8297`（f05f297→623b405→85cf68d→2459986→703a39cの5コミットをsquash）
- 検証コマンド: `cd functions && npm test`（1,680 passing）/ `cd frontend && npm test`（310 passing）/ `cd scripts && npm test`（72 passing）
