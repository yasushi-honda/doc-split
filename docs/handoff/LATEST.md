# ハンドオフメモ

**更新日**: 2026-04-16 session3（#225 + #223 + #220 の後追い負債解消、3 PR マージ + 2 新規 Issue 起票）
**ブランチ**: main
**フェーズ**: Phase 8完了 + マルチクライアント安全運用機構 + 検索インデックス信頼性向上 + summary regression test 整備 + **運用監視基盤**

## ✅ 今セッション完了サマリー (WBS 段階消化、3 PR 連続マージ)

PM/PL 視点で 15 件の open issue を WBS 化し、Phase 0 (棚卸し) + Phase 1.1-1.3 を完遂。

| 順 | Issue/PR | 結果 |
|---|---|---|
| 1 | **Phase 0 棚卸し** | 15 件精査、#210 を #220 に統合 close、14 件を有効判定 |
| 2 | **#225 generateSummary builder bypass test** | ✅ PR #227 マージ (commit `3052d73`) — grep-based caller contract test、過去 PR #224 Critical 指摘の構造的穴を塞ぐ |
| 3 | **#223 search_index silent failure 方針** | ✅ PR #230 マージ (commit `ad68ec6`) — **ADR-0015 起草 + Accepted OK (Codex 2 ラウンド)** |
| 4 | **#220 log-based metric + alert 基盤** | ✅ PR #231 マージ (commit `5c77574`) — setup/teardown script + workflow + 5 YAML + 運用手順ドキュメント (11 files, +715 lines)。**#220 Issue は OPEN のまま追跡中** (SA 権限付与・dev 実行・本番展開が残るため) |
| 5 | **新規 Issue 起票** | ✅ #228 (builder bypass 型alias 後追い), #229 (search_index drift 復旧 SOP) |
| 6 | **グローバル改善 (メタ)** | memory feedback + `rules/workflow.md §0` に「観測なしの推測は根拠にしない」明文化 |

### 達成効果

| 効果 | 内容 |
|---|---|
| 🏗️ 運用監視基盤 | 5 種 log-based metric + alert policy 自動化。検出遅延 3-5 分 (OOM) / 日次 / 週次 |
| 🧾 設計判断の永続化 | ADR-0015 で silent failure 対処方針 (現状維持 + #220 監視 + dead letter 将来) を明文化 |
| 🛡️ リグレッション防止 | builder caller-side の bypass を構文検証で自動検出 (#225) |
| 📐 PM/PL 運用確立 | WBS → Codex plan → /review-pr → Evaluator → 修正反映 の完全ループ実証 |
| 🧭 自己改善 | 推測で断言した誤りをグローバルルールに定着 (memory + rules/workflow.md §0) |

### 本セッションの特徴 (方法論)

Codex レビューを **2 タイミング** で活用:
- **Phase 1.2 (#223)**: ADR ドラフト → `/codex review` → Accepted OK 判定後マージ
- **Phase 1.3 (#220)**: 計画 Phase A 後 → `/codex plan` 2 ラウンド → 全指摘反映 → 実装 → /review-pr (code-reviewer + comment-analyzer + Evaluator 3 並列) → 指摘反映 → マージ

Evaluator 分離プロトコル (`rules/quality-gate.md` 規定、5 ファイル+ で発動) を PR #231 で実践、独立 AC 評価を受けた。

## 🔴 次セッションで実施する Phase 1.3 フォローアップ

PR #231 は **script と workflow の枠組みのみ**。本番監視を開始するには以下が必要 (いずれも別 PR):

### A. SA 権限付与 (最優先、ブロッカー)

既存 `docsplit-cloud-build@<env>.iam.gserviceaccount.com` は `logging.logWriter` のみ。本セットアップには以下が不足:
- `roles/logging.configWriter` (log-based metric 作成)
- `roles/monitoring.alertPolicyEditor` (alert policy 作成)
- `roles/monitoring.notificationChannelEditor` (notification channel 作成)

**選択肢** (`docs/context/monitoring-setup.md` 参照):
| 案 | 内容 | 推奨 |
|---|---|---|
| Option 1 | 既存 SA に 3 roles 追加 | 最小変更、ただし deploy SA が監視変更権限を持つ副作用 |
| **Option 2** | **専用 SA `docsplit-monitoring-admin@*` 新規作成** | **最小権限原則、Codex 推奨** |

Option 2 採用の場合、各環境で:
```bash
gcloud iam service-accounts create docsplit-monitoring-admin \
  --display-name="DocSplit Monitoring Admin" --project=<PROJECT_ID>
# 3 roles 付与
# キー発行 → GitHub Secrets MONITORING_SA_KEY_<ENV> 登録
# setup-monitoring.yml の credentials_json を差し替え
```

### B. dev 環境で setup 実行 + 動作確認 (AC3b / AC4)

```bash
# GitHub Actions: Setup Monitoring (log-based metrics + alerts)
#   environment: dev
#   action: setup
#   notification_email: <通知先>
```

確認項目:
- AC1/AC2: 5 metrics + 5 alert policies + 1 channel が作成されるか
- AC3b: metric 作成後の新規ログで increment するか (要 trigger log を dev で発生させる、または既存 kanameone log を流用の可否確認)
- AC4: 通知メール到達 (dev 環境で故意に alert 発火させてテスト、例: gcloud logging write で synthetic ログ投入)

### C. 本番展開 (kanameone → cocoro)

dev で AC4 通過後:
- kanameone: `action: setup` を Actions で実行、通知先確認
- cocoro: 同様

### D. ADR-0015 を Updated へ

PR #231 で自動化完了後、ADR-0015 の暫定運用 SOP セクションを完全削除または「履歴保持のみ」明示に更新。

## 📋 残り積み残し Issue (次セッション以降、優先順)

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

**Phase 5 (低優先、15分)**:
| # | タイトル | ラベル |
|---|---|---|
| #152 | dev 環境 Firestore 初期設定 | enhancement, P2 |

**本セッション起票後追い (低優先、実発生時に昇格)**:
| # | タイトル | ラベル |
|---|---|---|
| #228 | summary bypass 型alias 検出、caller 動的検出 | enhancement, P2 |
| #229 | search_index drift 復旧 SOP + force reindex | enhancement, P2 |


---

## 過去履歴

500 行超過によるハンドオフメモ肥大化を防ぐため、2026-04-16 session2 以前の詳細履歴は別ファイルに移動:

- [docs/handoff/archive/2026-04-history.md](archive/2026-04-history.md) — Issue #217 / #219 / #213 系 + 前セッション詳細 + 04-14〜02-13 までの変更履歴

運用ノウハウ (ダッシュボード画像の読み方など) もアーカイブに含まれる。

## Git状態 (2026-04-16 session3 終了時)

- ブランチ: main
- 未コミット変更: なし
- 未プッシュ: なし
- 最新コミット: `c0afa8c` docs: 2026-04-16 session3 成果をハンドオフメモに記録 (#232)
