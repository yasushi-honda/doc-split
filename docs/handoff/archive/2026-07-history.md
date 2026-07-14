# 2026-07 セッション履歴アーカイブ

LATEST.md 60KB超過に伴い session95〜104 の詳細サマリを移動（2026-07-09 session108 handoff時）。


LATEST.md 60KB超過に伴い session105〜110 の詳細サマリを追加移動（2026-07-12 session118 handoff時）。


LATEST.md 60KB超過に伴い session112〜113 の詳細サマリを追加移動（2026-07-14 session128 handoff時）。


LATEST.md 60KB超過に伴い、GOAL.mdミッション交代（OCR突合精度向上→担当CM別集計バグ修正）で退避した旧ミッション全文（session121〜125相当）を追加移動（2026-07-14 session129 handoff時）。


LATEST.md 60KB超過に伴い session114 の詳細サマリを追加移動（2026-07-14 session130 handoff時）。

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

**7月1-9日請求（GCP Billing Cloud Assist機能）**: Vertex AI ¥3,094（前期間比+8%のみ）、Firestore egress +825%。ここで重要な気づき: **この期間はほぼ全て「移行前」の実態である**。kanameoneの3.5移行完了は07-09、Phase E本体（Firestore削減効果）完了は07-10で、いずれもこの集計期間の最終日かその翌日。Vertex AIが+8%しか増えていないのは当然の結果。Firestore egressの+825%急増は、Phase C(backfill)・Phase D(dual-read検証)という移行作業自体が生んだ一時的read負荷と推定（Phase E本体の削減効果はまだこの期間に反映されていない）。

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

## 旧ミッション: OCR突合精度向上（session121〜125、2026-07-14 session129でGOAL.mdから退避・アーカイブ）

<!-- 元はdocs/handoff/GOAL.mdの「現在のミッション」〜「監視・確認事項」。新ミッション(担当CM別集計バグ修正)への交代に伴いLATEST.md session129経由で本アーカイブに移動。 -->

### 現在のミッション（旧）
**クローズ済み（2026-07-14 session125、撤退基準適用）**: OCR突合（documentType/customerName/officeName/date）の精度向上のため、Geminiに文書内の候補テキストを独立呼出しで抽出させ、既存のマスター突合ロジック（`extractors.ts`）と保守的arbitrationで統合する。dev環境でA/B検証を固め、精度が現行を下回らないことを確認できた場合のみkanameone→cocoro本番展開する予定だったが、taskI(下記)の判断によりkanameone/cocoro本番展開は見送り、dev環境検証完了（タスクF/G、N=10・4項目100%一致）+ kanameone customer/office限定検証（タスクH、N=12・PASSだが4項目AC未達）までを最終到達点としてミッションを終了する。

### 背景・why（旧）
- 前身のIssue #548「保留カード」（OCR全文転記→エンティティリスト化、コスト削減目的、−¥11,000/月級と試算）を技術検証した結果、保守的スコープ（PDF分割検出・全文表示・要約生成を維持）ではコスト削減効果はほぼ見込めないと判明し、目的を「突合精度向上」に再定義（decision-maker合意、session121）
- Codexセカンドオピニオン（plan mode、session121）で2点の重大な指摘を受け計画に反映済み:
  1. 全文転記とエンティティ抽出を同一Gemini呼出しにすると、PDF分割検出・全文表示・要約生成への「影響ゼロ」という前提が崩れる → **候補抽出を別呼出しに分離**（既存`ocrWithGemini()`は無改修、pageText結合テキストを入力とする新規呼出しを追加）
  2. best-of選択（スコアが高い方を無条件採用）は、誤った候補が偶然マスターと完全一致した場合に正しい既存結果を上書きするリスクがある → **保守的arbitration**（同点は全文系優先、候補はpageText内への逐語的存在確認=grounding必須、日付は種別・根拠込みで特別扱い）
- 不変条件（絶対）: 突合の精度劣化は一切禁止。候補抽出呼出しが失敗しても既存の全文ベース突合にフォールバックし、本体OCR処理は絶対にブロックしない

### 完了の定義（旧）
- 候補抽出呼出しの追加が既存`ocrWithGemini()`/pageResults保存処理を一切変更しない（証明: git diffで`functions/src/ocr/ocrProcessor.ts`の既存OCR部分が無改修であることを確認）
- 新ロジックが既存`extractDocumentTypeEnhanced`等のシグネチャを破壊しない（証明: `cd functions && npm test`で既存テスト全PASS）
- 候補抽出呼出しが失敗/タイムアウト/スキーマ逸脱しても既存の全文ベース突合で処理継続する（証明: 単体テストで候補抽出例外ケースを追加しPASS）
- arbitrationが「同点は全文系優先」「grounding必須」「日付は種別・根拠込みで判定」を満たす（証明: 単体テストで誤マスター一致による上書きシナリオを再現し防止できることを確認）
- dev環境A/Bテストで書類種別/顧客/事業所/日付の4項目とも精度が現行を下回らない（証明: 拡張版`compare-gemini-ocr-models-confirmed.ts`相当のdev実行結果）
- kanameone confirmed-replay検証（顧客/事業所は既存実データ、書類種別/日付は新規人手ラベル評価セット）で4項目とも精度が現行同等以上（証明: GitHub Actions実行ログ、read-only）
- 出力トークン増分・コスト増が実測・可視化されている（証明: A/Bハーネスのトークン計測ログ）
- 本番展開後、kanameone/cocoro双方でエラー率が展開前と同水準（証明: `fix-stuck-documents --include-errors --dry-run`でエラー0件）
- 不変条件: 上記いずれかのACが未達の場合、無理に本番展開しない（dev検証止まりで完了とする撤退基準）→ **2026-07-14 session125、本条件が発動しミッションをクローズ**（kanameone confirmed-replay検証のAC=4項目同等以上が未達=customer/office 2項目のみ実施のため。詳細はタスクI参照）

