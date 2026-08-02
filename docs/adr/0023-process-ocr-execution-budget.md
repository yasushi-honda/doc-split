# ADR-0023: processOCR 実行時間予算の再設定

## Status

Accepted (2026-08-02)

## Context

### 発端 (2026-08-01〜02 kanameone 健全性レポート)

2026-08-01 08:23〜08:53頃、kanameone (docsplit-kanameone) 本番環境で71ページの元添付PDFから分割された書類1件 (`Px4myB4Y3t7jCFZSqS5J`) が `"Processing timed out, max retries exceeded (5/5)"` で `status: error` に確定した。

### 実測タイムライン (Cloud Logging調査、read-only)

`processOCR` (`functions/src/ocr/processOCR.ts`、`onSchedule` 1分間隔ポーリング、当時 `timeoutSeconds: 540`) の1サイクル内で以下が観測された:

- 08:40:02 `PDF has 71 pages` — 71ページのOCRページループ開始
- 08:45:21 71ページ全ページの完了ログ (`Processing page 71/71`) — ページループ自体は約319秒 (4.5秒/ページ) で **540秒以内に収まっていた**
- 08:46:45 `Filename info` ログ (後処理の一部) を最後にこのdocIdのログが途絶える
- このサイクル自体の `OCR processing (polling) completed` ログが確認できず、Cloud Functions が540秒 (9分、08:49:01頃) で強制終了されたと推定される
- 08:53:29台の次サイクルで `rescueStuckProcessingDocs` が `updatedAt` 未更新 (10分超過、`STUCK_PROCESSING_THRESHOLD_MS`) を検知し、`retryCount` が `MAX_RETRY_COUNT=5` に到達して `status: error` 確定

つまり、**OCRページ処理自体はタイムアウト予算内に収まっていたが、その後の後処理 (第2 Gemini呼出し `extractOcrCandidates`、顧客/事業所/書類種別/日付の候補抽出・arbitration、`applyOcrCompletionTransaction` によるFirestore transaction) で追加の時間を要し、トータルで540秒を超過した**。

### 後処理のボトルネック調査 (コード調査)

`functions/src/utils/extractors.ts` の `extractOfficeCandidates` 内 `calculateKeywordMatchScore` が、**事業所マスター1件ごとにOCR全文 (最大20万文字、`MAX_AGGREGATE_PAGE_CHARS`) を正規化・キーワード抽出し直す**構造になっている (本来ループ外で1回計算すれば足りる計算をマスター件数分繰り返す設計)。kanameone本番のマスター件数実測 (2026-08-02、`check-master-data`スクリプト): `masters/customers/items` 1,352件、`masters/offices/items` 981件、`masters/documents/items` 132件。事業所981件という規模で、この重複計算がボトルネックの主要因である可能性が高い。この軽量化は別PR (後処理ホイスト) で扱い、本ADRはタイムアウト値そのものの再設定を対象とする。

### concurrency設定の実態 (2026-08-02実測)

`gcloud functions describe processOCR --gen2` で kanameone の実際の設定を確認した結果、`maxInstanceRequestConcurrency: 80` (デフォルト値、明示未設定) だった。`maxInstances: 1` はインスタンス数の上限であり同時リクエスト数の制限ではないため、`processOCR.ts` の一部コメントが前提としていた「実行中は1分tickがスキップされる」という想定は厳密には成立していない可能性がある。実際、当該日のログでも1サイクルの完了ログが欠落したまま次サイクルが動いている挙動が観測された。この論点への対応 (`concurrency: 1` の明示設定・予算認識型の早期終了) は本ADRのスコープ外とする (下記参照)。

### タイムアウト値上限の確認 (公式ドキュメント一次ソース)

