# ハンドオフメモ

**更新日**: 2026-07-19（Issue #687ミッション完遂アーカイブ — GOAL.mdを次ミッション待ちへ差し替えるため、旧ミッション全文をここに保全）

## Issue #687ミッション 完遂サマリ（〜2026-07-19アーカイブ時点）

`scripts/force-reindex.js`が非推奨のatomic batch writerを逐次実行しており、Issue #680 Phase A実行時（4389件対象drift復旧）にGitHub Actions 6時間タイムアウトに抵触した問題（1回目実行がcancelled、冪等なため実害なし・2回目で完了）を、BulkWriter + bounded worker pool並行処理化により解消した。PR #691（squash merge、2026-07-19）。

- **設計・実装前レビュー**: `/impl-plan`フルモードで計画策定後、Codex plan review（MCP経由、effort=high）でNO-GO判定を受けた（同一未作成`search_index/{tokenId}`への並列`set()`競合によるpostings消失リスクHigh、`Promise.all`早期reject問題High）。`merge:true`統一 + `Promise.allSettled()`drain設計へ計画修正の上で実装着手。
- **実装**: `planReindex()`で書込み副作用前にsystemic error（aggregateTokens invariant違反）を全件事前検証しplanをreindexDocumentへpass-through、新posting書込みを`merge:true`のset()に統一、`runAllDrift()`をページ単位boundedワーカープールで並列化（デフォルト並行数5、`--concurrency=<n>`オプション追加）。
- **`/code-review medium`実施**: Firestore emulatorでの実証により、削除対象トークン（`tokensToRemove`）の重複による`df`二重減算という新規の重大バグ（旧実装でも潜在していたが顕在化はBulkWriter移行時に発見）を発見・修正。既存`existingSet`→MapのO(n²)化解消、`getAll()`並列化、`Promise.allSettled`ヘルパー（`settleOrThrow`）共通化も実施。
- **PR #691作成後のセカンドオピニオン**: 独立3エージェント（correctness/data-integrity/test-coverage、それぞれ実装意図を知らせず冷静にレビュー）+ `codex review --base main`を実施。3エージェントが共通して「`runAllDrift`の複数ページ・複数doc並行処理E2Eテストの欠如」を指摘（PRの存在理由に直結する重要なギャップ）。Codexへ「バランスの取れた対応方針」を追加相談し、確信度・ROIの高いものから実装：
  - `--concurrency`のparseArgsバリデーションテスト追加
  - `bulkWriter.close()`失敗時もBATCH_SUMMARY/監査ログに必ず到達するよう修正（`closeBulkWriterSafely`ヘルパー、`EVENTS.BULKWRITER_CLOSE_FAILED`新設）
  - `runAllDrift`の複数ページ（`startAfter`カーソル）+複数doc並行処理E2Eテスト追加（PRの主目的である大規模スキャンの核心機構を初めて検証）
  - 部分失敗→再実行の冪等性収束テスト追加
  - 削除側（decrement）並行競合テスト追加（create/increment側との対称性検証）
  - `settleOrThrow`の複数失敗集約（旧実装は最初の1件のみ記録、診断精度改善）
- **最終検証**: 71テスト全PASS（新規27件追加）、lint 0エラー、`tsc --noEmit` exit 0、CI（lint-build-test/GitGuardian/CodeRabbit）全pass。PR #691番号単位の明示認可を得てsquash merge、Issue #687自動クローズ。

**follow-up候補（本ミッションのスコープ外、次ミッション候補として次回triage）**:
- GitHub Actions workflow（`run-ops-script.yml`）に`--concurrency`オプションのUI経由指定を追加（現状はデフォルト値5固定でGHA経由では調整不可）
- `runWithConcurrency`が`compare-gemini-ocr-models-confirmed.ts`/`compare-ocr-arbitration-logic-confirmed.ts`/`backfill-detail-subcollection.ts`と重複、`scripts/lib/concurrency.js`への共通化検討
- ホットトークン（同一tokenId）への書込み競合をtokenId単位のmutex/キューで構造的に防ぐ設計（現状はconcurrency全体制御のみ）
- `documents_search_update` stageのcatch/stage-taggingロジックの単体テスト追加
- `--batch-size`と`--concurrency`が独立した軸として機能することの明示的なテスト追加

## Issue #680ミッション 完遂サマリ（〜2026-07-19アーカイブ時点）

kanameone本番の`search_index`肥大化による`too many index entries`エラー(searchIndexer機能停止、走査9770件中4391件=45%がdrift)を、Phase A(即時対症+復旧)・Phase B(tokenizer品質改善による再発防止)の2段階で完全解決した。