### 進行中のtasks（旧、全完了・クローズ）
- [x] A. 候補抽出用・第2Gemini呼出しのスパイク（完了、2026-07-13 session121）— `scripts/spike-candidate-extraction.ts`実装、GitHub Actions経由でdev環境実行。結果: 11/11ページ成功・JSON解析失敗0件、grounding率93〜95%(2回実行)、プロンプトインジェクション耐性PASS(2回)、候補抽出呼出し1回あたり概算$0.004(N=11件で$0.044〜0.047)。**重要な発見**: not-grounded事例は「別の妥当な値」ではなく候補抽出呼出し自体の文字レベル転記誤り(「請求書」→「舅求書」等)。Codex指摘のgrounding必須arbitrationが実害を防ぐことを実証。**既知の限界（タスクBで対応）**: Codexセカンドオピニオン(review-diff、1回目)指摘により、本スパイクは**ページ単位**で候補抽出を検証しており、計画上のタスクB実装（**ドキュメント単位**で結合pageTextを1回で処理）とは呼出し粒度が異なる。複数ページ文書の結合テキストでの本番想定プロンプトサイズ・トークンコスト・クロスページの候補選択挙動は未検証のため、タスクB実装時に改めてドキュメント単位での実測を行う。**既知の限界（本スクリプト単独ではスコープ外）**: Codexセカンドオピニオン(review、2回目)指摘により、`ocrPageVerbatim()`の異常応答検知ロジック(`response.candidates?.[0]?.finishReason`/`promptFeedback?.blockReason`ベース)は、zero-candidate応答(candidates配列が空でblockReason/finishReasonも両方undefined)を検知できないギャップがある。このロジックは`scripts/compare-gemini-ocr-models.ts`の`ocrPage()`から複製したもので、既存スクリプトにも同じギャップが存在する（本PRのスコープ外、修正する場合は既存スクリプト側の改修として別途decision-maker判断が必要）
- [x] B. 候補抽出呼出し実装（完了、2026-07-13 session121）— `functions/src/ocr/ocrProcessor.ts`に`extractOcrCandidates(ocrResult, documentId?)`を新規追加（既存`ocrWithGemini()`は無改修、独立した第2Gemini呼出し）。候補抽出はbest-effort設計でAPI失敗/JSON解析失敗時は例外を投げず4項目全nullを返す。**タスクAの既知の限界（ページ単位検証と本番ドキュメント単位実装の粒度乖離）を解消**: `scripts/verify-candidate-extraction-document-level.ts`で実装済み関数を直接import(再実装ではない)しdev環境で実機検証、複数ページ結合テキスト(5-6ページ、662/579文字)で2/2成功・grounding8/8(100%、2回目実行では6/8=75%で「訪問看護報告書」→「舖商看艷報告昸」等のより激しい文字化けも観測、grounding必須arbitrationの必要性を追加裏付け)・ドキュメント単位1回あたり概算$0.0052〜0.0038を確認。`/safe-refactor`(DRY違反=`ocrPageVerbatim`重複を`scripts/lib/geminiOcrCompare.ts`の`ocrPageWithAnomalyDetection()`へ統合、共有可変オブジェクト参照リスク=スプレッドコピー化)、`/code-review medium`(8角度finder+1票検証、CONFIRMED 3件を修正: safeLogError未使用→追加・`documentId`引数追加、型重複→`Pick<OcrCandidateExtractionResult,...>`化、dev-guard重複→現状維持)を実施。functions側テスト1,735 passing・lint 0 errors
  - **タスクC以降で対応する既知の限界（PLAUSIBLE判定4件、`/code-review medium`で検出・decision-maker判断によりdefer）**:
    1. `ocrPageWithAnomalyDetection()`/`extractOcrCandidates()`とも`finishReason==='MAX_TOKENS'`による部分打切りを異常検知できない（`!response.text`の場合のみ検査、非空だが不完全なテキストは素通り）。特に`extractOcrCandidates()`は`finishReason`検査が一切ない
    2. `extractOcrCandidates()`が毎回`new GoogleGenAI()`を構築(`ocrPageWithAnomalyDetection()`は呼出元から`ai`を受け取る設計と不統一、レート制限バイパスにはならないが認証コストの無駄)
    3. `candidateSchema`/`buildCandidateExtractionPrompt`が`scripts/spike-candidate-extraction.ts`と重複(コードベース既存の「複製+同期コメント」パターンの延長)
    4. `usageMetadata`からのトークン集計パターンが6箇所に重複(SDKフィールドアクセスのボイラープレート、リスク低)
  - `/review-pr`(4エージェント並列: code-reviewer/comment-analyzer/silent-failure-hunter/type-design-analyzer)+ `/codex review`セカンドオピニオンも実施。Codexの唯一の指摘(P1「PROJECT_ID未伝播で全候補抽出呼出しが失敗」)は**REFUTED**: `google-github-actions/auth@v2`の`export_environment_variables: true`設定によりジョブ全体に`GCLOUD_PROJECT`/`GOOGLE_CLOUD_PROJECT`が自動エクスポートされることを実行ログで確認、実際の複数回成功実行(実測トークン数あり)とも整合。review-pr新規指摘のうちCONFIRMED相当3件は修正済み(本番コードのGOAL.mdタスク参照コメントをインライン化=将来のミッション圧縮でダングリング参照化するリスクを解消、プロンプト文言「同一」主張の事実誤認を訂正、JSON.parse成功後の型ガード追加でouter catchによるエラー誤分類=`apiCallError`と`jsonParseError`の取り違えを解消)
  - **タスクC以降で対応する既知の限界（追加、review-pr検出）**:
    5. `scripts/verify-candidate-extraction-document-level.ts:83`が`ocrProcessor.ts:331-333`という行番号を直接コメントで参照。将来ocrProcessor.ts上部が変更されるとサイレントに古びる(comment-analyzer指摘、優先度低)
    6. `inputTokens`/`outputTokens`/`thinkingTokens`のトークン3つ組が`OcrProcessingResult`/`OcrCandidateExtractionResult`/`OcrPageResult`の3箇所で重複定義。共通サブ型への切り出しが可能(type-design-analyzer指摘、低リスクDRY改善)
    7. Evaluator分離プロトコル(`rules/quality-gate.md`、5ファイル+新機能で発動条件)が本PRでは未実施(code-reviewer指摘、プロセス確認事項としてdecision-maker判断待ち)
- [x] C. `extractors.ts`拡張 + 保守的arbitration実装（完了、2026-07-14 session122）— `functions/src/utils/extractors.ts`に`arbitrateDocumentType`/`arbitrateOfficeName`/`arbitrateCustomerName`/`arbitrateDate`を新規追加（既存4関数は無改修）。設計はCodexセカンドオピニオン(plan mode)反映: 既存が何らかのマッチ済みなら候補がどれだけ高スコアでも上書きしない、昇格対象は候補を既存関数へ再入力しexact matchの場合のみに限定、候補はOCR全文へのgrounding(逐語一致)必須。「弱い根拠」判定はdecision-maker選択により最も保守的な値(documentType: matchType==='none'のみ/officeName・customerName: bestMatch===nullのみ/date: date===nullのみ)を採用。`/code-review medium`(8角度finder+1票検証)でCONFIRMED 5件検出・修正: isGroundedInTextに最小長ガード追加(短い候補の誤昇格を実機再現・修正)、arbitrateDocumentTypeに既存searchRange=300制約を適用、documentType/customerNameのexact-match昇格に#501対策(computeCommonShortMasters)を適用しoffice系との非対称性を解消、arbitrateDateに全角→半角変換を追加(全角日付が機能しないバグを修正)、日付フォーマット処理を既存formatDateStringヘルパーに統一。functions側テスト1,760 passing・lint 0 errors。PR #643。
  - **タスクD以降で対応する既知の限界（Codexセカンドオピニオン`/codex review-diff`検出、P1、decision-maker判断によりタスクGで実測してから判断）**: documentType/officeName/customerName/dateいずれも、「候補がgroundingされ、かつ候補単体の再照合でexact match」という昇格条件は、部分文字列包含関係の推移律により「既存の全文ベース抽出でも同じマッチが既に見つかっているはず」という関係と論理的に重なる。特にdocumentTypeは今回のsearchRange制約追加によりこの関係がより厳密に成立するため、候補側への昇格が実質的にほぼ発生しない(no-op化する)可能性がある。精度劣化はしない(不変条件維持)が、期待する精度向上効果も出ない可能性がある。タスクF/GのA/Bテストで実際の昇格頻度・効果を実測し、無意味と判明した場合は昇格条件（exact限定の緩和・searchRange制約の見直し等）を再設計する