Firebase Functions gen2において、`onSchedule` (scheduled function) の `timeoutSeconds` は最大 **1800秒 (30分)** まで設定可能である ([Cloud Functions quotas](https://firebase.google.com/docs/functions/quotas))。540秒上限はevent-driven/backgroundトリガーのみに適用され、scheduled functionには適用されない。

### 540秒という値の連動箇所

コード調査の結果、540秒という値は以下に既成事実として埋め込まれていた:

| # | 箇所 | 内容 |
|---|---|---|
| 1 | `functions/src/ocr/constants.ts` | `STUCK_PROCESSING_THRESHOLD_MS = 10分` (コメント: 「540s(9分)より長く設定」) |
| 2 | `functions/src/ocr/ocrRunGuard.ts` | 「ポーリング間隔(1分)より処理時間(最大540秒)の方が長い」という設計前提 |
| 3 | `functions/src/ocr/ocrProcessor.ts` | 「処理開始からOCR完了までの間(最大540秒)」というsupersede判定コメント |
| 4 | `scripts/migrate-document-groups.js` | `drainWaitMs` 既定10分、コメント「Cloud Functions最大実行時間540秒を上回るバリア」 |
| 5 | `docs/adr/0019-caremanager-group-backfill-maintenance-gate.md` | メンテナンスゲートのドレイン待機根拠として「processOCR: 540秒」を引用 |
| 6 | `docs/context/caremanager-group-backfill-runbook.md` | 同上のドレイン待機説明 |
| 7 | `docs/api-reference.md` | processOCRのタイムアウト値記載 |

## Decision

### タイムアウト値: 540秒 → 900秒 (15分)

1800秒 (上限一杯) は**採用しない**。理由:

- `STUCK_PROCESSING_THRESHOLD_MS` を `timeoutSeconds + margin` から導出する設計上、1800秒を採ると閾値が35分 (1800秒+5分マージン) に伸び、スタック検知が現行10分→35分に遅延する。`MAX_RETRY_COUNT=5` 到達までの総時間も現行約50分→約3時間に伸び、翌日の健全性レポートでしか気づけない現状の検知遅延問題をさらに悪化させる。
- ADR-0019のメンテナンスゲート・ドレイン待機も同様に35分超に伸び、kanameoneの夜間バックフィル等の運用作業時間を圧迫する。
- 実測ベースで900秒あれば約160ページまで単一run で完走可能 (現行540秒は約80ページが限界)。300ページ級の巨大PDFが発生する場合は、そもそも単一Cloud Functions実行で処理すべきではなく、ADR-0016で前例のあるCloud Run Job化を検討すべき領域であり、タイムアウト値の際限ない引き上げで解決すべき問題ではない。

### 不変条件: `STUCK_PROCESSING_THRESHOLD_MS > PROCESS_OCR_TIMEOUT_SECONDS * 1000`

`tryStartProcessing` が `status: 'processing'` 書込み時に `updatedAt` を設定した後、処理中は完了transactionまで一切ハートビート更新されない。このためこの不変条件が破られる (閾値がtimeoutSeconds以下になる) と、Cloud Functions側でまだ正当に実行中のrunを `rescueStuckProcessingDocs` が誤ってpendingに戻してしまい、その run が最終transactionの `evaluateOcrRunOwnership` で `OcrRunSupersededError` となって数百秒分のGemini呼出しコストが丸ごと破棄される (rescue側は`retryCount`も+1消費済みのため二重に悪い結果になる)。

`functions/src/ocr/constants.ts` で `PROCESS_OCR_TIMEOUT_SECONDS = 900` と `STUCK_PROCESSING_MARGIN_MS = 5分` を新設し、`STUCK_PROCESSING_THRESHOLD_MS` (= 20分) をこれらから導出する形に変更した。`scripts/migrate-document-groups.js` の `drainWaitMs` 既定値も10分→20分に更新した (JSスクリプトのため`functions/src/`の定数を直接importできず、値の同期は`functions/test/processOCREndpointContract.test.ts`の契約テストが静的に検証する)。

### 連動して更新した箇所

上記Context「540秒という値の連動箇所」表の全7箇所を新しい値 (900秒・20分) に整合させ、ADR-0019は本ADRへの参照を追記した (ADR-0019自体のStatus・決定内容は変更していない)。

## Consequences

### 得られたもの

- 71ページ級の書類が後処理を含めて完走しやすくなる (実測ベースで約160ページまで単一run許容)。
- `STUCK_PROCESSING_THRESHOLD_MS` が `constants.ts` 内で `PROCESS_OCR_TIMEOUT_SECONDS` から導出される構造になり、将来タイムアウト値を再度変更する際に閾値の更新漏れが起きにくくなった。
- 契約テスト (`processOCREndpointContract.test.ts`) が不変条件とドレイン待機の整合性を静的に固定する。

### 残存リスク

- スタック検知が10分→20分、`error`確定までの総時間が約50分→約115分に伸びる。現状OCRエラーの即時通知経路がなく翌日の健全性レポートでしか気づけない構造と組み合わさると、「気づくのは翌日」という運用実態は変わらない。監視・アラート整備は本ADRのスコープ外 (下記参照)。
- 900秒でも不足する規模 (概ね160ページ超) のPDFは引き続きタイムアウトしうる。後処理側の軽量化 (別PR) と合わせて実効上限を引き上げる必要がある。

## スコープ外 (検討したが本ADRでは実装しない)

- **自動rescue対象へのタイムアウトエラー追加**: `rescueErroredDocuments` は現在 `isQuotaErrorMessage` (429/quotaキーワード) 一致時のみ動作し、ADR-0017が「非429 transient (timeout等) は既存挙動を完全維持」と意図的に限定している。`STUCK_RESCUE_FATAL_MESSAGE_PREFIX` 一致を対象に追加する拡張は技術的には可能 (`errorRescueCount`上限3を無限ループ防止にそのまま流用できる) だが、ADR-0017の意図的な設計判断を覆すかどうかは別途の意思決定が必要なため、本ADRでは提案に留め実装しない。
- **監視・アラートの早期化**: OCRエラーを翌日の健全性レポート以外の経路 (Slack通知等) で即時検知する仕組みは、「予防」ではなく「検知」の課題であるため別Issue化する。
- **`concurrency` の明示設定・予算認識型の早期終了**: `maxInstanceRequestConcurrency: 80` (未設定のデフォルト) が実際に複数tickの並行実行を許しているかどうかは今回の実測で強く示唆されたが、この設定変更はCloud Schedulerのリトライ挙動等の副作用検証を要するため、タイムアウト値変更とは切り離して別途判断する。
- **後処理の軽量化 (`extractOfficeCandidates`のホイスト等)**: 本ADRが対象とするタイムアウト値そのものの再設定とは独立した最適化のため、別PRで扱う。

## Related

- [ADR-0019: CareManagerグループBackfillメンテナンスゲート](./0019-caremanager-group-backfill-maintenance-gate.md) — 本ADRの決定値 (900秒・20分ドレイン) を技術的根拠として参照する
- [ADR-0017: Vertex AI 429 RESOURCE_EXHAUSTED Resilience強化](./0017-vertex-429-resilience.md) — 自動rescue機構の設計方針、本ADRのスコープ外事項の背景
- [ADR-0016: Document Identity and Provenance](./0016-document-identity-and-provenance.md) — Cloud Functions 540秒制約を回避するためCloud Run Jobを採用した前例 (300ページ超級への対応先として言及)
- [ADR-0010: OCR Polling Unification](./0010-ocr-polling-unification.md) — `processOCR`が唯一のOCR処理エントリーポイントである設計の前提
- `functions/src/ocr/constants.ts` (`PROCESS_OCR_TIMEOUT_SECONDS` / `STUCK_PROCESSING_THRESHOLD_MS`)
- `functions/test/processOCREndpointContract.test.ts`
