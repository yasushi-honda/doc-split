# ハンドオフメモ

**更新日**: 2026-07-05 session96（Issue #546 計測基盤+SDK移行+thinking制御 実装完遂・dev環境デプロイ完了。Net -1、close #546のみ）

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

Phase 8 完了+追加実装運用中。#432系/#402/#504/#492 close済。429 resilience（ADR-0017）Accepted。kaname要望B〜Fは**E（#526）のdev実装まで完了**、残りはkanameone/cocoro展開判断のみ。**次の主戦線はコスト圧縮トラック（#546〜548、3.5 Flash移行期限2026-10-16）**。

## 直近の変更（session89〜95、簡潔に）

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
| 1 | **#546 dev環境での実データ検証**（ユーザー明示指示、session96末尾） | Issue #546の絶対制約（マスター突合精度劣化ゼロ）を実測確認する唯一の手段。#547/#548の前提でもある | 未知数（実文書の流入待ち含む） | ①`stats/gemini/daily/{today}`で`bySource.ocr.thinkingTokens`が0近辺であることを確認 ②少数サンプルのOCR抽出結果（顧客名/事業所/書類種別/日付）が精度劣化していないことを目視確認 ③問題があれば`GEMINI_OCR_THINKING_BUDGET=-1`環境変数設定→functions再deployで即ロールバック |
| 2 | **#548-B1 要約の遅延生成化** | −¥650/月(現行)→−¥3,000/月(3.5後)。既存`regenerateSummary` onCall転用で最小工数。品質影響ゼロ（要約は突合と構造的に独立） | 0.5日 | `processDocument()`の自動要約スキップ+FE「要約を生成」ボタン+dev実機確認 |
| 3 | **#547 事前計測（フィールド別バイトサイズ分布）** | 削減見込み（egress ¥4,645→¥500〜1,000）の確度確定。設計の入力 | 30分 | 実docサンプリング結果をIssue #547にコメント記録 |

### 条件待ち（明示 trigger 付き）

| # | 項目 | trigger | 充足時のタスク | 確認方法 |
|---|------|---------|--------------|---------|
| 1 | **#526 kanameone/cocoro展開**（これで#526 close） | decision-makerの番号単位展開認可 | `/deploy` 3点セット（functions+hosting+rules）。kanameone=`deploy-to-project.sh --full`、cocoro=SKILL.md記載の3経路。展開直後の分割操作自粛アナウンス+実データでOCR補完確認（Issue #526「展開時の注意」参照） | user指示 |
| 2 | #547 実装着手 | 詳細設計（スキーマ/移行手順/dual-read計画）+**ADR作成+Codexレビュー完了**（destructive migration規約） | 新規doc新構造→backfill→dual-read→検証→削除（最終・数週後）。dev→cocoro→kanameoneの段階展開 | 設計doc+Codexレビュー記録 |
| 3 | #548 3.5移行スイッチ | ~~#546完了~~**（充足、PR#550でclose）**+dev seedでの2.5vs3.5 A/B PASS。**期限2026-10-16** | modelId切替+`thinking_level:low`+価格定数更新 | A/B結果 |
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

### 最終結論（session96末尾）

✅ **セッション終了可**

- OPEN PR: 0件（#550はmerge済close） / active Issue: #547〜548（コストトラック）+ #526（展開待ち）+ #539/#540/#503/#251/#238（トリガー待ち）。#546はclose済み
- Git: `.serena/project.yml`（意図的未コミット保持、継続）+ `.artifacts/`（untracked、扱い未指示、継続）のみ
- 残留プロセス: なし
- CI/Deploy: PR #550のCI（lint-build-test/GitGuardian/CodeRabbit）全PASS、mainマージ後のdev環境自動デプロイ成功確認済み
- §4.6 同根再発スキャン: 過去7日のhandoffアーカイブ・関連PR履歴を検索し候補0件。本セッションのfixコミットは同一PR内で発見・修正した新規バグ（過去セッションからの再発ではない）
- §4.7 対症療法判定: 該当基準0件。SDK移行によるエラー形状変化はSDKソースコード直読+実機fetch()検証で根本原因を特定済み
- doc-audit（2026-07-05）: 総合B+(85%)、高優先度指摘（本ファイルの追随遅延）は本エントリで解消。中優先度指摘（frontmatter日付2件・リンク切れ1件）も本セッションで対応済み