- [x] D. `processDocument()`統合（完了、2026-07-14 session123）— `functions/src/ocr/ocrProcessor.ts`の`processDocument()`に`extractOcrCandidates()`(タスクB)+`arbitrateDocumentType`/`arbitrateCustomerName`/`arbitrateOfficeName`/`arbitrateDate`(タスクC)を統合。既存の全文ベース抽出結果を無条件に上書きしない設計を維持し、dateMarker解決はarbitration後のdocumentType結果を参照するよう順序調整（候補昇格時にdateMarkerも追従）。候補抽出呼出しのトークンを`totalInputTokens`等へ加算し`trackGeminiUsage`経由の本番コスト計測に反映。契約テスト(`ocrProcessorCandidateArbitrationWiringContract.test.ts`)で配線をlock-in。functions側テスト1,770 passing・lint/tsc 0 errors。`/code-review low`+独立evaluatorエージェント(前提知識なし、AC 10項目個別検証)で全PASS確認済み(HIGH/MEDIUM指摘0件)。PR #644作成・マージ済み(main→dev自動デプロイCI/Deploy workflow両方SUCCESS確認済み、kanameone/cocoroには未反映)。PR上のCodeRabbit指摘(「既存4項目全マッチ時はextractOcrCandidates呼出しが無駄コスト」)は検証の上正当と判断、decision-maker判断で現状PRのままマージ・最適化は別対応で保留。
- [ ] E. 単体テスト追加（extractors.ts新関数・arbitrationロジック・フォールバックケース、C,Dに依存）— **状況(2026-07-14 session123)**: arbitrate*関数のunit testはタスクCで既に追加済み(null候補フォールバックケース含む)、processDocument()統合の配線契約テストはタスクDで追加済み。残りうるスコープは`extractOcrCandidates()`自体のAPI例外/JSON解析失敗パスのmock unit test(現状はタスクA/Bの実機検証のみでカバー、Vertex AI依存のためlocal unit test化は別途モック設計が必要)。decision-maker判断で「実質完了」とみなすか、専用mock testを追加するか要確認
- [x] F. A/Bテストハーネス拡張（完了、2026-07-14 session123）— `scripts/compare-ocr-arbitration-logic.ts`新規追加。既存`compare-gemini-ocr-models.ts`(モデルA/B比較用、gemini-2.5 vs 3.5)とは軸が異なる「ロジックA/B比較」(同一モデルでbaseline=既存抽出のみ/candidate=候補抽出+arbitration統合後)として、documentType/customerName/officeName/dateの4項目全gate化。既存`seed-dev-data.ts`のMIXED_FAX_PDFSを読み取り専用で再利用(日単位ground truthを持つ3segment、「提供月」表記のみの2segmentは日付評価不可のため対象外)し、複数人名/複数日付の層化用に新規フィクスチャ2件(`scripts/fixtures/arbitrationCompareFixtures.ts`)を追加(`seed-dev-data.ts`自体は無改修で副作用回避)。「手書き」原稿は合成PDFでは再現不可のため既知の限界としてスコープ外(decision-maker判断で必要になれば別途実スキャン素材を検討)。**GitHub Actions実機実行結果(doc-split-dev、run ID 29290104624)**: baseline 5/5文書・4項目全100%一致、candidate 5/5文書・4項目全100%一致(複数人名/複数日付distractorを含む5文書全てで精度劣化なし)、候補抽出grounding失敗率10.0%(非null候補20件中2件not-grounded、arbitrationの保守的設計により誤昇格には至らず)、候補抽出トークン増分input=2837/output=515/thinking=1322(5文書で概算$0.0208)。N=5のためdev一次スクリーニング止まり(タスクG本実行で追加検証)。scripts側テスト84 passing。独立evaluatorエージェントでAC 10項目全PASS確認済み。
  - **タスクG以降への申し送り(evaluator指摘、LOW、AC対象外)**: `provenance`(既存/候補どちらの経路で解決したか)は`buildOcrExtractionUpdatePayload`の入力型に含まれず本番Firestoreへ永続化されない。本番でのarbitration有効性・grounding失敗率の継続観測が必要になった場合、別途observability追加を検討
