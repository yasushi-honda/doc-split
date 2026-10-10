# 2026-10 GOAL.md 退避アーカイブ

GOAL.md 371KB 肥大に伴い、完了・訂正済みの節28件(2026-07-22〜09-27分)を原文のまま移動(2026-10-10)。

## 【完了・2026-09-27】Issue #962対応: withBackoffRetryのリトライ観測性改善+updateErrのSentry送信(PR #1067マージ、現在のミッションとは別件・並行トラック)

`/catchup`提示のIssue backlog(#979/#962/#956/#901/#251/#238)からdecision-maker選択(#962)により着手。他候補は設計不備で撤回済み(#979、2026-10-02にnot plannedでクローズ: 提案2は`processocr_request_timeout`で充足・提案1は実害なしで見送り)・待機条件未充足(#251/#238)・緊急性なし明記(#901)・#956は保留(当時「#979と設計方針重複の可能性」と記載したが不正確: #979=processOCR latency検知、#956=`driveFolderClaim.ts`のcatch3箇所の記録失敗監視で対象が別。2026-10-02実測で3箇所のログは直近30日kanameone/cocoroとも0件・実害なし、着手はdecision-maker指示待ち)。

**実装**: ①`functions/src/utils/retry.ts`の`withBackoffRetry`のcatch節が完全に無言でリトライしており、gRPC transientエラー(ABORTED/UNAVAILABLE等)がリトライで復旧した場合ログに一切痕跡が残らなかった問題に対し、attempt番号+元エラーメッセージ付きの`console.log`を追加。②`functions/src/ocr/ocrProcessor.ts`の`handleProcessingError`の`catch(updateErr)`(状態更新自体のリトライ枯渇、元のerrorより深刻な事象)が`console.error`のみでSentry等のアラート経路(`safeLogError`)に乗っていなかった問題に対し、`functionName`に`.handleProcessingError.updateErr`タグを付与した専用`safeLogError`呼出を追加(末尾の元error用呼出と区別可能)。

**テスト(TDD Red→Green)**: `backoffRetry.test.ts`にログ出力検証2件追加。`handleProcessingErrorContract.test.ts`の既存静的契約テストは非globalな正規表現の最初のmatchが新設callにずれる問題があったため、`catch(updateErr)`ブロックをbrace-nestingで先に切り出しその後方から元の末尾呼出を抽出する方式に修正し、updateErr専用の契約テスト7件を追加。

**品質ゲート**: 変更規模(実コード2ファイル・23行)はCLAUDE.mdのcodex reviewゲート閾値(3ファイル以上/100行以上)未満だが、`post-pr-review.sh`hookがmedium tier PRとして明示指示したため`codex review --base main -c model_reasoning_effort=medium`を実行、findings 0件。型チェック・lint(変更ファイルwarning/error 0件)・ユニットテスト2424件・Firestoreエミュレータ経由の関連統合テスト89件(`ocrRetryIntegration`/`ocrRunGuardIntegration`(Issue #957系handleProcessingErrorリトライシナリオ含む)/`ocrCompletionTransactionIntegration`/`rescueErroredIntegration`)全PASS。実行ログで新規ログ`[withBackoffRetry] attempt N/M failed, retrying...`の出力を実機確認済み。

CI(lint-build-test)完了後にsquashマージ、Issue #962は自動クローズ。Issue Net変化: Close 1件(#962)、起票 0件、Net +1。

## 【完了・2026-09-27】Issue #1044対応: handleBulkVerifyテストカバレッジ追加(PR #1065マージ、現在のミッションとは別件・並行トラック)

`/catchup`提示の積み残しIssueからdecision-maker選択(#1044、handleBulkVerifyテストカバレッジ追加)により着手。

**実装**: `handleBulkVerify`(DocumentsPage.tsx)の①文書ごとの判定・集計ロジック(succeeded/failed分割・確定件数・identityLookup失敗時のfail-closed警告判定・選択保持方針)を`frontend/src/lib/bulkVerifyOutcome.ts`の純粋関数`summarizeBulkVerifyOutcomes`(+`runWithConcurrency`移設)へ、②1文書分のFirestoreトランザクション実行を`frontend/src/lib/bulkVerifyTransaction.ts`の`executeBulkVerifyDocumentTransaction()`へそれぞれ抽出し、テスト18件を新規追加。あわせてPR #1041のpr-test-analyzer指摘済みだった軽微な穴2件(`confirmOnVerify.test.ts`のcustomerIdなし×同姓同名衝突ケース、選択待ちバッジのtitle属性テスト)も解消。`DocumentsPage.tsx`側は動作を一切変えず抽出関数への置換のみ。

**品質ゲート**: `codex review`を2回(medium base、strict-config+high effort最終確認)実施しfindings 0件。`pr-review-toolkit`4エージェント並列(code-reviewer/pr-test-analyzer/type-design-analyzer)+`evaluator`(Generator-Evaluator分離)による多角的レビューで、①type-analyzerからMEDIUM1件・LOW1件(型設計の改善余地、非ブロッキング)、②test-analyzer・evaluatorから「`handleBulkVerify`自体のFirestoreトランザクション結合部分(fail-closedの発生源そのもの)が未テスト」という重要指摘(evaluatorはAC「FAIL」判定)を受け、`bulkVerifyTransaction.ts`抽出+`useDocumentVerification.test.ts`と同型のFirestoreモックテスト6件を追加で対応、再評価で解消確認(evaluator最終判定: AC全PASS、総合APPROVE)。

**UI変更PR判定の誤検知対応**: `.tsx`テストファイル変更を含むため`ui-change-merge-check.sh`フックがUI変更PRと判定しブロック。実差分を精査しJSX/表示関連の変更が0件(全てhandleBulkVerify内部ロジックのimport/変数展開のみ)と確認のうえ、decision-makerの明示認可を得てブラウザ確認をスキップし`ui-verified`ラベル付与でマージ。

CI(lint-build-test)全PASS後にsquashマージ、Issue #1044は自動クローズ。Issue Net変化: Close 1件(#1044)、起票 0件、Net +1。

## 【完了・2026-09-26】Issue #1043対応(PR #1058)+cocoro「確認済み」backfill本実行完了（現在のミッションとは別件・並行トラック）

前セッションの`/catchup`で「backfillスクリプト本番実行前に#1043解消を推奨」と記録されていた件に着手。

**Issue #1043対応(PR #1058マージ)**: `ConfirmOnVerifyManifestEntry`をdiscriminated union化し、`confirmedCustomer:false`かつ`customerConfirmedBefore`に値がある等の不正な状態を型として表現不能にした。`--rollback`実行時のmanifest JSON読込みに`isValidManifest`によるランタイム検証を追加(fail-closed)。品質ゲートは`codex review`がサーバー側401エラーで5回試行全て失敗(フィードバック提出済み、CLI再ログインでも解消せず)したため、代替としてpr-review-toolkit 4エージェント(code-reviewer/silent-failure-hunter/type-design-analyzer/pr-test-analyzer)+fable-review(Fable 5.1、独自に605件のテストを再実行して検証)による多角的レビューを実施。指摘反映の過程で以下を追加発見・修正:
- 型契約違反データ(customerConfirmed/officeConfirmedがboolean以外)がmanifest全体のrollbackを巻き込む書込み側/読込み側の非対称バグ
- 顧客/事業所の両方が型異常の場合に片方だけ記録される取りこぼし
- fail-closedゲートの実効性を証明できていなかった統合テスト設計(fable-review指摘、ゲートを一時的に無効化してテストが正しく失敗することまで検証)
- discriminated unionの偽分岐が余分なプロパティ混入を検出していなかった問題

Firestore emulator統合テスト7件(fail-closedゲート実効性・Partial Update不変性・rollback往復含む)新規追加、全PASS。残る軽微な指摘8件はIssue #1059へフォローアップ。

**GitHub Actions配線追加**: `run-ops-script.yml`に`backfill-confirm-on-verify`の実行サポートを新規追加(既存`backfill-drive-export`と同一パターン、`--rollback`は前例踏襲で対象外)。

~~**本番実行(dev→kanameone/cocoro実データ`--dry-run`→canary→全件)**~~ **【kanameone/cocoro両方完了・2026-09-26】** dev/kanameone/cocoro実データとも型異常0件を確認(CLAUDE.md「既存データへの新規ゲート追加時の注意」充足)。**cocoro(19件)はcanary3件→残16件で完了(確定成功19件・エラー0件)**。**kanameoneはcanary10件→残2,685件で完了(確定成功2,694件・並行書込み検出スキップ1件)**。**フォローアップ確認・2026-09-26**: 同日中に`--dry-run`を再実行したところ対象0件(想定通り自然解消済み)、追加のbackfill実行は不要と確認。

**kanameone実行判断の経緯(decision-maker確認済み)**: 当初はGoogle Drive連携Phase1本番展開(Track C)とのタイミング調整を理由に保留していたが、①`functions/src/drive/exportDocument.ts`の`isCustomerUnconfirmed`ゲートにより、backfillでcustomerConfirmed:trueになった書類はDriveエクスポートリトライ(`driveExportScheduled.ts`、15分毎・最大10件)の対象になりうると判明(kanameone実データで対象2,695件中240件がdriveExportStatus:'error'で該当) ②この挙動はbackfill固有ではなく、担当者がUIの「一括確認済み」(`DocumentsPage.tsx`の`handleBulkVerify`)を使った場合も全く同じ結果になる既存の正規仕様と確認 ③ただし「一括確認済み」は`useInfiniteDocuments`(1ページ100件)でその時点までにクライアント側へ読み込み済みの書類にしか作用せず、専用の絞り込みフィルタも存在しないため、担当者の通常操作でこの240件相当に自然に到達する可能性は実質的に低いと判断。「システム開発側で今まとめて解消する」方が現実的との結論に至り、Drive再連携ロールアウトの完了を待たずに実行することで決定・実施した。

**【追記・2026-09-26セッション】Issue #1043クローズ+Issue #1059完了(PR #1060マージ)**: `/catchup`で「GOAL.mdは#1043『完了』と記載しているがGitHub上はOPENのまま」という矛盾を検出。PR #1058が対応案2点(discriminated union化・rollback読込時のランタイム検証)を実際に実装済みと確認のうえ#1043をクローズ。続けてIssue #1059(fable-review残課題M2/M3/L1/L3/L4/L5/L6)にPR #1060で対応:
- M2(型異常のみでentries=0の場合manifestが空になる)/M3(GHAログsecret maskingでコンソール内訳が読めない)/L1(totalScanned/scanIncomplete記録)/L3(バリデータ非対称)/L4(schemaVersion追加)/L5(fields非空タプル型)/L6(ops-script入力欄の説明不足)を修正
- **codex review 1回目でP1指摘**: schemaVersion/totalScanned/scanIncompleteを必須化すると、cocoro本番backfill(2026-09-25実行済み、19件確定成功)で生成済みの旧形式manifestの`--rollback`が不可能になる(rollbackはその書込みの唯一の安全装置)。3フィールドをoptional化し「欠如は許容、値がある場合のみ検証」の後方互換ロジックに修正、2回目のcodex reviewで指摘0件を確認
- pr-review-toolkitセカンドオピニオン(code-reviewer高信頼度指摘0件、pr-test-analyzerがM2の統合テスト欠如[Critical Gap]を指摘)→統合テスト2件追加(dry-run/本実行それぞれで型異常のみのmanifest出力を検証)、Firestore emulatorで全9件PASS
- CI(lint-build-test、E2E含む)15分でPASS、squash mergeで#1059は自動クローズ

Issue Net変化: Close 2件(#1043, #1059)、起票 0件、Net +2。

## 【完了・2026-09-25】/catchup発の積み残しIssue対応3件（現在のミッションとは別件・並行トラック）

/catchupが提示した着手候補のうち、decision-maker承認を得た3件に順次対応。いずれも現在のミッション(Google Drive連携Phase1本番展開)とは独立。

- ~~**Issue #959**: 無保護`db.runTransaction()`7箇所の棚卸し調査~~ **【完了・記録のみでクローズ】** 全7箇所の保護状況(`withBackoffRetry`適用可否)を実コードで確認しIssue #959へコメント記録。適用推奨2箇所(`processOCR.ts`の`rescueStuckProcessingDocs`・`documentDetail.ts`の`readDocWithDetail`)は将来該当ファイルを触る用事に合わせて対応する方針、コード変更なし
- ~~**Issue #1046**: `fetchGroupDocuments`の`hasMore`算出がフィルタ後件数のみで判定され早期打ち切りしうるbug~~ **【完了・PR #1055マージ】** 生バッチ(`limit(pageSize*2)`)がsplit等で全滅した場合もhasMoreを正しくtrueにする修正+カーソルの無限ループ回避。修正過程でcodex review P1指摘(`GroupDocumentList.tsx`の空状態判定がcareManager限定でしかhasNextPageを見ておらず他groupTypeで後続ページ未到達)も検出・同PRで修正。Playwright MCPでdev実機確認(customer/careManager両groupType)、`ui-verified`付与済み
- ~~**Issue #1042**: 確認済み操作で顧客マスター取得失敗時に確定処理がサイレントスキップされユーザーに通知されないbug~~ **【完了・PR #1056マージ】** 単体トグル(`useDocumentVerification.ts`)・一括確認済み(`DocumentsPage.tsx`)とも、`fetchFreshCustomerIdentityLookup()`失敗時に確定処理(customerConfirmed/officeConfirmed)がスキップされたことをtoast/バナーで明示するよう修正。fail-closed設計(誤った確定を書き込まない)自体は維持。**codex review(high effort)を6巡実施**(P2指摘6件、いずれも実指摘: メッセージ重複/stale prop依存/失敗情報の握り潰し×2/選択維持漏れ×2、全て修正・テスト追加)し7巡目でfindings 0件に収束。pr-review-toolkit 3エージェント(code-reviewer/silent-failure-hunter/pr-test-analyzer)並列レビューも実施(指摘は主にcodexと重複、追加で境界値テスト漏れを反映)。純粋関数抽出(`decideBulkVerifyToast`/`decidePostWriteSyncFailureToast`、`frontend/src/lib/bulkVerifyToast.ts`新設)によりDocumentsPage.tsx全体をマウントせず単体テスト可能にした(Issue #1044のDocumentsPageテスト基盤不在とは別に、判定ロジックのみ先行してテスト網羅)。Playwright MCPでdev実機確認(一括確認・単体トグル双方の正常系)、`ui-verified`付与済み

**Issue Net変化**: Close 3件(#959, #1046, #1042)、起票 0件、Net +3。

## 【完了・2026-09-23】Issue #1028: Drive OAuthスコープをdrive.file→driveフルスコープへ拡張し、兄弟重複統合スクリプトを新設（PR #1038マージ）

下記「kanameoneクライアントフィードバック10件対応」①（医療フォルダ重複）で判明した`drive.file`スコープの構造的盲点（appが一度も触れていない人作成フォルダを`files.list`で検出不能）への対応。decision-maker判断「クライアントが手動でフォルダ操作したいという業務要件があるため、運用ルールでの回避ではなく技術対応が必要」を受け着手。

**プロセス**: plan mode（Opus）で計画策定 → `/plan-crossreview`（grip自白×codex独立診断2巡、High8/Medium7/Low1件を反映し計画を書き直し）→ 実装 → `codex review`がusage limit到達のため事前承認済み手順でFable 5.1へ2回セカンドオピニオン依頼（実コード直接検証込み、両パス合わせてHigh4件を反映）→ PR作成 → `post-pr-review.sh`hook強制のPRレビューゲート（`codex review`P1×2/P2×1 + `pr-review-toolkit`5エージェント[code-reviewer/pr-test-analyzer/silent-failure-hunter/type-design-analyzer/comment-analyzer] + `quality-gate-evaluator`のAC忠実性チェック込み評価、Critical1件・3経路収束High1件を含め全件コード修正）→ `.tsx`変更（SettingsPage/HelpPage）をPlaywright MCP+ローカルemulatorで実機確認し`ui-verified`付与 → decision-maker明示認可を得てsquashマージ。

**決定事項（AskUserQuestionで確定）**:
1. バックエンド永続token（code flow）のみ`drive`フルスコープへ拡張。Picker用token（`initTokenClient`）は`drive.file`のまま維持（最小権限、Google推奨のPicker併用パターン）。`drive.metadata.readonly`は要件（フォルダ作成・移動・PDF書込み）を構造的に満たせないため確定却下（ADR-0028）
2. 既存の同名重複は「人が作った側」を残し、app作成側の中身を移動してから統合する新設スクリプト2本（`scripts/audit-drive-sibling-duplicates.ts`[read-only棚卸し]・`scripts/execute-drive-sibling-merge.ts`[承認制実行]）で対応。GitHub Actions `run-ops-script.yml`へ組み込み済み
3. kanameoneは既に`driveFolderClaimRead:true`が本番有効なため、既存app管理フォルダとの新規衝突による`divergent`化は今後も繰り返し発生する運用コストとして受容し、人手解除ステップ（`execute-drive-claim-resync --mode release-claim`→再実行）をSOPとして正式化（`docs/context/monitoring-setup.md`、ADR-0028 Cons節）。一時「解消不能なclaimが残る恒久バグではないか」と誤認しかけたが、実装・SOP双方を突き合わせて「release-claim後の再実行で解消する」設計に修正済み

**follow-up**:
- ~~Issue #1039（P1）: 新設2スクリプト本体のfixtureベース統合テストが不在~~ **【完了・2026-09-25、PR #1052マージ・クローズ済み】** `scripts/lib/executeSiblingMerge.ts`/`scripts/lib/auditSiblingDuplicates.ts`へmain()の7つの安全分岐を抽出し、fake Drive(新規`scripts/lib/testing/fakeSiblingDrive.ts`)+実Firestore emulatorで24+8+5ケースの統合テストを追加。`/plan-crossreview`(codex 2パス)でIssue本文が例示した「API timeout後の状態照合」ロジックが既存実装に無いことが発覚し、decision-maker判断で新規実装せずスコープ縮小。codex review×2(findings 0件)+pr-review-toolkit×2(findings 0件、pr-test-analyzer指摘4件は追加テストで反映)+quality-gate-evaluator(APPROVE)+dev実機確認(audit→execute dry-run、書込みゼロ)を経てマージ
- ~~**kanameone/cocoro本番展開前の必須ゲート**: ①dev環境での実機再連携・Issue #1028再現解消確認・既存重複統合リハーサル ②GitHub Actionsワークフローの実機起動テスト~~ **【完了・2026-09-24以前】** dev実機再連携(`https://www.googleapis.com/auth/drive`スコープ再同意)・既存重複統合リハーサル(audit→execute --dry-run→--execute→再audit`groupCount:0`確認)・GHAワークフロー起動テスト(計4回)いずれも完了済み(詳細は本ファイル冒頭セクション参照)
- **残タスク（条件待ち、trigger=decision-maker判断）**: 上記2ゲートが揃ったため、technicalには「kanameone/cocoroへDrive再連携を案内する」段階に到達している。ただしこれはクライアントへの外部コミュニケーションでありexecutorが起点を持てない（4原則§1）。decision-makerが案内タイミングを判断する

## 【完了・2026-09-25】kanameoneクライアントフィードバック10件対応（①〜⑩全件対応完了+既存Issue #960修正1件マージ済み、現在のミッションとは別件・並行トラック）

kanameoneから10件のフィードバックが届き、①は不具合報告・②〜⑩は機能要望。着手順はdecision-makerに一任されたため、①はrules/workflow.md「バグ報告は報告者へ即座に聞き返す前に自分の手段を使い切る」原則([[feedback_reproduce_before_asking_reporter]]としてグローバルharnessにも新規反映)に従い、まずdev環境での実機再現を優先した。

**①(医療フォルダ重複、Issue #1028起票)**: kaname報告は「「医療」フォルダを別の場所から保存先ドライブフォルダに移動したところ重複ができた」というもの。Issue #871(claimプロトコル、2026-09-16 kanameoneロールアウト完了)と類似だが別原因の可能性を疑い、まずkanameone実データをread-only調査(`scripts/investigate-drive-folder-duplicate-by-name.ts`新規実装、PR #1027マージ・codex review 3回で指摘3件解消)。テナント全体で重複は検出できなかった(`drive.file`スコープの限界で「appが一度も触れていないフォルダ」は検出不能という制約を発見)ため、dev環境で実機再現を実施: Drive UI上でapp未関与の「医療」フォルダを手動作成→顧客フォルダへ移動→doc-split dev環境で保存操作(書類種別変更→確認済み化)を実行したところ、**Drive UI上に「医療」フォルダが2つ生成される重複を100%再現**。同時に、app視点(`files.list`)ではこの新規作成分1件しか見えず(手動配置分は不可視)、根本原因が`drive.file`スコープの恒久的な盲点(タイミング非依存、Issue #871のclaimプロトコルの対象外)であることを実機で確定。Issue #1028に再現手順・根拠・対応方針候補(スコープ拡張/運用ルール化/検出ツール運用)を記録、decision-maker判断待ち。dev環境で変更したテストデータ(`seed-doc-0125`)は元の状態(書類種別:ケアプラン、未確認)に復元済み。重複した「医療」フォルダ2件は証跡としてdev環境にそのまま残置(GHA run `35823293047`のログと合わせて参照可能)。

**②〜⑩(機能要望9件、Issue #1029〜#1037)**: 全件完了。

- ~~#1029 担当ケアマネ不明の絞り込み表示~~ **【完了・2026-09-25、PR #1053マージ】** `document.careManager`未設定の書類を絞り込むチェックボックスを書類一覧タブに追加。既存の`showMultiCustomerOnly`等と同型のクライアント側フィルタ。1ファイル・22行の小規模PR、Playwright MCP実機確認済み
- ~~#1030 書類種別サジェストの並び順改善~~ **【完了、PR #1047】**
- ~~#1031 PDFアップロードのバックグラウンド化~~ **【完了、PR #1048】**
- ~~#1032 担当CM別画面の件数不正確(全件読込前、bugラベル)~~ **【完了、PR #1045】**
- ~~#1033 契約終了利用者の非表示設定~~ **【完了、PR #1049】**
- ~~#1034 確認後も「選択待ち」バッジが残る~~ **【完了・2026-09-24、PR #1041マージ】** 「確認済み」操作が`customerConfirmed`/`officeConfirmed`も同時確定するよう統合。同姓同名等の危険ケースは既存の安全装置(ADR-0022)で引き続き除外。既存本番データへのbackfillスクリプト(`scripts/backfill-confirm-on-verify.ts`)を新規作成したが**本番実行は別途番号単位の明示認可待ち**(dev `--dry-run`→kanameone/cocoro canary→全量、docs/handoff/GOAL.md本節末尾「次の一手」参照)。codex review 9回(通常8回+マージ前strict-config)+`pr-review-toolkit`5エージェント並列セカンドオピニオンで検出した指摘のうち重要4件は本PRで反映、残り3件はフォローアップIssue化(#1042/#1043/#1044、詳細はPR #1041のコメント参照)
- ~~#1035 利用者フォルダ内の日付表記・ソート順~~ **【完了・2026-09-24、PR #1041に同梱】** 担当CM別グループ表示の日付を書類日付→登録日(`processedAt`)に変更
- ~~#1036 マスターCSV一括編集機能~~ **【完了、PR #1050】**
- ~~#1037 PDF削除権限の一般ユーザー開放~~ **【完了・2026-09-25、PR #1051マージ】** `/plan-crossreview`で当初案(firestore.rules緩和)がCloud Function経由の安全な削除処理を迂回する新経路を開く設計ミスと判明、`deleteDocument.ts`本体+フロントエンド2層のみでの権限緩和に全面改訂

**既存Issue #960(別件、同セッション内で先行対応)**: `handleProcessingError`のFirestore transient gRPCコード判定漏れをPR #1026で修正・マージ済み(codex review findings 0件、CI全PASS)。

**🎯 kanameoneフィードバック10件対応ミッション達成**: ①(Issue #1028、Drive OAuthスコープ拡張)〜⑩(Issue #1037)全件完了。次のゴールへの更新は不要（並行トラックのため本セクションはこのまま完了記録として残す）。

~~**Issue #1034/#1035のbackfillスクリプト本番実行**~~ **【cocoro完了・2026-09-25、kanameoneは条件待ち】** Issue #1043(ManifestEntry型のdiscriminated union化+rollback読込みのランタイム検証、PR #1058マージ)対応完了後、dev`--dry-run`→kanameone/cocoro実データ`--dry-run`(型異常0件確認、CLAUDE.md「既存データへの新規ゲート追加時の注意」充足)→**cocoro canary3件→残16件本実行、計19件確定成功・エラー0件で完了**。kanameone(2,695件対象、型異常0件確認済み)は**Google Drive連携Phase1本番展開(下記Track C)とのタイミング調整のため実行を保留**(driveExportStatus:'error'書類が定期リトライで拾われる相互作用のため)。本番rollback dry-runはPR #1058のFirestore emulator統合テスト7件(fail-closedゲートを意図的に無効化して実効性まで検証済み)で代替、decision-maker承認済み。残る軽微な指摘(監査証跡の永続化条件・GHAログマスキング等)はIssue #1059へフォローアップ。

## 【完了・2026-09-20】Issue #984: kanameone `search_index` 1MiB飽和(日付由来トークン)対応 — 段階1・段階2a完了、kanameone実データ確認済み・Issueクローズ（現在のミッション・ADR-0025とは別件の並行トラック、#984・#981とも完了）

kanameoneの`search_index/{tokenId}`(1トークン=1文書に全書類のpostingsを格納、1MiB上限≒14,500件)で、日付由来トークン(`2026`=14,562件で飽和済み、改名規則`…_YYYYMMDD_…`由来の2桁bigram `26/20/02/60`が11,400〜12,780件)が飽和し、新規書類がその語で検索に出なくなっていた。

- [x] **段階1（PR #985〜#989）**: 高頻度トークンが上限に達しても書類の全トークンを未登録にしないfail-soft、検知メトリクス、`--missing-hash-only`による復旧。kanameoneで未索引1,723→0（BulkWriter flush不具合#989も修正）
- [x] **段階2a PR-B（#990）**: 日付語(年・年月・年月日、2000〜2099)を`documents.fileDate`のUTC範囲クエリで答える(`dateQuery.ts`)。日付のみ=`status`+`fileDate`範囲+`count()`で先頭500件のみ、混在=索引AND後にfileDateで絞る（候補500超で日付一致が漏れうる既知の限界、`truncated`で通知）
- [x] **段階2a PR-A（#991）**: `isExcludedToken`(日付形と数字/`_`のみ1〜2文字)を索引から除外。削除側のNOT_FOUND巻き添え・tokenId重複減算(`df`負値)・トークン0件書類を修正。ADR-0026
- [x] **dev実機確認**: 人工書類で日付トークン非登録・実Firestoreの範囲クエリ+`count()`(複合インデックス)を確認、後片付け済み。callableの認証付き実呼び出しは権限(`signJwt`)の都合で未実施
- [x] **本番事前計測(read-only)**: kanameone/cocoroとも複合インデックスstatus×fileDate READY、実行時TZなし(UTC)。fileDate: kanameone UTC0時17,390/JST0時80/なし2,638/2000〜2099外522、cocoro UTC0時1,348/なし289/外12。3環境で関数構成・runtime・インデックスは一致(事前計測時点ではcocoroのみ#986/#990/#991未反映、その後デプロイ済み)
- [x] **kanameone Functionsデプロイ(2026-09-20 13:47Z、run 35514146302)**: `OCR_PROVIDER=paddle`維持、25関数ACTIVE
- [x] **kanameone実データ確認(2026-09-20 14:26Z、read-only)**: デプロイ後の新規書類2件で`2026`/`26`/`20`/`02`/`60`の索引文書にpostingなし、5索引文書の最終更新はデプロイ前(不変、`2026`=14,562件)、`token skipped`/`index write failed`ログ0件、既存書類9件の再索引もエラーなし。**Issue #984クローズ**
- [x] **dev画面確認(2026-09-21、認証済みPlaywright)**: 人工書類で`2099`→範囲内2件のみ新しい順、`2099-03-10`→1件、通常語+`2099年3月`→2件、日付なしの従来検索も正常、コンソールエラー0件。人工書類は後片付け済み(クライアント本番は画面操作せずread-only観測のみが建付け)
- [x] **cocoroデプロイ(2026-09-20 14:52〜14:54Z、run 35517480350)**: `OCR_PROVIDER=paddle`維持、25関数ACTIVE、3環境(dev/kanameone/cocoro)で関数構成・runtime・メモリ・タイムアウト・複合インデックス36個が一致
- [x] **ログベースメトリクス・アラートの適用(2026-09-21、Issue #981クローズ)**: Setup Monitoringワークフローで dev(ローカル実行)→kanameone(run 35533087283)→cocoro(run 35533423590)へ、`search_index_token_skipped`/`search_index_write_failed`メトリクスと`search_index_write_failed`アラートを新規作成(既存は変更なし)。devの実ログで`token skipped`フィルタが3件一致を確認

**decision-maker判断**: 全件force-reindexはしない(新規書込みが止まれば飽和は進まず、既存書類は更新時に自動再索引)、`force-reindex.js`変更・飽和索引の掃除・`df`再計算もしない。年範囲は2000〜2099のまま(2000年未満522件は誤抽出の可能性が高く年検索で当たらなくなる)。数字部分一致縮小は許容。段階2b(シャーディング)は非日付トークンの推定posting>10,000件、または`search_index_token_skipped`に新tokenIdsが出た場合に再検討。混在検索で日付一致が候補500から漏れ0件になる場合のFEバナー警告は別PRのフォローアップ(未起票)。詳細: `docs/adr/0026-search-index-date-tokens-excluded.md` / Issue #984コメント / `docs/context/search-index-recovery.md`。

## 【完了・2026-09-18】低コストROI対応3件: Issue #949(cocoro Hosting反映)+ Issue #947(executeDriveExport runTransaction保護、PR #951)+ Issue #952(exportDocument writeback保護、PR #953)

decision-maker質問「まず低コストですぐ出来るROIが良いものは？」を受け、catchup積み残し候補（Issue #949/#947）を比較・decision-maker選択のうえ完了。続けて/catchupが検出した即着手候補Issue #952（#947のfable-review時にスコープ外指摘された類似問題）もdecision-maker承認を得て同日中に完了させた。現在のミッション（Drive連携Phase1展開）・ADR-0025 PaddleOCRトラックとは独立した単発対応。

- [x] **Issue #949: cocoro Hosting未反映(94.1時間遅延、閾値48時間)を解消**: `switch-client.sh cocoro && deploy-to-project.sh cocoro`で手動デプロイ。**副産物の発見**: `switch-client.sh`をサブプロセス実行すると、`.envrc`のdirenvフックが新規シェル起動のたびに`CLOUDSDK_ACTIVE_CONFIG_NAME=doc-split`へ戻してしまい環境切替が効かない（`gcloud config configurations activate`も同様に上書きされる）。回避策として`source ./scripts/switch-client.sh <env>`で切替とデプロイを同一シェル内実行。恒久対応（スクリプト側改修）は未着手のまま（次回同種操作時の参考として本記録を残す）。配信バンドルハッシュ照合で反映確認、Issueクローズ済み
- [x] **Issue #947: `executeDriveExport()`のエラー確定用runTransaction無保護によるexporting状態固着リスクを解消（PR #951マージ済み）**: try/catchで保護し、失敗時は`lastUpdateTime` precondition付きの非transactionフォールバック書込みへ切替。codex reviewが利用上限(`You've hit your usage limit`、事前承認済みの自動fable-review切替条件`Selected model is at capacity`とは別種のためAskUserQuestionで都度承認を得て手動切替)でfable-review(Fable 5.1)を2回実施(初回diff+PR最終diff)、High 1件(lastUpdateTime precondition化)・Medium/Low計9件を反映。CI pass・fable-review mergeable判定後、decision-maker番号単位認可でsquash mergeしIssue #947クローズ
- [x] **Issue #952: `exportDocument()`の成功時writeback transaction無保護によるdriveFileId消失リスクを解消（PR #953マージ済み）**: #947と同型パターンで対応。try/catchで保護し、失敗時は`lastUpdateTime` precondition付きの非transactionフォールバックへ切替。#947との設計上の違い: フォールバックも失敗した場合、#947（呼び出し元の既存catch節内）は例外を握り潰して良かったが、#952は`exportDocument()`本体の実行中のため握り潰すと`driveExportStatus`が`'exporting'`のまま固着する。そこで元の例外を呼び出し元`executeDriveExport()`へ再throwし、PR #951で保護済みのエラー確定writebackに委ねて`'error'`へ遷移させる設計とした（driveFileIdは喪失するが状態不整合は防止、再試行は`resolveDriveFile()`のappProperties経由idempotencyに委ねる）。テスト用に`ExportDocumentDeps.firestore`を追加、回帰テスト3件追加（41件全PASS、`test:integration:drive`187件回帰なし）。codex reviewは本セッション中も利用上限が継続（復帰予定2026-09-20 1:21 AM）のため2回ともfable-review代替（High 0/Medium 4/Low 5、マージブロッカーなし）、指摘2件（テストタイトルの誤り・`firestore`注入範囲の一部不整合）を追加コミットで反映。decision-maker番号単位認可でsquash mergeしIssue #952クローズ
- [x] **Issue #954: `driveFolderClaim.ts`の無保護`runTransaction`11箇所を`withBackoffRetry`で防御（PR #955マージ済み）**: `/handoff`同根再発スキャン(§4.6)で発見(Issue #952完了直後、`grep`で`runTransaction`使用箇所を横断確認し発覚)。#947/#952とは異なり全11箇所が`tx.set()`(全フィールド置換)のため`update()+precondition`フォールバックは適用不可と判明、plan mode+fable-review(設計・実装2回)を経て「`withBackoffRetry`+gRPC transientコード限定`shouldRetry`述語」で対応する方針に確定。decision-maker承認によりRESOURCE_EXHAUSTED(gRPC code 8)は外側リトライ対象から意図的に除外(Cloud Functions timeout接近リスク回避)。呼び出し元3箇所(`recordMiss`/非trashed`recordVerification`/`reconcileAttempt`内`invalidateAttempt`)のbare await契約違反も修正。`codex review`が利用上限(`usage limit`)で2回失敗したため、fable-review・silent-failure-hunter・pr-test-analyzer・code-reviewerの4エージェント並列レビューで代替(decision-maker指摘によりusage limitも事前承認済みcapacityエラーと同様に自動fallback対象と確認、事後にmemory訂正要)。CRITICAL 1件(`commitResolvedWithRetry`のリトライ条件統一漏れ)・Medium数件・DRY指摘(11箇所の重複を`runClaimTransaction`ヘルパーへ集約)を反映。tsc/eslint/`test:integration:drive`(197件)/`npm test`(2144件)全PASS確認後、decision-maker番号単位認可でsquash merge。silent-failure-hunterのHIGH指摘(新規3箇所の`.catch()`にアラート基盤が無い)はスコープ外と判断しIssue #956へ切り出し
- [x] **Issue #954の同根再発スキャン第2弾【完了・2026-09-18】**: 別セッションで`runTransaction`を使う残り8ファイル11箇所をExplore agentで監査(read-only)、全て無保護と判明。優先度別にIssue #957(最優先2箇所)/#958(次点2箇所)/#959(軽微7箇所、未着手)へ分割起票
- [x] **Issue #957: `ocrProcessor.ts`の`applyOcrCompletionTransaction`/`handleProcessingError`を`withBackoffRetry`で防御（PR #961マージ済み）**: `driveFolderClaim.ts`のprivate実装だった`withBackoffRetry`/`isRetryableFirestoreError`を`utils/retry.ts`/`utils/firestoreErrors.ts`へ共通化。実装後、Fable 5.1(codex usage limit継続のため承認済み手順で代替)セカンドオピニオンで「新挙動を直接検証するテストが無い」と指摘され統合テスト追加中、当初の想定(ambiguous commit後の2回目実行は非複製分岐に倒れる)が誤りと実測で判明・訂正(実際はstatus-mismatchで`OcrRunSupersededError`が即座にthrow、リトライされない。1回目の正しいcommit結果は破壊されない)。PRマージ前ゲート(large tier)でEvaluator+pr-review-toolkit4エージェント+Fable計6並列レビュー実施、FAX複製分岐×リトライの回帰テスト等を追加。派生Issue: #960(`isTransientError`のgRPCコード判定漏れ)・#962(observability強化follow-up)
- [x] **Issue #958: `tryStartProcessing`/`checkGmailAttachments.ts`を`withBackoffRetry`で防御（PR #964マージ済み）**: #957と同型パターン。マージ前ゲートでFable+pr-review-toolkit4エージェント並列レビューを2巡実施。1巡目でmainブランチ上に未コミット状態のまま作業していたプロセス違反(Fable指摘H1)を発見しfeatureブランチへ退避、2巡目でFable 5.1が実バグ(M1: ambiguous commit後の再試行がblind setのため`processOCR`cronのclaimを巻き戻す可能性)を検出・修正、加えて自分が書いたコメントの事実誤認2件(発生窓「3倍に広がった」は不正確、レイテンシ見積り過小評価)をFableに訂正された。`checkGmailAttachments.ts`側はcode-reviewer/pr-test-analyzer収束指摘を受けtransaction本体を`createGmailAttachmentRecords()`としてdb注入可能に抽出しリトライテスト追加。派生Issue: #963(`tryStartProcessing`のambiguous commit残余ギャップ、診断シグナル追加要)

## 【完了・2026-08-29開始→2026-08-30完了】複数人記載FAX: 複製廃止→検出バッジへの置換（kanameone、Stage 0〜3完了）

kanameoneから「1FAXに複数人分の書類がまとまっている場合の人数分複製表示（`faxDuplication`機能）を廃止し、代わりに一目で複数人記載と分かる検出バッジに置き換えたい」という仕様変更依頼を受け、plan mode承認済み計画（`/Users/yyyhhh/.claude/plans/merry-drifting-seal.md`、grip+codex plan-crossreview実施済み）に基づき実装・展開した。

**方針**: 既存`faxDuplication`フラグは維持し、新設`multiCustomerDetection`フラグ（検出のみ・複製はしない）を追加。複製ON+検出ONの併走期間で「検出集合==複製発火集合」を本番データで実測してから複製をOFFにする段階展開（Stage 0 dev → Stage 1 kanameone併走 → Stage 2 kanameone複製OFF → Stage 3 棚卸し）。

**完了（2026-08-29）**:
- [x] PR-A（BE検出ロジック+新フィールド書込み+フラグ基盤、`shared/multiCustomerDetection.ts`）: `codex review`実施、PR #864としてマージ
- [x] PR-B（FE表示・フィルター、`MultiCustomerBadge.tsx`）: `codex review`+Firebase Emulator/Vite/Playwright MCPでの実機UI確認+`ui-verified`ラベル付与、PR #867としてマージ（PR #865はPR #864のsquash-merge時のbase branch削除で自動クローズされたため、rebase後に新規PR化）
- [x] PR-D（既存複製doc read-only棚卸しスクリプト、`scripts/audit-fax-duplication-inventory.ts`）: `codex review`2巡（P1/P2指摘を修正）+`pr-review-toolkit:code-reviewer`/`pr-test-analyzer`セカンドオピニオン（テストカバレッジ不足3件を修正）、PR #868としてマージ（PR #866も同様の理由で自動クローズ→再PR化）
- [x] Stage 0（dev）: `/deploy dev --rules`実行、フラグON確認、実機で「複数名の可能性 (N名)」バッジ・フィルターの動作確認済み
- [x] CI基盤整備: kanameone向けFirestore/Storage rulesデプロイがFirebase CLIローカルセッション失効（`systemkaname@kanameone.com`のブラウザ再認証が必要でexecutorから対応不能）でブロックされた際、decision-maker指示「GHAで対応」に従い新規GitHub Actions workflow `deploy-firestore-rules.yml`を追加（既存`deploy-firestore-indexes.yml`と同型のSA鍵認証パターン、PR #869としてマージ）
- [x] Stage 1開始（kanameone）: `/deploy kanameone --full`でFunctions/Hosting/Rules全反映（`--rules`のみだとFunctionsが更新されずStage1の検出ロジック自体が動かないギャップを事前に発見しdecision-makerへ確認済み）、Firestore rulesは新設GHA workflow経由で反映、`multiCustomerDetection`フラグをkanameoneでON（`faxDuplication`はtrueのまま併走）

**Stage 1併走期間の詳細は下記「🔄 中断点」参照**（最低5件の検出サンプルが揃うまで、目安1〜3営業日の待機）。

**【完了・2026-08-30】Stage 2着手・完了（kanameone複製処理の廃止）**: decision-maker指示「完了まで進める必要がありますね。計画をたてて進めましょう」を受け、Stage1併走の実測検証とStage2切替を同日中に実施した。

- **AC-9検証（検出集合と複製発火集合の一致）**: `audit-fax-duplication-inventory`をkanameone向けに再実行（run [33312493363](https://github.com/yasushi-honda/doc-split/actions/runs/33312493363)）、検出サンプル`detectionStats.totalDetectedCount: 91件`(document単位)/`groupsWithMultiCustomerDetectedMemberCount: 20件`(グループ単位、最低条件5件を大きく超過)を確認。Cloud Loggingで`faxDuplicationPlan`ログの`reason: exactCandidatesDistributed`件数（フラグON化した8/29 19:11 UTC以降）を実測したところ**20件**で、audit結果のグループ単位検出数(20件)と完全一致。検出のみ(複製されなかった)doc数も0件。両方向で不一致ゼロを確認し、「検出集合==複製発火集合」を本番データで実測できた
- **Stage 2切替（計画書の手順通り、全てFirestore/GHA直接操作）**: ①`system/maintenanceFlags.groupAggregationGateOpen`を`false`に設定（12:55 UTC）②20分ドレイン待機 ③`documents`コレクションの`status:processing`件数が0件であることを集計クエリで確認 ④`set-feature-flag --flag faxDuplication --value false --dry-run`で`現在値:true → 新値:false`を確認後、`--dry-run`を外して本実行（13:19 UTC、`settings/features.faxDuplication`が実際に`false`へ変わったことを実測確認）⑤`groupAggregationGateOpen`を`true`に戻す（13:20 UTC、ゲート閉鎖時間は合計約25分）
- **未完了の確認項目**: 計画書AC-8拡張「切替時刻以後に作成された`distributionId`グループが0件であること」は、新規の複数人記載FAXが実際に到着してからでないと検証できない。次回、複数人記載FAXが到着した際にCloud Loggingで`reason: flagDisabled`になっていること・新規`distributionId`グループが作られていないことを確認する
- **Stage 3（棚卸し記録）完了**: `audit-fax-duplication-inventory`の結果（スキャン対象3,203件・複製グループ1,016・Drive出力済みメンバーを含むグループ747）をADR-0024「ロールアウト実績」節に記録済み。「Drive出力済みメンバーを含むグループ数」は将来のPR-C（既存doc向けFE導出フォールバック）再検討の入力として残した

## 【完了・別件・並行トラック】Google Drive連携Phase1本番展開(2026-07-23開始)

kanameone・cocoroへのGoogle Drive連携Phase1本番展開。承認済み計画: `/Users/yyyhhh/.claude/plans/witty-drifting-hoare.md`。

**背景**: Drive連携Phase1 (MVP)はdev環境のみ実装・検証済み（下記「Google Drive連携Phase1完遂」節）。kanameone(876件のverified document対象)・cocoro(93件)への本番展開はbackfill-drive-export.tsのdry-runのみで保留していた。decision-maker承認によりplan mode経由でインフラ準備〜backfill本実行までを計画化し着手。

**制約（decision-maker明示）**: 本番のGoogle Drive OAuth接続（実際の同意フロー実行）はkanameone/cocoro各クライアント自身が行うものであり、Claude Code executorやdecision-makerが代行することはできない。

**進捗（2026-07-23）**:
- [x] Phase A: Codexセカンドオピニオン（MCP、effort=high）実施。Phase Bは条件付きGO、Phase D/Eは複数High指摘により現計画のままでは実行不可と判定
- [x] Phase B（kanameone）: インフラ準備完了・検証済み（Functions 4関数デプロイ/Firestore rules,indexes/Picker API有効化/OAuth Client作成/Secret Manager 3件/IAMバインド4件/実行SA一致確認/STORAGE_BUCKET確認/`settings/drive.oauthClientId`投入/flag OFF確認）。実行時に追加発見: Firebase自動生成Browser API Keyの制限リストに`picker.googleapis.com`が含まれておらず追加修正
- [x] Phase B（cocoro）: 同上、認証主体差分（OAuth Console操作=`hy.unimail.11@gmail.com`、Secret作成・IAMバインド=SA`docsplit-deployer@docsplit-cocoro.iam.gserviceaccount.com`）を踏まえ完了・検証済み。同じPicker API制限問題も発見・修正
- [ ] Phase C（クライアント自己完結、外部依存）: kanameone/cocoro各管理者によるGoogle Drive OAuth接続・フォルダ選択・テンプレート保存。executor代行不可。**decision-makerがクライアント側の代理対応者へ案内文書を送付済み（2026-07-25）**。**kanameoneは完了（2026-07-31 catchupで実測確認、`settings/drive.authMode:'oauth'`/`connectedEmail`/`rootFolderId`/`template`ともに設定済み、接続日時2026-07-30）**。**cocoroは未着手のまま**（`settings/drive`が2026-07-23のPhase Bインフラ準備時点から未変更）、先方の実施待ち
- [x] Phase D/E再設計（2026-07-23、plan mode承認済み計画 `/Users/yyyhhh/.claude/plans/breezy-tickling-sifakis.md`）: Codex High 5件（①flag ON直後の全ユーザー巻き込み ②backfillにcanary機構欠如 ③flag OFFはロールバックにならない ④通常操作とbackfillの競合 ⑤完了時間・異常停止基準未定義）に対応するコード・テスト・ADR更新を実装完了。①allowlist機構(`settings/features.driveExportAllowlist`、`getDriveExportGate()`が`driveExportTrigger.ts`のみをゲート、sweep/手動retryは意図的に非対象)+設定スクリプト`scripts/set-drive-allowlist.js`(`--set`/`--clear-empty`/`--remove`) ②`scripts/backfill-drive-export.ts`に`--limit`/`--expected-count`(書込み前アサート)/`--manifest-out`/`--rollback`を追加 ③④`lastUpdateTime`precondition個別updateへの置換(Timestampオブジェクトを直接渡す設計。ISO文字列round-tripは精度損失で全書込み無言失敗になる罠をFirestore emulatorで実証済み) ⑤read-only状態分布レポート`scripts/drive-export-status-report.ts`新設。functions unit1909/integration237/rules92全PASS、scripts単体テスト(`scripts/lib/driveExportBackfillHelpers.test.ts`)8件PASS、Firestore emulatorでbackfill/rollback/limit/expected-count/manifestの実シナリオをend-to-end実行し結果確認済み。ADR-0022に設計判断・ロールバック意味論・runbookを追記。**実際のflag ON/allowlist設定/backfill本実行はいずれも未実施**(Phase C完了確認後、番号単位の明示認可で別セッション実施)。PR #710としてmainへマージ済み（`/code-review high`4件+`/codex review`1件（allowlist明示null値のfail-closed漏れ）も同PRで解消）
- [x] ヘルプマニュアルへのGoogle Drive連携ガイド追加（2026-07-23、PR #711マージ済み）: `frontend/src/pages/HelpPage.tsx`管理者ガイドに新セクション「Google Drive連携」を追加（Drive接続→フォルダ選択→テンプレート設定の3ステップ、SettingsPage.tsx実装の実UI文言を踏襲）。decision-maker指摘によりGoogle Workspace公式ブログ（2026-07-16付）でNotebookLMがGemini Notebookへ改称されたことを確認、外部製品名の陳腐化リスクを避け「生成AIツール」という汎用表現に修正。Playwright MCPでdev環境の実際のレンダリングを確認済み
- [x] PR #710/#711のkanameone・cocoro本番反映漏れを発見・解消（2026-07-23）: catchupのcurl試行がauto mode classifierにブロックされた事象を発端に、decision-maker明示許可で`settings/drive`をread-only確認したところPhase C未着手を確認。その過程でPRマージ時刻とkanameone/cocoro側の実デプロイ時刻（Functions/Hosting）を突合し、PR #710（Phase D/E再設計コード）・PR #711（ヘルプマニュアル）がmainマージ済みにもかかわらず両クライアント環境へは未反映（直近デプロイがPRマージより前）と判明。decision-maker承認を得て`gh workflow run "Deploy Cloud Functions"`(kanameone/cocoro)+`"Deploy Firebase Hosting"`(kanameone、GHA限定)+手動`firebase deploy --only hosting -P cocoro`（`/deploy`スキルのcocoro手順通り、`.env.local`後片付け含む）を実行、4件とも成功。Functions updateTime・Hosting releaseTimeがPRマージ時刻より後であることをground truthで検証し反映確認済み
- [x] Phase C事前安全性検証（2026-07-23、Playwright MCPでGoogle Auth Platform Console確認・設定変更は一切なし）: decision-maker質問「クライアント操作で即発覚するバグはないか」を受けExploreエージェントで調査した結果、OAuth接続フロー自体（PR #710の対象外）に懸念点はないが、kanameoneのOAuth同意画面が「Testing」ステータスだと(a)テストユーザー未登録で管理者接続時に403 access_denied (b)Testing状態はリフレッシュトークンが同意から7日で失効（公式ソース: support.google.com/cloud/answer/15549945で確認）という2つの潜在リスクを特定。Playwright MCPで実際にConsole確認した結果、**kanameoneは既に「公開ステータス: 本番環境」に到達済み**（テスト昇格操作は不要・7日失効リスクなし）、データアクセスページのスコープ登録0件（Gmail連携との競合懸念も該当なし）、「DocSplit Drive」クライアントのAuthorized JavaScript origins(`https://docsplit-kanameone.web.app`)・Firestore `settings/drive.oauthClientId`ともに実クライアントIDと完全一致を確認。cocoroは「ユーザーの種類: 内部」でTesting/Production概念自体が対象外と確認。Phase C（クライアント操作）は安全に案内可能な状態
- [x] Phase C事前確認セッションで新規発見・修正（2026-07-24、PR #721マージ済み）: decision-maker依頼の「クライアント操作で誰でも気づく不具合はないか」再確認で、Firebase Emulator+Playwright MCPの実機テスト中に、フォルダ階層テンプレートの「かなめ式で初期化」「cocoro式で初期化」プリセットボタンがテナント判定なしに両クライアント環境へ無条件表示されている問題（cocoro管理者にも「かなめ式」ボタンが見える等）を発見。decision-maker指摘「短絡的な企業名付けをやめ、SVG図解で分かりやすく」を受けplan mode承認済み計画で対応: ①ラベルを「5階層（詳細）」「3階層（シンプル）」に汎用化+lucide-reactアイコンによるフォルダツリー図解プレビューカード化 ②プリセット適用後の固定文字列初期値を空欄化 ③Codexセカンドオピニオンで発見した「日付階層のonlyForCategoriesが特定書類種別名にハードコードされ他テナントで発火しない」問題を`buildDetailed5TierPreset(documentCategoryNames)`ファクトリ関数化で解消。`/code-review`（10角度並列+検証+gap sweep、1回目はストールし2回目で完了）でCONFIRMED 9件中優先度上位3件（図解ラベルと編集エリアの用語不一致・aria-labelによるスクリーンリーダー向けdescription欠落・ヘルプ文言矛盾）を追加修正。tsc/lint/該当テスト58件/frontend全体484件PASS、Firebase Emulator+Playwright MCPで実機確認（新カード表示・動的反映・aria-describedby紐付き等）済み。PR #721作成→CI全PASS→ui-verified付与→マージ→**dev（CI自動）・kanameone（GHA `Deploy Firebase Hosting`）・cocoro（`/deploy`スキル手順の手動デプロイ）の3環境すべてへデプロイ完了確認済み**。これによりPhase C案内時にクライアントが目にする画面の懸念は解消
- [x] **同姓同名（別人）のDrive誤配置リスク対応（2026-07-25開始→再設計→`/code-review high`+`/codex review`全指摘解消→PR #723/#724マージ→dev/kanameone/cocoro全環境デプロイ完了）**: クライアントからの「利用者フォルダの表記ゆれ」質問を起点にした調査で、Driveフォルダ名が`doc.customerName`文字列のみで決まりcustomerIdを一切参照しない設計上の盲点を発見。初回実装（`/Users/yyyhhh/.claude/plans/abstract-forging-sky.md`）は`/code-review`でゲート条件自体の致命的破綻（過確定・過剰ブロック）を指摘され再設計が必要と判明。**同日中に再設計・実装完了**（承認済み計画`/Users/yyyhhh/.claude/plans/nested-fluttering-robin.md`）: ゲートを「既存の人間確定dual-read判定→未確定の場合のみ実際に同名マスターが2件以上あるかをFirestoreライブクエリで確認」の2段構成に再設計し「曖昧なものだけ止める」を徹底。設計段階のPlan agent批判的検証で、FAX複製フロー(`faxDuplication.ts`)が新ゲートを完全に迂回する致命的な穴を追加発見・根本修正（`planFaxDuplication`に`sameNameCollisionNames`除外ロジック追加）。新規`shared/customerIdentity.ts`+`functions/src/drive/customerAmbiguityGate.ts`切り出し、`useDocumentEdit.ts`は曖昧な顧客名の場合のみtouch要件を課す設計（曖昧でない場合はAC5「保存=確定」を非破壊）。Evaluator（独立コンテキスト）がAC1-5全てPASSと確認、MEDIUM指摘2件も同セッションで修正済み。**次セッションで`/code-review high`結果を確認・全4件を修正**（①FE顧客名比較のtrim漏れでBEゲートと非対称 ②customerMasters未ロード中の保存でfail-open ③別docへの切替でエラーメッセージが残留 ④監査スクリプトのtrim不整合）、回帰テスト2件追加。続けて`/codex review --uncommitted`（effort=high）で2件追加検出（P1: customerクエリ失敗時`isLoading`が`false`に戻り②のガードが再度外れる穴、`customers===undefined`判定に修正／P2: 監査スクリプトがBEのcustomerId↔name乖離チェックを未再現で過小報告するリスク、`fetchAllCustomers()`の既存データからid→nameのMapを構築し追加読込ゼロで解消）。functions unit1922+integration252件、frontend496件（回帰テスト+2）、tsc/lint双方0 errors、全PASS確認済み。PR #723・#724とも`ui-verified`ラベル付与のうえマージ済み。**decision-maker指摘**（Phase Cの案内文書送付が完了しておりkanameone/cocoroが古いコードのまま先方の接続作業に入るリスク）を受け、GitHub Actions `Deploy Cloud Functions`(kanameone/cocoro)+`Deploy Firebase Hosting`(kanameone、GHA)+手動`firebase deploy --only hosting -P cocoro`を実行、4件とも成功。Drive関連4関数(`driveExportScheduled`/`exchangeDriveAuthCode`/`onDocumentWriteDriveExport`/`retryDriveExport`)のupdateTimeがPRマージ後の実デプロイ時刻と一致することを`gcloud functions list`実測で確認、両Hosting URLもHTTP 200で疎通確認済み。dev/kanameone/cocoro全3環境への反映完了（GOAL.md進捗記録はPR #725でマージ済み）
- [x] **同姓同名ゲートのヌケモレ対応（2026-07-26、PR #727マージ・全環境反映済み）**: decision-makerから「抜け落ち・ヌケモレはなかったか」と問われ、kanameone/cocoroの実データに`check-customer-master-integrity.js`を初めて実行した結果、①監査未実施の情報ギャップ（実行するまで実数不明だった）②ADR-0022/`customerAmbiguityGate.ts`コメントの「守備範囲は同姓同名の衝突のみ」という不正確な要約（実際は顧客名未設定/sentinel値・customerId↔name乖離も含む3系統）③ヘルプマニュアルにFAX複製除外・編集確定の挙動変更説明が皆無、の3ギャップが判明。plan mode承認済み計画で対応: 監査スクリプトに理由別breakdown追加、ADR・コード3箇所（`exportDocument.ts`/`customerAmbiguityGate.ts`のコメント2箇所）・ヘルプ2箇所（`HelpPage.tsx`のDriveエラー説明・FAQ）の記述訂正、`docs/operation/user-guide.md`重複FAQも同期。`/code-review medium`+`/review-pr`（code-reviewer/comment-analyzer/pr-test-analyzer並列）で②の訂正漏れ2箇所（`exportDocument.ts`・`customerAmbiguityGate.ts`関数JSDoc）+HelpPage.tsxのDriveエラー説明の同一問題を追加検出、さらに監査スクリプトの実質バグ（マスターdocの`name`フィールド欠損時に`customerAmbiguityGate.ts`の`?? null`skip判定と乖離し「customerId↔name乖離」と誤分類）を検出・修正（`idToRawName`導入、9件の合成データ検証で修正前後の挙動差を確認）。全指摘修正後、functions unit1922件・frontend tsc/lint 0 errors、Firebase Emulator+Playwright MCPで実機確認、CI全PASS・ui-verified付与のうえマージ、kanameone/cocoro双方へFunctions+Hosting反映・ground truth確認済み。**マージ後に修正版スクリプトを再実行し確定した実数**: kanameone [D]182件の内訳=顧客名未設定/sentinel値159件・customerId↔name乖離20件・**同名衝突未確定は3件のみ**（[A]同名衝突9組のうち大半は既に人間確定済みと判明）。cocoro [D]36件の内訳=顧客名未設定/sentinel値35件・customerId↔name乖離1件・同名衝突未確定0件（[A]=0組と整合、内訳合計も両環境とも[D]総数と一致）。Phase D着手前に必要な「実際に同姓同名で人間確認が必要な書類」はkanameone3件・cocoro0件と、当初の182件/36件という数字よりはるかに小さいことが判明。**追加でPR #729（マージ・kanameoneで再実行確認済み）**: `[D]`個別一覧がFirestore取得順のままだと大量のsentinel値debtに埋もれ先頭20件プレビューに同名衝突未確定が一件も表示されない問題を発見、同名衝突未確定→customerId↔name乖離→sentinel値の優先度順にソートするよう改善。再実行結果、kanameoneの同名衝突未確定3件を特定: doc `68bfCSaIAUTY…`(customerName=「松本 実」)・`7ILXy9TvcvQ3…`(customerName=「渡辺 淳次」)・`sOfgRVSo1fcX…`(customerName=「松本 実」)。**この3件は書類詳細画面で正しい顧客を選び直す人間判断が必要**（AIによる自動判定は対象外、decision-maker/現場管理者が対応）。cocoroは対象0件
- [x] **同姓同名プロアクティブ通知UI追加（2026-07-26開始→完了）**: decision-maker質問「同名衝突未確定3件はシステム上でアラートになっているか」を発端に実装。PR #731/#732/#733/#736/#738の5PRとも マージ済み、dev/kanameone/cocoro全環境反映完了。`/code-review`3回連続未完了→自己検証+Codexセカンドオピニオン(review-diff→plan mode)で計4件のバグ(crash risk×2・trim不整合・JSDoc矛盾)を発見・修正。段階的ロールアウト(cocoro先行→kanameone)でground truth確認済み。PR-3（ヘルプ・運用ガイド・ADR-0022への追記）も完了。詳細は過去の「🔄 中断点」履歴参照（アーカイブ前提でここに要約を残す）
- [x] **表記ゆれ重複顧客マスター統合スクリプト新規実装・マージ完了（2026-07-27、PR #741）**: [D]監査の[B]表記ゆれ重複候補（kanameone10組、姓名間スペース有無等）に対し、明示的`isDuplicate`フラグがない=同姓同名の別人ではないという判断（decision-maker確認済み）のもと統合スクリプトを新規実装。純粋関数(`scripts/lib/notationDuplicateMerge.ts`)+オーケストレーション(`scripts/merge-notation-duplicate-masters.ts`)。evaluator3ラウンド+`/code-review medium`を**計11ラウンド**実施し、致命的バグ含む指摘を都度修正（isDuplicateフラグ未参照／careManager同期漏れ／複数write pathでのトランザクション再検証(customerId一致確認)適用漏れ／Phase3例外時のappliedResult不正確／バックアップJSON実態不一致／furigana食い違いを追加の安全網に採用 等）。round11で correctness バグ0件に到達した時点で、**Codexへ「このレビューループ運用自体の妥当性」をセカンドオピニオン依頼**（plan mode、MCP、effort=high）。Codexの結論「11ラウンドは安全策としては正当だが最適な品質プロセスではない、次回はplan→validate→apply→verify→auditの明示分離+統合テスト+dry-run承認+canary実行+照合を最初から設計すべき」を踏まえ、decision-maker判断でcode-reviewループをここで打ち切りマージ確定（`4229f4d1`）。**kanameone本実行完了（2026-07-27）**: dry-run（run 30256212733）で対象2組・書類5件（鬼頭京子/藤正義の表記ゆれ）を確認、件数が少数のためcanary分割を省略しdecision-maker承認で`--execute`をそのまま実行（run 30257992453）。結果は成功2組/失敗0組でdry-run予測と完全一致、書類5件付け替え・敗者マスター2件削除済み。除外8組（同姓同名候補混在/isDuplicateフラグ/furigana食い違い）は自動統合対象外のまま手動確認待ちで残存（奥村志づ子/丸山千昭/中村定子/花田重正/河合政行/後藤尚子/安藤和子/津田芳子の各ペア。うち7組はfurigana生文字列比較がスペース有無を正規化していないことによる偽陽性で読みは同一、1組(奥村志づ子)のみ実際の読み表記ゆれ(ズ/ヅ)。実害なし、緊急対応不要）。**cocoro実行完了（2026-07-27、同日）**: dry-run（run 30269258840）の結果、表記ゆれ重複候補0組・除外対象0組（過去のcheck-customer-master-integrity監査で同名衝突未確定0件だった結果と整合）。対象なしのため`--execute`は不要と判断し完了。**表記ゆれ重複顧客マスター統合ミッションはkanameone/cocoro両環境で完遂**
- [x] **PR #745・#748のkanameone/cocoro反映漏れ発見・解消（2026-07-28）**: decision-maker依頼でPR #745(PdfSplitModalモバイル対応)・#748(summaryGeneratorエラー分類)のdev検証状況とkanameone/cocoro本番反映状況をGitHub Actions実行履歴で客観検証。直近のDeploy Cloud Functions実行(2026-07-26T11:51:53Z)・Deploy Firebase Hosting実行(2026-07-27T15:15:32Z)がいずれも#748マージ(2026-07-28T02:36:33Z)より前で、#748のfunctions/src変更(summaryGenerator.ts/regenerateSummary.ts)がkanameone/cocoro未反映と判明（devは`Deploy`ワークフローのpush自動デプロイで反映済み）。decision-maker明示依頼により`gh workflow run "Deploy Cloud Functions"`(kanameone/cocoro、`gemini_model_id_override=code-default`で現行モデル据え置き)+`"Deploy Firebase Hosting"`(kanameone、GHA)+手動`deploy-to-project.sh cocoro`(cocoro Hostingは`VITE_FIREBASE_*_COCORO` Secrets未登録のためGHA非対応、既存のローカル手動デプロイ手順が正規経路)の4件を実行、全て成功確認済み。**作業中にCLOUDSDK_ACTIVE_CONFIG_NAME環境変数残留を再現**（`switch-client.sh cocoro`実行後も`gcloud auth list`/`gcloud config configurations list`がdev(`admin@fuku-no-tane.com`)のまま、`~/.config/gcloud/active_config`ファイル自体は正しく`doc-split-cocoro`に切替済み——前回セッションで報告されたkanameone側の残留と対称の現象で、双方向に起こりうることを確認）。`unset CLOUDSDK_ACTIVE_CONFIG_NAME && gcloud config configurations activate doc-split-cocoro`で是正しSA認証(`docsplit-deployer@docsplit-cocoro.iam.gserviceaccount.com`)を確立、`deploy-to-project.sh cocoro`実行後は`switch-client.sh dev`でdev環境へ復帰済み（対処法が有効であることを実証）。これによりPR #745・#748ともdev/kanameone/cocoro全3環境への反映完了
- [x] **cocoro Hosting未反映検知の自動化（2026-07-28、PR #750マージ済み・Drive Phase1本体ミッションとは別件のops改善）**: decision-maker質問「直近issue対応はprod反映まで問題なく完了していたか」への客観検証（GitHub Actions実行履歴+Firebase Hosting Releases REST APIのground truth確認）で、cocoro HostingがGitHub Actions非対応(`VITE_FIREBASE_*_COCORO` Secrets未登録)でローカル手動デプロイが唯一の経路であり、反映漏れを自動検知する仕組みがCIの外側にあった事実を発見。decision-maker合意（AskUserQuestionで閾値48時間を選定）のもと`scripts/audit-cocoro-hosting-lag.js`（frontend/最新commit時刻とcocoro Hosting最新release時刻をFirebase Hosting REST APIで比較）を新規実装し、既存`Scheduled Master Audit`ワークフロー（日次cron 06:00 JST）に`cocoro-hosting-lag`ジョブとして追加。`/code-review low`でexit 1(遅延検知)とexit 2(API障害等の実行エラー)の混同により誤ったissueが量産されうるバグを検出・修正（`steps.check.outputs.exit_code`で明示的に3値を区別）。CI全PASS確認後マージ、さらにworkflow_dispatchで手動起動し実CI環境（SA認証・Firebase Hosting API呼出）で正常完走・既存3環境監査ジョブへの影響なしを実機確認済み
- [x] **利用者フォルダ名のスペース表記ゆれ正規化（2026-07-28、PR #752マージ・kanameone/cocoro反映済み）**: クライアントからの「利用者フォルダの命名は姓名間スペースの実データパターン次第でやってみないと分からないのでは」という質問への回答ドラフトを検証する過程で、`functions/src/drive/folderPath.ts`のcustomerName/careManagerNameが`.trim()`のみで内部スペースを正規化しておらず、`findOrCreateFolder.ts`の完全一致クエリと組み合わさることで、スペース表記ゆれ（PR #741で確認済みのkanameone実例「鬼頭 京子」/「鬼頭京子」等）が`AmbiguousFolderError`にも引っかからず気づかれないまま別フォルダが作成されうる実装ギャップを発見。`resolveCustomerSegment`/`resolveCareManagerSegment`に内部スペース除去(`stripInternalSpaces`)を追加し、表記ゆれのある同一人物が常に同じフォルダ名に解決されるよう修正。folderPath.test.ts新規4件+既存25件・functions unit1969件・Drive関連integration62件(Firestore emulator)全PASS、dev実データ監査(`scripts/audit-drive-folder-space-variants.js`新設・GHA経由)でdriveFileId設定済み2件間に表記ゆれなしを確認。`/code-review low`で「別人がスペース違いのみで同一漢字名の場合に誤って同一フォルダへ収束するリスク」を指摘され、既存の同姓同名衝突検知(`findSameNameCollisionNames`)も同じくスペース非正規化で対象外だったこと（新規リスクではなく既存ギャップ）を確認した上でIssue #753として追跡、PR説明にトレードオフを明記した上でマージ。kanameone Functions初回デプロイがFirebase API側の一過性500エラーで失敗→即再実行で成功、cocoroは初回成功。dev/kanameone/cocoro全3環境への反映をgcloud/GHAログのground truthで確認済み。クライアントへの簡潔な回答（HTML+図解、余計な内部情報は非開示）を作成・送付完了
- [x] **kanameone・cocoro書類回転ブロッカー解消: genesis provenance実装（2026-07-31、PR #759マージ済み・ADR-0016 MUST 8）**: kanameone担当者から2件の問い合わせ（①Drive連携テンプレート登録後もファイルが作成されない ②一部書類の回転操作で`Document is missing provenance fields; backfill required (Issue #445 PR-D4) before rotation`エラー）を受け調査。①は`settings/features.driveExport`未設定によるバグではない仕様通りの挙動と判明（実測確認済み）。②はkanameone全11,108書類中provenance保有わずか1.9%、原因はGmail添付取込のみで完結した書類(全体95.5%)にはそもそもprovenanceを書く経路が存在しないため（本日新規取込分も全件該当、現在進行形の問題）と判明。当初検討したPR-D4 backfill本番実行は救済可能な範囲が分割由来書類のみ(全体4%)・kanameone向けGCPインフラ未整備・本番実行実績ゼロという重い投資である一方、残り96%は構造的に永久救済不可と判明したため方針転換。plan mode承認済み計画に基づき、回転時にその場で起点provenanceを実測合成する「genesis provenance」機構を実装（`functions/src/pdf/genesisEligibility.ts`新設・`createGenesisProvenance()`・`provenanceOrigin`フィールド追加）。`/code-review medium`を3回実施（1回は一時的API障害で再実行）し、1回目で「分割元doc(isSplitSource)の除外漏れ」「PdfSplitModalの回転エラー未処理reject」の2件を検出・修正、2回目で「ADR記述と実装の条件数不一致」を検出・修正、3回目で指摘0件を確認。functions unit1996件/integration254件/rules92件/frontend513件全PASS、Playwright MCP実機確認（dev環境、Firebase emulator）でエラーハンドリングの動作も確認済み。**2026-07-31、decision-maker番号単位認可によりkanameone本番デプロイ完了**（`gh workflow run "Deploy Cloud Functions"` kanameone、`rotatePdfPages`のupdateTime `2026-07-31T06:34:35Z`がPR #759マージ時刻`05:38:27Z`より後であることを確認）。実書類(`PRI96X82bU9fybK9NRL4`)での実ログイン動作確認は、decision-maker判断により「dev環境で成功していれば同一コードのprod環境も等価」として明示的に省略（本番顧客アカウントへのログイン権限がexecutor側にないため、Playwright MCP実施には別途テストアカウント提供が必要と判明した上での判断）。**kanameoneデプロイ完了後、decision-makerからの「cocoro側も大丈夫か」という質問を受けcocoroの被害範囲を能動調査**: Firestore集計クエリ（`runAggregationQuery`、`provenance.sourcePath`フィールド存在確認）でcocoro全1,188書類中provenance保有はわずか3件(0.25%)、かつcocoroのFunctions最終デプロイ`2026-07-28T07:26:21Z`はPR #759マージ前のコードと判明——kanameoneと同一の構造的問題にcocoroも晒されている実害を確認。decision-maker番号単位認可によりcocoro向けにも同一の`gh workflow run "Deploy Cloud Functions"`を実行、`rotatePdfPages`のupdateTime`2026-07-31T10:39:13Z`（PR #759マージ時刻より後）で反映確認済み。**kanameone/cocoro両環境でgenesis provenance機構が本番稼働中**。**2026-08-01、①②とも解消済みであることをログ解析（該当ログのタイムスタンプがPR #759デプロイ前と判明）・現在のFirestoreフィールド状態・専用unit/contract testで客観的に再検証**（実文書での再実行はdecision-maker判断によりコード+テスト証拠で代替、スキップ）。**kaname担当者へ回答文書（HTML、ローカル生成、リポジトリ非管理）を作成しdecision-makerが送付済み（2026-08-01）**
- [x] **kanameone Drive連携OAuth不具合対応・Phase B完了条件の教訓反映（2026-07-29）**: kanameone担当者(katsumihiraide@kanameone.com)から「Google Driveと連携する」ボタン押下後「認証コードが無効または期限切れです」と表示され連携できない旨の実機スクリーンショット付き報告を受け調査。真因は**`drive.googleapis.com`（Google Drive API本体）がkanameone/cocoro/dev全3環境で未有効化**だったこと。Phase Bで有効化していたのは`picker.googleapis.com`（フォルダ選択UI用）のみで、実データ操作用の本体APIが当初の完了条件チェックリスト（`/Users/yyyhhh/.claude/plans/witty-drifting-hoare.md`58行目）自体に含まれていなかった（Picker APIとDrive APIの混同が計画立案段階から存在）。実際の失敗メカニズムはCloud Loggingの実測ログで確認: OAuth認可コード交換自体は成功するが、後続のDrive API疎通確認(`fetchConnectedEmail`)で`Google Drive API has not been used...or it is disabled`エラー発生→汎用`internal`エラーとしてFEに返る→`frontend/src/lib/callFunction.ts`の自動リトライが**使用済み認可コードで再送**→2回目は`invalid_grant`（非リトライ対象の`failed-precondition`）となりこれが最終的にユーザー画面へ表示、という2段階のエラー連鎖だった。kanameone/cocoro/dev全3環境で`gcloud services enable drive.googleapis.com`を実行し即時解消（非破壊的操作、既存データへの影響なし）。再発防止として`scripts/setup-tenant.sh`のAPI有効化リストに`drive.googleapis.com`/`picker.googleapis.com`を追加（PR #756マージ済み、新規テナント展開時の同種の抜けを防止）。副次的に発見したリトライ設計課題（後続処理失敗時に使用済みOAuth codeで再送してしまう構造）はIssue #755として起票（P2、緊急性なし、今回の直接原因ではない）。
- [x] **Issue #755対応・完了（2026-07-31、PR #770マージ・クローズ済み）**: 積み残しIssue精査でdecision-maker選定。`frontend/src/lib/callFunction.ts`に`retryable`オプションを追加し、`exchangeGmailAuthCode`/`exchangeDriveAuthCode`の両OAuth呼び出しで自動リトライを無効化（案(a)採用）。使用済み認可コードでの誤った再送→`invalid_grant`→「認証コードが無効または期限切れです」という誤解を招くエラー表示（後続処理側の本来のエラーを覆い隠す）を根本解消。`codex review`を2回（medium/strict-config）実施しいずれも指摘0件、新規テスト4件追加（frontend全517→521件PASS）、Playwright MCPで実機確認（コンソールエラー0件、`ui-verified`ラベル付与）。
- [x] **cocoro Hosting未反映48h超過を検知・解消（2026-07-31、Issue #772クローズ済み）**: 既存の自動検知機構（line30「cocoro Hosting未反映検知の自動化」）が発火し、PR #770/#759（OAuthリトライ無効化・genesis provenance）のcocoro Hosting反映が82.5h遅延していると判明。`/deploy`スキルのcocoro手動手順で反映後、`Scheduled Master Audit`ワークフロー再実行で反映確認（lag -9.0h）。自動検知機構が実際に機能した初の実例
- [x] **Issue #753対応・完了（2026-07-31、PR #773マージ・クローズ済み）**: PR #752（利用者フォルダ名スペース表記ゆれ正規化、line31）で切り出されていた調査タスクに着手。`findSameNameCollisionNames`（同姓同名衝突検知）が内部スペース表記ゆれを別名扱いしていた点を拡張し、`stripInternalSpaces`をfolderPath.tsからshared/customerIdentity.tsへ集約・共有。`DocumentDetailModal.tsx`の候補一覧`collidingMasters`も同期（バッジ点灯と候補一覧の不整合を副次的に発見・解消）。Playwright MCP実機確認（emulator+dev、表記ゆれ2件のテストデータでバッジ・候補一覧2名表示を確認）。`codex review`でP1指摘（BE Drive export gateのライブクエリは本PR対象外でtrim-onlyのまま表記ゆれ衝突を見逃す。本PR以前からの既知ギャップで新規劣化ではないと確認）を受け、decision-maker判断で現状PRマージ→**Issue #774**（BEゲート正規化、P2・実例未確認）へフォローアップ切り出し

  **Phase B完了条件チェックリスト・修正版**（旧witty-drifting-hoare.md記載条件は「picker API有効」のみでDrive API本体の有効化確認が抜けていた。今後の新規クライアント展開・同種インフラ準備時は以下で代替すること）:
  - [ ] `gcloud services list --enabled --project=<pid> --format="value(config.name)" | grep drive.googleapis.com` で**Drive API本体**が有効化されていることを確認（**Picker API(`picker.googleapis.com`)とは別物、名称が紛らわしいため混同に注意**）
  - [ ] Picker API（`picker.googleapis.com`）有効化
  - [ ] Drive関連4関数（exchangeDriveAuthCode/driveExportScheduled/onDocumentWriteDriveExport/retryDriveExport）がACTIVE
  - [ ] Secret Manager 3件存在（client-id・secretは実値、refresh-tokenは空コンテナ）
  - [ ] compute SAへのIAMバインド4件確認済み（`gcloud secrets get-iam-policy`）
  - [ ] 各Drive関数の実際の実行SAが想定compute SAと一致（`gcloud functions describe`。get-iam-policyは意図確認に過ぎず実際の実行SAは別途要確認）
  - [ ] `functions/.env.<project-id>`のSTORAGE_BUCKETがデプロイ後に実際に反映されている
  - [ ] `settings/drive.oauthClientId`存在
  - [ ] flag OFF維持
  - [ ] **（新規）静的存在確認だけでなく、可能な範囲で実際にAPIを呼び出す動作確認を行う**: 今回のようにAPI有効化漏れは「Cloud Functionsの状態」「Secret/IAMの存在」等の静的チェックでは検出できず、クライアントが実際にOAuthフローを最後まで動かした瞬間にしか顕在化しなかった。理想はテスト用アカウントで一度OAuth接続を通すことだが、それが難しい場合は最低限`gcloud services list --enabled`の機械的突合を完了条件に含める

## 【訂正・2026-08-27】Issue #811「Part A完了」宣言の訂正+Issue #823規模確定（再オープン、remediation未着手）

下記「Issue #811 Phase B」節の「kanameone本番データ移行（Part A実行）完了」は不正確だった。Issue #823（規模の妥当性確認）の一環で`investigate-caremanager-folder-duplicate.ts`をkanameoneで再実行したところ、Part Aが根拠にした「root-duplicate再走査で実質重複0件」はrootFolderId直下のトップレベルフォルダ名重複のみを見た確認で、個々のdocumentのdriveFileIdから実際の祖先フォルダを辿ると依然として大量の破損データが残存していると判明した。

**確定した規模**（森奈穂美、`driveExportStatus=exported`729件時点）:
- 正しいフォルダに収束（正常）: 258件（35.4%）
- 古い/重複/ゴミ箱フォルダに紐づいたまま（要救済）: 183件（25.1%、Part Aのスキャン範囲=直下ファイルのみだったため見落とされた深い階層のdocument）
- Drive上に存在しない404（要救済）: 288件（39.5%）

正常な状態は35.4%のみ。Issue #811を再オープンし、[訂正コメント](https://github.com/yasushi-honda/doc-split/issues/811#issuecomment-5437480863)を追記。Issue #823にも[規模確定コメント](https://github.com/yasushi-honda/doc-split/issues/823#issuecomment-5437712394)を追記済み。

**現状**: 根本原因修正（PR #840/#842、trashed込み2段階検索）は有効で今後の新規発生は防止されている。過去に壊れた471件の遡及救済（backfill/再export等）は未着手・未設計。remediation方針の検討は別途plan modeセッションで行う。他のケアマネへの横展開有無（森奈穂美以外での同種事象）も未検証。

## 【訂正・2026-08-28】Issue #823 Phase 2a: read-only classify実行完了、「288件missing-404」は誤検出と判明

上記【訂正・2026-08-27】節の「確定した規模」（258健全/183旧フォルダ/288 missing-404）を、より正確な検出ロジックの実行結果でさらに訂正する。

**経緯**: 上記数値の算出元だった`investigate-caremanager-folder-duplicate.ts`は`drive.files.get()`の例外を全て無差別に「404の可能性」としてログしており、403/5xx等の別エラーと真の404を区別できていなかった（設計上の既知の欠陥、plan-crossreview時点で識別済み）。decision-maker承認（「read-only設計+森奈穂美の確認classifyまで」に今回のセッションのスコープを縮小）のもと、本番の`exportDocument.ts`が実際に使う`isDriveFileNotFoundError()`と同一判定ロジックで検出するclassifierを新規実装（PR #849、`scripts/lib/driveExportDriftClassifier.ts`+`scripts/classify-drive-export-drift.ts`、read-only・書き込み一切なし）。`codex review`を4回連続実施しP1×1/P2×5の実指摘を反映（うち1件は本番の`resolveDriveFile()`がparents件数に関わらず無条件で修復可能なため、`multi-parent`を個別blockedにせずmisplacedへ統合すべきという指摘）、`pr-review-toolkit:code-reviewer`セカンドオピニオンもCritical2件/Important7件を全反映。devで404/trashed/healthy各1件のfixtureリハーサルを実施し、404が`api-error`ではなく`missing-404`に正しく分類されることを実測確認してからkanameone本番へ適用（GitHub Actions run [33120381461](https://github.com/yasushi-honda/doc-split/actions/runs/33120381461)）。

**確定した規模（訂正後、森奈穂美・`driveExportStatus=exported`729件時点）**:
- healthy（正常）: 241件（33.1%）
- trashed（ゴミ箱内）: 202件（27.7%）
- misplaced（現在の親フォルダが期待値と不一致）: 139件（19.1%）
- missing-404: **0件（0%）** ← 旧報告の288件は誤検出だったと確定
- blocked: target-path-not-created（driveFileIdは生存・非trashedだが期待配置先フォルダがDrive上に未作成のため判定不能、実質misplacedに近い性質）: 147件（20.2%）

`wouldRestoreFolders`（修復実行時にゴミ箱から復元されうるフォルダ）は0件。Issue #823へ[訂正コメント](https://github.com/yasushi-honda/doc-split/issues/823#issuecomment-5445772707)を追記済み。

**今回のセッションのスコープはここまで**（decision-maker明示選択）。write/execute実行（修復）・全ケアマネへの横展開（Phase 3）・cocoroへの適用（Phase 4）は未着手。計画: `~/.claude/plans/sharded-mapping-squid.md`（「codexレビュー由来の設計修正」節に執行フェーズ実装時の必須反映事項を記録済み）。

## 【完了・2026-08-28】Issue #811/#823 remediation Phase 2b-1: execute-drive-export-repair.ts実装・PR #851マージ・devリハーサル完了

decision-maker明示承認（「ctxは余裕あります。提案内容について続けることは可能ですか？」）を受け、上記Phase 2a classify結果（森奈穂美729件中488件=trashed202+misplaced139+blocked:target-path-not-created147が要修復）を実際に修復する`execute-drive-export-repair.ts`をplan mode経由で設計・実装した。

**plan-crossreview（grip自白×codex 2巡、`~/.claude/plans/sharded-mapping-squid.md`）でHigh指摘多数**（misplaced修復パスがStorage内容を無条件にDrive側へ上書きするため、Drive上での人間による直接編集があれば無言で破壊されうる懸念等）。decision-maker確認: kanameone/cocoroスタッフはエクスポート済みファイルをDrive上で直接手編集しない運用のはず（断定ではないため、Drive側modifiedTimeがdriveExportedAtより新しい場合は候補から除外する防御ロジックをD9として追加）。decision-makerから明示的マンデート「絶対に今回でなんらかの対応をします。今日はこれで終わりにはなりません」を受け、クロスレビュー指摘を全て設計へ反映したうえで実装に進んだ。

**実装・quality gate**: pure-logic層`scripts/lib/driveExportRepairTargets.ts`（対象抽出D3・plan鮮度ゲートD10・手編集検知D9・drift再検証`isNowHealthy()`等）+本体`scripts/execute-drive-export-repair.ts`（dry-run既定・pre-flight検証・サーキットブレーカー・原子的manifest書き込み）。`codex review --base main -c model_reasoning_effort=medium`を**5巡**実施し収束: 1巡目GHA未配線+`tagRepairError()`結果のFirestore未反映／2巡目ファイル未検出偽陽性(未staged起因、`git add`で解消)／3巡目`blocked[target-path-not-created]`候補がStorage確認ガードを迂回できる穴／4巡目**classify〜execute間に対象documentが既に修復済み(healthy)になっていた場合、live Drive状態を再検証せず無駄な再書き込みをしてしまう穴**（`isNowHealthy()`追加で解消）／5巡目指摘0件。unit test 34件・Firestore emulator integration test 32件（実装分17件含む）全PASS。`.github/workflows/run-ops-script.yml`にGHA実行経路（dry-run/execute×limit/expected-count、classify plan artifactのdownload込み）を配線。

**devリハーサル（doc-split-dev、実Drive/Storage）**: `setup-drive-folder-fixture.ts --repair-scenario`でhealthy/trashed/missing-404の3fixture投入→classify(scanned=3, healthy=1/trashed=1/missing404=1、想定通り)→dry-run(候補2件、healthy除外を確認)→`--execute`(attempted=2 repaired=2 failed=0、manifestに旧/新driveFileIdが正確に記録)→修復後classify再実行でhealthy=3を確認→**同一planで`--execute`を再実行し、両document とも「既にhealthyのためスキップ」と正しく判定されることを実機確認**（4巡目で追加した`isNowHealthy()`の実機検証、冪等性が実証された）。fixtureは`--cleanup`で削除済み。

**PR #851**として`feat/issue823-drive-export-repair-execute`ブランチからmainへマージ完了（squash、8f401fd7）。

**本番(kanameone/cocoro)への実際の書き込み実行(canary含む)は本Phase 2b-1の範囲外のまま**。plan Phase 2b-2（`--limit 10`でのcanary実行→canary対象への`classify-drive-export-drift`再実行によるhealthy遷移確認→decision-maker確認のうえ残り全件実行）は別途、番号単位の明示認可を得てから着手する。全ケアマネへの横展開（Phase 3）・cocoroへの適用（Phase 4）・執行後の記録（Phase 5: ADR-0022更新・GOAL.md記録・Issue #811/#823クローズ検討）も未着手。kanameone担当者への報告文書（「修復メカニズムの実装・検証が完了し、実行待ちの状態」）は本セッションでは未作成（次アクション候補）。

## 【完了・2026-08-28】Issue #811/#823 remediation Phase 2b-2: kanameone本番書き込み実行完了（森奈穂美、healthy 33.1%→98.8%）

decision-maker明示承認（AskUserQuestion「kanameone本番canary実行に進む」）を受け、plan Phase 2b-2の手順通りに本番書き込みを実行した。

**手順と結果**（すべてGitHub Actions `Run Operations Script`経由、kanameone環境）:
1. **classify再実行**（run [33142574732](https://github.com/yasushi-honda/doc-split/actions/runs/33142574732)、鮮度確保のためPhase 2aのplanを使い回さず再取得）: `scanned=762 healthy=273 trashed=202 misplaced=144 blocked:target-path-not-created=143`（要修復489件、`wouldRestoreFolders`0件）
2. **canary実行**（run [33143014553](https://github.com/yasushi-honda/doc-split/actions/runs/33143014553)、`--limit 10 --expected-count 10`）: `attempted=10 repaired=10 failed=0`
3. **canary検証**（run [33143254512](https://github.com/yasushi-honda/doc-split/actions/runs/33143254512)、`classify-drive-export-drift`再実行）: canary対象10件のdocIdを個別に照合し、全件`category=healthy`への遷移を確認（plan-crossreview codex High#4指摘対応の検証ステップ、実機で機能）
4. **残り全件実行**（run [33143783783](https://github.com/yasushi-honda/doc-split/actions/runs/33143783783)、同一plan・`--expected-count 489`・`--limit`なし）: `attempted=476 repaired=476 failed=0 skippedDrift=5 skippedPossibleManualEdit=8`（canary分含め累計失敗0件）。所要時間約47分（1件あたりDrive API呼び出し込みで平均約6秒）
5. **最終検証classify**（run [33146215032](https://github.com/yasushi-honda/doc-split/actions/runs/33146215032)）: `scanned=764 healthy=755(98.8%) trashed=1 misplaced=8 blocked:target-path-not-created=0`

**skippedPossibleManualEdit=8件（D9の手編集検知ロジックが発動、実行対象から除外）**: このうち7件（misplaced）は2026-08-14T03:09:00〜03:09:15という15秒以内の極めて狭い時間帯にDrive側`modifiedTime`が集中しており、個別の人為編集というよりバッチ処理的な痕跡に見える。1件（trashed）は2026-08-03T07:20:44。git履歴に該当時期の関連コミットなし、原因は未特定のまま。**設計通り「疑わしきは触らない」でfail-closedに除外された結果であり、実害はない**（修復されず現状維持のまま。原因調査・対応要否はdecision-maker/kanameone側の人間判断に委ねる）。最終検証classifyの`misplaced=8`/`trashed=1`はこの8+1件とほぼ一致しており、意図通りの結果。

**関連PR**: なし（コード変更は伴わない実行フェーズ、Phase 2b-1のPR #851で完結済み）。

## 【完了・2026-08-28】Issue #811/#823 remediation Phase 3: kanameone全ケアマネへ横展開（healthy 60.8%→99.0%）+ Phase 4: cocoroは対象外と確定 + Phase 5完了

Phase 2b-2完了後、decision-maker指示「今できる事はありますか？」を受け、森奈穂美以外のケアマネで同種の破損が無いかをread-only（`classify-drive-export-drift --care-manager`指定なし=全ケアマネ対象）で確認したところ、**kanameone16人のケアマネ全員に同種の破損が広がっている**ことが判明した（scanned=4245、healthy=2580=60.8%のみ。森奈穂美は今回の修復で764/776=98.5%健全化済みだったが、他15人は軒並み正常率50〜70%程度）。当初の想定（森奈穂美固有の問題）を覆す規模の発見であり、decision-maker承認を得てその場でPhase 3（kanameone全体への横展開）に着手した。

**手順と結果**（すべてGitHub Actions `Run Operations Script`経由、kanameone環境）:
1. **全体classify**（run [33158267872](https://github.com/yasushi-honda/doc-split/actions/runs/33158267872)、`--care-manager`省略でテナント全体対象）: `scanned=4245 healthy=2580 trashed=18 misplaced=611 blocked:target-path-not-created=1015`（他blocked21件除く）
2. **全体dry-run**（run [33160629731](https://github.com/yasushi-honda/doc-split/actions/runs/33160629731)）: 候補1644件確定、storage未確認による除外0件
3. **canary実行**（run [33160835936](https://github.com/yasushi-honda/doc-split/actions/runs/33160835936)、`--limit 10`）: **D7ゲート発動、exit 1で書き込みゼロ停止**。森奈穂美単独の時と異なり、`wouldRestoreFolders`が3件（ゴミ箱内フォルダ「未判定」×2・「ケアプラン」×1、影響document計4件）非空だったため。decision-makerへ内容を提示し、AskUserQuestionで復元の明示承認を取得
4. **canary再実行**（run [33162398461](https://github.com/yasushi-honda/doc-split/actions/runs/33162398461)、`--acknowledge-restore-folders`付与）: `attempted=10 repaired=10 failed=0`
5. **canary検証**（run [33162657395](https://github.com/yasushi-honda/doc-split/actions/runs/33162657395)）: canary対象10件全件`healthy`遷移を個別docId照合で確認
6. **残り全件実行**（run [33164719730](https://github.com/yasushi-honda/doc-split/actions/runs/33164719730)、同一plan・`--expected-count 1644`・`--limit`なし）: `attempted=1613 repaired=1613 failed=0 skippedDrift=10 skippedPossibleManualEdit=21`（累計失敗0件）。所要時間約3時間15分（1613件、平均約7.2秒/件）
7. **最終検証classify**（run [33178487794](https://github.com/yasushi-honda/doc-split/actions/runs/33178487794)）: `scanned=4257 healthy=4213(99.0%) trashed=9 misplaced=11 blocked:target-path-not-created=3`（他blocked21件は元々対象外のまま）

**skippedPossibleManualEdit=21件（D9発動、実行対象から除外）**: 森奈穂美分の8件を含む形で全体では21件。日付は2026-08-03/08-04/08-05/08-12/08-14/08-16の複数日に分散し、多くが数秒〜数十秒以内の小さなクラスタ（例: 08-16T00:00:09〜00:00:35の3件）を形成している。うち2026-08-16T00:00台のクラスタについてCloud Loggingを追加確認したが、同時刻に稼働していたのは通常の`processocr`/`checkgmailattachments`の毎分ポーリングのみで、Drive export関連のCloud Function実行は一切見つからなかった（森奈穂美分8件で先に確認した結果と同じ結論が別クラスタでも再現）。**doc-split側の処理では説明がつかない=Drive側の外部要因の可能性が高いという結論を複数クラスタで補強**。これ以上の特定にはGoogle Workspace管理者監査ログが必要なため調査は打ち切り、21件は安全側に未修復のまま保留。

**Phase 4（cocoro）は対象外と確定**: cocoro向けにも同じread-only classifyを実行（run [33164998116](https://github.com/yasushi-honda/doc-split/actions/runs/33164998116)）したところ、`settings/drive`のrootFolderId/templateが未設定でエラー終了。**cocoroはGoogle Drive連携自体を未接続**（Phase C未完了、既知の状態）のため、そもそもDrive書き出しが一度も発生しておらず、今回の問題とは無関係と確定した。

**Phase 5（ADR-0022更新・Issue #811/#823クローズ）は本Phase 3着手前に完了済み**（PR #854、Issue #811/#823クローズコメント参照）。Phase 3の結果を反映したADR追記・GOAL.md記録の追加更新は本セクション自体で対応。

**kanameone担当者への報告文書は、本Phase 3の発見（森奈穂美固有ではなくテナント全体の問題だった）を反映して書き直しが必要**（Phase 2b-2完了時点で作成した`brief-20260828-drive-repair-report.html`は森奈穂美限定の内容のまま、送付前に要更新）。

## 【完了・2026-08-27】Issue #811 Phase B: kanameone森奈穂美フォルダ重複の根本原因修正+データ統合(PR #838〜#844)

kanameoneのケアマネフォルダ「森奈穂美」が物理6重複(active1+trashed5)していた根本原因（`functions/src/drive/findOrCreateFolder.ts`が`trashed=false`固定検索のため手動ゴミ箱移動を「存在しない」と誤判定し新規作成し続ける）を修正し、既存重複データを統合。4回の独立診断(grip+codex計4回)で承認された計画（Issue #432の collision-migration フレームワーク流用）に基づき実装。

**Part A（データ移行フレームワーク・PR #838/#839）**: `folder-merge-plan-v1`スキーマの classify/execute/rollback スクリプト群を新規実装（schemaVersion照合・precondition drift検知・2-phase preflight・冪等性）。devリハーサルで重大回帰を発見・修正: ①Google Drive APIの`trashed`フィールドは祖先フォルダ経由で継承されるため「ファイル自身がtrashed」の判定に使えず、Drive v3の`explicitlyTrashed`フィールドに訂正 ②「統合済み」リネームと再実行時のdrift検知ゲートが誤って衝突する相互作用バグを解消。

**kanameone本番データ移行（Part A実行）**: classify（5つのtrashed重複フォルダから58ファイルをスキャン、全件ConfirmedMatch）→canary4件→本実行54件、計58件成功・error 0件。5つの重複フォルダを「森奈穂美 (統合済み_20260826)」へリネーム統合。

**Part B（根本原因コード修正・PR #840→回帰発覚→PR #842で訂正）**: `findOrCreateFolder.ts`をtrashed込み検索に修正しPR #840としてkanameoneへデプロイした直後、**別の顧客「大橋のぶ子」配下の「報告書」フォルダで新たな回帰を発生**（active 1件+無関係なtrashed残骸1件という、旧コードでは無害に解決できていたケースを誤って`AmbiguousFolderError`にしてしまった）。即日、検索を2段階（まずactiveのみ→0件時のみtrashed込みで再検索）に訂正するPR #842を作成、codex review(2回、findings 0件)+code-reviewerセカンドオピニオン(HIGH1件+MEDIUM2件を追加対応、Part A専用`childFolderResolver.ts`の同型バグ修正+テスト新設)を経てマージ・kanameoneへ再デプロイ。実際に失敗していたdocument(`CaHY72YWfJjR1qZPG6M5`)を専用ops script(PR #843/#844)で本番リトライし、`success=true, status=exported`を確認。

**教訓（重要）**: 「無条件でtrashed込み検索にする」という一見自然な修正が、Drive API のtrashed継承・過去の整理残骸の存在という実データの複雑さを見落とし、同日中に別の実害を生んだ。フィルタ条件を緩める修正は、その条件が過去に無害に働いていた別のケースを壊しうることを前提に、実データでの検証を経てから展開する必要がある。

**関連PR**: #838 #839 #840 #841(調査用`--list-children`追加) #842 #843 #844。Issue #811はPR #840マージ時点(`Closes #811`)で自動クローズ済みだったため、完全な経緯（回帰発覚〜本番検証まで）を[issueコメント](https://github.com/yasushi-honda/doc-split/issues/811#issuecomment-5434070242)として追記済み。ADR-0022 Decision 4を2段階検索設計+回帰の経緯で更新済み。

## 【完了・2026-08-05】kanameoneからの相談3件対応（①②③完了、全環境反映済み）

kanameoneから3件の相談（①Google Drive出力フォルダをカテゴリ名で分類してほしい、②書類編集後に担当CM別・利用者別グループ表示が不安定、③特定PDFで記入文字が消える）が届き、triage→調査→実装→検証→デプロイまで対応した。

**①Drive出力フォルダのカテゴリ名分類（完了、PR #795）**: `functions/src/drive/exportDocument.ts`の`documentCategory`セグメントが実際には`doc.documentType`（書類種別）を渡しておりUI表示（「書類カテゴリ」）との意味的ギャップがあった問題を修正。codex review 3ラウンドを経てP1指摘2件（date segmentの`onlyForCategories`判定が書類種別名で運用されているため`documentCategory`表示値の変更に巻き込まれる回帰／`doc.category`はOCR時点のスナップショットで手動訂正に追従しない）を解消し、`documentCategory`（表示名）と`documentType`（date判定専用）を`FolderPathDocInput`で分離、export実行時点で`masters/documents/items`を都度解決する設計に変更。unit 31件+integration 38件PASS、dev環境で実際にDrive exportをトリガーしフォルダ階層を視認確認（`documentCategory`と`documentType`が異なる書類でも両方が正しく機能することを実証）。kanameone・cocoro両本番へFunctionsデプロイ完了、4関数のupdateTimeで反映確認済み。

**②担当CM別・利用者別グループ表示の不安定化（完了、PR #796、Issue #793クローズ済み）**: `useDocumentEdit.ts`の`saveChanges()`が保存後に`['documentsInfinite']`/`['document', id]`のみinvalidateしており、グループ表示が使う`['documentGroups']`/`['groupDocuments']`/`['groupStats']`が漏れていた（`useReprocessDocument`の既存パターンでも`groupStats`が漏れていたため併せて修正）。TDD Red→Green、frontend全519件PASS。dev(CI自動)・kanameone(Deploy Firebase Hosting、GHA)・cocoro(firebase deploy --only hosting手動)の全3環境へ反映完了。

**③特定PDFで記入文字が消える（完了、PR #798、Issue #794クローズ済み）**: 根本原因はpdf.js既知バグ（[mozilla/pdf.js#19954](https://github.com/mozilla/pdf.js/issues/19954)、`/FontDescriptor`に`/FontName`が無いType3フォントでフォント読込が失敗しグリフが描画されない）と特定。個人情報を含まない合成Type3フォントPDFを生成し、Playwright MCPで`pdfjs-dist` 4.8.69での再現（コンソール警告・ピクセルレベル両方）と5.4.296（PR#19955で修正済み）での解消を機械的に確認。`react-pdf` 9.2.1→10.4.1へアップグレードし（内包`pdfjs-dist`が4.8.69→5.4.296）、workerSrcもCDN実行時取得からViteのローカルバンドルへ変更。OCR側は別途GitHub Actions（`verify-type3-ocr`）でVertex AI Gemini（`gemini-3.5-flash`）が同フィクスチャを問題なく読み取れることを確認し（3/3成功）、「OCR分析にも失敗する」というIssue本文の記述はフロントエンド表示不具合との混同と判断、サーバー側ラスタライズは実装不要と結論。`codex review`+セカンドオピニオンエージェントの両方が指摘した回帰テストの`console.warn`未捕捉を修正・再検証済み。frontend全520件PASS、CI全PASS、`ui-verified`ラベル付与のうえマージ完了。**マージ直後はdevのみ反映（kanameone/cocoro Hostingの直近デプロイがPR #798マージ時刻より前と判明）で本番未反映のギャップがあったが、2026-08-05中にdecision-maker承認のうえ両クライアントへ反映**: kanameoneはGitHub Actions「Deploy Firebase Hosting」実行（success、マージ後の再デプロイと確認済み）、cocoroは`/deploy`スキル手順の手動デプロイ（`firebase deploy --only hosting -P cocoro`、後片付けチェックリスト確認済み）で対応。これによりkanameoneからの相談3件（①②③）は全てdev/kanameone/cocoro全3環境への反映が完了。

## 【完了・2026-08-05】②の再発防止策としてグループ表示キャッシュinvalidateを横断修正（PR #802）

decision-makerから「クライアント指摘で初めて分かる問題を今後無くしたい」と相談を受け、②(Issue #793)の根本原因(React Queryキャッシュinvalidate漏れ)が他にも同型で残存していないか調査。過去の同種インシデント(2026-02のqueryKey不一致修正)も踏まえ、以下4箇所に独立して同じ漏れが現存していると判明: `useReprocessDocument`(groupStats欠落)・`useUpdateDocument`(グループ系全欠落)・`useReprocessError`(document本体+グループ系全欠落)。さらに`codex review`後のセカンドオピニオン(`pr-review-toolkit:code-reviewer`)が`DocumentsPage.tsx`の`handleBulkReprocess`(一括再処理、confidence 93)・`handleBulkDelete`/`DocumentDetailModal.tsx`の`handleDelete`(confidence 84)にも同型の漏れを追加発見。共通ヘルパー`invalidateDocumentAndGroupQueries`/`invalidateGroupQueries`を`useDocuments.ts`に新設し計6箇所を一本化。`pr-review-toolkit:pr-test-analyzer`の指摘(rating 8、バグの本丸2箇所`useReprocessDocument`/`useUpdateDocument`にrenderHookベースの検証テストが皆無)を受け回帰テストも追加。`codex review`は初回(medium)→large tier再判定によるhigh effort再実行→修正反映後の再実行の計3回すべて指摘0件。frontend全526件PASS。Firebase Emulator+Playwright MCPで実機確認（担当CM別グループビューで再処理・削除の両方を実行し、ページリロードなしで統計・グループ内訳がリアルタイムに正しく更新されることを確認、`ui-verified`ラベル付与）。PR #802マージ後、kanameone(GitHub Actions)・cocoro(`/deploy`スキル手動手順)へ即日デプロイ完了。`DocumentsPage.tsx`/`DocumentDetailModal.tsx`は既存のテストファイル自体が存在しない構造的ギャップがあり、本PRのスコープでは新規テスト基盤構築は見送り(コード修正のみ)。

## 【完了・2026-08-06】Issue #503実装（sanitize drop reason付与、PR #808）+ #251/#238 ROI判断・#774既完了確認

catchup後、積み残しIssueのうちdecision-maker選定の#774(BE Drive export gateの表記ゆれ正規化)へ着手しようとしたところ、**#774は既にPR #800(2026-08-06)でコード改修なしの調査結論として対応完了済み**（`customerAmbiguityGate.ts`にコメント追記のみ）と判明、追加作業不要と確認。

続けて#503(sanitize droppedIdsにdrop reason付与、observability改善)を軽量インラインプランで実装: `sanitizeMasterData.ts`の3サニタイザ(customer/office/document)が`droppedEntries: {id, reason: 'invalid-type'|'empty-name'}[]`を返すよう拡張、既存`droppedIds`は`droppedEntries`から導出する後方互換フィールドとして維持（`scripts/compare-*.ts`等の既存callerは無改修）。`loadMasterData.ts`の`reportSanitizeDrops`のwarn/safeLogErrorメッセージにreason内訳を追加（例: `offices: 3/450 (invalid-type: 1, empty-name: 2; ids: id1, id2, id3)`）。TDD Red→Greenで新規テスト7件追加、functions全体2027 passing（回帰なし）、tsc/lint 0 errors、`codex review --base main -c model_reasoning_effort=medium` findings 0件。PR #808作成→CI全PASS→マージ・Issue #503クローズ済み。

**#251(summaryGenerator runtime unit test)・#238(force-reindex孤児posting検出)は着手見送り**: 両方とも該当Issue本文に明示的な待機条件が記載されている（#251はsinon/proxyquire未導入によるVertex AI mock化コストが伴うため「他タスクでバンドル化するまで待機」、#238は実害未観測のP2でトリガー未発火）。decision-makerに状況を説明しROI判断を委ねた結果、両方とも今回は見送りで合意。

**kanameone/cocoro反映状況（実測確認）**: PR #808はmain→dev自動デプロイのみ完了、**kanameone/cocoroへは未反映**（`Deploy Cloud Functions`workflow_dispatchが必要）。直近のクライアント環境デプロイは2026-08-06 03:05(kanameone)/03:13(cocoro)のPR #804(sweep starvationバグ修正)時点で止まっている。#503自体はobservability向上のみで本番挙動に影響しないため、decision-maker判断で即時デプロイは見送り、次回の`Deploy Cloud Functions`実行時に他の変更とまとめて反映する方針。

## 【完了・2026-08-26】kanameoneクライアントフィードバック8件対応（Issue対応8/8完了、kanameone/cocoro本番反映も完了）

kanameoneから8件のフィードバック（①TOP画面のCM表示 ②「不明」「不明顧客」表記の不統一 ③複数名FAX分割時の元データ残存 ④PDF複数アップロード不可 ⑤ローディング時間 ⑥ケアマネフォルダ重複 ⑦日付フィルタに今日/昨日追加 ⑧氏名異体字マッチング）が届き、triage→Issue #810〜#817起票→P1優先（decision-maker承認）で対応中。

**Issue #810（検索インデックスのsplitドキュメント漏れ、PR #818マージ・dev/kanameone/cocoro全反映完了）**: FAX分割元の複合ドキュメント（他利用者情報が混在）が`status:'split'`に変更されるのみで検索インデックスから削除されず、検索結果に露出し続けていた問題。`searchDocuments.ts`にstatusフィルタ追加＋`searchIndexer.ts`のトリガーロジックを`processSearchIndexTrigger`として切り出し状態遷移時にインデックス削除するよう修正。`codex review`で2件指摘（キャッシュ無効化漏れ・df二重減算）を受け同PRで解消。

**Issue #811（kanameoneケアマネフォルダ重複、Phase A調査完了・close済み）**: 実データ調査の結果、当初仮説（コード側の表記ゆれ未対応）はPR #752（2026-07-28マージ）で既に修正済みと判明。実データはcareManagerName「森 奈穂美」（姓名間スペース）に統一されており生データの表記ゆれは無い。plan-crossreview（grip+codex 2巡）で「documentの直接親フォルダはケアマネ階層と異なる（顧客名/書類種別/年月が最下層）ため単純比較では判定できない」という設計上の欠陥を発見、Phase A（Drive API直接調査スクリプト）の設計を訂正。`scripts/investigate-caremanager-folder-duplicate.ts`を実装（PR #822、`codex review`3件+`pr-review-toolkit`セカンドオピニオン反映済み。同一の祖先メタデータ取得バグを両者が独立検出、収束シグナルとして扱えた）し、GitHub Actions経由でkanameone実Driveフォルダ構造を調査。**初回実行は`docsplit-cloud-build@docsplit-kanameone`ビルドSAにDrive OAuthシークレット(`drive-oauth-*`)へのSecret Manager読み取り権限が無く403で停止**（decision-maker承認を得て、3シークレット限定で`roles/secretmanager.secretAccessor`を付与してから再実行）。**結果**: 対象704件のうち物理チェック成功175件は全て単一の祖先フォルダID（現在のロジックが解決する"期待フォルダ"と完全一致）に収束、フォルダ重複は検出されず。Issue #811はこの結果を添えてclose。**副次的に判明**: 残り529件（75%）はdriveFileIdがゴミ箱内（260件）またはDrive上に存在しない（404、269件）で物理チェック不能。フォルダ重複とは別種の事象・規模が大きいため[Issue #823](https://github.com/yasushi-honda/doc-split/issues/823)として新規起票（未着手）。

**Issue #812（氏名異体字マッチング、PR #820マージ・dev/kanameone/cocoro全反映完了）**: 顧客マスタ登録時はFE側`GAIJI_MAP`で新字体へ自動変換される（渡邉→渡辺等）が、OCRマッチング側にはこの変換がなくFAX原文の異体字表記が不明顧客化していた。fuzzy matchは日本人氏名の一般的な長さでは異体字1文字差を閾値調整では救済できない構造的限界があり実測不要と判断、正規化での対応に。`GAIJI_MAP`を`shared/gaijiMap.ts`へ移設し顧客名マッチング専用`normalizeCustomerNameForMatching()`を新設（汎用`normalizeForMatching()`は不変、`shared/officeMasterValidation.ts`の独立コピーとの同等性契約を壊さないため）。plan-crossreviewで当初案「汎用関数に混ぜる」設計の重大な欠陥を事前発見・修正できた。`codex review`は1回目usage limit中断→再実行で指摘0件。dev検証はビルド成果物（`functions/lib`）を直接requireして実証（ts-node直接呼び出しは「デプロイ済みコードの検証にならない」というcodex指摘を踏まえた対応）、`shared/`が`functions/lib/shared/`へ正しくコンパイルされ相対import解決も実証済み。

**P2の5件（Issue #813/#814/#816/#817/#815）はいずれも軽量プラン（#815のみ5ファイル以上に該当せずインライン軽量プランで対応、実装は配列化を伴う中規模改修）でmainへマージ済み**。**訂正の経緯（2026-08-26）**: マージ直後、本節に「全環境反映済み」と誤記載した（decision-maker指摘を受け`gh run list`とHosting応答ヘッダーの`last-modified`を実測したところ、直近の`Deploy Firebase Hosting`実行は2026-08-05が最後で当時は未反映と判明。詳細: `~/.claude/memory/feedback_completion_declaration_needs_fresh_verification.md`の2026-08-26追記）。その後、decision-maker承認のうえ実際にデプロイを実行:
- **kanameone**: `systemkaname@kanameone.com`のFirebase CLIセッションが期限切れでローカル`deploy-to-project.sh`のアカウント一致チェックがブロックするため、GitHub Actions `Deploy Firebase Hosting`（SA鍵認証、kanameone専用）をworkflow_dispatchで実行（run 32954403966、`completed/success`）
- **cocoro**: GitHub Actions未対応（Hosting用SecretsがVITE_FIREBASE_*_COCORO側に未登録のため、既存のローカル手動手順が正）のため、`frontend/.env.cocoro`→`.env.local`→`npm run build`→`firebase deploy --only hosting -P cocoro`をhy.unimail.11@gmail.comで手動実行、後片付け（`.env.local`削除）まで完了
- **実測確認**: 両ホスティングの応答ヘッダー`last-modified`が`kanameone: 2026-08-26T09:43:06Z` / `cocoro: 2026-08-26T09:42:59Z`とデプロイ実行時刻に一致することを確認。P2の5件が両クライアント本番へ反映されたことをここで確定する
- **Issue #814（PR #825）**: SearchBarの書類種別「不明」表示が`'不明'`のハードコード文字列で、`shared/types.ts`の`CONSTANTS.FILE_NAME_UNKNOWN_DOCUMENT`（'不明文書'）と不統一だった問題を共有sentinel定数へ統一
- **Issue #817（PR #827）**: `DateRangeFilter`の期間プリセットに「今日」「昨日」を追加。月初1日の「昨日」が前月末日へ正しく解決することを含む回帰テスト3件追加
- **Issue #816（PR #828）**: TOP画面統計取得が`getDocs()`による全件フェッチ（`processed`ステータスが増えるほど不要な通信コスト増）だったのを、既存の`useDistributionSiblingCount`と同型の`getCountFromServer()`集計クエリへ置換
- **Issue #813（PR #829）**: TOP画面(書類一覧)の顧客名セルに担当CM（ケアマネジャー）を併記。新規テーブル列は追加せず（lg/1024px幅制約の既存コメント#424参照）、顧客名の下に小さく表示する設計
- **Issue #815（PR #830、PDF複数ファイル同時アップロード）**: `PdfUploadModal.tsx`の状態モデルを単一ファイルから配列(`FileUploadItem[]`)へ全面再設計。5ファイル以上の変更に該当しplan mode→`/plan-crossreview`（grip自白可視化+codex 2巡診断）を実施。1巡目で「バッチ実行中の二重起動」「同名ファイル2件の代替名衝突」「onSnapshot終端未解除」等4件のHigh指摘を反映後、2巡目でさらに「claimedFileNamesが通常アップロード行の元ファイル名を予約対象に含めていない」「isBatchRunningの適用範囲が行単位操作(別名で保存/再試行)に及んでいない」という設計上の穴を発見・修正（`isAnyUploadInFlight`という単一の排他ロックへ統合、`claimedFileNames`を`Set`から`候補名→行ID`の`Map`へ変更）。別タブ/別ユーザー間の最終名衝突（BE契約変更が必要）とOCR完了通知の早期クローズ後喪失（既存30秒ポーリングで実質解決済みと判明）の2件はスコープ外として明記。実装後の`codex review`でさらに1件（別名で保存の確定リクエスト失敗時に`claimedFileNames`の予約が解放されず他行が永久にブロックされる）を検出・修正、`pr-review-toolkit`セカンドオピニオンが独立に同修正の正しさを確認。新規テスト17件・既存556件（回帰なし）・実機確認（Playwright MCP、実機確認中に「処理完了」表示の二重描画バグを追加発見・修正）済み

**スコープ外として明示的に切り出した項目（次のアクション候補）**:
- 既存の「不明顧客」滞留ドキュメントへの遡及的救済（新規OCR分のみ救済、過去分は`customerConfirmed:true`保護により単純な再OCRでは安全に再マッチできず別途設計が必要）
- `ocrUpdatePayloadBuilder.ts`の`customerConfirmed`フラグ不整合（bestMatch nullでもconfirmed:trueになりFE `isCustomerConfirmed()`が誤表示する実害あり）→別Issue化を提案済み、未起票
- Issue #815の別タブ/別ユーザー間の最終ファイル名衝突（BE契約追加が必要、実害は表示名重複のみでdocIdはユニーク）→対応せず明示スコープ外
- Issue #823（kanameone driveFileIdの75%がゴミ箱/404/誤配置、Issue #811調査の副次的発見）→2026-08-28にread-only classify実行完了(PR #849)、確定内訳=healthy 33.1%/trashed 27.7%/misplaced 19.1%/missing-404 0%(旧報告288件は誤検出)/blocked 20.2%。remediation(write実行)未着手（詳細は上部「【訂正・2026-08-28】」節参照）

**副次的に解消**: 本ミッションのkanameone/cocoro Functionsデプロイ実行時に、以前から未反映だったPR #808（sanitize drop reason付与、line68参照）も同時に反映された。

**手法上の教訓**: 本ミッションは5ファイル以上の変更を含むためplan mode必須のケースで、`/plan-crossreview`（grip自白可視化+codex 2巡診断）を計2回実施。1回目で「汎用正規化関数へのGAIJI混入」という重大な設計欠陥、2回目で「dev→prod展開フローの欠落」（decision-maker指摘で発覚）と「#811判定ロジックの欠陥」を発見でき、実装前の段階でのクロスレビューが高い価値を発揮した。

**追記（2026-08-27）**: Issue #811の真の根本原因（下記「Issue #811 Phase B」節参照）修正・全環境反映完了を受け、8件全体の状況をhtml-briefスキルで非エンジニア向けレポート化（①④⑥⑦⑧の5件が対応・反映完了、②③⑤の3件は対応は入れたがご要望の本質を満たすかは未検証）し、decision-makerが先方（kanameone）へ送付済み。**②③⑤の3件は先方からの反応待ち（trigger）**。返信があれば内容次第で追加対応を検討する。

## 【完了・2026-08-02】OCR処理タイムアウト予防策（processOCR実行時間予算再設計）

kanameone健全性レポートで発覚した書類1件のOCRタイムアウトエラー（`Px4myB4Y3t7jCFZSqS5J`、71ページPDF、"Processing timed out, max retries exceeded (5/5)"）を発端に、decision-makerの「今後予防可能か」という質問を受けて調査・plan mode承認済み計画（Step0実測→PR1計測ログ→PR2タイムアウト値引き上げ→PR3後処理軽量化）で予防策を実装、kanameone本番デプロイ・実機検証まで完遂。

- **Step0実測（read-only）**: kanameoneの`processOCR`の`maxInstanceRequestConcurrency`が明示未設定（デフォルト80）であることを発見。「実行中は1分tickがスキップされる」という既存コードコメントの前提が厳密には成立していない可能性を示唆する実測結果（`concurrency:1`明示設定は副作用検証が必要なため今回はスコープ外、ADR-0023に記録）。マスター件数実測: customers 1,352件/offices 981件/documentTypes 132件
- **PR #780（マージ済み）**: `processDocument`にフェーズ別処理時間の構造化ログ（`phaseTimings`/`phaseTimingsPreCommit`）を追加。挙動変更なし
- **PR #781（マージ済み）**: `processOCR`の`timeoutSeconds`を540秒→900秒に引き上げ（[ADR-0023](../adr/0023-process-ocr-execution-budget.md)、1800秒上限は検知遅延・ドレイン待機の観点で不採用と判断）。連動する`STUCK_PROCESSING_THRESHOLD_MS`（`PROCESS_OCR_TIMEOUT_SECONDS`から導出する構造に変更）・ADR-0019のメンテナンスゲートドレイン待機（10分→20分）・`scripts/migrate-document-groups.js`・api-reference.md等を整合させて更新。契約テスト`processOCREndpointContract.test.ts`新設。`codex review`（medium effort）findings 0件
- **PR #782（マージ済み）**: 実機検証で`officeMatchMs`が全体の37%（295秒/789秒）を占めることが判明したため、`calculateKeywordMatchScore`（`functions/src/utils/extractors.ts`）が事業所マスター1件ごと（kanameone981件）にOCR全文の正規化・キーワード抽出を再計算していた重複をループ外へホイスト。`extractPdfPage`のページごとPDF再パースも解消。いずれも挙動不変（既存テスト・キーワードマッチング系列・`#506`本番bugパターン回帰テスト含め無変更で全PASS）。`codex review`（medium effort）findings 0件
- **kanameone実機検証結果**（該当書類`Px4myB4Y3t7jCFZSqS5J`の実処理、pending化→実OCR再実行で確認）:

  | | 変更前 | PR2適用後 | PR2+PR3適用後 |
  |---|---|---|---|
  | 総処理時間 | タイムアウト（540秒超過） | 789秒 | 617秒 |
  | officeMatchMs | ─ | 295秒 | 223秒 |
  | 900秒予算に対する余裕 | ─ | 111秒 | 283秒 |

- **スコープ外として記録**（ADR-0023参照）: 自動rescue対象へのタイムアウトエラー追加（ADR-0017の意図的限定を覆す判断）、監視・アラートの早期化、`concurrency`明示設定

## 【完了・2026-08-02】officeMatchMs残存コストの真因特定・bag distance最適化（Issue #783→#787→#788）

上記予防策の残存最適化余地として起票した[Issue #783](https://github.com/yasushi-honda/doc-split/issues/783)（`calculateKeywordMatchScore`のさらなる最適化）に着手したところ、**当初の想定が誤りだったことが実測で判明**し、真因調査から新規最適化・全環境デプロイまで完遂した。

- **Issue #783着手→誤りの発見**: `calculateKeywordMatchScore`（ステップ3キーワードマッチ）のO(1)ショートサーキット最適化をPR #786で実装・マージ（挙動不変、テスト全PASS、`codex review`findings 0件）。しかし本番相当ベンチマーク（OCR全文174,690文字×事業所981件、kanameone実測値に基づく合成データ）で計測したところ、この関数のコストは全体（約80秒）のわずか**0.09%（69.3ms）**に過ぎないと判明。Issue #783は誤ったボトルネック箇所を対象にしていた
- **真因特定**: 診断計測により、`extractOfficeCandidates`のステップ5「ファジーマッチ」（OCR全文へのスライディングウィンドウ+毎回フルLevenshtein計算）が実測**99.86%（79,454ms）**を占める真のボトルネックと判明。[Issue #787](https://github.com/yasushi-honda/doc-split/issues/787)として起票（ベンチマークデータで裏付け済み）
- **PR #788（マージ済み・Issue #787をクローズ）**: plan mode承認済み計画（`elegant-waddling-cake.md`）に基づき、数学的に完全等価な3層最適化を実装。①`levenshteinDistance`をO(min(n,m))空間のInt32Array rolling row化 ②bag distance（文字多重集合差分が編集距離の厳密な下界であることを利用）によるbranch-and-bound枝刈り+静的floorスキップを行う新規`bestFuzzyWindowScore`ヘルパ ③ステップ5を新ヘルパ呼び出しに差し替え。安全網: 変更前のcharacterization test3件・決定的PRNGによる差分テスト6000+ケース（不一致0件）・本番相当ベンチマークでのbefore/after候補リスト完全一致比較・`codex review`（medium effort、findings 0件）・`code-reviewer`セカンドオピニオン（HIGH/MEDIUM 0件、LOW指摘2件は反映済み）
- **効果**: 本番相当ベンチマークで79,864.6ms→99.2ms（**約805倍**）。**kanameone実本番データでも確認済み**（デプロイ後の自然トラフィック、1〜2ページ文書でofficeMatchMsが1,053〜3,610ms→177〜178msに改善、エラーなく完走）
- **全環境デプロイ完了**: dev（CI自動デプロイ、実機OCR3件で動作確認）→kanameone（`Deploy Cloud Functions`、実本番データで確認）→cocoro（`Deploy Cloud Functions`、ビルド成功・updateTime確認のみ。自然トラフィックが少なく実機OCRでの確認は未達だが、同一コードパスがdev/kanameoneで実データ検証済みのため十分と判断）
- **スコープ外・followup**: 調査の過程で`extractCustomerCandidates`（顧客照合、マスター1,352件）と旧`extractOfficeNameEnhanced`にも同一構造のボトルネックが存在すると判明（kanameone実本番ログでcustomerMatchMs=56〜63秒/71ページ文書を確認）。[Issue #789](https://github.com/yasushi-honda/doc-split/issues/789)として起票済み（未着手、次のROIが高い候補）
- **さらなるスケーリングリスク（未着手・証拠待ち）**: `pageLoopMs`（Gemini OCR呼び出し自体）は今回一切改善されておらず、71ページで334〜427秒と総処理時間の過半を占める。160ページ超級の文書では単独で900秒予算に迫る可能性があり、ADR-0023が示唆する通り「タイムアウト値の引き上げでは解決しない」領域（Cloud Run Job化等のアーキテクチャ変更が必要）。ただしkanameone/cocoroの実文書にそこまでの規模のものが実際に現れているかは未確認のため、証拠が出るまで着手は保留

## 【完了・2026-08-03】Issue #789: customerMatchMs/officeMatchMs(旧)最適化の水平展開

decision-maker明示指示によりIssue #789（上記followupで起票済み）に着手。`extractCustomerCandidates`（顧客照合、1,352件）と`extractOfficeNameEnhanced`（事業所照合旧版、981件）のファジーマッチが、Issue #787/PR #788で最適化した`extractOfficeCandidates`ステップ5と全く同一構造のO(テキスト長)スライディングウィンドウ+毎回フルLevenshtein計算のボトルネックだったため、PR #788で既に数学的等価性を証明済みの`bestFuzzyWindowScore`（bag distance branch-and-bound、`windowPad=3/5`とも既存の6000件超差分テストでカバー済み）へ置き換え。挙動不変。

- **PR #792（マージ済み）**: 実質差分1ファイル33行（コメント込み）。floor計算はいずれも「`matchType==='none'`到達時点でscoreは常に0」「下流の唯一の観測点はminScore以上かどうかの判定のみ」という条件から`minScore`として導出（ブースト分岐なし、`extractOfficeCandidates`より単純）。既存107件（`extractors.test.ts`）+8件（`similarityFuzzyWindow.test.ts`）+全体2021件、無変更で全PASS。CI（`lint-build-test`/GitGuardian/CodeRabbit）全PASS、手動チェックリストレビュー（1ファイル/33行のsmallティア）findings 0件
- **合成ベンチマーク**（顧客1,352件/事業所981件×OCR全文174,690文字相当、ランダム日本語テキストのfuzzy段のみ比較。リポジトリには含めない使い捨てスクリプトで実施）: 顧客照合7.6倍・事業所照合12.7倍の高速化を確認。本番実データでは文字列類似度分布の違いによりPR #788（officeMatchMs実測805倍）に近い、より大きい効果が見込まれる
- **全環境デプロイ完了**（2026-08-03）: dev（push自動デプロイ）→kanameone・cocoro両環境とも`gh workflow run "Deploy Cloud Functions"`実行、`processOCR`の`updateTime`実測（`2026-08-03T07:20:27Z`、ワークフロー完了時刻と一致）で反映確認済み
- **未確認（監視中・次回以降のタイミングでよい）**: 実際の`customerMatchMs`短縮幅は、71ページ級の実文書がkanameoneに来た際のOCRログで後日確認する（PR #788の`officeMatchMs`実測223秒→177msに相当する改善が見込まれる）。番号単位の追加認可は不要、監視のみ

## 【完了・2026-07-22】Google Drive連携Phase1 (MVP)実装ミッション

承認済み計画: `/Users/yyyhhh/.claude/plans/modular-enchanting-zephyr.md`、ADR: `docs/adr/0022-google-drive-export.md`。

**完了状態**: PR #700（56 files, +7515/-168）は2026-07-22にmainへsquash mergeされた（マージコミット `aa2d827`）。UI変更3ファイル（DriveFolderTemplateEditor.tsx/SettingsPage.tsx/ErrorsPage.tsx）はPRコメントへの実機確認証跡記録+`ui-verified`ラベル付与後にマージ。`feature/drive-export-phase1`ブランチはローカル・リモート共に削除済み（squash mergeのため差分ゼロを確認の上削除）。完了の定義4項目は全てE2E実機確認済み（下記「進行中のtasks」参照）。

**follow-up triage（2026-07-22〜23実施）**: マージ後に残っていた【様子見】6件+PLAUSIBLE 1件（catchupが提示した「7件+PLAUSIBLE2件」は解消済み項目混在の陳腐化情報だったため、GOAL.md本体を再確認して正確な件数に補正）のうち5件をTDDで修正（firestore.rules driveFileId削除ガード/resolveDriveFile()孤児ファイル内容未更新/GoogleDriveConnect連打ガード/Picker不正応答固着/resolveFolderSegments exhaustiveness）、PLAUSIBLE 1件（verified維持編集での再エクスポート未トリガー）はADR-0022に既知の制約として明記する方針で決着。残り1件（exchangeDriveAuthCodeCore Firestore書込み失敗時のsplit-brain再発）はdecision-maker選択で今回対応せず、次ミッションでのtriage対象として据え置き。

## 【完了・2026-08-30】Issue #871 PR-4: childFolderResolver.tsのclaimプロトコル完全移行(PR #879マージ)

上記「🔄 中断点」節の「次の一手」2番目（`childFolderResolver.ts`自体のclaimプロトコル移行）を実装・完了した。承認済み計画`~/.claude/plans/moonlit-jumping-alpaca.md`§5に基づき、`resolveChildFolder()`を旧`acquireFolderLock`/`releaseFolderLock`方式からclaimプロトコル完全参加型へ全面書き換え。`findOrCreateFolder.ts`との間で状態機械駆動ロジックの対称性を確保（shadowモードの新規作成直前防御・孤児claim回収・divergent保護等）。

**品質ゲート**: `codex review --base main -c model_reasoning_effort=high`を9ラウンド実施（TOCTOU競合の根絶・fencingトークン汚染防止[データ破損級]を含む）、`pr-review-toolkit`（code-reviewer/silent-failure-hunter）セカンドオピニオンで追加修正。PR作成後のhook強制レビュー（実質10巡目）でさらに1件（`invalidated`状態の保護漏れ、rollback実行時に並行exportが誤って上書きしうる穴）を検出・修正。

**CIで発覚した既存テストの穴を追加修正**: `driveFolderLocks`コレクションのクリーンアップ漏れ（5テストファイル、テスト間でclaimが残留しDivergentFolderClaimErrorを誘発）、fakeドライブの`files.get`未実装（4ファイル、beginCreationがresolved検知時に呼ぶverifyFolderClaimが動かず失敗）、claimプロトコルが正しく機能した結果古くなった並行実行テストの前提（2件、フォルダ重複作成を期待していたassertionを、後続実行が既存フォルダを再利用する新しい正しい挙動に合わせて書き換え）。functions unit 2104件・integration 344件、全PASS確認済み。

PR #879としてmainへマージ完了（squash、`issue-871-pr4-child-folder-resolver-claim`ブランチは削除済み）。

**follow-up**: `findOrCreateFolder.ts`と`childFolderResolver.ts`に状態機械駆動ロジックの重複が残っている（code-reviewerエージェント指摘、今回のPRでも見落とし[fencingトークン汚染対応の片側漏れ]を実際に引き起こした実害あり）ため、Issue #880として起票済み（P2、リファクタリング候補、緊急性なし）。

**次の一手**: PR-4完了により、計画のロールアウト表残り段階（cocoro→kanameoneの順で段階展開、詳細は上記「🔄 中断点」節「次の一手」1番目参照）が唯一の残タスク。

## 【完了・2026-09-16】Issue #871 divergent claimの恒久対応: 承認付き再同期ワークフロー実装完了(PR #928マージ)

`divergent`状態（claim記録とDrive実体の食い違い）に唯一の出口がなく、人手解決までFirestoreの手動編集以外に復帰手段が無いという構造的欠陥（上記「残2件のclaim/実体不一致 原因調査」節参照）に対し、plan mode（Opus 5、grip+codex 2パスクロスレビュー、`~/.claude/plans/wild-dreaming-firefly.md`）で設計した恒久対応を実装・マージした（PR #928、Closes #871）。

**実装概要**:
- `functions/src/drive/driveFolderClaim.ts`: `resolveDivergentClaim()`/`releaseDivergentClaim()`を新規export（divergentから抜ける唯一の正規経路、Firestore `updateTime`によるCAS付き）。`markDivergent()`から`expireAt`（180日TTL）を除去しTTL対象外化、`divergentAtMs`/`divergentRunId`を記録。`resyncHistory[]`（監査用、最大20件）を追加
- `scripts/classify-drive-claim-divergence.ts`（新規、read-only）+ `scripts/execute-drive-claim-resync.ts`（新規、承認付き実行）: `restore-expected`（Drive実体を期待値へ書き戻す）/`release-claim`（claim破棄、stranded件数ガード付き）/`finalize-resolved`（Drive側は既に正、Firestore確定のみ）の3モード。fail-closedプリフライト（`scripts/lib/divergenceResolutionPlan.ts`）+ Drive側TOCTOU対策（書込み直前に`files.get`で再照合）
- `functions/src/drive/driveFolderClaimDivergentSweep.ts`（新規、日次onSchedule）: divergent滞留バックログの継続監視。監視メトリクス3種（新規発生・記録失敗・滞留バックログ）+ アラート3種を`setup-log-based-metrics.sh`/`monitoring-templates/`に配線
- `.github/workflows/run-ops-script.yml`: 承認JSON中のoperationIdがplan由来と一致することをjqで検証するゲートを追加
- ADR-0022 Decision 4・`docs/context/monitoring-setup.md`に業務方針（`accept-actual`を意図的に非提供、TTL対象外化、承認は`planRunId`経由限定等）を明文化

**品質ゲート**: codex review 2巡（1巡目Critical1件含む複数、2巡目P1〜P2）+ `pr-review-toolkit`5エージェント（code-reviewer/silent-failure-hunter/pr-test-analyzer/comment-analyzer/type-design-analyzer）並列レビューで検出したCritical/High全件を修正済み。主な修正: ①`release-claim`が`actual===null`で常時blockedになりTTL除去の設計意図（404'd claimの解放）が到達不能だった欠陥 ②`markDivergent()`失敗ログの欠落（最ホットパスの`verifyFolderClaim()`3箇所） ③`execute-drive-claim-resync.ts`のテスト0件 ④監視メトリクス/アラートが`resource.type="cloud_function"`を指定しており実際のgen2ログ出力（`cloud_run_revision`）と不一致で機能しない欠陥（`gcloud logging read`実測で確認・修正） ⑤`resyncHistory`が通常のclaim書込み全12箇所で毎回消えていた欠陥。テスト最終件数: functions unit 2144件・integration 383件、scripts unit 359件・integration 79件、全PASS

**【2026-09-17追記】同型の不一致が既存5メトリクスにも及ぶ疑いをIssue #936として起票**: `[driveFolderClaim] claim divergent detected`ログ（本セッションで実際に発生させた本物のログ）を`gcloud logging read`実測したところ、`resource.type="cloud_run_revision"`では7日間で2件ヒットするが`resource.type="cloud_function"`では0件と確認。一方、同じ関数の一般ログは`cloud_function`型でも正しくミラーされることも確認しており、gen2 Cloud Functionsの構造化エラーログはGCPのlegacy `cloud_function`型へ常時ミラーされるわけではないと判明。既存5メトリクス（`searchindex_oom`/`ocr_page_truncated`/`ocr_aggregate_truncated`/`summary_truncated`/`search_index_silent_failure`、いずれも`resource.type="cloud_function"`指定）も同型の構造化エラーテキストマッチのため同じ不具合を抱えている可能性が高いが、dev環境の過去90日間で該当インシデント自体が発生しておらず直接実証はできていない（状況証拠による推定、詳細・推奨対応はIssue #936参照）

**【2026-09-17完了】Issue #936: dev/kanameone/cocoro全環境で対応完了、クローズ済み**。まずdev環境で状況証拠を直接実証へ格上げ: `onDocumentWriteSearchIndex`/`processOCR`/`regenerateSummary`いずれも`resource.type="cloud_function"`(監査ログ除く)は7〜90日で0件、`cloud_run_revision`は数十〜4万件/7日。プロジェクト全体でも過去30日`cloud_function`型(監査ログ除く)は0件、ログルーティング側の除外設定にも原因なしと確認。5メトリクス定義(`scripts/setup-log-based-metrics.sh`)+対応する5アラートポリシーのcondition filter(メトリクスのlog-filterとは独立してresource.typeがハードコードされていた、二重欠陥)を`resource.type="cloud_run_revision"`へ修正しPR #938としてmainへマージ(codex reviewはwebsocket接続エラーで3回連続失敗しCLI/MCP両系統疎通不良のため、`pr-review-toolkit:code-reviewer`をフォールバック使用、findings 0件)。dev環境は`gcloud logging metrics update`/`gcloud alpha monitoring policies update`で直接反映・検証済み。cocoroでも同型の不一致を実証(`onDocumentWriteSearchIndex`: cloud_run_revision 777件 vs cloud_function 0件/7日)のうえ同様に反映・検証済み。kanameoneは`systemkaname@kanameone.com`の対話認証がトークン期限切れで非対話実行不可のため、GitHub Actions `setup-monitoring.yml`(専用SA `MONITORING_SA_KEY_KANAMEONE`)経由で対応。同ワークフローに`update`アクションが無いため`teardown`→`setup`の順で2回dispatch(Run ID 35170631501→35170787630、両方success、数分間kanameoneの監視が一時停止)し、全8メトリクス・8アラートポリシー・通知チャネルを再作成、対象5メトリクスの説明文に`#936でcloud_run_revisionへ修正`が反映されていることをワークフローログで確認。

- [x] **段階1（全環境）完了【2026-09-16】**: 監視メトリクス+アラート3種（`drive_folder_divergent`/`drive_folder_divergent_record_failed`/`claim_divergent_backlog_stale`）を`setup-monitoring.yml`（GitHub Actions、推奨経路）経由でdev/kanameone/cocoro全環境に配備。`--dry-run`（3環境並列）で新規作成対象を事前確認後、`action=setup`で本番反映。devのみ初回実行時にGCP側メトリクス伝播遅延によるレース（`Cannot find metric(s)...could take up to 10 minutes`）でアラートポリシー作成が一部失敗したが、冪等な再実行で解消。3環境とも`gcloud logging metrics list`で独立確認済み（既存5種メトリクス・通知チャネルへの変更なし）
- [x] **段階2〜4（kanameone）完了【2026-09-16】**: `classify-drive-claim-divergence`で残2件（op-0001「実績」フォルダ・op-0002「フ　藤原広子」フォルダ、いずれも`divergentReason: parents-mismatch`）を再確認、両件とも`recommendedMode: restore-expected`・`blockedReasons`/`claimGraphConflicts`なしと判明。dry-run（`executed=0 dry-run=2 error=0`）→番号単位の明示認可→`execute-drive-claim-resync --execute --requeue`で実行し両件とも`status=executed`。独立した再実行で`classify-drive-claim-divergence`の`totalDivergent`が2→0になったことを確認済み
  - **副次的に発見した実バグ**: `--requeue`（影響文書の即時再export試行）が対象3文書（`PNFkvtmQklBQ2fTsCQJI`/`ensJd0d97BPprgPfZhrn`/`KtvdlXkXdMwT4tt3zbNY`）全件で`Bucket name not specified or invalid`エラー。根本原因は`scripts/execute-drive-claim-resync.ts:160`の`admin.initializeApp({ projectId })`が`storageBucket`未設定（兄弟スクリプト`classify-drive-export-drift.ts`等は正しく設定）。**Issue #931として起票、1行修正（`storageBucket: process.env.STORAGE_BUCKET`追加）でPR #933にてマージ済み【2026-09-16】**。統合テスト12件PASSで確認
- [x] **段階0（devリハーサル）完了【2026-09-16】**: 着手時、dev環境のDrive連携先`rootFolderId`が外部の実在共有ドライブ（顧客とは無関係の第三者所有）を指す設定ミスと判明。書き込みテストを中断しdecision-maker確認のうえ、①dev専用の新規共有ドライブへ`rootFolderId`をアプリ正規UI経由で切替 ②混入していた合成テストデータ（1階層、全件`scripts/seed-dev-data.ts`由来と確認済み）をゴミ箱へ移動、の2点を是正（詳細: `[[reference_dev_drive_root_folder_misconfiguration]]`）。是正後のdev専用サンドボックスで改めてリハーサル実施:
  - Drive UI経由のフォルダ移動はContent Manager/Manager両ロールで3回とも原因不明のまま静かに失敗（Playwright操作は成功するがDrive API側は無変化）。codexセカンドオピニオンの助言により方式転換し、`files.update`（addParents/removeParents）でDrive API直接操作しdivergent状態を人為的に作成（使い捨てスクリプト、GitHub Actions run-ops-script.yml経由）
  - **新たな発見**: `classify-drive-claim-divergence`は`driveFolderLocks.state=='divergent'`を走査するのみでDrive実体とのライブ突合はしない。state遷移はアプリの実exportホットパス（`findOrCreateFolder`→`verifyFolderClaim`、または完全再検索でのmismatch）でのみ発生する。またdriveExportTrigger.tsは`driveExportStatus`が既に設定済みのdocumentでは`verified` false→true再発火をno-op化する（`executeDriveExport`のクレームが`claimFromStatus: undefined`固定のため）ため、既export済みdocumentで再現するには`driveExportStatus`フィールド自体の削除が必要だった
  - 上記を踏まえ実際のexportコードパス経由でclaimを`state: 'divergent'`へ遷移させたうえで、`classify-drive-claim-divergence`(`totalDivergent: 1`検知)→番号単位の明示認可→`execute-drive-claim-resync --dry-run`(`dry-run=1 error=0`)→`--execute`(`status=executed`、claim`resolved`へ復元)→再度divergent再現→`--execute --requeue`一括実行(`status=executed`・`requeue完了: 対象1件中 成功1件`、document`driveExportStatus`が`error`→`exported`へ回復)まで一気通貫で実機確認。途中、既に解決済みのplanで再実行を試みた際に`status=claim-drift`で安全に拒否されることも確認（stale plan誤承認の防止機構が正常動作）
  - 使い捨てスクリプト・GitHub Actions一時choice（`tmp-issue871-stage0-*`）は`chore/tmp-issue871-stage0-divergent-test`ブランチのみに存在させ、mainへは一切マージしていない。検証完了後、同ブランチをローカル・リモートとも削除済み【2026-09-16】

## 【完了・2026-08-29】残存44件(→49件)の実態解明+kanameone担当者への確認依頼を報告文書に反映(送付は未実施)

上記「次に必要なのは以下のいずれか」の両方に対応した。**kanameone側でDrive export破損documentが継続的に発生していないか、`classify-drive-export-drift`を`--care-manager`省略でテナント全体に対し再実行**（GitHub Actions run [33183923836](https://github.com/yasushi-honda/doc-split/actions/runs/33183923836)）したところ、Phase 3最終確認（8/28、44件）からわずか約1.5時間で残存が49件（trashed9+misplaced14+target-path-not-created5=28件、他blocked21件=segment-unresolvable17+ambiguous-path3+customer-unconfirmed1）へ自然増していることを確認。**新たに`wouldRestoreFolders`1件（「ケアプラン」フォルダ、影響3書類）も検出**（Phase 3実行時にはなかった別インスタンス）。

**segment-unresolvable 17件の実体を特定**: 全件`FuriganaMissingError`で、集約すると4顧客（佐藤綾子10件/牧野美雪担当・津田ヒデ子4件/宮崎幸代担当・加藤和子2件/渡邉幸子担当・渡辺淳次1件/平出勝己担当）のフリガナ未登録が原因と判明。kanameoneのDriveフォルダテンプレートは`customer: furiganaInitialSpaceName`（フリガナ頭文字であいうえお順フォルダ分類、意図的設計）を使用しており、代替設定`furiganaFallback: useNameInitial`はグローバル設定のため影響範囲が広く将来登録者全体に及ぶうえ漢字頭文字は五十音順と一致しないため、正攻法（kanameone側にフリガナ確認を依頼）を採用。

**ambiguous-path 3件 + target-path-not-created 5件（計8件、全て平出勝己担当）の実体を特定**: read-only調査（`investigate-issue811-root-cause --list-children`/`--folder-ids`）で、対象顧客配下の「ケアプラン」フォルダがtrashed状態で2つ存在（active無し）と判明。metadata取得の結果、**両フォルダとも平出勝己さん本人（`katsumihiraide@kanameone.com`）が手動で作成→翌日ゴミ箱移動した実際のDrive操作**（8/18作成→8/19移動、8/19作成→8/20移動）であり、システムの不具合ではないことを確認。これは③（D9除外23件）の「原因不明のDrive側変更」判断が妥当だったことの実証でもある。書き込み系操作（復元・統合、マスタ修正）は一切実施していない。

**kanameone担当者への報告文書を更新**（`brief-20260828-drive-repair-report.html`、Playwright MCPで再レンダリング確認済み）: Phase 3の全社的結果（60.8%→99.0%）に加え、上記2件の具体的な確認依頼（フリガナ4名の表、平出勝己さんの「ケアプラン」フォルダ確認依頼）を追加。**decision-makerが2026-08-29に先方へ送付済み**。**次のアクション**: kanameone側からの回答待ち（①4名分のフリガナ ②平出勝己さんの「ケアプラン」フォルダ整理方針）。回答があれば①はマスタへのフリガナ登録、②は先方の指示に従いフォルダ復元/統合を検討（executor側での無断実行はしない）。

**残る21件のうち customer-unconfirmed 1件**（牧野美雪担当）は通常のdoc-split UI操作（顧客確定）で解消見込み、Issue #774の`customerAmbiguityGate.ts`と関連。**D9除外23〜28件**（trashed/misplaced）と**wouldRestoreFolders新規1件**は「様子見・現状維持」でdecision-maker確定済み（原因不明のDrive側変更を無言で上書きしない設計判断）。

## 【完了・2026-08-29】未使用の/adminスタブ削除+formatTimestamp重複統合（PR #858、Driveミッションとは別件）

着手可能なGitHub Issueが0件（#774/#251/#238いずれも issue本文明記のトリガー未発火、#714はpostponed）だったため、decision-maker承認「ROIが良ければ進めて」を受けExploreエージェントで低コスト高ROIな未Issue化の改善点を探索。3候補中2件（低コスト・高ROI）に着手:
- 未使用の`/admin`ルート・`AdminPage.tsx`削除（4タブ全てTODOのみの空実装、ナビゲーション未接続で約7ヶ月放置。機能は既にMastersPage/SettingsPage/ErrorsPageに実装済み）
- `formatTimestamp`のロジック重複4箇所（GroupList/DocumentDetailModal/DocumentsPage/AliasLearningHistoryModal）を既存共通実装（`documentUtils.ts`）への呼び出しに統合。デフォルトフォーマット文字列が異なる箇所は呼び出し側で明示指定し挙動を維持

tsc/lint/build/test（38ファイル557件）全PASS、Playwright MCPで実機確認（`/admin`リダイレクト・顧客別タブ・書類詳細モーダルの日付表示）。large tier（6ファイル）のためCLAUDE.md CRITICAL規定に従い`codex review`を medium effort（push前）・high effort+`--strict-config`（PR作成後）の2回実施+`pr-review-toolkit:code-reviewer`セカンドオピニオン、いずれも指摘0件。CI全PASS・ブラウザ確認証跡をPRコメントに記録・`ui-verified`ラベル付与のうえ、番号単位の明示認可を得てマージ（`f7186a2e`）。3件目の候補（`updateDoc(...,  as any)`重複3箇所の型安全性ヘルパー化）は緊急性低いため見送り。
