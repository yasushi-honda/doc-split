# ハンドオフメモ

**更新日**: 2026-05-13 session66 (**Issue #432 PR-C3c 完遂: AC15-3 強化 + Codex review GO + dev リハーサル 7 stages 2 周成功 + main merge `83921b2` + main CI/Deploy success、Net 0**。session65 で NO-GO 指摘された AC15-3 (現在 GCS 状態との再計算照合) を `scripts/lib/sourceManifestDrift.ts` 新規 pure functions + `verifySurveyManifestAgainstCurrentGcs` (listing + getMetadata 並列 8、軽量) + operator runbook 6 ステップで強化。Codex MCP セカンドオピニオン (新 thread) で **GO 判定** + High 1 件 (local artifact opt-in 化) 即時反映。dev リハーサル Stage 1-7 全 success (Stage 3 で AC15-3 PASS ログ、Stage 5 で 4 ops executed)。19 新規 unit tests 追加で functions/ npm test 998 → 1018 passing。Issue #432 P0 根本対策 PR-C3 計画 AC 21 項目 (PR-C3a 〜 PR-C3c) 全達成、kanameone 90+ docs CCITTFaxDecode silent breakage 解消経路を構造的に確立。次セッション着手候補: kanameone / cocoro 本番展開判断 (別 PR + 番号認可) / PR-D1 (Issue #445 データモデル正規化) 並行)
**ブランチ**: `main` (PR #452 squash merge 完了、`83921b2`、main CI run #25773711722 success ✅、main Deploy run #25773711749 success ✅)
**フェーズ**: Phase 8 + 運用監視基盤全環境展開完了 + (session29-65 累積実績は archive 参照) + **Phase 8 (session66 = Issue #432 PR-C3c 完遂 = AC15-3 強化 + Codex GO + main merge `83921b2`、Net 0)** = Issue #432 P0 根本対策 PR-C3 計画完遂

<a id="session66"></a>
## ✅ session66 完了サマリー (2026-05-13: Issue #432 PR-C3c AC15-3 強化 + Codex GO + main merge `83921b2` 完遂、Net 0)

session65 で実装した PR-C3c 初版が Codex MCP セカンドオピニオン (実装後 review、thread `019e1e7b-...`) で **NO-GO 判定**: 「計画書 v2 の AC15-3 (現在 GCS 状態との再計算照合) と実装の乖離」(loadAndValidateSurveyArtifact が artifact 内部の自己整合性のみで、survey T1 と classify T2 の drift 検出不能)。本セッションで AC15-3 強化 + dev リハーサル 2 周成功 + Codex 新 thread GO 判定 + main merge を完遂。

### 経緯

1. **catchup**: session65 handoff 確認、次セッション着手指示 1-9 をタスク化 (TaskCreate × 9)
2. **AC15-3 強化実装** (commit `eabab2a`、+733/-12、4 files):
   - `scripts/lib/sourceManifestDrift.ts` (新規 162 行): SourceManifestEntry vs CurrentGcsState の pure functions (`compareSurveyManifestToCurrentGcs` / `hasManifestDrift` / `formatDriftError` + 6 ステップ runbook 定数)
   - `scripts/classify-collision-docs.ts`: `fetchCurrentGcsState` (listing + getMetadata 並列 8、bytes/sha256 非計算で軽量) + `verifySurveyManifestAgainstCurrentGcs` (local skip / bucket+prefix mismatch fail-fast / drift exit 2 + runbook 出力) を追加、`main()` で `loadAndValidateSurveyArtifact` 直後に呼出
   - `scripts/execute-collision-migration.ts`: write phase precondition drift exit 1 メッセージに同 runbook を追加 (AC15-3 drift と precondition drift は同根 = concurrent write)
   - `functions/test/sourceManifestDrift.test.ts` (新規 19 tests): pure functions 全分岐カバー
3. **tsc + npm test**: tsc clean / **1018 passing** (前 998 → +19 + 1 微差、regression 0)
4. **commit + push** → CI run `25772551392` ✅ success
5. **dev リハーサル 7 stages (2 周目、AC15-3 強化版)** 全 success:
   - Stage 3 で `AC15-3 PASS: 4 survey entries match current GCS state (no drift)` ログ確認
   - Stage 5 destructive で `executed:4 + skipped:2` (regen×2 + migrate×1 + mark-error×1 + manual-review×2)
   - Stage 6 idempotency `skipped:6` (4 already-applied + 2 manual-review)
6. **Codex MCP セカンドオピニオン (新 thread、AC15-3 強化後の最終 review)**: **GO 判定 (AC15-3 充足)** + High 1 件指摘 (local survey artifact が GCS classify を bypass する穴) + 設計判断 5 項目すべて妥当判定 (local skip / bucket-prefix fail-fast / getMetadata 失敗を drift 扱い / generation 不一致時に metageneration 比較 skip / bytes/sha256 非計算軽量化)
7. **Codex review High 1 件反映** (commit `032c04e`、+11/-2): `ALLOW_LOCAL_SURVEY_ARTIFACT=1` 環境変数 opt-in 必須化、それ以外は exit 2 で reject
8. **PR #452 ready for review** + body に session66 追記 → ユーザー番号認可「PR #452 をマージしてよい」取得 → **squash merge `83921b2`** → main CI/Deploy success
9. **handoff (session66)**: session61-65 を archive へ移動、LATEST.md を 595 行 → ~150 行 に削減

### Issue Net 変化

| 項目 | 内容 |
|------|------|
| Close 数 | 0 件 (Issue #432 は未 close、kanameone 本番展開後に close 判断) |
| 起票数 | 0 件 |
| **Net 変化 (session66 単独)** | **0 件** |

**Net 0 の進捗判定**: ✅ 正の構造的進捗。Issue #432 (P0) 根本対策 PR-C3 計画 (AC 21 項目) **全達成**、kanameone 135 docs CCITTFaxDecode Ambiguous 倒れの解消経路を **dev リハーサル 7 stages × 2 周 destructive 実証** で構造的に確立。本番展開判断は別 PR + 番号認可 (本セッション scope 外)。triage 基準 #5 (ユーザー明示指示「次のアクション優先順にすすめて」「PR #452 をマージしてよい」) 該当。

### 主要 PR / 実行記録

| 項目 | 値 |
|---|---|
| **本 PR (PR-C3c)** | **PR #452 merged** (squash commit `83921b2`、7 commits、13 files +2,372/-122) |
| commit (session66 AC15-3 強化) | `eabab2a` (4 files +733/-12) |
| commit (session66 Codex High 反映) | `032c04e` (1 file +11/-2) |
| CI on `032c04e` | run `25773523830` ✅ success |
| dev リハーサル 2 周目 Stage 1-7 | runs `25772656560` - `25773276670` 全 ✅ |
| Codex MCP セカンドオピニオン thread (新、AC15-3 強化後) | 結果ファイル `/tmp/codex-ac153-result.log` (GO + High 1) |
| main CI (post-merge) | run `25773711722` ✅ success |
| main Deploy (post-merge) | run `25773711749` ✅ success |

### AC 達成状況 (PR-C3 計画 21 項目、最終状態)

| AC | 達成 | 根拠 |
|---|---|---|
| AC13 / AC13 拡張 | ✅ | hashAlgorithm + pdfLibVersion 記録 + execute gate (PR-C2/C3a) |
| AC15-1 / AC15-2 | ✅ | classify `--survey-artifact` 必須 + expectations 検証 (PR-C3c session65) |
| **AC15-3** | ✅ **新規完遂** | **session66 強化**: 自己整合性 + 現在 GCS state 照合 (listing + getMetadata 並列 8、drift 5 種検出) |
| AC16 / AC17 / AC20 / AC21 | ✅ | 固定 synthetic fixture 6 種 + cross-process invariance + survey `--expect-*` + denylist scope 限定 (PR-C3b) |
| AC18-1/18-2/18-3 | ✅ | provenance 6 fields 完備 + runtime 親 PDF sha256+metadata 照合 (PR-C3c session65) |
| AC19-1/19-2 | ✅ | 4 category → action マッピング + provenanceRequired 必須 (PR-C3c session65) |
| AC-SCHEMA-1/2 | ✅ | `schemaVersion='collision-plan-v3'` literal 比較 (PR-C3c session65) |
| AC-CC1-1/CC1-2 | ✅ | classify plan に lockfileHash + pdfLibLockfileVersion 記録 + execute gate (PR-C3c session65) |
| AC-PREFLIGHT-1/2 | ✅ | 2-pass preflight + 全件通過後 write phase (PR-C3c session65) |
| AC-SURVEY-MANIFEST | ✅ | survey + classify + execute で sourceManifestRef 受け渡し (PR-C3c session65+66) |
| AC-INVARIANT | ✅ | action ↔ provenanceRequired invariant gate (PR-C3c session65) |
| AC-NONRESTRICTIVE-1 | ✅ | dev リハーサル 2 周目 Stage 3 `Provenance computed: 2 | failed: 0` |
| AC-PRD-BRIDGE | 🟡 | PR-D2 (Issue #445) で Firestore 永続化、ADR-0016 で記録予定 (本 PR 範囲外) |

### 残 Open Issue (5 件、session65 から不変)

| # | タイトル要約 | 状態 | 再開条件 |
|---|---|---|---|
| **#432** | [P0] 分割PDF 設計バグ | **PR-A/B/C1/C2/C2-execution-A/D/C3a/C3b/C3c (session66 main merge `83921b2`) 完遂** | 次セッションで kanameone / cocoro 本番展開判断 (別 PR + 番号認可)、復旧確認後 close |
| **#445** | [P1] データモデル正規化 | 設計フェーズ | 次セッションで PR-D1 (ADR-0016 + 型定義) 着手候補 |
| #402 | searchDocuments OOM ガード | 段階1 完了 | 観測データ判断 |
| #251 | summaryGenerator unit test | Scope 2 完了 | sinon 導入伴う他タスク or Vertex AI false negative |
| #238 | force-reindex 孤児 posting 検出 | 未着手 | 観測データ蓄積後 |

### 教訓 (本セッション新規)

- **Evaluator APPROVE と Codex MCP NO-GO の判定差は AC 解釈の差**: session65 で確立した知見 (handoff archive 参照)。session66 で AC15-3 強化 + 新 thread Codex で GO 判定取得、両者の判定が一致したことで「計画書文面 ↔ 実装 ↔ Codex 一次解釈」の 3 者整合を実証。**5 段階 review (計画書 → 実装 → Quality Gate → Evaluator → Codex MCP) が destructive migration の必須プロセス**として確立。
- **Codex review High 1 件 (local artifact bypass) は env var opt-in で塞ぐ pattern**: `ref.bucket === 'local'` の早期 return が GCS classify を silent bypass する穴を、`ALLOW_LOCAL_SURVEY_ARTIFACT=1` 明示 opt-in で reject default に転換。通常 workflow 経路 (GCS bucket) は影響なし、test/CI debug の例外パスのみ env var で承認。**operator 誤投入の silent bypass を構造的に塞ぐ pattern** として今後の destructive script 設計の参考に。
- **AC15-3 強化の pure functions 分離は Codex review fix を 1 commit で確定できる利点**: I/O 部分 (listing + getMetadata) と純粋比較ロジック (drift 検出) を `sourceManifestDrift.ts` に分離したことで、19 unit tests で全分岐を 7 秒 (test suite 全体 11 秒) でカバー。Codex High 反映時 (commit `032c04e`) は I/O 関数 1 か所のみ修正で済み、pure functions test は再実行のみで passing 維持。
- **dev リハーサル 7 stages × 2 周は AC15-3 強化のリグレッション安全網として機能**: session65 で 1 周、session66 で 2 周目を実施。session65 と同じ 6 ops (MatchedByHash 1 + RepairableMissingFile 2 + Ambiguous 2 + LostOrUnrecoverable 1) を再現、Stage 3 で AC15-3 PASS ログ + Stage 5 で executed:4 + Stage 6 idempotency で skipped:6 を確認。**destructive migration の dev フルリハーサル 2 周は CI green の延長線として運用可能**。

### 次セッション着手項目

1. `/catchup` で本 handoff + Issue #432 状態 + open Issue 確認
2. **kanameone 本番展開判断** (本 PR 範囲外、別 PR + ユーザー番号認可必須): PR #452 の AC15-3 + AC18 + AC-CC1 + AC-PREFLIGHT を使い、kanameone 135 docs CCITTFaxDecode Ambiguous の解消を実機実行。事前に pdf-feature-survey で本番状態確認 + dry-run で classify plan 確認 + 番号認可付き execute。**復旧後 Issue #432 close 判断**
3. **cocoro 本番展開判断** (同上): cocoro 環境での同等処理。被害 0 件想定だが念のため survey + dry-run で確認
4. **PR-D1 着手** (Issue #445、read-only/設計): データモデル設計 ADR-0016 (fileName identity 排除 + docId namespace identity + provenance fields 必須化) + TypeScript 型定義 + Firestore schema 文書化 — 本番展開と並行可能
5. (option) **reverse orphan 1 件** (`processed/20260413_未判定_未判定_p27-28.pdf`) 調査 (low priority、follow-up)

---

session51-65 は `docs/handoff/archive/2026-05-history.md` 参照。
session29-50 は `docs/handoff/archive/2026-04-history.md` 参照。