- [x] G. dev環境A/Bテスト実行（完了、2026-07-14 session124）— 対象文書数拡大の手段はdev環境に実運用データが存在しないため「既存フィクスチャ追加」一択と判断（軽量プラン提示→承認待ちなしで着手）。`scripts/fixtures/arbitrationCompareFixtures.ts`のARBITRATION_DISTRACTOR_DOCSに新規5文書を追加しN=5→N=10へ拡大（CUSTOMERS未使用6名を使用、通常ケース=distractorなし2件+複数人名/複数日付バリエーション追加1件ずつ+全角日付表記1件でタスクCの全角→半角変換修正の回帰確認も兼ねる）。feature branch(`feat/ocr-arbitration-taskg-fixtures`)を切りGitHub Actions "Run Operations Script"(environment: dev、script: compare-ocr-arbitration-logic)で実行(run 29294375536)。**結果**: baseline/candidate両方 4項目全一致 10/10(100.0%)、精度劣化なし・失敗率ゲート内で✅PASS。候補抽出grounding失敗率7.5%(非null候補40件中3件not-grounded、タスクFのN=5時点10.0%と同水準)。候補抽出トークン増分input=5393/output=910/thinking=3032(概算$0.043568、N=5時点比でほぼ線形にスケール)。N=10でも再現性を確認。PR #646作成・code-review low(指摘0件)実施の上マージ済み(main反映済み)。
- [x] H. kanameone confirmed-replay検証（read-only、完了、2026-07-14 session124）— documentType/dateはkanameone実データにconfirmed相当のground truthが存在しない(documentTypeConfirmedはIssue #526本番未展開により実運用0件、dateには確定フラグ概念自体が不在)ため、新規人手ラベル評価セット作成を見送り**customer/office先行検証のみ実施**する決定(decision-maker選択)。新規スクリプト`scripts/compare-ocr-arbitration-logic-confirmed.ts`+`scripts/lib/confirmedArbitrationStats.ts`を追加。既存`compare-gemini-ocr-models-confirmed.ts`のサンプリング/read-only/個人情報保護パターンと`compare-ocr-arbitration-logic.ts`のbaseline/candidateロジック計算パターンを組合せ。**read-only厳守のため候補抽出ロジックを独立実装**: 本番`extractOcrCandidates()`は異常系で`safeLogError()`経由のFirestore書込みが発生するため直接呼ばず、`compare-gemini-ocr-models-confirmed.ts`が`loadMasterData.ts`について同じ理由で独立実装している既存パターンを踏襲。`/code-review medium`(8角度finder+1票検証)でCONFIRMED 2件検出・修正(try/catch欠落によりprocessOneDocument()の1文書失敗がjob全体をクラッシュさせる経路があった=`success`常時trueで失敗率ゲートも機能せず、confirmedReplayStats.tsが記録する既知バグクラスの再発／computeArbitrationMatchRate等の重複実装を既存関数の再利用に置換)、PLAUSIBLE 2件修正。`confirmedArbitrationStats.test.ts`新規追加(scripts側テスト94 passing)。functions側テスト1,770 passing・lint 0 errors。PR #647作成・マージ済み。**GitHub Actions実機実行結果(docsplit-kanameone)**: pilot(`--limit 30`)でサンプリングN=2(歩留まり1.3%相当の既知の制約、compare-gemini-ocr-models-confirmed.ts冒頭コメント参照)、本実行(`--limit 300`)でもサンプリングN=12(母集団上限に到達、これ以上サンプル数は増えない)。**結果**: baseline/candidate完全同一(顧客33.3%=4/12、事業所41.7%=5/12、確定2項目一致33.3%=4/12)で✅PASS(精度劣化なし)。候補抽出grounding失敗率0.0%(非null候補36件中0件not-grounded)。候補抽出トークン増分input=22346/output=830/thinking=567(概算$0.046092)。**重要な限界**: 母集団自体がN=12と極めて小さく統計的信頼性は限定的(rule of threeで劣化率上限を強く保証できない)。またbaseline自体の一致率が33.3%/41.7%と低い点は、本ミッション(candidateロジックがbaselineを下回らないことの検証)の範囲外の別問題の可能性がある(confirmedBy確定後のマスターデータ変更・表記揺れ等が疑われるが未調査、decision-maker判断で別途調査するか判断が必要)
- [x] I. prod展開判断: **見送り（decision-maker最終判断、2026-07-14 session125）**— `/codex plan`セカンドオピニオン(MCP、effort=high)を実施した上での判断。Codex指摘(High 4件): ①GOAL.md完了の定義は4項目(documentType/customerName/officeName/date)同等以上を要求するが実施できたのはcustomer/officeの2項目のみで「4項目ACの代替にならない」②タスクHの「baseline/candidate完全同一」は集計がjoint一致率のみのため、文書単位の入れ替わり(baseline正→candidate誤とその逆)が相殺されてもPASSに見える構造で「無劣化の完全証明ではない」③N=12・回帰0件はrule of threeで真の回帰率の95%信頼上限が約25%相当、強い安全性保証にはならない④baseline自体の低一致率(顧客33.3%/事業所41.7%)を原因不明のまま展開すると改善効果を測れず既存の根本問題も温存する。Claude側の独立評価も指摘①〜④に同意(指摘②は個人情報保護のため個別文書結果を非出力とした設計上、事後検証不能な点も含め見落としていた観点)。decision-maker最終判断（session125）: 「品質は下げない、コスト圧縮は目指す、不安定さ・不十分さがあれば基本はしない選択をする」という原則を明示され、GOAL.md不変条件の撤退基準（AC未達時は無理に本番展開しない）を適用してミッションをクローズ。Codex提案のb(N=12不一致の原因分析)/c(追加人手ラベリングによるN拡大、約60件試算)は、いずれも新規の人手作業設計を要し「不安定さの解消に無理をしない」方針と整合しないため見送り。タスクA〜D実装（`extractOcrCandidates`/`arbitrateDocumentType`等）はマージ済みかつdev環境で動作確認済みのためrevertはしない（実害なし、将来baseline低精度の原因究明や再検証の土台として保持）。kanameone/cocoroへの展開は行わない。

### 監視・確認事項（旧、前ミッション#547/#548から継続、新ミッションでも引き続き有効。項目自体はdocs/handoff/GOAL.mdにも残置）
- egress実削減効果の翌月請求での実測確認（未実施。8月上旬の7月分請求書で確認）
- #548試算（全対策後¥23,000/月）の実額最終確認（実額は7月分請求書確定後）
- 【重要な発見、2026-07-14 session126】kanameone 7月請求のFirestore egress急増(+797%、月間予測が6月比約2.4倍に悪化)の原因を特定・記録: decision-maker提供のGCP Billing Console画像から、egressの82.6%（¥2,692/¥3,258）が7/9単日に集中していることを確認。GitHub Actions実行ログを追跡し、7/9 00:24 UTCに実行された`backfill-detail-subcollection --execute`（Phase C本番backfill、kanameone全9,388件）が原因と特定。`scripts/backfill-detail-subcollection.ts`の`backfillOneDoc()`は`detail/main`書込みに加え必ず親ドキュメント(`documents/{docId}`)も`tx.update()`するため、`onDocumentWrite`/`onDocumentWriteSearchIndex`の2トリガーを毎回発火させる設計と判明（7/9 UTC実測: 18,960回/15,848回発火）。この時点では対策(`isAggregationUnchanged`)がまだ存在せず、重フィールドが親に残った状態でbefore/afterペイロードが大量配信されたことがegress急増の直接原因と強く推定される。一過性の移行作業由来の副作用であり対策は既に本番投入済み、8月以降の再発は見込み低い。最終確認は7月分確定請求を待つ
- 【追加検証、2026-07-14 session127】Firestoreサイズ再計測+Gemini21日分実測でPhase E効果・コスト水準を直接確認: ドキュメント全体サイズ平均4,095B（事前計測比79.4%削減）、`ocrResult`/`pageResults`ともにpresent=0/300。Gemini単価倍率約5.17倍を再現確認、移行後絶対額は月間換算約$25。「2倍以内」達成確度を60-75%→80%程度に上方修正。最終確認は7月分確定請求を待つ
- 【追加検証②、2026-07-14 session128】Cloud Monitoring read_count実測+cocoro反映状況の直接確認: kanameoneで7/9=4,410,399回・7/10=2,568,891回（トリガーストーム集中）→7/11以降10〜18万回/日に収束、Billing Console実測と整合しトリガーストーム説を裏付け。cocoro環境でもPhase E完全機能・エラー0件・モデル移行反映を確認。コスト圧縮確度評価はkanameone基準80%程度で維持
- dev環境のテストデータ`phase-e-devcheck-001`/`phase-e-devcheck-002`の後片付け（任意）
- 前ミッション（#547/#548運用コスト圧縮2トラック）は2026-07-10技術完了・2026-07-12是正確認済み。詳細はgit history（`git log -p docs/handoff/GOAL.md`）およびdocs/handoff/archive参照
- （任意・着手指示なき限り不要）OCR突合精度向上ミッション（旧ミッション、タスクIで撤退）で未解明のまま残った「kanameone confirmed-replayでbaseline自体の一致率が33.3%/41.7%と低い」原因。将来的に興味を持った場合の起点はGOAL.mdタスクH/Iの記録（本アーカイブ内）、および`scripts/compare-ocr-arbitration-logic-confirmed.ts`

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


## session104 サマリ（2026-07-08）

- **背景**: 前セッションまでで#548(Gemini 3.5移行)はdev実装+実機検証完了(PR #561)、残るはkanameone/cocoro本番展開のみの状態だった。本セッションでユーザーから展開判断のセカンドオピニオンを求められ、Codex(plan mode)に相談したところ「n=11のA/Bテストは実運用判断の統計的根拠として不十分(rule of threeで劣化率上限27%までしか保証しない)」と指摘。より大規模な実データ検証が必要と判断し、追加検証スクリプトの実装に着手。
- **設計**: kanameone/cocoro本番の「確定済み文書」(`customerConfirmed`/`officeConfirmed`/`documentTypeConfirmed`が true)は既に人間検証済み(またはOCR高確信度自己判定済み)のground truthをFirestore上に持つため、新規ラベリングコストなしで大規模検証に転用できると気づき、この「confirmed replay方式」を`/impl-plan`で計画。
- **実装(`scripts/compare-gemini-ocr-models-confirmed.ts`新規)**: kanameone本番から確定済み文書をサンプリングし、元PDFを2.5-flash/3.5-flash両方で再OCRして精度・コスト・レイテンシを比較するread-onlyスクリプト。`scripts/lib/geminiOcrCompare.ts`を新規作成し既存devスクリプト(`compare-gemini-ocr-models.ts`)とモデル定義/プロンプト構築/PDFページ抽出を共通化(挙動不変、ts-node実行で回帰確認済み)。この共通化の過程で、新規スクリプトのOCRプロンプトが本番`ocrProcessor.ts`と異なる文言(余分なページ総数付与)になっていた実バグを発見・修正。
- **品質ゲート1: Codex review(`codex exec`、read-only保証+PII非出力の重点確認)**: 4件の実質指摘を検証の上修正。①リトライ時に共通retry(`withRetry`)が生エラーメッセージをログ出力しStorageパス(元アップロードファイル名を含みうる)経由でPII漏洩する経路があった→独自の`withSilentRetry()`(エラー内容非出力)に切替。②Gemini API最終失敗が「空文字+成功扱い」で集計され10%失敗率ゲートが機能しなかった→`ocrPage()`を最終失敗時throwに変更。③`admin.initializeApp()`にStorage bucket未設定でGitHub Actions実行時にPDF取得が失敗する可能性→`STORAGE_BUCKET`環境変数を必須化(CLAUDE.md「Storageバケット名」rule準拠)。④`customerConfirmed`/`officeConfirmed`はOCR自己判定でもtrueになりうり2.5-flash自己判定値をground truthにするとbaseline有利のラベルリークになる→`confirmedBy`/`officeConfirmedBy`が非nullの真に人間確定した文書のみに対象限定。
- **品質ゲート2: `/code-review medium`(8角度finder並列+1-vote verify)**: 8件検出、6件修正。判定ロジック(`regressed`)が絶対件数比較でモデル間の成功文書数が異なる場合に誤判定しうる問題→一致率比較に変更。2モデルの逐次処理→`Promise.all`で並行化(N=300規模での実行時間半減)。GoogleGenAIクライアントの600回再生成→1回生成し使い回し。PDF全体を2モデル分冗長パース→1文書1回に統一。未使用フィールド削除。型安全でない`.find()`パターン→named constants化。**あえて見送った2件**(共通`retry.ts`/`loadMasterData.ts`との重複解消): 本番Cloud Functions全体に影響する共有ファイル変更が必要でコストに見合わないと判断、docコメントで理由明記。
- **PR #577作成**: `feat/gemini-confirmed-replay-verification`ブランチで4ファイル(+816/-66)。作成直後、`post-pr-review.sh`hookが「large tier(4 files/882 lines)」と判定し、`/review-pr`(6エージェント並列)+`codex review`(セカンドオピニオン)をマージ前に必須と指示。本セッションでは未実施のため次セッション持越し。
- **セッション運営面**: ユーザーから「dev対策実装+検証クリアで本番反映段階」という認識を2度確認され、いずれも「今回のpilot実行は本番データを使った追加検証であって実際の3.5切替デプロイではない」「Firestore側(#547 Phase C以降)は今回無関係」と訂正。GitHub Issue #548のコメント欄が実装完了(PR #561)を反映しないまま止まっていたため、`gh issue view`だけに頼ると誤った現状認識に陥る点を`docs/handoff/LATEST.md`との突き合わせで発見・訂正した。

## session103 サマリ（2026-07-07）

- **Issue #547 ADR-0018 Phase B完遂（PR3〜PR5、5PR構成完了）**: 前セッションhandoffの即着手タスク3件を番号単位認可のもと順次実装・マージ。
  - **PR3: 削除同期改修（PR #573）**: `deleteDocument.ts`(db.batch化)/`cleanup-duplicates.js`(BATCH_SIZE 500→250)/`cleanup-ambiguous-collision-docs.ts`(detail/main削除追加)。`/code-review high`でCONFIRMED 1件（cleanup-ambiguous-collision-docs.tsが単一batch・chunkingなしのままdetail/main削除追加で2N>500のリスクを負っていた）→件数上限250のFATALガードを追加。Codexセカンドオピニオンは追加指摘なし。
  - **PR4a: FE writeBatch化3箇所（PR #574）**: `useReprocessDocument()`/`useErrors.ts`の`requestReprocess()`/`DocumentsPage.tsx`の`handleBulkReprocess()`をwriteBatch化。catchup出力とshared/types.tsのコメントで「detail/main書込の要否」に矛盾があったため、LATEST.md session101記載のFable5ピアレビュー確定スコープ（親docのみ+ocrExcerptクリア、detail/main書込はPR4bへ分離）を確認し解消。`/code-review high`でCONFIRMED 3件: ①チャンク構築時エラーが外側catchに漏れる ②部分失敗時に無条件clearSelection()で再試行不能になる ③`firestoreToDocument()`にocrExcerptマッピングが欠落しPR2の書込みが永久にFEで読めない状態だった（CLAUDE.md #178教訓）→全修正。実機確認（Firebase emulator+ローカルdev server+Playwright手動操作）で15件一括再処理→Firestore実データで`status:pending`+`ocrResult`/`ocrExcerpt`/`customerName`のdeleteField()を確認。Codexセカンドオピニオンで部分失敗時に成功済みチャンクのIDが再試行対象に残る問題(P2)を指摘→修正、再レビューで追加指摘なし。
  - **PR5: seed-dev-data.ts dual-write化（PR #575）**: `buildProcessedDoc`/`buildPendingDoc`が生成するdocの投入時、detail/mainへocrResultをdual-write。`BATCH_SIZE`400→250。他4PRと同様のgrep-based契約テスト新規追加。`/code-review high`でCONFIRMED 2件: ①BATCH_SIZEコメントの「2N<=500→N<=250」説明が実装(flatMap後の生write配列に対する要素数上限、実質125doc/chunk)と不一致 ②契約テスト欠如→両方修正。実機確認はhookの「運用スクリプトはGitHub Actions経由」誘導に従いローカルADC直接実行を回避、GitHub Actions経由でdev環境に実投入（148件→296件のコミットで2倍化を確認）、Firebase Consoleで`documents/seed-doc-0001/detail/main`ドキュメント実在+`ocrResult`正常値を直接確認。Codexは1回目モデル容量エラーで中断、再実行で追加指摘なし。
- **Issue #547クローズ確認**: PR #575本文の`Closes #547`により、squash merge時にGitHub自動closeを確認（追加操作不要）。
- **セッション運営面の教訓（インシデント）**: PR #573マージ後のローカルmain同期で、破壊的操作前のgit status確認を怠り`git reset --hard origin/main`を実行、`.serena/project.yml`の複数セッション継続の未コミット変更を破棄してしまった。ユーザーに正直に報告（実害は低いと推測されるが断定不可と明記）。以降のPRマージ後は`git status`確認→origin/mainとのSHA一致確認のみ（reset --hardは使わない）という安全な手順に切替。

## session102 サマリ（2026-07-07）

- **Issue #547 Phase B継続、PR2完遂（PR #571）**: `/impl-plan`継続作業として、`documents/{id}`作成箇所の網羅監査(ADR §93 MUST)をExploreエージェントで実施 — 対応必須4箇所(checkGmailAttachments.ts/uploadPdf.ts/pdfOperations.ts/import-historical-gmail.js)以外の9箇所(seed-e2e-data.js×4/seed-office-pending.js/create-pending-doc.ts/setup-collision-fixture.ts/cleanup-ambiguous-collision-docs.ts×2)は全てdev/emulator専用ガード付きまたは`ocrResult`未設定でdual-write対象外と確認。splitInto実測(GitHub Actions経由でkanameone環境に対しread-only実行): avg 4.04/median 3/**max 17**、249件超は0件で新上限の安全性を確認。
- **実装**: `ocrProcessor.ts`のメインtransaction内でdetail/main set + ocrExcerpt算出(Storage offload時はplaceholder文言、それ以外はocrResult先頭200字)、`pdfOperations.ts` splitPdfの子doc上限を499→249に変更しbatch内でdetail/main set追加、`checkGmailAttachments.ts`/`uploadPdf.ts`/`import-historical-gmail.js`の新規doc作成時にdetail/mainへ`ocrResult:''`初期化。`shared/types.ts`に`Document.ocrExcerpt?: string`追加。新規grep-based contract test 3ファイル・17テスト追加(既存1608+新規17=1625件全PASS)。
  - **実装中のはまりどころ**: Node.js v24のネイティブTypeScript実行機能により、mochaの動的importが`.ts`ファイルの相対import解決に失敗すると自動でrequire()にフォールバックしてCJS(`__dirname`利用可)になるが、node_modules内パッケージのみimportするテストファイルは動的importがそのまま成功しESM扱いになり`__dirname is not defined`エラーになる現象を発見。既存の`extractBraceBlock`ヘルパー(相対パスimport)を使う形に書き直すことで解消。
- **`/code-review high`（5角度finder×verify）+ Codexセカンドオピニオン**: correctness bugは検出されず、PLAUSIBLE 2件(detail/mainパス文字列5箇所の重複・ヘルパー未抽出／ocrExcerpt算出ロジックがFE`getOcrExcerpt()`と重複)はいずれも将来Phase(C/D)での検討事項として記録、ブロッカーではないと判断。finder段階で「create-pending-doc.tsがdetail/main dual-write欠如」という指摘が出たが、verify段階でpending状態は後続OCR処理パイプラインが必ず補完するとADRが明示的に許容していることを確認しREFUTED。Codexレビュー(P2×2: deleteDocument.ts削除同期欠如/seed-dev-data.ts dual-write欠如)もいずれもPR3/PR5として既にスコープ分離済みと確認し対応不要と判断。
- **セッション運営面**: `/catchup`実行後、前セッションのhandoffが明記した「即着手タスク#1(PR2)」へ直接着手。実装着手自体は5PR計画の続行として承認済みのため、AskUserQuestionで簡潔に実装開始の最終確認のみ取った上で着手。PRマージは番号単位の明示認可(タイトル+ファイル数+差分行数を添えて提示)を得てから実行。

## session101 サマリ（2026-07-06）

- **Issue #547 Phase B着手（decision-maker番号単位認可+`/impl-plan`着手指示）**: ADR-0018本文・現状コードを確認し、Phase Bスコープ(dual-write化+delete同期+ocrExcerpt新設)の実装計画を`/impl-plan`で策定。作成/削除経路の網羅監査（3並列Exploreエージェント）を実施し、`cleanup-duplicates.js`(継続運用中→削除同期対象)/`cleanup-ambiguous-collision-docs.ts`(根治済みだが安全側で対象化、decision-maker判断)/`pr-d4-backfill`(本番未到達、スコープ外確定)等を判定。
- **Fable5との対等ピアレビュー2ラウンド（ユーザー指示「セカンドオピニオンまたはFable5に相談。しかし同等の立場で議論」）**: 1ラウンド目でFable5が①PR4(FE writeBatch化)の計画がADR本文(Phase B行/Phase D行)と矛盾②`getReprocessClearFields()`が削除する7フィールド(retryCount/retryAfter/errorRescueCount/lastRescuedAt/provenance/summaryTruncated/summaryOriginalLength)がfirestore.rulesのwhitelistに存在せずエラー文書の再処理が`permission-denied`で失敗する実バグ③`cleanup-duplicates.js`のBATCH_SIZE半減漏れ、を指摘。全て独立検証（emulatorでFable5作成のプローブテストを自分で再実行し②を実証確認、コード比較で①③を裏取り）した上で採用。2ラウンド目でユーザーから「バランス良く考えられた計画か、過剰に指摘を受け入れていないか」と問われ再点検し、「PR2/PR3順序入替」「OCR中削除レースのlock-inテスト」の2点はFable5自身「実害は小さい」と認めていたものを安易に採用していたと判明、撤回。5PR構成（PR1ルール+既存バグ修正→PR2 Functions dual-write→PR3削除同期→PR4a FE writeBatch(親docのみ)→PR5 seed-dev-data）で確定。
- **タスク0完了（PR #568）**: `scripts/measure-split-into-length.js`新規作成、kanameone(max=17)/cocoro(max=3)で実行、`pdfOperations.ts`のsplitPdf子ドキュメント数上限249化に問題ないことを確認。
- **PR1完了（PR #569）**: `documents/{docId}/detail/{detailId}`サブコレクションルール新設+既存documentsルールへの`ocrExcerpt`追加+7フィールドのwhitelist漏れバグ修正。rules test 9件新規+既存修正、計69件全PASS。
  - `/code-review high`（8角度finder×5+4件verify）: 1件CONFIRMED（`getReprocessClearFields`テストのfixture drift、コメントが「全キー実在」を謳いながら実際は11フィールド未実在）→修正。他3件REFUTED（テスト重複/ocrExcerpt先行実装/detail読取コストはいずれも既存コンベンション・ADR設計通り）。
  - **Codexレビュー3ラウンド**: 1st(P2)「サーバー専有フィールド(retryCount等)が削除だけでなく任意の値への書換えも許可されている」→FE側に値設定経路が無いことをgrepで独立確認の上、削除or無変更のみ許可する制約を追加。2nd(P2×3)「①null挿入脆弱性(`resource.data.get(field,null)`だとフィールド不在docへ`field:null`新規注入が通ってしまう) ②ocrExcerptにも同じ保護必要 ③detail/mainのocrResult/pageResultsにも同じ保護必要」→全修正。3rd「No blocking regressions were identified」で収束。
  - **dev実機確認**: マージ後の自動デプロイ完了を確認、ブラウザ(Playwright)でエラー履歴ページから実際に「OCR完全失敗」文書の再処理を実行、コンソールにpermission-denied特有のエラーなし・Firestore Write channelは全200応答。
- **セッション運営面**: 「同等の立場で議論」という指示を、Fable5への一方的なレビュー依頼ではなく、指摘の独立検証→一部撤回→再修正の往復として実践。Codexレビューも3ラウンド全てに対し鵜呑みにせず自分でコード確認してから反映する運用を徹底。

## session100 サマリ（2026-07-06）

- **Issue #548 3.5移行スイッチ本体 実装完遂(PR #561)**: `/impl-plan`起票→設計判断(ロールバック機構は環境変数`GEMINI_MODEL_ID`化を選択、既存`GEMINI_OCR_THINKING_BUDGET`パターン踏襲)→実装→`/safe-refactor`(LOW3件修正)→`/code-review low`(0件)→`/review`スキル(8角度finder+検証、finding8件いずれもブロッカーなし)→Codex review(`--base main`、「整合的、問題なし」)のフルサイクルを実施。
  - `functions/src/utils/config.ts`: `parseModelId()`(既定gemini-3.5-flash、`GEMINI_MODEL_ID`で2.5-flashへロールバック可)、`isThreePointFiveModel()`、`GEMINI_PRICING_BY_MODEL`+`resolveGeminiPricing()`を追加。`GEMINI_PRICING`はrateLimiter.tsから移設(pure function化、firebase-admin非依存でunit test可能に)。
  - `functions/src/ocr/ocrProcessor.ts`: `thinkingConfig`をモデル別分岐(`gemini-3.5-flash`→`thinkingLevel:LOW`、`gemini-2.5-flash`→既存`thinkingBudget`方式)。
  - テスト: unit 1608 passing(+11新規)、integration(エミュレータ) 77 passing、既存の2.5-flash単価前提アサーションを新デフォルト値に更新。
- **dev実機検証(3段階)**: ①`seed-dev-data --force-pending`(ワークフロー選択肢追加、PR #563)で既存fixture 2件(6/5ページ)を実OCR再処理→精度劣化なし・コスト計算式が新単価と完全一致・thinkingTokens>0でthinkingLevel:LOW適用を確認。②doc-02の書類種別/事業所がセグメント2由来・顧客名/日付がセグメント1由来という部分混在を観測したが、`ocrProcessor.ts:249-269`(全ページOCRテキストを結合し決定論的抽出関数を1回実行)とA/Bテストのページ単位ground truth手法を突き合わせ、**実機再テストなしでコード分析のみ**により「モデル移行由来ではない」と確定。
- **Issue #562起票→実機検証→条件付きクローズ**: レビューで判明した「summary経路(`summaryRequestBuilder.ts`)がthinkingConfig未設定」というコストリスクを、`measure-summary-cost.ts`(PR #564、初回はadmin初期化順序バグでGHA実行時に失敗→PR #565で動的import化して修正)+`create-pending-doc.ts`(PR #566、既存Storage fixture`seed_generic_12p.pdf`からpending文書を作成)で実機3サンプル実測。結果は3件ともthinkingTokens=0。Issue #548-B1(要約は手動トリガーのみ)による呼出頻度の構造的低さを主論拠に「現時点では対応不要」と判断、kanameone/cocoro展開後の実データ監視を再検討トリガーとして`not planned`でクローズ。
- **セッション運営面**: ユーザーから計画段階でのFable5/Codexセカンドオピニオンの要否を問われ「不要、実装後の既存ルール通りのCodex reviewで十分」と判断・合意。PR #561マージ後のCodex reviewで見つかった懸念点についても「セカンドオピニオンは参考情報、最終判断はdecision-maker」の原則で対等に議論し、Issue #562フォローアップという形で決着。

## session99 サマリ（2026-07-06）

- **Issue #548 A/Bテストharness実装完遂**: `scripts/compare-gemini-ocr-models.ts`を新規作成。dev環境seedフィクスチャ(`MIXED_FAX_PDFS`、正解ラベル付き2ファイル・11ページ)をGemini 2.5 Flash/3.5 Flash両方でページ単位OCRし、`functions/src/ocr/ocrProcessor.ts`の`processDocument()`と同じ抽出関数(`extractDocumentTypeEnhanced`/`extractCustomerCandidates`/`extractOfficeCandidates`+filenameInfo)で書類種別/顧客/事業所の3フィールド精度を比較。`scripts/seed-dev-data.ts`は既存定数(`MIXED_FAX_PDFS`/`CUSTOMERS`/`OFFICES`/`DOC_TYPES`/`CARE_MANAGERS`/`readFixture`)にexportを追加し、末尾の自動実行を`require.main === module`でガード(importするだけでFirestore書込が走る事故を防止)。
- **GitHub Actions経由の実行環境整備**: `docsplit-cloud-build@doc-split-dev`SAに`roles/aiplatform.user`を付与(dev限定、このharnessが初めてops-script SAから直接Vertex AI/Geminiを呼ぶケースのため)。`run-ops-script.yml`に`compare-gemini-ocr-models`を選択肢追加。dev環境専用ガード(`ALLOWED_PROJECT_ID`チェック、`seed-dev-data.ts`と同パターン)も追加し、誤ってkanameone/cocoro環境で実行されても即座にエラー終了するようにした(IAM権限の有無への間接依存ではなくスクリプト自身の構造的ガード)。
- **6エージェント並列レビュー(pr-review-toolkit)+Codex review(`codex review --base main`)を実施、重大指摘を全反映**:
  - Codex P1: 精度劣化検出時もexit codeが0のままでCIが誤って緑になる問題 → `regressed`時に`process.exitCode = 1`を設定
  - Codex P2/comment-analyzer: 事業所抽出が`extractAllInformation`経由の`extractOfficeNameEnhanced`(filenameInfo非対応)で、本番の`extractOfficeCandidates`(filenameInfo込み)と異なるロジックだった → 本番と同一の抽出関数呼出に統一
  - silent-failure-hunter CRITICAL: `response.text || ''`がVertex AIのsafetyブロック/zero-candidate応答を無言でOCR誤読と同一視し、n=11の少数サンプルでは判定を覆しうる → finishReason/blockReasonを検知し警告ログを追加
  - code-simplifier/type-design-analyzer: `const [baseline, migrated] = summaries`が`MODEL_CONFIGS`配列順に暗黙依存 → `role: 'baseline'|'candidate'`フィールドで明示化
  - comment-analyzer: docblockの「GitHub Actions対象外」という記述が本PR自体のワークフロー組込みと矛盾、「実突合ロジック」表記が日付フィールド非対応を隠していた → 記述を実態に合わせて修正
  - その他: `MAX_OUTPUT_TOKENS`のハードコード重複解消(`GEMINI_CONFIG`から直接参照)、OCRプロンプトへのページ番号suffix付与(本番と同一化)、不一致時の実際の抽出値ログ出力、単価情報へのソースURL追記
- **実機検証3回、いずれもPASS**: GitHub Actions `Run Operations Script`(environment: dev, script: compare-gemini-ocr-models)で3回実行(初回・レビュー反映後・dev専用ガード追加後)。全て書類種別/顧客/事業所 11/11(100%)一致、精度劣化なし。トークン/コストはGemini 3.5 Flashが2.5 Flash比で入力トークン減(1,378→619/ページ)・thinkingトークン発生(0→数百)・概算コスト比約3.7〜4倍(n=11の小規模テストのみの数値、実運用スケールの参考値ではない)。
- **Issue #548へ結果コメント記録**: A/Bテスト結果・判定・レビューで強化した品質面を要約してコメント。次の着手候補(#548 3.5移行スイッチ本体)の着手条件(A/B PASS)を満たしたことを明記。
- **セッション内の教訓、グローバルmemory新規記録**: ローカルADC(`gcloud auth application-default login`)が`gcloud auth list`のアクティブアカウントとは独立した別の認証ストアで、実行前に確認せず403エラーで初めて別アカウントに紐付いていたことが判明。ユーザーから「ちゃんとドキュメントやハーネス読んでる？」と指摘を受け、ADC再ログインを提案する前にGitHub Actions動的環境切替(`google-github-actions/auth@v2`が`environment`入力に応じてSA鍵を切替える既存パターン)へ回帰すべきと再指摘され、IAM権限追加+ワークフロー登録の方針に転換。`feedback_gcloud_adc_vs_cli_account_mismatch.md`として新規記録(Whyセクションのプロジェクト名記載はhandoff中に自己点検し修正済み)。
- **今後の方針をユーザーと合意**: 「dev環境でしっかり固める→検証する→kaname環境での予測に問題なければ段階的に本番展開する」という段階的ロールアウト方針を確認。次の具体的な一歩(#548 3.5移行スイッチ本体の`/impl-plan`着手)は次セッションでの番号単位認可待ち。

## session98 サマリ（2026-07-06）

- **Issue #547 事前計測完遂**: `scripts/measure-field-byte-sizes.js`を新規作成しGitHub Actions経由でkanameone環境に対しread-only実行（PR #555マージ済）。実測(n=300): 重フィールド9種が全体の88.0%（ocrResult 34.7%/pageResults 46.4%が突出）、削減見込み¥4,645→¥557/月。結果はIssue #547にコメント記録済み。
- **ADR-0018（Firestoreサブコレクション分離設計）起票、PR #556マージ完了**: 初期案（9フィールド全移行）をFable5セカンドオピニオン+コード検証で見直し、**ocrResult+pageResultsの2フィールドのみに縮小**（重フィールド合計の92.1%をカバー、9フィールド全移行との差は月¥321程度。ExtractionInfoPopover改修+3箇所のバッジロジック改修+新規派生フィールド管理コストを回避）。
  - **Codex CLI reviewを6ラウンド実施**（`codex review --base main -c model_reasoning_effort=xhigh`、都度検証の上反映）: P1件数推移 3→1→3→2→**0**→1（round5で一度収束、round6で新種の指摘=Phase B〜C移行期間中の再処理失敗でdetail/mainが古いまま残る問題）。deleteDocument.tsの孤児化、rules create/update判定の矛盾、getReprocessClearFields呼出元3箇所の原子性、一覧検索機能のクラッシュ(`fetchDocuments`のsearchTextがocrResultを直接参照)、Storage offload placeholderの保持等、具体的な設計欠陥を多数発見・修正。
  - **round7（収束確認）は未実施のままdecision-maker判断でマージ**（round6でP1 1件を修正済み、CI green・MERGEABLEの状態で番号単位認可を得てマージ、2026-07-06）。ADR自体が「各Phaseは別途impl-plan+Codexレビューで詳細計画化」と明記しているため、Phase B実装時に改めてレビューが入る設計。
- **Issue #548（Gemini 3.5 Flash移行）検討再開**: 公式ソース(ai.google.dev)でGemini 3.5 Flash単価を確認（入力$1.50/出力$9.00、2.5 Flash比で入力5倍/出力3.6倍、GA済み。3.5 Flash-Liteは存在せず）。userから「1.8倍予想」の言及があり、初回検索では出典を発見できず訂正を要したが、`docs/handoff/LATEST.md`(session95記載)に**¥23,000(3.5移行後)÷¥12,714(6月実績)≈1.81倍**として実在することを確認・reconcile。@google/genai v2.10.0の型定義を直接確認し`ThinkingConfig.thinkingLevel`(値:`minimal/low/medium/high`)の存在を裏取り。
  - **A/Bテストharness実装計画を`/impl-plan`で策定**: `scripts/seed-dev-data.ts`の`MIXED_FAX_PDFS`(既存、正解ラベル付き日本語文書2ファイル・5segment)を検証corpusとして再利用し、`extractors.ts`の実突合ロジックで2.5 vs 3.5のOCR精度+コストを比較する設計。計画提示済み、ユーザーは同意（セカンドオピニオン不要の判断にも同意）したが、**実装着手前にcontext都合でhandoffへ移行**。
- **セッション内の教訓**: `1.8倍`の出典確認で`gh issue view`のみに頼り`docs/handoff/LATEST.md`本文grepを怠った結果、一度「記録が見当たらない」と誤って回答→ユーザー指摘で再検索し訂正。ハンドオフメモ自体も一次情報源として確認対象に含めるべきだった。

## session97 サマリ（2026-07-05〜06）

- **Issue #546 dev環境実データ検証（session96からの引継タスク）完遂**: read-only検証スクリプト`check-gemini-cost-stats.js`を新規作成しGitHub Actions運用ワークフローへ追加（PR #552）。dev環境の既存error文書3件+複合文書1件（`seed-doc-pending-mixed-02`）を再処理させ実測確認。
  - **コスト計測**: `bySource.ocr.thinkingTokens: 0`を実測確認（5ページ処理、ログの積算値`totalInputTokens:6890/totalOutputTokens:302`とFirestore記録値が完全一致）。価格計算式も実測値で検算し小数点以下まで一致。
  - **OCR精度**: 複合文書の抽出結果（customerName/officeName/documentType/fileDate）は実在するセグメント情報のいずれかと一致し捏造なし。ただし当初Issue完了条件だった「デプロイ前後の同一OCRテキストdiff一致」は、再処理により旧結果が上書きされ検証不能という制約が判明（次回同種検証時は事前にpageResultsをバックアップする必要あり）。
  - **error文書fixture**（`seed-doc-error-01〜03`）は汎用プレースホルダーPDFで実データを含まないと判明、精度検証には使えないことを確認（誤検証リスクの回避）。
- **Issue #548-B1（AI要約の遅延生成化）実装完遂**: `processDocument()`内の自動要約生成を削除し、要約は既存の`regenerateSummary` onCall（UIの「AI要約を生成」ボタン、実装済みだった）経由のみに一本化。PR #553でマージ、main push経由でdev環境へ自動デプロイ成功。
  - **`/code-review medium`（8角度finder）で発見・修正した重大な設計ギャップ**: 手動再処理・429自動rescue・`fix-stuck-documents.js`等の再処理経路で、古い内容の要約がFirestoreに残存し新しいOCR結果と不整合になる（`getReprocessClearFields()`は`summary`を削除するが復元されない/されても古いまま、というdual bug）。修正: OCR完了のたびに`summary`/`summaryTruncated`/`summaryOriginalLength`を`FieldValue.delete()`で無効化する実装に変更。
  - **`/review-pr`（5エージェント並列）で収斂した指摘に対応**: バグ修正部分（summary無効化）の回帰検知テストが存在しなかった点（pr-test-analyzer×code-reviewer×code-simplifier収斂）→grep-based canary契約テスト追加。コメント不正確2件（comment-analyzer×code-reviewer×code-simplifier収斂）→修正。
  - 品質ゲート: `/impl-plan`→実装→`/safe-refactor`（0件）→`/code-review medium`→`/review-pr`（5エージェント）。`npm test`: 1597 passing / 0 failing。
- **Issue #251への追記**: pr-test-analyzerが指摘した「`processDocument()`のsummary書込経路のランタイム統合テスト欠如」は、既存Issue #251「Scope 1: generateSummaryCoreのruntime unit test」の延長線上と判断し新規Issue化せず追記。
- **セッション内の教訓（再発）**: dev環境Firestore読み取り時、CLAUDE.md記載の「運用スクリプトはGitHub Actions経由（ADC不要）」を確認せずローカルADC認証を試みて失敗（session96の「デプロイ手順」に続く2回目の同型ミス）。`ops-script-redirect.sh`フックが実際にブロックし、正しい経路（`run-ops-script.yml`ワークフロー）へ誘導された。

## session96 サマリ（2026-07-05）

- **Issue #546（Geminiコスト計測基盤整備）完遂**: `GEMINI_PRICING`を実単価($0.30/$2.50)へ修正、`@google-cloud/vertexai`→`@google/genai`へSDK移行、`trackGeminiUsage`にsource別(ocr/summary)内訳+thinkingトークン計測を追加、OCR転記に`thinkingConfig`(既定0、`GEMINI_OCR_THINKING_BUDGET`環境変数でロールバック可能なfeature flag)を導入。
- **品質ゲート4段階を実施**: `/safe-refactor`（0件）→`/code-review`（8観点、実バグ3件検出・修正: test:integration duplicate-app crash / 新SDKのfetch実装によるネットワークエラー誤判定 / GEMINI_PRICING mutable export）→Evaluator分離（AC5=thinking無効化のOCR精度影響にREQUEST_CHANGES→2026-07-05時点公式情報でファクトチェック実施の上、feature flag化で対応）→`/codex review`（P2指摘1件: feature flag不正値のバリデーション漏れ、修正）。
- **PR #550 マージ後、`/review-pr`(5エージェント)で追加3件検出・修正**: summaryGeneratorのtrackGeminiUsage未await/parseOcrThinkingBudgetの空白trim漏れ/トラッキングガード条件のthinkingTokens考慮漏れ。
- **dev環境(doc-split-dev)へmainマージ経由でCI自動デプロイ完了**（GitHub Actions `deploy.yml`、全Functions更新成功、17分）。回帰1602 unit tests + 77 integration tests(emulator) pass、lint 0 errors。
- **未検証事項（次セッションへ引継）**: OCR転記精度への影響（thinkingBudget:0でマスター突合精度が劣化していないか）とコスト削減効果の両方が、dev環境での実データ処理を経ていないため未確認。feature flag化済みのため問題があれば`GEMINI_OCR_THINKING_BUDGET=-1`設定+再deployで即ロールバック可能。
- **セッション内の教訓**: デプロイ手順検討時、セッション開始時に既に読み込み済みのプロジェクトCLAUDE.md記載（「devはmainへのpush時にCI自動デプロイされる」）を参照せず、誤った手動デプロイ手順を提案。ユーザー指摘で訂正。グローバルmemory `feedback_read_project_claude_md.md` に別プロジェクトでの再発事例として追記済み。
- **doc-audit実施**（2026-07-05、前回03-16から111日ぶり）: 総合B+(85%)。LATEST.md（このファイル自体）が直近コミットに未追随という指摘を受け本エントリで解消。他の指摘（frontmatter日付stale 2件、リンク切れ1件）も本セッションで対応。CLAUDE.md肥大化（133→207行）の`.claude/rules/`切り出しはdecision-maker判断待ち。

## session95 サマリ（2026-07-04〜05）

- **Issue #526（kaname要望E）dev側完遂**: 設計判断ゲート3点回答（Codexセカンドオピニオン2回反映）→フェーズ実装PR1〜4を全merge — #541（スキーマ+confirmed保護フラグ+FE+#538修正）/ #542（OCR後段処理の純粋関数切出し、挙動不変）/ #543（confirmed保護マージ+transaction化+pageResults再利用。evaluator AC10項目+5エージェント/review-pr+Codex reviewの指摘を全反映）/ #544（splitPdf子ドキュメントをpending生成へ切替、実運用到達）。
- **PR5 dev側完了**: seed実データE2E（`seed-doc-pending-mixed-01`を3セグメント分割、confirmed=trueの井上春子保持+confirmed=falseの2セグメントがOCRから完全一致で再抽出=**confirmed保護とOCR自動補完のフィールド単位併存を実証**）。回帰1585 tests pass / lint 0 errors / build PASS。ログ証跡はPR #544本文とIssue #526進捗欄に記録済み。
- **残タスク**: kanameone/cocoro展開のみ（両環境はmainより19コミット遅れ、2026-06-12最終デプロイ。functions+hosting+rulesの3点セット必要。#526はこれが済むまでopen維持）。
- **隣接バグ**: #538（分割画面のcustomerId/officeId不整合、PR#541で修正済close）/ #539（並行splitガード欠如、P2）/ #540（processOCR stale snapshot一般解、P2。#543のtransaction化は#526スコープの局所対策）。
- **/deploy skill補強**: cocoroのFunctions CI経路+rulesデプロイ手順の空白を修正（PR#545）。
- **GCPコスト分析（Fable 5で実施）**: kanameone 6月請求¥12,714の内訳確定 — Vertex AI ¥6,093 + **Firestore egress ¥4,645**（「App Engine」表示の実体。一覧表示が`ocrResult`/`pageResults`等の重フィールド込みでdoc全体を配信）で計84%。**両者とも「OCR全文をdoc本体に逐語保存」という単一設計判断に起因**。Gemini 2.5 Flash廃止（最速2026-10-16）+日本データレジデンシーで3.5 Flash一択（input×5/output×3.6）。7日間実測: 798docs/2,841pages、in 1,378/page・out 892/page、コストの約8割がoutput（単価×6〜8のため）。突合ロジックは100%ローカルコードでGeminiは転記+要約の2呼出のみと確認。**品質不劣化を絶対制約**とした圧縮プランを策定し #546（計測基盤+SDK移行+thinking制御）/ #547（egress削減=重フィールドのサブコレクション分離、destructive migration・Codexレビュー必須）/ #548（要約遅延化+3.5移行）を起票。到達見通し: 移行前¥8,000（−37%）→10月移行後¥23,000（無対策なら¥32,000+α）。
- **計測の盲点2件発見**: `GEMINI_PRICING`定数が古い（$0.075/$0.30、実際は$0.30/$2.50=約1/8過小表示）+ thinkingトークン（`thoughtsTokenCount`）が完全未計測（output単価で課金されるのに不可視）。#546で是正。

