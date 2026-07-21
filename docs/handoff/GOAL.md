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
- [x] FE Drive接続 + Picker UI実装（frontend/src/pages/SettingsPage.tsx。plan mode経由で設計、Picker API公式仕様をPlan agentがcontext7/Web確認済み。重大な設計ギャップを発見・解決: (1)spike-test.htmlはgit未コミットで復元不可のため公式仕様から再構築 (2)Gmail用OAuth Client IDの共用はexchangeDriveAuthCodeのSecret Manager `drive-oauth-client-id` code交換制約でinvalid_grantになり不成立と判明、`DriveSettings.oauthClientId`をFirestore新設フィールドとして解決（shared/types.ts）。実装: `GoogleDriveConnect`(code flow接続)/`DriveFolderPicker`(token flow+Picker、`frontend/src/lib/googlePicker.ts`の純粋関数`pickerResponseToRootFolder`+`useGooglePickerScript.ts`)。単体テスト9件追加、tsc(frontend/functions両方)・lint・frontend全378件PASS・build成功確認済み(commit d3bbf1b)。evaluatorエージェントによるAC検証でHIGH指摘1件（Picker側キャンセル時に`onPicked`のみが`picking`状態を解除しておりUIが操作不能に固着）+MEDIUM指摘1件（GIS `error_callback`未設定でポップアップブロック/手動クローズ時に同様の固着）を検出、自分で実装を直接確認したうえで修正: `openFolderPicker`に`onCancel`コールバックを追加し`isPickerCancelled`純粋関数で`loaded`中間イベントと`cancel`確定を区別、`initCodeClient`/`initTokenClient`双方に`error_callback`を追加。単体テスト5件追加(計14件)、tsc・lint・frontend全383件PASS・build成功再確認済み。**dev環境インフラ整備(settings/driveへのoauthClientId投入・Picker/Drive API有効化・OAuth Client JS origin追加等)とブラウザ実機確認は次段階（未実施）**）
- [x] `/code-review high`（decision-maker実行、feature/drive-export-phase1ブランチ全体34ファイル・約3744行）。8角度finder並列実行→18件のユニーク候補を1票制verifyでCONFIRMED 13件/PLAUSIBLE 1件/REFUTED 2件/cleanup系2件に判定。decision-maker選択で`resolveDriveFile()`集中の最重要3件のみ修正: ①`files.get()`成功時に`trashed`(ゴミ箱移動)を一切チェックしておらずゴミ箱内ファイルへ不可視のまま上書きし続けるsilent failure ②404判定が`error.code===404`のみに依存し、実際のgaxios GaxiosErrorはHTTPステータスを`error.status`に設定するため本番で恒久的にfalseになり404フォールバックが死んだコードパスだった(node_modules/gaxios確認で実証) ③driveFileId確定後は`findOrUploadFile()`のappProperties重複検知(AmbiguousFileError)を永久にバイパスしており、ADR本文の「以後AmbiguousFileErrorで恒久停止」という記述と矛盾していた。`isDriveFileNotFoundError()`(status/code両対応)と`assertNoDuplicateFile()`(driveFileId優先パスでも毎回重複再確認)を追加、trashedはfindOrUploadFileへのフォールバック条件に追加。回帰テスト3件追加（trashed/gaxios実形状404/重複検知）。exportDocument統合テスト18件、Drive関連統合テスト計45件、functions unit1903件、rules88件、tsc/lint全PASS確認済み。残りCONFIRMED 7件(feature flag OFF永久回収不能・40件上限sweep飽和・useDocumentVerification stale化・fileDate nullクラッシュ・careManager空白フォルダ名・firestore.rules防御層欠如・exchangeDriveAuthCodeテスト欠如)とPLAUSIBLE 1件は次回セッションでtriage
- [ ] FEフォルダテンプレートエディタ実装
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

## 🔄 中断点（in-flight）
なし（FE Drive接続+Picker UI（タスク11）はcommit d3bbf1b+5b0f64aで反映済み、resolveDriveFile()の最重要3件修正はcommit f78304cで反映済み。今回セッションで`/code-review high`の残りCONFIRMED 7件+PLAUSIBLE 1件を上記のGOAL.mdタスクとして記録済み（未マージbranchのtodoとして管理、GitHub Issue化せず）。dev環境インフラ整備・実機確認は次段階）

## 参考: 前ミッション期のfollow-up候補（triage未実施、Drive連携完了後に再検討）
- GitHub Actions workflow（run-ops-script.yml）に`--concurrency`オプションのUI経由指定を追加
- `runWithConcurrency`が`compare-gemini-ocr-models-confirmed.ts`/`compare-ocr-arbitration-logic-confirmed.ts`/`backfill-detail-subcollection.ts`と重複、`scripts/lib/concurrency.js`への共通化検討
- ホットトークン（同一tokenId）への書込み競合をtokenId単位のmutex/キューで構造的に防ぐ設計
- `documents_search_update` stageのcatch/stage-taggingロジックの単体テスト追加
- `--batch-size`と`--concurrency`が独立した軸として機能することの明示的なテスト追加
- Firestoreバックアップ（2026-04-10初回設定済み）の継続稼働状況を、GitHub Actions経由のSA権限で確認する仕組みが未整備（ローカルCLI認証・ADC双方で403、次回SA権限確認 or 確認スクリプト整備が必要）
