# ハンドオフメモ

**更新日**: 2026-07-14 session128（Cloud Monitoring read_count実測+cocoro反映状況の直接確認、LATEST.mdアーカイブ実施。詳細は下記session128サマリ参照）

<!-- session115〜117・121・122はLATEST.md詳細サマリ未追記（GOAL.mdのみ更新）。#539完遂・#540完遂(OCR実行所有権ガード)・#625(OCR Storage孤児化解消)・#547 Phase E是正(Hostingデプロイ漏れ)、および候補抽出スパイク(タスクA、PR#641)・候補抽出呼出し実装(タスクB、PR#642)・arbitration実装(タスクC、PR#643)の経緯はGOAL.md/ADR-0018/該当コミットメッセージで追跡可能なため遡及記載はROI低と判断、着手せず -->

## session128 サマリ（2026-07-14、Cloud Monitoring実測+cocoro反映確認+アーカイブ）

session127に続き、decision-makerから「これ以上ROI良く対応できることはあるか」と問われ、Cloud Monitoring APIでのFirestore読み取り回数実測を試行。その後「コスト基準はkaname基準で良いが、反映状況確認はcocoroもしておくべき」との指示を受け、cocoro環境への直接検証を追加実施。最後にhandoff実行時、LATEST.mdが60KB閾値をわずかに超過していたためアーカイブ処理も行った。

### Cloud Monitoring read_count実測
`gcloud monitoring time-series list`が存在しないため、Monitoring API（`https://monitoring.googleapis.com/v3/`）を`curl`で直接叩く方式に切替。kanameoneの`firestore.googleapis.com/document/read_count`を日次集計で取得した結果、7/9=4,410,399回・7/10=2,568,891回（トリガーストーム集中日）に対し、7/11以降は10〜18万回/日に収束（7/11:46,839 / 7/12:181,846 / 7/13:130,852）。Billing Console実測（egressの82.6%が7/9集中）と独立データソースで完全に整合し、トリガーストーム説の確度をさらに引き上げた。egressのバイト数を直接示すFirestore専用メトリクスは存在しなかった（`network/active_connections`等の接続数系のみ）ため、深追いはせず打ち切り。

### cocoro反映状況の直接確認
GitHub Actions経由でcocoroに対し3件のread-only検証を実施:
- `measure-field-byte-sizes --limit 300`: 平均3,921B、`ocrResult`/`pageResults`ともにpresent=0/300。kanameoneと同様、Phase Eが完璧に機能していることを確認
- `fix-stuck-documents --include-errors --dry-run`: 「対象のドキュメントはありません」でエラー・スタック文書0件
- `check-gemini-cost-stats --days 21 --doc-limit 500`: 7/8→7/9でリクエスト単価が明確に跳ね上がるパターンを確認し、モデル移行の反映を間接確認

### 結論
dev実装・kanameone/cocoro両本番反映を直接確認完了。「2倍以内」達成の確度評価はkanameone基準の80%程度で維持（本検証は確度そのものより反映状況の網羅確認が主目的）。decision-maker向けにコピーボタン付きHTMLレポートをローカル生成し報告済み。

### LATEST.mdアーカイブ実施
`wc -c`が63,630バイトで60KB閾値を超過（最長行は1,275文字で閾値内、記法ドリフトなし）していたため、`references/archive-procedure.md`手順に従いsession112〜113の詳細サマリを`docs/handoff/archive/2026-07-history.md`へ移動。アーカイブ後55,889バイトまで縮小。

### Issue Net
Net 0（GitHub Issue非経由、read-only調査+ドキュメント整理のみ）

### 引き継ぎ教訓
- `gcloud monitoring`にはtimeSeries取得の直接サブコマンドが存在しない（`gcloud alpha monitoring`にもなし）。日次集計等の実測が必要な場合はMonitoring API（`monitoring.googleapis.com/v3/projects/{project}/timeSeries`）を`gcloud auth print-access-token`+`curl`で直接叩く方式が確実
- Firestoreの読み取り回数（`document/read_count`）とegressバイト量は別メトリクス体系。回数の推移パターンで裏付けは取れるが、バイト量そのものの直接実測手段は今回のツールセットでは見つからなかった

## session127 サマリ（2026-07-14、kanameoneコスト圧縮の追加検証）

session126の調査結果（トリガーストーム特定）を踏まえ、decision-makerから「これ以上できること・ROIが良いこと」を問われ、read-only検証2件をGitHub Actions経由で実行。

### 実行内容と結果
- `measure-field-byte-sizes --limit 300`（kanameone）: ドキュメント全体サイズ平均4,095B（Issue #547事前計測時点の平均19,831Bから79.4%削減）。`ocrResult`/`pageResults`ともにpresent=0/300で親から完全削除済みを確認。Phase Eの効果が完璧に機能していることを直接証明する決定的な実測
- `check-gemini-cost-stats --days 21 --doc-limit 500`（kanameone）: `stats/gemini/daily`の6/24〜7/14の日次実測を取得。session114と同一手法（7/8 vs 7/10+7/11のOCR単体交絡排除比較）で単価倍率約5.17倍を再現確認（session114の5.068倍とほぼ一致、独立データでの再現性を確認）。移行後(7/9〜7/13)の絶対額（アプリ内推定値`estimatedCostUsd`）は5日平均$0.82/日・月間換算約$25で、6月実績のVertex AIコスト(¥6,093)を下回る可能性がある水準

