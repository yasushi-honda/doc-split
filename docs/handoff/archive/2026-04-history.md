# ハンドオフ履歴アーカイブ (〜2026-04-17 session9)

`docs/handoff/LATEST.md` の肥大化に伴い、
2026-04-16 session3 で過去履歴を本ファイルへ初回アーカイブ。
2026-04-18 session11 で session9 セクションを LATEST から archive へ移管 (cut & append)。

最新状況は `docs/handoff/LATEST.md` 参照。

---

## 前々セッション完了 (履歴)

| 順 | Issue/PR | 結果 |
|---|---|---|
| 1 | **#217 24h OOM観察** (前セッション応急対処の検証) | ✅ **真クローズ判定** — 12.7h観察, ピーク時間帯 (JST 10:00〜15:31) 0件 |
| 2 | **#219 removeTokensFromIndex silent failure** | ✅ PR #222 マージ (commit `84f0318`) — NOT_FOUND/その他を分岐、ERROR severity で監視可能化 |
| 3 | PR #222 全3環境デプロイ (dev → kanameone → cocoro) | ✅ 全success |
| 4 | **#213 generateSummary maxOutputTokens regression test** | ✅ PR #224 マージ (commit `184ed67`) — pure builder抽出 + 10件のregression test |
| 5 | PR #224 全3環境デプロイ (dev → kanameone → cocoro) | ✅ 全success (QA Codex Go判定済み) |
| 6 | **後追い Issue 起票** | ✅ #223 (P2, throw vs log設計), #225 (P2, builder bypass検出) |
| 7 | kanameone 本番ダッシュボード確認 | ✅ **エラー 0件** / 処理済み 4,260件 / 20/20 Functions稼働中 |

### 達成効果

