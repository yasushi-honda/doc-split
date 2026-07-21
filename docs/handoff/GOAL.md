---
updated: 2026-07-21
---
<!-- 前ミッション(dev/kanameone/cocoro環境監査・保守検証)は2026-07-20完遂。全文はdocs/handoff/LATEST.md参照。 -->

## 現在のミッション

Google Drive連携機能 Phase 1 (MVP) の実装。承認済み計画: `/Users/yyyhhh/.claude/plans/modular-enchanting-zephyr.md`、ADR: `docs/adr/0022-google-drive-export.md`。

## 背景・why

cocoro/kanameから、書類（ケアプラン・医療・介護保険証等）のPDFを利用者ごとにGoogleドライブへ自動振り分けエクスポートしたいという要望（用途: NotebookLM投入、インターネットFAX送信）。両クライアントのフォルダ構成は非対称のため、個別対応ではなくデータ駆動のセグメント型テンプレートで共通化する方針。実機技術検証済み: `doc-split-dev`環境で`drive.file`スコープ+Picker(`setEnableDrives(true)`)+`supportsAllDrives=true`によるShared Drive内フォルダ作成の成功を確認済み。

## 完了の定義

- E2Eハッピーパス: かなめテンプレート設定で確認ボタン押下（verified false→true）から、Drive上の正しい階層にPDFが1回作成され、documentに`driveFileId`と`driveExportStatus:'exported'`が記録される（証明: dev環境での手動E2E実施記録）
- フォルダ合流: 同一ケアマネ・同一利用者の2件目documentエクスポートで、フォルダが新規作成されず既存フォルダが再利用される（証明: 同上）
- fail-visible: フリガナ欠損時・フォルダ名2件以上重複時にDrive書込みが発生せず、`driveExportStatus:'error'`でエラー一覧に表示される（証明: 同上）
- Feature Flag OFF不変: `settings/features.driveExport`未設定/falseのテナントで確認ボタンを押してもDrive API呼び出し・Drive系フィールド書込みが一切発生しない（証明: Cloud Functionsログでの早期return確認）