### 結論
「2倍以内」達成の確度に関する主観評価を60-75%→80%程度に上方修正。Firestore側は実測でほぼ確証、Gemini側も独立した21日データで楽観的傾向を再現した。ただし`estimatedCostUsd`はアプリ内推定値で実請求そのものではなく、月末までの残り期間の変動は未知数のため、最終確認は引き続き8月上旬の7月分確定請求を待つ（GOAL.md監視・確認事項に記録済み）。

### Issue Net
Net 0（GitHub Issue非経由、read-only調査のみ）

### 引き継ぎ教訓
- `check-gemini-cost-stats.js`は集計サマリーを計算する設計ではなく、`stats/gemini/daily`の生データと直近documentsの生データをそのまま出力する設計（72行の薄いスクリプト）。GitHub Actionsログを`tail`や末尾grepだけで見ると生データ（documents一覧）に隠れて日次統計セクションを見落とすため、`grep -n "=== "`等でセクション区切りを先に特定してから読むこと
- Bashツールの実行間で環境変数`CLOUDSDK_ACTIVE_CONFIG_NAME`が想定外に持続するケースがあった（`switch-client.sh`が`export`する値が後続コマンドに残存）。gcloud named config切替が反映されない場合は、まず`unset CLOUDSDK_ACTIVE_CONFIG_NAME`してから`gcloud config configurations list`で確認するとよい

## session126 サマリ（2026-07-14、kanameone 7月請求急増の原因調査・特定）

decision-makerからkanameoneの2026年7月請求（月中実績+予測）の確認依頼を受け、Gemini 3.5移行+Firestore圧縮（#547/#548）によるコスト圧縮効果が目標（2倍以内）に収まっているか調査。

### 調査の経緯
- 提供されたGCP Billing Console画像から、月間予測が当初¥26,677（6月比+106.3%）→再確認時¥31,180（+141.05%、約2.4倍）へ悪化していることを発見。特にFirestore egress SKU（App Engine表示）が前期間比+797%と異常
- コード確認: Phase Eの一覧クエリ設計自体は正しく実装されている（親から重フィールド削除済み）
- GitHub Actions実行ログ調査: Phase E本体（dry-run/execute/verify）の処理量だけでは153.99GiBを説明できない（合計1GiB未満、150倍以上の乖離）ことを定量的に確認
- decision-maker提供のSKU別・日別グラフから、egressの82.6%（¥2,692/¥3,258）が7/9単日に集中していることを確認（継続的バグではなく単発イベントと判明）
- Cloud Loggingで7/9の`onDocumentWrite`/`onDocumentWriteSearchIndex`トリガー発火回数（18,960回/15,848回）を確認、`functions/src/utils/groupAggregation.ts`内に「Issue #547 Phase E: ...トリガーストーム」を指す対策コード（`isAggregationUnchanged`、PR #611で2026-07-10マージ）を発見

### 真因の特定
`scripts/backfill-detail-subcollection.ts`の`backfillOneDoc()`が`detail/main`書込みに加え必ず親ドキュメントも`tx.update()`する設計であることをコード確認。GitHub Actions実行ログで、7/9 00:24 UTCにkanameoneで`backfill-detail-subcollection --execute`（Phase C本番backfill、全9,388件）が実行されたことを確認し、これがトリガーストーム対策実装前（PR #611マージは翌7/10）のタイミングで9,388件の親ドキュメント書込みを引き起こし、重フィールドを含むbefore/afterペイロードの大量配信がegress急増の直接原因と特定した。

### 結論
一過性の移行作業由来の副作用であり、対策（`isAggregationUnchanged`）は既に本番投入済みのため8月以降の再発は見込み低い。Issue #548当初試算（¥23,000/月、約1.81倍）に近い水準へ収束する可能性が高いと判断。ただし数値の完全一致までは検証できておらず、最終確認は8月上旬の7月分確定請求を待つ（GOAL.md監視・確認事項に記録済み）。

### Issue Net
Net 0（GitHub Issue非経由、read-only調査のみ）

### 引き継ぎ教訓
- decision-makerの「それ以外の理由がある具体的な可能性とは何か」という指摘が、状況証拠（実行回数の多さ）だけで満足せず定量検証（実際の読み取り量を計算）に進む重要な転換点になった。仮説と実測値の乖離（150倍以上）を無視せず追及したことで真因に到達できた
- Firestoreの`onDocumentWritten`トリガーは変更前後のドキュメント全体をペイロードとして配信するため、重フィールドを含むドキュメントへの一括書込み処理（backfill/migration等）を伴う移行作業では、トリガー関数側の変更検知ロジック（早期return）が整備されていないと「トリガー発火コスト」がegress急増を引き起こしうる。今後同種の一括書込みを伴う移行作業を計画する際は、トリガー関数側の早期return設計を事前レビュー項目に含めるべき

## session124 サマリ（2026-07-14、GOAL.mdタスクG/H完遂 + タスクI判断でミッションクローズ + PR #646/#647/#648）

catchupの「次にやるとよいオススメ」（タスクG着手、session123でdecision-maker承認済み）に対し追加確認なしで着手。同一セッション内でタスクG→H→Iまで完遂（GOAL.mdコミットメッセージ上は便宜的にsession124/125と分けて記載した箇所があるが、実際は連続した1セッション）。

### タスクG: dev環境A/Bテスト本実行
対象文書数拡大の手段は、dev環境に実運用データが存在しない（CLAUDE.md明記）ため「既存フィクスチャ追加」一択と判断（軽量プラン提示→承認待ちなしで着手）。`scripts/fixtures/arbitrationCompareFixtures.ts`に未使用CUSTOMERS6名を使った新規5文書を追加しN=5→N=10へ拡大。feature branch経由でGitHub Actions実行(run 29294375536)、結果: baseline/candidate両方4項目全一致10/10(100.0%)で精度劣化なし・再現性確認。PR #646作成・`/code-review low`(指摘0件)実施の上マージ。

