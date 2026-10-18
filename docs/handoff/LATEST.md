# ハンドオフメモ

**更新日**: 2026-10-18（大判PDFのpaddle-ocr `signal 9`の実測・dev再現・長辺上限の適用・3環境展開まで完了。以前: 2026-10-15（Gemini廃止後の約1週間の稼働確認・散発ERRORの調査・GOAL.md訂正まで完了）。以前: 2026-10-10（Paddleの高画素数画像のメモリ不足の対応完了）。以前の履歴は各節と`docs/handoff/archive/`を参照）

## 大判PDFのpaddle-ocr `signal 9`: 実測・dev再現・長辺上限の適用・3環境展開（2026-10-18、ADR-0030追記）

### 結果
- **原因の絞り込み**: kanameoneで2026-10-15に`paddle-ocr`が`signal 9`(503)で4回落ちた。失敗書類のPDFページ寸法を実測(`measure-pdf-page-dimensions`、PR #1163、Actions経由・書類名は出力なし)したところ、503が出た3件のうち2件は**1ページ目だけがA3横**(1191×842pt、約773万画素)だった。
- **dev再現**(合成PDF、実データなし、`paddle-ocr-pdf-probe`、PR #1165): A3横の1ページ目は**3回中3回初回503**(同時刻に`signal 9`)。A4と704×1000pt(約543万画素)は3回とも成功。PDFには画像のような長辺縮小が無かったことが原因として強く疑われた。
- **対策**(PR #1166、ADR-0030追記): PDFページにも長辺上限`MAX_PDF_LONG_SIDE`(既定2500px、画像と同値)。超えるページだけ最初から縮小後の倍率で描画し、A4は描画手順が不変。縮小ページは`PDF_PAGE_DOWNSCALED`をWARNINGでログに残す。追加費用なし(8GiB化は採らず)。ロールバックは環境変数に大きな値。
- **dev検証**: A3横の合成PDFが3/3初回成功・`signal 9`ログ0件(対策前は3/3で503)、A4のgolden 18/18完全一致、サービスのテスト79件pass。
- **本番展開**(main `0e08fc5c`): kanameone `paddle-ocr-00004-wgc`・cocoro `paddle-ocr-00004-qzx`、いずれもReady。`MAX_PDF_LONG_SIDE`は環境変数未設定でコード既定の2500が効く。本番の書類画面は見ていない。

### 判断・品質ゲート
- 上限値2500pxと、精度確認は最小限(A4不変とA3が落ちないこと)に留めることは、decision-makerの決定。plan modeで計画承認、TDD、`codex review`2回(最終指摘のログレベルは修正済み・修正後の差分はcodex未確認)、レビューエージェント3種の指摘を反映。PRマージ(#1163・#1164・#1165・#1166・#1167)と本番2環境のデプロイは、いずれも番号単位・環境単位の承認後。
- plan modeのOpus自動切替は通知が出ず失敗(`/model opus`で手動切替し、承認後に`/model opusplan`へ戻した)。

### クライアントへの報告
- **kanameoneへ2026-10-19に報告送付済み**(decision-makerが送付)。内容: 発生状況(10/15の4回・処理が数分遅れた書類3件・欠落とエラーなし)、原因(大きな用紙のページでの作業用メモリ不足と判断、確認用環境で再現)、対応(大きな用紙のページは内部で縮小して処理、10/18反映済み、追加費用なし)、今後の確認。A3縮小後の読み取り精度は未測定と明記した。
- **報告に含めなかったこと**: kanameoneで約543万画素の書類が1件503になったが対策で防げるか分からない件、社内の検証・レビューの詳細。クライアントから質問があった場合は、この節と下記「未解明・未測定」を根拠に答える。
- **cocoro向けは未送付**(cocoroは10/14に1回、処理中の書類なし)。必要になった場合は宛先・日時・件数を差し替えて使う。

### 未解明・未測定(GOAL.mdに記録済み)
- A3縮小後(約151dpi相当)の読み取り精度は未測定(goldenはA4のみ)。
- kanameoneで約543万画素の書類も1件503になったが、devの約543万画素は3回とも成功。画素数だけでは説明できず、巻き添えの可能性を含め未解明。
- 本番で長辺2500px超のPDFがどれだけあるか(縮小される割合)は未集計。

### 同根再発スキャン・対症療法判定(handoff §4.6・§4.7)
- **同根候補 2 件**: PR #1148・#1150(2026-10-09、画像の長辺縮小)と今回の#1166は、症状(`signal 9`/503)も層(paddle-ocrの推論メモリ)も同じ。入力経路が画像からPDFに移っただけで、**同根の再発**として扱う。
- **真の root cause の仮説**: (1)エンジン(Paddle推論)のメモリ使用が入力の画素数に応じて大きく増える。上流にも類似の報告がある(PaddleOCR issue #17955、PaddleOCR 3.4.1/PaddlePaddle 3.3.1・CPUで巨大な常駐メモリ。当方は3.2.2固定で直接の該当は未確認)。入力寸法の上限はこの層への妥当な防御 (2)4GiBの余裕が小さく、同時処理や断片化と組み合わさって閾値以下でも落ちる(kanameoneの約543万画素の1件を説明できる可能性) (3)描画寸法以外に、文字の密度・検出数が効く(合成PDFでは1ページ約33〜40秒と本番の6〜9秒より遅く、負荷が重い)。
- **もう1件同根が出るとしたら**: 長辺は2500px以下でも面積が大きいページ(例: 正方形に近い2500×2500=約625万画素。画像の実測では約7Mpx以下は成功)、極端に文字が密なページ、または複数ページの連続処理での累積。
- **対症療法判定**: 該当(基準3: 同症状の修正が30日以内にある)。WebSearchで外部要因を確認したが、3.2系固有の既知問題・修正は見つからなかった(上流issueは3.3.1以降の報告)。ただし今回の修正は、dev再現の前後で3/3失敗→0/3、A4のgolden不変を実機で確認しており、単体テストだけの検証ではない。根本のメモリ挙動はエンジン側(外部)で、入力上限による防御が現実的な解と判断した。**根拠は上記。メモリ使用量そのものは未計測**。

### 次回
- 次の定期確認(読み取り・件数のみ)で、`paddle-ocr`の`signal 9`の有無と`PDF_PAGE_DOWNSCALED`が出たページの書類が`error`にならないかを見る。再発時のロールバックは`MAX_PDF_LONG_SIDE`に大きな値。

## Issue Net変化(2026-10-18)
- Close 0件、起票 0件、Net 0(openのIssueは3件: #956・#901・#238)。起票しなかった理由: 実害は再試行で復旧しており、原因の調査と対策をPRで完結させたため。

## Gemini廃止後の約1週間の稼働確認・散発ERRORの調査・GOAL.md訂正（2026-10-15、ADR-0029）

### 結果
- **実環境の直接確認**: 3環境とも`processOCR`の`OCR_PROVIDER=paddle`・`SUMMARY_PROVIDER=sarashina`。コードに`@google/genai`等のGemini SDKのimportはなし(`utils/retry.ts`のコメントのみ)。
- **直近24時間のERROR(2026-10-14)**: ①kanameone `processocr` 504(32ページPDFを約18分かけて処理、05:38に`errors: 0`で完了。リクエストタイムアウト超過の記録と見られるが因果は断定できない) ②cocoro `paddle-ocr` 503(`signal 9`、待機中に落ち約1.4秒後に復旧、処理中の書類なし)。どちらも書類は`error`にならず実害なし。
- **メモリ使用率**(cocoro `paddle-ocr`、1分p99): 落ちる直前まで57%で横ばい。**OOMとは断定できない**(直前数秒のスパイクは拾えない、`signal 9`はOOM以外でも出る)。
- **期間全体の`paddle-ocr` 503**: kanameone 10/7に3件・10/8に24件(再試行を伴う集中)、dev 10/9に17件、cocoro 10/9に1件。10/9以降の再発は10/14の2件のみ。集中の形は前節の「高画素数画像のメモリ不足」と整合するが、時刻と書類の突合は未実施。
- **GOAL.mdの訂正**: 10/8の「ERROR0件」確認は`processocr`のみが対象で`paddle-ocr`は未確認だった点を明記(PR #1158・#1159・#1160)。
- **クライアント報告**: 文面は決定済み、送信はdecision-makerが行う。kanameone向けは「切替直後に高解像度画像で一時的な失敗が1件あり対応済み、書類の欠落なし」、cocoro向けは失敗の文を除く。「順調」は精度・速度を含むように受け取られるため「文字読み取りは約1週間安定して稼働」の表現にする(要約機能は今回未確認)。

### 同根再発スキャン・対症療法判定
- 同根候補: 10/7〜10/9の503集中は既知の高画素数画像の件(PR #1148等で対応済み)。10/14の2件は症状が異なり(待機中の`signal 9`/長時間処理の504)、同根とは断定できない。仮説(cocoro): ①直前数秒のメモリスパイク ②プラットフォーム側の強制終了 ③min-instanceの健全性異常。再発しうる経路: 大判PDF。
- 対症療法判定: 本セッションは修正PRなし(docsのみ)で該当なし。

### 注意(再発防止)
- **catchupのサブエージェント要約の「ERROR 0件」を鵜呑みにしない**。ERRORの確認は`processocr`と`paddle-ocr`の両方、期間を明示して実環境のログを直接見る。
- 切替前後の処理速度・精度の比較、滞留件数の前後比較は未実施(GOAL.mdの`[ ]`2件)。
- `processocr`のログに書類名・顧客名が出力される(Cloud Logging内)。

## Issue Net変化(2026-10-15)
- Close 0件、起票 0件、Net 0(openのIssueは3件: #956・#901・#238)。起票しなかった理由: 実害なしの散発ERRORで、triage基準を満たさないためGOAL.mdに記録。


## Paddleの高画素数画像のメモリ不足: 原因確定・自動縮小・3環境展開・実書類の再処理成功（2026-10-09〜10、Gemini廃止の副作用への対応）

### 結果
- **発端**: kanameoneの`error`1件(画像書類、`PaddleOCR request failed: 503`)。**原因は`paddle-ocr`(4GiB)のメモリ不足**(`Container terminated on signal 9`)。devで合成JPEG(実データなし、PR #1147のプローブ)により再現し、4GiBでは7Mpx以下は成功・7.7〜9.2Mpxは不安定・9.7Mpx以上は確実に失敗、**8GiBでは同じ画像が全て1回目で成功**したため確定(メモリ使用量そのものは未計測)。cocoroでも修正前に同じクラッシュが1回起きていた(2026-10-09 09:56Z、再試行で自己回復、`error`は0件のまま)。
- **対策(追加費用$0、メモリ4GiBのまま)**: OCRエンジンへ渡す前に長辺が上限を超える画像を縮小(`MAX_IMAGE_LONG_SIDE`、既定**2500px**)。**縮小はOCR入力のみで原本は不変、PDFには適用しない**。PR #1148(縮小)・#1150(既定を3000→2500pxに)。上限は、4GiBのまま6種類の画像を順に送り「1回目の503が0件」を基準に決定(2500pxは6件成功、3000pxは2件が1回目503で1件は再試行でも失敗)。
- **精度確認**(PR #1149のツール): 縮小あり(2500px)でgolden由来12件すべて類似度1.000。**判定力が低い**(約63〜66文字の大きな印字)ため「落ちるとしても検出できない」という弱い結論。
- **展開**: dev・kanameone・cocoroの3環境(`deploy-paddle-ocr.yml`、番号単位の承認)。メモリ4Gi・min1/max3・URL・`OCR_PROVIDER`は不変、縮小上限は上書きなし(コード既定)。devのプローブで6件すべて1回目成功。
- **実書類での確認**: 該当`error`1件を`fix-stuck-documents --doc-id`で`pending`に戻し、リトライなし(`retryCount` 0)で`processed`(`ocrExtraction.version`=`PP-OCRv6_medium`)。kanameoneの`error`は0件。確認は`status`・`version`・件数のみで書類の内容は参照していない。
- **公開ログの扱い**: `fix-stuck-documents`が書類名を`console.log`しており(リポジトリは公開)、Actions経由の実行で顧客の書類名が公開ログに残る状態だった。実行前に気づき、書類IDとステータスのみに修正し契約テストで固定(PR #1151)。PR説明文4件とコードコメントの書類種別の例示も一般的な表現へ(#1153ほか)。
- マージしたPR: #1145・#1146(GOAL.mdの記録)、#1147〜#1151、#1152(経緯の記録)、#1153。

### 検証(実測、2026-10-10の最終確認)
- 3環境とも新リビジョンが100%配信(dev `00032`、kanameone `00003-tb6`、cocoro `00003-rkd`)、メモリ4Gi、`MAX_IMAGE_LONG_SIDE`は未設定(既定2500px)。本番2環境の`pending`/`processing`/`error`はすべて0件。展開後(12:17Z〜)のERROR以上は`paddle-ocr`・`processocr`とも0件(cocoroの1件は展開前の旧リビジョンの`signal 9`)。
- テスト: `scripts`(Node 20)864件PASS、`services/paddle-ocr`(pytest)56件PASS。

### 次のアクション
**即着手**: なし(executor領分の作業ゼロ)。
**条件待ち**: ①**画像書類の実績確認**(特にcocoro。trigger=画像書類の流入。確認方法=`documents`の`processedAt`が2026-10-09T12:20Z以降の`status`・`ocrExtraction.version`の件数のみ、`paddle-ocr`の`signal 9`・5xxが0件か、処理時間が処理上限240秒に近づいていないか。書類の内容は見ない)。②`docs/client/client-setup.md`の文言の最終確認(decision-maker)。③**運用スクリプトの書類名出力**(trigger=`run-ops-script.yml`の他スクリプト(`inspect-document`・`cleanup-duplicates`等)を実行する直前。その1本に限り`fileName`・顧客名を`console`出力しないかを読み取りで確認し、出していれば実行せず報告する。棚卸し全体は未実施)。
**却下候補**: ①メモリ8GiB化(月約$26/環境、公式単価の概算で実額は請求画面で確認。再発時のみ。理由=縮小で$0のまま安定したため)。②縮小の上限のさらなる引き下げ・精度確認ツールの強化(判定力の向上、新規価値創出で起点は決裁者)。③**大きな用紙サイズのPDFへの対応**(A3を200dpiで展開すると約7.8Mpxで不安定領域に近い。`MAX_PIXELS`=40Mpxでは弾かれない。PDFは今回の縮小の対象外。trigger=大判PDFの`error`・503が実際に出た時。検討した経緯=同根再発スキャンで気づいた「もう1件同根が出るとしたらこの経路」。着手しない理由=実績ゼロで、PDFのdpi変更はgolden再現性に影響するため決裁者判断)。

### 注意(再発防止)
- **公開リポジトリのActionsログ・PR説明文・コードコメントには、顧客の書類名や書類種別(要配慮個人情報にあたりうるもの)を書かない**。運用スクリプトを実行する前に、標準出力へ`fileName`等を出さないかを確認する。
- zshでは`$P:t`が修飾子として解釈される(URLは`${P}:...`)。`switch-client.sh`は`source`で読み込む。ローカル`functions`用のmochaをNode 26で動かす後処理hookは`scripts/`のテストでも失敗表示になる(誤作動。`scripts`のテストはNode 20で実行する)。
- 画像書類の処理時間は、合成画像(数字が密)で70〜100秒、golden画像で8〜13秒と、内容で大きく変わる。実書類の処理時間は未測定。

## Issue Net変化(2026-10-10)
- Close 0件、起票 0件、Net 0(openのIssueは3件: #956・#901・#238)。起票しなかった理由: 今回の障害は同一セッション内で原因確定・対策・展開まで完了し、triage基準(実害・再現バグ)を満たす積み残しは、条件待ちとしてGOAL.md・本ファイルに記録したため。

## Gemini廃止の仕上げ: 24時間ERRORログ確認・GCP側の無効化(3環境)（2026-10-08、ADR-0029）

### 結果
- **24時間のERRORログ確認**: 展開時刻以降(約29時間)の`processocr`のERROR以上は、dev・kanameone・cocoroとも0件。同条件で全ログが拾えることを対照で確認。
- **GCP側の無効化(番号単位の承認7・8・9)**: 3環境で`roles/aiplatform.user`を剥奪(devは`hy.unimail.11@gmail.com`の個人分を残した)し、`aiplatform.googleapis.com`を`--force`なしで無効化。独立に再確認し、3環境とも有効サービスに無い。devは無効化後に再投入したダミー書類が`processed`、`version`はPaddle系。kanameone・cocoroも無効化後の数分間はERRORなし。
- **事前調査(読み取り)**: aiplatform APIの日別利用は、展開後3環境とも0件。kanameoneに`StreamGenerateContent`(v1)54件(2026-10-04〜05、展開前)があるが呼び出し元は未解明(本番コードは`generateContent`系のみ使用、判断への影響なし、調査は見送り)。
- **peerの助言**: PaddleOCR(`wan-vpn-ipsec-setup`): paddlepaddle 3.2.2固定・mkldnn有効は適用済み。small+ONNX化・評価時の正規化・劣化画像の測定は条件待ちとしてGOAL.mdに記録(PR #1142)。返信は送信済み。Gemini(`sanwa-houkai-app-cd`): 廃止の報告は不要とのご判断で送っていない。
- PR #1141(handoff)・#1142(助言の記録)・#1143(無効化の結果)をマージ。

### 次のアクション
**即着手**: なし(executor領分の作業ゼロ)。
**条件待ち**: ①kanameone・cocoroで新規書類の`ocrExtraction.version`がPaddle系であることを確認(trigger=書類の流入、読み取りで確認。確認方法=`documents`の直近`done`書類の`ocrExtraction.version`が`PP-OCRv6_medium`系か)。②`docs/client/client-setup.md`の文言(「外部の生成AIサービスへ送信することはありません」)の最終確認(trigger=decision-maker)。
**却下候補**: kanameoneの`StreamGenerateContent` 54件の呼び出し元調査(無効化済みで判断に影響しない)、small+ONNX化(速度が課題でない。triggerはOCR処理時間の問題化)。

### 注意(再発防止)
- zshでは`$P:t`が修飾子として解釈される(URLは`${P}:...`)。`set -- $VAR`は分割されない。取得失敗が「0件」と表示されることがあるため、対照(別条件で拾えること)で確認する。
- `switch-client.sh`は`source`で読み込む(別プロセスでは切り替わらない)。kanameone用の設定は再ログイン(`gcloud auth login --configuration=kanameone`)が対話式で必要になることがある。`hy.unimail.11@gmail.com`はkanameoneで`setIamPolicy`の権限がない(API無効化はできる)。
- 本番書類の状態確認は、OCR全文を含むJSONを`strict=False`+`mask`で取得する。

## Issue Net変化(2026-10-08)
- Close 0件、起票 0件、Net 0(openのIssueは3件)。

## Gemini(Vertex AI)の完全廃止: 緊急用OCR経路も含めて撤去し、3環境へ展開（2026-10-07、ADR-0029）

### 結果
- **決定(2026-10-06)**: 安全上の理由で、緊急時も含めてGeminiを使わない。根拠は、東京の従量課金が公式サポート外であること(公式モデルページ2026-10-05)、要配慮個人情報を扱う方針、緊急利用の実績が3環境とも0件であること。
- **PR #1137**(コード・CI・テスト・UI・重要文書): `ocrWithGemini`・料金表・`rateLimiter.ts`・`processOCROnCreate.ts`・`@google/genai`依存を削除。`parseOcrProvider`は不明値を警告のうえ`paddle`へ。`deploy-functions.yml`・`deploy-to-project.sh`は宣言値`gemini`をoverrideより前に拒否(exit 1)。契約テスト(許可リスト空)と、デプロイ拒否順序の契約テストを追加。レビューは`codex review`2回(最終は指摘0件)・独立evaluator・`pr-review-toolkit`2本。
- **PR #1138**(残りの文書、docs-only)、**#1139**(ADRに本番リビジョン確認結果)、**#1140**(GOAL.mdの再開点)。
- **展開(番号単位の承認)**: dev=mainの自動デプロイ、kanameone・cocoro=`deploy-functions.yml`(全入力`code-default`)。Hosting(HelpPageの文言)はkanameone・cocoroをGHAで反映、3環境の配信バンドルで旧文言なし・新文言ありをcurlで確認。

### 検証(実測)
- 3環境とも`OCR_PROVIDER=paddle`・`SUMMARY_PROVIDER=sarashina`・`GEMINI_MODEL_ID`なし(`gcloud functions describe`)。展開直後1時間のERRORログは本番2環境で0件。
- dev: 12ページのダミー書類が`processed`、`ocrExtraction.version`=`PP-OCRv6_medium/…`。Cloud Runの`paddle-ocr`を00022→00021→`--to-latest`で戻し、100%復帰を確認。本番2環境は戻し先(直前リビジョン)がReadyであることまで確認(動作は未確認)。
- テスト(Node 20): functions 2547件・scripts 814件PASS。

### 次のアクション
**即着手(2026-10-08の夕方以降)**: ①3環境の`processocr`で展開後24時間のERRORログを読み取りで確認(証明: `gcloud logging read 'resource.labels.service_name="processocr" AND severity>=ERROR' --project=<各project> --freshness=24h --limit=1`が出力なし)。展開時刻はkanameone 2026-10-06 16:43 UTC、cocoro 同16:52 UTC。工数は小。
**条件待ち**: ②Vertex AI API無効化と`roles/aiplatform.user`剥奪(trigger=①が問題なし+環境ごとの番号単位の承認)。③kanameone・cocoroで新規書類の`ocrExtraction.version`がPaddle系であることを確認(trigger=書類の流入)。④`docs/client/client-setup.md`の文言の最終確認(trigger=decision-maker)。
**却下候補**: トークン数項目・`SummaryProvider`の`'gemini'`値の整理はADR-0029でスコープ外。

### 注意(再発防止)
- 公式資料の読み(データ所在地の表と課金形態)を取り違えた。個別の公式ページで確認してから断定する。
- 状態確認のポーリングでJSON解析が失敗していたのに、20回空振りしていた。取得結果が空ならまず取得・解析を疑う。OCR全文を含むJSONは`strict=False`とフィールド指定(`mask`)で取得する。
- 本番の画面は開かず、配信バンドルのcurl確認で反映を確認した(Playwrightには本番ログインが残りうる)。

## Issue Net変化(2026-10-07)
- Close 1件(#714: Geminiの完全廃止で前提が消えたためclose)、起票 0件、Net +1(open Issueは4件→3件)。

## 通常経路のGemini停止: PR-C(要約の手動・非同期化)とPR-E(要約のGemini経路の撤去)完了（2026-10-06）

### 結果
- **PR-C(#1124/#1126/#1127、本セッション前半)**: 要約を手動・非同期に一本化。依頼はキュー登録のみ(onCall)、生成は1分ごとのバッチが直列実行。OCR完了時の自動生成は廃止。受付はOKボタンのダイアログで、時間がかかる理由(要配慮個人情報を安全に扱うため)を併記。kanameone・cocoro(要約は準備中)へ展開済み。
- **PR-E(#1130)**: 要約のGemini経路(`summaryGenerator.ts`、旧`SUMMARY_PROVIDER=gemini`)と評価用の比較スクリプト群を撤去。`@google/genai`を参照できるのは`ocrProcessor.ts`(OCR緊急用)だけで、構文解析の契約テスト(functions 50件・scripts 3件)がCIで固定。PDF分割関数は`scripts/lib/pdfPages.ts`へ切り出し。`SUMMARY_PROVIDER=gemini`は警告つきでnoneに倒れる。
- **検証**: dev(手動要約が`outcome=done`、61秒 / paddle-ocr-verify load tier1 quickが`failedPageCount=0`)。本番2環境を再デプロイし、環境変数は不変(`GEMINI_MODEL_ID`は両環境とも未設定=コード既定3.5 Flash)、バッチに警告以上のログなし。3環境とも`gemini_ocr_emergency_used`は48時間0件。GOAL.mdの完了の定義3項目を`[x]`。
- **レビュー**: 計画はgrip+codexのクロスレビュー、実装はcodex review(指摘0件)・Evaluator(APPROVE)・pr-review-toolkit 3本。

### 教訓
- ローカルの`functions/.env.<project>`の値(`GEMINI_MODEL_ID=gemini-2.5-flash`)は本番の実態ではなかった。展開前に`gcloud functions describe`で実値を確認したため、「再デプロイでモデルが変わる」懸念は杞憂と確定できた(プロジェクトCLAUDE.mdの既存ルールの再確認)。
- 契約テストの対象を「SDKのimport」だけにせず、「要約経路から到達できない」「REST直叩きの文字列がない」まで広げ、検出の穴(動的import・コメント内の誤検知)は構文解析で塞いだ。未解決の相対importは黙ってスキップせず失敗にする。
- 手元のHomebrew Nodeがセッション中にv26へ上がり、mochaがESMエラーで動かなくなった。CIはNode 20なので、手元ではnode@20をPATHに入れて確認する。
- CIは約20分かかる。マージ承認を取る前に完了を待つ運用にした。

### 次のアクション
- **即着手**: なし(executor領分の作業ゼロ)。
- **条件待ち**: ①PR-A確認(cocoro)(trigger=cocoroで新リビジョンが文書を処理。確認=`gcloud logging read`で`candidateGeminiMs`が出ないこと) ②PR-B確認(3環境)(trigger=デプロイ後の新規処理文書。確認=`ocrExtraction.version`が`PP-OCRv6_medium`。ローカルADCはFirestoreに届かないため、読み取り専用スクリプトをGitHub Actions経由で用意する必要あり。用意自体はdecision-makerの指示を待つ) ③PR-D(cocoro)(trigger=decision-makerがcocoroでSarashinaを使うと決めたとき。利用実績は95日間で0件、基盤構築の費用との見合いを判断)。
- **却下候補**: language-mix検知のブロック化(誤検知の実測データが無く、ログのみで運用中。実測してから別途判断) / 要約の自動生成の再開(手動基本の方針、decision-makerの指示があれば`autoSummaryOnOcr`で再開可能) / 削除済みスクリプト名が残るコメントの一括整理(実害なし) / `SUMMARY_PROVIDER`不正値の警告の昇格(デプロイ前検査で入口が塞がれており、実害なし)。

### 最終結論
✅ **セッション終了可** — OPEN PRゼロ(本ハンドオフPRを除く)、Git clean、即着手なし、条件待ち3件(いずれもdecision-makerの指示または新規処理待ち)。

## 通常経路のGemini停止: PR-A/PR-B/PR-D0完了（2026-10-03）

### 結果
- **発端**: 契約書第7条の整理で顧客データの送信経路を洗い出したところ、kanameone/cocoroのOCRが2026-09-23〜25にGeminiへ黙って戻っていた(`deploy-functions.yml`が`ocr_provider_override=code-default`のたびに`functions/.env.<project>`を再生成し、`OCR_PROVIDER`宣言が落ちていた)。PR #1114で再発防止し再デプロイ済み。
- **PR-A(#1116)**: 候補抽出(Pass2)を廃止(実データで採用0件、ADR-0025決定事項2の廃止目安を満たす)。Geminiを呼ぶ運用スクリプトの実行経路を閉じた。kanameoneはデプロイ後リビジョンのログで`candidateGeminiMs`なしを確認。**cocoroは新リビジョン`processocr-00058`の処理文書がまだ無く未確認**。
- **PR-B(#1117)**: OCRの倒れ先をpaddleへ反転(未設定・未知値はpaddle、`gemini`は明示指定時のみ)、緊急利用ログ`gemini_ocr_emergency_used`、reset系スクリプトのpreflight、納品ガイドに緊急手順と新規テナント前提を追記。3環境へデプロイし`OCR_PROVIDER=paddle`を`gcloud functions describe`で確認、緊急ログは24時間で0件。
- **PR-D0(#1118)**: `check-sarashina-summary-canary`(読み取り専用)。ゲート(1)Sarashina生成のdoneが90%以上(分母10件以上)/(2)捏造疑いの最終error 0件/(3)リクエストp95が300秒以下(200応答10件以上、遅い失敗要求なし、測定が完全であること)。FAILなら終了コード1。devで`--hours 168`と`--canary-ids`の2モードを実機確認。

### 教訓
- 計画時に「文書単位の処理時間p95」を前提にしたが、処理時間は文書にもログにも保存されていなかった(実装時に初めて判明)。**測定計画は、測る値が実際に記録されているかを先に実データで確認する**。結果として、ゲート(3)はCloud Runのリクエスト単位latency(サービス全体、canary文書と非紐付け)に変更した。
- 判定スクリプトは「不明をPASSにしない」を契約テストで固定する。レビュー(codex 2回+3エージェント)で、タイムアウトした失敗要求・サンプル不足・status不明の行・ログ取得失敗の経路がPASSに漏れる穴が連続して見つかった。最終判定の合成はI/O側に残さずlibへ出してテストする。
- `run-ops-script.yml`の汎用`--doc-id`分岐は`--doc-ids`にも部分一致する。複数IDを取る引数は別名(`--canary-ids`)にする。
- ローカルのADCではdevのFirestoreに到達できない(PERMISSION_DENIED)。実データでの確認はGitHub Actions経由で行う。

### 次のアクション
- **即着手**: PR-D(Sarashina要約の本番展開)の着手。ROI: kanameone/cocoroの手動要約ボタンのGemini送信を止める最短ルート。工数: インフラ構築〜canary合格まで数営業日(canaryは1営業日)。完了条件: kanameone canaryが客観ゲート(1)〜(5)を満たす。関連: 計画`/Users/yyyhhh/.claude/plans/jiggly-giggling-pond.md`のPR-D節、`scripts/setup-sarashina-summary-infra.sh`、`deploy-sarashina-summary.yml`。**本番作業のため、番号単位の承認を都度取る**(月約$103の試算、kanameone)。
- **条件待ち**: ①cocoroのPR-A確認(trigger=新リビジョン`processocr-00058`が文書を処理、確認=`gcloud logging read`で`candidateGeminiMs`が出ないこと) ②3環境のPR-B確認(trigger=デプロイ後の新規処理文書、確認=`ocrExtraction.version`が`PP-OCRv6_medium`、読み取り専用runQuery) ③PR-C 手動要約の待ち行列化(trigger=kanameoneのPR-D canary合格) ④PR-E 掃除・契約テスト(trigger=PR-C/PR-D完了)。
- **却下候補**: 開発用の合成データ向けスクリプト2本をメニューに戻す(codex review P2。PR-Eで退役予定のため見送り、decision-makerの指示があれば復活可) / 新規テナント向けのPaddleOCR基盤の納品手順への組込み(新規テナントの予定なし、契約書はkaname向け) / 文書単位の処理時間をFirestoreに保存する本体変更(ゲート(3)はリクエスト単位latencyで足りる、実害が出たら再検討)。

### 最終結論
✅ **セッション終了可** — 本セッションのPR(#1116/#1117/#1118)はマージ・デプロイ済み。残りは文書の処理待ち(cocoro/3環境の確認)とPR-D(本番作業・承認待ち)で、いずれも次セッション。

## 平出配下7組の実測・processocr_errorアラート恒久化・Issue #979クローズ（2026-10-02）

### 結果
- **平出配下manual-review 7組**: kanameoneの`drive-export-status-report --breakdown`(run 36938045779)で、実エラー61件はフリガナ/ケアマネ/カテゴリ未設定のみ、`AmbiguousFolderError`由来0件と実測し実害なしと確認。既存の再帰統合ツール(`plan-drive-folder-tree-merge`)は`rootFolderId`直下の同名2フォルダ専用で利用者フォルダ配下の7組には使えないため、統合ツール新設は見送り(PR #1109)。
- **`processocr_error`アラートを恒久化**(PR #1110): 切替後2週間(2026-09-19〜10-02)の`Error processing document`ログは3環境とも0件(対照クエリで通常ログ取得は確認済み、空振りではない)。テンプレート/docsから`lifecycle: temporary`と`review_by`を除去。`setup-log-based-metrics.sh`は既存ポリシーをskipするため、kanameone/cocoroの稼働中ポリシーは`gcloud alpha monitoring policies update --remove-user-labels=lifecycle,review_by`で個別更新し、再取得でラベル除去と有効状態を確認。
- **Issue #979をnot plannedでクローズ**(PR #1111でGOAL.mdの旧記述へ反映): 提案2は恒久運用の`processocr_request_timeout`で充足、提案1(文書単位の処理時間metric)は実害なしのため見送り。実害が出たら再起票。

### 教訓
- 「既存ツールを流用できる」という見立ては、ツールの前提条件(対象フォルダの親がrootFolderIdのみ)を読む前に断定してはいけない(今回、確認後に訂正)。
- 環境変数`CLOUDSDK_ACTIVE_CONFIG_NAME`が固定されていると`switch-client.sh dev`が効かない(スクリプトはサブプロセスのため環境変数を変えられない)。dev復帰は`export CLOUDSDK_ACTIVE_CONFIG_NAME=doc-split`で行う。
- zshではforループの`set -- $pair`が単語分割されない(今回、引数が連結されて失敗、本番変更なし)。

### 次のアクション
- **即着手**: なし。
- **条件待ち**: クライアントの返信・入力の進捗確認(trigger=返信、`drive-export-status-report --breakdown`の件数のみ) / 平出配下7組(trigger=`AmbiguousFolderError`の実発生) / #956(`driveFolderClaim.ts`のcatchメトリクス無し)の扱い見直し(GOAL.md「#979と設計方針重複の可能性」注記は#979クローズで前提が変わった。trigger=decision-maker指示、確認はIssue本文を読むだけ) / cocoro Phase C(クライアント自身のOAuth接続) / ADR-0027 S10・PR6(decision-maker指示)。
- **却下候補**: 平出配下7組の統合ツール新設(実害なし・コストに見合わない)。

## kanameone 顧客ID紐づけ補完(フリガナ未設定エラーの根本対応)（2026-10-01）

### 結果
かなめ様の「マスターにフリガナは入力済み」という指摘の原因は、書類とマスターの紐づけ不備(書類の`customerId`が空/存在しないマスターを指す)だった。`backfill-customer-id-link`(PR #1103: 同名マスター1件のみ、PR #1104: `--whitespace-variants`で空白違いは顧客名もマスター表記へ揃える)を実装し、kanameoneへ適用した。第1段=56件、第2段=43件(canary1件→残り42件、いずれも番号単位認可)。Firestoreで全件を独立確認(customerName/customerIdがマスターと一致、確認済み・verified・customerKey不変、manifestに顧客名なし)。2026-10-01時点: 保存済み8,344→8,417件、実エラー151→143件(フリガナ108/ケアマネ32/その他3)。

**回復の実測(2026-10-01 18:10 JST時点)**: 補完99件のうち92件が保存済み(第1段56/56、第2段36/43、残り7件は再試行の順番待ち。再試行はdocId順走査・15分毎・成功10件上限のため、補完から数時間かかる)。停止期間(9/26 12:32〜9/30 15:30 JST)に確定した404件は353件が保存済み、残り51件(顧客未確定50・ケアマネ未設定1)はクライアント側の入力待ちで、こちらの原因による取りこぼしは0件。

**最終状態(2026-10-01 21:44 JST)**: 補完99件は**全件が保存済み**。残っていた2件も解消し保存済みを確認: ①「報告書」フォルダのclaimが`divergent`(`full-scan-mismatch`、記録先がゴミ箱)のまま→既存の再同期ツールは対象外(`OUT_OF_SCOPE_DIVERGENT_REASONS`、classifyが実体を取得しないためexecuteが必ず`drive-drift`)のため、decision-maker番号単位認可のもとFirestoreのclaimを`release-claim`相当(`state:'invalidated'`、updateTime条件付き)で直接更新→管理者がアプリで「リトライ」し`exported`。②同一docIdのファイル重複(2件、md5・サイズ一致の二重アップロード)→`resolve-drive-duplicate-file`(PR #1106)で複製1件をゴミ箱へ(書類のdriveFileId一致側を残す)→リトライで`exported`。停止期間中に確定した書類は403件(353保存済み、残り約50件は顧客未確定49・ケアマネ未設定1でクライアント入力待ち)。

### 限界・注意
- 空白違い補完は顧客名を書き換えるため、検索インデックス再生成で更新時刻が進み、**rollbackは43件すべてでスキップ見込み**(実測。manifestは顧客名を持たない設計のため顧客名も戻せない)。戻す場合は個別対応。
- displayFileName(Drive上のファイル名)は旧表記のまま(見た目のみ、必要なら`backfill-display-filename`)。
- 空白違い補完の28件→43件の差は、計画時の集計が「エラー書類のみ」だったため(スクリプトは確認済み全体を走査)。

### 次のアクション
- **即着手**: なし(範囲内の作業は完了。返答と完了報告を1通にまとめてdecision-makerが2026-10-01夜にクライアントへ送付済み)。
- **条件待ち**: クライアントの返信・入力の進捗確認(trigger=返信または次回セッション、確認方法=`drive-export-status-report --breakdown`の件数のみ。お願い事項は送付済み: 顧客未確定約680件・担当ケアマネ未設定約30件・マスターに該当なし/表記違い約20件・書類種別未設定1件) / 平出配下manual-review 7組(実害なし・統合ツール新設は見送り、trigger=`AmbiguousFolderError`が実際に出た時に1組ずつ対応。2026-10-02実測: status-report run 36938045779で実エラー61件=フリガナ/ケアマネ/カテゴリ未設定のみ、フォルダ重複由来0件。既存の再帰統合ツールはrootFolderId直下の同名2フォルダ専用で、利用者フォルダ配下の7組には使えない)。解消済み: claim付け替え1件・重複ファイル1件。
- **範囲の整理(decision-maker合意2026-10-01)**: 顧客未確定・担当ケアマネ未設定・マスターに該当なし等は、クライアント側のデータ入力・確定が原因で今回の停止とは別の以前からの状態のため、今回の対応範囲外。完了連絡に「お願い事項」として添える扱い。
- **却下候補**: 残り20件の自動補完(かな違い等は同一人物と断定できずクライアント確認が必要)。

## kanameone `(root)/森奈穂美`の再帰統合ツール開発・本番適用（2026-09-30）

### 結果
同名の兄弟Driveフォルダ2つを再帰統合する承認制ツール(`plan-drive-folder-tree-merge`/`execute-drive-folder-tree-merge`、PR #1100)を実装し、devリハーサル後にkanameoneへ適用した。ショートカット規則の絞り込みと実体調査スクリプト`inspect-drive-items`はPR #1101。kanameone: ファイル移動38/フォルダ再親付け179/trash160(manifest377件全適用・失敗0)、ルートclaimは`resolved`、重複audit 8→7件、停止していた書類は63→14件へ回復中(統合後約1.5時間時点)。詳細・教訓は`GOAL.md`「再帰統合の実施結果」、手順と手動復旧は`docs/context/drive-folder-tree-merge-runbook.md`。

### 次のアクション
- **即着手**: なし(回復確認はclaim復帰から6時間後=2026-10-01 03時UTC以降の`drive-export-status-report --breakdown`、decision-maker指示があれば実施)。
- **条件待ち**: 停止が残る場合の原因調査(trigger=6時間後の再確認で0件にならない) / クライアントへの完了連絡ドラフト(trigger=decision-maker指示) / 平出配下7組の扱い(trigger=decision-maker判断)。
- **却下候補**: 統合対象外のショートカットによるリンク切れ検知(Drive APIで参照先逆引き不可、runbookに限界として明記)。

**アーカイブ**: 過去セッション詳細は `docs/handoff/archive/` 参照(2026-10-15時点: 2026-07/08/09月分をアーカイブ済み、2026-10月分は`2026-10-history.md`)。

## 現在のフェーズ

**ミッション: Gemini完全廃止(ADR-0029)は完了、約1週間の稼働確認も済み**。詳細はGOAL.md冒頭と本ファイル冒頭の節を参照。並行トラック(いずれも外部依存待ち): ①kanameone Drive Phase1(クライアントの入力待ち。顧客未確定約680件ほか) ②cocoro Drive連携Phase C(クライアント自身のOAuth接続) ③ADR-0027 Sarashina要約(S10ロールバック・PR6はdecision-maker指示待ち)。

## 直近の変更（最近5件、新しい順）

- **2026-10-15（Gemini廃止後の稼働確認）**: 上記節参照。**Net 0**。PR #1158・#1159・#1160(GOAL.mdの訂正)と本handoff。
- **2026-10-09〜10（Paddle高画素数画像のメモリ不足）**: 上記節参照。**Net 0**。PR #1147〜#1153。
- **2026-10-08（GCP側の無効化）**: `roles/aiplatform.user`剥奪・Vertex AI API無効化(3環境)。
- **2026-10-07（Gemini完全廃止の実装・展開）**: PR #1137〜#1139。
- **2026-10-06（通常経路のGemini停止）**: PR-C/PR-E完了。

2026-09月以前の詳細は `docs/handoff/archive/` 参照。

## 次のアクション（3 分割・SKILL.md §2.5 参照、2026-10-15時点）

**即着手タスクなし（executor領分の作業ゼロ）。条件待ち6件。却下候補あり。**

### 即着手タスク

なし。

### 条件待ち（明示 trigger 付き）

| # | 項目 | trigger（充足条件） | 充足時のタスク | 充足確認方法 |
|---|------|------------------|--------------|------------|
| 1 | 画像書類の実績確認（特にcocoro） | 画像書類の流入 | `processedAt`>=2026-10-09T12:20Zの`status`・`ocrExtraction.version`の件数、`paddle-ocr`の`signal 9`・5xxが0件かを読み取りで確認（書類の内容は見ない） | Firestore集計クエリ、Cloud Logging |
| 2 | `docs/client/client-setup.md`の文言確認 | decision-makerの確認 | 確定した文言を反映 | decision-makerの返答 |
| 3 | 運用スクリプトの書類名出力の確認 | `run-ops-script.yml`で他スクリプトを実行する直前 | その1本に限り`fileName`・顧客名の`console`出力を確認し、出していれば実行せず報告 | 対象スクリプトのソース |
| 4 | 大判PDF・多ページPDFの不安定化 | 大判PDFの`error`・503、または書類が`error`化、または同種ERRORの複数回再発 | 原因確認。PDFのdpi変更はgolden再現性に影響するため決裁者判断。メモリ8GiB化の再検討 | `paddle-ocr`/`processocr`のERROR(両方、期間明示)、メモリ使用率(max) |
| 5 | kanameone Drive Phase1の残り | クライアントの返信・入力 | `drive-export-status-report --breakdown`の件数のみ確認 | status-report |
| 6 | cocoro Drive連携Phase C | クライアント側のOAuth接続 | Phase D(flag ON・backfill)着手可否をdecision-makerが判断 | `settings/drive` |

### 却下候補（記録のみ）

| # | 項目 | 分類 | 着手しない理由 |
|---|------|------|--------------|
| 1 | メモリ8GiB化（月約$26/環境） | 新規価値創出 | 縮小で$0のまま安定、cocoroのメモリ使用率も57%でOOM未確定。再発時のみ |
| 2 | 503集中時刻と書類の突合 | 整理・点検 | 実害なしで判断が変わらない。decision-makerの指示があれば実施 |
| 3 | 切替前後の処理速度比較(Gemini時代のログ) | 整理・点検 | 運用が変わる見込みが薄い |
| 4 | GitHub Issue backlog(#956/#901/#238) | 新規価値創出 | 起点なし、trigger未成立 |

### 残留プロセス（マシン全体スコープ、現在のプロジェクトに限らない）

検出1件: 別プロジェクト(`sanwa-houkai-app`)のGitHub Actionsランナー配下の`vitest run`(2026-10-15 13:08起動、直近のため並行実行中の可能性)。当プロジェクト由来ではなく、停止は指示があるまで行わない（条件待ち、trigger=停止指示）。
