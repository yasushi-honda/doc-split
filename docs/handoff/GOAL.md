---
updated: 2026-07-11
---
<!-- session113: #547 Phase E本番実行(cocoro→kanameone)完遂。全ステップ(mark-preflight/dry-run/canary10件/中間verify/全量execute/最終verify)を番号単位認可で実行、両環境verify PASS・エラー0件・detail/main不在0件。GOAL.mdの完了の定義2点(Ycs#548 close / #547 Phase E完遂+egress実削減発生)を技術的に充足。ただし#548試算では全対策後も現状より高コストのままであり、真の黒字化には保留中のエンティティリスト化判断が別途必要(下記「重要な注記」参照) -->
<!-- session114: decision-makerから「当初のkanameコスト問題を基準に進捗はどうか」「翌月請求を待たずに今できることはないか」と問われ、read-only実測+Codexセカンドオピニオン+実請求書(5月/6月/7月一部)による裏取りを実施。
分析は複数回訂正を経た: ①「63倍」→旧pricing定数との誤比較 ②「9〜13倍」→測定単位混在の誤り ③Codexセカンドオピニオンで「1日サンプルでの確定は統計的に不可、source mix交絡あり」と指摘を受け、OCR単体・モデル確定日のみのクリーン比較に組み直した結果kanameone約5.07倍で確定。A/Bテスト事前実測(3.7〜4倍)・単価差のみの理論値(3.88倍)と合わせ3手法が同じ帯に収束、#548試算の前提5.53倍を裏付け。
実請求書で6月実績¥12,714(Vertex AI¥6,093+Firestore¥4,645)が起点数値と完全一致することを確認(session95の分析は実データに基づいていたと確定)。7月1-9日分請求も確認したが、Vertex AIはまだ+8%のみ(3.5移行は07-09完了のため大半が2.5期間)、Firestore egressは+825%(Phase C/D移行作業自体の一時的read負荷と推定、Phase E本体の効果は07-10完了のためこの期間には未反映)。移行後の実額確認は時間経過待ち(8月請求)。
併せて技術健全性を実地検証: dev/kanameone/cocoro全環境gemini-3.5-flash確認、kanameone/cocoro双方エラー・スタック文書0件、functions 1,680/frontend 310/scripts 72 全testPASS、CI green。
Issue #539(splitPdf二重実行race)・#540(processOCR古いスナップショット上書き)についてCodexセカンドオピニオン取得: 両方とも実害観測を待たず着手すべき、優先順位#539→#540、#539は#432と同一関数での類似構造につき実質P1相当と評価。次セッションの起点として記録。詳細はLATEST.md session114サマリ参照 -->

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

## 重要な注記（コスト実態、session112〜114で判明、session114で実請求書により最終確定）
上記2点の技術的完了は「運用コストが最適化された」ことを意味しない。decision-makerからの問いかけ「最適コスト圧縮に正しく向かっているか」への回答:
- **#548（Gemini 3.5移行）はコスト削減策ではない**: Gemini 2.5 Flash廃止（2026-10-16）+日本データレジデンシー要件による**強制移行**。単価は2.5比で入力×5・出力×3.6高い。Issue試算では全対策後でも**約¥23,000/月**（3.5移行前の現状¥12,714/月より**高い**）
- **起点数値を実請求書で検証済み**: 2026年6月請求書（kanameone）で合計¥12,714・Vertex AI ¥6,093・Firestore egress ¥4,645が**完全一致**で確認できた（session95の分析が実データに基づいていたことを実証）。5月請求書との比較で、Gemini 2.5 Flash自体が「Thinking Text Output」で当時から大きなコスト（月間Vertex AIの約6割）を発生させていたことも判明（B1=要約遅延化がこの一因を大きく削減したと推定）
- **実効値上がり倍率は最終的に3手法が収束**: ①単価差のみの理論値3.88倍 ②A/Bテスト事前実測(PR#559)3.7〜4.0倍 ③本番実測・交絡排除版(kanameone、OCR単体・モデル確定日のみ)5.07倍。Codexセカンドオピニオンの指摘（1日サンプルでの確定は統計的に不可、source mix交絡=移行前は自動要約混入・移行後はOCR単体という非対称性）を踏まえ、交絡を排除して再計算した結果がこの5.07倍。この過程で以前提示していた「63倍」「9〜13倍」「6.7倍/5.0倍」は測定単位の不一致や交絡未排除によるものと判明し、順次訂正済み
- **7月1-9日の実請求も確認したが、まだ移行後の実態は反映されていない**: Vertex AIは+8%のみ（3.5移行は07-09完了のため大半が2.5期間）。Firestore egressは+825%と急増したが、これはPhase C/D（backfill・dual-read検証）という移行作業自体の一時的read負荷と推定され、Phase E本体の削減効果（07-10完了）はこの期間にまだ反映されていない
- **結論**: #548試算（全対策後 約¥23,000/月）は、実測倍率(5.07倍)が前提(5.53倍)を下回ることから、**棄却材料はなくむしろやや保守的（高め）な試算**と判断できる。ただし移行後の実額は8月請求（またはそれ以降の7月分請求確定）まで確認できない
- **技術的健全性はsession114で実地検証済み**: dev/kanameone/cocoro全環境gemini-3.5-flash稼働確認、kanameone/cocoro双方エラー・スタック文書0件、functions/frontend/scripts全testPASS、CI green。3.5移行由来の新規不具合なし
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

### 🎯 次セッションの起点（decision-maker予定済み、優先度順）
- **Issue #539**（splitPdf二重実行race）着手。Codexセカンドオピニオンで「#432と同一関数・類似構造につき実質P1相当、実害観測を待たず着手すべき」と評価済み。修正案: 開始時transaction+splitOperationId等の排他制御、期限付きリース機構。規模感1〜数日
- **Issue #540**（processOCR古いスナップショット上書き）を#539の直後に着手。confirmed系フィールドは既に#526 D2で保護済み(`ocrProcessor.ts:335-368`実装確認済み)なので、残る論点（fileUrl/mimeType/pageResults等の入力世代、ocrRunId/実行所有権の検証）にスコープを絞って再トリアージしてから着手
- 両者とも`/impl-plan`起票が必要（3ファイル以上の変更 or 設計判断を伴う想定）

### 監視・確認事項（トリガー待ち）
- egress実削減効果の翌月請求での実測確認（未実施、上記「重要な注記」参照。8月上旬の7月分請求書で確認）
- #548試算（全対策後¥23,000/月）の実額最終確認（session114で理論的検証は完了、実額は7月分請求書確定後）
- A/Bテスト事前実測（3.7〜4倍）と本番実測クリーン版（kanameone5.07倍）の残差原因調査（乖離は大幅縮小したが依然存在、未着手・read-only範囲で可能）
- dev環境のテストデータ`phase-e-devcheck-001`(意図的に壊れた不一致状態、実害なし)/`phase-e-devcheck-002`(正常)の後片付け（任意）
- 保留カード「OCR出力エンティティリスト化」着手要否のdecision-maker判断（本ミッションのスコープ外、#548 close時に記録済み）
- 検証コマンド: `cd functions && npm test`（1,680 passing）/ `cd frontend && npm test`（310 passing）/ `cd scripts && npm test`（72 passing）