### タスクH: kanameone confirmed-replay検証
documentType/dateはkanameone実データにconfirmed相当のground truthが存在しない(documentTypeConfirmedはUI機能自体が本番未展開で実運用0件、dateには確定フラグの概念が無い)ため、customer/office先行検証のみ実施する決定(decision-maker選択)。新規スクリプト`compare-ocr-arbitration-logic-confirmed.ts`+`confirmedArbitrationStats.ts`を追加。

- **read-only厳守のため候補抽出ロジックを独立実装**: 本番`extractOcrCandidates()`は異常系で`safeLogError()`経由のFirestore書込みが発生するため直接呼ばず、既存`compare-gemini-ocr-models-confirmed.ts`が`loadMasterData.ts`について同じ理由で独立実装している既存パターンを踏襲
- `/code-review medium`(8角度並列finder+1票検証)でCONFIRMED2件検出・修正: ①`processOneDocument()`の抽出/arbitration計算がtry/catchで囲まれておらず1文書の例外がjob全体をクラッシュさせる経路があった、②`success`が常時trueのハードコードで失敗率ゲートが機能していなかった(confirmedReplayStats.tsが記録する既知バグクラスの再発)
- `confirmedArbitrationStats.test.ts`新規追加(scripts側テスト94 passing)
- kanameone実機実行: pilot(`--limit 30`)でサンプリングN=2、本実行(`--limit 300`)でもN=12が母集団上限（`confirmedBy`/`officeConfirmedBy`非nullという人間確定条件の歩留まりが実データで約1.3%と極めて低い既知の制約、これ以上増やせない）
- 結果: baseline/candidate完全同一(顧客一致率33.3%=4/12、事業所41.7%=5/12)で精度劣化なし・PASS。候補抽出grounding失敗率0.0%。PR #647作成・マージ

### タスクI: 本番展開判断 → 見送り（ミッションクローズ）
GOAL.mdのタスクIは「本番展開判断+実施（Hが基準を満たす場合のみ、番号単位認可）」だったが、着手前にdecision-makerから「セカンドオピニオンを聞いてさらに検討したい」との指示。`/codex plan`（MCP、effort=high）を実施し、Codexから重要度High指摘4件を受領:

1. GOAL.md完了の定義は4項目（documentType/customerName/officeName/date）同等以上を要求するが実施できたのはcustomer/officeの2項目のみで「4項目ACの代替にならない」
2. タスクHの「baseline/candidate完全同一」という結果は集計がjoint一致率のみのため文書単位の入れ替わり（baseline正→candidate誤とその逆）が相殺されてもPASSに見える構造で「無劣化の完全証明ではない」
3. N=12・回帰0件はrule of threeで真の回帰率の95%信頼上限が約25%相当と統計的信頼性が低い
4. baseline自体の低一致率を原因不明のまま展開すると改善効果を測れず既存の根本問題も温存する

Claude側の独立評価でも指摘①〜④に同意（②は個人情報保護のため個別文書結果を非出力とした設計上、事後検証不能な点を含め見落としていた観点）。decision-maker最終判断:「品質は下げない、コスト圧縮は目指す、不安定さ・不十分さがあれば基本はしない選択をする」との原則を明示され、GOAL.md不変条件の撤退基準（AC未達時は無理に本番展開しない）を適用してミッションをクローズ。

Codex提案の追加調査案（baseline不一致の原因分析／人手ラベリングでN拡大、約60件試算）は、いずれも新規の人手作業設計を要し方針と整合しないため見送り。タスクA〜D実装（マージ済み・dev動作確認済み）はrevertせず保持（実害なし、将来の再検討の土台）。kanameone/cocoroへの展開は行わない。PR #648でGOAL.md更新・マージ。

### Issue Net
Net 0（起票0/close 0。本ミッションはGitHub Issue非経由、GOAL.md駆動のため対象外）

### 引き継ぎ教訓
- kanameone実データの`confirmedBy`/`officeConfirmedBy`歩留まりは約1.3%と極めて低く、confirmed-replay方式のサンプルサイズはこれ以上増やせない構造的制約。将来同種の検証を行う場合はこの制約を前提にすること
- 本番環境の実データに対してread-only検証スクリプトを新規に書く際は、呼び出す既存の本番関数（`extractOcrCandidates`等）が異常系でFirestore書込みを行わないか必ず確認すること（`safeLogError`等の副作用パターン、`compare-gemini-ocr-models-confirmed.ts`が`loadMasterData.ts`について既に同じ問題を回避していた先例あり）
- セカンドオピニオン（Codex）は「精度劣化なし」という集計結果の裏にある構造的な弱点（joint rateでの相殺リスク等）を見抜く上で有効だった。decision-maker自身も能動的にセカンドオピニオンを求める判断をした

## session123 サマリ（2026-07-14、GOAL.mdタスクD/F実装 + 実機A/B検証 + PR #644マージ + dev自動デプロイ確認）

catchupの「次にやるとよいオススメ」2件（タスクD/F）にdecision-makerの番号単位認可を得ながら着手・完遂。

### タスクD: `processDocument()`統合
`functions/src/ocr/ocrProcessor.ts`の`processDocument()`に、タスクB実装済みの`extractOcrCandidates()`+タスクC実装済みの`arbitrateDocumentType`/`arbitrateCustomerName`/`arbitrateOfficeName`/`arbitrateDate`を統合。既存の全文ベース抽出結果を無条件に上書きしない設計を維持し、dateMarker解決はarbitration後のdocumentType結果を参照するよう順序調整（候補昇格時にdateMarkerも追従）。候補抽出呼出しのトークンを`totalInputTokens`等へ加算し`trackGeminiUsage`経由の本番コスト計測に反映。契約テスト(`ocrProcessorCandidateArbitrationWiringContract.test.ts`)で配線をlock-in。

