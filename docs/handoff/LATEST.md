# ハンドオフメモ

**更新日**: 2026-07-08 session104（Issue #548のprod展開判断材料として、kanameone本番の確定済み文書を使ったconfirmed replay検証スクリプトを新規実装。既存dev A/Bテスト(n=11)がCodexセカンドオピニオンで統計的に不十分と指摘されたことへの対応。`/safe-refactor`→Codex review(4件修正)→`/code-review medium`(8件検出・6件修正)のフルサイクルを実施しPR #577作成。プロジェクトhookにより大規模PR判定(`/review-pr`+`codex review`必須)、マージ・pilot実行は次セッション持越し）

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

## 現在のフェーズ

Phase 8 完了+追加実装運用中。#432系/#402/#504/#492/**#547** close済。429 resilience（ADR-0017）Accepted。kaname要望B〜Fは**E（#526）のdev実装まで完了**、残りはkanameone/cocoro展開判断のみ。**コスト圧縮トラック（#546〜548）は#546/#547完了（#547はADR-0018 Phase A〜B全PR完遂・Issueclose、Phase C以降は将来必要になれば別Issue起票）、#548は3.5移行スイッチ本体をdev実装+実機検証まで完遂(PR #561)・残るはkanameone/cocoro展開判断のみ（期限2026-10-16）**。フォローアップIssue #562(summary経路コスト)は実測の上クローズ済み。

## 直近の変更（session89〜103、簡潔に）

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

## 次のアクション（3 分割・SKILL.md §2.5 参照）

### 即着手タスク

**なし。** ADR-0018 Phase B（5PR構成、PR1〜PR5）が本セッションで完遂し、Issue #547自体もclose済み。次の局面（ADR-0018 Phase C以降: backfill/dual-read cutover/本体フィールド削除）は、ADR本文が「各Phaseは別途`/impl-plan`+Codexレビューで詳細計画化」「Phase Eはdestructive、番号認可+dry-run+devリハーサル必須」と明記する新規フェーズであり、着手にはdecision-makerからの起点指示が必要（4原則§1、起点アイデアはdecision-maker領分）。

### 条件待ち（明示 trigger 付き）

| # | 項目 | trigger | 充足時のタスク | 確認方法 |
|---|------|---------|--------------|---------|
| 1 | **#526 kanameone/cocoro展開**（これで#526 close） | decision-makerの番号単位展開認可 | `/deploy` 3点セット（functions+hosting+rules）。kanameone=`deploy-to-project.sh --full`、cocoro=SKILL.md記載の3経路。展開直後の分割操作自粛アナウンス+実データでOCR補完確認（Issue #526「展開時の注意」参照） | user指示 |
| 2 | **#548 kanameone/cocoro展開**（3.5 Flash移行の本番反映、これで#548 close） | dev実装+実機検証完了（充足、2026-07-06、PR #561）+番号単位展開認可。#526と展開先が同じなので同時展開も選択肢 | `/deploy`で本番へ反映。展開後にIssue #562の再検討トリガー（summary実コスト監視）も実行 | user指示 |
| 3 | #548-B4 再処理「再突合のみ」モード | UI仕様のdecision-maker判断 | 2モード化実装 | user回答 |
| 4 | #539/#540（P2バグ） | 明示指示 or 実害観測 | 各Issue参照 | `gh issue view` |
| 5 | 継承事項: PR#474 close / `.artifacts/` 扱い / #503・#251・#238 | decision-maker明示指示（全て前session94から継続、トリガー未充足） | 各項目参照 | — |
| 6 | doc-audit指摘（2026-07-05）: CLAUDE.md肥大化（207行）の`.claude/rules/`切り出し | decision-maker判断（要否・切り出し範囲） | L187-207マルチクライアント運用セクションを`.claude/rules/multi-client-operations.md`へ移設 | `docs/audit/2026-07-05-document-audit.md` §3.2参照 |
| 7 | docs配下15+箇所の「Gemini 2.5 Flash」表記更新（doc-audit 2026-07-05既指摘） | #548の本番展開完了（未充足） | README/architecture.md/context配下を3.5 Flashへ一括更新 | `docs/audit/2026-07-05-document-audit.md` |

