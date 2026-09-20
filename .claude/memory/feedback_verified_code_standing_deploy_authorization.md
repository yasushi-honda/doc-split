---
name: verified-code-standing-deploy-authorization
description: dev で実装と客観的検証まで済んだ変更は kanameone/cocoro へ同一コードで反映まで AI が進めてよい（包括認可、2026-09-21）。例外 5 種は従来どおり都度確認
metadata:
  type: feedback
---

decision-maker が 2026-09-21 に「dev で実装と客観的検証まで済んだ変更は、全本番（kanameone・cocoro）へ等しく反映まで進める」を包括認可した（AskUserQuestion で選択肢「検証済みコードは全本番へ反映まで進める」を選択）。

**Why**: dev 検証済みなのに本番反映を毎回確認すると、3 環境間のコード drift とセッション横断の反映漏れ（[[multi-env-deploy-declared-complete-dev-only]]）を生む。「コードは全環境に同一で展開する」が既定方針。

**How to apply**:
- 対象は、dev で実装・客観的検証（テスト/実機確認）が済み、本番データ形状に依存しないコード変更（Functions/Hosting）。`/deploy` で kanameone と cocoro に同一コミットを反映し、`gcloud functions describe` で各環境の鮮度・環境変数の実態を確認し、監査マトリクス（3 環境）を埋めるところまでを AI が実行する。
- 展開要否の判断基準（docs・純粋リファクタ・dev で取れる内部ログは dev のみ）は従来どおり `~/.claude/memory/feedback_pr_deploy_scope.md`。
- **包括認可の対象外（従来どおり都度確認）**:
  1. PR マージ — 番号単位の明示認可（hook 強制、包括認可では代替不可）
  2. データ書き換え・backfill・削除系の操作
  3. 既存本番データに新しい前提条件を課すゲート — 実データの充足率を集計して確認するまで有効化しない（CLAUDE.md #445 教訓）
  4. UI 変更 — `ui-verified` ラベル付与後のみ
  5. クライアント側操作が必要なもの（例: cocoro Drive Phase C の OAuth 接続。AI は代行不可）
- 反映後に AI から動作確認を能動的に依頼しない（`~/.claude/memory/feedback_deploy_proactive_verification.md`）。完了報告は 3 環境の実機確認コマンド出力を添える。
