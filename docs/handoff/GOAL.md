---
updated: 2026-08-28
---
<!-- 前ミッション(dev/kanameone/cocoro環境監査・保守検証)は2026-07-20完遂。全文はdocs/handoff/LATEST.md参照。 -->
<!-- Google Drive連携Phase1 (MVP)実装ミッションは2026-07-22完了(PR#700マージ)。詳細は本ファイル末尾「Google Drive連携Phase1完遂」節+docs/handoff/LATEST.md参照。 -->

## 📋 空き時間バックログ（現在のミッションとは無関係、doc-audit 2026-08-01指摘）

- [x] `docs/context/gemini-rate-limiting.md`のレート制限値をGemini 3.5 Flash運用下で再検証する（2026-08-02、PR #785マージ済み）。Playwright MCPでVertex AI公式モデルカードを実測確認し、RPM/TPMがDynamic Shared Quota化され固定値が存在しないこと・最大出力トークンがモデル上限65,536（旧記載8,192はアプリの暴走対策キャップとの混同）・PDF最大ファイルサイズがAPI経由で50MB（旧記載20MBは不一致）と判明、ドキュメントを修正

## 現在のミッション【進行中・2026-07-23開始】

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
- [x] FEエラー一覧 + リトライUI実装（2026-07-22、plan mode経由で設計・承認後実装。既存`/errors`(`ErrorsPage.tsx`)にRadix `Tabs`で「OCRエラー」「Driveエクスポートエラー」の2タブを追加、既存内容は`OcrErrorsTab`へロジック不変で移動。実装前のplan agentレビューで3件のギャップを検出・対応: ①`Document`型/`firestoreToDocument()`いずれにも`updatedAt`が無いため一覧・ソート用の変換関数`toDriveExportErrorRow()`は`Document`型でなく生Firestoreデータ`(id, data)`を受ける設計に ②`retryDriveExport`の「呼出し成功だが再エクスポートも失敗」tri-state契約(`{success:false, status:'error', error}`のresolve、例外ではない)を`onSuccess`内で分岐 ③`frontend/src/lib/callFunction.ts`の`getCallableErrorMessage()`が`failed-precondition`を分岐しておらずBEの親切な日本語メッセージを`defaultMessage`に握り潰していたため汎用ヘルパーに分岐追加（他呼出し元にも便益、破壊的変更なし）。新規: `frontend/src/hooks/useDriveExportErrors.ts`(`useDriveExportErrors`/`useRetryDriveExport`、単一等値クエリ+クライアント側ソート、`driveExportScheduled.ts`と同じ複合index回避方針)。retryボタンは`useAuthStore().isAdmin`でガード。単体テスト30件追加（callFunction 2件+useDriveExportErrors 9件+ErrorsPage 12件、既存7件含む）、frontend全459件PASS、tsc/lint全PASS確認済み。**テスト実装中に発見した2件のjsdom/a11y問題を修正**: (1) 使用中の`@radix-ui/react-tabs@1.1.13`はTrigger活性化を`onClick`でなく`onMouseDown`で行うため、`fireEvent.click`単独ではjsdom上でタブが切り替わらない(`openDriveTab()`を`fireEvent.mouseDown`に変更、実ブラウザでは通常クリックで問題なく動作を確認済み) (2) 操作列のアイコンボタン(詳細を表示/リトライ)がRadix `Tooltip`のみでアクセシブルネームを持たず`getByTitle`で取得不可だったため、両ボタンに`aria-label`を追加(視覚は不変、a11y改善を兼ねる)しテストは`getByRole('button',{name})`に統一。ブラウザ実機確認(dev環境、Firebase Console UIで`documents`コレクションの1件に`driveExportStatus:'error'`を一時セット→タブ切替・0件/1件表示・詳細ダイアログのdriveExportError生文字列`<pre>`表示・ボタンaria-label付与を確認→確認後にフィールド削除で復元済み)。**リトライボタンの実行自体は未検証**(実callable呼出しは実連携済みDrive本番共有ドライブへの副作用リスクがあるためdecision-maker判断でスキップ、tri-state分岐ロジックはコンポーネントテスト12件で網羅済み)）
- [x] E2E疎通確認（2026-07-22、dev環境、Playwright MCPでdecision-maker立会いのもと実施。完了の定義4項目のうち3項目を実機確認、残り1項目は既存カバレッジで代替）。**着手直後に本番投入前提を揺るがす新規バグを発見**: ハッピーパス初回実行が`driveExportStatus:'error'`（`Bucket name not specified or invalid`）で即失敗。根本原因は`functions/src/drive/exportDocument.ts:55`の`storage.bucket()`（引数なし）が`functions/src/index.ts:11`の`admin.initializeApp({storageBucket: process.env.STORAGE_BUCKET})`に依存する一方、dev環境向けのFunctions dotenvファイル（`functions/.env.doc-split-dev`）が存在せず、2026-07-21初回デプロイの3関数（`onDocumentWriteDriveExport`/`retryDriveExport`/`driveExportScheduled`）に`STORAGE_BUCKET`が一切設定されていなかったこと（既存`processOCR`のみ過去の手動設定が偶然残存し正常動作していたため、これまで気づかれなかった）。decision-maker承認を得て`gcloud run services update`で3サービスに`STORAGE_BUCKET=doc-split-dev.firebasestorage.app`を緊急パッチ（Cloud Run経由。`gcloud functions deploy --update-env-vars`はgcloud側のAttributeErrorで失敗したためCloud Run直接操作に切替）。**この場しのぎの修正は次回`firebase deploy --only functions`実行時に上書き消失するリスクがあり、恒久対応（`functions/.env.doc-split-dev`新設、kanameone/cocoro向け同種ファイルの要否精査）が未着手のまま残っている**（新規Issue化候補、次回セッションでtriage）。パッチ後は以下の通り確認: ①**ハッピーパス**: `seed-doc-0002`（相沢一郎/佐々木恵子/ケアプラン）を確認ボタンで検証→初回はerror→新設リトライUIの「リトライ」ボタンから再試行→`driveExportStatus:'exported'`+`driveFileId`付与を確認、decision-makerが実際のDriveで`事務/北名古屋事業所/佐々木恵子/相沢一郎/ケアプラン`階層とPDF生成を目視確認 ②**フォルダ合流**: 同一利用者の2件目`seed-doc-0003`をエクスポート→新規フォルダが作成されず、同一フォルダ配下に2件目PDFが追加されたことをdecision-makerが目視確認 ③**fail-visible（フリガナ欠損）**: `seed-cust-03`（内田健三）のfuriganaを一時的に空文字化→対象書類を確認→`driveExportStatus:'error'`+エラーメッセージ「フリガナが未設定のため利用者フォルダ名を解決できません」を確認、Driveエクスポートエラー一覧タブへの表示も確認→furiganaを元の値`うちだけんぞう`に復元済み ④**フォルダ名2件以上重複時**: 実ドライブでの手動再現はリスク/コストに見合わないとdecision-maker判断、既存のexportDocument統合テスト18件（`AmbiguousFolderError`カバー済み）で代替と結論 ⑤**Feature Flag OFF不変**: テスト開始時点で`settings/features.driveExport`が未設定（=OFF）だった状態を活かし、この状態のまま書類を1件確認→`functions/src/drive/driveExportTrigger.ts:49`の早期returnによりDrive系フィールドが一切書き込まれないことをFirestore直接確認、Cloud Functionsログでもエラーなくトリガーのみ完了したことを確認。検証後、後続テストのため`driveExport`をtrueに設定、**decision-maker判断でtrueのまま維持**（今後もdev環境をDrive機能の継続動作確認に使う想定、kanameone/cocoroは別環境のため無影響）。frontend dev server（vite、doc-split-dev接続）はテスト後に停止済み）

### `/code-review high`残りCONFIRMED 7件+PLAUSIBLE 1件（2026-07-21 triage: 未マージbranchのtodoとしてGOAL.md管理、GitHub Issue化せず）
- [x] 【解消済み・2026-07-22】useDocumentVerification経由でdriveExportStatusがstaleのまま残る問題を解消（frontend/src/hooks/useDocumentVerification.ts。共通ヘルパー`getDriveExportClearFields()`を`useDocuments.ts`に抽出し`markAsUnverified`に適用、`markAsVerified`は変更なし。単体テスト追加、commit 28e6d9e）
- [x] 【解消済み・2026-07-22、優先度最高】feature flag OFF時にverifiedされたdocumentが永久回収不能な問題を解消（新規Cloud Function追加ではなく管理スクリプト`scripts/backfill-drive-export.ts`を新設。既存の`error`状態リトライ経路を再利用し`updatedAt`をバックデートすることで次回定期スイープに委譲。エミュレータで動作確認済み、ADR-0022にバックフィル注記追加、`run-ops-script.yml`にも登録。commit 365343a。**dev環境で本実行完了（2026-07-23、GitHub Actions経由）**: dry-run結果 dev 51件(seedテストデータ)/kanameone 876件(実データ)/cocoro 93件(実データ)のうち、decision-maker判断でdevのみ本実行（51件を`driveExportStatus:'error'`にマーク、定期スイープで約1.5時間かけて解消見込み）。**kanameone/cocoroは実行せず据え置き**: 両環境はDrive関連Functions未デプロイ（Phase1未展開）のため、この状態で本実行すると設定未完了の実ドキュメント969件が一斉にerror化し、拾う定期スイープも稼働していないため、FEの「エラー履歴」画面に大量の見掛けエラーが残留するリスクがあると判断。kanameone/cocoroへのPhase1展開時に改めて実行する）
- [x] 【解消済み・2026-07-22】driveExportScheduled.tsの40件上限バックログ飽和問題を解消（`orderBy(FieldPath.documentId())`+`internal/driveExportSweepState`カーソル永続化によるページネーション追加、複合index不要。starvation回帰テスト+カーソルリセットテスト追加。commit b42d8de）
- [x] 【解消済み・2026-07-22】doc.fileDateがnullの場合のTypeErrorクラッシュを解消（`FileDateMissingError`追加、`exportDocument.ts`の`fileDate`をnull安全に。commit 24f2de5）
- [x] 【解消済み・2026-07-22】careManagerName空文字で空白のみのフォルダ名が生成される問題を解消（`CareManagerMissingError`追加、既存`FuriganaMissingError`と同型のfail-visibleガード。commit 24f2de5）
- [x] 【解消済み・2026-07-22】firestore.rulesのdriveFileId削除ガード不十分を解消（`driveFileId`は他4フィールド(driveExportStatus等)と異なり「存在有無の遷移(追加/削除)自体を禁止し、存在する場合は値も不変」というガードに変更。TDD(Red→Green)でrulesテスト1件追加、92件全PASS確認済み。ADR-0022更新）
- [x] 【解消済み・2026-07-22】exchangeDriveAuthCode.tsのPartial Updateテスト欠如を解消（`exchangeDriveAuthCodeCore`へDIリファクタ+`exchangeDriveAuthCodeIntegration.test.ts`新設5件。commit a963e9a）
- [x] 【解消済み・2026-07-22、decision-maker判断】[PLAUSIBLE] verified維持のままの編集(customerName/documentType等)で再エクスポートがトリガーされない件は、バグ対応ではなくPhase1の既知の制約としてADR-0022に明記する方針で決着（functions/src/drive/driveExportTrigger.ts:43はコード変更なし。訂正時は運用上「一旦verified:falseに戻してから再確認」を前提とする旨をADRに追記）
- [x] 【解消済み・2026-07-27、対応不要で確定】exchangeDriveAuthCodeCore、`setSecret`成功後の最終Firestore `set()`が失敗した場合のsplit-brainリスク（functions/src/drive/exchangeDriveAuthCode.ts:107-115、2026-07-22発見）を調査。コード実装を確認した結果、この`set()`の例外は握りつぶされずCallable呼び出し元(onCallハンドラのcatch節)まで伝播し`HttpsError('internal', ...)`としてFEにエラー表示されるため「静かに」残ることはなく、ユーザーが再試行すれば`setSecret`/`set()`とも同一値の再実行で冪等に解消することが判明。エクスポート処理はSecret Manager側の値を参照するため、この窓の間もエクスポート機能自体は途切れない。以上により恒久的な補償ロジック追加は費用対効果が見合わないと判断し対応不要で確定、該当箇所にコード内コメントで根拠を明記（commit未定、次回コミット時に反映）

### `/code-review`（xhigh、2026-07-21、フォルダテンプレートエディタ実装直後に実行）新規CONFIRMED 9件
10角度finder(5正確性+3クリーンアップ+altitude+conventions)並列→1票制verify→sweepの完全プロセス実施。上記の既存3件(fileDate null/careManagerName空白/exchangeDriveAuthCodeテスト欠如)は独立して再CONFIRMEDされたが重複のため既存項目に統合。以下は今回新規に発見されたもの。**自分が今セッションで書いたコードの不備2件は承認済み計画スコープ内の是正として即修正済み**（separator不参照・SEGMENT_TYPES二重管理、修正後53件テスト+tsc再PASS確認済み）。残り7件は既存ブランチコードの指摘のため未着手、triage待ち。
- [x] 【解消済み・2026-07-22】resolveDriveFile()のtrashed/404フォールバックでappProperties一致の孤児ファイルを内容未更新のまま再利用する問題を解消（`findOrUploadFile()`のfiles.length===1分岐に`files.update()`によるmedia再アップロードを追加、idは引き続き再利用。TDD(Red→Green)で既存回帰テストを新内容に更新、functions unit1909/integration224全PASS確認済み。ADR-0022更新）
- [x] 【解消済み・2026-07-22】exchangeDriveAuthCode.tsのsettings/drive書込み非atomic問題を解消（疎通確認(fetchConnectedEmail)成功後に`{authMode, connectedEmail}`を単一`set()`で書き込む設計に変更、部分書込みの不整合状態が構造的に発生しなくなった。commit 7f902c0。さらにcodex review指摘でSecret Manager保存(setSecret)を疎通確認より後に回す順序修正も追加(split-brainリスク解消、commit 3a6409a)。exchangeDriveAuthCodeIntegration.test.tsに両方のリグレッションテストあり）
- [x] 【解消済み・2026-07-23】GoogleDriveConnect.handleConnectの連打ガード不足を解消（`setConnecting(true)`をGISのcallback内からrequestCode()直前へ移動し、兄弟コンポーネントDriveFolderPicker.handlePickFolderと同じタイミングに統一。error_callbackでもsetConnecting(false)するよう追加。SettingsPage.tsx全体がテスト0件のため専用の自動テストは追加せず、tsc/lint/frontend全466件PASSで回帰確認のみ）
- [x] 【解消済み・2026-07-23】Pickerの不正応答時のpicking状態固着を解消（`isPickerCancelled`(action==='cancel'のみ判定)を`isPickerLoadedEvent`(action==='loaded'のみ判定)に置き換え、呼び出し元の分岐を「pickできなければloaded以外は全てonCancel」に一般化。TDD(Red→Green)でテスト更新、frontend全466件PASS確認済み）
- [x] 【解消済み・2026-07-23】resolveFolderSegments()のswitch文にexhaustiveness check(default節でnever型チェック)を追加。functions unit1909件・tsc(strict)全PASS確認済み
- [ ] 【対応不要】useGooglePickerScript.tsの新規script作成分岐にcleanup関数が無い（frontend/src/hooks/useGooglePickerScript.ts:32。既存script分岐とだけ非対称。React18ではアンマウント後setStateは無害化されるため実害は軽微と検証済み、優先度低）
- [ ] 【対応不要】クリーンアップ・効率化系4件（優先度低、機能影響なし）: ①GoogleDriveConnect/DriveFolderPickerの接続状態判定ロジック重複(SettingsPage.tsx:715) ②firestore.rulesのDrive系5フィールド分ガードが同一パターンの5回コピペ(firestore.rules:178) ③DriveFolderTemplateSection/GmailSettings/NotificationSettingsの保存UXステートマシン(hasChanges+3秒自動消去)が3箇所で完全同一ロジック(SettingsPage.tsx:1005) ④createDriveOAuthClient()がキャッシュ無しで毎回Secret Managerへ3回アクセス(functions/src/utils/driveAuth.ts:40、driveExportScheduled.tsのバックログ処理時に往復増大)

### `/code-review medium`（2026-07-22、PR #702「様子見triage2件」自体のレビュー）CONFIRMED 2件+PLAUSIBLE 1件、記録のみ
8角度finder(3正確性+3クリーンアップ+altitude+conventions)並列→1票制verifyの完全プロセス実施。正確性バグ・conventions違反は0件。firestore.rulesのdriveFileId削除ガード変更・null注入対策は複数エージェントが個別に検証し実装正しさを確認済み。decision-maker判断でいずれも記録のみとし対応せず。
- [ ] 【対応不要】findOrUploadFile()の新規drive.files.update()ブロックがresolveDriveFile()の既存ブロックとほぼ同一形状で重複（addParents/removeParentsの有無のみ差異。functions/src/drive/exportDocument.ts:135）
- [ ] 【対応不要】孤児ファイル再利用時、内容が既に最新(同一実行内の直近クラッシュ等)でも無条件に再ダウンロード+再アップロードする（機能的には無害、Drive API割当てを無駄に消費する狭いケース。functions/src/drive/exportDocument.ts:124）
- [ ] 【対応不要】`deps.downloadFile ?? defaultDownloadFile`のフォールバックパターンがファイル内で3箇所目の重複に（可読性上のコストのみ。functions/src/drive/exportDocument.ts:133）

### `/code-review xhigh`（2026-07-22、Driveエクスポートエラー一覧+リトライUI実装直後、diff範囲は`@{upstream}...HEAD`=ブランチ全体45ファイル）新規CONFIRMED 4件+新規発見3件
10角度finder並列(実行中2件がECONNRESETで初回失敗、再実行して復旧)→1票制verify→sweepの完全プロセス実施。既存の`/code-review high`残り7件+`xhigh`新規7件のうち8件（fileDate null/careManagerName空白/findOrUploadFile内容未更新/feature flag OFF永久回収不能/exchangeDriveAuthCode非atomic/driveExportScheduled40件上限/Picker不正応答固着/GoogleDriveConnect連打）は複数角度から独立して再CONFIRMEDされ重複のため統合済み（上記2セクションのタスクのまま、未着手）。以下は今回のFEエラー一覧+リトライUI実装で新たに発見されたもの、未着手・triage待ち。
- [x] 【解消済み・2026-07-22】リトライ成功時に成功メッセージが即座にリストから消え去る問題を解消（`ErrorsPage.tsx`のrow-local state banner→`sonner` toastへ移行。テストは`toHaveBeenCalledWith`アサーションへ変更。commit eafa914）
- [x] 【解消済み・2026-07-22】handleRetryのcatchブロックでキャッシュ無効化が漏れていた問題を解消（`useRetryDriveExport`に`onError`を追加し失敗時も一覧を無効化。commit eafa914）
- [x] 【解消済み・2026-07-22、回帰】failed-precondition素通し分岐がexchangeGmailAuthCode/exchangeDriveAuthCodeの英語メッセージをUIに露出する回帰を解消（根本原因のBE側英語メッセージ2箇所を日本語化。GmailはメッセージをFirebase初期化非依存の新規`gmailAuthMessages.ts`へ分離しテスト容易化。`callFunction.ts`のfailed-precondition分岐自体は変更なし。commit a963e9a）
- [x] 【解消済み・2026-07-22】documentCategoryセグメントの空文字ガード欠如を解消（`DocumentCategoryMissingError`追加、careManagerName/フリガナと同型のfail-visibleガード。commit 24f2de5）
- [x] 【解消済み・2026-07-22】findOrCreateFolder()の異なるdocId間の作成競合を解消（`driveFolderLocks`コレクション+Firestoreトランザクションによる所有権主張、`executeDriveExport.ts`の`driveExportRunId`と同型のfencing token方式。commit cea0ec2で導入、3c3cc6dでfencing token追加+曖昧な再検索の停止対応。findOrCreateFolderIntegration.test.tsに決定論的な契約テストあり。既知の残存ギャップ: ロースの2分lease超過時にDrive API呼び出し自体の二重実行は完全には防げない、GOAL.md本項目の下位に別途記載）
- [x] 【解消済み・2026-07-22】新設「リトライの確認」Dialogが実ブラウザで一度も開かれておらずCLAUDE.md「UIコンポーネント変更時の確認（#193教訓）」未達だった件。E2E疎通確認セッションでPlaywright MCPにより実際にDialogを開き、レイアウト崩れなし・「リトライを実行」ボタン押下→実際のリトライ処理成功まで実機確認済み（詳細は「進行中のtasks」E2E疎通確認の記録参照）
- [ ] 【対応不要】[PLAUSIBLE、現状実害なし] useRetryDriveExportのonSuccessが`['document', docId]`クエリを無効化しておらず将来的にDrive状態を読むuseDocument(docId)呼び出しが古いキャッシュを表示しうる（frontend/src/hooks/useDriveExportErrors.ts:86。現時点でuseDocument(docId)の唯一の呼び出し元DocumentDetailModal.tsxはDrive系フィールドを読んでいないため実害なし）

## 🔄 中断点（in-flight）

**Issue #811/#823 remediation Phase 2b-2（次セッション再開点）**: `execute-drive-export-repair.ts`はPhase 2b-1でPR #851としてmainへマージ済み・devリハーサル実機確認済み（詳細は上記「Issue #811/#823 remediation Phase 2b-1」節）。次に必要なのは以下のいずれか、decision-maker判断待ち:
- kanameone本番への実際の書き込み実行（plan `~/.claude/plans/sharded-mapping-squid.md` Phase 2b-2、`--limit 10`でのcanary→検証→残り全件488件）の番号単位明示認可
- kanameone担当者への報告文書（「修復メカニズムの実装・検証が完了し、実行待ちの状態」）作成
- 全ケアマネへの横展開（Phase 3）・cocoroへの適用（Phase 4）の要否判断

**完了記録**: kanameone backfillマーカー20件滞留の原因調査・修正は完遂した。PR #804（`sweepStuckDriveExports`のrequeuedカウンタ修正）をkanameone/cocoro両環境へデプロイ後（2026-08-06 03:10/03:21）、自然経過での解消をFirestore/Cloud Loggingで継続監視: 20件(04:22 UTC)→9件(04:32〜06:35 UTC、customer-unconfirmed/real-errorの塊をカーソルが順次走査するため一時的に足踏み)→**0件（06:37:41 UTCの`requeued=8, failed=16`実行で末尾のbackfillマーカー群を処理し完全解消、07:02 UTC時点でFirestore実測`{"customer-unconfirmed":218,"real-error":117}`とbackfillカテゴリなしを確認）**。約3.5時間で修正の効果が完全に実証された。

**Issue #794（③kanameone報告PDFのType3フォント文字消失）**: 2026-08-06 PR #798マージによりクローズ済み。詳細は上記「kanameoneからの相談3件対応」節③参照。

cocoro側Drive連携Phase C（クライアント自身のOAuth接続）は外部依存待ち（継続、変更なし）。

## Drive連携Phase D: Stage D完了（2026-07-31、decision-maker「Drive Phase D進めて」で着手）

**インフラギャップ発見・解消**: Phase D実行に必要な3スクリプト（`drive-export-status-report`・`set-feature-flag --flag driveExport`・`set-drive-allowlist`）はコード実装済みだが`.github/workflows/run-ops-script.yml`のGHA実行対象choiceに未登録で、ローカルhook(`ops-script-redirect.sh`)がADC実行をブロックし着手不可能だった。既存の`faxDuplication`/`--doc-id`パターンを踏襲して追加（PR #764マージ済み、`actionlint`検証済み）。

**Stage D実施結果（kanameone）**:
1. Entry gate確認: verified総数1,287件、error=0・exporting=0 ✅
2. `set-feature-flag --flag driveExport --value true`実行 → `settings/features.driveExport = true`
3. `set-drive-allowlist --set 025kUMow3speMeOplwOW`実行 → 対象書類1件のみに限定（松田様、`isSplitSource:false`の通常processed書類を選定）
4. Firestore直接操作でverified false→true（rising edge）を発生させ、対象書類のみ`driveExportStatus:exported`・`driveFileId`付与を確認（13秒で完了）
5. 状態分布を再確認し、**allowlist制限が正しく機能（exported=1件のみ、他1,286件は無影響のまま0件を維持）していることを実測確認**

**Stage E1実施結果（kanameone canary backfill、2026-07-31、decision-maker「Stage E1に進む」で着手）**:
- インフラギャップ（`--limit`/`--expected-count`/`--manifest-out`もGHA workflow未配線）を追加発見・解消（PR #766、`backfill_limit`入力新設+既存`expected_count`再利用+manifest artifact 90日保持）
- `backfill-drive-export --dry-run --limit 10 --expected-count 10`実行 → 候補10件を確認（期待値と一致）
- `backfill-drive-export --limit 10 --expected-count 10`実行（実書込み）→ マーク成功10件、manifest出力・artifact保存済み（run 30630425182、artifact ID 8793144475）
- 定期スイープ（15分毎）による実処理を待機後、状態分布を再確認: **exported 10件（9件が本canary由来+既存Stage D control test分1件）、error(顧客未確定)1件（同姓同名リスク対応の既存ガード、顧客確定後に自動再試行される想定内の状態）、実エラー0件**。race-safe書込み・manifest出力・スイープ連携が本番で正しく機能することを実測確認

**Stage E2着手・進行中（kanameone全展開、2026-07-31、decision-maker「Stage E2に進める」で着手）**:
- インフラギャップ追加発見・解消: `--limit`なし単独の`--expected-count`choiceがGHA未登録だったためPR #768で追加
- `set-drive-allowlist --remove`実行 → allowlist制限解除（フィールド削除、Stage D/E1時点の制限を撤廃）
- `backfill-drive-export --dry-run --expected-count 1276`で全走査し候補1,276件を確認（期待値と一致）
- `backfill-drive-export --expected-count 1276`実行（実書込み）→ **マーク成功1,276件**、manifest出力・artifact保存済み（runId=1e11a81f-d527-4079-8fa3-dc610717dabc）
- 初回スイープ後(約16分経過時点)のスポットチェック: exported 19件(単調増加を確認)、backfillマーカー残1,256件、error(顧客未確定)6件、**実エラー6件(比率0.5%、異常停止基準20%を大幅に下回り健全)**。実エラー6件の内訳を個別確認し、全て既存データ不備由来(顧客未確定・フリガナ未設定・ケアマネ名未設定・書類日付未設定)でDrive連携コード自体のバグやAmbiguousFolderError等の異常スパイクではないことを実測確認
- 2回目スポットチェック(2026-08-03、GHA `run-ops-script.yml`経由): verified総数1,621件中、exported 1,299件(19件から大幅に単調増加、80.1%)、exporting 0件、error(backfillマーカー)20件、error(顧客未確定)192件、**error(実エラー)109件(比率6.7%、異常停止基準20%を大幅に下回り健全)**、フィールド不在(未backfill)1件でbackfillマーキングはほぼ完了段階。①単調増加②実エラー比率20%未満③異常spikeなし、いずれも異常なしと確認。cocoro側`settings/drive`はFirestore REST APIで直接確認(decision-maker明示許可済み)、`oauthClientId`のみで`authMode`等未設定・`updateTime`も2026-07-23のまま変化なし、Phase C未着手を再確認

**次の一手（監視継続、番号単位の追加認可は不要・自然経過を見守る）**: 定期スイープ(15分毎・10件/回)により残りのbackfillマーカー分が自動でdrainされる。次回セッション/catchup時に`drive-export-status-report`で状態分布を再確認し、①exported数が単調増加しているか②実エラー比率が20%を超えていないか③`AmbiguousFolderError`/`AmbiguousFile Error`等のspikeがないかを確認する。異常時は`set-feature-flag --flag driveExport --value false`で新規停止(in-flightは完走、Drive PDFは自動削除されない)。cocoro側はPhase C（クライアントOAuth接続）が未完了のため対象外、外部依存で待機継続。

**backfillマーカー20件が3日間不変だった根本原因を特定・修正（2026-08-06、PR #804マージ・kanameone/cocoro両環境デプロイ完了）**: 2026-08-03スポットチェックのbackfillマーカー20件が2026-08-06のcatchup再確認でも同数のまま不変だったため、decision-maker指示で調査に着手。Firestore実測（`driveExportSweepState`カーソル位置とerror/exporting全354件のdocId順比較）・Cloud Logging実測（直近実行が毎回`requeued=10`固定、内訳が全て`Drive export failed`）により、`sweepStuckDriveExports()`の`requeued`カウンタが「claim試行の成功」を「exportDocument()の実際の成功」と混同しており、恒久的に失敗し続けるdoc（顧客未確定192件・フォルダ名解決不可等）がdocumentId順で先行するため毎回の実行(15分毎)がその10件だけでBATCH_SIZE上限に達し、backfillマーカー20件（docId順で末尾に集中）へ永久に到達できないstarvationが根本原因と確定。TDDで恒久失敗10件が先行する回帰テストを追加しRed確認後、`requeued`を実際に`exported`へ遷移した件数のみに限定する修正でGreen化（claim成功かつexport失敗は新設の`failed`で別集計）。functions単体テスト2023件・integration13件全PASS、`build`/`lint`0エラー、CI全PASS。PR #804マージ後kanameone・cocoro双方へGitHub Actions経由でFunctionsデプロイ完了（updateTime実測確認済み）。**デプロイ直後のCloud Loggingで修正の有効性を実測確認**（旧: `requeued=10, skipped=0`で1ページ40件中10件しか走査できず早期break → 新: `requeued=1, failed=39, skipped=0`で1ページ40件を丸ごと走査、カーソルがindex 140→209へ一気に前進）。**backfillマーカー20件の完全解消を`ScheduleWakeup`による複数回の自動再確認で実証済み**: 20件(04:22 UTC)→9件(04:32〜06:35 UTC、customer-unconfirmed/real-error 335件の塊をカーソルが順次走査するため一時的に足踏み、カーソルindexの前進自体は継続していることを都度確認し停滞ではないと判断)→**0件（06:37:41 UTCの`requeued=8, failed=16`実行で末尾のbackfillマーカー群を処理し完全解消、07:02 UTC時点でFirestore実測`{"customer-unconfirmed":218,"real-error":117}`とbackfillカテゴリなしを確認）**。デプロイから約3.5時間でPR #804の修正効果が完全に実証された。

**申し送り（次回`/checkup`等の技術的負債点検向け、decision-maker判断待ちのため即着手化しない）**: `sweepStuckDriveExports`のバッチ/カーソル処理ロジックは2026-07-22（cursor未実装→追加、page末尾までの前進によるdoc取りこぼし→lastVisitedId方式へ修正）と今回2026-08-06（claim成功とexport成功の混同）で、同一関数に対し計3回の設計起因バグ修正が発生している。CLAUDE.md Debug Protocol「同一機能に対するバグ修正PRが3件連続→元PRの設計を再レビュー」に該当しうる。今回の調査で追加発見した未修正の残存挙動（正確性には影響しないが効率に影響）: `candidates.size < PAGE_SIZE`条件でのカーソルリセットが早期break時にも無条件発火するため、docId順で末尾かつ大量の恒久失敗docに隣接する少数doc群がある場合、複数回のスイープ往復が必要になりうる（今回のPR #804で実害は解消済みだが、将来同型のdoc分布が再現した場合に処理が遅延する可能性は残る）。設計の再レビュー要否はdecision-maker判断。

**副次的に残る判断事項**:
- PR-D4 Phase A（read-only監査）: genesis provenance実装により`processed/`配下の残課題（495件、Issue #432被害候補）の真の救済可能性を把握する価値は残るが、優先度は下がった（96%はgenesisで既に解消見込みのため）

---

**対象タスク（旧、参考）**: kanameone Drive連携OAuth不具合対応（2026-07-29発生）→ **kanameone側は解消・接続完了を実測確認済み（2026-07-31 catchup時点）**

**経緯**: kanameone担当者から「認証コードが無効または期限切れです」との不具合報告を受け調査、真因（`drive.googleapis.com`未有効化）を特定し、kanameone/cocoro/dev全3環境で`gcloud services enable drive.googleapis.com`を実行済み。再発防止（PR #756）・GOAL.md教訓化（PR #757）・副次バグのIssue化（#755）は完了。kanameone担当者へ再検証依頼文書（コピーボタン付きHTML、ローカル生成、リポジトリ非管理）を作成しdecision-makerが送付済み（2026-07-29）。

**2026-07-31 catchupでの実測確認結果（read-only検証コマンド実行）**:
- `gcloud functions logs read exchangeDriveAuthCode`（kanameone）: `2026-07-30 03:26:19`/`03:26:52`に`Drive OAuth connected successfully for: katsumihiraide@kanameone.com`を確認（2026-07-29 05:39の失敗ログとは別の新しい成功ログ）
- Firestore `settings/drive`（kanameone）: `authMode: oauth`、`connectedEmail: systemkaname@kanameone.com`、`rootFolderId`・`template`（かなめ式5階層）ともに設定済み、`updateTime: 2026-07-30T08:54:59Z`
- **kanameoneはPhase C（OAuth接続＋フォルダ選択＋テンプレート保存）を完了済み**
- 一方**cocoro側は`settings/drive`が2026-07-23（Phase Bインフラ準備時点）のまま未変更**、`authMode`等は依然未設定。cocoroのPhase Cは未着手

**次の一手**: cocoro担当者からのPhase C実施（OAuth接続・フォルダ選択・テンプレート保存）を待つ。着手を促す連絡は現時点では見送り（decision-maker判断、2026-07-31）。cocoro側が動いたかは以下の検証コマンドで確認可能。

**検証コマンド**（次回再開時、cocoro Phase C進捗確認）:
```bash
gcloud functions logs read exchangeDriveAuthCode --project=docsplit-cocoro --account=hy.unimail.11@gmail.com --region=asia-northeast1 --gen2 --limit=20
curl -s -X GET -H "Authorization: Bearer $(gcloud auth print-access-token --account=hy.unimail.11@gmail.com)" "https://firestore.googleapis.com/v1/projects/docsplit-cocoro/databases/(default)/documents/settings/drive"
```

**次のアクション**: cocoro Phase C（外部依存）のtrigger（先方の接続完了、`settings/drive.authMode`書込みで検知可）待ち。kanameone側はPhase Cが完了したため、Phase D（flag ON・backfill本実行）着手の是非をkanameone単独先行 or cocoro待ち継続のいずれにするかはdecision-maker判断待ち（未着手、番号単位の明示認可が必要）。将来ニーズとして「顧客マスター手動統合UI」が話題に上ったが、Drive Phase1がflag OFFの現状では実装の緊急性なし、Phase C/D完了後にDriveの実挙動を見てから設計する方針（実装は未着手・メモのみ）。

**フォローアップ課題（Issue #753、2026-07-31対応完了・PR #773でクローズ済み）**: PR #752の`/code-review low`で「別人がスペース違いのみで同一漢字名の場合に誤って同一フォルダへ収束するリスク」が指摘され調査・対応した。`findSameNameCollisionNames`にスペース表記ゆれ正規化を追加、`DocumentDetailModal.tsx`の候補一覧同期も実施（詳細は「進行中のtasks」該当項目参照）。`codex review`のP1指摘（BE Drive export gate側は本PR対象外でtrim-onlyのまま）を受け**Issue #774**（P2・実例未確認、BEゲート正規化の設計要検討）へ切り出し済み。

**（アーカイブ済み、参考）**「同姓同名プロアクティブ通知UI追加」はPR #731/#732/#733/#736/#738の5PR全てマージ済み・dev/kanameone/cocoro全環境反映完了、詳細は上記チェックリスト該当項目参照。

**判明した技術的知見（次回セッションへの申し送り、期限なし）**: `switch-client.sh <alias>`実行後、Bashツールのセッションに環境変数`CLOUDSDK_ACTIVE_CONFIG_NAME`が古い値のまま固定的に残留し、`.envrc.client`を書き換えても新しいBashコマンド呼び出しのたびに古いconfigが優先されてしまう現象を確認。**2026-07-28に双方向で再現・対処法の有効性も実証済み**: 前回はdevへ戻す際に`kanameone`が残留、今回は`cocoro`へ切り替える際に逆に`doc-split`(dev)が残留（いずれのケースも`~/.config/gcloud/active_config`ファイル自体は正しく切り替わっている）。原因未特定（direnvのキャッシュ無効化が`.envrc.client`のsource先変更を検知していない可能性）。対処法`unset CLOUDSDK_ACTIVE_CONFIG_NAME && gcloud config configurations activate <正しいconfig名>`は2回とも問題なく機能した。次回gcloud操作時も`gcloud config configurations list`で意図した環境がTrueになっているか要確認、ズレていれば同コマンドで都度是正すること。

---

**Phase C（クライアント側OAuth接続、外部依存）の状態が進展**: decision-makerがkanameone/cocoroの代理対応者へ操作案内文書を送付済み（2026-07-25）。executor代行不可のため、先方の実施（Google Drive OAuth接続・フォルダ選択・テンプレート保存）を待つ。安全性検証・UX懸念解消・全環境デプロイは完了済み。**Phase D（flag ON・kanameone 876件/cocoro 93件のbackfill本実行）には、Phase C完了確認後、番号単位の明示認可で別途着手すること**（現在flag OFFのため実害なし、急ぐ理由なし）。

**検証コマンド**（次セッション再開時、Phase Cの進捗確認）:
```bash
gcloud functions list --project=docsplit-kanameone --account=hy.unimail.11@gmail.com --format="table(name,updateTime,state)" | grep -i drive
gcloud functions list --project=docsplit-cocoro --account=hy.unimail.11@gmail.com --format="table(name,updateTime,state)" | grep -i drive
# Phase C進捗確認（クライアントが接続済みか、settings/drive.authModeの有無）: decision-maker明示許可を得たうえでFirestore REST APIまたはFirebase Consoleで確認
```

**参考（解消済み、Drive Phase1 (MVP)本体ミッションの中断点）**: 「すぐ直す」10件実装後の`/code-review xhigh`検出14件のうち自セッション実装由来6件は修正済み・PR #700にマージ済み。残り8件は影響度が低い、または既存設計判断としてGOAL.md「Google Drive連携Phase1完遂」節に記録済み。

この後decision-maker依頼で`/code-review high`（同ブランチ全体、2回目）を実施し10件検出。うち自セッション実装（#2の分散ロック）自体の不備2件+#3同日修正の対称性漏れ1件はdecision-maker承認（上位3件を今修正）を得て即修正、2コミット（3c3cc6d, 7a459ca）に分割済み。functions unit1909/integration223全PASS確認済み:
- **fencing token追加**（findOrCreateFolder.tsのロックにexecuteDriveExport.tsのdriveExportRunIdと同型のトークンを追加。従来は`claimedAtMs`のみでrelease時に無条件delete()しており、staleと誤判定されロックを奪われた後、元ホルダーのfinally節が新しい保有者のロックまで削除してしまいロックの意味を失っていた）
- **ロック獲得後の再検索での曖昧判定**（2件以上見つかった場合もpre-lock検索と同様にAmbiguousFolderErrorで停止するよう修正。従来は`length>=1`のみで曖昧な状態を見逃していた）
- **documentCategoryのtrim対称性**（careManager/customerNameは直前コミットでtrim済みの値を以降すべて使うよう修正したが、documentCategoryはガード判定のみtrimしておりonlyForCategories一致判定・実際のフォルダ名生成はuntrimmedのままだった）

残り7件（rules guardのスコープがsettings/drive限定でなくsettings/{settingId}全体に効いている・create時のresource.data null評価・driveFolderLocksコレクションのTTL/掃除機構欠如・軽微なコード重複等）は影響度が低い、または現状ライブトリガーが存在しないlatentな懸念と検証済みのため記録のみ。

この後decision-maker承認で`origin`へpush（43コミット、`cf7bdea..509e43a`）+ PR #700作成（ADR-0022 Phase1全体、56ファイル・+7458/-168・45コミット）。post-pr-review.sh hookがlarge tier判定→decision-maker承認で`/review-pr`（pr-review-toolkit 5エージェント: code-reviewer/pr-test-analyzer/comment-analyzer/silent-failure-hunter/type-design-analyzer）+ `codex review`（MCP）も実施。新規に4件発見・即修正、4コミット（3a6409a, 380daae, 92002cb, bafe17d）:
- **codex指摘・最重要**: exchangeDriveAuthCodeのOAuth再接続で、refresh tokenの疎通確認(fetchConnectedEmail)より先にSecret Manager保存(setSecret、新バージョンが即座に`latest`昇格)していたため、疎通確認失敗時(別アカウント宛の誤ったtoken等)でも実際のエクスポート処理は新しい未検証tokenを使ってしまうsplit-brainリスクがあった。疎通確認を保存より先に行う順序へ修正
- **silent-failure-hunter指摘**: findOrCreateFolderのfinally節`releaseFolderLock()`がtry/catch無しで、解放処理自体の失敗がtryブロックの成功時戻り値や元のエラーを握りつぶす問題を修正(rules/error-handling.md §1準拠)
- **comment-analyzer指摘2件**: backfill-drive-export.tsのdocstring内キリル文字混入(флаg→フラグ)/ retryDriveExport.tsの「Task13で実装予定」という前方参照が同一ブランチで既に実装済みになった後も未更新だった陳腐化コメントを修正
- **/review-pr(code-reviewer)指摘**: FolderCreationInProgressErrorの自動リトライが「次回スイープ(15分)」を示唆するコメントだったが実際は`DRIVE_EXPORT_ERROR_RETRY_THRESHOLD_MS`(1時間)が適用される誤解を招くコメントを修正

functions unit1909/integration224全PASS確認済み。5エージェント+codexの残りの指摘(driveExportScheduledのフラグチェックが未テストのwrapper層のみ/SettingsPage.tsx(~400行)がテスト0件/backfill scriptのライブclaim競合/lockのstale閾値超過時はfencing tokenでも二重作成自体は防げない等)は影響度・工数を鑑み今回は見送り、記録のみ。

**（更新済み・2026-07-22）**: この4コミットは同日中にoriginへpush済み、PR #700作成（ADR-0022 Phase1全体、56ファイル・+7458/-168・45コミット）まで完了していた。その後`/review-pr`+`codex review`で新規4件検出・修正（下記参照）を経て、2026-07-22にPR #700はmainへマージ済み（詳細は本ファイル冒頭「現在のミッション」参照）。

dev環境のFirestore `settings/drive`は実際に`hy.unimail.11@gmail.com`と連携済み・`rootFolderName:'事務'`・`template`にかなめ式5階層が設定された状態のまま。`settings/features.driveExport`はE2E確認のため`true`に設定し、decision-maker判断で維持中（今後もdev環境をDrive機能の継続動作確認に使う想定）。

### `/code-review`指摘 計23件のtriage完了（2026-07-22実施）→ 【すぐ直す】10件は実装完了（同日）
上記3セクションの各タスクに【すぐ直す】/【様子見】/【対応不要】タグを付与済み（PLAUSIBLE2件は据え置き扱い）。内訳:
- 【すぐ直す】10件 → **全件実装完了**（#68はE2E疎通確認で実機確認完了・解消済み。詳細は「進行中のtasks」の各項目・下記実装サマリ参照）: useDocumentVerification stale状態(#42) / feature flag OFF→ON時の既存verified document回収不能(#43、バックフィルスクリプト新設) / driveExportScheduled 40件上限(#44) / fileDate nullクラッシュ(#45) / careManagerName空白フォルダ名(#46) / exchangeDriveAuthCode Partial Updateテスト欠如(#48) / リトライ成功メッセージ即消失(#63) / handleRetry catch時キャッシュ無効化漏れ(#64) / failed-precondition素通しのGmail回帰(#65) / documentCategory空文字ガード欠如(#66)
- 【様子見】7件（未着手、次回セッションでtriage）: firestore.rules削除ガード多層防御(#47) / resolveDriveFile trashed内容未更新(#53) / exchangeDriveAuthCode非atomic書込み(#54) / GoogleDriveConnect連打(#55) / Picker不正応答固着(#56) / resolveFolderSegments exhaustiveness(#57) / findOrCreateFolder異docId間排他制御(#67)
- 【対応不要】4件: useGooglePickerScript cleanup欠如(#58、実害軽微と検証済み) / クリーンアップ・効率化4件束(#59、機能影響なし) / useRetryDriveExport document query無効化漏れ(#69、現状実害なし)
- 据え置き2件: PLAUSIBLE(#49 verified維持編集での再エクスポート未トリガー、#69は上記に含む) はdecision-maker判断待ちのまま

### 【すぐ直す】10件 実装サマリ（2026-07-22、plan mode承認済み計画 `/Users/yyyhhh/.claude/plans/luminous-herding-jellyfish.md` に基づく実装）
1. `functions/src/drive/folderPath.ts` + `exportDocument.ts`: `CareManagerMissingError`/`DocumentCategoryMissingError`/`FileDateMissingError`を既存`FuriganaMissingError`と同型で追加(#45,#46,#66)。テスト7件+統合テスト1件追加。commit `24f2de5`
2. `functions/src/drive/driveExportScheduled.ts`: `orderBy(FieldPath.documentId())`+`internal/driveExportSweepState`カーソルでページネーション追加、40件上限starvationを解消(#44)。テスト2件追加。commit `b42d8de`
3. `scripts/backfill-drive-export.ts`(新設): feature flag OFF→ON時の既存verified documentバックフィル(#43)。新規Cloud Functionは作らず既存の`error`状態リトライ経路を再利用(`updatedAt`バックデート)。ADR-0022更新、`run-ops-script.yml`登録。エミュレータで動作確認済み(実dev/kanameone/cocoro本実行は未実施、decision-maker承認後に別途実施)。commit `365343a`
4. `functions/src/drive/exchangeDriveAuthCode.ts`: `retryDriveExportCore`と同型のDIリファクタでテスト可能化、Partial Updateテスト5件追加(#48)。`exchangeGmailAuthCode.ts`と合わせてOAuthエラーメッセージを日本語化しGmail回帰を解消(#65)。commit `a963e9a`
5. `frontend/src/hooks/useDocuments.ts`+`useDocumentVerification.ts`: `getDriveExportClearFields()`共通ヘルパー抽出、`markAsUnverified`に適用しstale状態を解消(#42)。commit `28e6d9e`
6. `frontend/src/pages/ErrorsPage.tsx`+`useDriveExportErrors.ts`: リトライ結果表示をsonner toastへ移行(#63)、失敗時キャッシュ無効化を追加(#64)。commit `eafa914`

**検証**: functions unit1911件/integration204件/rules88件、frontend466件、tsc(functions/frontend両方)clean、lint(functions)0 errors(既存any型警告88件のみ、変更なし)、`vite build`成功。ブラウザ実機確認は未実施（次回セッション、または`/code-review`後に判断）。

### E2E疎通確認で新規発見した緊急課題 → 恒久対応完了（2026-07-22）
- [x] **STORAGE_BUCKET環境変数がdev環境のDrive関連Functions 3件に未設定だった問題**（`functions/.env.doc-split-dev`が存在しなかったため）。緊急パッチ（`gcloud run services update`）で当座を凌いだ後、恒久対応を実施:
  - **原因の全体像**: 実は同根本原因（`admin.initializeApp({storageBucket: process.env.STORAGE_BUCKET})`がdotenvファイル依存）は2026-07-08に`ocrProcessor.ts`の再ダウンロード経路で一度発覚済みで、`.github/workflows/deploy-functions.yml`（GitHub Actions経由のCI/CDデプロイ）は既に`scripts/clients/<alias>.env`のSTORAGE_BUCKETを単一の真実源として`functions/.env.<project-id>`を毎回動的生成する修正が入っていた。しかし**ローカルデプロイ用の`scripts/deploy-to-project.sh`にはこの修正が反映されておらず**、2026-07-21のDrive関連Functions初回デプロイ（`./scripts/deploy-to-project.sh dev --full`、ローカル実行）がこの隙間を突いて発生した
  - **恒久対応**: `scripts/deploy-to-project.sh`の`--full`デプロイパスに、CI/CDと同じロジック（`scripts/clients/<alias>.env`のSTORAGE_BUCKETで`functions/.env.<project-id>`のSTORAGE_BUCKET行のみを毎回更新、既存の他設定(kanameoneの`GEMINI_MODEL_ID`ピン留め等)は保持）を追加。合わせて`functions/.env.doc-split-dev`（新設）・`functions/.env.docsplit-kanameone`（STORAGE_BUCKET追記）・`functions/.env.docsplit-cocoro`（新設、Drive Functions未デプロイだが先行整備）の3ファイルを作成（すべてgitignore対象のローカル専用ファイル、既存の`.env.docsplit-kanameone`と同じ慣習）
  - **検証**: `firebase deploy --only functions:onDocumentWriteDriveExport,functions:retryDriveExport,functions:driveExportScheduled -P dev`を実行し、ログで`Loaded environment variables from .env.doc-split-dev.`を確認、デプロイ後の3関数のSTORAGE_BUCKET設定を`gcloud functions describe`で確認、さらに`seed-doc-0005`で再エクスポートのスモークテストを実施し`driveExportStatus:'exported'`+`driveFileId`付与を確認。これで緊急パッチ（Cloud Run直接操作）から正規のデプロイフローへの移行が完了し、今後`firebase deploy --only functions`を実行しても消失しない
  - kanameone/cocoroはDrive関連Functions未デプロイのため実害はまだ発生していないが、将来のPhase1クライアント展開時にこの恒久対応が効いてくる

PR #700は2026-07-22にmainへマージ済み（マージコミット `aa2d827`）。次ミッション候補: exchangeDriveAuthCodeCore Firestore書込み失敗時のsplit-brain再発への対応要否判断、backfill-drive-export.tsのkanameone/cocoro本実行（Drive Phase1展開後に改めて実施）、kanameone/cocoro環境へのPhase1展開検討。

## 参考: 前ミッション期のfollow-up候補（triage未実施、Drive連携完了後に再検討）
- GitHub Actions workflow（run-ops-script.yml）に`--concurrency`オプションのUI経由指定を追加
- `runWithConcurrency`が`compare-gemini-ocr-models-confirmed.ts`/`compare-ocr-arbitration-logic-confirmed.ts`/`backfill-detail-subcollection.ts`と重複、`scripts/lib/concurrency.js`への共通化検討
- ホットトークン（同一tokenId）への書込み競合をtokenId単位のmutex/キューで構造的に防ぐ設計
- `documents_search_update` stageのcatch/stage-taggingロジックの単体テスト追加
- `--batch-size`と`--concurrency`が独立した軸として機能することの明示的なテスト追加
- Firestoreバックアップ（2026-04-10初回設定済み）の継続稼働状況を、GitHub Actions経由のSA権限で確認する仕組みが未整備（ローカルCLI認証・ADC双方で403、次回SA権限確認 or 確認スクリプト整備が必要）