### タスクF: dev環境ロジックA/Bハーネス新規構築
既存`compare-gemini-ocr-models.ts`(モデルA/B比較用、gemini-2.5 vs 3.5)とは軸が異なる「ロジックA/B比較」(同一モデルでbaseline=既存抽出のみ/candidate=候補抽出+arbitration統合後)として`scripts/compare-ocr-arbitration-logic.ts`を新規追加。documentType/customerName/officeName/dateの4項目全gate化。複数人名/複数日付の層化用に新規フィクスチャ2件(`scripts/fixtures/arbitrationCompareFixtures.ts`)を追加(既存`seed-dev-data.ts`は無改修で副作用回避)。「手書き」原稿は合成PDFでは再現不可のため既知の限界としてスコープ外。

### 品質保証プロセス
`/code-review low`を2回実施(タスクD/F各diff)、DRY違反1件検出・修正。変更が5ファイル以上(実コード)に及ぶため`rules/quality-gate.md`のEvaluator分離プロトコルに従い、独立evaluatorエージェント(前提知識なし)でAcceptance Criteria 10項目を個別検証、全PASS・HIGH/MEDIUM指摘0件を確認。

### 実機実行結果・PR・デプロイ
GitHub Actions "Run Operations Script"経由でdoc-split-devに対しread-only実行(run ID 29290104624)、結果: baseline/candidateとも5/5文書・4項目全100%一致(複数人名/複数日付distractorを含めて精度劣化なし)、候補抽出grounding失敗率10.0%(2/20件not-grounded、arbitrationの保守的設計により誤昇格には至らず)、候補抽出トークン増分input=2837/output=515/thinking=1322(5文書で概算$0.0208)。decision-makerの番号単位認可を得てPR #644を作成・マージ(main直pushではなくfeatureブランチ`feat/ocr-arbitration-task-d-f`経由)。main→dev自動デプロイ(CI+Deploy workflow、run 29291567996/29291567955)が発火し、両方SUCCESSで完了したことを確認済み。**kanameone/cocoroへの反映は未実施**(GOAL.mdの設計通り、タスクH/Iの番号単位認可を経てから実施する計画。今回のdev自動デプロイはkanameone/cocoroには一切影響しない)。

### CodeRabbitの指摘(別対応として保留)
PR #644のCodeRabbitレビューで、「既存の全文ベース抽出結果が4項目全てマッチ済みの場合、`extractOcrCandidates()`呼出し自体が完全な無駄コストになる」という指摘を独自に検証し正当と判断(arbitrate*は既存マッチがあれば候補を絶対に使わない設計のため)。GOAL.mdタスクCの既知の限界注記(候補昇格がほとんど発生しない可能性)と整合し、実際にコスト削減効果がある可能性が高い。decision-maker判断で「現状のPRのままマージ、最適化は別PRで対応」を選択済み。

### 次のステップ
decision-makerはタスクG(dev環境A/Bテスト本実行、対象文書数拡大)への着手を会話内で承認済み。ただしcontext残量が少なくなったため本セッションでは着手せず`/handoff`を実行して引き継ぐ。

## session120 サマリ（2026-07-13、GOAL.md記録漏れ解消 + A/Bテスト残差原因調査 + Issue #526 close）

catchupの「次にやるとよいオススメ」3件全てに着手。

### ① GOAL.md記録漏れのコミット
前セッション（session119）が`docs/handoff/GOAL.md`にsession119サマリを追記したがコミットされないまま終了していた（`/handoff`未実行）。main直pushを避け、featureブランチ（`docs/handoff-session119-record`）経由でPR #637を作成・マージ。

### ② A/Bテスト残差原因調査（GOAL.md監視事項、read-only）
GOAL.mdに残っていた「A/Bテスト事前実測(3.7〜4倍)と本番実測クリーン版(5.07倍)の乖離が未解明」という監視事項を調査し解明。GitHub Actions実行ログ（run 28941729429、2026-07-08T12:19）を遡り、`confirmed-replay`方式（kanameone実データN=60、PR#592-594）のコスト比較結果「5.53倍」の生ログを発掘。この5.53倍はsession107（PR #596）で一度確定していた実測値だったが、以降のセッションで出典を見失い「理論上の前提」として扱われ、比較対象として引用していたPR#559のA/Bテスト（n=11、dev合成fixtureの清潔な2ファイルのみ）との乖離が「未解明の残差」として記録され続けていた。5.53倍（confirmed-replay、実データ）と5.07倍（本番実測クリーン版）は9%差に収まっており、残差はconfirmed-replayのサンプル母集団バイアス（人間確定=過去に訂正が必要だった難しい文書のみ、N=60）で説明可能な範囲。「未解明の残差」は測定誤差ではなく比較対象の選択ミス（小サンプル合成fixtureとの比較を続けていたこと）が原因だったと結論し、GOAL.mdへ反映（PR #637に含めてマージ）。

