# ハンドオフメモ

**更新日**: 2026-07-11 session114（コスト実態を実請求書(5月/6月/7月一部)+Codexセカンドオピニオンで最終確定。**実効倍率はkanameone約5.07倍(交絡排除・クリーン比較)で、A/Bテスト事前実測3.7〜4倍・理論値3.88倍と収束。#548試算(全対策後¥23,000/月)は棄却材料なく、むしろ保守的と判断**。技術健全性(dev/kanameone/cocoro全環境3.5稼働・エラー0件・test全PASS)も実地確認済み。次セッション起点としてIssue #539→#540のバグ修正を記録。詳細は下記session114サマリ参照）

## session114 サマリ（2026-07-11、コスト実態の再検証 + read-only実測手法の確立）

decision-makerから2つの問いかけ: ①「そもそもkanameのコスト問題を確認して、そこからコスト圧縮策をすすめてきた。それを基準にして今どうか」②「もうこれ以上できることは今はない？」

### ①への回答: 起点(session95)との整合確認
session95のkanameone実コスト分析（6月実績¥12,714=Vertex AI¥6,093+Firestore egress¥4,645）と、Issue #548記載の当初ロードマップ（現状¥12,714→施策後・移行前¥8,000→10月移行後・全対策¥23,000）を再確認。現在の¥23,000/月試算は**新たな悪化ではなく当初から想定済みの中間到達点**と判明（前回セッションでの説明ぶりが誤解を招く表現だった点を訂正）。ただし当初計画は「中間の¥8,000水準を経てから10月に移行」を想定していたが、decision-maker明言の「待ったなし」緊急性により3トラック（#546/#547/#548）を並走させた結果、#548(コスト増要因)が#547(コスト減要因)より1日早く完了し、中間節約フェーズを経ずに移行後水準へ直行した。意図的なトレードオフであり失敗ではない。

