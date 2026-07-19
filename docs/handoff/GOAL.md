---
updated: 2026-07-19
---
<!-- 前ミッション(Issue #687: force-reindex.js BulkWriter化)は全AC達成済みで2026-07-19に完遂アーカイブ。全文はdocs/handoff/LATEST.md「Issue #687ミッション 完遂サマリ」参照。 -->

## 現在のミッション

次ミッション未着手。decision-makerからの新規指示待ち。

Issue #687（`scripts/force-reindex.js`のBulkWriter化）は2026-07-19、PR #691（squash merge）でクローズ済み（詳細: docs/handoff/LATEST.md「Issue #687ミッション 完遂サマリ」）。

follow-up候補（次ミッション起点として検討可、triage未実施）:
- GitHub Actions workflow（run-ops-script.yml）に`--concurrency`オプションのUI経由指定を追加
- `runWithConcurrency`が`compare-gemini-ocr-models-confirmed.ts`/`compare-ocr-arbitration-logic-confirmed.ts`/`backfill-detail-subcollection.ts`と重複、`scripts/lib/concurrency.js`への共通化検討
- ホットトークン（同一tokenId）への書込み競合をtokenId単位のmutex/キューで構造的に防ぐ設計
- `documents_search_update` stageのcatch/stage-taggingロジックの単体テスト追加
- `--batch-size`と`--concurrency`が独立した軸として機能することの明示的なテスト追加

## 🔄 中断点（in-flight）
なし
