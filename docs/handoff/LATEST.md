# ハンドオフメモ

**更新日**: 2026-05-12 session62 (**Issue #432 PR-C3 計画 Codex 2 段階セカンドオピニオン経由で AC 21 項目に再起案 + session61 復旧 4 docs post-audit 完遂 + PR-D Issue #445 起票、Net +1**。Task #1 = `audit-session61-parent-provenance.js` (read-only) で kanameone 本番 4 docs を遡及検証 → verdict suspect 4/4 (rotation 後親から regenerate、provenance 未保存)、PR #444 merged。Task #2 = Codex MCP セカンドオピニオン 2 thread (旧 `019e1bc6-...` で Codex Critical 2 + 提案 6、新 `019e1c1e-...` で Critical 追加 4) を impl-plan 再起案に反映、AC 12→21 項目拡充。**核心修正 = AC19 (MatchedByHash は provenance 不要 / RepairableMissingFile + collision loser regenerate のみ provenance verified 必須)**、AC18 (provenance verified 6 fields 全一致)、AC20 (人工 fixture + 生成不能 feature の固定 synthetic 補完)、AC21 (denylist scope 限定)。Task #3 = PR-D Issue #445 起票 (ユーザー明示指示 #5 + rating 9 + confidence 95 triage クリア)、fileName identity 排除 + docId namespace identity + provenance fields 必須化のデータモデル正規化。**handoff archive 全体 + Issue #432 全コメント grep 確認で本番 LostOrUnrecoverable 0 件 = 完全破損ケースなし** 確定。次セッションは PR-C3a (feature survey + cross-process determinism 検証、read-only) and/or PR-D1 (データモデル設計 ADR + 型定義、read-only) 並行着手候補)
**ブランチ**: `docs/session62-handoff` (本 session62 entry 追記、PR 化中)
**フェーズ**: Phase 8 + 運用監視基盤全環境展開完了 + (session29-55 累積実績は archive 参照) + Phase 8 (session56-60 = Issue #432 PR-A〜PR-C2 v2 段階完遂、Net -1) + Phase 8 (session61 = Issue #432 PR-C2-execution A 部分完遂 + CCITTFaxDecode 設計限界判明、Net 0) + **Phase 8 (session62 = Issue #432 PR-C3 計画 AC 21 項目に再起案 + session61 post-audit + PR-D 起票、Net +1)** 完遂

<a id="session62"></a>
## ✅ session62 完了サマリー (2026-05-12: Issue #432 PR-C3 再起案 + post-audit + PR-D 起票、Net +1)

session61 の handoff 確認後、ユーザー指摘「いまのアプローチで本当に大丈夫か?」「破壊的にならず、kaname 問題解消、dev 主体、各クライアント等価運用」の 4 要件を構造的に満たすか再点検。Codex MCP セカンドオピニオン 2 thread を経由して PR-C3 計画の重大盲点を発見、AC を 12→21 項目に拡充。並行で session61 で execute した 4 docs の親 PDF provenance を遡及検証し、`verdict: suspect` 4/4 (rotation 痕跡) を確定。データモデル正規化 (fileName を identity に使わない) の根本対策を PR-D Issue #445 として起票。

### 経緯

1. **問題提起**: ユーザー指摘「破壊的にならず、kaname の問題対応を修正できて、dev が主となり他の各クライアントは基本は dev の内容を反映されているだけの状態。新しいクライアントが追加されても問題なく等しく運用が可能な状況となっているか?」→ 現 PR-C3 計画 (先行 Codex thread `019e1b56-...`) に 4 弱点を私が検出 (dev fixture 特化 / feature survey gate 未明記 / cross-process determinism 未検証 / kanameone 直行順序)
2. **Codex MCP セカンドオピニオン #1 (`019e1bc6-...`)**: 私の 4 弱点を Critical 2 (feature survey gate / cross-process determinism) + Important 2 に再評価、私の検出漏れ Critical 2 件追加 (親 PDF provenance gate / v2 fingerprint denylist 厳密化)、根本指摘 E (PR-C3 は修復アルゴリズム、新規クライアント運用には PR-D データモデル正規化が必須)
3. **案 D 採択**: B (post-audit) → A (PR-C3 再起案) + PR-D 並行起票
4. **Task #1 (post-audit)**: `scripts/audit-session61-parent-provenance.js` 新規 (read-only)、`.github/workflows/run-ops-script.yml` choice 追加 + `--out` 強制付与 + artifact upload。CI SA に `roles/logging.viewer` 未付与確認 (Cloud Logging 経路 scope 外)。dev で graceful skip (target docs 不在で exit 0) → kanameone 実機で **verdict: suspect 4/4** (parent metageneration=2 + updated≠timeCreated + rotatedAt 痕跡 + Storage path `_r<timestamp>` suffix = rotation 後親から regenerate)。**PR #444 merged**
5. **被害深刻度確認**: ユーザー質問「PDF ファイル自体が完全破損して復旧不可能など深刻なことは?」→ handoff archive 全体 (4498 行) + Issue #432 全 3 コメント grep 確認で **本番 LostOrUnrecoverable 0 件**、reverse orphan 1 件は Storage 実体生存。「完全復旧不可能」ケースなし確定
6. **Task #2 (PR-C3 再起案)**: `/impl-plan` で 5 段階分割 (C3a-C3e) + AC 17 項目 (旧 12 + Codex #1 + Critical 2 反映) を起案
7. **Codex MCP セカンドオピニオン #2 (`019e1c1e-...`)**: 新 thread で再評価 → **Critical 4 件追加 (AC18-21)**。特に **AC19 = 私の重大見落とし**: 初稿は「provenance verified 必須」を全 destructive action に課す設計だったが、それだと legacy 135 docs 全件 Ambiguous 降格で PR-C3 主目的失敗 → 正解は「MatchedByHash migrate-to-namespace は provenance 不要 (v2 fingerprint 一致が証拠)、RepairableMissingFile + collision loser regenerate のみ provenance verified 必須」の分離
8. **AC 21 項目最終形確定**: Issue #432 [#issuecomment-4430509019](https://github.com/yasushi-honda/doc-split/issues/432#issuecomment-4430509019) に追記
9. **Task #3 (PR-D 起票)**: Issue #445 起票、fileName identity 排除 + docId namespace identity + provenance fields 必須化 + rotatePdfPages 構造的修正 + backfill + 型/lint 禁止の 5 段階分割 (PR-D1〜D5)、PR-C3 との並行可能性明示 (PR-D 未完成でも PR-C3 は legacy Ambiguous 降格 or MatchedByHash 救済で動作)

### Issue Net 変化

| 項目 | 内容 |
|------|------|
| Close 数 | 0 件 |
| 起票数 | 1 件 (Issue #445 - ユーザー明示指示 #5 + rating 9 + confidence 95、構造的予防の長期 Issue) |
| **Net 変化 (session62 単独)** | **+1 件** |

**Net +1 の進捗判定**: 構造的予防策の起票 + 長期戦略の文書化として KPI 例外 (CLAUDE.md「Net ≤ 0 は進捗ゼロ扱い」の triage 基準 #5 該当)。session61 復旧の安全性確認 + PR-C3 計画の致命的盲点修正 + 新規クライアント運用の根本対策設計確立で、本セッションは Issue #432 全体の終結に向けた構造進捗大 (執行可能設計に到達)。

### Codex MCP セカンドオピニオン 2 段階で得た核心修正

#### 修正 1: AC19 (RepairableMissingFile / MatchedByHash の分離)

| 分類 | destructive action | provenance 要否 | 根拠 |
|---|---|---|---|
| **MatchedByHash** | `migrate-to-namespace` | **不要** | actual と expected の v2 fingerprint 一致自体が証拠 |
| **RepairableMissingFile** | `regenerate-from-parent` | **verified 必須** | 親 PDF 内容と過去 split の整合が必要 |
| **collision loser** | `regenerate-from-parent` | **verified 必須** | 同上 |
| **Ambiguous** | — (operator approval) | — | — |

→ kaname 135 docs の大半は MatchedByHash で救済可能、誤復旧リスクが残る operation のみ provenance gate で守る分離。

#### 修正 2: AC18 (provenance verified 6 fields 全一致)

```
parentDocumentId + splitFromPages + sourcePath + sourceBucket + generation + metageneration + sourceSha256
```

すべて一致して初めて `verified`。1 fields でも mismatch → Ambiguous + manual approval 降格。

#### 修正 3: AC20 (人工 fixture + 固定 synthetic 補完)

pdf-lib は CCITT/JBIG2/JPX/encrypted のネイティブ生成困難 → 生成不能 feature は固定 synthetic/minimal fixture or PII なし公開合成 sample で補完、fixture が survey で実際の `/Filter` を含むことを assert する test 必須。

#### 修正 4: AC21 (denylist scope 限定)

`/Parent` `/Prev` `/Next` `/First` `/Last` のグローバル除外禁止、Page tree / outline navigation / internal structural refs のみ scope 限定で除外。

### session61 復旧 4 docs の評価 (Task #1 結果)

| op | docId | parent | verdict | reasons |
|---|---|---|---|---|
| op-0136 | Lso7jEXzWxBjU4Cj6zqR | Xe6jCKoTk4yflHqefDtb | suspect | parent.metageneration=2 + updated≠timeCreated + rotatedAt 痕跡 + path `_r1778338356121` |
| op-0137 | M7i4Nx6khiYEo2KTGJHg | EkZ6bwIM3ji17UugWeEr | suspect | 同上 (path `_r1778339907915`) |
| op-0138 | U4Lf5ZPNA4IyH73SXE2P | FIGbegoDvfaUTO2cYHkI | suspect | 同上 (path `_r1778338966269`) |
| op-0139 | gifjllJ57Sx58TktzHCf | EkZ6bwIM3ji17UugWeEr | suspect | 同上 (path `_r1778339907915`) |

**3 親 PDF いずれも fileUrl が rotation 後の path (`_r<timestamp>` suffix) を指す**。session61 execute は rotation 後の親から regenerate しており、Codex 指摘「split 時の親と現在の親が同一」を満たしていない。視覚比較による rotation 前 内容との照合は backup 不在で構造的不能、ユーザー判断で **「rotation がページ内容保持 (向きのみ) なら復旧結果は実質正しい」前提で運用継続、将来予防 (PR-C3 + PR-D) に集中**の割り切り。

### 主要 PR / 実行記録

| 項目 | 値 |
|---|---|
| Task #1 PR | **PR #444 merged** (`6d42ad9`、audit script 334 行 + workflow 21 行) |
| Task #2 成果 | Issue #432 [#issuecomment-4430509019](https://github.com/yasushi-honda/doc-split/issues/432#issuecomment-4430509019) (AC 21 項目 + 5 段階分割 + provenance 設計) |
| Task #3 成果 | **Issue #445 起票** ([P1] データモデル正規化、bug+enhancement+P1) |
| Codex MCP thread (旧) | `019e1bc6-bbd9-7580-9442-08f8f534fd72` (PR-C3 6 提案 + Critical 2 + 根本指摘 E) |
| Codex MCP thread (新) | `019e1c1e-0fc8-70d1-a633-051f7521c4ee` (PR-C3 再起案再評価、Critical 4 件追加) |
| 本 PR (session62 handoff) | `docs/session62-handoff` (本 PR、handoff 追記) |
| kanameone audit run id | 25730687772 (✅ verdict suspect 4/4 確定) |
| dev smoke test run id | 25730427085 (✅ graceful skip exit 0) |

### Codex Important 指摘 (PR-C3 実装時注意)

- denylist 対象 dict scope を Page tree / outline / annotation で別管理 (実装時の lint check)
- image XObject survey で `/Filter` 配列, 複数 filter, `/DecodeParms` 配列, indirect object, `/Alternates`, `/SMaskInData`, `/Matte`, `/OPI` を可視化
- `metageneration` 変化での mismatch 判定は自動復旧率低下するため runbook 明記

### handoff サイズ最適化 (次セッション持越し)

LATEST.md が現時点 649 行 (目標 500 行超過)。session56-58 (PR-A/B/D + PR-C1 完遂) を archive/2026-05-history.md へ移動する作業を次セッション開始時に実施 (本セッションは session62 entry 追加優先で size 削減は持越し)。

### 残 Open Issue (5 件)

| # | タイトル要約 | 状態 | 再開条件 |
|---|---|---|---|
| **#432** | [P0] 分割PDF 設計バグ | **PR-A/B/C1/C2/C2-execution-A/D + post-audit 完了、PR-C3 計画 AC 21 項目確定** | 次セッションで PR-C3a (read-only) 着手 |
| **#445** | [P1] データモデル正規化 (Issue #432 根本対策) | **本セッション起票、設計フェーズ** | 次セッションで PR-D1 (ADR + 型定義) 着手候補 |
| #402 | searchDocuments OOM ガード + 計測ログ | 段階1 完了、段階2/3 観測待ち | 観測データ判断 |
| #251 | summaryGenerator unit test + buildSummaryPrompt 分離 | Scope 2 完了、Scope 1/3 待機 | sinon 導入伴う他タスク or Vertex AI false negative |
| #238 | force-reindex 孤児 posting 検出モード | drift 実発生未観測 | ADR-0015 silent failure metric ERROR or 削除済書類ヒット報告 |

### 次セッション着手項目

PR-C3a と PR-D1 は両方 read-only で並行可能。ユーザー判断:

1. **PR-C3a 実装** (Issue #432): `scripts/verify-pdf-determinism.ts` 新規 (cross-process invariance 検証、pdf-lib `embedPdf` の encoded bytes 保持を実証) + `scripts/pdf-feature-survey.ts` 新規 (本番 PDF の `/Filter` 分布事前列挙)。AC17 先行で C3b 着手前に main merge 必須。dev run で実証完了が完了条件
2. **PR-D1 実装** (Issue #445): データモデル設計 ADR 起案 + Firestore schema 文書化 + TypeScript 型定義 (fileName を identity に使わない型強制の設計)
3. **handoff サイズ最適化**: session56-58 を archive/2026-05-history.md へ移動 (LATEST.md を 500 行以下に削減)
4. **Issue #432 reverse orphan 1 件** (`processed/20260413_未判定_未判定_p27-28.pdf`) 調査 (low priority、follow-up)

<a id="session61"></a>
## ✅ session61 完了サマリー (2026-05-12: Issue #432 PR-C2-execution A 部分完遂、Net 0)

session60 で merge した PR-C2 v2 (pdf-page-visual-v1 fingerprint) を kanameone 本番に classify 実行したところ、**135 docs 全件 CCITTFaxDecode 未対応で Ambiguous 倒れ**。dev fixture には CCITTFaxDecode サンプルがなく Codex MCP セカンドオピニオン (Important 4: DCTDecode/JPXDecode 未対応) でも見落とした。ユーザー判断で「A + B ハイブリッド」採用、A = RepairableMissingFile 4 件のみ番号認可付き execute (✅ 全件成功)、B = 残 135 Ambiguous は PR-C3 で対応。

### 経緯

1. **PR #440 (session59-60 handoff) merge** (`da9a348`、squash merge、CI 全 SUCCESS)
2. **新ブランチ `fix/issue-432-pr-c2-execution` 作成**、PR-C2-execution 着手
3. **cocoro classify dry-run** (GitHub Actions workflow_dispatch、CI SA 経由): `totalGroups: 0 / collisionDocs: 0 / orphans: 0` ✅ (被害ゼロ環境、期待通り)
4. **kanameone classify dry-run** (CI SA 経由): `totalGroups: 45 / totalCollisionDocs: 135 / totalOrphans: 4`、`byClassification: { MatchedByHash: 0, Ambiguous: 135, RepairableMissingFile: 4, LostOrUnrecoverable: 0 }`
5. **Ambiguous 135 件の reason 分析**: ほぼ全件 `unsupported-pdf-feature: unsupported-resource-filter (page 0 resources canonical digest failed: /CCITTFaxDecode stream encoding not supported)`
   - **/CCITTFaxDecode = CCITT Group 3/4 FAX 圧縮**、スキャナ生成 PDF / FAX 出力で最頻出。kanameone のスキャン書類は大半がこの形式
   - PR-C2 `canonicalPageResourceDigest` が image stream decode 不能で例外 → `unsupported-resource-filter` で**設計通り** Ambiguous に降格 → Gate 0 (AC13) で destructive action reject
6. **ユーザー判断「A + B ハイブリッド」採用** (4 原則 §1 = AI は executor、ユーザーが decision-maker):
   - A = RepairableMissingFile 4 件 (op-0136 ~ op-0139) のみ番号認可で execute (リスク最小、orphan 解消で部分的に主目的達成)
   - B = 残 135 Ambiguous は PR-C3 で CCITTFaxDecode 対応 / 別 hash 戦略 / image-render-hash 等を Codex MCP セカンドオピニオン経由で設計
7. **workflow 改修 3 件 (本 PR の 3 commits)**:
   - `a187835` ci: classify-collision-docs の plan JSON を artifact 化 (log secret masking で `{` → `***` の回避)
   - `111d485` ci: execute-collision-migration を workflow_dispatch に追加 (plan artifact + 入力 opIds から approval.json を動的生成、`exec_args_json` 1 input 追加)
   - `f7e8567` ci: --operations フィルタ追加 (approval 外 op を gate-rejected exit 1 にしないため、approvedOperationIds に二重 filter)
8. **kanameone execute (番号認可済)** (CI SA 経由):
   - Filter: op-0136, op-0137, op-0138, op-0139 (Processing 4/139)
   - ✅ op-0136 Lso7jEXzWxBjU4Cj6zqR (regenerate-from-parent): regenerated from parent and saved to docId namespace
   - ✅ op-0137 M7i4Nx6khiYEo2KTGJHg: 同上
   - ✅ op-0138 U4Lf5ZPNA4IyH73SXE2P: 同上
   - ✅ op-0139 gifjllJ57Sx58TktzHCf: 同上
   - Summary: `executed: 4`、gate-rejected: 0
9. **post-audit (`audit-storage-mismatch`)** (CI SA 経由):
   - **fileUrl orphans: 4 → 0** ✅ (PR-C2 主目的部分達成)
   - **reverse orphans: 1 件新規発見** (`processed/20260413_未判定_未判定_p27-28.pdf` - Storage 実体あり Firestore 参照なし)
   - **fileName collisions: 45 → 47** (旧 Ambiguous 45 + 新 2 = PR-C2 復旧 4 docs が 2 fileName で 2 groups 増。docId namespace で物理 path は別なので正常副作用)

### Issue Net 変化

| 項目 | 内容 |
|------|------|
| Close 数 | 0 件 |
| 起票数 | 0 件 (Issue #432 にコメント追記のみ予定、reverse orphan 1 件は #432 内 follow-up に集約) |
| **Net 変化 (session61 単独)** | **0 件** |

**Net 0 の進捗判定**: ✅ 正の構造的進捗。Issue #432 (P0) の被害 4 docs を自動復旧 (silent breakage を実復旧で完遂)。残 135 Ambiguous は CCITTFaxDecode 設計限界として明確化し、PR-C3 の Codex セカンドオピニオン経由設計フェーズに移行可能。reverse orphan 1 件は新規発見だが Issue #432 と関連が薄く、別途調査して Issue 化判断 (rating ≥ 7 + confidence ≥ 80 のみ起票)。

### dev → kanameone での設計限界判明 (PR-C2 教訓 #3 の再演)

session60 handoff の教訓「fixture が本番欠陥を隠蔽するアンチパターン」(#3) を **再び** 踏襲。dev fixture には CCITTFaxDecode サンプルを含めず、Codex MCP セカンドオピニオン (Important 4: DCTDecode/JPXDecode 未対応) で他 image filter は指摘されたが、**CCITTFaxDecode は明示的に列挙されなかった**。

PR-C3 設計時の対策:
- **kanameone 実 PDF を dev fixture に含める** (個人情報マスク版を最小限取得して `tests/fixtures/kanameone-sample-ccittfaxdecode.pdf` として)
- **本番 PDF feature 分布の事前調査** (`pdf-feature-survey.ts` 等で全本番 PDF の `/Resources/XObject/*/Filter` を列挙し、未対応 filter の存在を classify 前に検出)
- これは Codex セカンドオピニオン Suggestion: 「暗号化/AcroForm/optional content/encryption は自動復旧対象外、Ambiguous 明示」の延長

### workflow 改修詳細 (commits)

| commit | 内容 | 行数 |
|---|---|---|
| `a187835` | `ci(run-ops-script): classify-collision-docs の plan JSON を artifact 化` — log secret masking 回避、`actions/upload-artifact@v4` で plan-output.json 取得経路確立 | +20/-1 |
| `111d485` | `ci(run-ops-script): execute-collision-migration を workflow_dispatch に追加` — script choice 2 件 + `exec_args_json` input + Parse step (jq validate, planRunId 数字 / opId `op-NNNN` 正規表現) + Download artifact step (`actions/download-artifact@v4` with `run-id`) + Generate approval JSON step (plan の op 抽出 + `gs://<bucket>/<path>` で approvedPaths 展開 + opId 数の整合検証) + Run script step に分岐追加 | +114/-0 |
| `f7e8567` | `ci(run-ops-script): execute-collision-migration に --operations フィルタ追加` — plan 内の approval 外 op を gate-rejected で exit 1 にしないため、approvedOperationIds に二重 filter (approval + operations) | +8/-0 |

### 復旧した 4 docs の詳細 (番号認可 + execute 結果)

| operationId | docId | parentDocumentId | splitFromPages | sourcePath (orphan、削除なし、404 silent skip) | destPath (新規 write、復旧完了) |
|---|---|---|---|---|---|
| op-0136 | `Lso7jEXzWxBjU4Cj6zqR` | `Xe6jCKoTk4yflHqefDtb` | 1-2 | `processed/20260509_未判定_未判定_p1-2.pdf` | `processed/Lso7jEXzWxBjU4Cj6zqR/20260509_未判定_未判定_p1-2.pdf` |
| op-0137 | `M7i4Nx6khiYEo2KTGJHg` | `EkZ6bwIM3ji17UugWeEr` | 3 | `processed/20260509_未判定_未判定_p3.pdf` | `processed/M7i4Nx6khiYEo2KTGJHg/20260509_未判定_未判定_p3.pdf` |
| op-0138 | `U4Lf5ZPNA4IyH73SXE2P` | `FIGbegoDvfaUTO2cYHkI` | 3 | `processed/20260509_未判定_未判定_p3.pdf` | `processed/U4Lf5ZPNA4IyH73SXE2P/20260509_未判定_未判定_p3.pdf` |
| op-0139 | `gifjllJ57Sx58TktzHCf` | `EkZ6bwIM3ji17UugWeEr` | 1-2 | `processed/20260509_未判定_未判定_p1-2.pdf` | `processed/gifjllJ57Sx58TktzHCf/20260509_未判定_未判定_p1-2.pdf` |

### 主要 PR / 実行記録

| 項目 | 値 |
|---|---|
| **本 PR** (session61) | `fix/issue-432-pr-c2-execution` PR #442 (4 commits + dev フルリハーサル commit) |
| classify planId (kanameone) | `plan-2026-05-12T04-21-39-187Z-eca5b3f3` |
| classify run id (kanameone) | 25713096820 |
| execute --dry-run run id (kanameone) | 25713588277 (4 ops `all gates passed; would execute`) |
| execute (destructive) run id (kanameone) | 25713911985 (4 ops ✅ executed) |
| post-audit run id (kanameone) | 25714003425 (orphans 4→0、reverse 1 件発見) |

### dev フルリハーサル (本セッション中盤、ユーザー指摘で追加実施)

ユーザー指摘「`dev → クライアント` 順序を飛ばしていないか」を受け、kanameone 実行後に dev で workflow 改修部分のフルパス再検証を実施。過去の PR-C1/PR-C2 でも `dev execute まで通したことがない` 共通の見落としを補完する目的。

| Stage | Run ID | Result |
|---|---|---|
| 1. setup-collision-fixture --dev | 25717762881 | ✅ 5 docs (excl. parent) covering 4 classifications |
| 2. classify-collision-docs | 25717863184 | ✅ planId `dba3864a`、`MatchedByHash:1, Ambiguous:2, RepairableMissingFile:2, LostOrUnrecoverable:1` (session60 と同一構成、cross-process determinism 再現確認) |
| 3. execute --dry-run | 25717985363 | ✅ 2 ops (op-0003, op-0006 = RepairableMissingFile) `all gates passed`、gate-rejected: 0 |
| 4. execute (destructive、dev fixture 対象) | 25718095580 | ✅ 2 ops `regenerated from parent and saved to docId namespace` |
| 5. audit-storage-mismatch | 25718205231 | ✅ fileUrl orphan: 1 (LostOrUnrecoverable 1 件、execute 対象外で設計通り残存) |
| 6. cleanup | 25718319642 | ✅ fixture cleanup completed |

**dev フルリハーサルの意義**: 本 PR で新規追加した workflow 改修 (Parse exec args / Download artifact / Generate approval JSON / --operations filter) の動作を dev fixture で実機検証。session58 (PR-C1)、session60 (PR-C2 v2) では `execute まで dev で通したことがない` 共通の見落としがあり、本セッションで初めて補完。次セッション以降の PR-C3 開発でも本 workflow を再利用できる信頼性を確立。

### dev フルリハーサル順序を初動で見落とした reflexion

ユーザー指摘前は「session60 handoff『dev fixture 再実行不要』」を字義解釈し cocoro → kanameone へ直行。session60 計画時点では **本 PR の workflow 改修は計画外**で、session61 で新規 CI コードを追加した時点で前提が変わったことに気づくべきだった。kanameone 実行 4 docs 復旧は結果的に成功したが、プロセスとしては「destructive 実行を含む CI 改修の dev 事前検証なし」という基本安全ルール違反。同パターンが PR-C1 / PR-C2 でも繰り返されており、今回 dev フルリハーサルで構造的に補完。memory `feedback_destructive_ci_dev_rehearsal.md` 新規追記候補。

### 残 Open Issue (4 件)

| # | タイトル要約 | 状態 | 再開条件 |
|---|---|---|---|
| **#432** | [P0] 分割PDF 設計バグ | **PR-A/B/C1/C2/C2-execution-A/D 完了、PR-C3 必要** (CCITTFaxDecode + 135 Ambiguous + reverse orphan 1 件) | 次セッションで PR-C3 計画 (Codex MCP セカンドオピニオン) |
| #402 | searchDocuments OOM ガード + 計測ログ | 段階1 完了、段階2/3 観測待ち | 観測データ判断 |
| #251 | summaryGenerator unit test + buildSummaryPrompt 分離 | Scope 2 完了、Scope 1/3 待機 | sinon 導入伴う他タスク or Vertex AI false negative |
| #238 | force-reindex 孤児 posting 検出モード | drift 実発生未観測 | ADR-0015 silent failure metric ERROR or 削除済書類ヒット報告 |

### 次セッション着手項目 (PR-C3 計画 — Codex MCP 起案済)

PR-C2-execution A 完遂直後 (session61 後半) に Codex MCP セカンドオピニオン (read-only, threadId `019e1b56-5cc7-76d0-b156-83549e833a71`) を取得済。**主な発見: CCITT decoder の自前実装 (or 外部ライブラリ追加) は不要**。画像 XObject を decode せず raw encoded bytes + Filter + DecodeParms + 描画関連 dict keys を hash すれば CCITT/JBIG2/DCT/JPX 全て同じ枠でカバー可能。

#### 推奨案: `pdf-page-visual-v2` (encoded resource fingerprint) 3 段構え

| 段階 | 内容 | 目的 |
|---|---|---|
| **主** | `pdf-page-visual-v2` encoded resource fingerprint | `/Subtype /Image` の binary stream は decode せず、encoded bytes + Filter + DecodeParms + Width/Height/BitsPerComponent/ColorSpace/ImageMask/Decode/SMask/Mask を canonical hash。Form XObject (content stream) は v1 同様 decoded/canonical 側で扱う |
| **補助** | PDF feature survey (`pdf-feature-survey.ts` 新規) | classify の **前段 gate** として全本番 PDF の filter/subtypes/encryption/AcroForm 等を集計、未対応 feature を事前検出。dev fixture の偏りを構造的に防ぐ |
| **fallback** | OCR hint + 手動 UI (将来 PR) | v2 でも Ambiguous に残る docs に対し OCR digest / suggestedWinner / page count を operator hint として提示。destructive 主証拠には使わない (PII + 偽陽性リスク) |

#### 4 選択肢評価 (Codex 結論)

| 選択肢 | 評価 | 採否 |
|---|---|---|
| a (CCITT decoder 実装) | バグ面が広い、画像仕様差で偽陽性/偽陰性 | **却下** → a の変形「encoded bytes hash」を採用 |
| b (pdfjs-dist render → image hash) | CI Canvas/worker/font 安定化コスト高、render determinism 検証必要 | 主戦略には不採用、最終 fallback 候補 |
| c (OCR text hash) | 開発コスト最小だが destructive 主証拠には弱い (OCR vendor 差・PII) | operator hint に限定 |
| d (手動 UI) | 信頼性高いが 135 docs 運用負荷大 | 残 Ambiguous の運用 fallback (将来 PR) |

#### PR-C3 分割 5 段階

| PR | 内容 | destructive |
|---|---|---|
| **PR-C3a** | feature survey + CI workflow + runbook | read-only (生存 path 確認のみ) |
| **PR-C3b** | `pdf-page-visual-v2` 実装 + tests + dev fixture 拡張 (CCITT/JBIG2/DCT/JPX sample) | コード変更のみ |
| **PR-C3c** | classify/execute integration + dev フルリハーサル 6 stage 再走 (v2 で) | dev fixture 対象 |
| **PR-C3d** | kanameone classify artifact → limited destructive execute | **kanameone 番号認可必須** |
| **PR-C3e** | 残 Ambiguous の OCR hint / manual follow-up | 必要時のみ |

#### Acceptance Criteria (Codex 起案 12 項目要約)

1. `pdf-page-visual-v2` が CCITTFaxDecode を含む kanameone sample で `kind: ok` 返す
2. 同 parent+range を別 process で regenerate しても fingerprint 一致 (cross-process determinism、session59 教訓)
3. 異なる page range / image bytes / geometry / visible resources は不一致 (偽陽性防止)
4. `/Encrypt`, `/AcroForm`, `/OCProperties`, visible annotations は引き続き unsupported (operator UI へ)
5. `/DCTDecode`, `/JPXDecode`, `/JBIG2Decode`, `/CCITTFaxDecode` の image XObject は decode 不能でも raw encoded hash で処理可能
6. unknown filter は feature survey で検出 + Ambiguous reason に filter 名を明示
7. classify plan は `hashAlgorithm: "pdf-page-visual-v2"` + `pdfLibVersion: "1.17.1"` を記録 (AC13)
8. execute は v1 plan / pdf-lib version mismatch / env mismatch / path 未認可を reject
9. dev フルリハーサル 6 stage 通過 (session61 確立フロー再利用)
10. kanameone は first run を read-only survey + classify artifact のみに限定
11. destructive execute は operationId + exact path approval のみ通す
12. plan artifact/log に OCR text や PDF content bytes を出さない (PII 保護)

#### Codex 指摘: PR-C2 v2 で見落とした盲点 7 件

1. **resource stream を decoded bytes にする必要なし** ← 今回の核心 (encoded bytes hash で十分)
2. `unsupported-resource-filter` を「外部 decoder 不足」と扱うと CCITT/JBIG2/JPX の沼に入る
3. OCR hash は便利だが PII + 偽陽性で destructive proof には弱い
4. feature survey が classify 前段 gate になっていないと dev fixture の偏りを再演 (session58/60/61 共通教訓)
5. `actual+expected` のどちらが unsupported かだけでなく filter/subtype/object path を plan に出さないと operator 判断不能
6. Form XObject (content stream) と Image XObject (encoded binary) を分けて扱う (Form は decoded/canonical 側に残す)
7. image stream dict の描画 keys と metadata keys を分ける (過剰な偽陰性/偽陽性回避)

#### dev fixture 拡張 (PR-C3b)

- kanameone 実 PDF から **PII マスク済み CCITTFaxDecode sample** を最低 1 parent (これが session58/60/61 で欠けていた最大の盲点)
- 同 parent から split range を作り、actual Storage と expected regenerate が v2 で match する fixture
- 別ページだがテンプレが似た negative fixture (偽陽性防止)
- DCTDecode JPEG image PDF
- 可能なら JBIG2Decode / JPXDecode sample
- annotations / AcroForm / encryption は unsupported fixture として維持

#### リスクと緩和策

| リスク | 緩和策 |
|---|---|
| Ambiguous 残存 (CCITT 以外の特殊 PDF) | feature survey で事前把握 + 20 件以下は runbook、50 件超は operator UI |
| 偽陽性 destructive (誤マッチング) | `pageCount` + `splitFromPages` + parent id + v2 fingerprint を precondition 多重化、post-audit + sample visual inspection |
| pdfjs-dist 重量級依存 | 採用せず fallback のみに留める |
| PII 漏洩 (artifact/log) | plan/audit JSON に OCR text や PDF bytes を出さない、metadata のみ |

#### reverse orphan 1 件 (PR-C3 と別件扱い、PR-C3a 後に単独調査)

対象: `gs://docsplit-kanameone.firebasestorage.app/processed/20260413_未判定_未判定_p27-28.pdf`

- 「Firestore 参照なし Storage 実体あり」= 135 Ambiguous の逆向き問題
- 原因仮説: rotatePdfPages delete 副作用残骸 / deleteDocument の orphan / 過去手動操作 / PR-B 前の旧 path 残存
- 判断材料: Cloud Logging で該当 path/filename/`p27-28`/日付周辺の split/rotate/delete invocation 検索、Storage metadata (createdAt/generation/md5)、parent candidate `20260413...` の v2 fingerprint 一致確認
- 扱い: 別 artifact `reverse-orphan-investigation.json` を出し、復元すべき parent/docId が特定できれば PR-C3 follow-up で restore、特定不能なら exact path approval で削除

### Issue #432 への次回コメント案 (本 PR merge 後に追記)

- PR-C2-execution A 完遂報告: 4 docs 自動復旧、fileUrl orphan 4→0 confirmed
- B 残作業: 135 docs Ambiguous (`/CCITTFaxDecode`) は PR-C3 で別 hash 戦略
- reverse orphan 1 件新規発見: 別途調査予定

<a id="session60"></a>
## ✅ session60 完了サマリー (2026-05-12: Issue #432 PR-C2 v2 完遂、Net 0)

session59 で確定した PR-C2 v2 計画 (pdf-page-visual-v1 fingerprint) を 1 セッションで実装完了。Codex MCP セカンドオピニオン + 5 並列 review の 2 段品質ゲートで Critical 3 + Important 9 + Suggestion 7 を反映し、dev 通し検証で cross-process MatchedByHash 成立を実証。PR-C1 (sha256 同一プロセス前提) で 0 件だった MatchedByHash が PR-C2 (visual fingerprint) で 1 件成立し、kanameone 90+ docs 自動復旧の前提条件が満たされた。

### 経緯

1. **PR-C2 v2 計画反映 (commit `0a06d82`)**: session59 handoff の Codex セカンドオピニオン (Critical 3 + Important 5 + Suggestion 4) を実装に反映し、scripts/lib/pdfPageVisualFingerprint.ts + cross-process spawn test を新規追加。HASH_ALGORITHM='pdf-page-visual-v1' で plan 記録 + execute gate (AC13)。8 files / +1215/-59 行。
2. **PR #441 作成 + Codex MCP セカンドオピニオン (commit `1e5988f`)**: PR 作成後 `/codex review` MCP (threadId `019e194d-...`) で Critical 1 (annotations 偽陽性) + Important 4 (DCTDecode/JPXDecode 未対応 / visited recursion stack 化 / UserUnit+Group / pdfLibVersion gate) + Suggestion 3 (CropBox MediaBox fallback / AmbiguousReasonKind drift / UnsupportedReason re-export) を発見・反映。7 files / +282/-33 行。
3. **5 並列 review (commit `6829932`)**: `/review-pr all parallel` で code-reviewer + pr-test-analyzer + silent-failure-hunter + type-design-analyzer + comment-analyzer を並列実行:
   - **Critical 2 (本番展開ブロッカー)**: ① localeCompare cross-machine 非決定性 → byte-order sort (PR の自称ゴールを破る欠陥)、② spawnSync error/signal/missing outTmp/empty buffer 握りつぶし → 全 4 ケースで明示 throw
   - **Important 5**: canonicalDigest catch-all を malformed/unsupported-resource-filter 分類、buildDocEvidence catch-all を permanent unsupported.malformed に降格、AC13 gate unit test 5 件追加 (subprocess spawn で gate reject 検証)、gate 数表記 (4 重 → 多重 7 種) 統一、AmbiguousReasonString を template literal type で型強制
   - **Suggestion 1**: runbook の Ambiguous reason 表を annotations / unsupported-resource-filter 別行に分割
4. **dev 通し検証 (GitHub Actions workflow_dispatch)**: setup-collision-fixture --dev → classify-collision-docs → 5 分類完全確認 → setup-collision-fixture --dev --cleanup の 3 stage 全成功。run IDs: 25703807428 / 25703906827 / 25704019664
5. **PR #441 merged**: squash merge `2dc0867`、9 files / +1804/-66 行、CI (lint-build-test + CodeRabbit + GitGuardian) 全 pass、ユーザー番号認可付き merge

### dev fixture 5 分類検証結果 (Test plan §dev 環境通し検証 完了)

```json
"hashAlgorithm": "pdf-page-visual-v1",
"summary": {
  "totalGroups": 2,
  "totalCollisionDocs": 4,
  "totalOrphans": 2,
  "byClassification": {
    "MatchedByHash": 1,
    "Ambiguous": 2,
    "RepairableMissingFile": 2,
    "LostOrUnrecoverable": 1
  }
}
```

| 観点 | PR-C1 (session59 fixture) | **PR-C2 (session60 fixture)** | 評価 |
|---|---|---|---|
| MatchedByHash | **0 件** (cross-process non-deterministic) | **1 件** | ✅ PR の存在意義実証 |
| Ambiguous | 4 (winner も Ambiguous に倒れていた) | 2 (matched_loser は RepairableMissingFile に正しく分類) | ✅ |
| RepairableMissingFile | 1 | 2 (敗者再生成 + orphan、設計通り) | ✅ |
| LostOrUnrecoverable | 1 | 1 | ✅ |
| hashAlgorithm 記録 | なし | `pdf-page-visual-v1` | ✅ AC13 通過 |

session59 handoff の期待値 `MatchedByHash:2, RepairableMissingFile:1` は誤記載で、collisionClassifier の case 1 (matched 一意) では敗者 doc を classifyLoserForRegeneration 経由で RepairableMissingFile に分類するため、`MatchedByHash:1 + RepairableMissingFile:2 (敗者 + orphan)` が正しい挙動。

### Issue Net 変化

| 項目 | 内容 |
|------|------|
| Close 数 | 0 件 |
| 起票数 | 0 件 (Issue #432 にコメント追記のみ、issue/comment-4426066508) |
| **Net 変化 (session60 単独)** | **0 件** |

**Net 0 の進捗判定**: ✅ 正の構造的進捗。Issue #432 PR-C2 v2 (Codex Critical 3 + 5 並列 review Critical 2 反映済) が dev 通し検証で MatchedByHash 成立を実証して merge。残る PR-C2-execution (cocoro classify dry-run + kanameone 番号認可付き execute + post-audit + Issue #432 close 報告) は destructive 実行のため次セッションで番号認可後に実施。

### 教訓 (memory 候補)

#### 1. 「自称 cross-process deterministic」は cross-locale 含めて検証する
本 PR の自称 cross-process determinism は cross-process spawn test を 4 件含めたが、`localeCompare` の OS locale 依存性 (ICU データ版差) を 5 並列 review code-reviewer が指摘するまで見落とした。`PDFDict.entries()` を `localeCompare` で sort すると `ja_JP` 開発機と `C.UTF-8` GitHub Actions runner で順序が逆転するケースが現実的に存在する (Group vs GS0 等)。修正は 5 行未満の byte-order 比較置換で済み、追加 test (cross-locale spawn) で回帰防止可。→ `feedback_cross_locale_determinism.md` 候補。

#### 2. Generator-Evaluator 分離 + 5 並列 review の補完性
session58 で「Codex セカンドオピニオン + 7 並列 review」を経て merge した PR-C1 が cross-process determinism で破綻し、session59 で発覚。session60 では同様のパターンで「v2 計画 + Codex MCP review + 5 並列 review」で 3 段の品質ゲートを掛けたが、各段で全く異なる Critical / Important を発見:
- Codex 計画段階 (session59): content stream 正規化禁止 / Annots / Resources canonical digest
- Codex post-implementation MCP (session60 commit 2): visible annotations / DCTDecode / visited shared ref / pdfLibVersion gate
- 5 並列 review (session60 commit 3): localeCompare / spawnSync silent failure / canonicalDigest catch-all
これは「review agent ごとに見落とすパターンが構造的に異なる」ことを示し、destructive migration では多層 review が経済的に妥当。→ `feedback_multi_layer_review_complementarity.md` 候補。

#### 3. session59 handoff の期待値誤記載
session59 handoff で「期待 MatchedByHash:2, RepairableMissingFile:1」と書いたが、collisionClassifier 設計 (case 1 matched 一意 + 敗者 classifyLoserForRegeneration) を読み解くと正しい期待は `MatchedByHash:1 + RepairableMissingFile:2`。検証時には fixture と classifier 設計の対応表を明示しておくべき。

### 主要 PR

| PR | コミット | 内容 |
|---|---|---|
| **#441** | `2dc0867` | fix(scripts): Issue #432 PR-C2 — pdf-page-visual-v1 fingerprint で cross-process MatchedByHash を成立させる (9 files / +1804/-66) |
| #440 | (open) | docs: 2026-05-12 session59 handoff (本 PR で session60 entry を含めて統合) |

### 残 Open Issue (4 件)

| # | タイトル要約 | 状態 | 再開条件 |
|---|---|---|---|
| **#432** | [P0] 分割PDF 設計バグ | **PR-A/B/C1/C2/D 完了、PR-C2-execution 残り** | 次セッションで PR-C2-execution (cocoro classify dry-run + kanameone 番号認可付き execute + post-audit) |
| #402 | searchDocuments OOM ガード + 計測ログ | 段階1 完了、段階2/3 観測待ち | 観測データ判断 |
| #251 | summaryGenerator unit test + buildSummaryPrompt 分離 | Scope 2 完了、Scope 1/3 待機 | sinon 導入伴う他タスク or Vertex AI false negative |
| #238 | force-reindex 孤児 posting 検出モード | drift 実発生未観測 | ADR-0015 silent failure metric ERROR or 削除済書類ヒット報告 |

### 次セッション着手項目 (PR-C2-execution)

**スコープ**:
1. dev fixture (本セッションで cleanup 済): 再実行不要
2. cocoro classify dry-run: 被害ゼロ環境で 0 件 / 0 orphan を確認 (`./scripts/switch-client.sh cocoro` + workflow_dispatch)
3. kanameone classify (read-only): plan-{timestamp}.json 取得 → operator に提示 → 番号認可
4. kanameone execute --dry-run: 実行計画照合
5. kanameone execute (番号認可後): 4 重 + AC13 6/7 gate 通過で実 migration
6. post-audit (`audit-storage-mismatch.js --reverse-orphans`): 衝突 group 0 / orphan 0 確認
7. Issue #432 close 報告 (PR-A/B/C1/C2/D 全完遂)
8. PR-C2-execution PR (handoff PR、実行ログ + before/after audit JSON + Issue #432 close)

**注意**:
- kanameone destructive 実行は番号認可必須 (operationId + path 文字列単位)
- merge 後は post-audit 5 分以内に実行して silent breakage 復活がないことを確認
- pdf-lib version (1.17.1) は plan-execute 間で固定 (AC13 拡張 gate)

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
