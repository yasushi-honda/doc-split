---
updated: 2026-07-16
---
<!-- session134: 新ミッション着手。前ミッション(Issue #664 phantom count恒久修正、ADR-0021)はsession133で完全達成済み(全文はdocs/handoff/LATEST.md session133サマリ参照予定、git history PR #669/#670/#671でも追跡可)。本ミッションは前ミッションの発端だった「複数顧客FAX複製機能」の設計相談の本体で、Issue #664解決によりブロッカーが除去されたため着手。kanameone現場(平出さん)の要件確定(2026-07-16受領): ①複数利用者記載FAXは検出人数分複製して各利用者フォルダへ配信、後からCMが手動分割 ②担当CMタブの利用者配下フォルダ表記を書類種別名→カテゴリ名に変更(タスク2で完了・PR #672)。 -->

## 現在のミッション

kanameone現場要件「複数顧客FAX複製機能」を実装する。OCRで複数の顧客候補を検出した受信FAXを検出人数分複製し、各コピーに異なるcustomerIdを割り当てて各利用者フォルダへ配信する(後から担当CMが手動分割で整理する運用)。カテゴリ表記化(要件②)はPR #672で完了済み。

## 背景・why

- 発端はsession133の設計相談。「ページ分割の自動提案は精度が低いため、複数利用者記載のFAXは分割せず全員に同じものを配信し、後で担当CMごとに操作してもらう方が良い」という現場提案(decision-maker経由)。前提整備としてIssue #664(create/delete順序不同のphantom count)をADR-0021(materialized projection)で先行解決済み
- 2026-07-16に現場(平出さん)から要件が確定: 「利用者3名が記載されている4ページのFAXが届いた際、3名それぞれのフォルダに4ページのファイルが届くようにしてほしい。あとで手動で分割作業をするイメージ」
- 実装前のFE/BE横断影響調査完了(session134、Explore 4並列)+ `/impl-plan`(フルモード)+ Codexセカンドオピニオン(plan mode, effort=high)を経て設計確定

### 設計確定の経緯

1. **影響調査(session134)**: cleanup-duplicates.jsがfileName単独判定のため複製コピーを誤削除する破壊的リスク(実コード確認済み)、複製注入点はOCR後(ocrProcessor最終tx内)が推奨=Gemini課金N倍回避、searchIndexerのgetAll未chunk化(kanameoneで512MiB OOM 201件既発)の前倒し対応が事実上必須、再処理経由の再複製無限ループのガード必須
2. **Codexセカンドオピニオン(Critical指摘、実コード裏取りで確認)**:
   - `getReprocessClearFields()`(useDocuments.ts:23-24,43)は`customerId`/`customerName`/`customerConfirmed`をクリアする実装であることを確認。コピーを再処理すると割当が消え元doc候補1に誤上書きされる、という指摘は事実 → **修正必須**
   - `matchType==='exact'`(extractors.ts:284 `matchingText.includes(normalizedDocName)`)は正規化テキストの部分文字列一致であることを確認。家族名等の偽陽性リスクは実在 → `!isDuplicate`+customerId重複排除+判定ログで緩和
3. **Fable5レビュー(Codex案からの簡素化)**: 新フィールドは`distributionId: string`1本のみ(元doc/コピー全メンバーに付与、`doc.id===doc.distributionId`で元doc判定)。双方向配列(`duplicatedFrom`/`duplicatedInto`)は削除時に孤児化するため不採用。`distributionStatus`等の新規statusフィールドも不採用 — 既存の`verified`(人手確認済みか)+`confirmedBy`(自動時null)で「自動配信/要整理」の識別は導出可能なため、既存プリミティブの重複実装を避けた

## 採用設計

### D1: 複製注入点 = OCR後
`ocrProcessor.ts`最終トランザクション内(478-531行相当)。OCRは1回のみ実行し、結果を候補人数分のdocへ展開する。Gemini課金はN倍化しない。

### D2: Storage実体 = 共有
全コピーが同一`original/`のfileUrlを参照(独立コピーにしない、容量N倍を回避)。既存の`deleteDocument`共有fileUrl fail-closedガードを活用。gmailLogs**と**uploadLogsの削除は`(sourceType, fileId)`単位で他doc残存チェックを追加(Codex指摘#5、uploadLogsは見落としだった)。

### D3: 複製トリガー条件
`matchType==='exact' && !isDuplicate`の候補が2件以上 → customerIdで重複排除した上で全員に配信。構造化ログ(候補・スコア・配信数)を残し初週の過剰/過少配信を観測可能にする。flag OFF時は現行どおり`needsManualCustomerSelection`の手動選択フローのまま(同一条件の分岐として自然に書ける)。

### D4: 複製識別フィールド = `distributionId`1本
元doc・全コピーに同一値を付与。双方向配列は持たない(削除時の孤児化を構造的に回避)。兄弟一覧は`where('distributionId','==',X)`で導出。コピーを手動分割した場合、生成される子docへ`distributionId`は伝播しない(配信マーカーの役目は完了、子は顧客固有の精製物)。

### D5: 元doc/コピーの状態
`customerConfirmed:true`+`confirmedBy:null`+`verified:false`で生成(新規statusフィールド不要)。「自動配信・要整理」の識別は`distributionId && !verified`から導出、UIバッジ表示もこの式を使う。

### 再処理時のcustomerId保持(Codex Critical#1対応)
`getReprocessClearFields()`に分岐追加: `distributionId`を持つdocは`customerId`/`customerName`/`customerConfirmed`/`careManager`をクリア対象から除外する。既存の`confirmedFieldMerge`保護(customerConfirmed:true時に顧客フィールドを維持する既存機構)がそのまま働き、新しい保護機構は不要。

### コピーpayload構築 = allowlist方式
分割フロー(`pdfOperations.ts`のbatch.set+detail dual-write)を踏襲するが、`ocrRunId`/retry・error状態/`search`/集計キー/split系フィールド(`isSplitSource`等)/provenanceは引き継がない。

### cleanup-duplicates.js対応 = v1中間案
`distributionId`を持つdocは削除対象から除外。同一fileNameグループに複数distributionが混在した場合はWARNで人間にエスカレーション(自動処理はしない)。フル案(distributionId単位のスコアリング削除)は実際の複合事象が観測されてから。

### 件数意味論の下流影響 = 実害なし判定
kanameoneの請求はFirestore egressコストベース(#547)で書類件数ベースのKPI・請求は存在しないため確認済み。現場周知のみで技術対応は不要。

### OCRテキストoffload実体の複製要否(session135実装中判明、D2の適用範囲を精緻化)
D2「Storage実体 = 共有」は複製元の**添付ファイル本体**(`fileUrl`)を指しており、これは設計通り全コピーで共有する。一方、OCR結果が長文でCloud Storageへoffloadされる場合の`ocrResultUrl`(`ocr-results/{docId}/{ocrRunId}.txt`)は**run単位の派生物**であり対象外だった。当初実装ではコピーが元docの`ocrResultUrl`をそのまま引き継いでいたため、元docの以降の再処理(Issue #625成功パスcleanup、docId単位所有前提)が旧オブジェクトを削除すると、コピー側の`getOcrText`が`not-found`になる欠陥があった(Codexセカンドオピニオン`/codex review`指摘、CONFIRMED)。各コピー専用のStorageパスへGCS server-side copyで複製する修正を実施。複製先キーは`newDocRef.id`(transaction自動リトライ毎に非決定)ではなく`${元docId}-${customerId}`(リトライ安定)を採用(CodeRabbit自動レビュー指摘、CONFIRMED)。Issue #625のcleanupロジック自体には一切手を入れていない。

## 完了の定義

- [x] AC-a: 担当CM別タブで利用者展開時のフォルダがカテゴリ名で表示され、カテゴリ未運用環境では従来の書類種別表示にフォールバックすること(証明: PR #672マージ済み、`npx vitest run src/lib/__tests__/buildCustomerFolderGroups.test.ts` 9件PASS + ブラウザスクショ4枚)
- [x] AC-b: exact候補2名以上(!isDuplicate、customerId重複排除後)+flag ON時、documents N件生成(各customerId、各detail/main、共通distributionId)。flag OFF時は複製されず従来どおり1件+needsManualCustomerSelection(証明: `ocrCompletionTransactionIntegration.test.ts` 2候補/3候補ケースPASS)
- [x] AC-c: 複製コピー(distributionId保持)を再処理しても、customerId/customerName/careManagerが不変であること。かつ再複製が発生しないこと(証明: integration test PASS、再処理前後のcustomerId比較アサーション含む。customerConfirmed/verified済みdocの保護もcode-review high指摘で追加)
- [x] AC-d: cleanup-duplicates.jsがdistributionId保持docを削除対象にせず、同一fileName内の複数distribution混在をWARNログで検知すること(証明: `faxDuplicationCleanupHelpers.test.ts` 9件PASS。ops-script-redirect.sh hookによりdry-run実証は不可のためスクリプトテストのみで充足、GOAL.md規定通り)
- [ ] AC-e: searchIndexerのgetAll chunk化後、kanameone展開後にchunkサイズ・1イベント当たりのメモリ使用量・再試行率を観測し、OOMエラーが増加しないこと(証明: getAll chunk化 + デプロイ後のエラーログ確認 + 観測メトリクス)
- [x] AC-f: 分割確認画面の残存バグ(手動修正後の自動検出再実行でsegmentEdits誤適用)が修正されること(証明: PdfSplitModal.test.tsxに再現テスト追加しPASS、PR #678マージ済み(2026-07-17))
- [x] AC-h: 元→コピー、コピー→元のどちらの削除順序でも、Storage実体とgmailLogs/uploadLogsが最後の1件の削除まで残ること。複製コピーを手動分割した場合、生成される子docにdistributionIdが伝播しないこと(証明: `distributionDeleteOrderIntegration.test.ts` + `splitDistributionIdNonPropagationContract.test.ts` PASS)
- [ ] AC-g: 全テスト・lint・型チェック・buildがPASSし、kanameone本番へdistributionId+flag ON展開されること(cocoroはflag OFFのまま展開)(証明: 各コマンド実行結果 + デプロイ記録)
- 不変条件: 複製機能はクライアント別feature flagで制御し、既定OFFで導入する(kanameoneのみON想定)。ADR-0021の集計モデル・ADR-0016のidentity設計(docId namespace)を変更しない。新規statusフィールド(distributionStatus等)は追加しない(既存verified/confirmedByで代替)

## 進行中のtasks

- [x] 0. FE/BE横断影響調査(Explore 4並列: BE/FE/カテゴリ/運用インフラ)+cleanup-duplicates.js破壊的リスクの実コード裏取り
- [x] 1. カテゴリ表記化の実装(B案→レビュー後: カテゴリ解決できない書類は種別名フォルダのまま残す設計)。`buildCustomerFolderGroups.ts`+テスト9件、`CustomerSubGroup.tsx`/`GroupDocumentList.tsx`改修
- [x] 2. カテゴリ表記化のブラウザ確認(#193教訓)+PR作成+/code-review medium(8角度finder、CONFIRMED 6件全て修正)+ui-verifiedラベル+マージ完了。**PR #672マージ済み(2026-07-16)、dev環境へ自動デプロイ済み**
- [x] 3. 複数顧客FAX複製機能の`/impl-plan`フルモード策定+Codexセカンドオピニオン(plan mode)+Fable5レビュー(distributionId簡素化)を経て設計確定。decision-maker承認済み(2026-07-16)
- [x] 4. PR-A: searchIndexerのdb.getAllをチャンク化(独立・先行。既存OOM対策の前倒し、複製導入前の前提)。`/code-review medium`実施(CONFIRMED+PLAUSIBLE各1件修正、残るPLAUSIBLE1件はchunk化以前から存在した既存設計の限界として記録のみ)。**PR #673マージ済み(2026-07-16)、dev環境へ自動デプロイ済み**。kanameone展開後のchunkサイズ・メモリ実測(AC-e)は複製flag ON検討時に実施
- [x] 5. PR-B: 複製本体(BE)。**PR #675マージ済み(2026-07-16〜17, session135)、dev環境へ自動デプロイ済み**。`/code-review high`(CONFIRMED 3件修正)+Evaluator分離(HIGH 1件はtask 6-2へ明示スコープ外化・MEDIUM 1件は3候補テスト追加で対応)+`/codex review`(P1 1件: 複製コピーのOCRテキストoffload実体が元docの再処理で消える問題を修正)+CodeRabbit自動レビュー(実質4件: sourceType複合キー検知漏れ/transaction retry非決定/score契約/cleanup escalated group漏れ、全て修正)を経てマージ。functions unit 1840/integration 145/scripts 103/frontend 345 全PASS
  - [x] 5-1. `shared/types.ts`に`distributionId?: string`追加
  - [x] 5-2. BE feature flag読取ヘルパー(`settings/features.faxDuplication`、scheduled関数向け新設、既定OFF、fail-closed) — `functions/src/utils/featureFlags.ts`
  - [x] 5-3. `ocrProcessor`複製ロジック(exact複数&&!isDuplicate判定+customerId重複排除+構造化ログ→分割フロー踏襲のbatch.set(allowlist payload)+detail/main dual-write+distributionId付与、最終tx内でflag評価) — `applyOcrCompletionTransaction`として`processDocument`から抽出、単体でintegration test可能に
  - [x] 5-4. `deleteDocument`のgmailLogs**と**uploadLogsに`fileId`単位の他doc残存チェック追加(実装当初は`(sourceType,fileId)`複合キーだったが、legacy doc検知漏れのCodeRabbit指摘によりfileId単独照合に変更) — `functions/src/documents/sourceLogDeletionGuard.ts`
  - [x] 5-5. `cleanup-duplicates.js`: distributionId保持docを除外+同一fileName内の複数distribution混在をWARN。fileUrl保護収集は全スナップショットからの事前収集方式に変更(CodeRabbit指摘: escalated/単独fileNameグループの取りこぼし修正)
  - [x] 5-6. integration test(AC-b/AC-c/AC-d/AC-h)
- [x] 6. PR-C: FE表示(型→BE→FEの順序)。**PR #677マージ済み(2026-07-17)**。8角度code-review + review-pr(code-reviewer/test-analyzer) + `/codex review-diff`実施。codex P1指摘(TOCTOUレース: processing中docの一括再処理でdistributionId保護が競合により外れうる)を受け、DocumentsPage.tsxのhandleBulkReprocessにprocessing中doc除外ガードを追加して対応
  - [x] 6-1. `firestoreToDocument`+`useDocumentGroups.ts:189`直キャスト経路へ`distributionId`マッピング追加
  - [x] 6-2. `getReprocessClearFields()`に分岐追加: distributionId保持docは顧客系フィールドをクリア対象から除外
  - [x] 6-3. 詳細画面に「同一FAXをN名に配信・要整理」表示(`distributionId && !verified`から導出、BE flag ONより先行デプロイ)。Firebase Emulator + Playwright MCPでブラウザ確認済み(バッジ表示/非表示の両条件)
- [x] 7. PR-D: 分割確認画面の残存バグ修正(AC-f。独立・並列可、本機能のリリース判定から分離)。**PR #678マージ済み(2026-07-17)**
- [x] 8-1. dev実機検証(session136): decision-maker承認(「dev実機検証のみ着手」)を受け、seed-dev-data.tsにexact3候補(相沢一郎/井上春子/内田健三、いずれもisDuplicate:false)の請求書FAX fixture(`seed_faxdup_test_01.pdf`)を追加+`set-feature-flag.js`新設(feat/task8-dev-verification-fax-duplicationブランチ、GHA run-ops-script経由でdevへ投入・実行、ADCアカウント不一致のためローカルADCは未使用)。dev Firestore `settings/features.faxDuplication=true` を設定し実OCRパイプライン(processOCR)で検証: 3候補全てexact matchで検出され、元doc(customerId:seed-cust-01)+コピー2件(seed-cust-02/03)が共通distributionId(`seed-doc-pending-faxdup-01`)・共有fileUrl・detail/main dual-writeで正しく生成されたことをFirestore実データで確認。該当期間のCloud Functionsエラーログ0件。FEバッジ表示はtask 6-3(PR #677)でEmulator+Playwright確認済みのロジック(`distributionId && !verified`)を再利用するため、今回はBEデータ確認をもって充足と decision-maker 判断
- [ ] 8-2. kanameone展開+flag ON(`/deploy`スキル、decision-maker認可が別途必要) → cocoroはflag OFFのまま展開。PR-Aは複製flag ON前にchunkサイズ・メモリ・再試行率を観測してから次段階に進む(AC-e)

## 🔄 中断点（in-flight）

なし。task 8-1(dev実機検証)完了。dev-tooling(seed-dev-data.ts拡張+set-feature-flag.js)は3エージェントレビュー(code-reviewer/comment-analyzer/silent-failure-hunter)の指摘(flag名typo検知・dry-run・project ID照合の欠如)を修正のうえ**PR #679としてマージ済み(2026-07-17)**。残るは task 8-2(kanameone展開+flag ON)のみで、decision-makerの展開認可待ち。

**申し送り事項**:
- dev環境の`settings/features.faxDuplication`は検証後もtrueのまま(意図的、devは顧客非対面のため実害なし。ただしドキュメント記載の「既定OFF」とdevの実状態は乖離している)
- `set-feature-flag`はGHAドロップダウン(`environment: kanameone`選択)だけで本番flagを切替可能。PRマージと違いworkflow_dispatch自体にhookゲートは無いため、task 8-2実行時は認可が出てから実行すること
- ローカルADCは`hy.unimail.11@gmail.com`以外のアカウントに紐付いたままだが、運用方針上GHA主体でADCはほぼ使わないため修復不要(decision-maker確認済み、2026-07-17)

- 検証コマンド: `git -C /Users/yyyhhh/Projects/doc-split status && git -C /Users/yyyhhh/Projects/doc-split log --oneline -3`