## 進行中のtasks
- [x] 型定義 + data-model追記 + ADR-0022起票（commit a1a3485）
- [x] 認証ヘルパー + Feature Flag追加（functions/src/utils/driveAuth.ts, featureFlags.ts、commit 28cbc9c）
- [x] Drive接続Callable実装（functions/src/drive/exchangeDriveAuthCode.ts、commit 4db395b）
- [x] フォルダパス解決ロジック実装（functions/src/drive/folderPath.ts + test、commit f10ce7d）
- [x] find-or-createフォルダロジック実装（functions/src/drive/findOrCreateFolder.ts + test、commit 25fb4a1。副産物: SUPPORTS_ALL_DRIVES定数をdriveAuth.tsからdriveApiConstants.tsへ分離、Firestore非依存化）
- [x] エクスポート・オーケストレータ実装（functions/src/drive/exportDocument.ts + test、commit 2793f71）
- [x] Firestoreトリガー実装（functions/src/drive/driveExportTrigger.ts + test。二重エンキュー防止をFirestoreトランザクションでアトミック化（/code-review low指摘対応）、commit e86f80e）
- [x] リトライCallable + 定期リトライ実装（functions/src/drive/retryDriveExport.ts, driveExportScheduled.ts。共有executeDriveExport.tsへ状態遷移ロジックを抽出、トリガーもリファクタして共有、commit 775b619）
- [x] `/code-review medium`（feature/drive-export-phase1ブランチ全体）でCONFIRMED 8件検出、重大度上位4件を修正（commit 86a9030）。①reprocess時のDrive系フィールド残存(useDocuments.ts + firestore.rulesのhasOnly追加) ②pending状態廃止によるクラッシュ時の永久滞留解消(絶対→exportingを単一トランザクション化) ③driveExportRunId所有権トークン導入(ocrRunGuard.tsと同型、並行実行時の状態上書き防止) ④appProperties(docSplitDocId)ベースのDriveファイル冪等性チェック(重複アップロード防止)。ADR-0022に状態遷移図(mermaid)追加。残り4件(gs://バケット不一致・null fileDate・空careManagerでの空フォルダ・updatedAt共有によるスタック誤判定)は優先度中〜低のため未対応、次回セッションで判断
- [x] `/code-review`（bare、xhigh/recall効果、feature/drive-export-phase1ブランチ全体）で10角度並列レビューにより15件検出(10エージェントが大幅遅延の末全員応答、重複排除して差替報告)。新規発見最重要2件から着手: ①firestoreToDocument()へのDrive系5フィールドマッピング追加(#178教訓、frontend/src/hooks/useDocuments.ts) ②reprocess時のDrive孤児ファイル問題修正 — `driveFileId`を`getReprocessClearFields()`のクリア対象から除外し、`exportDocument.ts`に`resolveDriveFile()`を追加(driveFileIdがあればfiles.get→files.updateで移動/リネーム/内容更新、404ならappPropertiesフォールバック)。これにより誤配置(旧フォルダへの孤児ファイル残置)とstale content(内容不更新)の両方を解消。type-check/lint/unit1903/integration193/rules84/frontend364全PASS確認済み。残り13件(初回エクスポート時のTOCTOU競合等)は次回セッションで着手要否を判断
- [x] Firestoreルールテスト追加（functions/test/firestore.rules.test.ts、settings/driveのadmin専用write権限テスト4件を追加。読取: ホワイトリスト登録ユーザー可/未登録ユーザー不可、書込: 一般ユーザー不可/管理者可。エミュレータで88件全PASS確認済み）
- [x] FE設定フック実装（frontend/src/hooks/useDriveSettings.ts。useSettings.tsのTanStack Queryパターンを踏襲し`useDriveSettings()`/`useUpdateDriveSettings()`+正規化関数`normalizeDriveSettings()`を実装。単体テスト5件追加、tsc/lint/frontend全369件PASS確認済み。Picker UI・OAuth接続フロー配線は次タスクで対応）
- [x] FE Drive接続 + Picker UI実装（frontend/src/pages/SettingsPage.tsx。plan mode経由で設計、Picker API公式仕様をPlan agentがcontext7/Web確認済み。重大な設計ギャップを発見・解決: (1)spike-test.htmlはgit未コミットで復元不可のため公式仕様から再構築 (2)Gmail用OAuth Client IDの共用はexchangeDriveAuthCodeのSecret Manager `drive-oauth-client-id` code交換制約でinvalid_grantになり不成立と判明、`DriveSettings.oauthClientId`をFirestore新設フィールドとして解決（shared/types.ts）。実装: `GoogleDriveConnect`(code flow接続)/`DriveFolderPicker`(token flow+Picker、`frontend/src/lib/googlePicker.ts`の純粋関数`pickerResponseToRootFolder`+`useGooglePickerScript.ts`)。単体テスト9件追加、tsc(frontend/functions両方)・lint・frontend全378件PASS・build成功確認済み(commit d3bbf1b)。evaluatorエージェントによるAC検証でHIGH指摘1件（Picker側キャンセル時に`onPicked`のみが`picking`状態を解除しておりUIが操作不能に固着）+MEDIUM指摘1件（GIS `error_callback`未設定でポップアップブロック/手動クローズ時に同様の固着）を検出、自分で実装を直接確認したうえで修正: `openFolderPicker`に`onCancel`コールバックを追加し`isPickerCancelled`純粋関数で`loaded`中間イベントと`cancel`確定を区別、`initCodeClient`/`initTokenClient`双方に`error_callback`を追加。単体テスト5件追加(計14件)、tsc・lint・frontend全383件PASS・build成功再確認済み）
- [x] `/code-review high`（decision-maker実行、feature/drive-export-phase1ブランチ全体34ファイル・約3744行）。8角度finder並列実行→18件のユニーク候補を1票制verifyでCONFIRMED 13件/PLAUSIBLE 1件/REFUTED 2件/cleanup系2件に判定。decision-maker選択で`resolveDriveFile()`集中の最重要3件のみ修正: ①`files.get()`成功時に`trashed`(ゴミ箱移動)を一切チェックしておらずゴミ箱内ファイルへ不可視のまま上書きし続けるsilent failure ②404判定が`error.code===404`のみに依存し、実際のgaxios GaxiosErrorはHTTPステータスを`error.status`に設定するため本番で恒久的にfalseになり404フォールバックが死んだコードパスだった(node_modules/gaxios確認で実証) ③driveFileId確定後は`findOrUploadFile()`のappProperties重複検知(AmbiguousFileError)を永久にバイパスしており、ADR本文の「以後AmbiguousFileErrorで恒久停止」という記述と矛盾していた。`isDriveFileNotFoundError()`(status/code両対応)と`assertNoDuplicateFile()`(driveFileId優先パスでも毎回重複再確認)を追加、trashedはfindOrUploadFileへのフォールバック条件に追加。回帰テスト3件追加（trashed/gaxios実形状404/重複検知）。exportDocument統合テスト18件、Drive関連統合テスト計45件、functions unit1903件、rules88件、tsc/lint全PASS確認済み。残りCONFIRMED 7件(feature flag OFF永久回収不能・40件上限sweep飽和・useDocumentVerification stale化・fileDate nullクラッシュ・careManager空白フォルダ名・firestore.rules防御層欠如・exchangeDriveAuthCodeテスト欠如)とPLAUSIBLE 1件は次回セッションでtriage
- [x] dev環境インフラ整備 + ブラウザ実機確認（2026-07-21）。IAP OAuth Admin API廃止（2026-03-19恒久停止、実測確認）・`gcloud iam oauth-clients`はWorkforce Identity Federation専用（一次情報確認）によりCLI/API経由のOAuth Client作成手段が存在しないと判明、Playwright MCPでGCPコンソールを操作し`DocSplit Drive`(Web application、JS生成元`http://localhost:3000`+`https://doc-split-dev.web.app`)を手動作成。Picker API(`picker.googleapis.com`)有効化、Secret Manager 3件(`drive-oauth-client-id`/`-secret`/`-refresh-token`)作成、Firestore `settings/drive.oauthClientId`投入。**重要な発見**: setup-tenant.shの`--gmail-iap`と同型でCloud Functions実行SAに`firebase-adminsdk-fbsvc@`をIAM付与していたが、実際のGen2ランタイムSAは`{project-number}-compute@developer.gserviceaccount.com`（デフォルトCompute SA）であり誤り（`exchangeDriveAuthCode`が`secretmanager.versions.access`のPERMISSION_DENIEDで500エラーとなり発覚。既存のgmail-oauth-*系secretは過去セッションで別途compute SAへ手動付与されていた形跡があり、setup-tenant.shのfirebase-adminsdk-fbsvc向けバインドは実質死コードだった可能性— 未着手フォローアップ候補）。正しいSAへ付与しなおして解決。`./scripts/deploy-to-project.sh dev --full`でDrive関連Functions初回デプロイ（exchangeDriveAuthCode/onDocumentWriteDriveExport/retryDriveExport/driveExportScheduled）+ Firestoreルール反映。ブラウザ実機で全経路を確認済み: Drive接続(OAuth code flow、`hy.unimail.11@gmail.com`と連携済み表示)→Picker表示(Shared Drives、`setEnableDrives(true)`が実機で機能)→フォルダ選択→保存(`settings/drive.rootFolderName:'事務'`としてFirestore反映、UI「選択中: 事務」表示で確認)。完了の定義の「E2Eハッピーパス」検証はまだ（実際の書類確認→Drive書込みまでは未実施、次項のE2E疎通確認タスクで対応）
- [x] FEフォルダテンプレートエディタ実装（2026-07-21、plan mode経由で設計・承認後実装。Plan agentレビューで2つの正確性リスクを検出・対応: ①`date`セグメントの`onlyForCategories`は`DocumentMaster.category`ではなく`.name`（書類種別名）と実際に突合される点（exportDocument.ts:298→extractors.tsの追跡で確認）、フィールド名の誤誘導に対しコメント+コンポーネントテストで固定 ②保存済みテンプレートの`onlyForCategories`にマスタから改名/削除された書類種別名が残ると現行マスタ駆動UIでは静かに消えるfail-silent問題、「保存値∪現行マスタ」描画+「マスタに存在しません」マーカーで対応。副次的にcareManager/customerセグメントの`separator`未設定時デフォルト(非対称: half/full)を`shared/types.ts`の`DRIVE_SEGMENT_SEPARATOR_DEFAULT`定数に一本化し`functions/src/drive/folderPath.ts`と共有(挙動不変、単一の真実源化)。実装: `frontend/src/lib/driveFolderTemplate.ts`(純粋関数: addSegment/removeSegment/moveSegment/updateSegment/describeSegment/validateTemplate + かなめ/cocoroプリセット)、`frontend/src/components/DriveFolderTemplateEditor.tsx`(制御コンポーネント、Radix Select操作のjsdomテスト摩擦を避けネイティブ`<select>`採用)、`SettingsPage.tsx`の`DriveFolderTemplateSection`(既存GmailSettingsと同型の保存UX)。単体テスト53件追加(driveFolderTemplate.test.ts 34件+DriveFolderTemplateEditor.test.tsx 19件)、frontend全436件・functions全1903件PASS、tsc/lint全PASS確認済み。ブラウザ実機（dev環境、既存のDrive接続+rootFolder設定を利用）で「かなめ式で初期化」→5階層描画→保存→リロード後も値保持、を確認・スクリーンショット記録済み）
- [ ] FEエラー一覧 + リトライUI実装
- [ ] E2E疎通確認（dev環境で完了の定義4項目を通す）

### `/code-review high`残りCONFIRMED 7件+PLAUSIBLE 1件（2026-07-21 triage: 未マージbranchのtodoとしてGOAL.md管理、GitHub Issue化せず）
- [ ] useDocumentVerification経由でdriveExportStatusがstaleのまま残る（frontend/src/hooks/useDocumentVerification.ts。`markAsVerified`/`markAsUnverified`が`getReprocessClearFields()`を経由せず、確認解除→訂正→再確認フローで古い`driveExportStatus:'exported'`が残りexecuteDriveExportのクレームがsilentに失敗、再エクスポートされない）
- [ ] feature flag OFF時にverifiedされたdocumentが永久回収不能（functions/src/drive/driveExportTrigger.ts + driveExportScheduled.ts。flag OFF中は`driveExportStatus`フィールド自体が書き込まれず、後でflagをONにしてもsweep/retryどちらの経路にも一生乗らない。エラー表示も一切ない）
- [ ] driveExportScheduled.tsの40件上限でバックログ飽和時に一部documentが取り残される（driveExportScheduled.ts:52。orderBy無し・ページネーション無しのクエリ、error/exporting状態が40件超で発生した場合の構造的欠陥）
- [ ] doc.fileDateがnullの場合exportDocument()がTypeErrorでクラッシュする（functions/src/drive/exportDocument.ts:241。`.toDate()`前のnullガード追加、UIから書類日付をクリア保存する経路が実在）
- [ ] careManagerName空文字で空白のみのフォルダ名が生成される（functions/src/drive/folderPath.ts:58。ケアマネ未設定documentは実運用で発生、フリガナ欠損と同様のfail-visibleガード検討）
- [ ] firestore.rulesのdriveFileId削除ガードが不十分（アプリコード1箇所(`getReprocessClearFields()`除外)のみに依存、ルール層でも削除拒否する防御層追加を検討）
- [ ] exchangeDriveAuthCode.tsのPartial Updateテストが欠如（CLAUDE.md MUST「更新対象外フィールド不変テスト」違反、functions/test/への追加が必要）
- [ ] [PLAUSIBLE、decision-maker判断待ち] verified維持のままの編集(customerName/documentType等)で再エクスポートがトリガーされない（functions/src/drive/driveExportTrigger.ts:43。ADRに部分言及はあるが名指しでの受容記載なし。Phase1スコープ外の既知制約として明記するか、対応するか要判断）

### `/code-review`（xhigh、2026-07-21、フォルダテンプレートエディタ実装直後に実行）新規CONFIRMED 9件
10角度finder(5正確性+3クリーンアップ+altitude+conventions)並列→1票制verify→sweepの完全プロセス実施。上記の既存3件(fileDate null/careManagerName空白/exchangeDriveAuthCodeテスト欠如)は独立して再CONFIRMEDされたが重複のため既存項目に統合。以下は今回新規に発見されたもの。**自分が今セッションで書いたコードの不備2件は承認済み計画スコープ内の是正として即修正済み**（separator不参照・SEGMENT_TYPES二重管理、修正後53件テスト+tsc再PASS確認済み）。残り7件は既存ブランチコードの指摘のため未着手、triage待ち。
- [ ] resolveDriveFile()のtrashed/404フォールバックでappProperties一致の孤児ファイルが1件見つかった場合、内容(media)を更新せずidだけ再利用する（functions/src/drive/exportDocument.ts:122。既存回帰テストは0件マッチ(新規作成)ケースのみカバーしており未検証。ADRが謳う「driveFileId優先パスでの内容最新化保証」がこの経路だけ成立しない）
- [ ] exchangeDriveAuthCode.tsのsettings/drive書込みが非atomic（authMode設定→about.get()疎通確認→connectedEmail設定の3段階、functions/src/drive/exchangeDriveAuthCode.ts:76。疎通確認またはconnectedEmail書込みが失敗すると補償処理なしにauthMode:'oauth'だけが残り、FEが「連携済み」と誤表示する）
- [ ] GoogleDriveConnect.handleConnectがsetConnecting(true)をポップアップ表示前に呼んでおらず連打で複数ポップアップ/複数exchangeDriveAuthCode呼び出しが発生しうる（frontend/src/pages/SettingsPage.tsx:749。兄弟コンポーネントDriveFolderPicker.handlePickFolderは対称的に実装済み）
- [ ] Pickerのcallbackがaction==='picked'だがdocs空/id欠損という不正応答時、onPicked/onCancelどちらも呼ばれずpicking状態が永久固着する（frontend/src/lib/googlePicker.ts:94。以前修正済みのキャンセル時固着バグと同症状が別経路で再発）
- [ ] resolveFolderSegments()のswitch文にdefault/exhaustiveness checkが無く、将来segment種別追加時にcase漏れがあってもコンパイルエラーにならず階層が黙って欠落する（functions/src/drive/folderPath.ts:109。tsc --strictでの実証実験済み、ADR自身が将来の種別拡張を予告済み）
- [ ] useGooglePickerScript.tsの新規script作成分岐にcleanup関数が無い（frontend/src/hooks/useGooglePickerScript.ts:32。既存script分岐とだけ非対称。React18ではアンマウント後setStateは無害化されるため実害は軽微と検証済み、優先度低）
- [ ] クリーンアップ・効率化系4件（優先度低、機能影響なし）: ①GoogleDriveConnect/DriveFolderPickerの接続状態判定ロジック重複(SettingsPage.tsx:715) ②firestore.rulesのDrive系5フィールド分ガードが同一パターンの5回コピペ(firestore.rules:178) ③DriveFolderTemplateSection/GmailSettings/NotificationSettingsの保存UXステートマシン(hasChanges+3秒自動消去)が3箇所で完全同一ロジック(SettingsPage.tsx:1005) ④createDriveOAuthClient()がキャッシュ無しで毎回Secret Managerへ3回アクセス(functions/src/utils/driveAuth.ts:40、driveExportScheduled.tsのバックログ処理時に往復増大)

## 🔄 中断点（in-flight）
なし。FEフォルダテンプレートエディタ実装はcommit 8acd2fd（実装）+896079c（GOAL.md更新）で反映済み（実機確認・tsc/lint/テスト全PASS確認後にコミット。origin未push、20+2=22コミット先行）。

`/code-review xhigh`（2026-07-21、フォルダテンプレートエディタ実装直後）を実行し新規CONFIRMED 9件を検出、うち自分のコードの不備2件（separator不参照・SEGMENT_TYPES二重管理）はcommit 8acd2fdに含める形で即修正済み。残り7件は上記GOAL.mdタスクに記録済み、未着手・triage待ち。

dev環境のFirestore `settings/drive`は実際に`hy.unimail.11@gmail.com`と連携済み・`rootFolderName:'事務'`・`template`にかなめ式5階層が設定された状態のまま残っている（後続のE2E疎通確認タスクでそのまま利用可）。次は①残りメインライン2タスク（FEエラー一覧+リトライUI/E2E疎通確認） ②今回+前回の`/code-review`指摘（新規7件+既存7件+PLAUSIBLE1件）のtriage、のいずれか。

## 参考: 前ミッション期のfollow-up候補（triage未実施、Drive連携完了後に再検討）
- GitHub Actions workflow（run-ops-script.yml）に`--concurrency`オプションのUI経由指定を追加
- `runWithConcurrency`が`compare-gemini-ocr-models-confirmed.ts`/`compare-ocr-arbitration-logic-confirmed.ts`/`backfill-detail-subcollection.ts`と重複、`scripts/lib/concurrency.js`への共通化検討
- ホットトークン（同一tokenId）への書込み競合をtokenId単位のmutex/キューで構造的に防ぐ設計
- `documents_search_update` stageのcatch/stage-taggingロジックの単体テスト追加
- `--batch-size`と`--concurrency`が独立した軸として機能することの明示的なテスト追加
- Firestoreバックアップ（2026-04-10初回設定済み）の継続稼働状況を、GitHub Actions経由のSA権限で確認する仕組みが未整備（ローカルCLI認証・ADC双方で403、次回SA権限確認 or 確認スクリプト整備が必要）
