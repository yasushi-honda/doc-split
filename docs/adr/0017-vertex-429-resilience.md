# ADR-0017: Vertex AI 429 RESOURCE_EXHAUSTED Resilience 強化

## Status

Proposed (2026-06-12、本 PR で実装、Phase B/C deploy 完了で Accepted)。

## Context

### 発端 (2026-06-11 kanameone 健全性レポート)

2026-06-11 11:04-11:43 (39 分間)、kanameone (docsplit-kanameone) 本番環境で Vertex AI Gemini API が `429 Too Many Requests` (`RESOURCE_EXHAUSTED`) を継続発生。**21 件のドキュメントが MAX_RETRY_COUNT=5 を超過 (3 min × 5 = 15 min) して `status:error` に確定**し、健全性レポートに残留した。

### 既存設計の限界 (Issue #194 / #196 / #360 の積み残し)

| 既存パターン | 限界 |
|------------|------|
| `MAX_RETRY_COUNT = 5` (transient 共通) | 429 系の長期 quota 枯渇に対し最大 15 分 (3 min × 5) しか粘れない |
| `retryAfter = 3 min` (429 系固定) | exponential backoff なし → quota 復旧前に再衝突 |
| jitter なし | 複数 doc 同時 429 → 同時刻 retry → thundering herd で再衝突 |
| `error` 状態の自動回復なし | `rescueStuckProcessingDocs` は `processing` 状態のみ。`error` は手動 `fix-stuck-documents.js --include-errors` まで放置 |

### 達成可能な保証ライン

**主防御**: 同種事象 (39 分 quota 枯渇) で `error` 状態に落ちる doc をゼロにする。
**補助 (backstop)**: 万一 `error` に落ちても 1 時間後に自動 rescue。
**不可侵な保証**: 「Vertex AI が落ちても処理遅延ゼロ」は **約束しない** (外部 API 依存)。

### Codex セカンドオピニオン (採用)

設計妥当性確認を `mcp__codex__codex` (thread `019eb9bd-441a-7872-9500-3cd90a0e6e20`) で実施。要点採用:

- 429 系は通常 transient retry と分離 (`MAX_RETRY_COUNT_429` 専用カウンタ)
- exponential delay + **jitter ±20%** (thundering herd 対策)
- error rescue は backstop に格下げ (error semantics「処理不能・要介入」を維持)
- 初回 delay を 3 分から 1 分に短縮 (軽微 rate spike からは早期復帰)

## Decision

### 主防御: 429 系専用 retry policy (handleProcessingError 改修)

- `MAX_RETRY_COUNT_429 = 8` を新設 (既存 `MAX_RETRY_COUNT = 5` は非 429 transient 用に維持)
- `RETRY_DELAYS_429_MS = [1, 3, 6, 12, 24, 48, 60, 60] 分` の exponential 配列
- `RETRY_JITTER_FACTOR = 0.2` で ±20% jitter (`calculateRetryDelay429Ms(retryCount, rng)`)
- 429 連発の cumulative horizon: 約 3.5 時間 (累計 214 分)

実装: `is429Error(error)` で分岐し、429 系のみ `MAX_RETRY_COUNT_429` + `calculateRetryDelay429Ms()` を適用。非 429 transient は既存挙動 (`MAX_RETRY_COUNT=5` + 1 min retryAfter) を **完全維持**。

### 補助 (backstop): error 状態自動 rescue

- `rescueErroredDocuments`: status=error AND lastErrorMessage に 429 系キーワード AND updatedAt < (now - 1h) AND errorRescueCount < 3 を満たす doc を pending に戻す
- `rescueErroredDocumentsIfDue`: `meta/ocrRescueState.lastErrorRescueAt` で 1 時間 interval ガード (既存 1 min cadence processOCR scheduler に統合、別 Cloud Scheduler 追加なし)
- 永続ループ防止: `errorRescueCount >= MAX_ERROR_RESCUE_COUNT (= 3)` で対象外
- rescue 動作: `status=pending, retryCount=0, retryAfter=now+10min, errorRescueCount++, lastRescuedAt`

### 派生フィールド追加プロトコル (CLAUDE.md #178 教訓)

新規フィールド `errorRescueCount` / `lastRescuedAt`:

- ✅ `getReprocessClearFields()` に追加: 手動 reprocess で「自動 rescue 諦め (MAX 到達)」を user 操作で解除可能化
- ✅ `fix-stuck-documents.js` に `deleteField()` 追加: 手動 reset 時もクリア
- 既存パターン踏襲: `shared/types.ts` / `firestoreToDocument()` への追加は **不要** (既存 `retryCount`/`retryAfter`/`lastErrorMessage` も同様に未追加 = FE 表示しない内部フィールド扱い)

## Consequences

### Positive

- 39 分 quota 枯渇事象を主防御で吸収 (cumulative 3.5h horizon)
- 万一 error 確定しても 1h で自動 rescue → 健全性レポート長期残留なし
- 非 429 transient (timeout 等) は既存挙動完全維持 → 既存テスト・運用パターン無影響
- DRY 改善: `QUOTA_ERROR_MESSAGE_KEYWORDS` 単一定数で `is429Error` / `isQuotaErrorMessage` の drift 不可
- `handleProcessingError` の error 確定時に `retryAfter: deleteField()` を追加 (一貫性向上、`rescueStuckProcessingDocs` の fatal 分岐と同パターン)

### Negative

- 429 連発時の max horizon が 15 min → 3.5h に伸長 → ユーザー体感の処理遅延が長期化 (ただし error 確定は避けられる)
- `meta/ocrRescueState` doc が新規 (1 doc only)、`maxInstances=1` 前提で non-transactional interval guard
- 永続的に 429 が続く場合: rescue × 3 で諦め (最悪 ~13.5h)、その後は手動 `fix-stuck-documents.js --include-errors` 介入が必要

### Risks

| リスク | 対応 |
|--------|------|
| `maxInstances` 変更時に rescue scan の race condition | コメントで明記、変更時は transaction 化 |
| Vertex AI quota が 3.5 時間以上枯渇 | rescue で再 pending、最終的に処理完走を待つ。完全保証は外部要因のため不可能 |
| rescue 直後の retryCount=0 リセットで指数バックオフ履歴消失 | rescue 時 retryAfter=now+10min を併用、即時再衝突を回避 |
| `errorRescueCount` 未定義 doc | `|| 0` で 0 扱い、migration 不要 |

## Verification

### Acceptance Criteria (evaluator agent で検証済 PASS)

- AC1: 429 系 transient は `MAX_RETRY_COUNT_429=8` まで pending 継続
- AC2: 429 retry delay は `RETRY_DELAYS_429_MS × jitter ±20%`
- AC3: 非 429 transient は既存挙動維持 (MAX_RETRY_COUNT=5 / 1 min retryAfter)
- AC4: 1h+ 経過の 429 系 error は自動 rescue で pending 復帰
- AC5: `errorRescueCount >= 3` は rescue 対象外
- AC6: rescue scan は 1h interval (meta/ocrRescueState)
- AC7-AC9: deploy / 21 件復旧後の実行時評価

### テスト

- `functions/test/ocrProcessor.test.ts`: 86 cases (pure logic, 429 delay 計算 + jitter / maxRetries 分岐 / isQuotaErrorMessage 検証)
- `functions/test/rescueErroredIntegration.test.ts`: 17 cases (Firestore emulator、429 連発 / rescue / interval guard / race condition)
- 全 unit + integration test PASS、TypeScript build PASS、ESLint errors 0

### Multi-Client Matrix (Phase B/C/D)

| 工程 | dev | kanameone | cocoro |
|------|-----|-----------|--------|
| 1. bugfix + 予防策実装 | ✅ | - | - |
| 2. dev テスト全 PASS | ✅ | - | - |
| 3. functions deploy | (Phase B) | (Phase C) | (Phase C) |
| 4. functions logs 確認 | (Phase B) | (Phase C) | (Phase C) |
| 5. 21 件 reprocess + 完走 | - | (Phase D) | - |
| 6. 健全性レポート error=0 | (Phase B) | (Phase D 後) | (Phase C 後) |

## References

- Issue #194 (PR #195): 429 / RESOURCE_EXHAUSTED 検出 + retryAfter 導入
- Issue #196 (PR #359): rescue MAX_RETRY_COUNT 到達で error 確定 + STUCK_RESCUE_RETRY_AFTER_MS
- Issue #178: 派生フィールド追加時の 4 ポイント (#178 教訓)
- Issue #360 (PR #361): rescueStuckProcessingDocs に runTransaction 整合 + safeLogError
- Codex MCP thread `019eb9bd-441a-7872-9500-3cd90a0e6e20`: 設計セカンドオピニオン
- Evaluator agent (前提知識なし第三者評価): AC1-AC6 PASS、Phase B 進行可
