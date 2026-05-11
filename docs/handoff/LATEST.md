# ハンドオフメモ

**更新日**: 2026-05-11 session57 (**Issue #432 P0 設計バグ修正 PR-A/PR-B/PR-D 完遂、Net 0**。session56 で起票した P0 Issue #432 に対し PR #434 (safety net) → PR #435 (docId namespace 根治) → PR #436 (検出強化 + runbook) を順に 4 並列 review + codex review でセカンドオピニオン取得しつつ実装、3 環境 (dev / kanameone / cocoro) 全展開完了。進行中破壊停止 + 新規発生ゼロ化 + 検出機構整備。残る PR-C マイグレーション (過去被害 90+ 件復旧、destructive) は次セッションで番号認可付き実行)
**ブランチ**: main (`.serena/project.yml` のみ未コミット差分、Serena LSP 自動更新で機能影響なし)
**フェーズ**: Phase 8 + 運用監視基盤全環境展開完了 + (session29-55 累積実績は archive 参照) + Phase 8 (session56 = 分割PDF Storage 設計バグ調査、Net -1) + **Phase 8 (session57 = Issue #432 PR-A/B/D 完遂、Net 0)** 完遂

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
| 起票数 | 0 件 (Issue #432 follow-up 3 件は本 Issue へコメント集約、Net 増加回避) |
| **Net 変化 (session57 単独)** | **0 件** |

**Net 0 の進捗判定**: ✅ 正の構造的進捗。Issue #432 (P0) の 4 PR 計画 (A/B/C/D) のうち 3 件完了で、進行中破壊停止 + 新規発生ゼロ化 + 検出機構が完了。残る PR-C (マイグレーション、過去被害 90+ 件復旧) は destructive 操作のため kanameone 実行に番号認可必須 = 次セッションへ持越し。`feedback_issue_triage.md` の rating 5-6 機械起票には該当せず、follow-up 3 件 (audit reverse orphan logic / AC-B3 contract / segments rollback) はすべて Issue #432 にコメント集約することで散逸を回避。

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
3. **generateFileName timestamp 引数完全削除** (caller 修正後の別 PR):
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
