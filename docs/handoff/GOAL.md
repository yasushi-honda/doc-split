---
updated: 2026-07-19
---
<!-- 前ミッション(Issue #680: kanameone本番search_index肥大化)は全AC達成済みで2026-07-19に完遂アーカイブ。全文はdocs/handoff/LATEST.md「Issue #680ミッション 完遂サマリ」参照。 -->

## 現在のミッション

Issue #687: `scripts/force-reindex.js` を BulkWriter化し、大規模drift復旧のGitHub Actions 6時間タイムアウトリスクを解消する。

## 背景・why

Issue #680 Phase A（4389件対象drift復旧）実行時、逐次`db.batch()`処理（1件約5秒）のためGitHub Actions 6時間タイムアウトに抵触し1回目実行がcancelled（冪等なため実害なし、2回目で完了）。`/impl-plan`フルモードで計画策定後、Codex plan reviewでNO-GO判定（同一未作成tokenへの並列set()競合によるpostings消失リスクHigh、Promise.all早期reject問題High）を受け、計画を修正済み（2026-07-19、詳細: 本セッションtranscript）。

## 完了の定義
- [x] 未作成`search_index/{tokenId}`に2つのdocIdが同時にpostings書込みしても、両方のpostingsが保持されdfが正しく加算される（証明: `npx mocha -r ts-node/register test/forceReindex.test.ts` の「未作成の search_index token に2つの docId が並行 execute...」PASS）
- [x] 各stage（旧posting削除/新posting書込/documents更新）が`Promise.allSettled()`でdrainされてから成否判定される（証明: 同ファイル「新 posting 書込みで一部 token が失敗しても...」PASS）
- [x] systemic error（aggregateTokens invariant違反）が書込み副作用前の事前検証フェーズで検知され、新規docId投入が停止し稼働中task完了後にexitする（証明: 「planReindex (systemic error)」describe 2件PASS + plan pass-through設計で構造的に保証）
- [x] dry-run（`--execute`未指定）は書き込みを一切行わない（証明: 既存シナリオ3件PASS維持）
- [x] 全既存テスト（forceReindex.test.ts / forceReindexAudit.test.ts / forceReindexEntrypoint.test.ts）PASS + `cd functions && npm run lint` / type-check PASS（証明: 60 passing、lint 0 errors、tsc --noEmit exit 0、2026-07-19実行確認済み）

## 進行中のtasks
- [x] `planReindex()`相当の事前検証フェーズ追加（invariant違反を副作用前に全件検査、systemic error即中断をシンプル化）
- [x] 新posting書込みを`merge:true`の`set()`に統一（df increment + postings.{docId}を同一書込みに、未作成token並列競合対策）
- [x] 各stageを`db.batch()`から共有BulkWriterへのenqueue + `Promise.allSettled()`drainに置換
- [x] runAllDrift()をページ単位boundedワーカープールで並列化（既定並行数5、`--concurrency=<n>`オプション追加、外部依存追加なし）
- [x] systemic error検知はplan事前計算+pass-through設計で構造的に保証（共有フラグ方式より単純化、code-review反映）
- [x] BulkWriterライフサイクル管理（runSingleDocId/runAllDrift各々でfinallyにて一度だけclose()）
- [x] 既存テスト更新（functions/test/forceReindex.test.ts）+ 新規シナリオ追加（並行set競合収束/stage内部分失敗再実行収束/fatal planでの書込みゼロ/close一度限り呼び出し/tokensToRemove重複排除）
- [x] forceReindexAudit.test.ts / forceReindexEntrypoint.test.ts 回帰確認
- [x] Runbook（docs/context/search-index-recovery.md）更新（並行数オプション、半端状態の拡張説明、cross-process同時実行禁止の明記）
- [x] `/code-review medium`実施・重大バグ修正（tokensToRemove重複によるdf二重減算をFirestore emulatorで実証・修正、既存existingSet→MapのO(n²)化修正、getAll並列化、Promise.allSettledヘルパー共通化）
- [x] PR #691作成後、`/review-pr`相当（独立3エージェント: correctness/data-integrity/test-coverage）+ `/codex review --base main`でセカンドオピニオン実施。Codexへ追加相談し対応方針をバランス判断した上で以下を追加実装:
  - [x] `--concurrency`のparseArgsバリデーションテスト追加
  - [x] `bulkWriter.close()`失敗時もBATCH_SUMMARY/監査ログに必ず到達するよう修正（`closeBulkWriterSafely`ヘルパー導入、`EVENTS.BULKWRITER_CLOSE_FAILED`追加）
  - [x] `runAllDrift`の複数ページ（`startAfter`カーソル）+複数doc並行処理E2Eテスト追加（PRの主目的である大規模スキャンの核心機構を検証）
  - [x] 部分失敗→再実行の冪等性収束テスト追加（postings/dfが正しい最終状態に収束することを実証）
  - [x] 削除側（decrement）並行競合テスト追加（create/increment側との対称性を検証）
  - [x] `settleOrThrow`の複数失敗集約（旧実装は最初の1件のみ記録、診断精度を改善）

follow-up候補（本PRスコープ外、triage未実施）:
- GitHub Actions workflow（run-ops-script.yml）に`--concurrency`オプションのUI経由指定を追加
- `runWithConcurrency`が`compare-gemini-ocr-models-confirmed.ts`/`compare-ocr-arbitration-logic-confirmed.ts`/`backfill-detail-subcollection.ts`と重複、`scripts/lib/concurrency.js`への共通化検討
- ホットトークン（同一tokenId）への書込み競合をtokenId単位のmutex/キューで構造的に防ぐ設計（現状はconcurrency全体制御のみ）
- `documents_search_update` stageのcatch/stage-taggingロジックの単体テスト追加
- `--batch-size`と`--concurrency`が独立した軸として機能することの明示的なテスト追加

## 🔄 中断点（in-flight）
なし（PR #691へ追加コミット完了、push・最終確認はdecision-maker承認待ち）
