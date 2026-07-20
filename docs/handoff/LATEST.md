# ハンドオフメモ

**更新日**: 2026-07-20（Google Drive連携機能 新規ミッション着手・Task1完了）

## dev/kanameone/cocoro環境監査・保守検証セッション 完遂サマリ（〜2026-07-20時点）

decision-makerの「dev/prodで実装内容が揃い、検証・安全性対応も可能な限り行えた最適解の状態か」という確認を起点に、3環境（dev/kanameone/cocoro）の実装整合性とデプロイ健全性を監査した。新機能実装ではなく、直前ミッション（Issue #687/#694）完遂後の保守メンテナンスフェーズの棚卸し。

- **発見1**: Cloud Functionsの直近デプロイ履歴（GitHub Actions実行ログのheadSha照合）から、Issue #686修正（fax由来ファイル名の`-L\d+-`誤判定、検索インデックス脱落バグ、PR #689）がkanameone/cocoro本番に未反映と判明（Hostingも2026-07-17時点で停止、devより2〜3日遅延）。
- **影響範囲調査**: read-only調査スクリプト（`scripts/audit-filename-pattern-issue686.js`、PR #696でマージ、`run-ops-script.yml`に恒久登録）を追加し、dev/kanameone/cocoro全環境のdocumentsコレクションをスキャン。旧正規表現にマッチし新正規表現にマッチしない実データ（＝バグの影響を受けた実データ）は**3環境とも0件**（kanameone 9,818件・cocoro 1,106件・dev 167件走査）。実害なしと確認した上でCloud Functionsデプロイを実施（`gemini_model_id_override=code-default`、前回同様の設定を踏襲）。kanameone(run 29707201401)/cocoro(run 29707203873)ともコミット`0c829b5`で成功、3環境のFunctionsが最新mainで統一された。
- **デプロイ後の健全性確認**: `check-function-error-logs`をkanameone/cocoro双方で実行。kanameoneは過去24時間エラー0件。cocoroはデプロイのロールアウト中（23:08頃、3関数=`getOcrText`/`exchangeGmailAuthCode`/`removeMasterAlias`にほぼ同時多発）に「Invalid request, unable to process.」エラー計5件を検出したが、17分後の再確認で新規エラーはゼロ、収束済みと確認（新旧リビジョン切り替え時の過渡的事象と判断）。
- **Firebase Hosting未反映差分の実害精査**: kanameone/cocoroのHosting最終反映（2026-07-17時点）以降の`frontend/`差分はPR #694の`devProjectGuard.ts`のみ。`checkDevProjectGuard(projectId, isDev)`は`isDev`引数がfalse（本番ビルド）なら即returnする実装のため、未反映でも実害なしと実装レベルで確認（対応不要と判断）。
- **Firestore Indexes/Rules**: kanameone/cocoro双方とも2026-07-18時点で最新反映済み、以降差分なしを確認。
- **定常運用の健全性**: Health Report/Scheduled Master Auditの日次自動実行が直近5日間（2026-07-15〜19）連続success。
- **Firestoreバックアップ**: `Setup Firestore Backup`workflowが2026-04-10に初回設定成功済み（Native Firestore backupのためCloud Scheduler等の外部依存なし、継続は自動）。ただし継続稼働の直接確認（`gcloud firestore backups schedules list`相当）はローカルCLI認証・ADC権限双方で403/再認証エラーとなり未実施（GitHub Actions側の確認スクリプトも未整備）。**follow-up候補として次項に記録**。

**follow-up候補（本セッションのスコープ外、次ミッション候補として次回triage）**:
- Firestoreバックアップの継続稼働状況（実際にバックアップが取得され続けているか）を、GitHub Actions経由のSA権限で確認する仕組みが未整備。初回設定（2026-04-10）は成功しているため緊急性は低いが、直接確認の手段がない状態

## frontend/.env dev環境誤接続防止ミッション 完遂サマリ（〜2026-07-20時点）

