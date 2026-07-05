# ハンドオフメモ

**更新日**: 2026-07-05〜06 session97（Issue #546 dev環境実データ検証完遂 + #548-B1 要約遅延化 実装完遂・dev環境デプロイ完了。Net 0、既存Issue #251/#548へ追記のみ）

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

Phase 8 完了+追加実装運用中。#432系/#402/#504/#492 close済。429 resilience（ADR-0017）Accepted。kaname要望B〜Fは**E（#526）のdev実装まで完了**、残りはkanameone/cocoro展開判断のみ。**コスト圧縮トラック（#546〜548）は#546 close済+#548-B1完了、次は#547事前計測または#548 3.5移行（期限2026-10-16）**。

## 直近の変更（session89〜96、簡潔に）

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

| # | タスク | ROI | 工数 | 完了条件 |
|---|--------|-----|------|---------|
| 1 | **#547 事前計測（フィールド別バイトサイズ分布）** | 削減見込み（egress ¥4,645→¥500〜1,000）の確度確定。設計の入力。#546/#548-B1完了によりコストトラック次の手番 | 30分 | 実docサンプリング結果をIssue #547にコメント記録 |

### 条件待ち（明示 trigger 付き）

| # | 項目 | trigger | 充足時のタスク | 確認方法 |
|---|------|---------|--------------|---------|
| 1 | **#526 kanameone/cocoro展開**（これで#526 close） | decision-makerの番号単位展開認可 | `/deploy` 3点セット（functions+hosting+rules）。kanameone=`deploy-to-project.sh --full`、cocoro=SKILL.md記載の3経路。展開直後の分割操作自粛アナウンス+実データでOCR補完確認（Issue #526「展開時の注意」参照） | user指示 |
| 2 | #547 実装着手 | 詳細設計（スキーマ/移行手順/dual-read計画）+**ADR作成+Codexレビュー完了**（destructive migration規約） | 新規doc新構造→backfill→dual-read→検証→削除（最終・数週後）。dev→cocoro→kanameoneの段階展開 | 設計doc+Codexレビュー記録 |
| 3 | #548 3.5移行スイッチ | ~~#546完了~~**（充足）**+~~B1完了~~**（充足、PR#553でmerge）**+dev seedでの2.5vs3.5 A/B PASS。**期限2026-10-16** | modelId切替+`thinking_level:low`+価格定数更新 | A/B結果 |
| 4 | #548-B4 再処理「再突合のみ」モード | UI仕様のdecision-maker判断 | 2モード化実装 | user回答 |
| 5 | #539/#540（P2バグ） | 明示指示 or 実害観測 | 各Issue参照 | `gh issue view` |
| 6 | 継承事項: PR#474 close / `.artifacts/` 扱い / #503・#251・#238 | decision-maker明示指示（全て前session94から継続、トリガー未充足） | 各項目参照 | — |
| 7 | doc-audit指摘（2026-07-05）: CLAUDE.md肥大化（207行）の`.claude/rules/`切り出し | decision-maker判断（要否・切り出し範囲） | L187-207マルチクライアント運用セクションを`.claude/rules/multi-client-operations.md`へ移設 | `docs/audit/2026-07-05-document-audit.md` §3.2参照 |

### 却下候補（記録のみ）

| 項目 | 経緯 | 着手しない理由 |
|------|------|--------------|
| OCR出力のエンティティリスト化（−¥11,000/月級） | コスト分析で最大レバーと特定 | 突合品質の厳密A/B実証が前提=品質不劣化制約に抵触しうる唯一の施策。**3.5移行後の実測を見てdecision-makerが判断する保留カード**（#548に記録済み） |
| processOCR head-of-line blocking対策 | Codex指摘で実在確認（BATCH_SIZE=5固定） | 実害未観測。分割多用でpending滞留が観測されたら別Issue化（#526本文に監視事項として記録済み） |
| PWA更新バナー実装 | 展開時リスクとして一時検討 | `vite.config.ts`実査でSWは登録のみ（キャッシュなし）と確認、通常のSPAバージョンスキュー程度のため不要と判定済み |

> ⚠️ 包括指示（「進めて」等）で動けるのは即着手タスクのみ。**次セッションのモデルはSonnet 5を想定**（Fable 5は2026-07-07失効）。

### 最終結論（session97末尾）

✅ **セッション終了可**

- OPEN PR: 0件（#552/#553はmerge済close） / active Issue: #547〜548（コストトラック、#548はB1完了・3.5移行本体は残存）+ #526（展開待ち）+ #539/#540/#503/#251/#238（トリガー待ち）。#546はclose済み（session96）
- Git: `.serena/project.yml`（意図的未コミット保持、継続）+ `.artifacts/`（untracked、扱い未指示、継続）のみ
- 残留プロセス: なし
- CI/Deploy: PR #552/#553とも全CI PASS、mainマージ後のdev環境自動デプロイ成功確認済み（#553分はDeploy workflow success確認済み）
- Issue Net変化: close 0件 / 起票 0件 = Net 0。ただし#546実データ検証完遂+#548-B1実装完遂という実質的進捗があり、いずれも「既存openIssueのサブタスク完了」（#546は前セッションでclose済、#548は3.5移行本体残存のため意図的open維持）としてIssue単位のNetには表れない
- §4.6 同根再発スキャン: 過去7日のhandoffアーカイブ・関連PR履歴を検索し候補0件（`getReprocessClearFields()`絡みの過去言及はerrorRescueCount追加という無関係な話題での偶発的キーワード一致のみ）
- §4.7 対症療法判定: 該当基準0件。要約不整合バグは`getReprocessClearFields()`/429自動rescue/`fix-stuck-documents.js`のソース直読で根本原因を完全特定し構造修正済み、外部要因なし
- 既知の未検証事項（次セッション以降の参考）: pr-test-analyzerが指摘した「`processDocument()`のsummary無効化のランタイム統合テスト欠如」はIssue #251に追記済み（新規Issue化はせず）。着手はdecision-maker判断待ち