### 却下候補（記録のみ）

| 項目 | 経緯 | 着手しない理由 |
|------|------|--------------|
| OCR出力のエンティティリスト化（−¥11,000/月級） | コスト分析で最大レバーと特定 | 突合品質の厳密A/B実証が前提=品質不劣化制約に抵触しうる唯一の施策。**3.5移行後の実測を見てdecision-makerが判断する保留カード**（#548に記録済み） |
| processOCR head-of-line blocking対策 | Codex指摘で実在確認（BATCH_SIZE=5固定） | 実害未観測。分割多用でpending滞留が観測されたら別Issue化（#526本文に監視事項として記録済み） |
| PWA更新バナー実装 | 展開時リスクとして一時検討 | `vite.config.ts`実査でSWは登録のみ（キャッシュなし）と確認、通常のSPAバージョンスキュー程度のため不要と判定済み |
| `docRef.collection('detail').doc('main')`ヘルパー抽出（共通定数/関数化） | ADR-0018 Phase B全PR（PR2〜PR5）のcode-reviewで一貫して指摘（9+箇所の重複、functions/src・scripts・frontend/srcの3コンパイルコンテキストにまたがる） | 各PRで「Phase B全体の設計判断でPRスコープ外」と判断しskipし続けた経緯があり、Phase B完遂した今が本来の抽出タイミング。ただしヘルパー抽出自体が独立したリファクタリング作業であり、decision-makerからの着手指示が必要（3コンテキスト共有には`shared/`経由の新規モジュール設計を要する） |

> ⚠️ 即着手タスク0件。次セッションはcatchup時にこの却下候補リストとADR-0018本文（Phase C以降の要件）を参照した上で、decision-makerからの新規指示を待つ。

### 最終結論（session103末尾）

✅ **セッション終了可**

- OPEN PR: 0件（#573/#574/#575すべてmerge済close） / active Issue: #526・#548（展開待ち）+ #539/#540/#503/#251/#238（トリガー待ち）。**#547はADR-0018 Phase B完遂によりclose**
- Git: `main`ブランチ、最新（`origin/main`と同期済み、SHA一致確認済み。feature branch群はマージ後にローカル・リモートとも削除済み）。`.serena/project.yml`（意図的未コミット保持、継続）+ `.artifacts/`（untracked、扱い未指示、継続）のみ、それ以外clean
- CI: PR #575マージ後のmain push CI(28865729607)+Deploy(28865729606)ともにsuccess確認済み
- 残留プロセス: なし（doc-split固有のvite/firebase emulatorは全て明示的に停止済み。マシン全体では常駐MCPサーバー/LSPと別プロジェクト`seiho-ai-study`のastro dev serverが稼働中だが、由来無関係のため停止提案なし）
- 即着手タスク: 0件（ADR-0018 Phase B完遂、次フェーズはdecision-maker起点指示待ち） / 条件待ち: 7件
- Issue Net変化: close 1件（#547） / 起票 0件 = **Net 1**（実質進捗が正しくNetに反映された）
- § 4.6 同根再発スキャン: 本セッションに`fix:`プレフィックスの修正PRなし（PR #573/#574/#575はいずれも`feat:`）。発動条件不成立のためスキップ
- § 4.7 対症療法判定: 同上、修正PRなしのためスキップ
- 既知のblocker: なし。前セッション終了時の`.serena/project.yml`未コミット変更破棄インシデントは本セッション冒頭でユーザーに報告済み、実害は低いと推測（断定不可）
- §4.6 同根再発スキャン: 本セッションに`fix:`プレフィックスの修正PRなし（PR #571はfeat:のみ）。発動条件不成立のためスキップ
- §4.7 対症療法判定: 同上、修正PRなしのためスキップ
- 既知のblocker: なし。次セッションはPR3(削除同期改修)からcontext新鮮な状態で着手可能。session102のCodexレビューでもdeleteDocument.tsの孤児化リスクが再指摘されており優先度は高い
