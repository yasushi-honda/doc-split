# 2026-09 セッション履歴アーカイブ

LATEST.md 60KB超過に伴い、session（Issue #984段階1・2a / Issue #954、2026-09-18〜20）の詳細サマリを移動（2026-09-27 handoff時）。

## Issue #984 段階1・段階2a完了 + kanameoneデプロイ（2026-09-19〜20）

kanameoneの`search_index`で日付由来トークン(`2026`=14,562件で飽和、`26/20/02/60`が11,400〜12,780件)が1MiB上限に達し新規書類が検索に出ない問題(Issue #984)に対応。PR #985〜#989(段階1: fail-soft・検知・復旧、未索引1,723→0)、#990(日付語をfileDateのUTC範囲クエリで検索)、#991(日付由来トークンを索引から除外、削除側の安全化)をマージし、kanameoneへFunctionsをデプロイ(2026-09-20 13:47Z、`OCR_PROVIDER=paddle`維持)。ADR-0026。

**経緯と判断**: 初版プラン(全件force-reindex・GitHub Actions計測オプション・旧形式postings移行・索引掃除を含む)を`/plan-crossreview`(grip+codex 2パス)で改訂したが、実装後にdecision-makerから「利用者は複合条件で検索する、過剰対応では」との指摘を受け、codexにも規模の妥当性を独立に評価させて「最小構成」に絞った(全件再索引・`force-reindex.js`変更・掃除・`df`再計算を行わない)。実データ調査で2000年未満の`fileDate`がkanameoneに522件あると判明(年検索で当たらなくなる)、範囲は2000〜2099のまま(decision-maker判断)。

**検証**: 単体2,262件・統合512件pass、`codex review`(high、PR-B 2回目とPR-A は0件)、pr-review-toolkit・Evaluatorの指摘を実運用での起こりやすさで個別評価。dev実機確認(日付トークン非登録・実Firestoreの範囲クエリ)、kanameone/cocoro事前計測(インデックスREADY・TZなし・fileDate分布)。kanameone実データ確認(2026-09-20 14:26Z、read-only)で、デプロイ後の新規書類に日付由来トークンのpostingがなく、飽和5索引文書は不変、`token skipped`ログ0件を確認しIssue #984をクローズ。その後cocoroへFunctionsをデプロイ(14:52Z、3環境同一コード)、ログベースメトリクス・アラート(`search_index_token_skipped`/`search_index_write_failed`)を3環境へ適用(#981クローズ)、devの画面(認証済み)で日付検索を確認(`2099`→範囲内2件のみ新しい順、`2099-03-10`→1件、通常語+`2099年3月`→2件、日付なしの従来検索も正常、コンソールエラー0件)。クライアント本番は画面操作せずread-only観測のみ。

### Issue Net
Net +2（Close 2件(#984=kanameone実データ確認後、#981=dev/kanameone/cocoroへのメトリクス適用後)・起票0件）。新規Issueは起票していない(FEバナーのフォローアップは未起票)。

### 同根再発スキャン・対症療法判定（handoff §4.6/§4.7）
- **同根候補あり（記録）**: 本セッションの修正PR(#985/#986/#989/#991のテスト修正)のうち「ローカルのテストは通るがCIで失敗」が2回再発(#989: 型注釈`withTimeout`のTS18046、#991: `force-reindex.js`が`functions/lib`のビルド済みトークナイザーを使うのにローカルは`lib`が古いまま)。共通の根本原因はローカル検証がCIの条件(functionsをbuildしてからunit test)と異なること。対策: push前に`npm run build:functions`してから`cd functions && npm test`を実行する(memory `feedback_local_pass_not_ci_build_lib.md`に記録)
- **対症療法判定**: 該当なし。#986/#991は飽和の原因(日付トークン)自体を索引から除外する設計で、retry/fallbackのみの対症療法ではない(段階1のfail-softは暫定策として明示し、根本対応が段階2aという二段構成)

## Issue #954完了: driveFolderClaim.tsの無保護runTransaction11箇所をwithBackoffRetryで防御（2026-09-18）

Issue #947(PR #951)・Issue #952(PR #953)と同型の「`db.runTransaction()`自体の失敗が無保護で例外が無条件伝播する」バグが、`functions/src/drive/driveFolderClaim.ts`(Issue #871フォルダclaimプロトコル)内に11箇所残っていた件（#952完了直後のhandoff同根再発スキャンで発見、Issue #954として起票）に対応した。全11箇所が`tx.set()`(全フィールド置換)のため#947/#952と同一の`update()+precondition`フォールバックは適用できず、plan mode+fable-reviewで設計を再検討し、「`withBackoffRetry`+gRPC transientコード限定`shouldRetry`述語」方式に確定。RESOURCE_EXHAUSTED(gRPC code 8)はCloud Functions timeout接近リスクを理由にdecision-maker承認のうえ外側リトライ対象から意図的に除外した。呼び出し元3箇所(bare awaitで呼び出し元の契約を壊していた箇所)も修正。

**品質保証**: `codex review`が「usage limit」エラーで2回連続失敗(容量超過とは別エラー文言だが、セッション途中でdecision-makerから「事前承認済みの自動fallback対象として扱うべき」と指摘を受け、以後は都度確認なしでfable-review自動切替。memory`reference_codex_capacity_error_recovery.md`の適用範囲をusage limitにも拡張済み)したため、fable-review(設計・実装2回)+`pr-review-toolkit`3エージェント(silent-failure-hunter/pr-test-analyzer/code-reviewer、code-reviewerはECONNRESETで1回失敗し再実行)の計4エージェント並列レビューで代替。CRITICAL 1件(`commitResolvedWithRetry`のリトライ条件統一漏れ)・Medium数件・DRY指摘(claim書込みtransaction11箇所の重複を`runClaimTransaction`ヘルパーへ集約)を反映。tsc/eslint/`test:integration:drive`(197件)/`npm test`(2144件)全PASS確認後、decision-maker番号単位認可でPR #955をsquash merge。

silent-failure-hunterのHIGH指摘(新規3箇所の`.catch()`にログベースメトリクス/アラート基盤が無い、既存`drive_folder_divergent_record_failed`と同型のものが必要)は本PRのスコープ外(transaction保護とは別の運用監視領域)とdecision-maker判断のうえIssue #956へ切り出した。

### Issue Net
Net 0（Close 1件(#954、PR #955の`Closes #954`で自動クローズ)・起票1件(#956)）。#956はrating判定によるレビュー指摘の機械的Issue化ではなく、実在するアラート欠落（silent-failure-hunter HIGH指摘、既存パターンとの一貫性欠如）をdecision-maker承認のうえ切り出したfollow-up。

### 同根再発スキャン・対症療法判定（handoff §4.6/§4.7）
- **同根候補あり（未解消のまま次回持ち越し）**: 本ハンドオフ実施時のスキャンで、`driveFolderClaim.ts`以外にも`db.runTransaction()`使用箇所が8ファイル・11箇所存在すると判明（`triggers/updateDocumentGroups.ts`, `ocr/processOCR.ts`(2箇所), `ocr/documentDetail.ts`, `ocr/ocrProcessor.ts`(3箇所), `utils/groupAggregation.ts`(2箇所), `gmail/checkGmailAttachments.ts`, `upload/uploadPdf.ts`）。簡易grep(直前6行以内の`try {`有無)では保護状況が判定不能なものが複数あり、Issue #954と同水準の個別関数レベル調査(Explore agent+設計判断)が必要。仮説: ①これらは元々別チーム/別時期に書かれたコードで#947/#952/#954と同じ設計原則が及んでいない②OCR系(`processOCR.ts`/`ocrProcessor.ts`)は独自のリトライ機構(`withRetry`/`utils/retry.ts`)を別途持っており実際には保護済みの可能性もある③`groupAggregation.ts`はバッチ集計処理でtransaction失敗時の実害度合いがexport系とは異なる可能性がある。もう1件同根が出るとしたら、`utils/retry.ts`の`isTransientError`がgRPC数値コードの大半(1/2/4/13/14/16)をカバーしていない（ABORTED=10のみ対応、pr955-code-reviewer指摘で判明）ため、これらの経路が`isTransientError`を使って「保護済みのつもり」でも実質無防備な経路として発現しうる
- **対症療法判定**: 基準3(過去30日以内に同症状PRが複数、#951/#953/#955の3件)に該当。ただしWebSearch実施(`@google-cloud/firestore runTransaction unprotected failure regression 2026`)で外部要因(SDK側リグレッション等)は確認されず、内部設計監査による能動的発見であることを確認。修正内容自体も単純なretry追加ではなく、呼び出し元3箇所の契約違反修正・DRY化・decision-maker承認済みのtimeoutリスク判断を伴う構造的対応であり、外部要因対症療法には該当しない