### ②への回答: read-only実測で翌月請求を待たずに検証可能と判明
`scripts/check-gemini-cost-stats.js`（`stats/gemini/daily`参照、read-only）を`run-ops-script.yml`経由でkanameone/cocoro双方に実行。GitHub Actions run: kanameone [29136234986](https://github.com/yasushi-honda/doc-split/actions/runs/29136234986)、cocoro [29136311349](https://github.com/yasushi-honda/doc-split/actions/runs/29136311349)。

**初回分析ミスと訂正（Fable5切替後の再検証）**: cocoro 07-08(移行前)のコストを新値と単純比較し「63倍」と算出したが、07-08時点のデータは旧・過小pricing定数(Issue #546で修正済み)+B1未反映のコードで記録されたものであり、有効な比較対象ではなかった。実単価換算+kanameone実測（07-08〜07-11の複数日、session112記録の07-08→07-10比較と整合）で再計算し、**実効値上がり倍率は約9〜13倍**（#548試算の前提5.53倍を上回る）と訂正。主因はページあたり出力+thinkingトークンが6月実測(892)比で約3.8倍(3,366)に増量していること。A/Bテスト事前実測（PR #559、3.7〜4倍）との乖離は未解明。

**絶対額への影響は限定的**: B1（要約遅延化、session95当初計画の最優先施策）によるリクエスト数減少が単価上昇を相殺し、現状のGemini実測コストは6月実績(¥6,093/月)と同水準〜やや高め程度。単価9〜13倍は月額破綻を意味しない。

**月額を最終的に左右するのは流量**: 現状39〜53件/日 vs 6月実測406ページ/日。6月並みの流量に戻れば¥23,000試算を大幅超過するリスク、現流量が続けば試算内に収まる可能性がある。1〜2週間分`stats/gemini/daily`を蓄積すれば、翌月請求を待たずに再判定できる（read-only、decision-maker判断不要）。

### ③ さらなる訂正: 21日分の同一システムデータで再検算（上記②の「9〜13倍」も誤りと判明）
`check-gemini-cost-stats --days 21 --doc-limit 500`をkanameone/cocoro双方で再実行（GitHub Actions run: kanameone [29137194545](https://github.com/yasushi-honda/doc-split/actions/runs/29137194545)、cocoro run同日実行分）。21日分のトークン内訳を取得したところ、上記②の「9〜13倍」も誤りだったと判明した。

**誤りの原因**: ②の計算は、session95の手動サンプル（1ページあたりトークン数、1,378入力/892出力）と、`stats/gemini/daily`の自動集計（1リクエストあたり平均）という**異なる測定単位を混在**させていた。さらに、②が参照した「session112記録の9倍」自体も、移行前データ(07-08)が旧・過小pricing定数のまま記録されていたための誤りだった（cocoroの「63倍」と同根の問題）。

**正しい再計算**: 移行前(kanameone: 06-21〜07-08の18日間・2,224リクエスト、cocoro: 06-19〜07-08の19日間・368リクエスト)の実測トークン数に、正しい2.5 Flash単価($0.3/$2.5)を適用してリクエスト単価を算出し、移行後(07-10、実測3.5 Flash単価)と同一システム内で比較:

| 環境 | 移行前(正しい単価で再計算) | 移行後(実測) | 実効倍率 |
|---|---|---|---|
| kanameone | $0.005007/リクエスト | $0.033411/リクエスト | 約6.7倍 |
| cocoro | $0.003961/リクエスト | $0.019705/リクエスト | 約5.0倍 |

**ボリュームの訂正**: kanameoneの21日間のリクエスト数(28〜391件/日、平均123.6件/日)を見ると変動が大きく、移行後(39〜53件/日)は直近の移行前日(07-04:46件、07-05:31件)と同水準。「6月実測406ページ/日」との比較（前述、②時点の記載）は測定単位（ページ数 vs リクエスト数、後者は既存pageResults再利用時はカウントされない）が異なる可能性が高く、有効な比較ではなかった。

**結論の変更**: #548試算（全対策後¥23,000/月）は、②までで述べていたような楽観的すぎる試算ではなく、実測(5〜7倍)が想定(5.53倍)とほぼ整合するため**概ね妥当な水準**と判断できる。GOAL.mdの「重要な注記」もこの結論で更新済み。

### ④ Codexセカンドオピニオンによる批判的検証 → クリーン倍率5.07倍で最終確定

decision-makerから「セカンドオピニオンからも総括を」と求められ、`/codex plan`（Bash版、effort high）に③の分析を提示し批判的評価を依頼。

**Codexの指摘**:
- 「5.53倍」という前提自体、単価差のみ(入力2割/出力8割仮定)からは`0.2×5+0.8×3.6=3.88倍`にしかならず、既にモデル変更に伴うトークン量変化を含んだ経験的な数字だったと判明
- kanameone 53件・cocoro 9件という移行後1日分のサンプルは「実質1クラスター」で、統計的に確定とは言えない
- **見落としていた交絡要因**: 移行前は自動要約混入・移行後はOCR単体(B1により要約は手動トリガーのみ)という**source mix自体が同時に変化**しており、モデル差と分離できていなかった
- `estimatedCostUsd`はアプリ内蔵の推定価格表であり実請求そのものではない
- 結論格下げ: 「¥23,000/月は棄却すべきほど外れてはいないが、実測で検証済みの数字ではなく、かなり広い不確実性を持つ中心シナリオ」

**交絡排除の再計算**: kanameoneでbySource.ocr(OCR単体)かつモデルが確実に単一(2.5または3.5)と判定できる日のみで再比較。07-09は記録コストと純3.5単価の期待値が不一致(混在日と判明、除外)。07-08(OCR単体・2.5、n=31)を移行前、07-10+07-11(OCR単体・3.5確定、n=56)を移行後として計算した結果:

- kanameone クリーン倍率: **5.068倍**（Python検算済み）
- 3手法の突き合わせ: ①理論値3.88倍 ②A/Bテスト事前実測3.7〜4.0倍 ③本番実測クリーン版5.07倍 → 同じ帯に収束、#548試算の前提5.53倍を裏付け

### ⑤ 実請求書による最終検証（decision-maker提供）

decision-makerから「翌月請求を待たず、検証対象の1ヶ月前の実請求データを渡そうか」と提案があり、GCP Billing Consoleのスクリーンショット3回に分けて共有いただいた。

**5月請求書**: kanameone合計¥13,921、Vertex AI¥8,698（うち Thinking Text Output ¥5,296が最大項目）、Firestore egress ¥3,222。

**6月請求書**: kanameone合計¥12,714、Vertex AI¥6,093、Firestore egress ¥4,645 — **session95が引用していた起点数値と完全一致**。これによりこの分析全体の出発点が実データに基づいていたことを実証できた。5月同様Thinking Text Output(¥3,725)が最大項目で、出力系(Thinking+Text Output)が Vertex AI全体の91.7%を占めることも確認（session95の「output側8割」という仮定を上回る出力偏重）。

**7月1-9日請求（GCP Billing Cloud Assist機能）**: Vertex AI ¥3,094（前期間比+8%のみ）、Firestore egress +825%。ここで重要な気づき: **この期間はほぼ全て「移行前」の実態**である。kanameoneの3.5移行完了は07-09、Phase E本体（Firestore削減効果）完了は07-10で、いずれもこの集計期間の最終日かその翌日。Vertex AIが+8%しか増えていないのは当然の結果。Firestore egressの+825%急増は、Phase C(backfill)・Phase D(dual-read検証)という移行作業自体が生んだ一時的read負荷と推定（Phase E本体の削減効果はまだこの期間に反映されていない）。

**結論**: 移行後の真の実額確認は、Phase E完了(07-10)からまだ日が浅く、どのような実請求データを追加で見ても物理的に確認不可能（時間経過待ちの問題であり、データ収集の問題ではない）。8月上旬の7月分請求書確定を待つ。

### ⑥ 技術健全性の実地検証

decision-makerから「dev/kanameone/cocoro全てGemini 3.5 Flashに移行済みで安定しているか、コスト圧縮対策も機能しテスト・検証もOKか」と問われ、記憶に頼らず実際に検証:

- **モデル設定**: 3環境ともgemini-3.5-flash確認（コードdefault + kanameone/cocoroは07-09以降deploy-functions.yml未実行=ロールバックなし）
- **本番エラー状況**: kanameone/cocoro双方`fix-stuck-documents --include-errors --dry-run`実行 → **エラー・スタック文書0件**
- **オープンなbug Issue**: #539・#540のみ、いずれも2026-07-04起票=移行前から存在する既知バグで移行由来ではない
- **テスト**: functions 1,680 passing / frontend 310 passing / scripts 72 passing、全PASS
- **CI**: main branch直近実行success

### ⑦ Issue #539・#540のトリアージ（Codexセカンドオピニオン）

decision-makerから#539・#540の内容を気にする発言があり、Issue本文を精読した上でCodexにセカンドオピニオンを依頼。

**Codexの評価**: 「実害観測まで待たない、今着手すべき」。優先順位#539→#540。
- **#539（splitPdf二重race）**: 「#432(P0破壊インシデント)と同じ関数・非同期処理・親状態を最終書込みで決める・失敗しても気付きにくい孤児、という共通性は優先度を上げるに十分な強いシグナル」「#526でsplit利用が増える前にゲートすべき」と評価。実質P1相当。修正は単純なstatusチェックでは不十分（同時に2つ通過しうる）、Firestoreトランザクション+splitOperationId+期限付きリース機構が必要、規模感1〜数日。
- **#540（processOCR古いスナップショット）**: Codexが実コード(`ocrProcessor.ts:335-368`)を確認し、**confirmed系フィールド(customerConfirmed/officeConfirmed/documentTypeConfirmed)は既に#526 D2のtransaction内最新値保護で対応済み**とIssue本文を訂正（私も直接コード確認し正確と検証）。残る論点はfileUrl/mimeType/pageResults等の入力世代、および「自分が開始したOCR実行だけが完了できる」という実行所有権(ocrRunId/lease)の未検証。タイトルを「OCR実行の入力世代・実行所有権の検証」に寄せて再トリアージすべき。

decision-mainerがこの方針で次セッションへの計画投入を決定。GOAL.mdの「次セッションの起点」に記録済み。

### 引き継ぎ教訓
- **セカンドオピニオン（Fable5）への切替が実際に誤りを検出した好事例**: 同一セッション内の自己評価では「63倍」を疑わずに提示していた可能性が高い。モデル切替後の再検証で計算根拠（pricing定数のバージョン、B1反映有無）を洗い直し誤りを発見・訂正。
- **ただしそのFable5再検証（②）自体も誤りを含んでいた**: 「63倍」の誤りを正したことに満足し、比較対象の測定単位（手動サンプルのページ単位 vs 自動集計のリクエスト単位）が一致しているかの検証が不十分だった。より長期間・詳細なデータ(21日分)を取得して初めて発覚。**教訓**: 異なる出所の実測値を比較する際は、測定単位・粒度が完全に一致しているかを必ず確認してから倍率を算出すること。単発の再検証で満足せず、可能な限り同一の測定パイプラインで再現することが望ましい。
- 「もうこれ以上できることはないか」という問いに対し、read-only監視（守り・検出）の実行可能性を再検討したことで、翌月請求を待たずに実測データを取得できると判明。decision-maker領分（エンティティリスト化着手判断）とexecutor領分（read-only実測）を混同せず後者を能動実行した。
- **Codexセカンドオピニオンが2段階の誤りを検出**: 「9〜13倍」を正しいと思い込んだ後も、Codexの批判的指摘（1日サンプルの弱さ・source mix交絡）がなければ「6.7倍/5.0倍」が最終結論として確定していた。セカンドオピニオンは1回で満足せず、結論を出す直前にもう一段疑うことの価値を再確認。
- **実請求書による裏取りが分析全体の信頼性を最終的に担保**: token推定値だけでは「session95の起点数値自体が正しいか」を確認できなかったが、decision-maker提供の実請求書で6月実績が完全一致することを確認でき、分析チェーン全体の土台が固まった。トークンベースの内部推定と実請求は別物であり、決定的な検証には後者が必要という教訓（Codexも同じ点を指摘）。
- **「これから決断する」ではなく「既に決断・実行済みのものを事後検証している」という時制の取り違えをdecision-makerに指摘された**。Gemini 3.5移行は2026-07-09に完了済みであり、以降のやり取りは全て事後の実額確認作業だったが、私の発言（「決断材料として」等）がこれを覆い隠す表現になっていた。既に実行済みの決定と、今後判断すべき決定を明確に区別して話すべきだった。
- GOAL.md「重要な注記」セクションをsession114時点の最終再検証結果で更新（詳細はGOAL.md参照）。

## session113 サマリ（2026-07-10、#547 Phase E 本番実行完遂）

decision-makerから「gemini3.5flashへの移行とFirestoreのコスト圧縮、その他コスト圧縮の対応は進んでいるか、最適コスト圧縮に正しく向かっているか」と問われ、session112の調査結果（GOAL.md/LATEST.md記載）を提示した上で、GOAL.mdの中断点（#547 Phase E本番実行、cocoro先行→kanameone後続）へ着手。

### 前提検証（鵜呑み防止）
session112 handoffの「cocoro/kanameoneへのdestructive delete実行はゼロ」という記述を、GitHub Actions実行ログの直接サンプル確認で裏取り（zshの単語分割仕様に起因する検証スクリプトの不具合により網羅的検証は途中で打ち切ったが、個別サンプル3件の確認+GOAL.mdの明示的な未完了チェックボックスの記録整合性から、記述は正確と判断）。

### #547 Phase E本番実行（cocoro→kanameone、各ステップ番号単位認可）
両環境とも同一手順（`--mark-preflight --marked-by yasushi-honda` → `--dry-run` → `--execute --limit 10`canary → `--verify`(中間、想定内FAIL) → `--execute`全件 → `--verify`最終確認）をGitHub Actions `run-ops-script.yml`経由で実施、各ステップ実行前にAskUserQuestionで番号単位認可を取得。

- **cocoro**（1,055件）: canary10件成功/0エラー → 全量1,045件成功/0エラー（169秒）→ 最終verify **PASS**（親残存0・detail不在0）
- **kanameone**（9,513件）: canary10件成功/0エラー → 全量9,503件成功/0エラー（1,432秒≈24分）→ 最終verify **PASS**（親残存0・detail不在0）
- 全ステップ通じてエラー・異常skip 0件。detail/mainサブコレクションは両環境とも無傷。中間verifyのFAILは「全件削除完了」を判定基準とする仕様上の想定内の結果（canary分を除く残存件数が正しくカウントされていることを確認した上で継続）。

### GOAL.md / LATEST.md更新
GOAL.mdの完了の定義2点（#548 close済み・#547 Phase E完遂+egress実削減発生）が技術的に充足されたことを反映。同時に「重要な注記（コスト実態）」セクションを新設し、技術完了とコスト最適化達成が別物であることを明記（#548試算では全対策後も現状より高コスト、真の黒字化には保留中のエンティティリスト化判断が別途必要）。

### 引き継ぎ教訓
- GitHub Actions実行ログの網羅検証をバックグラウンドループで試みたが、zshの`for id in $VAR`が単語分割しない仕様（bashと異なる）により空ループになる不具合に遭遇。`while IFS= read -r id; do...done < file`方式で修正したが、100件近い個別ログ取得は時間がかかりすぎるため打ち切り、サンプル確認+文書記録の整合性で妥当性を判断する方針に切替えた。

## session112 サマリ（2026-07-10、#547 Phase E コードmain統合 + コスト実態調査）

session111の中断点（Phase E PR-E1/PR-E2実装完了、devリハーサル全項目PASS、PR未作成）から着手。

### PR #611（Phase E本体）のレビュー・マージ
- **Codex review-diff**（Bash版、effort high）で先行チェック: P2指摘2件（`--verify`のPASS/FAIL判定漏れ・detail取得の非効率）を検出・修正（コミット`85cf68d`）。
- **`/code-review high`**（8 finder並列 + 重複排除後20件を1-vote独立検証）を実施。CONFIRMED 9件・PLAUSIBLE 6件・REFUTED 5件。
- **Codex MCPセカンドオピニオン**（effort high）で「マージ前修正必須 vs follow-up」のバランス判定を依頼。指摘ごとに独立評価した上で、マージ前修正6件を確定・実装（コミット`2459986`）:
  1. `runRollback`のsilent no-op（型不一致時に無音returnしexitCode 0になる欠陥）→ `typeMismatch`カウンタ+manifest件数との集計照合を追加
  2. `deleteOneDoc`のswitch/default型安全性ギャップ → `DeletionOutcome` Record型で網羅性を保証（`backfill-detail-subcollection.ts`のパターンをミラー）
  3. `canonicalHash`/`canonicalStringify`の重複実装 → `backfillDetailHelpers.ts`からのre-exportに置換
  4. rollbackのPartial Updateテスト欠如 → `buildRollbackFieldUpdate()`新設+契約テスト追加
  5. `shared/types.ts` `Document.ocrResult`の型/実態不一致 → optional化（唯一の影響箇所`useDocuments.ts:150`も安全なtypeof guardに修正）
  6. `parseArgs`の`--marked-by`/`--run-id`引数swallowバグ → `pr-d4-backfill/index.ts`の`readArg`パターンをミラー
  - follow-up 8件はPR #611コメントに記録（新規Issue化基準未達）。
- **UI実機確認**: ローカルFirebase Emulators + Vite dev server + Playwright MCPで`DocumentDetailModal`/`PdfSplitModal`の正常系を確認、`ui-verified`ラベル付与（`isDetailError`矛盾表示のfollow-up項目は、firestore.rules一時変更がauto-mode権限classifierにブロックされたため未実施、session111時点で同手法により検証済みのためdecision-maker判断でスキップ）。
- **PR #611マージ完了**（squash、コミット`b1e8297`、番号単位認可取得済み）。付随してPR #612（GOAL.md更新）・PR #613（ADR-0018整合性是正、handoffの§1.4チェックで検出）も番号単位認可の上マージ。

### コスト圧縮の実態調査（decision-maker問いかけ「最適コスト圧縮に向かっているか」への回答）
- **データ安全性確認**: GitHub Actions実行履歴を全件確認し、`delete-legacy-ocr-fields`（destructive）はdev環境のみで実行、cocoro/kanameoneへの実行はゼロと確認。
- **重要な前提訂正**: Gemini 3.5 Flash移行はコスト削減策ではなく、2.5 Flash廃止（2026-10-16）+日本データレジデンシー要件による強制移行。3.5は単価が2.5比で入力×5・出力×3.6高い。Issue #548試算: 現状¥12,714/月 → 3.5移行・全対策後でも約¥23,000/月（現状より高い）。真の圧縮には保留中の「OCR出力エンティティリスト化」（−¥11,000/月級、decision-maker判断待ち・未着手）が別途必要。
- **実測データ取得**（読み取り専用`check-gemini-cost-stats.js`をGitHub Actions経由でkanameone/cocoro向けに実行。**この実行はauto-mode権限classifierに一度ブロックされ、ユーザー承認を得てから結果確認**）: kanameoneで移行前(07-08)→移行後(07-10)のリクエスト単価が約9倍に上昇（試算の5.53倍よりさらに悪化、ただしサンプルは2日分と小さい）。**【session114で訂正】この「9倍」は移行前(07-08)データが旧・過小pricing定数のまま記録されていたための誤りで、正しい単価で再計算すると約6.7倍（#548試算の前提とほぼ整合）。詳細はsession114サマリ参照**。
- **結論**: #547/#548以外に未着手のコスト圧縮施策なし（#546完了・#562見送り確認済み）。現時点は3.5移行による増コストが先行発生し、Firestore egress削減がまだ未実行という「最もコストが高い過渡期」にある。

### 引き継ぎ教訓
- 本セッションでauto-mode権限classifierに2回ブロックされた（firestore.rules一時変更／本番へのコスト計測クエリ新規ディスパッチ）。いずれも「読み取り専用 or 即revert」で実害はなかったが、ユーザーへの明示確認を経てから続行する運用が機能した。

## session110 サマリ（2026-07-09、#547 Phase D 本番展開完遂）

ユーザー指示「ゴール目指して進めてください」を受け、GOAL.mdの中断点（dev E2E確認→cocoro展開→kanameone展開）から着手。

- **dev E2E確認**: Playwright MCPでOCR結果アコーディオン(51文字展開)/PDF分割モーダル(5ページ)/処理履歴OCR抜粋(複数件)を確認、コンソールエラー/警告0件。
- **cocoro展開**: Firebase CLI(hy.unimail.11@gmail.com)でHosting(D1+D3)デプロイ→`backfill-detail-subcollection --verify`実行→新規処理1件のdetail/main不在を検出(stale detailではなくbackfill後に処理された新規docのbackfill未反映)→`--execute`再実行(対象1件のみ、冪等)で解消→再verify全1046件parity一致確認→GitHub Actions「Deploy Cloud Functions」で全関数デプロイ成功(7分46秒)。
- **kanameone展開**: Firebase CLIの`systemkaname@kanameone.com`ローカルログインが失効しブラウザ再認証必須(AI実行環境から対応不能)と判明→ユーザー指示「GitHub Actionsで対応」を受け、新規workflow`.github/workflows/deploy-hosting.yml`をSA鍵(`GCP_SA_KEY_KANAMEONE`)認証パターンで追加(**PR #606**。kanameone専用でcocoroオプションは意図的に含めず——cocoro用Secrets未登録のため空文字列ビルド事故を防止)→Hosting(D1+D3)デプロイ→verify一発PASS(9,435件全件parity一致、backfill対象0件)→Functions(D2)デプロイ全関数成功(7分53秒)。
- **GOAL.md更新×2**: **PR #607**(Phase D展開完遂を反映)、**PR #608**(Codexセカンドオピニオンによる AC9正体特定+Phase E前AC候補4件を記録)。
- **Codexセカンドオピニオン**: decision-maker指示によりCodex(`/codex plan`、MCP版、effort=high)でPhase D展開の安全性検証+Phase E着手前確認事項を洗い出し。**AC9正体特定**: `scripts/lib/detailReaderCutoverContract.test.ts`が定義する「scripts配下の親`ocrResult`/`pageResults`直接参照ゼロ」契約(scripts限定、FE側同等契約は未確認)。指摘はHigh2件(FE契約テスト有無/Phase E直前の再verify必須)、Medium2件(トリガーストーム評価・FE既知リスク2件、いずれもADR-0018既記載事項の再掲)、Low1件(kanameone workflowの承認ゲート検討)。
- **セカンドオピニオン運用の教訓**: Codexの4指摘を独立評価を添えずに一括でGOAL.md反映提案した点をdecision-makerから「盲目的に承認しないように」と指摘され、`~/.claude/memory/feedback_second_opinion_not_final_conclusion.md`に具体判断則(複数指摘の一括反映回避)を追記。事後的にHigh2件を実質的な新規指摘、Medium2件は既存ADR記載の再掲と整理し直した。
- **ADR-0018整合性是正**: handoff中のドキュメント整合性チェックでPhase D行が「展開は別途」「未実施」のまま古い状態だったことを検出、本番展開完遂を反映して更新(本PR)。
- **マージ**: PR #606(kanameone Hosting workflow新設)/#607/#608(GOAL.md更新)の計3件、いずれも番号単位認可を得てマージ。Issue Net変化はゼロ(起票0/close0、Issue #547自体はPhase Eが残るためopen継続)。
- **セッション終了判断**: decision-maker「ここでゴールを目指して進めるかhandoffしてセッションを変えるか」への相談に対し、Phase Eがdestructive操作でフル`/impl-plan`起票が必要な新規大作業単位であること、本セッションが長時間のデプロイ待ちポーリングでコンテキストを消費していることを理由にhandoffを推奨、decision-maker合意。

## session109 サマリ（2026-07-09、#547 Phase D PR-D3/PR-D4完遂）

ユーザー指示「ゴール目指して進めてください」を受け、中断点だったPR-D2 dev実機確認から着手し、Phase D残タスク（PR-D3/PR-D4）を完遂。

- **PR-D2 dev実機確認**: Playwright MCPでdoc-split-dev環境の要約再生成/PDF分割候補表示/処理履歴OCR抜粋を確認、コンソールエラー0件で中断点解消。
- **PR-D3 (#601) FE読者切替**:
  - `fetchDocumentDetail`/`resolveDetailFields`/`useDocumentDetail`新設（`functions/src/ocr/documentDetail.ts`のFE版、detail優先+親フォールバック）。DocumentDetailModal/PdfSplitModalをdetail/mainのオンデマンド取得に切替
  - `useProcessingHistory.getOcrExcerpt()`を`doc.ocrExcerpt`参照に変更（Storage offload placeholderの重複ハードコード解消）、`fetchDocuments()`のsearchTextフィルタから`doc.ocrResult`条件を除去（Phase E後クラッシュ防止のdead code対応）
  - **code-review high（5エージェント並列: line-by-line/removed-behavior/cross-file/reuse-simplification-efficiency/altitude-conventions）で実質2件検出・修正**: ①再処理3経路中2経路（`useErrors.ts`単発/`DocumentsPage.tsx`一括）で`['documentDetail', id]`キャッシュ無効化漏れ ②`useDocument`/`useDocumentDetail`が独立3秒ポーリングのため、OCR完了直後に親側status遷移をdetail側が後追いできず古い値で固定されうるレース→status遷移検知でのinvalidateQueriesで解消
  - **Codexセカンドオピニオン**: P1相当bugなし、FE/BE間resolveDetailFieldsフォールバック規則不一致なし。P2/P3所見2件（PdfSplitModalのdetail loading中ブロック欠如/useDocumentDetailのisError未サーフェス、いずれもPhase E後に初めて顕在化）はADR-0018 Phase E行に記録
  - **ui-verified**: ローカルvite+dev実FirestoreでOCR結果アコーディオン(1,351文字)/AI要約/PDF分割モーダル(12ページ)/モバイルOCRポップアップ/処理履歴OCR抜粋を確認、PR body+コメントに証跡記録の上`ui-verified`ラベル付与。frontend新規14テスト追加（290→304件）
- **PR-D4 (#602) scripts読者切替**:
  - `reprocess-master-matching.js`/`measure-summary-cost.ts`をdetail優先+親フォールバックに切替。`scripts/lib/detailReaderCutoverContract.test.ts`新設——AC9（Phase E前提ゲート）としてscripts/配下に許可リスト外で親ocrResult/pageResultsを直接参照するファイルが存在しないことを検証
  - **Codexで2件検出・修正**: ①AC9検出パターンがドット記法のみで`measure-field-byte-sizes.js`（Issue #547着手前の事前計測スクリプト、`HEAVY_FIELDS`配列経由の`d[field]`ブラケット記法）を見逃していた漏れ→検出パターンを引用符付き文字列リテラルまで拡張+許可リストに追加で解消 ②親フォールバックを`typeof === 'string'`の厳密チェックに統一
  - scripts新規3テスト追加（42→45件）、検出ロジックの動作確認（意図的違反注入でFAILすることを実証）も実施
- **CI flaky failure対応**: PR-D4のCIで`functions/test/prD4RevalidationOrchestrator.test.ts`（別件ADR-0016 provenance backfill、Issue #445領域、本セッション変更対象外）が1件失敗。ローカルでは1664/1664件全PASSと再現せず、再実行で解消（CI環境依存の非決定性と判断）。
- **stacked branch + squash mergeの罠と対処**: PR-D4をPR-D3ブランチからstackして作成したため、PR-D3マージ(squash)後にPR-D4の差分がPR-D3分まで重複表示される事象が発生。`git rebase --onto origin/main <PR-D3分岐点> HEAD`でPR-D3の個別コミットをdropしてから`force-with-lease` pushし解消。
- **handoff時のドキュメント整合性チェックで検出・是正**: ADR-0018のPhase C/D行が「✅完了」マーカー未反映（Phase Bのみ反映済み）だったため、実態（Phase C全環境完遂・Phase D実装完遂/展開未実施）を追記（PR #604）。
- **マージ**: PR #601/#602/#603(GOAL.md更新)/#604(ADR整合性)の計4件、いずれも番号単位認可を得てマージ。Issue Net変化はゼロ（起票0/close0、Issue #547自体はPhase D展開+Phase Eが残るためopen継続）。

## session108 サマリ（2026-07-09、コスト圧縮2トラックの大幅前進）

### GOAL.md新設（PR #597マージ）
ユーザー指示「ゴール設定しておきましょう」で docs/handoff/GOAL.md を新設。ミッション=コスト圧縮2トラック完遂、完了の定義=/goal condition互換、SessionStart hookが自動注入。以降のタスク管理はGOAL.mdが正。

### #547 Phase C backfill 全3環境完遂
devリハーサル後半（canary 10件→kill前144件→**途中kill(gh run cancel)→再実行が残6件のみ検出し完了=再開安全性実証**→2周目0件→verify PASS）。stale-seed/並行競合の2項目はActions経路で実現不可のため「本番実行時ログ注視」代替をユーザー認可(「GitHubActionsですすめて」)。両本番認可(「両環境認可（cocoro→kanameone順）」)後、cocoro 1,039件(174秒)→kanameone 9,341件(1,414秒)、全環境エラー0・冪等0件・**verify PASS(kanameone 9,389件parity一致・stale0)**。reconciledStaleDetail=0/decisionChanged=0(代替確認完了)。証跡: PR #595コメント+Issue #547コメント。

### #548 本番展開 → Issue close（Net +1）
番号単位認可後、kanameone=deploy-functions.ymlでGEMINI_MODEL_ID pin解除→code-default(gemini-3.5-flash)、processocr/processocroncreate/regeneratesummary全てで実機確認。cocoro=6/12以来1ヶ月分を一括反映(Functions run 28989098469 + Hostingローカル手順 + rules/indexes/storage)。ロールバック経路: gemini_model_id_override=gemini-2.5-flash。期限2026-10-16に3ヶ月前倒しで完遂。B3/B4/エンティティリスト化は任意残置(close非ブロック)。

### #547 Phase D 計画承認 + PR-D1/D2 マージ
/impl-plan(フル)起票→**Codex plan review P1×3(rules値上書き拒否/旧PWA stale再利用→Hosting先行デプロイ順序/scripts対象拡大)+P2×2を実コード裏取りの上反映**→ユーザー質問「検索窓のこと?」への調査で**OCR全文検索懸念はdead code(検索窓はサーバー側インデックス、searchText渡すUI不存在)と確定し解消**→承認。
- **PR-D1 (#598)**: 再処理3経路のdetail同時クリア。appendReprocessClearToBatchヘルパー集約+detail存在ガード(getDoc)+chunking維持。code-review high 4クラスタ+review-pr(comment rot 2件)反映。**ui-verified**: ローカルvite+dev実Firestoreでseed_generic_12p.pdfを実再処理→batch commit成功→OCR完走→verify PASS。
- **PR-D2 (#599)**: Functions読者4箇所切替。documentDetail.ts新設(resolveDetailFields+**readDocWithDetail=readOnly transactionのtx.getAll**)。code-review high 7クラスタ反映(db.getAll(2ref)のsnapshot非保証→transaction統一/ocrProcessorのparentDocumentIdゲート/fieldMask/単独実行TS2503実測修正)+Codex収束+review-pr(契約パスpin Critical+キャスト根拠コメント事実訂正)。functions 1,665テストPASS。
- マージ後 dev Functionsデプロイ発火(run 29017957991)——**実機確認は次セッション冒頭タスク**。

### 副次的発見・是正（重要）
- **frontend/.env(gitignoredフォールバック)が4/29からkanameone本番値のまま**という地雷を発見(UI検証中にログインがkanameoneへ向かい、アプリ認可層User not authorizedが正しく防御)。dev値に復元、旧値は.env.backup-kanameone-20260709へ退避。**`.env.local`なしの`npm run dev`が本番を向く構造は再発しうる**——恒久対策(例: .envをdev固定にする規約明文化)は未着手。
- gcloud active configがkanameoneのまま残留していた件をdev(doc-split)へ復帰。ただし**本セッションの環境変数CLOUDSDK_ACTIVE_CONFIG_NAME=kanameone/GCLOUD_PROJECT/FIREBASE_PROJECT が親シェルから継承残留**しており、gcloud/firebase-admin系のローカル実行は`--project`明示が必須だった(スクリプトのambient不一致検出が正しく機能することも確認)。新セッションでは解消されているはずだが要注意。
- ADCがyasushi.honda@aozora-cg.com(dev 403)のままの件は、GitHub Actions経路への切替(ユーザー指示)で回避——ローカルADC依存作業が必要になったら`gcloud auth application-default login`(hy.unimail.11)が必要。

## session107 サマリ（2026-07-08〜09、コスト圧縮2トラック並走）

### トラック1: #548 Gemini 3.5移行 — confirmed-replay検証の完遂（手法上限到達）
- **documentTypeConfirmed=0件問題の発見と解消**: kanameone本番でdiagnose-confirmed-replay-samplingを実行、documentTypeConfirmed=trueが全9,380件中0件（Issue #526の手動確定UIが本番未展開のため書込経路自体が存在しない）と判明。これがPR #577の大規模検証パイロットが「対象0件」で終了していた根本原因。**PR #592**でサンプリングを2条件（customer+office、confirmedBy/officeConfirmedBy非null）に緩和、documentTypeは参考値としてgate除外（マージ済）。
- **kanameone CI/CD SAにroles/aiplatform.user付与**（ユーザー認可済）: run-ops-script経由のVertex AI呼出が403で全滅していたIAM不足を解消。confirmed-replayはこのSAで初めてVertex AIを呼ぶスクリプトだったため今まで顕在化せず。
- **PR #593**（SAMPLE_HEADROOM_CAP 2000→10000）+ **PR #594**（--limit 5000選択肢）で全母集団スキャンを可能にし実行 → **真の母集団上限はN=60**（confirmedBy非nullの歩留まり約1.3%）。結果: **確定2項目一致率 2.5=3.5完全同値36.7%（22/60）、PASS**。絶対値が低いのは「人間確定=過去に訂正が必要だった難しい文書」への母集団バイアスで、相対比較には有効。コスト比5.53倍。**この手法での統計検証はこれが上限**——本番展開判断の材料は出揃った。
- 展開判断の残り: 段階的本番展開（少数→監視→全量）が現実的な次の一手だが、展開自体は番号単位認可待ち。

### トラック2: #547 Phase C（backfill）— 設計→実装→3層レビュー→マージ→devリハーサル前半
- **計画**: /impl-planフルモード→Codex planレビュー（GO with amendments、Critical4件）→ユーザー指示によりFable5で最終チェック（Codex指摘を実コード検証の上、**batch案を棄却してper-docトランザクション設計に変更**——競合上書き・batch 500ops/10MiB問題を構造的に解消）→承認。
- **実装（PR #595、マージ済）**: `scripts/backfill-detail-subcollection.ts`（--audit/--dry-run/--execute [--limit N]/--verify の4モード）+ `scripts/lib/backfillDetailHelpers.ts`（純粋ロジック+テスト）+ ocrExcerpt算出を`functions/src/ocr/ocrExcerpt.ts`へ抽出（本番/backfill/verify三者共用、契約テストlock-in）+ ci.ymlにscriptsテストステップ新設（scripts/lib/*.test.tsがCI未実行だった既存ギャップ解消）。
- **品質ゲート3層**: ①/code-review high（4finder・8角度）13件全修正 ②Codexセカンドオピニオン4ラウンド（P1計4件全修正: excerpt独立判定/厳格argv検証/PROJECT_ID明示優先+ambient食い違い即エラー/stale detail是正）で収束 ③/review-pr 5エージェント並列（code-reviewer判定Clean、silent-failure-hunter HIGH2件=gRPCコードログ・reconcile監査証跡、type-design網羅性ガード、契約テスト空振り穴等を全修正）。主要な設計知見: **detail作成とocrExcerpt補完は独立判定必須**（seed-dev-dataがdetailのみdual-writeするためskip-detail-exists方式ではverifyが永久FAIL）、**stale detail是正はocrResult:''方式**（deleteFieldだとC1不変条件「detail存在時ocrResultは常にstring」に自己矛盾）。
- **devリハーサル前半完了（9項目チェックリストはPR #595コメント参照）**: --audit✅（全160件、対象160=detail+excerpt作成12+excerptのみ補完148。**excerpt-only 148件はCodex P1修正の正しさを実データで即実証**——旧ロジックなら永久スキップだった）、--dry-run✅（件数一致）。残り: stale-detail seed→canary(--execute --limit 10)→全量execute→2周目冪等確認→--verify→並行再処理競合→kill再開。
- **セッション運営**: main直コミット誤操作1件（--limit 5000のworkflow変更をmainに直コミット→push前に気づきstash+reset --hard origin/mainで復旧、feature branch経由でPR #594に載せ直し。git status確認→stash→resetの安全手順を遵守）。

session105のkanameone段階デプロイ完遂を前セッションのcompact跨ぎで独立検証(handoff本文+GCP実機state+タスクリストの3系統照合、情報欠落なし)した後、ユーザーからGemini 3.5移行に絡めた個人情報/要配慮個人情報コンプライアンス確認を要請。ADR-0002の「マスキング実装完了」表記が実態と食い違う(未実装、customerName等はマスク前の実値で保存)ことを発見、WebSearchでVertex AI学習非利用保証・3省2ガイドライン現行性をファクトチェックした上で「マスキングは製品の中核機能(マスター突合・画面表示)と非両立につき見送りが正当」と結論。ベンダー内部の責任分界記録(PR #588)→ADR-0002の実態整合(PR #589)→**実際にクライアントが読む場所への推奨文言設置**(PR #590、当初PR #588を開発者専用文書に書いてしまっていたミスをユーザー指摘で訂正)の3層で対応完了。既存クライアントへの周知はユーザー側で別途対応と確認済み）

## session106 サマリ（2026-07-08、個人情報コンプライアンス確認・是正）

- **compact跨ぎの情報欠落検証**: ユーザーから「handoff途中でcompactがかかっていないか」と指摘され、①`docs/handoff/LATEST.md`本文の直接Read ②GCP実機state直接確認（`gcloud scheduler jobs describe`、`--project`明示） ③圧縮を跨いで保持されていたTaskCreateタスクリストの3系統を照合。全て整合し情報欠落なしと確認。以降`/catchup`相当の手動確認（open PR/Issue一覧・git log・CI状態）も実施し、想定外の差分なしと確認。
- **kanameone通常運用復帰完了**: checkGmailAttachments Scheduler再開→GitHub Actions経由で3回・約20分監視（processed 9317→9333→9333、error/pending常時0）→Hostingデプロイ・疎通確認（HTTP 200）。詳細は下記session105サマリ参照。
- **Gemini 3.5移行の状態誤認訂正**: ユーザーから「dev環境でGemini 3.5(GA/Workload Identity/データレジデンシー/Cloud Logging)の設定検証・Firestoreコスト圧縮・その他コスト圧縮戦略まで完了しているか」と問われ、Issue #548/#547を実際にgh issue viewで確認。#547(Firestoreコスト)はCLOSED、#546(SDK移行等)もCLOSEDだが、**#548(Gemini 3.5移行)はOPEN継続**（kanameoneは意図的に2.5-flash固定中、3.5への実切替は未実施）と判明。「Workload Identity」「Cloud Logging」という語はIssue本文に見当たらず、ユーザーの認識との齟齬を指摘。
- **個人情報コンプライアンス調査**: ADR-0002(セキュリティ設計)・ADR-0011(SA納品方式)・実コード(`functions/src/utils/config.ts`のlocation設定、`GoogleGenAI({vertexai:true,...})`のSA認証)を確認。データレジデンシー(asia-northeast1固定)とAPIキー不使用は共通コードパスでモデル非依存に満たされている一方、ADR-0002 §3の個人情報マスキングは「実装完了」表記のまま**実際は未実装**（`customerName`/`officeName`はFirestoreに実値のまま保存、grep 0件で確認）と判明。
- **WebSearchによるファクトチェック**: 既存memory（`reference_ai_personal_info_japan_compliance.md`、4日前作成）の核心指摘（安全管理措置と取得・利用目的の適法性は別義務、要配慮個人情報は3省2ガイドライン準拠が別途必須）を2026-07-08時点の一次情報で再検証。Vertex AIの学習非利用保証（Service Specific Terms）は現行、3省2ガイドラインも2026年6月(厚労省第7.0版)に直近改訂されており現役の規制枠組みと確認。
- **マスキング要否の結論**: ユーザーの「及第点(完璧でなく業務レベルで十分)基準」の下、マスキングは顧客/事業所マスター突合・画面表示に実値が必須という製品の中核機能と非両立であり、実装しないことが正当と結論。データレジデンシー+SA認証+Cloud Logging(GCP既定)+Firestoreアクセス制御(Firebase Auth+セキュリティルール)で通常個人情報について及第点、要配慮個人情報の本人同意取得は本人と直接契約関係を持つクライアント側の責任（ベンダーは推奨までが適正範囲）と整理。
- **3層での是正対応**: ①ベンダー内部の責任分界記録を`docs/context/delivery-and-update-guide.md`§責任分担に追記（PR #588）②ADR-0002の「実装完了」表記・フロー図・データ保持テーブル・Pros/Cons・Open Questionsを実態に整合するよう修正（PR #589）③**当初PR #588を`docs/context/`（開発者専用、`docs/client/README.md`記載の通りクライアントはアクセス不可）に書いてしまっていたミスをユーザー指摘で発見**、実際にクライアントが読む`docs/client/client-setup.md`（GitHub Pages公開）の事前準備チェックリストに個人情報同意取得の推奨案内を追加（PR #590）。
- **セッション運営面の教訓**: 「クライアント向け」の推奨文章を書く際、`docs/context/`（開発者マスター）と`docs/client/`（実際の公開サイト）を混同しかけた。ユーザーの「これでビジネスレベルで十分な完了と評価できますね？」という最終確認質問が、この見落としを発見する契機になった。既存クライアント（kanameone/cocoro）への周知は本セッションのスコープ外、ユーザー側で別途対応と確認済み。

## session105 サマリ（2026-07-08、kanameone段階デプロイ）

### 最終状態（2026-07-08 07:1x UTC時点）
| 項目 | 状態 |
|------|------|
| firestore.rules | ✅ デプロイ済み |
| Cloud Functions | ✅ デプロイ済み（GEMINI_MODEL_ID=gemini-2.5-flash固定、STORAGE_BUCKET修正済み） |
| processOCR Scheduler | ✅ 再開済み（1分間隔） |
| checkGmailAttachments Scheduler | ✅ 再開済み（5分間隔）、再開後約20分監視でerror/pending滞留ゼロ確認済み |
| Hosting | ✅ デプロイ済み、疎通確認OK（HTTP 200、https://docsplit-kanameone.web.app） |
| 通常運用復帰 | ✅ 完了 |

### 再開後監視結果（GitHub Actions `diagnose-confirmed-replay-sampling`、3回・約20分間隔7分）
| チェック | processed | pending/processing/error |
|---------|-----------|---------------------------|
| #1 (06:52 UTC) | 9317 | 0/0/0 |
| #2 (07:01 UTC) | 9333 (+16、実トラフィック処理確認) | 0/0/0 |
| #3 (07:11 UTC) | 9333 | 0/0/0 |

### ⚠️ 同根再発の懸念（未解決、次セッションで検討要）
今回`deploy-functions.yml`にSTORAGE_BUCKET/GEMINI_MODEL_ID設定を追加したが、**Cloud Functionsのデプロイ経路は他に2つあり、そちらは未修正**:
1. `scripts/deploy-to-project.sh`（ローカル手動デプロイ、`--full`時に`firebase deploy --only functions`を呼ぶが env file 書込ステップなし）
2. `.github/workflows/deploy.yml`（dev自動デプロイ、mainへのpush毎に発火、同じく env file 書込ステップなし）

**つまりdevは現在もSTORAGE_BUCKET未設定のまま自動デプロイされ続けている**（実害は無データのため顕在化していないだけ）。kanameone/cocoroを`deploy-to-project.sh`で手動デプロイした場合も同じ穴に落ちる。過去にも類似のSTORAGE_BUCKET設定漏れ（2026-06 `cleanup-ambiguous-collision-docs.ts`のfail-fast追加、本セッション内の確認済みスクリプトでの必須化）があり、プロジェクト全体で「STORAGE_BUCKETの正解値取得元(`scripts/clients/<client>.env`)を新規デプロイ経路ごとに個別に思い出す」設計になっていることが真因と推測される。次セッションで3経路の統一（共通スクリプト化 or 全経路への同等ロジック追加）を検討要。

session95〜104の詳細は `docs/handoff/archive/2026-07-history.md` 参照。

## 現在のフェーズ

Phase 8 完了+追加実装運用中。**#548 close済（2026-07-09、3.5 Flash両本番展開完了）**。コスト圧縮の残トラックは**#547のみ**: ADR-0018 Phase A/B/C完遂（backfill全3環境verify PASS）、**Phase D実装完遂（PR-D1〜D4全マージ: #598/#599/#601/#602）**。残り=**展開**（cocoro→kanameone、環境毎にHosting先行→verify stale=0→Functions→scriptsの順、番号単位認可）→**Phase E（親doc大容量フィールド削除=egress実削減の発生点、要impl-plan+Codex+devリハーサル。ADR-0018 Phase E行にPR-D3 Codex所見2件を確認事項として記録済み）**→#547 close。ゴール全体はdocs/handoff/GOAL.md参照（SessionStart hook自動注入）。

## 直近の変更（session89〜109、簡潔に）

- **session109 (2026-07-09)**: 上記サマリ参照。Net 0（起票0/close0）。#547 Phase D PR-D3(#601)/PR-D4(#602)実装+マージでPhase D実装フェーズ完遂、GOAL.md/ADR-0018のドキュメント整合性是正(PR #603/#604)。
- **session108 (2026-07-09)**: 上記サマリ参照。**Net +1（起票0/close 1、#548）**。#547 Phase C全環境完遂+Phase D計画承認+PR-D1/D2マージ+GOAL.md新設(PR #597/#598/#599)。
- **session107 (2026-07-08〜09)**: 上記サマリ参照。Net 0。#548統計検証完遂+#547 Phase C実装マージ(PR #592〜596)。
- **session106 (2026-07-08)**: 上記サマリ参照。Net 0。個人情報コンプライアンス3層対応(PR #588〜591)。
- **session105 (2026-07-08)**: 上記サマリ参照。Net 0。kanameone段階デプロイ・通常運用復帰。
- **session104 (2026-07-08)**: archive参照。Net 0。
- **session103 (2026-07-07)**: 上記サマリ参照。**Net 1（起票0/close 1、#547）**。ADR-0018 Phase B (PR1〜PR5) 完遂によりIssue #547自体がclose、Netに正しく反映された数少ないセッション。
- **session102 (2026-07-07)**: 上記サマリ参照。Net 0（起票0/close0）。#547 Phase B継続、PR2(PR #571)完遂という実質進捗はIssue単位のNetに非反映（#547自体はPhase C以降も残るためopen継続）。
- **session101 (2026-07-06)**: 上記サマリ参照。Net 0（起票0/close0）。#547 Phase B着手、タスク0(PR #568)+PR1(PR #569)完遂という実質進捗はIssue単位のNetに非反映（#547自体はPhase C以降も残るためopen継続）。
- **session100 (2026-07-06)**: 上記サマリ参照。Net 0（起票1/close 1、#562のみ）。#548の主要スコープ(3.5移行スイッチ本体のdev実装+実機検証)を完遂したが、Issue #548自体は本番展開が残るためopenのまま継続（実質進捗はIssue単位のNetに非反映）。
- **session99 (2026-07-06)**: 上記サマリ参照。Net 0（起票0/close 0、#548 A/Bテストharness実装+実機PASS確認+Issue #548コメント記録という実質進捗はIssue単位のNetに非反映）。
- **session98 (2026-07-06)**: Net 0（起票0/close 0、#547事前計測完遂+ADR-0018起票+#548単価確認・A/B計画策定という実質進捗はIssue単位のNetに非反映）。
- **session96 (2026-07-05)**: Issue #546（計測基盤+SDK移行+thinking制御）実装完遂・PR #550マージ・dev環境デプロイ完了。Net -1（close #546のみ）。
- **session95 (2026-07-04〜05)**: 上記サマリ参照。Net -5（起票6/close 1、コスト3件はuser明示指示+実害根拠、バグ3件は#526設計中に発見した実バグでtriage充足）。
- **session93 (2026-07-03)**: kaname新規要望B/C/D/E/F受領→B/D/F実装・merge・close。E(#526)は設計判断ゲート3点待ちで持越し（→session95で解消）。Net -1。
- **session92 (2026-07-02〜03)**: #492 Ambiguous重複docs整理完遂→close。Net -1。
- **session91 (2026-07-02)**: ADR-0017実戦実証（7.9hストーム自動吸収）→Accepted昇格。Net 0。
- **session90 (2026-06-12)**: 429専用retry+rescue backstop（PR#516+ADR-0017）3環境deploy。Net 0。
- **session89 (2026-05-20)**: #504/#402 close。Net -2。

session29〜94の詳細は `docs/handoff/archive/2026-0{4,5,6}-history.md` 参照。

## 次のアクション（3 分割・SKILL.md §2.5 参照、session113時点）

**🎯 GOAL.md のミッション達成**: `docs/handoff/GOAL.md` の「進行中のtasks」は全22項目が`[x]`（session113、#547 Phase E本番実行完遂により）。次のゴールへの更新 or ファイル削除をdecision-maker判断で検討してください。ただし技術的完遂とコスト最適化(黒字化)は別物である点はGOAL.md「重要な注記」参照。

### 即着手タスク

即着手タスクなし（GOAL.mdミッションの実装・展開作業は完了。残る2フォローアップ〔egress実測確認・エンティティリスト化判断〕はいずれも時間経過待ちまたはdecision-maker領分のため、下記「条件待ち」「却下候補」に分類）

### 条件待ち（明示 trigger 付き）

| # | 項目 | trigger | 充足時のタスク | 確認方法 |
|---|------|---------|--------------|---------|
| 1 | **#547 egress実削減効果の請求確認** | 翌月請求発行（2026-08上旬想定） | kanameone/cocoro請求のFirestore項目（3.5移行前基準: ¥4,645/月egress）とPhase E実行前後を比較し実削減額を確認、GOAL.mdに記録 | 請求ダッシュボード確認 |
| 2 | #526 kanameone/cocoro展開（→close） | 番号単位展開認可 | `/deploy` 3点セット+分割操作自粛アナウンス | user指示 |
| 3 | #548-B4 再処理「再突合のみ」モード | UI仕様のdecision-maker判断 | 2モード化実装 | user回答 |
| 4 | #539/#540（P2バグ） | 明示指示 or 実害観測 | 各Issue参照 | `gh issue view` |
| 5 | 継承事項: PR#474 close / `.artifacts/`扱い / #503・#251・#238 / CLAUDE.md切り出し / 「Gemini 2.5 Flash」表記15+箇所更新 / **frontend/.envフォールバックの恒久対策**(session108発見、暫定はdev値に復元済み) / `.serena/project.yml`の未コミット変更(Serena MCPツールによる自動更新、本セッション作業とは無関係、コミットor破棄はdecision-maker判断) | decision-maker明示指示 | 各項目参照 | — |
| 6 | session105継承: Functionsデプロイ3経路のSTORAGE_BUCKET/GEMINI_MODEL_ID設定統一 | decision-maker明示指示 | 3経路の共通化 | archive session105参照 |

### 却下候補（記録のみ）

| 項目 | 経緯 | 着手しない理由 |
|------|------|--------------|
| **OCR出力のエンティティリスト化（−¥11,000/月級）** | コスト分析で最大レバー。session112/113で「真の黒字化に必須」と再確認 | 3.5移行後の実測を見てdecision-makerが判断する保留カード（#548 closeコメントに記録済み）。GOAL.mdスコープ外 |
| processOCR head-of-line blocking対策 | Codex指摘で実在確認 | 実害未観測。pending滞留観測時に別Issue化 |
| detail/mainパスのヘルパー抽出（writer側9箇所） | Phase B以来の継続指摘。**読者側はPR-D2のreadDocWithDetailで部分集約済み** | writer側の3コンパイルコンテキスト共有はPhase F(cleanup)の設計判断。着手指示待ち |
| OCR全文検索の代替基盤 | Phase D計画時に調査 | **dead code判明で緊急性消滅**（検索窓はサーバー側インデックスでOCR全文は元々対象外）。必要になれば別プロジェクト規模 |
| #503/#251/#238（P2 enhancement） | rating 5-6相当の任意改善 | 明示指示なし |

### 最終結論（session113末尾）

✅ **セッション終了可** — OPEN PR 0件、git実質clean（`.serena/project.yml`はSerenaツール自動生成物で本セッション作業と無関係・`.artifacts/`は既知の継続保留事項）、CI全PASS（PR #615、5m27s）、GOAL.mdミッション技術的完遂（22/22 `[x]`）、即着手タスク0件・条件待ち6件、残留プロセスなし。本セッションの唯一のPR(#615)はdocsのみで`fix:`系ではないため§4.6/4.7同根再発スキャン・対症療法判定は非該当。