- **Phase A**（PR #681、2026-07-18）: `firestore.indexes.json`に`search_index.postings`のfieldOverride追加。Firestoreの自動インデックスエントリ数上限そのものに抵触しないよう設定変更のみで対応。kanameone/cocoro両環境へ`deploy-firestore-indexes.yml`経由でデプロイ後、`force-reindex --all-drift --execute`で4389+161件(GHA 6時間タイムアウトのため2回実行、各回は冪等で実害なし)を復旧、最終dry-runで`drift: 0件`を確認。
- **Phase B**（PR #684、2026-07-19本番反映）: `functions/src/utils/tokenizer.ts`の`generateFieldTokens()`に`includeBigrams`オプションを追加し、fileNameトークン化を`extractFilenameInfo()`のprefix経由に変更。`prefixType`(`office_name`のみbigram、`phone_number`/`document_id`/`unknown`はkeywordのみ)により高頻度語トークンの生成自体を抑制し、根本原因の再発を防止。tokenizer.test.ts新規テスト8件全PASS、`/review`+`/code-review medium`(findings 6件、CONFIRMED2件中1件は同PR内で半角カナoffice_name誤判定バグとして修正済み)実施。kanameone(run 29661871489)+cocoro(run 29662683899)へGHA経由でデプロイ完了(`gemini_model_id_override=code-default`指定、Issue #548で移行済みのgemini-3.5-flashを維持し意図しないモデル変更なし)。
- **Issue #680クローズ**（2026-07-19、番号単位認可済み）: 全AC達成、両環境本番反映完了により完全解決と判断。

**follow-up Issue起票（本ミッションのスコープ外、次ミッション候補として次回triage）**:
- **#686**: `extractFilenameInfo()`の`-L\d+-`マッチが非fax由来ファイル名(例: `見積書-L1000-final.pdf`)に偶然一致するとprefixが切り詰められ検索インデックスから内容が脱落するCONFIRMEDバグ(`/code-review medium`で検出、本PRのスコープ外として修正未実施) → **2026-07-19 session136でクローズ済み**（下記session136サマリ参照）
- **#687**: `scripts/force-reindex.js`が非推奨のatomic batch writerを逐次実行しており(Phase A実行時の6時間タイムアウト直接原因)、将来の大規模復旧作業向けにBulkWriter化を検討する価値がある(ただし複数docが同一`search_index/{tokenId}`へ競合書き込みする構造のため並列化には設計が必要) → **triage未実施のまま継続、次ミッション候補**

## 複数顧客FAX複製機能ミッション 完遂サマリ（〜2026-07-18アーカイブ時点）

session135のPR-B(BE本体)完遂後、以下を経てミッション本体を完了した(詳細な設計判断・レビュー経緯は下記session135サマリおよび該当PR参照)。

