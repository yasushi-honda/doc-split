# ハンドオフメモ

**更新日**: 2026-04-16 session4 (PM/PL モード WBS 実行、Sprint 1 完遂: #228 + #229 の 2 PR 連続マージ)
**ブランチ**: main
**フェーズ**: Phase 8 + 運用監視基盤 + **search_index drift 復旧 SOP 整備完了** (dev 実行検証のみ Follow-up)

## ✅ 今セッション完了サマリー (Sprint 1: WBS 計画 → 段階消化)

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

### A. #229 関連: dev 環境での force-reindex 動作検証 (最優先、軽量)

PR #235 は script + SOP + workflow + ADR 更新が完了。**dev 実行による動作確認** のみ Follow-up:

```bash
# GitHub Actions → "Run Operations Script"
#   environment: dev
#   script: force-reindex --all-drift

# 期待出力: drift: 0 件 (dev に drift は無い想定)
```

確認項目:
- AC1: `--all-drift --dry-run` が正常終了、drift 件数 0 (exit code 0)
- AC2: `--all-drift --sample=5 --dry-run` でサンプル実行が動く
- build ステップが workflow 内で成功する (`functions/lib/` 生成)

### B. #220 関連: 監視基盤 dev/本番展開 (前セッション Follow-up 継続中)

前セッション (session3) で PR #231 により監視基盤 (log-based metric + alert policy) の枠組み整備完了。本セッションは触らなかったが **SA 権限付与 → dev 展開 → 本番展開** は依然として未実施:

- **Option 2 (Codex 推奨)**: 専用 SA `docsplit-monitoring-admin@*` 作成 (3 roles 付与)
- GitHub Actions → "Setup Monitoring" で dev 実行 → AC3b/AC4 通過確認
- kanameone / cocoro 順次展開

詳細は `docs/context/monitoring-setup.md` 参照。

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

WBS 計画に基づき、直前 Sprint 1 の文脈延長線上にある:
- **Sprint 2 (Summary リファクタ集約)**: #214 (generateSummary 共通化) → #215 (discriminated union 化)

または優先度次第で:
- **Follow-up A + B**: #229 dev 検証 (~15分) + #220 監視展開 (~1時間)

---

## 過去履歴

500 行超過防止のため、2026-04-16 session3 以前は別ファイルに移動:

- [docs/handoff/archive/2026-04-history.md](archive/2026-04-history.md) — session1-3 詳細、Issue #217/#219/#213 系、04-14 以前の変更履歴

## Git状態 (2026-04-16 session4 終了時)

- ブランチ: main
- 未コミット変更: なし
- 未プッシュ: なし
- 最新コミット: `1e2b751` feat(ops): search_index drift 復旧 SOP + force-reindex スクリプト (#229) (#235)
- CI: ✅ 成功 (CI + Deploy 通過)
- ADR 数: 16 本 (session4 では ADR-0015 を Risk #3 解消表記で更新、新規なし)
