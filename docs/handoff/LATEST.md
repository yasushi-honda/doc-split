# ハンドオフメモ

**更新日**: 2026-07-05 session95（Issue #526 PR1〜5 dev側完遂 + GCPコスト分析→圧縮プラン策定・#546〜548起票。Net -5、理由は§直近の変更のsession95行参照）

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

### 即着手タスク（すべてdecision-maker承認済みのコストトラック。番号単位認可で順次実行）

| # | タスク | ROI | 工数 | 完了条件 |
|---|--------|-----|------|---------|
| 1 | **#546 計測基盤+SDK移行+thinking制御** | 全施策の効果測定前提+未計測thinking課金の即遮断。#547/#548の前提 | 0.5〜1日 | `GEMINI_PRICING`修正+`thoughtsTokenCount`記録+用途別内訳+`@google/genai`移行+2.5に`thinkingBudget:0`（dev seedでOCRテキストdiff一致確認後に適用）。**3ステップ超のため/impl-plan必須** |
| 2 | **#548-B1 要約の遅延生成化** | −¥650/月(現行)→−¥3,000/月(3.5後)。既存`regenerateSummary` onCall転用で最小工数。品質影響ゼロ（要約は突合と構造的に独立） | 0.5日 | `processDocument()`の自動要約スキップ+FE「要約を生成」ボタン+dev実機確認。#546と並行可 |
| 3 | **#547 事前計測（フィールド別バイトサイズ分布）** | 削減見込み（egress ¥4,645→¥500〜1,000）の確度確定。設計の入力 | 30分 | 実docサンプリング結果をIssue #547にコメント記録 |

### 条件待ち（明示 trigger 付き）

| # | 項目 | trigger | 充足時のタスク | 確認方法 |
|---|------|---------|--------------|---------|
| 1 | **#526 kanameone/cocoro展開**（これで#526 close） | decision-makerの番号単位展開認可 | `/deploy` 3点セット（functions+hosting+rules）。kanameone=`deploy-to-project.sh --full`、cocoro=SKILL.md記載の3経路。展開直後の分割操作自粛アナウンス+実データでOCR補完確認（Issue #526「展開時の注意」参照） | user指示 |
| 2 | #547 実装着手 | 詳細設計（スキーマ/移行手順/dual-read計画）+**ADR作成+Codexレビュー完了**（destructive migration規約） | 新規doc新構造→backfill→dual-read→検証→削除（最終・数週後）。dev→cocoro→kanameoneの段階展開 | 設計doc+Codexレビュー記録 |
| 3 | #548 3.5移行スイッチ | #546完了+dev seedでの2.5vs3.5 A/B PASS。**期限2026-10-16** | modelId切替+`thinking_level:low`+価格定数更新 | A/B結果 |
| 4 | #548-B4 再処理「再突合のみ」モード | UI仕様のdecision-maker判断 | 2モード化実装 | user回答 |
| 5 | #539/#540（P2バグ） | 明示指示 or 実害観測 | 各Issue参照 | `gh issue view` |
| 6 | 継承事項: PR#474 close / `.artifacts/` 扱い / #503・#251・#238 | decision-maker明示指示（全て前session94から継続、トリガー未充足） | 各項目参照 | — |

### 却下候補（記録のみ）

| 項目 | 経緯 | 着手しない理由 |
|------|------|--------------|
| OCR出力のエンティティリスト化（−¥11,000/月級） | コスト分析で最大レバーと特定 | 突合品質の厳密A/B実証が前提=品質不劣化制約に抵触しうる唯一の施策。**3.5移行後の実測を見てdecision-makerが判断する保留カード**（#548に記録済み） |
| processOCR head-of-line blocking対策 | Codex指摘で実在確認（BATCH_SIZE=5固定） | 実害未観測。分割多用でpending滞留が観測されたら別Issue化（#526本文に監視事項として記録済み） |
| PWA更新バナー実装 | 展開時リスクとして一時検討 | `vite.config.ts`実査でSWは登録のみ（キャッシュなし）と確認、通常のSPAバージョンスキュー程度のため不要と判定済み |

> ⚠️ 包括指示（「進めて」等）で動けるのは即着手タスクのみ。**次セッションのモデルはSonnet 5を想定**（session95末尾時点のデフォルト保存はFable 5のため、開始時に`/model`確認推奨。Fable 5は2026-07-07失効）。

### 最終結論

✅ **セッション終了可**（handoff PR merge後）

- OPEN PR: #474（失効・クローズ推奨、継承）+ 本handoff PR / active Issue: #546〜548（コストトラック、即着手3件）+ #526（展開待ち）+ #539/#540/#503/#251/#238（トリガー待ち）
- Git: `.serena/project.yml`（意図的未コミット保持、session94参照）+ `.artifacts/`（untracked、扱い未指示）のみ
- 残留プロセス: なし
- §4.6 同根再発スキャン: #538/#539/#540はsplitPdf/OCR並行性・stale snapshotの同族だが、設計調査で**意図的に発見・分離・記録**したもの（silent再発ではない）。#540の一般解は未着手のまま明示的にopen管理
- §4.7 対症療法判定: #538修正はroot cause対応（confirmedフラグの明示送信化）、#543のtransaction化は#540の局所対策と明記済み。対症療法疑いなし
