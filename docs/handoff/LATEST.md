# ハンドオフメモ

**更新日**: 2026-10-07（Gemini完全廃止(ADR-0029)を実装・3環境へ展開。以前: 2026-10-06（通常経路のGemini停止のPR-C・PR-Eを完了、本番2環境へ反映。以前: 2026-10-03 通常経路のGemini停止: Pass2廃止(PR #1116)・OCRの倒れ先をpaddleへ反転(PR #1117)・Sarashina canary測定スクリプト(PR #1118)をマージし3環境へデプロイ。過去セッションの内容は以下の各節を参照））

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
**却下候補**: Issue #714(Gemini 3.6 Flashへの移行検討)は前提が消えたためclose候補(decision-makerの判断待ち)。トークン数項目・`SummaryProvider`の`'gemini'`値の整理はADR-0029でスコープ外。

### 注意(再発防止)
- 公式資料の読み(データ所在地の表と課金形態)を取り違えた。個別の公式ページで確認してから断定する。
- 状態確認のポーリングでJSON解析が失敗していたのに、20回空振りしていた。取得結果が空ならまず取得・解析を疑う。OCR全文を含むJSONは`strict=False`とフィールド指定(`mask`)で取得する。
- 本番の画面は開かず、配信バンドルのcurl確認で反映を確認した(Playwrightには本番ログインが残りうる)。

## Issue Net変化(2026-10-07)
- Close 0件、起票 0件、Net 0。

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

## ADR-0027 PR5: dev環境でのSarashina要約有効化・実機観測（2026-09-29）

### 経緯
PR4完了(2026-09-28)を受け、decision-maker承認によりPR5(dev環境でのL1有効化・実機観測)に着手。plan mode(Opus)で計画策定後、`/plan-crossreview`(grip自白+codex 2パス)を3回実施し収束(`~/.claude/plans/serialized-brewing-swing.md`)。

### 実行サマリ
- **S1(実装)**: `set-feature-flag.js`へ`sarashinaSummary`追加、`set-sarashina-summary-allowlist.js`新規作成、`run-ops-script.yml`に選択肢・観測ジョブ追加。
- **S0(実機ゲート再検証)**: devで`sarashina-summary-verify.ts`のfixture(D1〜D10)ハーネスを実行。fabrication誤検知が「行う」「各」「貸与」「である」「として」「されている」等、計9パターン連鎖的に発覚し、都度decision-maker承認を得て`shared/summaryFabricationScan.ts`(`DEFAULT_GENERIC_CORES`/`DEFAULT_PARTICLES`)へ個別パッチ対応(PR #1077〜#1080)。D8「予定されている」の対応漏れ(自分のミス)を次サイクルで発見・訂正(PR #1080)。6つのFAIL可能ゲート(runtime-contract/fabrication/coverage-aggregate/coverage-per-doc/numeric-fabrication/determinism)全PASS達成。
- **S4前提崩壊→新規スクリプト実装**: canary文書選定のためdev実データを調査したところ、①本体`documents`ではなくADR-0018 Phase Eの`detail/main`サブコレクションが実データ保持先であることが判明(自分の調査ミス、訂正)、②`detail/main`確認後も全195件のOCRテキストが意味のないプレースホルダーと判明。decision-maker承認を得て、S0のfixture(D1〜D10)をdevへ実文書としてアップロードする`scripts/upload-sarashina-canary-fixtures.ts`を新規実装(PR #1081)。codex review 3回(P1: GHA実行環境にmacOS専用フォントパスがなく`--execute`が確実に失敗する問題をseed-dev-data.ts方式の踏襲で解消。pr-reviewer: 親docへの直接書込みがADR-0018 dual-write契約違反、修正。P2: fixtureページ数とPDF生成後ページ数の不一致、フォントサイズ縮小で解消)を経てマージ、D1〜D10を実データとして投入完了。
- **S5〜S7(L2/L1有効化・canary処理)**: L2 allowlist設定(D2/D3/D8を承認)→L1(`SUMMARY_PROVIDER=sarashina`)有効化→S7a(`set-paddle-ocr-allowlist`にcanary一時制限)実行時に複数ID非対応バグを発見・修正(PR #1082、workflow側のdoc_id検証正規表現が単一ID専用のままだった)→S7b(canary再処理)→S7c(Paddle allowlist復元確認)を完遂。
- **S8(観測)**: D3・D8は`summaryState=done`かつ`summaryProvider=sarashina`で実運用パイプライン初のSarashina要約完走を達成。**D2は`fabrication_suspected`でerror終端**。decision-maker承認を得て、Sarashina Cloud Runへの一時的IAM権限付与(read-only調査用、調査後即時取消)による手動根本原因調査を実施し特定: 実OCR結果中の「さくら通所介護センタ**一**」(長音記号「ー」の漢数字「一」誤認識)に対し、Sarashinaが正しく「センタ**ー**」と補正出力したが、fabricationスキャナのverbatim完全一致判定が1文字差により実在組織名を捏造と誤判定。**S0のfixtureテストでは検知不可能だった新しいバグクラス**(実OCR誤字とSarashinaの自動補正の組み合わせによる誤検知)であることを確立。

- **S9(Wave2、2026-09-30)**: D1〜D10へL2拡張、Paddle allowlistを7件へ一時制限→reset→復元(独立確認済み)。D4/D5/D6/D7=done、D9/D10=skipped(100字未満)、**D1=`fabrication_suspected`**。一時IAM付与でSarashinaへ10回送信し再現(2/10): 要約中の「指示期間を持つ訪問看護指示書」を「持つ訪問看護」という組織名と誤判定するスキャナ誤検知(D2に続く2件目、同型)。IAMは調査後に取消・調査前と一致確認済み。逐次パッチは行わずスキャナ構造対応を新規plan modeで検討する方針(decision-maker合意)。詳細はADR-0027「PR5実機観測」節8・9。
- **D1対応(2026-09-30、`feat/adr0027-fabrication-retry`)**: スキャナ本体は不変のまま、`generateSummaryBatch`が`fabrication_suspected`検知時に総試行上限(3)内でpendingへ戻して再生成、`summaryError`にはPII契約に従い疑い名を保存せずsuffixとcore文字数のみ、`stats.fabricationRetried`で検知と終端errorを分離。L-C(1漢字+活用語尾の一律除外)は「守る訪問看護」を見逃す検出バイパスになるため不採用(`/plan-crossreview`のcodex指摘・実行確認)。`generateSummaryBatchIntegration`が従来CI未配線だったため専用stepを追加。functions全単体テスト2461件PASS・`generateSummaryBatchIntegration.test.ts`は40件PASS(emulator)。詳細はADR-0027節10〜13。**PR #1088マージ・dev自動デプロイ反映確認済み(`generateSummaryBatch`リビジョン00009)、smoke観測(2026-09-30)でD1は1回目でdone、誤検知は再現せず(再試行の実機発火は未観測、emulatorテストで検証済み)。Paddle allowlistは復元済み(Firestoreを直接読んで確認)。**

### 現在の状態
D2の恒久対応(方針A: fabricationスキャナへの長音記号正規化、PR #1083)を完了し、dev実機でD2=`summaryState=done`/`summaryProvider=sarashina`を確認、AC4(全canary done、3/3件)達成。Paddle allowlistは`--remove`で復元済み(`check-paddle-ocr-step0`で独立確認)。S9(Wave2拡張)は2026-09-30に完了(D1はスキャナ誤検知、上記S9参照)。D1誤検知への運用側の対応(再試行化・診断情報・観測分離、上記D1対応参照)を実装済み(スキャナ本体は不変)。次の一手は、マージ後のdev自動デプロイ反映確認→D1相当のsmoke観測(decision-maker確認後)と、スキャナ本体の再設計要否の判断(集まる誤検知データを見て)。S10(ロールバック)・PR6(dev以外展開)はdecision-maker指示待ち。詳細はGOAL.md「ADR-0027 PR5実機観測」節参照。

### Issue Net
Net 0（本セッションでのIssue起票・close操作なし）。

### 同根再発スキャン・対症療法判定（handoff §4.6/§4.7）
本セッションのfix系PR(#1077〜#1080、#1082)はいずれも`shared/summaryFabricationScan.ts`(fabrication誤検知)と`run-ops-script.yml`(doc_id検証)という同一ファイル・同一設計領域への連鎖的パッチだが、各修正は「新しい実在パターンの追加」または「既存の単一ID専用正規表現の見落とし」であり、retry/fallbackのみの対症療法ではなく構造的な根本対応(許可リストへの語彙追加・正規表現の拡張)。ただし`summaryFabricationScan.ts`への9回連続の個別パッチという事象自体は、verbatim完全一致方式の設計限界(D2のセンター誤字ケースも同型)を示唆しており、次回同種の誤検知が発生した場合は個別パッチの継続ではなく設計見直し(形態素解析等)を検討する必要がある旨をdecision-makerと共有済み(前回セッションでのAskUserQuestion「形態素解析への設計変更は見送り」判断を維持)。

## ADR-0025 Pass1切替後の事後監視・第1回手動ワンショット比較（2026-09-28）

### 経緯
`/catchup`で提示された即着手候補（ADR-0025 Pass1全面切替後、9日経過時点での事後監視。2026-09-19記録のStep0④ベースラインとの比較）にdecision-maker承認を得て着手。

### 実行サマリ
- 前回のベースライン測定方法（`.github/workflows/run-ops-script.yml`の`check-paddle-ocr-step0`ジョブ、Firestore REST `runAggregationQuery`によるstatus:error率集計+`gcloud logging read`によるCloud Run request latency分布算出）をExploreで再確認
- 同ジョブをdev/kanameone/cocoro全3環境でGHA実行（run 36356478251/36356480290/36356482389、全`success`）し、ログから実測値を取得
- **比較結果（3環境ともerror率0%を維持、p95 latency・60秒超過率とも悪化なし、いずれも同水準または改善）**:
  - dev: total=3/7日・error0% → p95=0.29s（baseline 0.30s）・60秒超過0件/10080件（baseline 0.03%）
  - kanameone: total=1347/7日・error0% → p95=0.32s（baseline 0.42s、改善）・60秒超過21件/10038件0.21%（baseline 0.29%、改善）
  - cocoro: total=31/7日・error0% → p95=0.28s（baseline 0.29s）・60秒超過0件/10084件（baseline 0件）
- GOAL.mdの該当節（Step0④ベースライン記載の直後）に結果を記録済み

### 現在の状態
事後監視・第1回は完了。継続監視は次回以降も同ジョブで実施可能。processocr_errorアラート（`lifecycle:temporary`、review_by 2026-10-03）の削除/恒久化再判断は未到来のため保留のまま。Issue #979（GOAL.mdの「撤回済み」記載とIssue OPEN状態の矛盾）はdecision-maker判断待ちで様子見。

### Issue Net
Net 0（本セッションでのIssue起票・close操作なし）。

### 同根再発スキャン・対症療法判定（handoff §4.6/§4.7）
本セッションは修正PRなし（read-only監視+GOAL.md記録更新のみ）のため対象外。

## ADR-0027 PR4完了: バッチ処理基盤・デプロイ配線・フロントエンドUI（2026-09-27夜〜09-28朝）

### 経緯
PR3(2026-09-27マージ)の申し送り事項を起点に、PR4a(バックエンド)→PR4b(デプロイ配線)→PR4c(フロントエンド)の順で実装。

### 実行サマリ
- **PR4a(PR #1069)**: `summaryState`等7フィールド追加、claim/所有権ガード(`summaryRunGuard.ts`/`summaryRunStore.ts`)、OCR完了イベント駆動バッチ`generateSummaryBatch.ts`(60分間隔)を新設。`regenerateSummary.ts`にclaim保護、`ocrProcessor.ts`にL1='none'時のバックフィル防止配線。codex review 2回(1ブランチ上限)+pr-review-toolkit並列レビューで実バグ2件・テストギャップ5件を検出・修正(ソフトデッドラインがcontext超過時の2回目リクエストを未考慮だった問題等)
- **PR4b(PR #1070)**: `deploy-functions.yml`/`deploy-sarashina-summary.yml`にデプロイ配線・`run.invoker`付与ステップを追加。actionlint構文検証0 findings
- **PR4c(PR #1071)**: `summaryDisplayState.ts`(7 kind判定の純関数)・`useDocuments.ts`(#178教訓のfirestoreToDocument()配線)・`DocumentDetailModal.tsx`(kindベース分岐)を実装。crossreviewで発見したモバイルeffect構造的バグ(「生成中」表示が親再レンダリングで消えうる)を修正。codex review 3回+pr-review-toolkitで計9件反映、emulator実機でPlaywright MCPにより6状態を目視確認
- **検証**: functions単体テスト864件+E2E(emulator実機)9件、全PASS。本番挙動は不変(`SUMMARY_PROVIDER`既定`none`のまま)

### 現在の状態
PR4(a/b/c)は完了・マージ済み。ADR-0027に本節の詳細を反映済み(2026-09-28)。**PR5(dev環境でのL1有効化)は新機能のロールアウトのため新規plan modeが必要、decision-makerの着手指示待ち**。

### Issue Net
Net 0（本セッションでのIssue起票・close操作なし）。

### 同根再発スキャン・対症療法判定（handoff §4.6/§4.7）
PR4a/b/cで修正した実バグ(ソフトデッドライン計算・reprocess時のフィールドクリア漏れ・外側try/catch欠如・モバイルeffect構造バグ等)はいずれも構造的な根本対応であり、retry/fallbackのみの対症療法には該当しない。

## ADR-0027 PR3: Sarashina要約のモデルルーティング・クライアント・ディスパッチャー実装（2026-09-27）

### 経緯
2026-09-23に区切っていたADR-0027（要約生成のGemini依存脱却、Sarashina2.2-3B自前ホスティング）を再開。マスタープラン`~/.claude/plans/logical-baking-lighthouse.md`の次段階PR3（L1/L2ゲート・HTTPクライアント・provider別ディスパッチャーを**呼び出し元なしのdead code**として追加、本番挙動は不変）に着手した。

### 実行サマリ
- **品質ゲート一式**: plan mode（Opus）→`/plan-crossreview`（grip自白可視化+codex 2パス）→TDD実装→`codex review --base main`（P2指摘1件: URL前後空白のバリデーション/構築不一致を検出・修正）→`pr-review-toolkit`4エージェント並列レビュー（H1: context超過時の短縮再送が全ocrResult基準で計算され実際の送信テキスト（8000字切り詰め後）と不整合という実バグを検出・修正、M1: 契約テストのコメント誤マッチ、silent-failure-hunter指摘: ネットワークエラー分類でcause.codeの診断情報が握り潰される、をいずれもTDDで修正）
- **設計上の意図的差分**: L2ゲート無効時は`resolveOcrProvider`（Paddle）と異なり`gemini`ではなく`none`へフォールバック（新規課金を発生させない）。`utils/retry.ts`の`withRetry`は使わず`withBackoffRetry`+独自分類（504/timeoutは二重推論リスクのため再送しない設計）
- **IAM制約によるスコープ調整**: dev Sarashina Cloud Runへの実機疎通確認は、`hy.unimail.11@gmail.com`の`iam.serviceAccountTokenCreator`権限不足によりブロック。IAM変更は不実施、decision-maker判断でPR4/PR5へ延期。代わりに`gh api`でllama.cpp公式ソース（`ggml-org/llama.cpp`）を直接確認しcontext超過エラーの実JSON形状を裏取り
- **検証**: `cd functions && npm run build && npm test` 2414 passing/0 failing、frontend型チェックPASS、新規3ファイル（`sarashinaSummaryClient.ts`/`summaryPass.ts`/`sarashinaSummaryRequest.ts`）の呼び出し元ゼロを`grep`で確認
- PR #1062（実装本体）・PR #1063（GOAL.md記録更新）とも番号単位の明示認可でマージ済み

### 現在の状態
PR3は完了・マージ済み（本番挙動不変、dead code）。ADR-0027に「PR3実装知見」節（設計差分・PR4への申し送り事項）を記録済み。**PR4（Functions実配線・`deploy-functions.yml`へのURL/フラグ注入・IAM run.invoker付与）は新機能のため新規plan modeが必要、decision-makerの着手指示待ち**。

### Issue Net
Net 0（本セッションでのIssue起票・close操作なし）。

### 同根再発スキャン・対症療法判定（handoff §4.6/§4.7）
本セッションの修正は`codex review`のURL空白バグ・`pr-review-toolkit`のH1（短縮再送の基準不整合）・M1（契約テスト誤マッチ）・診断情報欠落の4件。いずれも構造的な根本対応（値のtrim統一・短縮計算基準の修正・コメント文言変更・診断フィールド追加）であり、retry/fallbackのみの対症療法には該当しない。過去7日のhandoff archiveに同キーワード（Sarashina/summaryPass/contextExceeded）のヒットなし、同根候補0件。

## Issue #1043対応・confirm-on-verify backfill本番実行・kanameone向けフィードバック完了報告送付（2026-09-26）

### 経緯
前回セッションの`/catchup`で「backfillスクリプト本番実行前にIssue #1043（`ConfirmOnVerifyManifestEntry`の型安全化）解消を推奨」と記録されていた件に着手し、kanameoneから受領していた10件のフィードバックのうち9件の本番反映状況を確認・完了させ、残る1件（「医療」フォルダ重複）の解消に向けたクライアント案内までを完了させた。

### 実行サマリ
- **Issue #1043対応（PR #1058マージ）**: `ConfirmOnVerifyManifestEntry`をdiscriminated union化し不正な状態を型として表現不能にした。`--rollback`のmanifest読込みにランタイム検証(`isValidManifest`)を追加(fail-closed)。`codex review`がサーバー側401エラーで5回連続失敗したため、pr-review-toolkit 4エージェント+fable-reviewで代替レビューし、型契約違反データによる書込み側/読込み側の非対称バグ等を追加検出・修正。Firestore emulator統合テスト7件を新規追加、全PASS。
- **confirm-on-verify backfill本番実行**: dev/kanameone/cocoro実データとも型異常0件を確認したうえで、cocoro(19件、canary3→残16で完了、エラー0件)・kanameone(2,695件、canary10→残2,685で完了、確定成功2,694件・並行書込み検出スキップ1件)の順に本番実行。スキップした1件は当日中の`--dry-run`再実行で対象0件を確認し、自然解消済みと確定。
- **Drive export相互作用の判断**: kanameoneのbackfillにより、過去に`customerConfirmed`未確定でDriveエクスポートが`error`状態のまま止まっていた240件が、次回の定期リトライスイープで再度エクスポート対象になることが判明。実コード(`isCustomerUnconfirmed`ゲート→`CustomerUnconfirmedError`→スイープ再対象化)を追跡し、同等の効果がクライアント自身の既存UI機能(`handleBulkVerify`)でも本来起こり得ることを確認したうえで、decision-maker判断により実行継続。
- **kanameone向けクライアント案内**: 10件のフィードバックのうち9件(②〜⑩)の対応完了報告と、残る1件(「医療」フォルダ重複)の原因説明・解消に向けた再連携依頼を、`html-brief`スキルで図解入りHTML文書として作成しdecision-makerが送付済み。当初案にあった「作業日程の相談」は、decision-maker指摘により撤廃し「ご都合の良いときにボタンを押すだけ」に簡素化。操作手順(設定画面→Google Driveタブ→再連携する)も実機(dev環境Playwright確認)・ソース両方で確認のうえ明記した。
- **送付前の本番側事前準備**: クライアントの負担を最小化するため、日程調整を待たずにベンダー側で以下を先行実施した。
  - `driveExport` feature flagをOFFにし、`exporting`件数0件のdrainを確認(GHA `run-ops-script.yml`経由)
  - Google Cloud ConsoleでkanameoneのOAuth同意画面のユーザーの種類を「外部」→「内部」へ切替(Playwright MCP実機操作で確認・実行)。`drive`フルスコープが未検証のため発生する見込みだったGoogleの「未確認のアプリ」警告画面を、原因除去により解消。既存のDrive接続アカウント`systemkaname@kanameone.com`がkanameone.com Workspaceアカウントであるため影響なし。cocoroは元から「内部」設定済みで対応不要と確認

### 現在の状態
9件は全て本番反映済み(kanameone/cocoro)。残る1件のOAuth再連携はkanameone側で完了済み(2026-09-28)。2026-09-30に重複audit(22グループ)→merge候補14グループの統合実行(承認済み)→再audit(残8件=manual-review)まで完了。残りはmanual-review 8件の判断、flag ON、backfill(GOAL.md「kanameone/cocoro本番展開」節参照)。

### Issue Net
Net 0（本セッションでのIssue起票・close操作なし。Issue #1059はPR #1058の軽微なフォローアップ指摘の記録用で、triage基準未達のためP2 backlogのまま）。

### 同根再発スキャン・対症療法判定（handoff §4.6/§4.7）
本セッションは修正PR 1件(#1058)のみで、症状の異なる複数PRの並走はなし。§4.7の判定基準（retry/timeout延長等のみの対症療法）にも該当しない(型を discriminated union 化し不正状態を構造的に表現不能にする根本対応)。同根再発候補なし。

## Issue #1028: Drive OAuthスコープ拡張〜kanameone/cocoro展開着手（2026-09-23）

Drive OAuthスコープを`drive.file`→`drive`フルスコープへ拡張し、兄弟重複統合スクリプトを新設(PR #1038)。plan mode→plan-crossreview(grip×codex)→実装→Fable 5.1セカンドオピニオン(codex usage limit時の代替手順)→`post-pr-review.sh`hook強制のPRレビューゲート(codex review P1×2/P2×1、pr-review-toolkit 5エージェント、quality-gate-evaluator)を経てマージ。レビューゲートで発見されたCritical1件(SOP記述と実装の不一致、`release-claim`後の再実行でtrashが完了しない欠陥)・3経路収束High1件(manifest未チェックポイント)を含む全指摘を修正。fixtureベース統合テスト不在はIssue #1039へ切り出し(P1、実装時期未定、**完了・2026-09-25 PR #1052マージ済み**)。

**dev実機検証(decision-maker実施分含む)**: OAuth再連携実施→`grantedScopes`にフルスコープ反映確認。この過程で「再連携する」ボタンの視認性バグをdecision-makerが発見、即修正・別PR #1040でマージ。既存重複統合リハーサル(audit→dry-run→execute→再audit)で重複解消・今回修正コードパス(claim状態ガード・TOCTOU検知・trash直前再確認・manifestチェックポイント)を実地検証。Playwright MCP(認証済みセッション)経由でDrive UI上に新規未タグフォルダを作成し、フルスコープでの検出(`claimProperty=false`)を確認、Issue #1028本体の再現→非再発確認が完了。検証用フォルダは削除済み。

**kanameone/cocoro本番展開**: Functions/Hostingとも計4件デプロイ成功。cocoroはDrive未接続(Phase C未着手)のためこれで展開完了。**kanameoneは実際のOAuth再連携以降(flag OFF→drain確認→クライアント自身の再連携→audit→承認→execute→flag ON→backfill)がクライアント側調整待ちで未着手**。decision-maker判断によりここでセッション区切り。詳細はGOAL.md参照。


---

**アーカイブ**: 過去セッション詳細は `docs/handoff/archive/` 参照(2026-09-27時点: 2026-07/08/09月分をアーカイブ済み)。

## 現在のフェーズ

**ミッション1: kanameone・cocoroへのGoogle Drive連携Phase1本番展開**（GOAL.md準拠、2026-07-23開始）。承認済み計画: `/Users/yyyhhh/.claude/plans/witty-drifting-hoare.md`。cocoroはFunctions/Hostingデプロイ完了、Drive未接続(Phase C=クライアント自身のOAuth接続、代行不可)で外部依存待ち。kanameoneはOAuth再連携完了(2026-09-28)、重複audit・merge候補14グループ統合・再auditまで完了(2026-09-30)。**`driveExport` flag は9/26にOFFにして以降、約4日間確定書類がDrive未保存だった(9/30にクライアント指摘で発覚)。9/30に flag ON・backfill(404件)で復旧済み、スイープで約10.3時間で解消見込み(完了確認は次セッション、GOAL.md手順6参照)**。**クライアントへは9/30にチャットで経緯・復旧状況・お願い2点を連絡済み(完了したら知らせる約束、日常使用フォルダの回答待ち)。**残りはmanual-review 8件の判断(**`(root)/森奈穂美`は既存ツールで統合不可(classifyはゴミ箱済み重複が前提)、**実測で少なくとも51件が止まっている(初期見積もり「11件(上限)」は過小評価だった、詳細はGOAL.md手順5配下の訂正)**、選択肢Cを採用=実停止件数を見て判断(A/Bの判断を急ぐ理由が強まった)。子フォルダ名は49/50件が2フォルダで重複するほぼ完全な並行ツリーと判明、完全解消は49組の再帰統合が要る(GOAL.md参照)**。平出配下7組は照合済み: app側とは別物でA→B統合ならデータ保全、子フォルダ3組は中身未照合。照合スクリプトはPR #1092でマージ済み)。

**ミッション2: ADR-0027 Sarashina要約モデル移行**（Gemini依存脱却、Sarashina2.2-3B自前ホスティング）。PR0〜PR3完了(2026-09-27、上記セッションサマリ参照)。現状は**全経路dead code、本番挙動不変**。PR4（Functions実配線）以降は新機能のため新規plan modeが必要、decision-makerの着手指示待ち。

両ミッションとも「Google Drive連携機能 Phase 1 (MVP)」実装自体（2026-07-22 PR #700マージ）とADR-0027 PR0-2（2026-09-23まで）は完了済み。今回はそれぞれの本番ロールアウト/実配線フェーズにあたる。

未着手の次ミッション候補（起点未確定、decision-maker判断待ち）: GOAL.md末尾「exchangeDriveAuthCodeCore split-brain対応判断」。GitHub Issue backlog（#956/#962/#251/#238、いずれもP2 enhancement・trigger未成立）も次ミッション選定時の候補。

## 直近の変更（最近5件、新しい順）

- **2026-09-27（ADR-0027 PR3実装・マージ）**: 上記セッションサマリ参照。**Net 0**。PR #1062/#1063マージ、Sarashina要約のモデルルーティング・クライアント・ディスパッチャーをdead codeとして追加。
- **2026-09-26（Issue #1043対応 + confirm-on-verify backfill本番実行）**: 上記セッションサマリ参照。**Net 0**。PR #1058マージ、kanameone/cocoroへbackfill本番実行、kanameone向け完了報告送付。
- **2026-09-25（Issue #1039完了）**: PR #1052マージ。fixtureベース統合テスト追加（詳細はGOAL.md参照）。
- **2026-09-23（Issue #1028: Drive OAuthスコープ拡張）**: 上記セッションサマリ参照。PR #1038/#1040マージ、kanameone/cocoroへDrive Phase1インフラ展開。
- **2026-09-18〜21（Issue #984/#954/#981）**: `docs/handoff/archive/2026-09-history.md`参照。kanameone検索インデックス飽和対応、`driveFolderClaim.ts`のtransaction保護強化。

2026-08月・2026-07月以前の詳細は `docs/handoff/archive/2026-0{7,8}-history.md` 参照。

## 次のアクション（3 分割・SKILL.md §2.5 参照、2026-09-27時点）

**即着手タスクなし（外部依存/decision-maker判断待ちのみ）。条件待ち4件。却下候補あり。**

### 即着手タスク

なし。ADR-0027 PR3は完了・マージ済みだが、続くPR4着手・kanameone Drive Phase1最終ステップは、いずれも外部依存またはdecision-maker判断（新規plan mode要）を要するため「条件待ち」に分類。

### 条件待ち（明示 trigger 付き）

| # | 項目 | trigger（充足条件） | 充足時のタスク | 充足確認方法 |
|---|------|------------------|--------------|------------|
| 1 | kanameone Drive Phase1本番展開の最終ステップ(再連携・audit・merge14件・flag ON/backfillは完了) | decision-maker判断: manual-review 8件の扱い。加えて次セッションでbackfill 404件のdrain完了確認(`drive-export-status-report`) | manual-review 8件の中身調査(read-only)→統合可否判断。backfill 404件は`drive-export-status-report`で完了確認(exported増加・実エラー比率20%未満) | `settings/features.driveExport`がtrue、status-reportの状態分布、再audit結果(重複8件=manual-reviewのみ)を確認 |
| 2 | cocoro Drive連携Phase C以降 | クライアント側のOAuth接続実施 | Phase C確認後、Phase D(flag ON・backfill)着手可否をdecision-makerが判断 | cocoroの`settings/drive`ドキュメントで接続状態を確認 |
| 3 | ADR-0027 PR4着手（Functions実配線・IAM run.invoker付与・`deploy-functions.yml`改修） | decision-makerのPR4着手指示（新機能のため新規plan mode必要） | `~/.claude/plans/logical-baking-lighthouse.md`のPR4計画に従い着手 | ADR-0027「PR3実装知見」節のPR4申し送り事項を確認 |
| 4 | GitHub Issue backlog: #956(アラート欠落follow-up)/#962/#251/#238 | decision-makerの優先度判断（いずれもP2 enhancement、trigger未成立） | 個別Issue内容に従う | `gh issue view <番号>` |

### 却下候補（記録のみ）

| # | 項目 | 分類 | 着手しない理由 |
|---|------|------|--------------|
| 1 | 次ミッション候補（GOAL.md末尾）: exchangeDriveAuthCodeCore split-brain対応判断 | 新規価値創出（起点未確定） | decision-makerによる着手選定が未実施 |
| 2 | GOAL.md「参考: 前ミッション期のfollow-up候補」 | 新規価値創出（triage未実施） | 次ミッション起点の選定はdecision-maker領分 |

過去ミッション由来の継続保留事項は`docs/handoff/archive/`参照。

### 残留プロセス（マシン全体スコープ、現在のプロジェクトに限らない）

なし（本セッション終了時点で検出なし、事前取得データ参照）。
