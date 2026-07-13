---
updated: 2026-07-13
---
<!-- session121: 全タスク完了・監視事項2件のみ残存の状態でdecision-maker合意のうえGOAL.mdを圧縮。旧本文（session95〜120の詳細tasksチェックリスト・session別HTMLコメント）はgit historyおよびdocs/handoff/LATEST.md（session113〜120の詳細サマリ）・docs/handoff/archive/2026-07-history.md（session100〜110）に保持済みのため情報欠落なし。詳細を辿る場合は `git log -p docs/handoff/GOAL.md` または上記アーカイブを参照 -->

## 現在のミッション
運用コスト圧縮2トラック — #547 Firestore読取egress削減（ADR-0018 detail/main分離）と #548 Gemini 3.5 Flash移行 — を、本番2環境（kanameone / cocoro）で安全に完遂する。

**🎉 ミッション達成**（2026-07-10 session113 技術完了 → 2026-07-12 session117 で本番デプロイ漏れの是正確認済み）。下記「完了の定義」2点をいずれも充足。ただし「完了」は#547/#548の実装・展開が完了したことを意味し、**運用コストが以前より安くなったことは意味しない**（下記「重要な注記」参照）。

## 背景・why
- 運用コストが収益を圧迫しており「もはや待ったなしの状態」（decision-maker 明言、session106-107）
- #548 は Gemini 2.5 Flash retirement 期限 **2026-10-16** が外部制約
- #547 の egress 実削減は Phase E（親docの大容量フィールド削除）で初めて発生する

## 完了の定義（達成済み）
- Issue #548 が close される（達成済み、2026-07-09）
- #547 Phase E が完了し、egress実削減効果が発生する（達成済み、2026-07-10 session113 技術完了 → 2026-07-12 session117 是正: Phase E本番実行時にdual-write停止コードが未デプロイのまま削除が実施されていた不整合を検出・修正し実効化。詳細: ADR-0018「是正: 2026-07-12」）
- 不変条件: 本番 documents の既存フィールドを破壊しない — 維持確認済み（両環境とも detail/main不在0件）

## 重要な注記（コスト実態）
- **#548はコスト削減策ではない**: Gemini 2.5 Flash廃止＋日本データレジデンシー要件による強制移行。単価は2.5比で高く、全対策後も試算約¥23,000/月（3.5移行前の現状¥12,714/月より高い）
- **実効値上がり倍率は4手法が収束**: 理論値3.88倍／A-Bテスト事前実測3.7〜4倍／confirmed-replay実測5.53倍／本番実測クリーン版5.07倍（session120で「未解明の残差」も比較対象選択ミスと判明し解消済み）
- **真の黒字化には保留中の「OCR出力エンティティリスト化」（−¥11,000/月級）の着手判断が別途必要**。本ミッションのスコープ外、decision-maker判断待ちの保留カードとして下記に記録
- 実請求書での最終実測確認は8月上旬（7月分請求書確定）待ち

## 進行中のtasks
- [x] #548 Gemini 3.5 Flash移行（kanameone/cocoro本番展開、confirmed-replay統計検証含む） — 全完了
- [x] #547 Phase C（backfill）〜Phase E（dual-write停止+削除実行、両環境本番実行）— 全完了・是正確認済み
- [x] 副産物Issue #539/#540/#625/#620/#621/#622（splitPdf/OCR周辺のP1/P2バグ）— 全完了・本番2環境展開済み

## 🔄 中断点（in-flight）
なし

## 監視・確認事項（トリガー待ち）
- egress実削減効果の翌月請求での実測確認（未実施。8月上旬の7月分請求書で確認）
- #548試算（全対策後¥23,000/月）の実額最終確認（実額は7月分請求書確定後）
- dev環境のテストデータ`phase-e-devcheck-001`(意図的に壊れた不一致状態、実害なし)/`phase-e-devcheck-002`(正常)の後片付け（任意）
- 保留カード「OCR出力エンティティリスト化」着手要否のdecision-maker判断（本ミッションのスコープ外）
- 検証コマンド: `cd functions && npm test`（1,680 passing）/ `cd frontend && npm test`（310 passing）/ `cd scripts && npm test`（72 passing）
