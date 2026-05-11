# ハンドオフメモ

**更新日**: 2026-05-12 session59 (**Issue #432 PR-C1 dev fixture 検証 → 重大設計欠陥発覚 → kanameone 展開中止 → PR-C2 修正計画 v2 確定、Net 0**。PR #439 (session58 handoff) merge 後、dev 環境で setup-collision-fixture → classify を実行し、MatchedByHash 分類が 0 件 (期待 2 件) と判明。原因は **pdf-lib `PDFDocument.save()` のプロセス間 non-determinism** (PDF `/ID` random + internal metadata)。`functions/test/pdfRegenerator.test.ts` の deterministic test は同一プロセス内 2 回呼出しのみ検証で見落とし、Codex セカンドオピニオン + 7 並列 review も全て見落とし。kanameone への destructive 実行を中止し、Issue #432 にコメント追記 + 教訓を `feedback_deterministic_cross_process.md` で memory 化。PR-C2 修正方針を「B+D ハイブリッド」(page content stream 正規化 sha + Ambiguous フォールバック) に絞り、`/impl-plan` で計画 → Codex セカンドオピニオン (Critical 3 + Important 5 + Suggestion 4) を取得し **`pdf-page-visual-fingerprint-v1`** に格上げした v2 計画を確定。実装は次セッション持越し)
**ブランチ**: main (`.serena/project.yml` + `package-lock.json` の lockfile 同期分のみ未コミット、後者は scripts/package.json に PR-C1 で追加された pdf-lib の lock 反映で正当)
**フェーズ**: Phase 8 + 運用監視基盤全環境展開完了 + (session29-55 累積実績は archive 参照) + Phase 8 (session56 = 分割PDF Storage 設計バグ調査、Net -1) + Phase 8 (session57 = Issue #432 PR-A/B/D 完遂、Net 0) + Phase 8 (session58 = Issue #432 PR-C1 完遂、Net 0) + **Phase 8 (session59 = PR-C1 設計欠陥発覚 + PR-C2 v2 計画確定、Net 0)** 完遂

<a id="session59"></a>
## ✅ session59 完了サマリー (2026-05-12: PR-C1 dev fixture 検証で設計欠陥発覚、PR-C2 v2 計画確定、Net 0)

session58 で merge した PR-C1 を dev 環境で fixture 検証したところ、MatchedByHash 分類が 0 件 (期待 2 件) と判明。pdf-lib `PDFDocument.save()` の **プロセス間 non-determinism** が根本原因。kanameone destructive 実行を未然防止 (90+ docs 全件 manual-review に倒れる事態を回避) し、PR-C2 修正計画 v2 を Codex セカンドオピニオンで堅牢化して確定。

### 経緯

1. **PR #439 (session58 handoff) merge** (`42e4d3f`、squash merge、CI 全 SUCCESS)
2. **ADC 認証問題解決**: ADC `quota_project_id` が `tokunaga-chup-pj` だったため doc-split-dev Firestore に PERMISSION_DENIED。ADC ファイル直編集 + `gcloud auth application-default login` で `hy.unimail.11@gmail.com` 再認証 + quota=doc-split-dev に切替 (cocoro/kanameone 用は switch-client.sh + ADC 個別切替プロトコル遵守)
3. **dev fixture 通し検証** (CLAUDE.md「destructive 操作」明示認可受領):
   - `setup-collision-fixture --dev` 成功 (parent + 6 child docs + Storage upload)
   - `classify-collision-docs` 結果: `byClassification: { MatchedByHash:0, Ambiguous:4, RepairableMissingFile:1, LostOrUnrecoverable:1 }` ⚠️
   - 期待値 `{ MatchedByHash:2, Ambiguous:2, RepairableMissingFile:1, LostOrUnrecoverable:1 }` と乖離
4. **根本原因 debug**: `regenerateChildPdf(parent, 1, 1)` を直接呼び出して比較
   - 同一プロセス: regen=748 byte sha `e2388974...` (deterministic ✅)
   - 別プロセス: regen=747 byte sha `ef7517...` (1 byte 差、sha 完全違い ❌)
   - actual storage (setup プロセス): 746 byte sha `0c5f35...`
   - **pdf-lib の `PDFDocument.save()` は同一プロセス内 deterministic だが、別プロセスでは PDF `/ID` + internal random metadata で違う bytes** を出力
5. **dev fixture cleanup 完了** (Storage + Firestore 完全削除)
6. **Issue #432 にコメント追記** ([comment-4425607136](https://github.com/yasushi-honda/doc-split/issues/432#issuecomment-4425607136)): 設計欠陥詳細 + 4 修正方針 (A: deterministic save / B: page content stream 正規化 sha / D: 全件 Ambiguous フォールバック / E: GCS md5 → 不可) + 教訓 (Generator-Evaluator 分離が「同一プロセス内 deterministic test」を共有信頼源として両者見落とし)
7. **教訓 memory 化**: `~/.claude/memory/feedback_deterministic_cross_process.md` 新規 + `MEMORY.md` 追記。「`deterministic` を主張するテストは必ずプロセス間 (別 node プロセスで生成 → 比較) も検証する」をルール化
8. **PR-C2 修正方針確定**: ユーザー判断で **B+D ハイブリッド** (B=ページ content stream 正規化 sha + D=規範化後も mismatch なら Ambiguous フォールバック)
9. **`/impl-plan` で v1 計画作成** (9 file / ~400 行差分) → **Codex セカンドオピニオン** (mcp__codex__codex, read-only, threadId `019e1925-792a-7e01-aeea-6ffe5c8cf6e0`) で Critical 3 + Important 5 + Suggestion 4 を取得
10. **impl-plan v2 確定** (Codex 指摘反映): ゴールを `pdf-page-visual-fingerprint-v1` に格上げ、10 file / ~700 行差分

### Codex セカンドオピニオン主要指摘 (PR-C2 v2 反映)

**Critical (3)**:
1. **content stream だけでは描画同一性を証明できない** — `/Resources` (Font/XObject/ExtGState/ColorSpace), `MediaBox`/`CropBox`/`Rotate` への依存。`/Im1 Do` 同じでも `/Im1` が別画像なら偽陽性 → **decoded Contents bytes + page geometry + 参照 Resources canonical digest** に格上げ
2. **空白/改行/オペレータ順の正規化は偽陽性リスク** — 文字列リテラル/inline image/数値が混在、whitespace 潰しで inline image data 破壊。graphics state は順序依存 → **正規化しない**、decoded Contents bytes をそのまま hash
3. **`PDFPage.node.normalizedEntries()` 使用禁止** — `normalize()` が副作用で push/pop graphics state stream 追加 + Resources/Annots 補完 → **`page.node.Contents()` 直接読み + `PDFArray`/`PDFStream`/`PDFRawStream` 明示処理** + `decodePDFRawStream` 内部 API は lock test で固定

**Important (5)**:
- `pdfPageHasher.ts` 50-80 行は過小 → resource graph canonicalization 含めて **150-250 行** (v2 では 200 行見積)
- `PDFDict` entries は **name 文字列 sort** (Node/V8 object key iteration 順差を吸収して cross-process determinism 保証)
- AC に **偽陽性防止** が不足 (XObject/font/Rotate/CropBox 差分 + inline image whitespace) → AC9-12 追加
- fixture: 「同 page content + 異なる metadata」だけでは弱い → **親から抽出した actual と expected が別プロセス生成でも visual fingerprint 一致する fixture 1 件必須**
- precondition snapshot に **`hashAlgorithm: "pdf-page-visual-v1"`** version 記録 + execute 側 mismatch で gate reject (AC13)

**Suggestion (4)**:
- pdfjs-dist 追加せず pdf-lib のみで完結 (operator list は font/image/worker/version 差分で重い)
- 暗号化/AcroForm/optional content/encryption は自動復旧対象外、**Ambiguous 明示**
- runbook の Ambiguous reason 細分化: `content-mismatch`/`resource-mismatch`/`unsupported-pdf-feature`/`hash-unavailable-transient`/`hash-unavailable-no-parent`
- **PR 分割**: PR-C2 (実装) と PR-C2-execution (dev 実行ログ + kanameone 展開判断) を分離

### Issue Net 変化

| 項目 | 内容 |
|------|------|
| Close 数 | 0 件 |
| 起票数 | 0 件 (Issue #432 にコメント追記のみ) |
| **Net 変化 (session59 単独)** | **0 件** |

**Net 0 の進捗判定**: ✅ 正の構造的進捗。kanameone への destructive 実行を未然防止 (90+ docs 全件 manual-review に倒れる事態を回避)。PR-C2 修正方針を Codex Critical 3 含む 12 指摘で堅牢化した v2 計画として確定。次セッションで実装着手すれば PR-C1 主目的「自動復旧」を回復可能。

### 教訓 (memory 追記済)

[`feedback_deterministic_cross_process.md`](../../../../.claude/memory/feedback_deterministic_cross_process.md): `deterministic` を主張するライブラリ output (pdf-lib / PDFKit / Puppeteer / docx / image processing 等) は、**同一プロセス内 deterministic を pass しても別プロセスで非決定的になる** ものが多い。`sha 比較で同一性判定` する設計は、テストで **「子 node プロセスで生成 → 比較」を必ず含める**。PR-C1 では Codex セカンドオピニオン + 7 並列 review でも見落とした。Generator-Evaluator 分離プロトコル使用時、両者が「同一プロセス内 deterministic test pass」を共有信頼源にすると見落とすため、チェックリストに「プロセス間 deterministic」を明示追加すべき。

### 環境状態 (次セッション catchup 用)

- ADC quota_project_id = `doc-split-dev` のまま (本セッションで `tokunaga-chup-pj` から切替、復元せず維持)
- cocoro / kanameone への作業時は `./scripts/switch-client.sh <env>` + ADC quota の個別切替プロトコル遵守 (CLAUDE.md「環境別 gcloud 操作の必須プロトコル」)
- scripts/ deps: `npm install` 実行済 (root の `package-lock.json` に `pdf-lib` lock 同期、本 PR で commit)
- gcloud active config: `doc-split` (= dev)

### 次セッション着手項目 (PR-C2 実装計画 v2)

**スコープ** (10 file / ~700 行差分):
| タスク | file | 規模 |
|---|---|---|
| A | `scripts/lib/pdfPageVisualFingerprint.ts` (new) | ~200 行 — `page.node.Contents()` 直接読み + Resources canonical digest + geometry + unsupported feature 検出 |
| B | `functions/test/pdfPageVisualFingerprint.test.ts` (new) | ~280 行 — cross-process (子 node プロセス spawn) + 偽陽性防止 (XObject/font/Rotate/CropBox 差分) + lock test (pdf-lib internal API 依存) |
| C | `scripts/lib/collisionClassifier.ts` 修正 | ~50 行 — visual fingerprint 比較 + reason 細分化 |
| D | `scripts/classify-collision-docs.ts` 修正 | ~30 行 — plan に `hashAlgorithm: "pdf-page-visual-v1"` 記録 |
| E | `scripts/execute-collision-migration.ts` 修正 | ~30 行 — hashAlgorithm version mismatch で gate reject |
| F | `scripts/setup-collision-fixture.ts` 修正 | ~80 行 — cross-process MatchedByHash 実証 fixture (子プロセス起動で生成) + 偽陽性防止 fixture |
| G | `functions/test/collisionClassifier.test.ts` 修正 | ~80 行 — unsupported feature + Ambiguous reason 細分化 |
| H | dev 環境通し検証 (PR-C2 内) | dev データ |
| K | `docs/runbooks/orphan-storage-cleanup.md` 修正 | ~50 行 — visual fingerprint v1 説明 + Ambiguous reason 細分化表 |

**Acceptance Criteria** (AC1-AC14): AC1-AC8 は v1 から継続、AC9-12 で偽陽性防止 (XObject/font/geometry/inline image)、AC13 で hashAlgorithm version mismatch gate reject、AC14 で pdf-lib internal API lock test。

**PR 分割戦略** (Codex 指摘反映):
- **PR-C2**: hasher (A,B) + classifier/plan/precondition 差替 (C,D,E) + fixture (F) + tests (G) + runbook (K) + dev 通し検証 (H)。merge 条件 = Codex 再 review + 7 並列 review + dev fixture 5 分類完全一致
- **PR-C2-execution** (PR-C2 merge 後別 PR): dev 実行ログ + cocoro classify dry-run + kanameone classify dry-run + 番号認可付き execute + post-audit + Issue #432 close 報告

**着手手順** (次セッション catchup 後):
1. `git checkout -b fix/issue-432-pr-c2-visual-fingerprint`
2. A 実装 → B (cross-process test) → C/D/E/F/G 並列 (Agent Teams 候補) → K → H (dev 通し検証)
3. `/codex review` MCP で再セカンドオピニオン
4. `/review-pr all parallel` で 7 並列 review
5. PR 作成 → CI → merge 認可依頼 → merge
6. PR-C2-execution へ

### 主要 PR

| PR | タイトル | 状態 |
|---|---|---|
| #439 | docs: 2026-05-12 session58 handoff (Issue #432 PR-C1 完遂、Net 0) | ✅ merged (`42e4d3f`) |
| (本 PR) | docs: 2026-05-12 session59 handoff (PR-C1 設計欠陥発覚 + PR-C2 v2 計画確定、Net 0) | 提出中 |

<a id="session58"></a>
## ✅ session58 完了サマリー (2026-05-12: Issue #432 PR-C1 collision migration scripts 完遂、Net 0)

session57 で残課題だった PR-C (マイグレーション = 過去被害 90+ docs 復旧) を「PR-C1 (実装) + PR-C2 (実行ログ)」に分割し、PR-C1 を完成。`/codex plan` セカンドオピニオンで Critical 2 件 (LikelyWinner 自動 destructive 禁止 / 「敗者 doc を pending 化」禁止 = OCR 再処理キュー破壊) + Important 6 件 を計画段階で反映してから実装。7 並列 review で更に Critical 9 件 + Important 3 件を検出・反映。

### 経緯

1. **計画段階**: `/impl-plan` で PR-C 計画策定 → `/codex plan` MCP セカンドオピニオン → 致命的指摘反映:
   - Critical: LikelyWinner 自動 destructive action 禁止 (`rotatedAt!=null 唯一` は離脱可能性 hint であり Storage 実体正当性証明ではない、silent breakage 偽装復旧の再演リスク) → Ambiguous 内 suggestedWinner hint に降格
   - Critical: 「敗者 doc を pending + fileUrl クリア」禁止 (`processOCR` の OCR 再処理キューを壊す、splitPdf 再生成トリガーではない) → RepairableMissingFile 経路で親から再生成
   - Important: hash は GCS md5Hash ではなく sha256 download/regenerated bytes / 4 重 gate (planId + operationId + path + env + precondition) / dev fixture / storageGuard 共有 / migration freeze window
2. **PR #438 (PR-C1) 初回 commit (`31572b4`) merged**: 11 files / +2226 行
   - `scripts/lib/collisionClassifier.ts` (5 分類 pure function) + `storageGuard.ts` (削除安全性) + `pdfRegenerator.ts` (parent から PDF 再生成)
   - `scripts/classify-collision-docs.ts` (read-only scan → JSON plan) + `execute-collision-migration.ts` (4 重 gate + idempotent execute) + `setup-collision-fixture.ts` (dev 環境 fixture)
   - `functions/test/collisionClassifier.test.ts` (15 tests) + `storageGuard.test.ts` (5 tests)
   - `docs/runbooks/orphan-storage-cleanup.md` (PR-C 手順 + freeze window 追記) + `.github/workflows/run-ops-script.yml` (script choice + ts-node 分岐)
3. **品質ゲート**: 7 並列 review (`/review-pr` 5 agent + `/codex review` MCP + `evaluator` 分離) で Critical 9 件 + Important 3 件追加検出
4. **PR #438 fix-up commit (`f6c0f03`) merged**: 7 files / +642 行 で Critical 全件反映:
   - F-A1: parent PDF 探索を `bucket.file().exists()` + cache 化 (`processed/` 一覧のみ参照していた根本バグ → 本番でほぼ全 doc が hash 不能になる欠陥を修正)
   - F-A2: orphan を collision group から `continue` 除外 (二重登録防止)
   - F-A3: idempotency 判定を precondition より前に評価 (中間状態の自動復旧)
   - F-B1: regenerate path gate に sourcePath 認可追加 (ADR-0008 違反修正)
   - F-B2: Storage delete を 404 のみ silent skip + outcome に oldDeleteOutcome/Error 残す
   - F-B3: `downloadIfExists` を `{kind: ok|absent|error}` 構造化、computation-error は Lost に降格させず Ambiguous に留める (transient 503 を「永久 lost」と分類して status='error' 焼き込みを防ぐ)
   - F-B4: parent fileUrl bucket 一致を classify + executeRegenerate 両方で検証
   - F-B5: Gate 0 (defense-in-depth) — Ambiguous + suggestedWinner=true の destructive action を reject
   - F-C1+C2: `classifyLoserForRegeneration` rename + コメント rot 修正 (敗者処理の隠蔽解消)
   - F-C3: `Classification` / `RecommendedAction` 型を classifier から `import type` 化 (drift リスク解消)
   - F-D1: `pdfRegenerator.test.ts` 10 tests (deterministic 性 = MatchedByHash 信頼性根拠を lock-in)
   - F-D2: `executeMigrationOps.ts` 切り出し + `executeMigrationOps.test.ts` 14 tests (Partial update 不変、CLAUDE.md MUST 準拠)
5. **PR #438 merge**: 13 files / +2868 行 / -81 行、squash merge `3d88fdb`、ブランチ削除済

### Issue Net 変化

| 項目 | 内容 |
|------|------|
| Close 数 | 0 件 |
| 起票数 | 0 件 |
| **Net 変化 (session58 単独)** | **0 件** |

**Net 0 の進捗判定**: ✅ 正の構造的進捗。Issue #432 (P0) の 4 PR 計画 (A/B/C/D) のうち PR-C1 (実装) を Codex Critical 全反映 + 7 並列 review で堅牢化して完了。残 PR-C2 (kanameone destructive 実行) は番号認可必須のため次セッション持越し。Issue #432 close は PR-C2 完了で。

### 主要 PR

| PR | コミット | 内容 |
|---|---|---|
| **#438** | `3d88fdb` | fix(scripts): Issue #432 PR-C — 衝突/orphan 5 分類 migration (Codex 反映) (13 files / +2868/-81) |

### 展開結果

| 環境 | PR-C1 |
|------|------|
| dev | ✅ main 反映 (Functions 変更ゼロ、scripts のみ) |
| kanameone | ✅ main 反映 (Functions 変更ゼロ、PR-C2 で classify → execute 実行予定) |
| cocoro | ✅ main 反映 (Functions 変更ゼロ、PR-C2 で classify dry-run 0 件確認予定) |

### 教訓

#### 1. destructive migration の impl-plan は AskUserQuestion 前に Codex セカンドオピニオン必須
本セッション最重要教訓。本番データ復旧用 migration 計画を AI 単独で AskUserQuestion → ユーザー承認 → 実装に進むと致命的設計欠陥 (pending キュー破壊 / 不確定推定の自動実行) を見落とす。`/codex plan` で計画全文 + 質問リスト送付 → Critical/Important 反映 → AskUserQuestion で承認するフローを memory 化 (`feedback_destructive_migration_codex_review.md`)。本 PR の Codex 指摘は AI 単独レビュー (4 並列 review + evaluator 等) では検出不能だった。

#### 2. 7 並列 review が Critical 9 件を追加検出 (Codex plan 反映後でも漏れあり)
計画段階で Codex Critical 反映済の実装に対し、実装後の品質ゲート (4 agent + Codex review + evaluator + comment-analyzer + type-design + test-analyzer) で更に Critical 9 件を検出。特に重大:
- A1 (parent path を `processed/` 一覧でしか探さない = 本番動作の根本バグ): Codex review で発見、4 agent も evaluator も見落とし
- C1+C2 (コメントが古い設計を残し、operator が destructive action を見落とす設計の透明性破壊): comment-analyzer 単独で発見
- D2 (Partial update 不変が実 update 形状で未検証 = CLAUDE.md MUST 違反): test-analyzer 単独で発見

各 agent の専門性が補完的に機能した実例。CLAUDE.md「5 ファイル以上 + 新機能 → Evaluator 分離プロトコル」+「大規模 PR → /codex review」+「PR レビュー → /review-pr (6 並列)」を併用する正当性を裏付け。

#### 3. fixture が本番欠陥を隠蔽するアンチパターン
F-A1 修正前の `setup-collision-fixture.ts` は parent PDF を `processed/` 配下に配置しており、`classify-collision-docs.ts` が `processed/` Storage 一覧でしか parent 探さない欠陥を fixture では検出できなかった。**「fixture は本番のデータ配置を実環境同等に再現すべき」**。原因は「fixture を単純化したい誘惑」と「Codex Critical の cocoro 0 件 no-op 問題対策で急造した fixture が新たな盲点を作った」ため。fixture 設計時は「fixture が本番と異なる前提を持っていないか」を意識的にチェック。

#### 4. tagged union と pure function 分離が test 容易性を担保
F-D2 で `executeMigrationOps.ts` を切り出して build*UpdatePayload を pure function 化することで、Firestore emulator なしで Partial update 不変 (CLAUDE.md MUST) を 14 tests でカバーできた。execute-collision-migration.ts は admin.initializeApp() を top-level で呼ぶため import するだけで起動が走るが、ロジック部分のみ pure function に分離すれば test ファイルから副作用なく import 可能。**「testable な pure function 部と CLI entrypoint 部を分離する」設計パターン**を migration script 系に適用する標準とする。

### 次のアクション (次セッション以降)

1. **PR-C2 dev fixture 検証** (Codex Critical 「cocoro 0 件 no-op で本番初動」回避):
   - `./scripts/switch-client.sh dev`
   - `FIREBASE_PROJECT_ID=doc-split-dev STORAGE_BUCKET=doc-split-dev.firebasestorage.app npx ts-node scripts/setup-collision-fixture.ts`
   - `npx ts-node scripts/classify-collision-docs.ts --out plan-fixture.json` → 5 分類 (MatchedByHash + Ambiguous + RepairableMissingFile + LostOrUnrecoverable) のうち期待数で出るか確認
   - approval JSON 手動作成 → `execute --dry-run` → 期待出力照合 → `--execute` → Firestore/Storage 状態の期待値確認 → fixture cleanup
2. **cocoro 環境 classify dry-run** (被害ゼロ環境で 0 件レポートが出ることを確認):
   - `./scripts/switch-client.sh cocoro` → `classify-collision-docs.ts` 実行 → `summary.totalGroups=0 / totalOrphans=0` を期待
3. **kanameone 環境 PR-C2 実行** (番号認可必須 = destructive):
   - classify dry-run → 39 group + 4 orphan の分類レポート JSON
   - レポート提示 → 各分類の対応方針 + 各 operationId / sourcePath / destPath を文字列単位で含む承認文取得
   - approval JSON 作成 → execute --dry-run → execute (番号認可後)
   - post-audit (`audit-storage-mismatch.js`) で衝突 group 0 / orphan 0 確認
4. **PR-C2 (実行ログ PR)** + Issue #432 close 報告
5. **PR-D follow-up (任意 / 別 PR)** (session57 から継続):
   - Cloud Monitoring alert policy (`cleanupResult=failed`)
   - audit-storage-mismatch.js の cron 定期実行
6. **handoff 別 PR 候補 (session58 quality-gate 後送り、Important 級)**:
   - evaluator HIGH-2: 衝突 group 全敗者完了後の旧 path 残存対策 (post-migration cleanup pass)
   - silent-failure I2: executeMigrate destExists skip の md5 検証
   - silent-failure I3: updatedAt null doc の precondition false skip (runbook 明記で代替済)
   - type-design P1+: Operation tagged union / Zod boundary validation

### 残 Open Issue (4 件)

| # | タイトル要約 | 状態 | 再開条件 |
|---|---|---|---|
| **#432** | [P0] 分割PDF 設計バグ | **PR-A/B/D + PR-C1 完了、PR-C2 残り** | 次セッションで PR-C2 (dev fixture → cocoro → kanameone destructive 実行 + post-audit) |
| #402 | searchDocuments OOM ガード + 計測ログ | 段階1 完了、段階2/3 観測待ち | 2026-05-12 頃に観測データ判断 |
| #251 | summaryGenerator unit test + buildSummaryPrompt 分離 | Scope 2 完了、Scope 1/3 待機 | sinon 導入伴う他タスク or Vertex AI false negative |
| #238 | force-reindex 孤児 posting 検出モード | drift 実発生未観測 | ADR-0015 silent failure metric ERROR or 削除済書類ヒット報告 |

<a id="session57"></a>
## ✅ session57 完了サマリー (2026-05-11: Issue #432 PR-A/PR-B/PR-D 完遂、Net 0)

session56 で起票した P0 Issue #432 (分割PDF Storage 設計バグ、kanameone で silent breakage 90+ docs + 完全消失 4 件) に対し、Codex セカンドオピニオン (B 案推奨) を活用しつつ 3 PR を順に完成・全環境展開。進行中破壊の停止 + 新規発生のゼロ化 + 検出機構が完了。

### 経緯

1. **計画段階**: `/impl-plan` で PR-A/B/C/D 4 分割計画策定 → `/codex plan` セカンドオピニオンで 5 件の修正方針反映 (PR-B 補償処理 / PR-C 信頼度付き 4 分類 / fileUrl 参照範囲調査 / generateFileName 段階削除 / 旧/新 path 混在 AC 追加)
2. **PR #434 (PR-A safety net) merged**: `rotatePdfPages` / `deleteDocument` に「同 fileUrl 共有 doc」detection を導入し、共有検出時は構造化警告ログ (`skippedStorageDelete: true`, `skipReason: 'sharedFileUrl' | 'safetyNetQueryFailed'`) を出して delete を skip。fail-closed 設計。4 並列 review で Critical 1 (silent failure) + Important 8 を修正、kanameone/cocoro Functions deploy で進行中破壊停止
3. **PR #435 (PR-B docId namespace) merged**: `splitPdf` の Storage path を `processed/{fileName}` → **`processed/{docId}/{fileName}`** に変更し path 衝突を構造的に根治。補償処理 (Storage save 成功 → Firestore set 失敗時の cleanup + Error.cause + orphanLeft マーカー) も統合。4 並列 review で Critical 1 + Important 8、3 環境展開
4. **PR #436 (PR-D 検出強化) merged**: PR-B follow-up 3 件統合 - `audit-storage-mismatch.js` reverse orphan mode 追加 / 3 call sites path-extraction grep contract test / `docs/runbooks/orphan-storage-cleanup.md` 新規 runbook。5 並列 review (4 agent + codex) で Critical 4 + Important 多数を修正、main merge (Functions 変更なし展開不要)

### Issue Net 変化

| 項目 | 内容 |
|------|------|
| Close 数 | 0 件 |
| 起票数 | 0 件 (Issue #432 follow-up 6 件は本 Issue へコメント集約、Net 増加回避) |
| **Net 変化 (session57 単独)** | **0 件** |

**Net 0 の進捗判定**: ✅ 正の構造的進捗。Issue #432 (P0) の 4 PR 計画 (A/B/C/D) のうち 3 件完了で、進行中破壊停止 + 新規発生ゼロ化 + 検出機構が完了。残る PR-C (マイグレーション、過去被害 90+ 件復旧) は destructive 操作のため kanameone 実行に番号認可必須 = 次セッションへ持越し。`feedback_issue_triage.md` の rating 5-6 機械起票には該当せず、follow-up 6 件 (audit reverse orphan logic / AC-B3 contract / segments rollback / contract test negative pattern 拡充 / コメントアウト bypass / rotatePdfPages scope 絞り) はすべて Issue #432 にコメント集約することで散逸を回避。

### 主要 PR

| PR | コミット | 内容 |
|---|---|---|
| **#434** | `683bce9` | fix(storage): Issue #432 PR-A safety net (4 files / +281/-8) |
| **#435** | `337e66c` | fix(pdf): Issue #432 PR-B docId namespace (3 files / +240/-45) |
| **#436** | `1f681d4` | feat(detection): Issue #432 PR-D 検出強化 + runbook (3 files / +352/-9) |

### 展開結果

| 環境 | PR-A | PR-B | PR-D |
|------|------|------|------|
| dev | ✅ CI auto deploy | ✅ CI auto deploy | ✅ main reflect (Functions 変更なし) |
| kanameone | ✅ Deploy Cloud Functions | ✅ Deploy Cloud Functions | ⏭️ Functions 変更なし、展開不要 |
| cocoro | ✅ Deploy Cloud Functions | ✅ Deploy Cloud Functions | ⏭️ Functions 変更なし、展開不要 |

### 教訓

#### 1. 4 並列 review + codex review (large tier) の有効性
PR-B では Codex review が「Storage save 成功 → Firestore set 失敗の補償処理を namespace 化と同 PR で行うべき」を発見、4 agent では検出されない設計レベルの指摘を補完。PR-D では Critical 4 件 (pathFromUrl silent skip / Storage 0 件 load 失敗区別 / parentDocumentId 誤読 / line drift) を 5 並列で漏れなく検出。CLAUDE.md「大規模 PR (3+ ファイル / 200+ 行) → /codex review」を実証

#### 2. silent-failure の隠れ場所
PR-A 元実装で `canSafelyDeleteStorageFile` を pre-existing `try/catch (deleteErr) { console.log('may not exist') }` 内に置いた結果、Firestore query 失敗が「old file may not exist」と誤誘導ログに巻き取られて signal 喪失。独立 try/catch + skipReason 識別 + 構造化 log で修正。silent-failure-hunter agent の必須性を再確認

#### 3. 番号認可境界の言語表現
PR-D runbook で「番号認可必須」と書いていたが、「Issue 番号認可」と誤読される可能性 (例: `Issue #432 全件削除してよい` → prefix 一括削除実行)。「個別パス認可必須 (per-path explicit authorization required)」+ `gs:// path を文字列単位で含む承認文のみ有効` と明示。ADR-0008 の prefix 一括削除禁止教訓を runbook レベルで強化

#### 4. handoff コメント集約による Issue Net 増加回避
PR-B/PR-D の review で抽出した follow-up 計 6 件 (audit reverse orphan / AC-B3 contract / segments rollback / contract test negative pattern 拡充 / コメントアウト bypass / rotatePdfPages scope 絞り) は、別 Issue 起票せず Issue #432 にチェックリスト集約。triage 基準 #4 (rating ≥ 7 + confidence ≥ 80) を満たすが、親 Issue が open のため散逸を回避できる利点を優先

### 次のアクション (次セッション以降)

1. **PR-C マイグレーション実装 + 番号認可付き実行** (Issue #432 残り):
   - 信頼度付き 4 分類 (`MatchedByHash` / `LikelyWinner` / `Ambiguous` / `LostOrUnrecoverable`) ロジック実装 (Codex セカンドオピニオン推奨)
   - cocoro 環境で test 実行 → kanameone 番号認可後実行
   - kanameone 90+ docs silent breakage + 4 orphan の復旧
2. **PR-D follow-up (任意 / 別 PR)**:
   - Cloud Monitoring alert policy 設定 (`jsonPayload.cleanupResult="failed"`)
   - audit-storage-mismatch.js の cron 定期実行
   - ヘルスレポート 4 指標追加 (fileUrl 重複 / Storage path × docId 一意性 / parentDocumentId 関連欠損 / 回転履歴件数)
   - contract test の更広 negative pattern (`path.parse` / `substring` / `lastIndexOf`) + コメントアウト bypass 対策
3. **generateFileName timestamp 引数完全削除** (PR-C migration 完了後、旧 timestamp 引数の caller 残存ゼロを `tsc` で確認してから signature から削除する別 PR)
4. **kaname / cocoro 運用者目視確認** (本番に新コード稼働の影響観測、受動待機)

### 残 Open Issue (4 件)

| # | タイトル要約 | 状態 | 再開条件 |
|---|---|---|---|
| **#432** | [P0] 分割PDF 設計バグ | **PR-A/B/D 完了、PR-C 残り** | 次セッションで PR-C 実装 + 番号認可後実行 |
| #402 | searchDocuments OOM ガード + 計測ログ | 段階1 完了、段階2/3 観測待ち | 2026-05-12 頃に観測データ判断 |
| #251 | summaryGenerator unit test + buildSummaryPrompt 分離 | Scope 2 完了、Scope 1/3 待機 | sinon 導入伴う他タスク or Vertex AI false negative |
| #238 | force-reindex 孤児 posting 検出モード | drift 実発生未観測 | ADR-0015 silent failure metric ERROR or 削除済書類ヒット報告 |

<a id="session56"></a>
## ✅ session56 完了サマリー (2026-05-11: 分割PDF Storage 設計バグ調査、調査ツール 3 PR merged + P0 Issue #432 起票、Net -1)

2026-05-10 ヘルスレポートの kanameone 1 件 `No such object` エラーを起点に、調査ツール構築 → 全件監査 → 設計バグ発見 → Codex セカンドオピニオン → P0 Issue 起票まで完遂。設計バグ修正実装は session57 で完了。

### 経緯

1. **エラー検出**: 2026-05-10 ヘルスレポートで kanameone 環境に 1 件のみ `No such object: docsplit-kanameone.firebasestorage.app/processed/20260509_未判定_未判定_p3.pdf` エラー検出
2. **Storage 側調査**: `gsutil ls processed/` で旧パス `_p3.pdf` 不在 + 回転後パス `_p3_r1778340000575.pdf` 存在を確認 → `rotatePdfPages` の `_r{timestamp}` パターンに合致
3. **PR #429 (merged)**: read-only な `inspect-document.js` 追加、`run-ops-script.yml` workflow_dispatch に組込み
4. **詳細調査**: workflow_dispatch で `fileName: 20260509_未判定_未判定_p3.pdf` 検索 → **3 docs が同 fileName** を持つことを発見（うち 1 件は status:processed のまま実体破壊 = silent failure 確定）
5. **PR #430 (merged)**: 全件 audit を行う `audit-storage-mismatch.js` 追加（`bucket.getFiles({prefix, autoPaginate:false})` ページング + Set 化で O(1) lookup）
6. **PR #431 (merged) follow-up**: PR #430 が初回 fail（`storageBucket` 未指定）→ `scripts/clients/<env>.env` の `STORAGE_BUCKET` を resolve step で抽出 + Run script env 経由で渡すよう修正
7. **kanameone 監査**: 5,725 docs 中 processed/ 211 docs / Storage 145 ファイル / **fileUrl 孤児 4 件 (processed:3 + error:1) / fileName 衝突 39 group**（最大 6 docs/group, ほぼ `日付_未判定_未判定_pXX.pdf` パターン）
8. **cocoro 監査**: 539 docs 中被害ゼロ、ただし設計バグは共通（データ規模 1/10 で衝突確率が低いだけ）
9. **P0 Issue #432 起票**: triage 基準 #1（実害あり = データ silent 破壊・ユーザー影響）該当
10. **Codex セカンドオピニオン (MCP review)**: 修正方針 A→B 案変更 / `deleteDocument` 追加経路発見 / 非トランザクション split 発見 / マイグレーション 5 分類追加 / 検出指標 4 項目追加
11. **Issue #432 本文を edit 更新**: Codex 補強指摘を全反映、修正方針セクション・根本原因セクション・マイグレーション計画・検出強化を再構成

### 根本原因（Issue #432 詳細参照）

- **`generateFileName` (`functions/src/pdf/pdfOperations.ts:581-595`)** に衝突回避要素なし（`timestamp` 引数を受け取るが日付部分しか使わない）
- **`bucket.file(newFilePath).save()` (`pdfOperations.ts:328-332`)** が衝突検査せず上書き
- **`rotatePdfPages` (`pdfOperations.ts:528-545`)** が古ファイル delete で同パス共有 docs を破壊
- **`deleteDocument` 経路（Codex 発見）** も同様の連鎖破壊
- **splitPdf の Storage save と Firestore set が非トランザクション**（Codex 発見）

### 修正方針（Codex 評価で更新、session57 で実装完遂）

- **B 案（推奨・根治）**: `processed/{docId}/{fileName}` で **docId namespace 分離**（Storage path を doc identity に従属） → ✅ PR #435 で実装
- **A 案（代替・対症）**: `generateFileName` に **`docId` suffix** 追加 → 採用せず (B 案で十分)
- **C 案（補助）**: `rotatePdfPages` / `deleteDocument` で同パス共有 docs を検出 → 最後の参照のみ削除（safety net） → ✅ PR #434 で実装

### Issue Net 変化

| 項目 | 内容 |
|------|------|
| Close 数 | 0 件 |
| 起票数 | 1 件 (#432) |
| **Net 変化 (session56 単独)** | **-1 件** |

### 主要 PR

| PR | コミット | 内容 |
|---|---|---|
| **#429** | `e41a082` | feat(scripts): inspect-document.js 追加 — documents Firestore read-only 調査ツール (2 files / +185/-0) |
| **#430** | `eddd051` | feat(scripts): audit-storage-mismatch.js 追加 — Firestore↔Storage 整合性監査 (2 files / +152/-0) |
| **#431** | `37da31c` | fix(scripts): audit-storage-mismatch に STORAGE_BUCKET env 必須化 (2 files / +33/-4) |

### 監査結果（Issue #432 詳細参照）

| 環境 | Total docs | processed/ docs | Storage files | orphans | collisions |
|------|---|---|---|---|---|
| kanameone | 5,725 | 211 | 145 | **4** (processed:3 + error:1) | **39 groups** |
| cocoro | 539 | 23 | 23 | 0 | 0 groups |

---

session51-55 は `docs/handoff/archive/2026-05-history.md` 参照。
session29-50 は `docs/handoff/archive/2026-04-history.md` 参照。
