# マルチクライアント監査マトリクス（catchup時の必須確認）

Issue #432 session81+84 教訓。

---

doc-split は **dev / cocoro / kanameone** の 3 環境で稼働するマルチクライアント構成。データ破壊系 Issue (#432 silent 破壊 collision 等) の対応では、catchup 時に「ある環境で復旧済」と書かれていても **他環境の audit を独立工程として確認**すること。

## 必須マトリクス (catchup 時に作成)

| 工程 | dev | cocoro | kanameone |
|------|-----|--------|-----------|
| 1. dev 側 bugfix 対応 (構造改修) | ✅/❌ | - | - |
| 2. dev 側テスト (E2E + unit) | ✅/❌ | - | - |
| 3. 全クライアント bugfix バージョン反映 (Functions/Hosting deploy) | ✅ | ✅/❌ | ✅/❌ |
| 4. 各クライアント エラー範囲チェック (audit-storage-mismatch 等) | - | ✅/❌ | ✅/❌ |
| 5. 各クライアント 復旧 (該当時) or 不要確定 | - | ✅/❌ | ✅/❌ |

❌ が 1 つでもあれば、**そこを最優先**してメンテナンス性向上や保険強化 (PR-D4 dev rehearsal 等) は後回しにする。

## 関連事例 (再演防止)
- **session81 (2026-05-16)**: catchup で handoff「次セッション最優先 = PR-D4 dev rehearsal」を機械的踏襲 → user 指摘で軌道修正、kanameone audit 初実行で 47 groups collision 確定
- **session84 (2026-05-17)**: 同 handoff 表現を再び機械的踏襲 → user 本質指摘で軌道修正、cocoro audit 初実行で collision 0 確定 → Issue #432 全体ワークフロー完了確定

詳細プロトコル: `~/.claude/memory/feedback_catchup_workflow_completion_check.md`