decision-makerの「今着手できるROIの良いものは？」という相談を起点に、既存Issue候補(#503/#251/#238)は全てtrigger未成立と判断した上で、Codexへのセカンドオピニオン相談で新たに「`frontend/.env`(gitignoredのローカルフォールバック値)が本番kanameone値のまま放置され`npm run dev`が本番を向く」事故がsession108/118/130で3回再発していた問題（GitHub Issue未起票のまま継承事項リストにのみ残存）を発見し、plan mode で3層の恒久対策を設計・実装した。

- **対策1（根本原因）**: `frontend/.env`をdev固定値でgit追跡下に置く（`.gitignore`に`!frontend/.env`例外追加）。Firebase web configは非機密（Vite公式ドキュメントで`process.env`優先の仕様も確認、CI/デプロイへの影響なしと裏付け済み）
- **対策2（deploy script）**: `scripts/deploy-to-project.sh`のcleanup()を修正、デプロイ前に`.env.local`が無かった場合はデプロイ後に残置せず削除
- **対策3（ランタイムガード）**: `frontend/src/lib/devProjectGuard.ts`新設、dev modeで`projectId`が`doc-split-dev`以外ならconsole.error+画面バナー警告（warn-only、意図的なclient向けdebugを妨げない設計）
- **`/code-review medium`（8角度finder+verify）**: CONFIRMED4件（`deploy-to-project.sh`の`set -e`下`rm -f`失敗時exit code上書き/`HAD_ENV_LOCAL`フラグ冗長/`docs/setup-guide.md`のドキュメント前提崩れ/env-guardのテスト未追加）を全て本PRで反映。PLAUSIBLE3件（並行デプロイrace condition/allowlistハードコード二重管理/sonner toast重複）は現状の運用実績・severityを踏まえ見送り
- **Codexセカンドオピニオン（2回）**: 1回目はROI判断への意見（3 Issue候補は保留妥当、frontend/.env問題を新規指摘）。2回目は実装diffへのセカンドオピニオンで、`scripts/setup-tenant.sh`の`.env.local`自動コピー残置（第3の書込み経路、CONFIRMED、本PRで対応）と`deploy-to-project.sh`のproject ID整合性検証欠如（別スコープと判断、Issue #693起票）を発見
- **同根再発スキャン（handoff時）**: `frontend/.env`/`.env.local`への全書込み経路を再走査し、`scripts/run-e2e-tests.sh`にも1箇所あることを確認したが、扱う値が常に`doc-split-dev`固定のためリスクなしと判定（対応不要）
- **検証**: typecheck/lint(0 errors)/test(24ファイル360件全PASS)/build全PASS、本番ビルドでdead code除去確認、Playwright MCPでダミーprojectIDによるガード発火の実機確認、bash再現実験でexit code修正を実証
- **PR #694**（squash merge、2026-07-20）、**Issue #693起票**（deploy-to-project.shのproject ID整合性検証、P2・trigger未成立の任意改善として次ミッション候補に保持）

**follow-up（本ミッションのスコープ外、次ミッション候補）**:
- **#693**: `deploy-to-project.sh`が`.env.$ALIAS`の`VITE_FIREBASE_PROJECT_ID`と実際のデプロイ先プロジェクトIDの一致を検証していない。誤った`.env.kanameone`等で無警告の誤デプロイが起きうる。P2、trigger未成立

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

## session137 サマリ（2026-07-20、Google Drive連携機能 新規相談 → 実機技術検証 → plan mode計画確定 → Task1実装着手）

decision-makerからcocoro/kanameの「利用者ごとのGoogleドライブフォルダへの自動振り分けエクスポート」新機能相談を受け、要件整理・アーキテクチャ調査・実機技術検証・plan modeでのフル計画設計を経て、Phase 1 MVPのTask1（型定義・データモデル・ADR）まで実装した。次ミッションとしてGOAL.mdに登録。

### 要件・設計相談
両クライアント（かなめ: 5階層+姓/フリガナ頭文字命名規則、cocoro: 3階層+担当替え時フォルダ移動運用）の非対称なフォルダ構成を、個別対応ではなく共通の仕組みで吸収する方針をdecision-makerが明示。既存アーキテクチャ調査（Gmail OAuth連携パターン、Firestoreデータモデル、テナントカスタマイズの仕組み）を経て、セグメント型テンプレート・OAuth独立接続・outboxパターンの設計方針を対話で収束させた。

### モデル選定（Fable5 vs Codex）
2026-07-20時点の一次ソース（Anthropic公式Fable5発表、OpenAI公式GPT-5.6発表）とX上の実使用感を調査した上で、「0→1の設計判断」にはFable5が最適と判断（Anthropic公式の「方向性選定・リソース配分」という強みの明記、X上の複数独立投稿で同傾向）。Fable5に切り替えてフォルダテンプレート設計・OAuth接続分離方針・スコープ戦略・同期トリガー方式の詳細設計を実施後、`/model opusplan`に復帰。

### 実機技術検証（スパイク）
CLAUDE.mdのスパイクレーンに従い、`doc-split-dev`環境でGoogle Picker + Drive API v3の実機テストを実施：
- テスト用HTML（`frontend/public/spike-test.html`、使用後削除済み）をVite dev server経由でPlaywright操作
- GCP Console上でOAuth ClientへのlocalhostOrigin追加、Drive API/Picker API有効化、API Key制限へのAPI追加を実施
- **確定事実**: `drive.file`スコープ + Picker(`setEnableDrives(true)`) + `supportsAllDrives=true`でShared Drive内フォルダ作成が成功（フルスコープ`drive`は不要）。Shared Driveルート自体はPicker選択不可（1階層以上のサブフォルダ必須）。`drive.file`スコープでは完全削除不可、ゴミ箱移動のみ許可。
- 実データが入った実際のShared Drive（自己評価PJ）でテストする際は都度decision-makerに確認を取り、テストフォルダは検証後ゴミ箱移動で後片付け

### plan mode計画確定
Explore3並列（Cloud Functions実装パターン、Frontend実装パターン、データモデル詳細）+ Plan agentでPhase1 MVPの実装計画を設計。Plan agentの報告は`gmailAuth.ts`/`useDocumentVerification.ts`/`searchIndexer.ts`を実読みして正確性を検証済み。ExitPlanModeで計画承認を取得、`/Users/yyyhhh/.claude/plans/modular-enchanting-zephyr.md`に保存。14タスクに分解、Acceptance Criteria4項目を確定。

### Task1実装（型定義・データモデル・ADR）
`feature/drive-export-phase1`ブランチを作成し実装着手：
- `shared/types.ts`: `DriveExportStatus`型、`DriveFolderSegment`/`DriveFolderTemplate`/`DriveSettings`型、Document拡張フィールド（`driveExportStatus`/`driveFileId`/`driveExportedAt`/`driveExportError`）を追加
- `docs/context/data-model.md`: コレクション一覧・Drive Export状態セクション・`/settings/drive`セクションを追記
- `docs/adr/0022-google-drive-export.md`: OAuth独立接続・`drive.file`スコープ確定・セグメント型テンプレート・find-or-create（2件以上エラー停止）・フリガナfail-visible・outbox+トリガー方式・Admin SDK専有の設計判断を記録
- frontend/functions両方の型チェック（`tsc --noEmit`）でエラーなしを確認
- コミット・push済み（PR未作成、実装継続中のため）

残り13タスク（Cloud Functions実装6件、Frontend実装4件、テスト2件、E2E確認1件）は次セッションで継続。詳細タスク一覧・依存関係はGOAL.md「進行中のtasks」参照。

### Issue Net
Net 0（GitHub Issue非経由、新機能の設計・実装セッション）

### 引き継ぎ教訓
- **gcloud環境変数の罠**: このセッション環境ではシェルの環境変数`CLOUDSDK_ACTIVE_CONFIG_NAME=kanameone`が固定で入っており、`switch-client.sh dev`実行後も`gcloud config configurations list`のactiveがkanameoneのままになる現象が発生。`~/.config/gcloud/active_config`ファイル自体は正しく書き換わっているが、環境変数がそれを上書きする。回避策: gcloudコマンド実行前に`export CLOUDSDK_ACTIVE_CONFIG_NAME=doc-split`を明示指定する。原因の恒久修正（環境変数の発生源特定）は今回未実施、次回同様の事象が出たら深掘りする
- **`drive.file`スコープの実務仕様**: Picker経由で明示的に選択したフォルダ以外には書き込めない（consent screenのみでは不可）。Shared Drive内での操作には`supportsAllDrives=true`が必須（既存メモリ`reference_drive_api_shared_drive_supports_all_drives.md`と一致）。完全削除は拒否されゴミ箱移動のみ許可、というAPI制約は事前のドキュメント調査では確定できず実機検証で判明した
- **Firebase Auto-created API KeyのAPI制限**: Firebase Authが自動生成する「Browser key」はデフォルトで「24個のAPI」に制限されており、新規APIを使う場合はGCP Consoleでの追加が必要（Drive API/Picker APIを追加）。このAPI Keyは「アプリケーション制限:なし」という既存の（今回のスパイクとは無関係な）セキュリティ課題も発見、Phase1のAC候補として計画に含めた

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

## 現在のフェーズ

**Google Drive連携機能 Phase 1 (MVP) 実装中**（GOAL.md準拠、2026-07-20更新）。承認済み計画: `/Users/yyyhhh/.claude/plans/modular-enchanting-zephyr.md`、ADR: `docs/adr/0022-google-drive-export.md`。14タスク中Task1（型定義・data-model・ADR）完了、`feature/drive-export-phase1`ブランチにpush済み（PR未作成、実装継続中）。

直前の「dev/kanameone/cocoro環境監査・保守検証」「frontend/.env dev環境誤接続防止」「Issue #687」の3ミッションは2026-07-19〜20に完遂済み（詳細は上記各完遂サマリ参照）。

follow-up候補（Drive連携完了後にtriage予定）: GOAL.md「参考: 前ミッション期のfollow-up候補」参照。

過去のミッションは全てクローズ済み: 「担当CM別集計バグ修正」+派生ミッション「Issue #660修正」は2026-07-15 session132で完全達成（全18項目`[x]`）。「OCR突合精度向上」は2026-07-14 session124で撤退基準適用によりクローズ（実装は保持、本番展開は見送り）。「#547/#548コスト圧縮」は2026-07-10 session113で技術的完遂・session117で本番是正完了。詳細はarchive参照。

## 直近の変更（session119〜137、簡潔に）

- **session137 (2026-07-20)**: 上記session137サマリ参照。**Net 0**。Google Drive連携機能の新規相談→実機技術検証→plan mode計画確定→Task1（型定義・data-model・ADR-0022）実装完了。
- **session136 (2026-07-19)**: 上記session136サマリ参照。**Net +1**（Close 1件: #686）。Issue #686(非fax由来ファイル名の`-L\d+-`偶然一致による検索インデックス脱落バグ)をTDDで修正、PR #689マージ・クローズ。
- **session135 (2026-07-16〜17)**: 上記session135サマリ参照。**Net 0**。複数顧客FAX複製機能PR-B(BE本体)完遂、PR #675マージ。4段レビュー(code-review high→Evaluator→codex review→CodeRabbit)で計8件の欠陥検出・修正。
- **session133〜134 (2026-07-15〜16)**: LATEST.md詳細サマリ未追記(GOAL.mdのみ更新、上記コメント参照)。**Net 0**。Issue #664恒久修正(ADR-0021)完遂、複数顧客FAX複製機能の設計確定(`/impl-plan`+Codex+Fable5)、PR-A(searchIndexer chunk化、PR#673)+カテゴリ表記化(PR#672)完遂。
- **session132 (2026-07-15)**: 上記session132サマリ参照。**Net 0**。GOAL.md「担当CM別集計バグ修正」+Issue #660ミッション完全達成。
- **session128〜130 (2026-07-14)**: 上記各サマリ参照。**Net 0**。GOAL.mdタスクA/B/C/F実装(PR#656)、kanameoneコスト調査(トリガーストーム特定、PR#651/#652)。
- **session119〜127**: `docs/handoff/archive/2026-07-history.md`参照（session135で60KB超過によりアーカイブ移動）。

session29〜118の詳細は `docs/handoff/archive/2026-0{4,5,6,7}-history.md` 参照。

## 次のアクション（3 分割・SKILL.md §2.5 参照、session137時点）

**即着手タスク2件（Google Drive連携 Task2〜9 / Task10〜13）。条件待ちなし。却下候補2件。**

### 即着手タスク

| # | タスク | ROI | 想定工数 | 完了条件 | 関連ファイル / コマンド |
|---|--------|-----|----------|-----|----------------------|
| 1 | [GOAL.md] Google Drive連携 Task2〜9（Cloud Functions実装、依存順） | Task1（型定義）完了済みで依存解消、計画承認済み・スコープ確定済み | 数時間〜（6タスク） | 各タスクの完了条件はGOAL.md「進行中のtasks」参照。最終的に`functions`のtsc build成功+unit test PASS | `functions/src/drive/`配下新設、`docs/adr/0022-google-drive-export.md`参照 |
| 2 | [GOAL.md] Google Drive連携 Task10〜13（Frontend実装） | 型定義完了済みでTask2〜9と並行着手可能 | 数時間〜（4タスク） | `frontend`のtsc build成功+vitest PASS | `frontend/src/pages/SettingsPage.tsx`、`frontend/src/hooks/useDriveSettings.ts`（新規） |

Task14（E2E疎通確認）はTask2〜13完了後の最終ステップ（`/Users/yyyhhh/.claude/plans/modular-enchanting-zephyr.md`のAcceptance Criteria4項目参照）。

### 条件待ち（明示 trigger 付き）
なし

### 却下候補（記録のみ）

| # | 項目 | 分類 | 着手しない理由 |
|---|------|------|--------------|
| 1 | Issue #687: `scripts/force-reindex.js`のBulkWriter化 | ~~新規価値創出~~ | **2026-07-19 PR #691でクローズ済み、この却下候補行は削除漏れ。次回handoffで除去** |
| 2 | GOAL.md「参考: 前ミッション期のfollow-up候補」6件（GHA workflow concurrency UI化 / concurrency共通化 / ホットトークンmutex / documents_search_update単体テスト / batch-size×concurrency独立性テスト / Firestoreバックアップ稼働確認の仕組み） | 新規価値創出（triage未実施） | Drive連携ミッション優先中。次ミッション起点の選定はdecision-maker領分 |

過去ミッション由来の継続保留事項（PR#474 close / `.artifacts/`扱い / #503・#251・#238 / frontend/.envフォールバック恒久対策 等）はarchive参照。

### 残留プロセス（マシン全体スコープ、現在のプロジェクトに限らない）

`sanwa-houkai-app`（別プロジェクト、`/Users/yyyhhh/Projects/sanwa/sanwa-houkai-app/web`）のNext.js dev server（PID 64872、port 3003）を1件検出。起動時刻は2026-07-20 14:22:19と本セッション中の時刻に近く、**別プロジェクトで並行実行中のセッションの可能性がある**。本セッション（doc-split、Drive連携実装）が新規起動したプロセスではない。⚠️ このチェックは現在のプロジェクトに限らないマシン全体のチェック。停止提案は行わない（条件待ち: 停止指示があれば`~/.claude/scripts/cleanup-node.sh --kill`）。
