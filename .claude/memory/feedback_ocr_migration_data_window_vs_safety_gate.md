---
name: ocr-migration-data-window-vs-safety-gate
description: ADR-0025のコスト/精度統計レポート用「1-2週間データ蓄積待ち」を、Pass1全面切替のGo/No-Go判断と混同しかけた事例
metadata:
  type: feedback
---

ADR-0025(PaddleOCR移行)で、kanameone/cocoro本番canary展開時に設定した「運用コスト実測・抽出精度の実データ統計検証(1-2週間のデータ蓄積待ち、クライアント報告用)」を、Pass1全面切替(`set-paddle-ocr-allowlist --remove`)のGo/No-Go判断のブロッカーであるかのように扱いかけた。

実際には、Pass1切替の技術的安全性は別途、以下で既に確立済みだった:
- 必須ゲート(71ページ負荷試験): p95=600.5秒(基準850秒に対し約29%マージン)、完了率100%(1,420/1,420)
- 精度検証(24文書×4フィールド=96判定、実マッチングロジック使用): PaddleOCR 94/96正解・危険な誤確定0件(Gemini 2.5/3.5 Flashとほぼ同等)
- 3環境canary運用実績: error率0%、`concurrency:1`でtick重複を構造的に排除済み

コスト/精度レポート用のデータ収集期間と、切替可否の技術判断は本来独立していた。ユーザーの「これは客観的に過剰ではないか」という指摘で混同に気づいた。

**How to apply**: このプロジェクトで今後同種の「N週間データ収集待ち」(コスト実測・精度統計等のレポート目的タスク)が発生した場合、ロールアウトの技術的Go/No-Go判断とは別トラックとして扱う。安全性根拠(負荷試験・精度検証・canary実績)が別途確立していれば、データ収集は並行継続でよく、ロールアウト判断を待たせない。

グローバル原則: [[feedback_data_collection_window_vs_safety_gate]](`~/.claude/memory/`)