| 効果 | 内容 |
|------|------|
| 🛡️ 検索インデックス信頼性 | OOM 12件+/日 → 0件。silent failure (全エラー握潰し) → NOT_FOUND以外はERROR監視可能 |
| 🧪 リグレッション防止 | `maxOutputTokens=8192` (#205/#209) を canary testで固定、3フィールド同梱 (#178教訓) を pure builder で構造的強制 |
| 📊 運用可視性 | 権限/ネットワーク/クォータ障害が Cloud Logging で検出可能 → #220 (log-based metric) の基盤 |
| 🧾 負債可視化 | Issue #223, #225 で暗黙の負債を明示化 |

### 24h 継続監視項目（次セッション以降）

PR #222 効果監視:
```bash
gcloud logging read 'resource.labels.function_name="ondocumentwritesearchindex" severity>=ERROR timestamp>="2026-04-16T00:00:00Z"' --project=docsplit-kanameone --limit=20 --format="value(timestamp,textPayload)"
```
- ERROR件数 0維持 → 健全
- `Search index entry not found` WARN頻度とdocId偏り確認
- 削除済み書類が検索ヒットしないか手動抽出確認

PR #224 効果監視:
- summary 生成失敗率、Cloud Function error rate
- Firestore 3フィールド (summary/summaryTruncated/summaryOriginalLength) 欠損の有無

## 🔴 今セッション判明した前提変更（重要）

### ダッシュボード画像の読み方

`scripts/health-report/` の output は **毎日 01:16 UTC に自動生成** (`.github/workflows/health-report.yml` schedule)。日中に復旧された書類は **翌日まで反映されない**。

- 04-15 10:16 JST = 01:16 UTC 撮影 → error=1 表示
- 04-15 13:08 JST = 04:08 UTC 復旧完了 → Firestore は error=0
- ダッシュボード画像には **復旧前の情報が残る**

**判断フロー**: ダッシュボード error>0 のとき、`gh workflow run run-ops-script.yml -f environment=<env> -f script="fix-stuck-documents --include-errors --dry-run"` で **Firestore 実態を必ず確認**。

## 前セッション完了（Issue #209 generateSummary 防御層）

| 順 | タスク | 結果 |
|---|---|---|
| 1 | Issue #209 着手（branch `fix/generate-summary-cap-209`） | ✅ |
| 2 | TDD: pageTextCap.ts に MAX_SUMMARY_LENGTH=30_000 追加 + 境界値テスト5件 | ✅ 21 passing |
| 3 | generateSummary() / generateSummaryInternal() に maxOutputTokens=8192 + capPageText 適用 | ✅ |
| 4 | summaryTruncated/summaryOriginalLength を Firestore 保存・FE側マッピング (#178教訓) | ✅ |
| 5 | /simplify 3並列レビュー → High指摘対応（GEMINI_CONFIG.maxOutputTokens 統一、CappedText interface 統合） | ✅ |
| 6 | PR #212 作成 | ✅ |
| 7 | /review-pr 6エージェント並列レビュー → Medium指摘対応（JSDoc・コメント追加） | ✅ commit 77635b9 |
| 8 | フォローアップ Issue 起票 | ✅ #213 (regression test), #214 (関数共通化), #215 (型不変条件強化) |
| 9 | CI green → Squash merge → branch削除 | ✅ commit `8e218a1` |
| 10 | Issue #209 自動クローズ | ✅ |

**変更規模**: 7 files, +122/-20 lines (test 21件 / functions 345件 / frontend 94件 すべて pass)

## 前セッション完了（kanameone本番障害復旧）

| 順 | タスク | 結果 |
|---|---|---|
| 1 | PR #208 マージ | ✅ commit `08031c9` for #205 |
| 2 | dev 自動デプロイ | ✅ CI success |
| 3 | kanameone Go確認（dry-run） | ✅ 対象 doc 存在・status=error 確認 |
| 4 | kanameone functions デプロイ | ✅ 04:04 UTC、新 revision 起動 |
| 5 | kanameone 短時間観察 | ✅ 04:05 scheduler 正常、WARNING+ なし |
| 6 | スタック書類 pending リセット | ✅ 04:07 UTC |
| 7 | OCR 再処理確認 | ✅ 04:08:40 完了、`リハビリテーション計画書`、INVALID_ARGUMENT 再発なし、TRUNCATED warning なし（今回は Vertex AI 正常応答） |
| 8 | cocoro 予防デプロイ + 観察 | ✅ 04:18 UTC、04:19 scheduler 正常 |
| 9 | Issue #205 クローズ | ✅ 自動クローズ（PR #208 Closes #205） |
| 10 | 後追い Issue 作成 | ✅ #209 (generateSummary maxOutputTokens), #210 (truncated メトリクス監視) |

**復旧対象書類**: kanameone `uUm2JJi5o9CgyQ9r4bIJ` (`岩倉病院通所ﾘﾊﾋﾞﾘﾃｰｼｮﾝ-L1-20260414155319.pdf`、3ページPDF) → status=processed

## 直近の変更（04-16 最新セッション）

| PR/Issue | 内容 |
|----|------|
| **PR #218** ✅マージ済み (commit `27a2626`) | **fix: ondocumentwritesearchindex のメモリを256→512MiBに増強 (#217)** OOM 応急対処。dev/kanameone/cocoro 3環境デプロイ完了 (revision 00070-hab / 00029-fad / 00013-tov) |
| **#217** ✅クローズ | searchIndexer OOM 応急対処 (PR #218 で完了、24h観察は明朝) |
| **#219** 🆕 P1 | `removeTokensFromIndex` catch 全エラー握潰し (silent failure)。PR #218 review silent-failure-hunter 指摘 (HIGH) |
| **#220** 🆕 P2 | OOM + truncated 用 log-based metric + alert。#210 統合対象 |

## 直近の変更（04-15）

| PR/Issue | 内容 |
|----|------|
| **PR #204** ✅マージ済み | **chore: .envrcでGH_TOKENを自動exportしClaude Code Bashから利用可能に** Claude Code Bash sessionで gh CLI/git 操作を確実に動作させる |
| **PR #207** ✅マージ済み | **feat: fix-stuck-documents.jsに--doc-id単一指定オプション追加 (#206)** 単一書類リセット用、本番運用安全性向上。GitHub Actions UI に doc_id 入力欄追加、command injection 対策（env var化、英数字+_-のみ許可） |
| **PR #208** ✅マージ済み | **fix: Vertex AI暴走時のOCRページ巨大応答に対するFirestore書き込み防御 (#205)** kanameone 本番障害（INVALID_ARGUMENT）に対する三段防御。kanameone/cocoro 両環境にデプロイ済み |
| **PR #211** ✅マージ済み | **docs: kanameone本番復旧完了をハンドオフメモに記録** |
| **PR #212** ✅マージ済み | **fix: generateSummaryにmaxOutputTokens追加とsummary cap適用 (#209)** Codex M1 後追い対応。summary 経路の同等防御層追加。`/review-pr` 6エージェント並列レビューpass |
| #205 ✅クローズ | OCR防御層 (PR #208 で完了、kanameone 本番復旧確認) |
| #206 ✅クローズ | ops script `--doc-id` (PR #207 でクローズ) |
| #209 ✅クローズ | generateSummary 防御層 (PR #212 で完了) |
| #210 P2 | OCR 切り詰め (truncated=true) メトリクス監視（log-based metric + アラート）**→ #220 で統合対応予定** |
| **#213** 🆕 P1 | generateSummary maxOutputTokens regression テスト追加（PR #212 review pr-test-analyzer 指摘） |
| **#214** 🆕 P2 | generateSummary 共通化 (ocrProcessor / regenerateSummary 重複解消、code-simplifier 指摘) |
| **#215** 🆕 P2 | summary 切り詰めメタの型不変条件強化 (discriminated union化、type-design-analyzer 指摘) |

### kanameone本番障害（2026-04-14 07:03 UTC）

| 項目 | 値 |
|---|---|
| Document ID | `uUm2JJi5o9CgyQ9r4bIJ` |
| ファイル | `岩倉病院通所ﾘﾊﾋﾞﾘﾃｰｼｮﾝ-L1-20260414155319.pdf` (3ページPDF) |
| エラー | `3 INVALID_ARGUMENT: Property array contains an invalid nested entity` |
| 真因 | Vertex AI Gemini が **Page 3 で 1,102,788文字** のOCR応答を返した（通常 711〜2,855 chars の400倍超）。`pageResults` 配列内の1要素が Firestore per-field 1 MiB 制限に違反 |
| マスター破損 | **無関係** (kanameone master 1,467件 全クリーン) |
| 影響範囲 | 1件のみ。サービス健全（4214件処理済み中） |

### 三段防御の設計（PR #208）

| 層 | 実装 | 値 |
|---|---|---|
| 1. per-page cap | `capPageText()` in `pageTextCap.ts` | `MAX_PAGE_TEXT_LENGTH = 50_000` chars |
| 2. aggregate cap | `capPageResultsAggregate()` in `pageTextCap.ts` | `MAX_AGGREGATE_PAGE_CHARS = 200_000` chars (UTF-8 Japanese で約600KB) |
| 3. Vertex AI出力上限 | `generationConfig.maxOutputTokens` in `ocrProcessor.ts:ocrWithGemini` | `GEMINI_MAX_OUTPUT_TOKENS = 8192` (≈25K chars Japanese) |
| メタデータ | `PageOcrResult.originalLength`, `PageOcrResult.truncated` 追加 | shared/types.ts と functions側 PageOcrResult 両方 |

### Codex セカンドオピニオン反映（High指摘）

| ID | 指摘 | 対応 |
|----|---|---|
| H1 | per-page cap だけでは多ページで合計1MiB超 | aggregate cap 追加 ✅ |
| H2 | テストが弱い、payload直接検証必要 | Firestore 1MiB制限内 serialized size 検証テスト追加 ✅ |
| H3 | `--include-errors` は対象が広すぎる | `--doc-id` 単一指定追加 (PR #207) ✅ |
| M1 | `maxOutputTokens` を別Issueでなく同PRで | 同PR内で対応 ✅ |
| M2 | 切り詰めメタデータ保存 | `originalLength`, `truncated` 追加 ✅ |
| M3 | 切り詰めはGemini直後で | 切り詰め位置: ocrProcessor.ts page loop直後 ✅ |
| L1 | raw全文Storage退避方針 | 別Issue化候補（次セッション以降） |

### 影響範囲とリスク

| 観点 | 内容 |
|---|---|
| 既存4214件 | マイグレーションしない限り影響なし |
| 新規ドキュメント | per-page/aggregate cap適用、`maxOutputTokens` で Gemini 暴走抑止 |
| 既存split書類の再処理 | parentOcrExtraction経由は影響軽微（ocrExtractionに candidates なし） |
| FE pageResults表示 | `pageResults[i].text` は cap 後の値、`originalLength`/`truncated` でメタ取得可能 |
| PdfSplitModal | 切り詰めページのプレビュー不完全（ハルシネーション時のみ）→ 期待動作 |

### 積み残しIssue（次セッション以降の優先順）

> 注: #219 (PR #222), #213 (PR #224) は本セッションで完了済み。下記は2026-04-16時点の OPEN のみ。

| # | タイトル | ラベル | 優先 |
|---|---|---|---|
| **#225** 🆕 | generateSummary builder bypass 検出 (PR #224 後追い) | enhancement, P2 | 中 |
| **#223** 🆕 | removeTokensFromIndex throw vs log 設計 (PR #222 後追い) | bug, P2 | 中 |
| **#220** | OOM + truncated 用 log-based metric + alert (#210統合) | enhancement, P2 | 中 |
| #214 | generateSummary 共通化 | enhancement, P2 | 中 |
| #215 | summary 切り詰めメタ 型不変条件強化 | enhancement, P2 | 中 |
| #210 | OCR 切り詰めメトリクス監視 **→ #220 で統合** | enhancement, P2 | (統合) |
| #196 | rescueStuckProcessingDocsにMAX_RETRY_COUNTチェックとretryAfter追加 | bug, P2 | 中 |
| #190 | check-master-data.js --fix バッチ500件上限考慮 | bug, P2 | 中 |
| #189 | ocrProcessorのdateMarkerサニタイズ境界外 | bug, P2 | 中 |
| #183 | displayFileNameのファイル名サニタイズ | bug, P2 | 中 |
| #182 | pdfOperationsのfileDateFormattedフォールバック | bug, P2 | 中 |
| #200 | checkGmailAttachments/splitPdf統合テスト | enhancement, P2 | 低 |
| #188 | マスターデータ読み込み共通関数化 | enhancement | 低 |
| #181 | generateDisplayFileName を shared 統合 | enhancement, P2 | 低 |
| #152 | dev 環境 Firestore 初期設定 | enhancement, P2 | 低 |

## 直近の変更（04-11）

| PR | コミット | 内容 |
|----|------|------|
| **#202** | **6240f09** | **chore: 運用スクリプトにcleanup-duplicatesを追加** cleanup-duplicates（重複ドキュメント削除）をGitHub Actions運用スクリプトに統合 |
| **#201** | **f90cbac** | **feat: Firestoreネイティブバックアップ設定スクリプト・ワークフロー追加** 月数円未満で日次(7日保持)+週次(8週保持)バックアップ自動設定 |
| **#199** | **17a675a** | **fix: Gmail添付ファイル重複取得の根本対策** maxInstances:1・messageId保存・重複チェック3層防御、cocoro/kanameone環境の既存重複を削除済み |

### Gmail重複取得問題（04-10 完全解決）

| 環境 | 状態 | 重複ドキュメント | 削除対象 | 結果 |
|------|------|---------|--------|------|
| **cocoro** | ✅ 完全解決 | 0件（既に削除済み） | - | 重複なし |
| **kanameone** | ✅ 完全解決 | 6件（2グループ） | 7件Firestore削除 | dry-run確認→execute実行済み |
| **dev** | ✅ 防止機構 | 0件（テストのみ） | - | 3層防御で新規重複なし |

**根本対策の3層防御:**
1. `maxInstances: 1` で同時実行制御（並行処理による重複生成防止）
2. `messageId`ベース重複チェック（gmailLogsで既処理確認、MD5チェック前の早期リターン）
3. MD5ハッシュチェック（ファイルレベルの最終フェイルセーフ）

**実装ファイル:**
- `functions/src/gmail/checkGmailAttachments.ts`: maxInstances:1 追加・messageId保存・重複チェック実装
- `functions/src/pdf/pdfOperations.ts`: isSplitSource:true 設定
- `shared/types.ts`: messageId・isSplitSource・splitInto型定義追加
- `frontend/src/hooks/useDocuments.ts`: 新フィールドのfirestoreToDocumentマッピング追加
- `scripts/fix-stuck-documents.js`: status='split' 除外追加

**運用スクリプト統合 (#202):**
- GitHub Actions「Run Operations Script」に cleanup-duplicates を選択肢に追加
- dry-run（デフォルト）・--execute（実行）・バックアップJSON自動保存

### Firestoreネイティブバックアップ設定（04-10 全環境実装）

| 環境 | バックアップ | 保持期間 | 月額コスト | 実装 |
|------|---------|--------|--------|------|
| **cocoro** | 日次+週次 | 7日+8週 | 約¥1-2 | ✅ 完了 |
| **kanameone** | 日次+週次 | 7日+8週 | 約¥1-2 | ✅ 完了 |
| **dev** | 未設定 | - | $0 | ⏭️ 開発環境のため不要 |

**実装:**
- `scripts/setup-firestore-backup.sh`: 日次(7d保持)+週次(8w保持)自動設定スクリプト
- `.github/workflows/setup-firestore-backup.yml`: GitHub Actions設定ワークフロー
- 初回セットアップのみ。以降は自動スケジュール実行

## 直近の変更（03-18）

| PR | コミット | 内容 |
|----|------|------|
| - | **7c0d89d** | **docs: デプロイSkillにGitHub Actions Functionsデプロイ手順を追加** |
| **#198** | **f02a58e** | **feat: プロジェクトごとのSAでGitHub Actions全環境デプロイ対応** 環境別SAキーを使った全3環境へのデプロイがGitHub Actions経由で可能に |
| **#197** | **e9e43f8** | **test: Vertex AI 429リトライのFirestoreエミュレータ統合テスト追加** #194の再発防止テスト |
| **#195** | **1f10c56** | **fix: Vertex AI 429エラー再発対策 (#194)** |

## 直近の変更（03-17）

| PR | コミット | 内容 |
|----|------|------|
| - | **9c1fb67** | **chore: 運用スクリプトのGitHub Actions誘導hookを追加** ローカル実行時にGitHub Actions経由を推奨するhookを追加 |
| **#193** | **92f6193** | **feat: PDF分割画面の選択UIを検索付きコンボボックスに統一** PdfSplitModalのSelect→MasterSelectField置き換え。DRY原則で書類詳細画面と同じコンポーネントを共有。検索・ふりがな表示・新規追加機能が利用可能に |
| - | **58fc71f** | **chore: UI変更マージ前のブラウザ確認をhookで強制化（#193教訓）** CLAUDE.md教訓追記、`.claude/hooks/ui-change-merge-check.sh`追加（.tsx/.css変更PRマージをexit 2でブロック）、`.claude/settings.json`でプロジェクトスコープhook有効化 |

## 直近の変更（03-16）

| PR | コミット | 内容 |
|----|------|------|
| **#191** | **c9d0bb3** | **feat: 運用スクリプト汎用GitHub Actionsワークフロー追加** ADC不要で全3環境のcheck-master-data/fix-stuck-documents/backfill-display-filenameを実行可能に。GCP_SA_KEYにkanameone/devへのroles/datastore.user付与済み |
| **#187** | **4d3a3c7** | **fix: マスターデータ型崩れによるFirestore INVALID_ARGUMENTエラーを防止** sanitizeMasterData.ts追加。マスター読み込み直後にサニタイズ適用。check-master-data.js追加 |

### kanameone本番検証（2026-03-16）

| 検証項目 | 結果 |
|---|---|
| マスターデータ健全性（check-master-data） | 1,432件チェック、0件の型崩れ |
| エラードキュメント再処理（pl9P2EqDiZJHLV3lXeI4, 20p） | **成功** errors:0、INVALID_ARGUMENTなし |
| 新規ドキュメント処理（15mgcPXAjysqbKtzxx9G, 2p） | **成功** errors:0 |

### 技術的負債（Issue起票済み）

| Issue | 内容 | 優先度 |
|-------|------|--------|
| #188 | マスターデータ読み込みを共通関数に抽出 | P2 |
| #189 | dateMarkerがサニタイズ境界外で直接読み取り | P2 |
| #190 | check-master-data.js --fixバッチが500件上限未考慮 | P2 |

## 直近の変更（03-16 前半）

| PR | コミット | 内容 |
|----|------|------|
| - | **f36b1b1** | **docs: ADCとFirebase CLIアカウントの混同防止を明記** CLAUDE.md に gcloud/Firebase CLI/ADC 3層構造の区別・注意事項を追記 |
| - | **d8d1513** | **feat: displayFileNameバックフィル用ワークフロー追加・CLAUDE.md更新** GitHub Actions workflow (backfill-display-filename.yml) 追加 |
| - | **ac9298d** | **feat: displayFileName バックフィルスクリプト追加** 既存ドキュメントに displayFileName を遡及生成するスクリプト |

## 直近の変更（03-15〜03-16 前半）

| PR | コミット | 内容 |
|----|------|------|
| - | **0fd81c5** | **docs: 監査指摘対応 - architecture.md/data-model.md更新** onCustomerMasterWrite欠落・displayFileNameフィールド未反映・status:completed残存の3件を修正 |
| - | **d50660a** | **fix: ESLint warnings 6件を修正** |
| **#185** | **bcb5ca6** | **fix: firestoreToDocumentにdisplayFileNameマッピング追加 (#178)** |
| **#180** | **d574fc9** | **feat: displayFileName自動生成 Stage 1-3 (#178)** |
| **#184** | **d3530bd** | **fix: 再処理時にdisplayFileNameをクリア (#178)** |

### dev環境 E2Eテスト結果（2026-03-16）

| テスト項目 | 結果 |
|---|---|
| OCR処理後のdisplayFileName（Stage 1） | ✅ メタ全デフォルト値→null→fileName表示 |
| メタ編集後のdisplayFileName再生成（Stage 3） | ✅ `診断書_20260315.pdf` 正しく生成・表示 |
| firestoreToDocument読み取り（PR #185） | ✅ リロード後もdisplayFileName正しく表示 |
| デフォルト値の除外（不明顧客/未判定） | ✅ 正しく省略 |
| PDF分割後のdisplayFileName（Stage 2） | ⏭️ ユニットテストでカバー済み |

### displayFileName機能の構成

| Stage | 箇所 | ファイル |
|-------|------|---------|
| 0 | 表示フォールバック | `frontend/src/utils/getDisplayFileName.ts` |
| 1 | OCR完了時生成 | `functions/src/ocr/ocrProcessor.ts` |
| 2 | PDF分割時生成 | `functions/src/pdf/pdfOperations.ts` |
| 3 | FEメタ編集時再生成 | `frontend/src/hooks/useDocumentEdit.ts` |
| - | 再処理時クリア | `frontend/src/hooks/useDocuments.ts` |
| - | 純粋関数(BE) | `functions/src/utils/displayFileNameGenerator.ts` |
| - | 純粋関数(FE) | `frontend/src/utils/generateDisplayFileName.ts` |

### 技術的負債（Issue起票済み）

| Issue | 内容 | 優先度 |
|-------|------|--------|
| #181 | generateDisplayFileNameをsharedモジュールに統合 | P2 |
| #182 | pdfOperationsのfileDateFormattedフォールバック | P2 |
| #183 | displayFileNameのファイル名サニタイズ | P2 |

## 直近の変更（03-12）

| PR | コミット | 内容 |
|----|------|------|
| - | **a5e5f4e** | **refactor: デプロイ手順をCLAUDE.mdから/deployスキルに移行** |
| **#170** | **2bec73b** | **fix: dev環境STORAGE_BUCKETを正しいバケット名に修正** |
| **#168** | **4614788** | **fix: 削除ボタンクリック時にOCR確認ダイアログが表示される不具合を修正** |
| **#166** | **f17a31c** | **fix: 編集モード中は削除ボタンを無効化** |
| **#165** | **f0ec652** | **feat: ドキュメント詳細モーダルに個別削除ボタンを追加** |

## 直近の変更（03-10）

| PR | コミット | 内容 |
|----|------|------|
| **#162** | **e7c5108** | **docs: CLAUDE.mdに認証体系（3層構造）とクライアント別アカウント対応表を追記** gcloud/Firebase/ADCの3層構造と各クライアントのアカウント設定を明記 |
| - | **78ac680** | **fix: kanameone.envのgcloud構成とアカウントを実態に合わせて修正** gcloud構成・アカウント設定を実際の状態に合わせて修正 |
| - | **946ce11** | **docs: CLAUDE.mdにdev/クライアント環境の役割と確認範囲を明記** dev→クライアント環境のデプロイ順序ルールを追加 |
| **#160** | **0ce29bd** | **fix: Vertex AI 429レートリミットエラーの根本対策** processOCRにmaxInstances:1を設定し複数インスタンス同時起動を防止。Geminiリトライを強化（初期遅延5s、最大4回）、ドキュメントリトライ上限を5に引き上げ |

## 直近の変更（03-01〜03-02）

| PR | コミット | 内容 |
|----|------|------|
| **#158** | **10f658f** | **docs: GitHub Pagesに健全性レポートページを追加** 納品・運用セクションに健全性レポートの説明ページを新設。配信スケジュール、レポート内容の読み方、異常時の対応、手動実行方法を記載 |
| **#157** | **1eaf0a1** | **feat: 健全性レポートのメール表示を日本語化** 英語ラベル（Documents/Functions/Scheduler/Storage）を日本語化。docs/clients/cocoro.md のGmail OAuth認証完了・運用開始済みに更新 |
| **#156** | **3e35f14** | **fix: health-reportのDocuments表示でerrorカウントが収集エラーと誤判定されるバグを修正** `stats.error`がnumber（件数）でもtruthyとなりenv-errorパスに入る問題。`typeof === 'string'`で判別するよう修正 |
| **#155** | **2fb74d6** | **fix: Storageバケット名ハードコードを動的検出に変更** setup-tenant.sh Step 6.5が`.appspot.com`固定 → `.firebasestorage.app`環境で再実行時に誤動作していた問題を修正 |
| - | **75657db** | **chore: Firestoreに status+updatedAt DESC 複合インデックスを追加** 健全性レポートのerrorドキュメント取得クエリに必要。cocoro/kanameone両環境にgcloud経由で作成済み |
| - | **835cb49** | **fix: health-report認証をdev専用監視SAに変更** クライアント環境SAではなくdev専用監視SA（`HEALTH_REPORT_SA_KEY`）を使用するよう変更 |
| **#153** | **468ac1b** | **feat: 健全性レポート定期メール配信を追加** GitHub Actions cronで毎日JST 09:00にCloud Functions/Scheduler/Firestore/Storageの稼働状況をHTML形式で集計・メール配信。workflow_dispatchでdry_runテスト可能 |

## 直近の変更（02-22）

| PR | コミット | 内容 |
|----|------|------|
| - | **554770a** | **fix: deleteDocumentのwarningsレスポンスをFE側で処理・通知** BE側が返すwarnings配列をFEで受け取りトースト通知するよう対応 |
| - | **662db58** | **docs: fix-stuck-documents.jsの運用手順をCLAUDE.mdに追記** スタック書類の手動修正スクリプト実行手順をドキュメント化 |
| **#150** | **9ae0338** | **fix: setup-tenant.sh の新規クライアント環境設定漏れを一括修正** Compute SAへのdatastore.user/storage.objectAdmin権限追加、ADMIN_EMAILへのApp Engine SA iam.serviceAccountUser追加、Storageバケット名正規化（.firebasestorage.app→.appspot.com） |
| - | **9fc4cda** | **fix: deploy-to-project.sh --rules/--full に firestore:indexes 追加** --rules/--full デプロイ時に Firestore インデックスが含まれていなかった問題を修正 |

## 直近の変更（02-21）

| PR | コミット | 内容 |
|----|------|------|
| - | **a0ef38d** | **fix: deploy-functions.yml の push トリガーを削除し workflow_dispatch のみに変更** push 時に inputs.environment が空になり dev にフォールバック → cocoro SA が actAs 権限なしで失敗していた問題を修正（Issue #143 対応） |
| - | **9cbd17c** | **fix: PDF分割エラーハンドリング追加・StorageBucket明示初期化** PdfSplitModal に try-catch 追加・成功/失敗 toast 通知。functions/index.ts の initializeApp() に storageBucket 明示指定（Issues #141 #137 対応） |

## 直近の変更（02-15）

| 項目 | 内容 |
|------|------|
| **verify-setup.shバグ修正** | Storage CORS確認でバケット名が`.firebasestorage.app`固定だった問題を修正。`.appspot.com`へのフォールバック追加。cocoro環境のCORS判定が正常化（8/14→14/16相当） |
| **ドキュメント監査** | docs/audit/2026-02-15-document-audit.md 作成。総合評価 A- (90%)。軽微改善を CLAUDE.md に反映 |
| **CLAUDE.md改善** | switch-client.sh 追記、環境情報に「開発環境参照値」と注釈追加、マルチクライアント運用対応 |

## 直近の変更（02-14後半）

| PR | コミット | 内容 |
|----|------|------|
| **#135** | **73de6a9** | **fix: ヘッダーナビのテキスト改行防止・タブレット最適化** タブレット(iPad Air 820px)でナビテキストが2行折り返しされていた問題を修正。whitespace-nowrap追加、md(768-1024px)でtext-xs/px-1.5に省スペース化、lg(1024px+)でtext-sm/px-2.5に拡大、DocSplitロゴをlg以上でのみ表示 |
| **#134** | **f688a82** | **fix: ヘッダーナビのレスポンシブ対応をタブレット向けに改善** ナビ項目テキスト表示breakpointをsm→md、ログアウトテキストをsm→md、メールアドレス表示をsm→lgに修正。タブレット(768px)で正確に適用されるように調整 |
| **#133** | **037436a** | **fix: タブレット/スマホ横向きで右サイドバーがスクロールできない問題を修正** DocumentDetailModalの右サイドバー(OCR結果等)がタブレット横向き(1024x600)でスクロール不可だった問題を解決。md:overflow-y-autoを追加、collapsed状態でも対応。E2Eテスト3件追加（tablet-landscape-sidebar.spec.ts）

## 実運用テスト結果（8 Phase 全完了・02-13）

| Phase | 内容 | 結果 |
|-------|------|------|
| 1 | ベースライン記録 | ✅ 完了 |
| 2 | switch-client.sh全3環境切替 | ✅ 通過（dev↔kanameone↔cocoro） |
| 3 | deploy-to-project.sh認証チェック | ✅ 通過（正常系3件、異常系ブロック） |
| 4 | verify-setup.sh環境検証 | ✅ 通過（dev 9/10, kanameone 16/16, cocoro 14/16 ※旧値8/14はStorageバケット名バグ起因） |
| 5 | PITR確認 | ✅ 通過（dev:DISABLED, kanameone/cocoro:ENABLED） |
| 6 | GitHub Pages納品フォーム | ✅ 通過（表示・生成OK）|
| 7 | client-setup-gcp.sh構造確認 | ✅ 通過（Step 0-4確認）|
| 8 | 環境復元・ベースライン確認 | ✅ 通過（一致） |

## 安全運用機構の判定

**✅ 本番運用可能** - 複数クライアント環境での誤操作防止が正常動作

### 実装完了内容

1. **クライアント定義ファイル** (`scripts/clients/*.env`)
   - dev/kanameone: 個人アカウント（gmail.com）
   - cocoro: ハイブリッド（SA owner + 開発者 editor）

2. **環境切替スクリプト** (`switch-client.sh`)
   - gcloud構成・アカウント自動切替
   - `.envrc.client` 生成 + direnv allow実行

3. **デプロイ前認証チェック** (`deploy-to-project.sh`)
   - gcloud構成・アカウント一致を自動検証
   - 不一致時は即座に中止 + 修正案提示

4. **PITR自動有効化** (`setup-tenant.sh` Step 9)
   - Firestore 7日間ポイントインタイムリカバリ自動有効化
   - 本番環境(kanameone/cocoro): ENABLED
   - 開発環境(dev): DISABLED

### cocoro 納品状態（2026-02-13 確認完了）

| 項目 | 状態 | 詳細 |
|------|------|------|
| Google Sign-in | ✅ **動作確認済み** | Web Application OAuth Client作成、ログイン成功確認 |
| 運用体制 | ✅ **ハイブリッド確立** | SA (owner) + 開発者 hy.unimail.11@gmail.com (editor) |
| Firestore settings | ✅ **設定済み** | app/auth/gmail全て投入済み（02-11） |
| マスターデータ | ✅ **投入済み** | 顧客5, 書類種別5, 事業所5, ケアマネ2 |
| Cloud Functions | ✅ **ACTIVE** | 20関数全て稼働 |
| Storage CORS | ✅ **設定済み** | https://docsplit-cocoro.web.app でアクセス可能 |
| Gmail API | ✅ **ENABLED** | Secret Manager に client-id/secret 保存済み（v2: Web Client統一） |
| PITR | ✅ **ENABLED** | 7日間ポイントインタイムリカバリ有効 |
| 管理者ユーザー | ✅ **登録済み** | a.itagaki@cocoro-mgnt.com (admin) |
| **Gmail OAuth認証** | ✅ **完了** | 2026-02-21 認証完了。Secret Managerにrefresh token保存済み。Gmail監視稼働中 |

**開発者側作業: 100%完了。Gmail OAuth認証: 完了。cocoro環境は運用開始状態。**

**技術メモ**: 標準OAuth 2.0 Web Application ClientはGCPコンソールUIからのみ作成可能（パブリックAPI非対応）。IAP/WIF APIでは代替不可。

## E2Eテスト

| 項目 | 値 |
|------|-----|
| 総テスト数 | **104件**（10ファイル）※PR #133-135で3件追加（tablet-landscape-sidebar.spec.ts）→ PR #136での検証でさらに3件追加 |
| CI結果 | **全パス** - chromiumプロジェクトのみ実行（Lint/Build/Rules/Unit/E2E全て成功） |
| 最新修正 | PR #136 で verify-setup.sh Storageバケット名フォールバック追加・cocoro検証完了 |

## デプロイ環境（全3環境完全同期）

| 環境 | Hosting | Rules | Functions | 状態 |
|------|---------|-------|-----------|------|
| dev | ✅ | ✅ | ✅ (20) | **完全最新** |
| kanameone | ✅ | ✅ | ✅ (20) | **完全最新** |
| cocoro | ✅ | ✅ | ✅ (20) | **完全最新** |
| GitHub Pages | ✅ | - | - | PR #110-111反映済み |

全3環境でFunctions 20個に統一（deleteDocument追加済み）。

## 運用監視フェーズ（04-11 開始）

**重複対策・バックアップ完成後の検証と運用維持:**

| 項目 | 期間 | 確認内容 | 状態 |
|------|------|--------|------|
| **新規重複監視** | 04-11～04-18（1週間） | Cloud Functionsログで新規重複なし確認 | ⏳ 進行中 |
| **バックアップ動作** | 初回実行後 | gcloud firestore backups list で日次/週次スケジュール確認 | ⏳ 初回待機中 |
| **cleanup-duplicates運用** | 随時 | GitHub Actions「Run Operations Script」の動作確認 | ✅ 基本動作確認済み |

**固定監視項目 (定期実施):**
- Cloud Functions ログで重複エラー/警告なし
- Firestore ストレージ消費量（圧縮状況の確認）
- GitHub Actions 運用スクリプト実行ログ

## 次のアクション

1. **技術的負債解決**（Issue #200）
   - checkGmailAttachments/splitPdf の統合テスト追加（Firestoreエミュレータ必要）
   - P2優先度

2. **クライアント納品テスト**（Phase 2・要時間）
   - Mac/Windows/Linux各OSでのclient-setup-gcp実行
   - Claude Code納品プロンプト検証

3. **SAキーファイル管理**
   - cocoro SAキーの安全管理確認

4. **クライアント別オプション機能**（要望確定後）

## 参考リンク

- [クライアント管理ドキュメント](docs/clients/)
  - [dev](docs/clients/dev.md) - 開発環境（verify 9/10）
  - [kanameone](docs/clients/kanameone.md) - カナメワン（verify 16/16、運用中）
  - [cocoro](docs/clients/cocoro.md) - ココロ（ハイブリッド運用、Gmail OAuth認証完了・運用開始済み）

## Git状態

- ブランチ: main
- 未コミット変更: docs/handoff/LATEST.md (このセッションで更新)
- 未プッシュ: なし
- 最新コミット: `184ed67` test: generateSummary maxOutputTokens regression test 追加 (#213) (#224)
- 直前: `84f0318` fix: removeTokensFromIndex の silent failure 防止 (#219) (#222)

## 次セッション候補タスク (P1/P2)

| 優先度 | Issue | 内容 |
|--------|-------|------|
| P2 | #223 | removeTokensFromIndex throw vs log 設計検討 (PR #222後追い) |
| P2 | #225 | builder bypass 検出 (PR #224後追い、案A sinon/B grep/C ESLint) |
| P2 | #220 | OOM/truncated log-based metric + alert |
| P2 | #214/#215 | generateSummary 共通化 / discriminated union化 |
| P2 | #210 | OCR切り詰めメトリクス (#220 と統合検討) |
| P2 | 他 older | #196/#190/#189/#188/#183/#182/#181/#200/#152 |


---

# 2026-04-17 session9 (LATEST から session11 で archive 移管)

## ✅ session9 完了サマリー (Sprint 2-2 完遂: #215 Summary discriminated union 化)

session8 で整理した WBS の Sprint 2-2 (Evaluator 分離発動ライン) を PM/PL 視点で完遂。Quality Gate 全段 (`/impl-plan` → `/simplify` → `/safe-refactor` → `/trace-dataflow` → **Evaluator分離** → `/review-pr` 6並列) を順に通過し、Critical 指摘 4 件に対応。13 ファイル変更、347+/61-。

| 順 | Issue/PR | 結果 |
|---|---|---|
| 1 | **`/impl-plan` 策定** | ✅ Acceptance Criteria 8 項目を定義、#178 教訓 4 点 + API 境界 + 後方互換戦略を明文化 |
| 2 | **#215 Summary discriminated union 化 + textCap rename** | ✅ PR #254 (CI success: lint-build-test 5m20s ✅ / CodeRabbit ✅ / GitGuardian ✅、MERGEABLE) |
| 3 | **follow-up 起票** | ✅ Issue #253 (useProcessingHistory.firestoreToDocument 重複解消) + Issue #255 (write-payload regression test + CappedText discriminated union 化) |

### 達成効果 (Sprint 2-2 完遂)

| 効果 | 内容 |
|---|---|
| 🛡️ 型不変条件 | `SummaryField` discriminated union で「truncated=true ⟹ originalLength 必須」を型レベル保証。illegal state が代入不可能 |
| 🔒 XSS 経路排除 | summary + OCR 結果の innerHTML → createElement + textContent 化。`DocumentDetailModal.tsx` で 2 箇所修正 |
| 📑 後方互換 | `normalizeSummary()` で旧フラット形式 (Issue #209 時代) を新ネスト型に自動変換。illegal state は `console.warn` で検知可能化 (silent degradation 解消) |
| 🧹 再処理クリア | `getReprocessClearFields()` で新 summary + 旧 3 キー全て `deleteField()`。再処理時に Firestore 旧フィールドが自然クリーン化 |
| 🏷️ 命名整合性 | `pageTextCap.ts` → `textCap.ts` rename + `MAX_SUMMARY_LENGTH` 用途をファイル命名に反映 |

### Sprint 2-2 Quality Gate 実施記録

| 段階 | 結果 | 指摘・対応 |
|---|---|---|
| `/impl-plan` | ✅ AC 8 項目定義 | 13 ファイル想定 → Evaluator 発動確定 |
| `/simplify` 3 並列 (reuse/quality/efficiency) | Critical 2 件 | JSDoc 強化 2 件採用 (SummaryField 判別タグ + normalizeSummary illegal state 仕様明記)、残 1 件は Follow-up #253 起票で対応 |
| `/safe-refactor` | HIGH/MEDIUM 0 件 | LOW 3 件は対応済 or 別 Issue |
| `/trace-dataflow` (summary 12 レイヤー) | 全 OK | Vertex AI → Firestore → FE → UI のラウンドトリップ完全性確認、マッピング欠落なし |
| **Evaluator 分離** (5+ファイル発動) | REQUEST_CHANGES 3 件 | 4 件修正で対応 (OCR innerHTML→textContent 併修 + getReprocessClearFields unit test + 不正型防御 test + seed-e2e-data.js 新型化) |
| `/review-pr` 6 エージェント並列 | Critical 2 / Important 3 | Critical 2 対応 (silent failure に console.warn 追加 + JSDoc 未再処理残留注記)、Important 3 件は Follow-up #255 起票 |

### CI / マージ結果

- BE: `npm run build` PASS / `npm test` 408 passing / `npm run lint` 0 errors (既存 19 warnings 別ファイル)
- FE: `npm run typecheck` PASS / `npm test` 113 passing (元 99 + 新規 14) / `npm run lint` 0 errors
- PR #254 CI: lint-build-test 5m20s ✅ / CodeRabbit ✅ / GitGuardian ✅ → **次セッション冒頭でマージ予定**

### #178 教訓 4 点チェックリスト (全更新済)

- [x] `shared/types.ts`: `SummaryField` discriminated union 追加、Document 型更新
- [x] 書込パス: `ocrProcessor.ts:287-296` / `regenerateSummary.ts:83-89` で新ネスト書込 + 旧 2 キー delete
- [x] firestoreToDocument: `useDocuments.ts:119` / `useProcessingHistory.ts:122` で `normalizeSummary()` 呼出
- [x] `getReprocessClearFields`: `useDocuments.ts:222-229` で新 summary + 旧 3 キー全 delete

### 次セッション: Sprint 3 (古い bug 消化) 着手予定

**最優先タスク (セッション冒頭)**:
1. **PR #254 マージ** (destructive 操作、ユーザー確認必須): `gh pr merge 254 --squash --repo yasushi-honda/doc-split`
2. マージ後 `git checkout main && git pull` で同期
3. ハンドオフ PR (本 PR) もマージ

**残り WBS**:
- **Sprint 3** 古い bug 消化 (#189/#190/#196/#182/#183) — 並列可、1 日
  - #189: ocrProcessor dateMarker サニタイズ境界外
  - #190: check-master-data.js --fix 500件上限考慮
  - #196: rescueStuckProcessingDocs MAX_RETRY_COUNT 追加
  - #182: pdfOperations fileDateFormatted フォールバック
  - #183: displayFileName サニタイズ
- **Sprint 4** リファクタ (#181/#188/#253) — 1.5 日
  - #253 (session9 follow-up): useProcessingHistory.firestoreToDocument 重複解消 → #181/#188 と同時実施が効率的
- **Sprint 5** テスト補強 (#200/#255) — 1 日
  - #255 (session9 follow-up): ocrProcessor/regenerateSummary write-payload regression test + CappedText discriminated union 化
- **Sprint 6** 条件付き待機 (#237/#238/#239/#251) — 稼働実績・監査要件・false negative 発生で昇格


---

## 移管ログ

- 2026-04-18 session12 で session8 / session7 / session6 / 過去 Sprint1 セクションを LATEST から archive へ移管 (cut & append)。

---

## ✅ session8 完了サマリー (Sprint 2-1 完遂: #214 generateSummary 共通化)

catchup から PM/PL 視点で積み残し 14 件を WBS 化し、Sprint 2-1 に着手。文脈温かい Summary リファクタ集約の前半 (#214) を完遂。Quality Gate 3 段 (`/simplify` → `/safe-refactor` → `/review-pr` 6 並列) を順に通過し、Important 指摘 3 件を PR review フォローアップ commit で対応。

| 順 | Issue/PR | 結果 |
|---|---|---|
| 1 | **WBS 計画** | ✅ 14 件を Sprint 2/Phase 2-5 + 条件付き待機 3 件に分類、依存関係・並列可否・想定工数・Quality Gate レベルを整理 |
| 2 | **#214 generateSummary 共通化** | ✅ PR #250 マージ (commit `27017dd`) — 新設 `functions/src/ocr/summaryGenerator.ts` の `generateSummaryCore()` に集約、caller 2 箇所は try/catch の形 (empty 返却 / rethrow) のみ差別化 |
| 3 | **follow-up 起票** | ✅ Issue #251 (generateSummaryCore unit test + buildSummaryPrompt 別モジュール分離 + silent-failure-hunter 指摘の error handling 改善) |

### 達成効果 (Sprint 2-1 完遂)

| 効果 | 内容 |
|---|---|
| 🛡️ 重複排除 | `ocrProcessor.generateSummary` と `regenerateSummary.generateSummaryInternal` のほぼ完全同一実装を 1 関数に集約、prompt 改変が 1 ファイル編集で両経路反映 |
| 🎯 閾値単一化 | `MIN_OCR_LENGTH_FOR_SUMMARY=100` 定数を core から export、caller 同期漏れを構造的に防止 |
| 🔒 fallback 一本化 | `DEFAULT_DOCUMENT_TYPE_LABEL='書類'` を非 export でコア内に閉じ込め、type-design-analyzer 指摘の double fallback を解消 |
| 🚨 precondition safety net | `generateSummaryCore` 冒頭に短文ガード assertion を追加、将来 caller が precondition を忘れた場合の silent bug を throw に変換 |
| 📑 契約テスト拡張 | `summaryBuilderCallerContract.test.ts` に CORE_DELEGATE_PATTERN を追加、「caller は generateSummaryCore 経由」「builder bypass 不在」を grep で対称に検証、sanity も BUILDER と対称化 |

### Sprint 2-1 Quality Gate 実施記録

| 段階 | 結果 | 指摘 |
|---|---|---|
| `/simplify` 3 並列 (reuse/quality/efficiency) | Critical 0 | Minor 2 件採用 (閾値・fallback 定数化 + CORE sanity 拡張)、1 件見送り (buildSummaryPrompt export: firebase-admin 依存チェーンで test 実行不可、別 Issue 化) |
| `/safe-refactor` | HIGH/MEDIUM/LOW すべて 0 件 | 修正不要判定 |
| `/review-pr` 6 エージェント並列 | Critical 0 | Important 3 件採用 (precondition assertion + fallback 一本化 + JSDoc 対称性)、4 件見送り→ #251 |

### CI / マージ結果

- `npm test`: 407 passing (元 406 + CORE sanity 複数回呼出 1 件)
- `npm run lint`: 0 errors (既存 19 warnings は別ファイルの no-useless-escape、本 PR 影響外)
- `npm run build`: PASS
- PR #250 CI: lint-build-test 4m55s ✅、CodeRabbit ✅、GitGuardian ✅ → squash merge

### 次セッション: Sprint 2-2 (#215) 着手予定

**Sprint 2-2 概要**: `Summary` フィールドの discriminated union 化 + `pageTextCap.ts` → `textCap.ts` rename。

- 5-7 ファイル変更想定 (shared/types.ts / summaryGenerator.ts / FE useDocuments.ts の firestoreToDocument + getReprocessClearFields / textCap 周辺) → **Evaluator 分離プロトコル発動ライン**
- #178 教訓 4 点チェック必須 (firestoreToDocument / 書込パス / getReprocessClearFields / shared/types.ts)
- API 境界 FE↔BE 確認必須 (cross-layer.md)
- `/trace-dataflow` で summary 全レイヤー到達確認

**残り WBS** (ハンドオフ session8 時点):
- Sprint 2-2: #215 (1 日、Evaluator 発動)
- Sprint 3 bug 一括: #189/#190/#196 (1 日、並列可)
- Sprint 4 displayFileName + リファクタ: #183/#182/#181/#188 (2 日)
- Sprint 5 テスト + 雛形: #200/#152 (1 日、並列可)
- Sprint 6 条件付き待機: #237/#238/#239/#251 (稼働実績・監査要件・false negative 発生で昇格)

## ✅ session7 完了サマリー (Sprint 1 Follow-up B 完遂: 本番 2 環境 A2/A3 展開)

session6 末尾で誤診した「Owner 認証ブロッカー」を session7 開始時に払拭し、プロジェクト playbook に沿って A2/A3 を連続実施・完遂。所要時間は session playbook 通り各 ~15 分。

| 順 | タスク | 結果 |
|---|---|---|
| 1 | **A2 kanameone** (`switch-client.sh kanameone` → SA 作成 → 3 roles → Secret → setup dispatch) | ✅ Run ID `24547741800` (1m22s), 5 metrics + 5 alert policies (全 ENABLED) + 1 channel (`hy.unimail.11@gmail.com`) |
| 2 | **A3 cocoro** (`switch-client.sh doc-split-cocoro` → SA 作成 → 3 roles → Secret → setup dispatch) | ✅ Run ID `24548562806` (1m12s), 5 metrics + 5 alert policies (全 ENABLED) + 1 channel (`hy.unimail.11@gmail.com`) |
| 3 | docs 展開状況テーブル更新 + ハンドオフ記録 | ✅ 本 PR |

### session7 で確認した cocoro の実体

事前懸念「`docsplit-deployer` SA の setIamPolicy 権限が不足している可能性」は杞憂。`gcloud projects get-iam-policy` で確認したところ `roles/owner` を保持しており、SA 作成・roles 付与・キー発行を全て deployer SA で完遂できた (cocoro-mgnt.com Workspace 管理者への一時付与依頼は不要だった)。

### session7 で採用した通知先ポリシー

全 3 環境 (dev/kanameone/cocoro) の Cloud Monitoring notification channel を `hy.unimail.11@gmail.com` に統一 (HEALTH_REPORT_TO と同じ運用)。クライアント側管理者アドレスへの切替は Cloud Monitoring の channel update で後から可能 (docs の「通知先の調整」参照)。

## ✅ session6 完了サマリー (Sprint 1 Follow-up B: dev 監視展開 + テンプレ API 制約 3 件修正)

**WBS Phase A (A1-A4)** のうち A1 (dev setup dispatch) + A4 (ハンドオフ) 完遂。A2/A3 (kanameone/cocoro) は本番 Owner 権限未保持のため次セッション持越し。

| 順 | Issue/PR | 結果 |
|---|---|---|
| 1 | **A1 dev setup dispatch** | ✅ 5 metrics + 5 alert policies + 1 channel 作成完了 (Run ID `24540263296`) |
| 2 | **PR #243** setup-gcloud に alpha component 明示インストール | ✅ マージ (commit `1d4db55`) |
| 3 | **PR #244** notificationRateLimit を全 5 テンプレから削除 | ✅ マージ (commit `2631282`) |
| 4 | **PR #245** search_index_silent_failure alignmentPeriod を 25h 制約内に | ✅ マージ (commit `2a964dc`) |
| 5 | **A4 ハンドオフ更新** | ✅ 本 PR |

### session6 で解決した 3 つの API 制約違反

| # | 現象 | 原因 | 修正 |
|---|------|------|------|
| 1 | `gcloud alpha` が Y/n プロンプトで失敗 | 非対話環境で alpha component 未インストール | workflow の setup-gcloud に `install_components: 'alpha'` 追加 (PR #243) |
| 2 | policy 作成で `notificationRateLimit` invalid | API 仕様: log-based policy 限定 | 全 5 テンプレから削除、doc 注記追加 (PR #244) |
| 3 | `alignmentPeriod: 604800s` > 25h 上限 | API 制約: 最大 `90000s` | `86400s` (24h 検知) + `autoClose: 7d` (incident 継続可視化) へ変更 (PR #245) |

### Codex セカンドオピニオン
PR #245 で Codex (MCP thread `019d98a8`) を使用し、他 4 テンプレートに追加制約違反がないことを確認。「ADR-0015 の厳密な 7d rolling は GCP API 制約で不可、autoClose=7d による incident 継続可視化で代替、厳密 weekly 集計が必要なら scheduled query / health-report で担保」の方針に到達。

### 達成効果 (A1 dev 完遂)

- ✅ dev 環境で 5 metrics (ocr_aggregate_truncated / ocr_page_truncated / search_index_silent_failure / searchindex_oom / summary_truncated) 稼働
- ✅ 5 alert policies (全 ENABLED) + 1 notification channel (hy.unimail.11@gmail.com)
- ✅ 冪等性検証済: skip → create の混在でも適切に動作
- ✅ 削除 SOP (`teardown-log-based-metrics.sh`) で 1 コマンド ロールバック可能

## ✅ 過去セッション完了サマリー (Sprint 1: WBS 計画 → 段階消化)

PM/PL 視点で catchup の積み残し 12 件を WBS 化し、Sprint 1 (直前セッション文脈が温かい 2 件) を完遂。

| 順 | Issue/PR | 結果 |
|---|---|---|
| 1 | **WBS 計画** | ✅ 12 件を 5 テーマ × 4 Sprint に分類、依存関係と並列可否を整理 |
| 2 | **#228 summaryBuilderCallerContract docstring 整理** | ✅ PR #234 マージ (commit `230b7b5`) — describe 重複解消 + 既知 limitation 明記 + 昇格条件明記、7 tests passing |
| 3 | **#229 search_index drift 復旧 SOP + force-reindex スクリプト** | ✅ PR #235 マージ (commit `1e2b751`) — **5 エージェントレビュー + Evaluator 分離で Critical 3 件解消済み**、1028 insertions |

### 達成効果

| 効果 | 内容 |
|---|---|
| 🛡️ 復旧手段整備 | `scripts/force-reindex.js` で特定 docId / 一括 drift scan に対応、dry-run default (ADR-0008 準拠) |
| 📖 SOP 文書化 | `docs/context/search-index-recovery.md` に Mermaid 状態遷移図 + 手順 + Escalation 基準 |
| 🏗️ workflow 統合 | `run-ops-script.yml` に 4 choice + build ステップ追加、GitHub Actions 経由実行可能に |
| 🎯 tokenizer drift 防止 | production (`functions/src/utils/tokenizer.ts`) を compiled lib/ から require、3箇所重複リスクを最小化 |
| 🧾 ADR-0015 Risk #3 解消 | Follow-up 表 + References + Negative 更新、dev 検証のみ残存を明記 |
| 🔍 レビュープロトコル完全実践 | 5 エージェント並列 (code-reviewer/pr-test-analyzer/silent-failure-hunter/comment-analyzer) + Evaluator 独立 = 6 並列 |

### Sprint 1 の方法論ハイライト

- **レビュー Critical 指摘の自己検出**: 復旧スクリプトが drift を**拡大**させるリスク (silent-failure-hunter L192) を merge 前に catch
- **Evaluator 分離プロトコルの威力**: AC 7 件を個別 PASS/FAIL 判定、processedAt 欠如などの見落とされたエッジケースを抽出
- **再レビュー**: Critical 修正後に silent-failure-hunter を再度呼び出し APPROVE 判定を確認してからマージ

## 🔴 次セッションで実施する Follow-up

### A. #229 関連: dev 環境での force-reindex 動作検証 ✅ 完了 (2026-04-17 session5)

Run ID `24519045429` (GitHub Actions run-ops-script.yml, environment=dev, script=`force-reindex --all-drift`) で検証:

```
プロジェクト: doc-split-dev
モード: dry-run (書き込みなし)
[MODE] 全 drift scan (dry-run)
---
走査: 3 件 / drift: 0 件 / 再 index: 0 件 / 失敗: 0 件
完了
```

- ✅ AC1: `--all-drift --dry-run` (default) exit 0、drift 0 件
- ✅ build ステップ成功（tsc 通過、`functions/lib/` 生成）
- ⏭ AC2 (`--sample=5`): dev の走査対象が 3 件で検証意味が薄いためスキップ。
  workflow choice 拡張は #238 (orphan-scan) / #239 (audit log) 対応時に合わせて追加する方針。
  本番 (kanameone/cocoro) 初回展開時に走査件数が大きいタイミングで実体検証可能。

### B. #220 関連: 監視基盤 dev/本番展開 — ✅ 全 3 環境 (dev/kanameone/cocoro) 完遂 (session7)

- ✅ **A1 dev** (session6): 5 metrics + 5 alert policies + 1 channel 稼働
- ✅ **A2 kanameone** (session7): 同上 (Run ID `24547741800`)
- ✅ **A3 cocoro** (session7): 同上 (Run ID `24548562806`)

全環境で以下が同一スペックで稼働: `searchindex_oom` / `ocr_page_truncated` / `ocr_aggregate_truncated` / `summary_truncated` / `search_index_silent_failure`。通知先は全て `hy.unimail.11@gmail.com`。

### B. 過去セッション履歴 (session5 時点の記述)

session5 で **dev 環境の SA + Secret + workflow 切り替え + dry-run 動作検証** を完了。実リソース作成 (setup) のみ次セッション持ち越し。

**session5 完了内容** (PR #241 マージ commit `6d0fbc2`):

- ✅ 専用 SA 作成: `docsplit-monitoring-admin@doc-split-dev.iam.gserviceaccount.com` (Option 2 採用、最小権限)
- ✅ 3 roles 付与: `roles/logging.configWriter`, `roles/monitoring.alertPolicyEditor`, `roles/monitoring.notificationChannelEditor`
- ✅ GitHub Secret `MONITORING_SA_KEY_DEV` 登録 (stdin リダイレクトで鍵内容を conversation context 未露出)
- ✅ `.github/workflows/setup-monitoring.yml` の `credentials_json` を `MONITORING_SA_KEY_{DEV,KANAMEONE,COCORO}` に切り替え
- ✅ `docs/context/monitoring-setup.md` に採用方針 + 展開状況 + セットアップコマンド追記
- ✅ **dry-run dispatch 成功** (Run ID `24535367804`, action=dry-run): notification channel 1 + 5 metrics + 5 alert policies の既存確認スキーム通過

**次セッションで実施する残作業**:

1. **dev で setup 実行** (~5 分): HEALTH_REPORT_TO と同メールアドレスを `notification_email` に渡して dispatch
   ```
   GitHub Actions → "Setup Monitoring (log-based metrics + alerts)"
     environment: dev
     action: setup
     notification_email: <HEALTH_REPORT_TO と同一>
   ```
   AC3b: 5 metrics + 5 alert policies + 1 channel が実体作成されること
   AC4: `gcloud alpha monitoring policies list --filter='userLabels.source="docsplit-monitoring-setup"'` で 5 件確認

2. **kanameone / cocoro 展開** (~各 10 分): dev と同じ順序 (SA 作成 → 3 roles → キー発行 → `MONITORING_SA_KEY_{KANAMEONE,COCORO}` 登録 → setup dispatch)
   手順は `docs/context/monitoring-setup.md` のセットアップ手順セクション参照

**展開状況テーブル** (`docs/context/monitoring-setup.md` 参照):
- ✅ dev: SA + Secret 登録済み、dry-run 検証済み
- ⏳ kanameone: 未セットアップ
- ⏳ cocoro: 未セットアップ

### C. 本セッションで起票した Follow-up Issue (PR #235 スコープ外として分離)

| # | 観点 | 優先度 |
|---|------|--------|
| #237 | search tokenizer の FE/BE/script 3箇所重複を共通化 (`migrate-search-index.js` が MD5、production が 32bit hash で drift 潜在リスク) | P2 (P1 昇格条件: 3箇所のいずれかで挙動差分発覚時) |
| #238 | force-reindex に `--orphan-scan` モード追加 (documents 削除済だが search_index に残る posting を検出・削除) | P2 (実質 P3、drift 実発生で優先度↑) |
| #239 | force-reindex 実行結果を Cloud Logging に構造化 audit log として出力 (現状 stdout のみ) | P2 (実質 P3、監査要件発生で優先度↑) |

## 📋 残り積み残し Issue (catchup 時点、#228/#229 クローズ後)

**Phase 2 (古い bug 消化、1日)**:
| # | タイトル | ラベル |
|---|---|---|
| #189 | ocrProcessor dateMarker サニタイズ境界外 | bug, P2 |
| #190 | check-master-data.js --fix 500件上限考慮 | bug, P2 |
| #196 | rescueStuckProcessingDocs MAX_RETRY_COUNT 追加 | bug, P2 |
| #182 | pdfOperations fileDateFormatted フォールバック | bug, P2 |
| #183 | displayFileName サニタイズ | bug, P2 |

**Phase 3 (テスト補強、0.5日)**:
| # | タイトル | ラベル |
|---|---|---|
| #200 | checkGmailAttachments/splitPdf 統合テスト | enhancement, P2 |

**Phase 4 (リファクタ、1.5日)**:
| # | タイトル | ラベル |
|---|---|---|
| #188 | loadMasterData 共通関数抽出 | enhancement |
| #181 | generateDisplayFileName shared 統合 | enhancement, P2 |
| #214 | generateSummary 共通化 | enhancement, P2 |
| #215 | summary 切り詰めメタ discriminated union 化 | enhancement, P2 |

**Phase 5 (低優先)**:
| # | タイトル | ラベル |
|---|---|---|
| #152 | dev 環境 Firestore 初期設定 | enhancement, P2 |

**継続 Follow-up**:
| # | タイトル | 備考 |
|---|---|---|
| #220 | OOM/truncated metric + alert | PR #231 完了済、SA 権限 + dev/本番展開が Follow-up (上記 §B) |

### Sprint 2 推奨 (次セッション)

優先度高い順 (Follow-up B 残件は session7 で完遂したため除外):

1. **Sprint 2 (Summary リファクタ集約、1.5 日)**: #214 (generateSummary 共通化) → #215 (discriminated union 化)
2. **Phase 2 (古い bug 消化、1 日)**: #189/#190/#196/#182/#183
3. **Phase 3 (テスト補強、0.5 日)**: #200 checkGmailAttachments/splitPdf 統合テスト
4. **Phase 4 リファクタ (1.5 日)**: #188/#181/#237 (tokenizer 3箇所共通化、drift 実発生で優先度↑)

### Follow-up B 残件 (A2/A3) 実施プレイブック — ✅ session7 で使用完了

session7 で実際に以下の手順を用いて A2/A3 を完遂。手順は汎用 SOP として本番環境再セットアップ時に再利用可能。

### 正しい手順の前提

- `scripts/clients/kanameone.env` に `GCLOUD_CONFIG="kanameone"` / `EXPECTED_ACCOUNT="systemkaname@kanameone.com"` が整備済
- `scripts/clients/cocoro.env` に `GCLOUD_CONFIG="doc-split-cocoro"` / `EXPECTED_ACCOUNT="docsplit-deployer@docsplit-cocoro.iam.gserviceaccount.com"` (SA 方式) が整備済
- `gcloud config configurations list` で確認可能: `kanameone` config は `systemkaname@kanameone.com` (Owner) で、`doc-split-cocoro` config は deployer SA で事前認証済
- **`gcloud auth list` の結果だけで権限判断しないこと** (PR #247 で CLAUDE.md に「環境別 gcloud 操作の必須プロトコル」として明記済)

### A2 (kanameone) 実施手順

1. **named config 切替**: `./scripts/switch-client.sh kanameone`
2. **切替確認**: `gcloud config list` で account=`systemkaname@kanameone.com`, project=`docsplit-kanameone` になっていること
3. **SA 作成 + 3 roles 付与**:
   ```bash
   PROJECT_ID=docsplit-kanameone
   SA_NAME=docsplit-monitoring-admin
   SA="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
   gcloud iam service-accounts create "$SA_NAME" --display-name="DocSplit Monitoring Admin" --project="$PROJECT_ID"
   for role in roles/logging.configWriter roles/monitoring.alertPolicyEditor roles/monitoring.notificationChannelEditor; do
     gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role="$role" --condition=None --quiet
   done
   ```
4. **キー発行 + Secret 登録 + 鍵削除**:
   ```bash
   gcloud iam service-accounts keys create /tmp/monitoring-sa-kanameone.json --iam-account="$SA" --project="$PROJECT_ID"
   gh secret set MONITORING_SA_KEY_KANAMEONE --repo yasushi-honda/doc-split < /tmp/monitoring-sa-kanameone.json
   rm /tmp/monitoring-sa-kanameone.json
   ```
5. **dev 環境に戻す**: `./scripts/switch-client.sh dev`
6. **setup dispatch**:
   ```bash
   gh workflow run setup-monitoring.yml --repo yasushi-honda/doc-split \
     -f environment=kanameone -f action=setup -f notification_email=hy.unimail.11@gmail.com
   ```
   ※ `notification_email` はクライアント側通知先を別途協議して決定。dev と同じにするか、kanameone 側の管理メールにするか確認
7. **AC 検証**: Run ID を控え、ログで `5 metrics + 5 alert policies + 1 channel` の作成を確認

### A3 (cocoro) 実施手順

A2 と同じ流れ。Step 1 を `./scripts/switch-client.sh cocoro` に、Step 3 以降のプロジェクト ID を `docsplit-cocoro` に、Secret を `MONITORING_SA_KEY_COCORO` に置換。

**注意 (cocoro の特殊性)**: `AUTH_TYPE="service_account"` で docsplit-deployer SA が使われる。この SA が `setIamPolicy` と `iam.serviceAccountAdmin` を持っているか事前確認。持っていなければ cocoro 側 Workspace (`cocoro-mgnt.com`) の管理者に一時付与してもらうか、Google Cloud Console 上で手動付与が必要。

### session7 で実施済の運用作業

- kanameone/cocoro の `docsplit-monitoring-admin` SA 作成 + 3 roles + キー発行 + Secret 登録完了
- GitHub Secret: `MONITORING_SA_KEY_KANAMEONE` / `MONITORING_SA_KEY_COCORO` (既存 `MONITORING_SA_KEY_DEV` と合わせて 3 環境分揃う)

**展開状況** (`docs/context/monitoring-setup.md`):
- ✅ dev: SA + Secret + setup 完了 (session6, 2026-04-17)
- ✅ kanameone: SA + Secret + setup 完了 (session7, 2026-04-17)
- ✅ cocoro: SA + Secret + setup 完了 (session7, 2026-04-17)

---

## 過去履歴

500 行超過防止のため、2026-04-16 session3 以前は別ファイルに移動:

- [docs/handoff/archive/2026-04-history.md](archive/2026-04-history.md) — session1-3 詳細、Issue #217/#219/#213 系、04-14 以前の変更履歴

## Git状態 (2026-04-18 session10 終了時)

- ブランチ: main (本 PR マージ後)
- 未コミット変更: なし
- 最新コミット: `60b70f5` refactor(textCap): CappedText を discriminated union 化 + 書込契約テスト (#255) (#257)
- session10 マージ済 PR:
  - #254 refactor(summary): 型不変条件を discriminated union 化 + pageTextCap → textCap rename (#215) — session9 持ち越し分を Phase 0.5 で修復マージ
  - #257 refactor(textCap): CappedText を discriminated union 化 + 書込契約テスト (#255) — Phase 1.2 完遂
- session10 起票 Issue: #258 (型設計統合 follow-up) / #259 (contract test 強化 follow-up)
- CI: ✅ 全 PR で lint-build-test + CodeRabbit + GitGuardian pass
- ADR 数: 16 本 (session10 では新規 ADR なし、handoff 更新のみ)

## Git状態 (2026-04-17 session7 終了時)

- ブランチ: main (本 PR マージ後)
- 最新コミット: `e5eb15b` docs(handoff): A2/A3 「Owner 認証ブロッカー」の誤診を訂正 (#248) → 本 PR で更新
- session7 マージ予定 PR: 本 PR (A2/A3 完遂記録のみ、コード変更なし)
- CI: pending (本 PR 作成時点)
- ADR 数: 16 本 (session7 では新規 ADR なし)

## Git状態 (2026-04-17 session6 終了時)

- ブランチ: main
- 未コミット変更: なし (本ハンドオフ PR マージ後)
- 最新コミット: `2a964dc` fix(monitoring): search_index_silent_failure の alignmentPeriod を 25h 制約内に (#245)
- session6 マージ済 PR:
  - #243 setup-gcloud に alpha component 明示インストール
  - #244 notificationRateLimit を全 5 テンプレから削除
  - #245 search_index_silent_failure alignmentPeriod を 25h 制約内に
- CI: ✅ 全 PR で lint-build-test + CodeRabbit + GitGuardian pass
- ADR 数: 16 本 (session6 では新規 ADR なし、monitoring-setup.md / README.md 記述更新のみ)

## Git状態 (2026-04-17 session5 終了時)

- 最新コミット: `6d0fbc2` feat(monitoring): workflow credentials を専用 SA 用 Secret に切り替え + dev セットアップ完了記録 (#241)
- session5 マージ済 PR: #240 (handoff 更新), #241 (監視 SA/Secret/workflow 切替)
- CI: ✅ 成功 (PR #240/#241 両方で lint-build-test + CodeRabbit pass)