### ③ Issue #526の着手判断 → 新規実装ではなく展開状況の再発見
catchupは#526を「着手指示があれば`/impl-plan`から即開始可能」な新規実装タスクとして提示していたが、Issue本文を確認したところdev実装（PR1〜4、#541/#542/#543/#544）は2026-07-04時点で完了・dev実機E2E検証済みで、残っていたのは「kanameone/cocoro展開待ち」の記録のみだったと判明（**session118が同じ発見をread-only確認していたが、close判断待ちのまま条件待ちに留め置かれていた**）。`gcloud functions describe`（splitPdf/processOCR）・Firebase Hostingチャンネル・Firestore rules release APIでkanameone/cocoro両環境のデプロイタイムスタンプを実測したところ、いずれもPR1〜4のmerge時刻（2026-07-04T04:23〜）より後（2026-07-08〜07-12、#547/#548トラックの一括デプロイに便乗）で、`git merge-base --is-ancestor`でも現mainにPR#544が含まれることを確認。**両環境とも既に本番展開済みと確定**。

本番UIでの実機機能確認は実施していない。`splitPdf`はIssue #432（P0データ破壊インシデント）の震源関数であり、Playwright MCPでkanameone本番へのログインを試みたがスタッフGoogleアカウントの認証情報を持たずブロックされた（サイレントSSOも未登録アカウントのため失敗）。decision-maker確認の上、dev実機検証（PR #544/PR5、実データE2Eで confirmed保護+OCR自動補完併存を実証済み）とデプロイ済みコードの同一性を根拠に実機テストを省略し、Issue #526へ状況をコメント記録の上closeした。

### Issue Net
close 1件（#526）、起票0件。**Net +1**。

### 引き継ぎ教訓
- Issueの進捗記録は「dev実装完了」と「本番展開完了」を分けて追跡しないと、既に展開済みの機能が「未着手」と誤認され続けるリスクがある（今回は2セッション連続で同じ発見を繰り返した: session118→session120）。次回同種の状況では、条件待ちに置いた時点でIssue本文自体に進捗コメントを残す運用が有効
- ブラウザ操作ツール誤選択（`claude-in-chrome` MCPをロードしてしまい、グローバルルール「Playwright MCP一択」に反した）に気づき次第、その場で訂正しPlaywright MCPへ切替。ツール選択ミスは実行前に気づけば実害ゼロ

## session119 サマリ（2026-07-12、#620/#622/#626完遂 + 本番2環境展開）

catchupの「次にやるとよいオススメ」から#620/#622/#626の3件をユーザー選択、dev実装→prod展開まで一気通貫で完遂。

- **#620**（`fix(pdf): splitPdf/rotatePdfPagesのNOT_FOUND誤診断メッセージを分離`、PR #634）: 親doc削除によるNOT_FOUNDが「二重split」と誤診断されるメッセージ精度問題を、`isFirestoreNotFound`ヘルパー追加で分離
- **#622**（`test(pdf): splitPdfConcurrencyGuardContract.test.tsのvacuous test riskを解消`、PR #635）: grep contractがsplitPdf固有の配線を実質保証できていなかった問題を、`extractSplitPdfFunctionBody()`でsplitPdf本体スコープに限定して解消
- **#626**（`perf(ocr): OCR実行の所有権チェックをPDFページループ内に前倒し`、PR #636）: 所有権チェックが最終tx時のみでsupersededされたrunがAPIコストを消費し切ってから破棄される問題を修正。3ファイル大規模のため`/codex review-diff --base main`も追加実施（findings 0）

各PRは`/safe-refactor`→`/code-review low`（全件findings 0）、マージは番号単位認可（AskUserQuestionボタン）。squash mergeでmain反映。dev実機確認: `seed-dev-data --force-pending`でPDF2件（11ページ）を実OCR処理させ`documentsProcessed:2,errors:0,superseded:0`を確認（#626の新チェックロジックが11回とも正常通過）。GitHub Actions「Deploy Cloud Functions」でkanameone/cocoro両環境にデプロイ、`gcloud functions describe`の`updateTime`でデプロイ反映を確認。3件ともIssue自動クローズ済み。

### Issue Net
close 3件（#620, #622, #626）、起票0件。**Net +3**。

### 引き継ぎ教訓
本セッション終了時に`/handoff`が実行されず、GOAL.mdへの追記（コミット未実施）とLATEST.mdへのセッション記録の両方が次セッション（session120）まで持ち越された。`/handoff`は「セッション終了時に手動実行」だが、実装完了直後に会話が途切れるケースでは記録が漏れやすい。

## session118 サマリ（2026-07-12、Issue #621完遂 + #526展開状態read-only確認）

`/catchup`のオススメに沿って2本立てで着手: ①#526（手動分割後OCR再処理連携）の展開状態read-only確認、②#621（P1バグ）のdev実装・検証・本番反映。

### #526展開状態のread-only確認
kanameone/cocoro両環境のFunctionsデプロイrun・Hostingデプロイrunのhead SHAが、#526のPhase A/B/C/D（PR #541-544、`82becd3`）の子孫であることをgit系譜で確認。firebaserules APIで両環境の配信中firestore.rulesを直接取得しローカルmainと完全一致（`documentTypeConfirmed`フィールド含む）、配信中JSバンドルにも#526由来のFE文字列を確認。**#526は両本番環境に展開済みと確定**（LATEST.md条件待ち「#526 kanameone/cocoro展開」のtriggerが充足）。close判断・分割操作自粛アナウンスはdecision-maker領分のため提示のみに留めた。

### Issue #621（splitPdf新エラーコードのFE未対応、P1）
Issue本文の対策案通り、`callFunction.ts`にFirebaseError.code取得ヘルパー`getCallableErrorCode()`を新設し、`already-exists`/`aborted`をコード基準で判定するよう変更。`PdfSplitModal.tsx`のcatch節に文脈別の日本語文言を追加、`usePdfSplit.ts`の`useSplitPdf`に`onError`を追加してキャッシュ無効化。