- **PR-C(FE表示、task6、PR #677マージ済み2026-07-17)**: `firestoreToDocument`/`useDocumentGroups.ts`への`distributionId`マッピング、`getReprocessClearFields()`のdistributionId保護分岐、詳細画面「同一FAXをN名に配信・要整理」バッジ表示。8角度code-review+review-pr+`/codex review-diff`実施、P1指摘(TOCTOUレース: 一括再処理時のdistributionId保護競合)を`handleBulkReprocess`のprocessing中doc除外ガードで対応。
- **PR-D(分割確認画面バグ修正、task7、PR #678マージ済み2026-07-17)**: AC-f、独立並列タスク。再現テスト追加の上修正。
- **dev実機検証(task8-1)**: `seed-dev-data.ts`に3候補fax fixture追加、`set-feature-flag.js`新設、dev Firestoreで実OCRパイプライン検証。3候補全てexact match検出、元doc+コピー2件が共通distributionId・共有fileUrl・detail/main dual-writeで正しく生成されたことを確認。
- **kanameone本番展開(task8-2、2026-07-17完了)**: decision-maker明示認可を得て、Stage1(コード反映: GHA Deploy Cloud Functions/Hosting両成功)→Stage2(flag ON、「実測を待たず今すぐON」選択)の順で実施。`settings/features.faxDuplication: undefined→true`。
- **cocoroへのコード反映(task8-3、2026-07-17完了)**: 「devと同じ内容は全prodへ反映する方針」に基づきコードのみ反映(flagは不変条件によりOFF/undefined維持)。
- **AC-eフォローアップ観測(2026-07-18)**: flag ON後のOOM/searchIndexerチャンク化リスクを観測した結果、懸念していたリスクは0件(AC-e自体はクローズ判断可能)。観測中に**別種の既存障害を新規発見**: kanameone本番で`search_index/{tokenHash}`が「too many index entries」エラーで更新停止(2026-07-05以前から継続、flag ON/複製機能とは無関係)。**Issue #680として起票**。

**ミッション完了の定義(GOAL.md旧版より、全AC達成状況)**: AC-a〜AC-h(AC-eの実測項目除く)は全て`[x]`達成。AC-eは上記フォローアップ観測により実質充足(懸念リスク0件)。不変条件(feature flagクライアント別制御、ADR-0021/ADR-0016非変更、新規statusフィールド不追加)も維持。

**申し送り事項(継続監視、次ミッションでも有効)**:
- dev環境の`settings/features.faxDuplication`は検証後もtrueのまま(意図的、devは顧客非対面のため実害なし)
- kanameoneのFirebase CLIローカルログイン(`systemkaname@kanameone.com`)は失効、今後のkanameone向けデプロイはGHA経由(SA鍵)必須
- kanameoneの`functions/.env.docsplit-kanameone`は`GEMINI_MODEL_ID=gemini-2.5-flash`固定、GHA実行時は`gemini_model_id_override=gemini-2.5-flash`明示指定必須
- ローカルADCは`yasushi.honda@aozora-cg.com`に紐付いており(hy.unimail.11@gmail.comではない)、kanameone/cocoro等クライアント環境への権限なし。運用方針上GHA主体でADCはほぼ使わないため修復不要(decision-maker確認済み、2026-07-17)

設計判断の詳細(D1〜D5、Codexセカンドオピニオン指摘事項、Evaluator分離協議、`/codex review`/CodeRabbit指摘の全内容)は本ファイル下記のsession135サマリ、および該当PR(#672, #673, #675, #677, #678)を参照。

<!-- session115〜117・121・122はLATEST.md詳細サマリ未追記（GOAL.mdのみ更新）。#539完遂・#540完遂(OCR実行所有権ガード)・#625(OCR Storage孤児化解消)・#547 Phase E是正(Hostingデプロイ漏れ)、および候補抽出スパイク(タスクA、PR#641)・候補抽出呼出し実装(タスクB、PR#642)・arbitration実装(タスクC、PR#643)の経緯はGOAL.md/ADR-0018/該当コミットメッセージで追跡可能なため遡及記載はROI低と判断、着手せず -->

<!-- session131はLATEST.md詳細サマリ未追記（GOAL.mdのみ更新）。J1〜J3(Issue #660修正の設計/実装/kanameone・cocoroデプロイ)、H-2(kanameone本番へのTask Gコード配備漏れ発覚・是正)、J4-1(個別グループ再構築機能実装、PR#665)の経緯はGOAL.md/ADR-0020/該当コミットメッセージで追跡可能なため遡及記載はROI低と判断、着手せず -->

<!-- session133〜134はLATEST.md詳細サマリ未追記（GOAL.mdのみ更新）。session133: Issue #664 phantom count恒久修正(ADR-0021)完遂+複数顧客FAX複製機能の設計相談着手。session134: task0(FE/BE横断影響調査、Explore4並列)+task1-2(カテゴリ表記化実装、PR#672)+task3(`/impl-plan`フルモード+Codexセカンドオピニオン+Fable5レビューで設計確定)+task4(PR-A: searchIndexer chunk化、PR#673)の経緯はGOAL.md「設計確定の経緯」節+該当PRで追跡可能なため遡及記載はROI低と判断、着手せず -->

## session136 サマリ（2026-07-19、Issue #686修正 — PR #689マージ・クローズ）

decision-maker指示「次にやるとよいオススメからすすめて」を受け、`/catchup`が提示した2件のtriage未実施follow-up候補(#686/#687)からAskUserQuestionで#686を選定し着手。

- **原因調査**: `extractFilenameInfo()`(`functions/src/utils/extractors.ts`)の正規表現`/^(.+?)-L\d+-/`が、`-L\d+-`にマッチした時点でprefixを切り詰めていた。`tokenizer.ts`の既存コメントに記載されたfax gateway正式命名規則`{prefix}-L{レーン番号}-{YYYYMMDDHHMMSS}`(14桁タイムスタンプ必須)を検証しておらず、非fax由来ファイル名(`見積書-L1000-final.pdf`等)への偶然一致で誤判定していた。
- **修正**: 正規表現を`/^(.+?)-L\d+-(\d{14})$/`に変更し、直後の14桁タイムスタンプ検証を必須化。TDD Red→Green(再現テスト2件追加)。
- **検証**: `functions/test/extractors.test.ts`全PASS(9件)、`tokenizer*.test.ts`全PASS(45件)、`npm test`全体1857 passing/0 failing、lint 0 errors、`tsc --noEmit` 0 errors、`/code-review low`指摘0件、CI(lint-build-test)全PASS。
- **PR #689**: featureブランチ→squash merge→ブランチ削除。`Closes #686`キーワードで自動クローズ確認済み。
- **ドキュメント整合性チェックで発見**: 本セクション以降(「現在のフェーズ」等)がsession135時点のまま更新されておらず、GOAL.md(Issue #680完遂・次ミッション未着手)と不整合だったため本handoffで是正(下記参照)。

**Issue Net**: Close 1件(#686)、起票0件、Net +1。

## session135 サマリ（2026-07-16〜17、複数顧客FAX複製機能 PR-B(BE本体、task5-1〜5-6)完遂 — PR #675マージ）

前セッション(134)末尾でGOAL.mdに記録した中断点「PR-Bはdecision-makerとの着手タイミング調整待ち」を受け、`/catchup`起点でdecision-makerに確認(AskUserQuestion、OCRパイプライン+機微な顧客データを扱う最重要パートのため明示確認を挟む設計だった)。「PR-B 5-1から着手（推奨）」の承認を得て着手し、5-1〜5-6を完遂、4段のレビュー（`/code-review high`→Evaluator分離→`/codex review`→CodeRabbit自動レビュー）を経てPR #675としてマージした。

### 実装
`shared/types.ts`に`distributionId?: string`追加、feature flag(`isFaxDuplicationEnabled`、既定OFF fail-closed)、複製判定の純粋関数`planFaxDuplication`/`buildFaxDuplicationMemberOverride`(`functions/src/ocr/faxDuplication.ts`)、OCR完了トランザクションへの組込み。テスト容易性のため`processDocument()`から最終トランザクション部分を`applyOcrCompletionTransaction()`として抽出し、OCR/Storage副作用なしでFirestore emulatorのみによる直接integration testを可能にした。削除順序に依存しないStorage/gmailLogsの安全網(`sourceLogDeletionGuard.ts`)、`cleanup-duplicates.js`のdistributionId認識対応も実施。

### `/code-review high`（8角度finder + verify）
3件のCONFIRMEDバグを検出・修正: ①customerConfirmed/verified済みdocの複製上書き防止漏れ、②feature flag読取位置のtry/catch漏れ、③fileId単独検索によるerror再処理時の兄弟doc誤操作リスク(FE側`useErrors.ts`、複製兄弟docが同一fileIdを共有するようになったことに起因)。

### Evaluator分離協議（CLAUDE.md quality-gate.mdの発動条件: 新規機能+5ファイル以上）
2件の指摘を受領。**HIGH**: `getReprocessClearFields()`(useDocuments.ts)がdistributionId保持docを考慮せず顧客系フィールドを無条件クリアするギャップ → 機能修正はせずtask 6-2(PR-C)へ明示スコープ外化(TODOコメント記載、AI-executor-not-decision-maker原則に基づく判断: 今回の認可範囲はPR-Bのみ)。**MEDIUM**: AC-bのテストが2候補ケースのみでGOAL.md実例(利用者3名記載FAX)を未網羅 → 3候補のユニット/統合テストを追加。

### `/codex review`（大規模PRのセカンドオピニオン、23ファイル+1958行）
P1指摘1件: 複製コピーが元docのOCRテキストoffload先Storageオブジェクト(`ocr-results/{元docId}/{run}.txt`)をそのまま参照しており、元docの以降の再処理でIssue #625成功パスcleanup(docId単位所有前提)が削除してしまい、コピー側`getOcrText`が`not-found`になる欠陥をコード読解で独立検証(CONFIRMED)。自分でコードを読み、「元docの再処理」で発火する具体的な再現条件を確認した上で、decision-makerに3択(案A: 各コピーに独立複製/案B: cleanup側に参照確認追加/対応せず既知ギャップとして記録)を提示。「案Aで今修正（推奨）」の承認を得て、GCS server-side copyで各コピー専用のStorageパスへ複製する修正を実施(Issue #625のcleanupロジック自体には一切手を入れない設計)。

### CodeRabbit自動レビュー（PR作成後の自動起動、ui-change-merge-check.sh hookとは別系統）
実質4件の指摘を検出、全て自分でコードを読み妥当性を検証した上で修正:
- `sourceLogDeletionGuard.ts`: sourceType複合キーでのfileId絞り込みが、legacy doc(sourceType未設定)が兄弟docと同一fileIdを共有するケースの検知漏れを引き起こす欠陥 → 姉妹の`storageDeletionGuard.ts`(fileUrl単独照合)と設計を統一しfileId単独照合に変更
- `ocrProcessor.ts`: 直前の`/codex review`対応自体に残っていた欠陥。複製先キーに`newDocRef.id`(Firestore transaction自動リトライ毎に非決定に変わる値)を使っていたため、リトライ時にStorageコピーが複数回実行され孤児オブジェクトが残るリスク → `${元docId}-${customerId}`(リトライに対して安定な値)に変更
- `faxDuplication.ts`: customerId重複排除前のscore降順ソートが、呼出元(extractors.ts)の暗黙契約のみに依存していた → 関数自身でも明示的にソートするよう変更(モジュール境界をまたいだ暗黙契約への依存を排除)
- `cleanup-duplicates.js`: 複製配信docのfileUrl保護収集が重複グループのループ内(escalatedグループはcontinueで到達前にスキップ)でのみ行われており、エスカレーショングループ・fileName単独グループの複製配信docが保護対象から漏れる欠陥 → 全ドキュメントスナップショットからの事前収集方式に変更

### マージフロー（CLAUDE.md「PR マージは番号単位明示認可」+「UI変更PRはCI全PASS+ui-verifiedラベル」の2つのhookゲート）
CI/CodeRabbit完了待ち(Monitorツールでポーリング)→AskUserQuestionでのマージ承認取得(内容変更のたびに再承認、計2回)→`ui-change-merge-check.sh`hookが`ErrorsPage.tsx`(`documentId`引数追加のみ、視覚的変更なし)の未検証を検知→Playwright MCPでdev環境の実機確認(エラー履歴ページ表示・再処理確認ダイアログの配線動作)→PRコメントに証跡記録→`ui-verified`ラベル付与→マージ実行。

### 最終テスト結果（全layer green）
functions unit 1840 / functions integration 145(Firestore emulator) / scripts 103 / frontend 345、functions `tsc --noEmit`エラーなし。

### §4.6同根再発スキャン
過去7日のhandoff archiveを「distributionId」「ocrResultUrl」「孤児」等でgrep。完全一致する同根候補は0件(distributionId/ocrResultUrlは本セッションが初出)。ただし「孤児化」という**設計パターン**自体は本コードベースで複数回観測されている(Issue #539 splitPdf二重race、ADR-0018 Phase D、Issue #625)。今回のCodeRabbit指摘(transaction retry時のStorage孤児)も同じ設計パターンの新たな発現箇所であり、Firestore transactionの再試行と非決定的な副作用(Storage書込み・ID採番)を組み合わせる設計は本コードベースで繰り返し孤児化を生みやすい、という構造的傾向として記録(即対応不要、将来の類似実装時の注意点)。

### §4.7対症療法判定
該当なし。Codex/CodeRabbit双方の指摘とも、実際にコードを読み再現条件を特定した上での根本原因修正(独立Storageパス化、リトライ安定キー化、sourceType複合キー撤去、事前収集方式への変更)であり、retry/timeout/fallback等の対症療法ではない。検証もemulator/実機ブラウザを含む多層で実施。

### Issue Net
Net 0（close 0件・起票 0件。本セッションはGOAL.md駆動の機能実装+PRマージのみで、Issue起票・close操作なし）

### 引き継ぎ教訓
- **同一コンテキストでの自己レビュー→他AIレビューの多段構成が有効だった**: `/code-review high`(Claude自身)→Evaluator(別コンテキストClaude)→`/codex review`(別ベンダーAI)→CodeRabbit(別ベンダーAI、PR自動起動)の4段で、段階が進むごとに異なる種類の欠陥(実装ミス→設計ギャップ→アーキテクチャ欠陥→コーディング規約/堅牢性)が見つかった。特に`/codex review`で見つけたP1修正自体に、CodeRabbitがさらに別角度(transaction retry非決定性)の欠陥を発見しており、単一レビューでは収束しなかった可能性が高い
- **マージ承認は内容変更のたびに再取得が必要**: CodeRabbit指摘対応で新規コミットを積んだ後、最初の承認をそのまま使い回さず再度AskUserQuestionで承認を取り直した(PR merge authorizationは「番号単位」だが、diffが変わればその番号の意味も変わるため)
- **hookが検出する「UI変更」は視覚的変更の有無を問わない**: `ErrorsPage.tsx`への1行のデータ配線追加(`documentId`引数)でも`.tsx`拡張子であるためui-change-merge-check.sh hookは発火した。hookをbypassせず、変更が実際に視覚へ影響しないことを実機で確認した上でui-verifiedラベルを付与する手順を踏んだ

## session132 サマリ（2026-07-15、GOAL.mdミッション完全達成 — J4-2/タスクI実行 + Issue #664見送り記録）

session131までに実装・dev検証・kanameone/cocoroへのコード配備が完了していたIssue #660修正(ADR-0020)を受け、本セッションで残タスク(J4-2: kanameoneの過去ドリフト是正実行、タスクI: cocoro本番バックフィル)を完遂し、GOAL.mdのミッション（kanameone担当CM別集計バグ修正 + 派生ミッションIssue #660）を完全に達成した。

### J4-2: 過去ドリフトの是正実行(kanameone)
対象9グループ（`careManager_奥村敬子`等8CM + CM未設定 + `customer_未判定`）に対し、GHA `run-ops-script.yml`経由で「dev環境フルリハーサル→kanameone本番実行」の順で実施。
- **devリハーサル**（J4-2a）: dry-run(run 29403721464)→実行(run 29403944606、9/9グループ再構築成功)→再診断(run 29404760385)で恒等式一致を確認。副次的に対象9グループ**外**の5groupIdでIssue #660型の既存ドリフトを新規発見（dev環境はテストデータのみのため実害なし、記録のみ）
- **kanameone本番実行**（J4-2b、decision-maker番号単位認可済み）: dry-run(run 29405072337)で`careManager_奥村敬子`の現在count=80→再構築後40（GOAL.mdタスクH記載の2倍ドリフトと整合）等を確認→実行(run 29405377012、ゲート閉鎖→10分ドレイン待機→9/9グループ再構築→ゲート再開、738.2秒)→再診断(run 29406295294)。**結果: customer/office/documentType/careManagerの4type全一致(9666、officeのみ9663)、groupId単位でも全一致（相殺による見逃しなし）、恒等式`customer=careManager(実CM+CM未設定)`が✅一致**

### タスクI: cocoro本番バックフィル実行
当初想定していた`--backfill-cm-unassigned`（Task G、初回作成専用）はdry-runプレビューで「CM未設定グループ既存(count=3)」と判明。`backfillUnassignedCareManagerGroup()`の事前チェック（グループ既存時はエラー、`functions/src/utils/groupAggregation.ts:694-703`）により、実行モードでは10分ドレイン待機後にエラー終了する設計上の問題を**実行前に検出**。J3コード配備後の通常フローで自然作成された小規模グループ（count=3、本来749件見込み）には初回作成関数ではなく個別再構築が適切と判断し、J4と同じ`--rebuild-groups`方式に切替（decision-maker承認）。dry-run(run 29407260477)→実行(run 29407396013、605.9秒)→再診断(run 29408143613)。**結果: 4type全一致(1085)、groupId単位で全一致、恒等式✅一致**

### 最終確認・ミッションクローズ
`fix-stuck-documents --include-errors --dry-run`をkanameone/cocoro両環境で実行（run 29408324706/29408329686）、両環境とも「対象のドキュメントはありません」でエラー率への影響なしを確認。**GOAL.mdの完了の定義・進行中tasksチェックリスト全18項目が`[x]`化**され、ミッションを完全達成した。

### Issue #664への対応(decision-maker判断: 見送り)
理論的エッジケース（documents create/delete順序不同配信によるphantom count）について、J4-2/タスクIの実測結果（両本番環境で観測した実際のドリフトは全てIssue #660由来、Issue #664型の事例は0件）を根拠に、ADR-0020記載の残存リスクのまま対応見送りと決定。Issue #664へコメント記録。

**個人情報保護インシデント（軽微、実害前に防止）**: 初回のコメント投稿がauto mode classifierにブロックされた。理由は、コメント案に実在のケアマネジャー氏名（GOAL.md/ADR-0020には既に記載されているkanameone本番データ由来の実名）を含んでおり、`doc-split`リポジトリが実は**public**（`isPrivate: false`、今回`gh repo view`で確認するまで明示的に意識されていなかった）であるため、GitHub Issueへの新規公開行為に該当すると判定されたため。氏名を一般化表現（「特定CMグループでの2倍計上」等）に差し替えて再投稿し解決。**申し送り**: GOAL.md/ADR-0020自体には既に実名がコミット済みでpublicリポジトリに存在する状態。これは今回新たに生じた問題ではなく既存の運用パターンだが、public repoでの個人情報の扱いとして一度decision-makerの確認を得る価値がある（今回はスコープ外として対応せず、記録のみ）

### §4.6同根再発スキャン
本セッションは修正PR作成なし（GHA経由の運用スクリプト実行のみ）のため対象外。

### §4.7対症療法判定
本セッションは修正PR作成なしのため対象外。運用スクリプト実行はいずれも事前診断（dry-run）→実行→事後検証（再診断）の3段構成で、smoke程度に留まらない検証を伴う。

### Issue Net
Net 0（close 0件・起票 0件。Issue #664へのコメント記録のみで、close/起票を伴う操作なし。GOAL.md駆動ミッションの完遂作業のため）

### 引き継ぎ教訓
- **本番操作前の設計整合性チェックが実害を防いだ**: cocoroの`--backfill-cm-unassigned`実行前にコードの事前チェックロジック（既存グループがあるとエラー）を読み、10分のドレイン待機を無駄にする前に`--rebuild-groups`への切替を判断できた。dry-run結果の数字（「CM未設定グループ既存(count=3)」）に違和感を持ち、実行前に立ち止まったことが起点
- **リポジトリの公開設定は作業開始前に確認すべき**: `doc-split`がpublicリポジトリであることをauto mode classifierのブロックで初めて明示的に認識した。GOAL.md/ADR等の内部ドキュメントに実在の個人名を記載する既存の運用は、public repoという前提を意識せずに定着していた可能性がある
- ゲート制御を伴う本番操作（メンテナンスゲート閉鎖+10分ドレイン待機）は、kanameone/cocoro合わせて計4回（dry-run 2回除く実行2回）実行したが、いずれもゲートの`finally`による確実な再開・dry-run予測値と実行結果の完全一致を確認しており、ADR-0019/ADR-0020の設計が実運用で堅牢に機能することを実証した

---

## session130 サマリ（2026-07-14、GOAL.mdタスクA/B/C/F実装 + 3層品質ゲート + PR #656マージ）

session129の調査・計画を受け、`/impl-plan`フルモードでタスクA（`groupAggregation.ts`集計ロジック修正）+B（フロントエンド展開経路）+C（単体テスト）+F（dev環境実機確認）を実装し、PR #656として完遂・マージした。

### 実装内容
- `resolveGroupKeyAndDisplay()`を新設し、`getAffectedGroups()`/`rebuildAllGroupAggregations()`の両方でcareManagerKey空文字を予約key(`__UNASSIGNED_CARE_MANAGER__`)+表示名「CM未設定」へ統一フォールバック
- `useDocumentGroups.ts`の`fetchGroupDocuments`を、予約key→空文字変換に対応させグループ展開クエリを修正
- 21件(BE)+5件(FE)の単体テストを追加、Firebase Emulator(auth/firestore/functions)+Playwright MCPでdev環境実機確認（CM未設定グループ表示→クリック展開→顧客サブグループ→実書類到達まで確認）

### 実装中に発見・修正した2件のバグ（多層レビューの効果）
1. **`/code-review high`（8角度並列finder+個別検証12件）で検出**: careManagerだけ無条件にCM未設定へフォールバックすると、`status:pending/processing/error`（OCR未完了でcustomerKeyも空）の書類で担当CM別合計が顧客別合計を上回る新たな非対称性を再導入していた。`canFallbackToUnassigned`(customerKey非空)を条件に追加し、「顧客別に計上される書類は必ず担当CM別にも計上される」不変条件をstatus値の列挙に頼らず保証する設計に修正
2. **`codex review-diff`（P1×2件）で検出**: 上記修正でバックエンドの集計対象が絞られた結果、フロントエンドのグループ展開クエリ（customerKey条件を持たない）がpending書類まで一覧表示してしまう不整合が発生 → 同一条件をクライアントサイドフィルタに追加して解消。もう1件（`rebuildAllGroupAggregations()`未呼出しで既存本番データ未移行）はGOAL.mdタスクG/Hへ意図的に切り出し済みの設計として確認

### `/review-pr`（3エージェント並列: code-reviewer/pr-test-analyzer/comment-analyzer）で追加検出・修正
- コメントの自己矛盾（customer/office/documentTypeキーが「空になり得ない」という記述が、8行下のpending状態を扱う記述と矛盾）を修正
- テストのkanameone実測値コメントに日付を追加（将来の本番バックフィルで数値が変わった際の混乱防止）
- フロントエンドの`fetchGroupDocuments`フィルタ述語（本PR中に一度Codexが不整合を検出した箇所）を`shouldIncludeInGroupDocuments()`として抽出・export し単体テスト5件を追加

### §4.6同根再発スキャン（本セッションの気づき）
`functions/src/utils/groupAggregation.ts`/`updateDocumentGroups.ts`は過去7日以内にPR #611（Issue #547 Phase E、`isAggregationUnchanged`早期return）でも変更されていた。両PRとも「documentGroupsの1グループ=1 Firestoreドキュメントをトランザクション更新する集計トリガー設計」に起因する問題（Phase E: 無駄な書込みの削減、本PR: CM未設定という単一巨大グループへの書込み集中）という点で同根の可能性がある。仮説: ①documentGroups設計にホットドキュメント対策（シャーディング等）が元々ない ②各エッジケースが都度パッチ対応されている ③CM未設定/documentType「未判定」等の「キャッチオール」バケットは実CM名等より書込みが集中しやすい構造的性質を持つ。次に同根が出るとすれば、GOAL.md副次課題に既記載の「documentType『未判定』過集中(25.6%)」で同種のホットドキュメント競合が顕在化する経路が最も可能性が高い。**本PRでは修正せず**、GOAL.mdタスクGの「追加考慮事項」として記録済み（バックフィル設計時に合わせて検討）。

### §4.7対症療法判定
本セッションの修正はretry/fallback等ではなく、ドキュメントライフサイクル（pending/processing/error/processed）の実際の挙動を`functions/src/gmail/checkGmailAttachments.ts`等のコード直読で調査した上での論理修正。過去30日以内の同症状fix PRなし（本PRが初のfix）。検証もunit test 26件+Playwright実機確認+3層独立レビュー(code-review/codex/review-pr)+CI(lint/build/test/E2E)全緑と、smoke程度に留まらない。該当基準0件のため対症療法疑いなし。

### Issue Net
Net 0（GitHub Issue非経由、GOAL.md駆動ミッション。PR #656は既存Issueに紐付かない）

### 引き継ぎ教訓
- 同一セッション内で3層の品質ゲート（code-review high→codex review-diff→review-pr 3エージェント）を通したところ、各層が異なる角度のバグ・不整合を検出した（1層目で本質的なロジックバグ、2層目でその修正が生んだ副作用、3層目でコメント品質とテストカバレッジ）。単発のレビューでは検出できなかった可能性が高い
- 8角度並列code-reviewのうち複数エージェントが独立に同一の指摘（pending状態の非対称性）へ収束したのは、単一finderの偶然の指摘ではなく実在するバグである強いシグナルだった
- Firebase Emulator + Playwright MCPでの実機確認は、`.env.local`が本番プロジェクト(cocoro)を指していたため、`.env.test`への一時切替→検証→元設定への復元を確実に行う必要があった（このプロジェクトの`.env.local`切替リスクは過去セッションでも複数回発見されている継続課題）

旧ミッション（OCR突合精度向上、session121〜125）の完全な記録は `docs/handoff/archive/2026-07-history.md` へ移動済み（監視・確認事項セクションはGOAL.mdに残置、新ミッションでも継続有効）。

---

## session129 サマリ（2026-07-14、GOAL.mdミッション交代: OCR突合精度向上→担当CM別集計バグ修正）

kanameoneから「顧客別と担当CM別で利用者件数に差異がある（CM別だと明らかに数字が小さい）」という報告を受け、調査の上で新ミッションに着手した。

### 調査結果サマリ
- **根本原因**: `Document`型の`customerName`/`officeName`/`documentType`は必須フィールド(マッチ失敗時は`不明顧客`/`未判定`にフォールバック)だが、`careManager`は任意フィールドでフォールバックなし。集計ロジック`functions/src/utils/groupAggregation.ts`は正規化キーが空の場合そのgroupTypeの集計から丸ごと除外するため、careManager別集計だけが顧客別集計より大幅に少なくなる非対称性がある
- kanameone実データ実測: customer合計9,620件 vs careManager合計6,283件(差34.7%)。うち「不明顧客」グループが3,280件、実在顧客だがCM欠落が91件(customerIdなし62/マスターCM未設定22/**同期漏れ疑い7件**)
- バグの発生源3箇所を特定: `functions/src/ocr/ocrUpdatePayloadBuilder.ts`(OCR自動取込)・`functions/src/pdf/splitDocumentBuilder.ts`(手動分割)・`scripts/migrate-document-groups.js`(groupAggregation.tsのロジックを別実装した独立コピー)
- `/codex plan`セカンドオピニオンで数値矛盾(9,620-3,371=6,249≠6,283)を指摘され、GitHub Actions経由の新規診断スクリプト(`scripts/diagnose-caremanager-group-gap.js`, PR #654)で実データ再検証。原因は前回集計スクリプトの母集団定義ミス(`status='split'`除外漏れ)と判明し、正しい母集団では恒等式が誤差0で一致することを実証
- 副次発見: `documentGroups`実測値と動的再計算の間にcustomer-1件/careManager-25件の微小なズレ(over-count疑い、原因未特定、バックフィル設計で解消見込み)

### decision-maker確定事項
- 修正方針: careManager未設定書類を「CM未設定」グループとして可視化(除外ではなく計上)、集計層のみで対処しDocument.careManagerフィールド自体は変更しない
- スコープ: 同期漏れ7件の原因究明・documentType「未判定」過集中問題・careManager検索インデックス欠落は別タスクとして切り離す

### 詳細な実装計画・タスク一覧
docs/handoff/GOAL.md（本アーカイブ後に新ミッションとして記載）参照。

### 引き継ぎ教訓
- ローカルADCでのマルチクライアント確認は、ブラウザプロファイル切替のタイミングでログインURLの再表示が必要になり往復コストが高い。CLAUDE.md記載の「GitHub Actions経由推奨」を優先すべきという実地判断が今回確定した（decision-maker「もうADCではやりません、GHAでやります」）
- read-only診断もGHA運用スクリプト(`scripts/`+`run-ops-script.yml`)として正式に追加すると、後続の再検証が容易になる(今回の数値矛盾の再検証で実際に効果を発揮)

旧ミッション（OCR突合精度向上、session121〜125）の完全な記録は `docs/handoff/archive/2026-07-history.md` へ移動済み（監視・確認事項セクションはGOAL.mdに残置、新ミッションでも継続有効）。

---

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


<!-- session119・120・123・124・126・127はsession135(2026-07-17)でLATEST.md 60KB超過によりarchive/2026-07-history.mdへ移動済み。詳細はアーカイブ参照(概要: session119=#620/#622/#626完遂+本番2環境展開、session120=A/Bテスト残差原因調査、session123=タスクD/F実装+PR#644、session124=タスクG/H完遂+PR#646/#647/#648、session126=kanameone請求急増原因特定、session127=コスト圧縮追加検証) -->

## 現在のフェーズ

**次ミッション未着手。decision-makerからの新規指示待ち**（GOAL.md準拠、2026-07-19更新）。「複数顧客FAX複製機能」ミッションは2026-07-18に、「Issue #680(kanameone本番search_index肥大化)」ミッションはPhase A/B完遂の上2026-07-19に、いずれも全AC達成済みで完遂アーカイブ済み(詳細は上記各完遂サマリ参照)。

follow-up候補: **#687**(force-reindex.jsのBulkWriter化)のみtriage未実施で残存。**#686**は2026-07-19 session136で修正・クローズ済み(上記session136サマリ参照)。

過去のミッションは全てクローズ済み: 「担当CM別集計バグ修正」+派生ミッション「Issue #660修正」は2026-07-15 session132で完全達成（全18項目`[x]`）。「OCR突合精度向上」は2026-07-14 session124で撤退基準適用によりクローズ（実装は保持、本番展開は見送り）。「#547/#548コスト圧縮」は2026-07-10 session113で技術的完遂・session117で本番是正完了。詳細はarchive参照。

## 直近の変更（session119〜136、簡潔に）

- **session136 (2026-07-19)**: 上記session136サマリ参照。**Net +1**（Close 1件: #686）。Issue #686(非fax由来ファイル名の`-L\d+-`偶然一致による検索インデックス脱落バグ)をTDDで修正、PR #689マージ・クローズ。
- **session135 (2026-07-16〜17)**: 上記session135サマリ参照。**Net 0**。複数顧客FAX複製機能PR-B(BE本体)完遂、PR #675マージ。4段レビュー(code-review high→Evaluator→codex review→CodeRabbit)で計8件の欠陥検出・修正。
- **session133〜134 (2026-07-15〜16)**: LATEST.md詳細サマリ未追記(GOAL.mdのみ更新、上記コメント参照)。**Net 0**。Issue #664恒久修正(ADR-0021)完遂、複数顧客FAX複製機能の設計確定(`/impl-plan`+Codex+Fable5)、PR-A(searchIndexer chunk化、PR#673)+カテゴリ表記化(PR#672)完遂。
- **session132 (2026-07-15)**: 上記session132サマリ参照。**Net 0**。GOAL.md「担当CM別集計バグ修正」+Issue #660ミッション完全達成。
- **session128〜130 (2026-07-14)**: 上記各サマリ参照。**Net 0**。GOAL.mdタスクA/B/C/F実装(PR#656)、kanameoneコスト調査(トリガーストーム特定、PR#651/#652)。
- **session119〜127**: `docs/handoff/archive/2026-07-history.md`参照（session135で60KB超過によりアーカイブ移動）。

session29〜118の詳細は `docs/handoff/archive/2026-0{4,5,6,7}-history.md` 参照。

## 次のアクション（3 分割・SKILL.md §2.5 参照、session136時点）

**即着手タスクなし。条件待ちなし。却下候補（triage未実施のfollow-up）1件。**

### 即着手タスク
なし

### 条件待ち（明示 trigger 付き）
なし

### 却下候補（記録のみ）

| # | 項目 | 分類 | 着手しない理由 |
|---|------|------|--------------|
| 1 | Issue #687: `scripts/force-reindex.js`のBulkWriter化 | 新規価値創出（起点 triage未実施） | GOAL.md自身が「triage未実施」と明記。次ミッション起点の選定はdecision-maker領分 |

過去ミッション由来の継続保留事項（PR#474 close / `.artifacts/`扱い / #503・#251・#238 / frontend/.envフォールバック恒久対策 等）はarchive参照。

### 残留プロセス（マシン全体スコープ、現在のプロジェクトに限らない）

多数検出、いずれもdoc-split以外の別プロジェクト・常駐MCPサーバー（context7-mcp/drawio-mcp/codex mcp-server/playwright-mcp/TypeScript language server等）・エディタ由来で、本セッション(Issue #686対応)が新規起動したプロセスはない。停止提案は行わない。
