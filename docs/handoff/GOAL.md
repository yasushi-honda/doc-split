---
updated: 2026-07-11
---
<!-- session113: #547 Phase E本番実行(cocoro→kanameone)完遂。全ステップ(mark-preflight/dry-run/canary10件/中間verify/全量execute/最終verify)を番号単位認可で実行、両環境verify PASS・エラー0件・detail/main不在0件。GOAL.mdの完了の定義2点(Ycs#548 close / #547 Phase E完遂+egress実削減発生)を技術的に充足。ただし#548試算では全対策後も現状より高コストのままであり、真の黒字化には保留中のエンティティリスト化判断が別途必要(下記「重要な注記」参照) -->
<!-- session114: decision-makerから「当初のkanameコスト問題を基準に進捗はどうか」「翌月請求を待たずに今できることはないか」と問われ、read-only `check-gemini-cost-stats`(stats/gemini/daily)をkanameone/cocoro双方でGitHub Actions経由(read-only)で実行。初回のcocoro分析は誤り(旧pricing定数+旧B1未反映のデータと比較する誤検算で「63倍」と誤算出)だったが、Fable5切替後の再検証で訂正: 実効値上がり倍率は約9〜13倍(#548試算の5.53倍を上回る)。ただし絶対額はB1(要約遅延化)の相殺効果で6月実績と同水準〜microdisplayやや高め程度に留まっており、9〜13倍は「単価×トークン重量」の話であって月額破綻ではない。最大の不確実性は流量(現状39〜53件/日 vs 6月実測406ページ/日)で、6月並みに戻れば月換算¥23,000試算を大幅超過するリスクあり。詳細はLATEST.md session114サマリ参照 -->

## 現在のミッション
運用コスト圧縮2トラック — #547 Firestore読取egress削減（ADR-0018 detail/main分離）と #548 Gemini 3.5 Flash移行 — を、本番2環境（kanameone / cocoro）で安全に完遂する。

**✅ 技術的完了（2026-07-10 session113）**: 下記「完了の定義」2点をいずれも充足。ただし「完了」は#547/#548の実装・展開が完了したことを意味し、**運用コストが以前より安くなったことは意味しない**。詳細は本セクション末尾の「重要な注記（コスト実態）」を参照。

## 背景・why
- 運用コストが収益を圧迫しており「もはや待ったなしの状態」（decision-maker 明言、session106-107）
- #548 は Gemini 2.5 Flash retirement 期限 **2026-10-16** が外部制約
- 進行原則（decision-maker 指示）: 「本番のデータやシステムを破壊しない安全・確実」を最優先しつつ迅速に。dev / read-only 検証はドンドン回し、本番書込は番号単位認可で一点集中
- #547 の egress 実削減は Phase E（親docの大容量フィールド削除）で初めて発生する。Phase C（backfill）/ Phase D（dual-read cutover）はその前提工程

## 完了の定義
- Issue #548 が close される（証明: `gh issue view 548 --json state --jq .state` が `CLOSED`。**達成済み、2026-07-09**）
- **#547 Phase E が完了し、egress実削減効果が発生する**（証明: 本体 `documents/{docId}` から `ocrResult`/`pageResults` が `FieldValue.delete()` で削除され、一覧クエリの転送量が実測で減少）。**達成済み、2026-07-10 session113**: cocoro（1,055件、run [29102788032](https://github.com/yasushi-honda/doc-split/actions/runs/29102788032)で`--verify` PASS）・kanameone（9,513件、run [29130164136](https://github.com/yasushi-honda/doc-split/actions/runs/29130164136)で`--verify` PASS）両環境とも親doc残存0件・detail/main不在0件・エラー0件を確認。egress実削減自体は翌月請求で実測確認が必要（本項目は「削除実行が完了したこと」の証明であり「請求額が下がったこと」の証明ではない点に注意、下記「重要な注記」参照）。**注: Issue #547自体は2026-07-07 Phase B完遂時点で既にclose済み**（ADR-0018記載の意図的運用: 「Phase C以降は別途decision-maker起点指示+`/impl-plan`で着手」）。Phase C/D/Eの進捗はIssue再オープンではなく本GOAL.md + ADR-0018で追跡する
- 不変条件: 本番 documents の既存フィールドを破壊しない（backfill の親doc更新は ocrExcerpt 1フィールドのみ・detail/main は create 経由のみ。契約テスト `scripts/lib/backfillScriptContract.test.ts` の PASS を維持）。**Phase E本番実行でも維持確認済み**（両環境とも detail/main不在0件、元PDFからの再OCR復元が必要になった箇所なし）

## 重要な注記（コスト実態、session112/113/114で判明）
上記2点の技術的完了は「運用コストが最適化された」ことを意味しない。decision-makerからの問いかけ「最適コスト圧縮に正しく向かっているか」への回答:
- **#548（Gemini 3.5移行）はコスト削減策ではない**: Gemini 2.5 Flash廃止（2026-10-16）+日本データレジデンシー要件による**強制移行**。単価は2.5比で入力×5・出力×3.6高い。Issue試算では全対策後でも**約¥23,000/月**（3.5移行前の現状¥12,714/月より**高い**）
- **session114実測（read-only `check-gemini-cost-stats`、kanameone/cocoro、GitHub Actions経由）**: リクエスト単価の実効上昇は**約9〜13倍**（#548試算の前提5.53倍を上回る。出力+thinkingトークンがページあたり6月実測比で約3.8倍に増量しているのが主因、A/Bテスト事前実測の3.7〜4倍との乖離は未解明）。ただし**絶対額は6月実績¥6,093/月(Vertex AI分)と同水準〜やや高め程度に留まっている**（B1=要約遅延化の相殺効果によりリクエスト数自体が減少しているため）。単価上昇=即月額破綻ではない
- **月額を最終的に左右するのは単価でなく流量**: 現状39〜53件/日 vs 6月実測406ページ/日。6月並みの流量に戻れば月換算¥23,000試算を大幅超過するリスクがあり、逆に現流量が続けば試算内に収まる可能性がある。1〜2週間分の`stats/gemini/daily`蓄積で翌月請求を待たずに再判定可能（read-only、decision-maker判断不要で実行可）
- **#547（Firestore egress削減）は本項目の完了により初めて削減効果が発生**するが、翌月請求での実測確認が必要（未実施）
- **真の黒字化（3.5移行前を下回る水準）には、保留中の「OCR出力エンティティリスト化」（−¥11,000/月級）の着手判断が別途必要**。#548 close時点でdecision-maker判断待ちの保留カードとして記録済み、本ミッションのスコープ外
- 結論: 本ミッション（#547/#548技術完遂）の達成は、コスト最適化に向けた土台が整ったことを意味するが、それ自体で黒字化を保証しない。当初計画（session95: ¥12,714→施策後¥8,000→移行後¥23,000）との比較では、緊急性優先（decision-maker明言「待ったなし」）により中間¥8,000水準を経ずに移行後水準へ直行したトレードオフが実行されている（意図的判断、失敗ではない）

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
- [x] #547 Phase E: 本番実行（cocoro先行→kanameone後続、destructiveにつき番号単位認可必須。**完遂 2026-07-10 session113**。両環境とも `--mark-preflight` → `--dry-run` → `--execute --limit 10`canary → `--verify`(中間、想定内FAIL) → `--execute`全件 → `--verify`最終確認(PASS) の順で実施、GitHub Actions `run-ops-script.yml`経由、各ステップ実行前に番号単位認可取得済み）
  - cocoro: canary10件成功/0エラー → 全量1,045件成功/0エラー（169秒、run [29102349998](https://github.com/yasushi-honda/doc-split/actions/runs/29102349998)）→ 最終verify PASS（run [29102788032](https://github.com/yasushi-honda/doc-split/actions/runs/29102788032)、対象1,055件・親残存0・detail不在0）
  - kanameone: canary10件成功/0エラー → 全量9,503件成功/0エラー（1,432秒≈24分、run [29128844458](https://github.com/yasushi-honda/doc-split/actions/runs/29128844458)）→ 最終verify PASS（run [29130164136](https://github.com/yasushi-honda/doc-split/actions/runs/29130164136)、対象9,513件・親残存0・detail不在0）
  - 全ステップ通じてエラー・異常skip(detail不在/親↔detail不一致)は0件。detail/mainサブコレクションは両環境とも無傷（元PDFからの再OCR復元は不要）

## 完了後の残タスク（次セッション以降）
- egress実削減効果の翌月請求での実測確認（未実施、上記「重要な注記」参照）
- session114で開始した`stats/gemini/daily`蓄積によるコスト再判定（read-only、翌月請求を待たずに継続実行可能）。1〜2週間分溜まった時点で単価9〜13倍×流量の実測から月額を再試算
- A/Bテスト事前実測（3.7〜4倍）と本番実測（9〜13倍）の乖離原因調査（未着手、read-only範囲で可能）
- dev環境のテストデータ`phase-e-devcheck-001`(意図的に壊れた不一致状態、実害なし)/`phase-e-devcheck-002`(正常)の後片付け（任意）
- 保留カード「OCR出力エンティティリスト化」着手要否のdecision-maker判断（本ミッションのスコープ外、#548 close時に記録済み）
- 検証コマンド: `cd functions && npm test`（1,680 passing）/ `cd frontend && npm test`（310 passing）/ `cd scripts && npm test`（72 passing）