**品質ゲート3層で計4件のCONFIRMED回帰を検出・修正**（いずれも自分が今回追加したコードの新規バグ）:
1. `/code-review medium`（8角度並列）: ①onErrorの`invalidateQueries`が確認ステップ中の分割ポイント初期化`useEffect`を再発火させ、ユーザー確定値を無言上書き ②未知エラーコードで有用な生メッセージ（not-found等）が汎用文言に丸められる情報損失
2. `/codex review-diff`（P1）: 上記①の修正（`isConfirmStep`依存ガード）が「戻る」操作で同じ問題を復路でも再発させる設計欠陥 → docId単位の一度限り初期化(ref方式)に置換
3. `/review-pr`（comment-analyzer + silent-failure-hunter + pr-test-analyzer + code-reviewer 4エージェント並列）: ①自作の「戻る」回帰テストが`splitSuggestions=[]`固定のため実際には判別能力がなく検出できていなかった（新旧実装両方に対しRED/GREENを実機検証して書き直し） ②`callFunction.ts`のリトライ処理がリトライ後の実エラーを握りつぶし元のerrをthrowしており、本PRのcode-basedルーティング前提を壊す実害シナリオがあった → 修正
4. 残るHIGH/LOW指摘（`recheckParentBeforeRetry`のnot-foundにおけるdocId表示等）はrating中程度・実害未観測のためPRコメントに記録するに留めた（新規Issue化はtriage基準未達）

**UI実機確認**: `.env.local`が本番cocoro向け設定のまま残っていた既知の地雷（session108と同根、gitignored local state）を一時退避・復元する安全な手順でdoc-split-devへ切替、Playwright MCPで分割モーダルの正常系（分割実行→バッジ「分割済」変化→モーダル自動クローズ、コンソールエラー0件）を確認。`ui-verified`ラベル付与のうえマージ。

**マージ・展開**: PR #632を番号単位認可の上squash merge → Issue #621自動クローズ。mainマージでdev自動デプロイ成功後、kanameone（`deploy-hosting.yml`）・cocoro（ローカルFirebase CLI、`switch-client.sh`経由）両方へHosting展開、両環境ともHTTP 200・修正文言の配信をcurlで確認。対象がfrontend/src配下のみ（firestore.rules/Functions変更なし）のためHostingのみで完結した。

### Issue Net
close 1件（#621）、起票0件。**Net +1**。

### 引き継ぎ教訓
- 同一セッション内で3層の品質ゲート（code-review→codex review-diff→review-pr+codex）を通したところ、各層が異なる角度の回帰を検出した（層を重ねるほど収穫があった）。特にreview-prのcomment-analyzerが「自分が書いた回帰防止テストが実際には無意味だった」ことを検出したのは、テストの表面的なpass/failだけでなく判別能力（旧バグ版で本当にREDになるか）を検証する重要性を再確認させる事例だった
- `.env.local`が本番プロジェクトを指したまま残る問題（session108で一度発見・暫定復元していたもの）が今回も再発していた。恒久対策（`.env`をdev固定にする規約明文化等）は依然未着手、継続の要注意事項

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

session95〜113の詳細は `docs/handoff/archive/2026-07-history.md` 参照。

## 現在のフェーズ

**GOAL.md「OCR突合精度向上」ミッション（session121〜124）は2026-07-14 session124でクローズ済み（撤退基準適用、本番展開は見送り）**。タスクA〜H（候補抽出+arbitration実装、dev環境A/B検証N=10、kanameone confirmed-replay検証N=12）は完遂・全てマージ済みだが、`/codex plan`セカンドオピニオンとdecision-maker最終判断により、kanameone/cocoroへの本番展開（タスクI）は行わないことを決定。実装済みコードはrevertせずdev環境に残る（実害なし）。次のゴール設定はdecision-maker判断待ち（GOAL.mdファイルは前例（#547/#548）に倣い、次ミッション着手時にgit historyへ圧縮する運用）。

前ミッション（#547/#548コスト圧縮2トラック）は2026-07-10 session113で技術的完遂、2026-07-12 session117でPhase E本番実行の是正を完了・全22項目`[x]`。並行してsession118〜120でIssue #621/#620/#622/#626/#526（splitPdf/OCR周辺のP1/P2バグ+kaname要望E）を完遂・本番2環境展開済み。積み残しはP2 enhancement（#503/#251/#238、いずれも明示指示待ち）のみ。ゴール全体はdocs/handoff/GOAL.md参照（SessionStart hook自動注入）。

## 直近の変更（session89〜128、簡潔に）

- **session126〜128 (2026-07-14)**: 上記session126〜128サマリ参照。**Net 0（GitHub Issue非経由、read-only調査+ドキュメント整理のみ）**。decision-makerからkanameone7月請求急増（+797%）の確認依頼を受け、原因をFirestore移行作業由来の一過性「トリガーストーム」と特定（PR #651）。追加でFirestoreサイズ実測・Gemini21日分実測・Cloud Monitoring read_count実測・cocoro反映確認を実施し、「2倍以内」達成確度を60-75%→82-85%へ段階的に上方修正（PR #652）。LATEST.mdアーカイブも実施（session112〜113をarchiveへ移動）。
- **session121〜124 (2026-07-13〜14)**: 上記session124サマリ参照。**Net 0（GitHub Issue非経由、GOAL.md駆動ミッション）**。OCR突合精度向上ミッション着手→タスクA〜H完遂（PR #641〜#647）→タスクIで`/codex plan`セカンドオピニオン実施の上、decision-maker判断によりGOAL.md撤退基準を適用しミッションクローズ（PR #648）。kanameone/cocoro本番展開は行わず、dev環境検証+kanameone customer/office限定検証までで終了。
- **session120 (2026-07-13)**: 上記サマリ参照。**Net +1（起票0/close 1、#526）**。GOAL.md記録漏れをPR #637でコミット、A/Bテストコスト比率の「未解明の残差」を解明しGOAL.mdへ反映、Issue #526（実は展開済みだった）をコメント記録の上close。
- **session119 (2026-07-12)**: 上記サマリ参照。**Net +3（起票0/close 3、#620/#622/#626）**。3件のP1/P2バグをdev実装→本番2環境展開まで一気通貫で完遂。`/handoff`未実行のままセッション終了し、GOAL.md追記がコミットされず・LATEST.md記録も欠落（session120で両方是正）。
- **session118 (2026-07-12)**: 上記サマリ参照。**Net +1（起票0/close 1、#621）**。Issue #621（splitPdf新エラーコードFE未対応）をdev実装→3層品質ゲート(code-review/codex/review-pr)で計4件のCONFIRMED回帰検出・修正→PR #632マージ→kanameone/cocoro両本番Hosting展開完了。#526の展開状態read-only確認も実施（両環境展開済みと確定）。
- **session110 (2026-07-09)**: archive参照。Net 0（起票0/close0）。#547 Phase D本番展開完遂(cocoro/kanameone両環境Hosting+Functions)、GOAL.md更新(PR #607/#608)。
- **session109 (2026-07-09)**: archive参照。Net 0（起票0/close0）。#547 Phase D PR-D3(#601)/PR-D4(#602)実装+マージでPhase D実装フェーズ完遂、GOAL.md/ADR-0018のドキュメント整合性是正(PR #603/#604)。
- **session108 (2026-07-09)**: archive参照。**Net +1（起票0/close 1、#548）**。#547 Phase C全環境完遂+Phase D計画承認+PR-D1/D2マージ+GOAL.md新設(PR #597/#598/#599)。
- **session107 (2026-07-08〜09)**: archive参照。Net 0。#548統計検証完遂+#547 Phase C実装マージ(PR #592〜596)。
- **session106 (2026-07-08)**: archive参照。Net 0。個人情報コンプライアンス3層対応(PR #588〜591)。
- **session105 (2026-07-08)**: archive参照。Net 0。kanameone段階デプロイ・通常運用復帰。
- **session104 (2026-07-08)**: archive参照。Net 0。
- **session103 (2026-07-07)**: archive参照。**Net 1（起票0/close 1、#547）**。ADR-0018 Phase B (PR1〜PR5) 完遂によりIssue #547自体がclose、Netに正しく反映された数少ないセッション。
- **session102 (2026-07-07)**: archive参照。Net 0（起票0/close0）。#547 Phase B継続、PR2(PR #571)完遂という実質進捗はIssue単位のNetに非反映（#547自体はPhase C以降も残るためopen継続）。
- **session101 (2026-07-06)**: archive参照。Net 0（起票0/close0）。#547 Phase B着手、タスク0(PR #568)+PR1(PR #569)完遂という実質進捗はIssue単位のNetに非反映（#547自体はPhase C以降も残るためopen継続）。
- **session100 (2026-07-06)**: archive参照。Net 0（起票1/close 1、#562のみ）。#548の主要スコープ(3.5移行スイッチ本体のdev実装+実機検証)を完遂したが、Issue #548自体は本番展開が残るためopenのまま継続（実質進捗はIssue単位のNetに非反映）。
- **session99 (2026-07-06)**: archive参照。Net 0（起票0/close 0、#548 A/Bテストharness実装+実機PASS確認+Issue #548コメント記録という実質進捗はIssue単位のNetに非反映）。
- **session98 (2026-07-06)**: archive参照。Net 0（起票0/close 0、#547事前計測完遂+ADR-0018起票+#548単価確認・A/B計画策定という実質進捗はIssue単位のNetに非反映）。
- **session96 (2026-07-05)**: archive参照。Issue #546（計測基盤+SDK移行+thinking制御）実装完遂・PR #550マージ・dev環境デプロイ完了。Net -1（close #546のみ）。
- **session95 (2026-07-04〜05)**: archive参照。Net -5（起票6/close 1、コスト3件はuser明示指示+実害根拠、バグ3件は#526設計中に発見した実バグでtriage充足）。
- **session93 (2026-07-03)**: kaname新規要望B/C/D/E/F受領→B/D/F実装・merge・close。E(#526)は設計判断ゲート3点待ちで持越し（→session95で解消）。Net -1。
- **session92 (2026-07-02〜03)**: #492 Ambiguous重複docs整理完遂→close。Net -1。
- **session91 (2026-07-02)**: ADR-0017実戦実証（7.9hストーム自動吸収）→Accepted昇格。Net 0。
- **session90 (2026-06-12)**: 429専用retry+rescue backstop（PR#516+ADR-0017）3環境deploy。Net 0。
- **session89 (2026-05-20)**: #504/#402 close。Net -2。

session29〜94の詳細は `docs/handoff/archive/2026-0{4,5,6}-history.md` 参照。

## 次のアクション（3 分割・SKILL.md §2.5 参照、session128時点）

**🎯 GOAL.md ミッションクローズ（撤退基準）**: `docs/handoff/GOAL.md`の「OCR突合精度向上」ミッションは進行中tasks A〜H完遂・タスクIで撤退基準適用によりクローズ（session124）。前ミッション（#547/#548）分の全22項目`[x]`も継続中。session126〜128でその監視・確認事項（コスト圧縮効果検証）を大幅に進展させ、「2倍以内」達成確度は82-85%まで上方修正済み（詳細はGOAL.md監視・確認事項参照）。次のゴール設定・GOAL.mdファイル取扱い（前例に倣いgit historyへ圧縮 or 新ミッション追記）はdecision-maker判断待ち。

### 即着手タスク

即着手タスクなし（session128時点でread-only検証としてやれることはやり切った状態。残る候補は全てdecision-maker領分のtrigger待ちまたはROI低のため、下記「条件待ち」「却下候補」に分類）

### 条件待ち（明示 trigger 付き）

| # | 項目 | trigger | 充足時のタスク | 確認方法 |
|---|------|---------|--------------|---------|
| 1 | **#547 egress実削減効果の請求確認（最終確定）** | 翌月請求発行（2026-08上旬想定） | kanameone/cocoro請求のFirestore項目（3.5移行前基準: ¥4,645/月egress）とPhase E実行前後を比較し実削減額を確認。session126〜128で確度82-85%まで上方修正済みのため、この最終確認は「確定判定」の意味合い。GOAL.mdに記録 | 請求ダッシュボード確認 |
| 2 | #548-B4 再処理「再突合のみ」モード | UI仕様のdecision-maker判断 | 2モード化実装 | user回答 |
| 3 | 継承事項: PR#474 close / `.artifacts/`扱い / #503・#251・#238 / CLAUDE.md切り出し / 「Gemini 2.5 Flash」表記15+箇所更新 / **frontend/.envフォールバックの恒久対策**(session108発見、session118でも再発を確認・一時退避/復元のみで暫定対応。`.env`をdev固定にする規約明文化等の恒久対策は依然未着手) / `.serena/project.yml`の未コミット変更(Serena MCPツールによる自動更新、本セッション作業とは無関係、コミットor破棄はdecision-maker判断) | decision-maker明示指示 | 各項目参照 | — |
| 4 | session105継承: Functionsデプロイ3経路のSTORAGE_BUCKET/GEMINI_MODEL_ID設定統一 | decision-maker明示指示 | 3経路の共通化 | archive session105参照 |
| 5 | session115〜117のLATEST.md詳細サマリ遡及記載 | decision-maker明示指示 | GOAL.md/ADR-0018/コミット履歴から#539/#540/#625/#547是正の詳細を書き起こす | 既存情報源で代替可能なためROI低、指示があれば着手 |
| 6 | OCR突合精度向上ミッション（タスクIでクローズ）でkanameone confirmed-replay検証時に判明した「baseline自体の一致率が低い（顧客33.3%/事業所41.7%）」原因未解明 | decision-maker明示指示 | 原因分類調査（マスター変更/表記差/OCR差/ロジック差）→再検証要否判断 | GOAL.mdタスクH/I参照、着手指示があれば`scripts/compare-ocr-arbitration-logic-confirmed.ts`が起点 |

### 却下候補（記録のみ）

| 項目 | 経緯 | 着手しない理由 |
|------|------|--------------|
| **OCR出力のエンティティリスト化（−¥11,000/月級）** | コスト分析で最大レバー。session112/113で「真の黒字化に必須」と再確認 | 3.5移行後の実測を見てdecision-makerが判断する保留カード（#548 closeコメントに記録済み）。GOAL.mdスコープ外 |
| processOCR head-of-line blocking対策 | Codex指摘で実在確認 | 実害未観測。pending滞留観測時に別Issue化 |
| detail/mainパスのヘルパー抽出（writer側9箇所） | Phase B以来の継続指摘。**読者側はPR-D2のreadDocWithDetailで部分集約済み** | writer側の3コンパイルコンテキスト共有はPhase F(cleanup)の設計判断。着手指示待ち |
| OCR全文検索の代替基盤 | Phase D計画時に調査 | **dead code判明で緊急性消滅**（検索窓はサーバー側インデックスでOCR全文は元々対象外）。必要になれば別プロジェクト規模 |
| #503/#251/#238（P2 enhancement） | rating 5-6相当の任意改善 | 明示指示なし |
| OCR突合精度向上機能のkanameone/cocoro展開（Codex提案b/c: 追加人手ラベリングでN拡大、約60件試算） | `/codex plan`セカンドオピニオンで提案 | decision-maker最終判断で「不安定さ・不十分さがあれば基本はしない」原則により見送り。GOAL.md不変条件の撤退基準を適用済み |

### 残留プロセス（マシン全体スコープ、現在のプロジェクトに限らない）

残留プロセスなし（本セッション実行時点で検出なし）。

### 最終結論（session128末尾）

✅ **セッション終了可** — OPEN PR 0件（#651/#652全てsquash mergeし、リモートブランチも削除済み。本handoffのPRはこの後作成・マージ予定）、git clean（`.artifacts/`のみ既知の継続保留untracked）、CI: 直近のRun Operations Script実行はいずれもsuccess、GOAL.md「OCR突合精度向上」ミッションはクローズ済み・前ミッション（#547/#548）の監視事項をsession126〜128で大幅進展（確度82-85%）、即着手タスク0件・条件待ち6件、残留プロセスはtsserver等の開発ツールプロセスのみ（現プロジェクトのIDE支援用、cleanup対象のゾンビプロセスではない）。

§4.6同根再発スキャン: 本セッションは`fix:`/`hotfix:`プレフィックスやIssue/障害復旧目的のPRを作成していない（調査・ドキュメント記録が主）ため発動条件（修正PR1件以上）非該当。

§4.7対症療法判定: 上記理由によりスキップ。
