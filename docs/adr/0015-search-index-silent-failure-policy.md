# ADR-0015: search_index 削除操作の silent failure 対処方針

## Status
Accepted

## Date
2026-04-16

## Context

PR #222 (Issue #219) で `removeTokensFromIndex` (`functions/src/search/searchIndexer.ts:182-205`) の catch 節を NOT_FOUND とその他エラーに分岐させ、NOT_FOUND は冪等な無視、その他は `console.error` で severity=ERROR ログ化した。

PR #222 の `/review-pr` で silent-failure-hunter から Critical 指摘:

> `console.error` は throw しないため、`PERMISSION_DENIED`, `UNAVAILABLE`, `RESOURCE_EXHAUSTED`, `DEADLINE_EXCEEDED` はすべて trigger を「成功」として完了する。onWrite trigger の自動 retry は発火せず、search_index は恒久的に drift し、削除済み書類が検索にヒットし続ける。

Issue #223 で方針を確定させる必要がある。

## Problem

1. `removeTokensFromIndex` の catch 節が throw しないため、`ondocumentwritesearchindex` は失敗を成功として報告する
2. Cloud Functions gen2 の retry policy はデフォルト OFF (opt-in 必須) のため、単純に throw を追加しても効果が限定的
3. dead letter 相当の標準機能が gen2 Firestore trigger には存在しない
4. drift の検出手段が未整備 (#220 未実装)
5. drift 発生時の復旧スクリプトも未整備 (`scripts/migrate-search-index.js` は `tokenHash` 済みドキュメントをスキップする仕様で、今回の drift パターンは対象外)

## Decision

**案 A (現状維持)** を採用する。

- `removeTokensFromIndex` の catch 節は PR #222 の実装 (NOT_FOUND 冪等 + その他 ERROR severity ログ) をそのまま維持する
- throw 化は行わない
- 実装変更ゼロ

この判断は **観測データが揃うまでの暫定方針** とする。#220 の log-based metric で削除経路のエラー頻度・種類が実測できた時点で、本 ADR を更新または置換する。

## Alternatives Considered

### 路線別に再整理

`removeTokensFromIndex` の呼び出しは 2 経路あり、性質が異なるため個別評価する。

| 経路 | 呼び出し元 | 後続処理 | 失敗時の drift |
|---|---|---|---|
| **削除経路** | `removeDocumentFromIndex` (searchIndexer.ts:175-177) → documents 削除 trigger 経由 | **なし** (関数で完結) | 削除済みドキュメントが検索にヒットし続ける |
| **更新経路** | `ondocumentwritesearchindex` handler (`onDocumentWritten` trigger) 内 (searchIndexer.ts:85-92) | `tokenHash` 更新 (L99-106) | 古いトークンが search_index に残留 + `tokenHash` との整合性崩壊 |

### 案 A: 現状維持 (採用)

- **変更**: なし
- **Pros**: 既存 4,260件処理を壊さない。retry:true の副作用 (永続エラーの 24h retry コスト) を回避
- **Cons**: 削除経路のリスクは残る。検出は #220 待ち

### 案 B: 全面 throw + `retry: true`

- **変更**: trigger オプションに `retry: true`、catch 節で throw
- **Pros**: transient error (UNAVAILABLE/DEADLINE_EXCEEDED/RESOURCE_EXHAUSTED) が自動復旧
- **Cons**:
  - **更新経路で `tokenHash` 更新スキップ → 別種の drift 誘発** (searchIndexer.ts:99-106 に到達しない)
  - permanent error (PERMISSION_DENIED) は root cause 解消まで 24h retry し続け、Cloud Functions 実行時間と Cloud Logging が増大
  - PR #222 の code-reviewer 評価 (「throw しない判断は妥当」) と矛盾
- **却下理由**: 更新経路の副作用が実害大

### 案 B': 削除経路のみ throw + `retry: true` (経路別ハイブリッド)

- **前提**: 現状単一の `ondocumentwritesearchindex` (`onDocumentWritten` trigger) を、**削除専用 trigger (`onDocumentDeleted`) と更新専用 trigger (`onDocumentUpdated`/`onDocumentCreated`) に分離する実装** が必要
- **変更**:
  - 削除専用 trigger 内の `removeDocumentFromIndex` で throw
  - 削除専用 trigger のみオプションに `retry: true`
  - 更新専用 trigger は現状維持 (throw なし、retry なし)
- **Pros**: 削除経路の drift を自動復旧可能。更新経路の副作用を避ける
- **Cons**:
  - 削除 trigger と更新 trigger を分離する実装コスト (1-2 ファイル)
  - permanent error の 24h retry コスト問題は残る
  - #220 の実データで PERMISSION_DENIED 頻度が判明する前に retry を有効化するのは「推測設計」(CLAUDE.md 禁止ルール) に抵触しうる
- **却下理由 (暫定)**: #220 の実データが揃った時点で再評価する。現時点ではデータ不足で副作用の見積もりが不可能

### 案 C: dead letter pattern (`failed_index_operations` collection + 復旧 batch)

- **変更**: 新 collection + 新 trigger + 復旧 cron job
- **Pros**: 恒久的解決、retry コスト予測可能
- **Cons**: 実装規模大 (4-6 ファイル相当)
- **却下理由 (暫定)**: 本 Issue の影響規模と比較して過大。drift 実発生が観測された場合に別 ADR で再評価する

### 却下案の再昇格条件

| 案 | 再評価トリガー |
|---|---|
| B' (削除経路のみ throw) | #220 metric で `severity=ERROR` ログが **7日間に 1件以上** 発生、または PERMISSION_DENIED 以外の一過性エラーが確認された時 |
| C (dead letter) | B' 実装後も drift が月次 1件以上検出される、または B' の retry コストが許容範囲を超えた時 |

## Consequences

### Positive

- PR #222 の判断根拠が明文化され、将来の再議論コストが低減
- #220 の log-based metric 設計と整合 (ERROR severity 前提)
  - **2026-09-20 追記 (Issue #981)**: この「ERROR severity 前提」はgen2 (Cloud Run)では成立しない。`console.error()`はCloud Loggingで`severity=ERROR`に昇格されずDEFAULT severityで記録されるため、metricフィルタから`severity="ERROR"`条件を除去し、resource + `textPayload`で検知する形に修正した。本ADR中の「`severity=ERROR`」「ERROR severity」への言及は全て「`console.error`で出力された」の意味で読むこと(例: 「`severity=ERROR`ログが7日間に1件以上」=「`console.error`で`Failed to remove tokens`が7日間に1件以上出力された」)
- 追加実装ゼロで本 Issue をクローズ可能

### Negative

- 削除経路の drift 発生時、**自動復旧手段がない** (手動復旧手段は Issue #229 で整備済)
- ~~手動復旧スクリプトも未整備~~ → **2026-04-16: `scripts/force-reindex.js` + `docs/context/search-index-recovery.md` で整備完了。dev 環境での初回執行による動作確認は Follow-up として残存**
- 検出は #220 実装後となり、それまでは Cloud Logging の手動監視のみ

### Risk Acceptance

本 ADR 時点では以下のリスクを受容する:

1. **drift 未検証**: kanameone 4,260件処理済で「報告なし」だが、drift 検出手段がないため「発生なし」の証明ではない
2. **3分岐監視未達**: #178 教訓の「NOT_FOUND / transient / permanent の 3 分岐」要件は、現実装 (NOT_FOUND + その他の 2 分岐) では未達。3 分岐化は #220 の受け入れ条件として扱う
3. **復旧 SOP**: **2026-04-16 に Issue #229 でスクリプト (`scripts/force-reindex.js`) と Runbook (`docs/context/search-index-recovery.md`) を整備。** 初回の dev 実行による動作検証は次セッションで実施予定 (Follow-up 残存)

これらのうち 1, 2 は Follow-up (#220) で継続、3 はスクリプト/Runbook 整備完了、dev 検証のみ残存。

## Follow-up

### 暫定運用 (#220 実装まで) — **DEPRECATED (PR #231 で自動化)**

> ⚠️ **本セクションは PR #231 merge + 権限付与 + `setup-log-based-metrics.sh` 実行で役割を終える。** 以降は `search_index_silent_failure` metric + alert policy が自動検出する。本セクションは履歴として残す。

Cloud Logging で以下のクエリを週次で手動確認 (PR #231 展開前の暫定運用):

```bash
gcloud logging read \
  'resource.labels.function_name="ondocumentwritesearchindex" severity>=ERROR timestamp>="YYYY-MM-DDT00:00:00Z"' \
  --project=<env-project-id> --limit=50 --format="value(timestamp,textPayload)"
```

監視対象ログフィルタ: `Failed to remove tokens from search index`

### 後続タスク

| タスク | 起票先 | 優先度 | 目的 |
|---|---|---|---|
| log-based metric + alert 実装 | Issue #220 | P2 | ERROR severity 自動監視、検出遅延 5 分以内 |
| 3分岐 (NOT_FOUND / transient / permanent) 分類を #220 metric に追加 | Issue #220 のサブタスク | P2 | 再昇格トリガーの判定素材 |
| ~~復旧 SOP + force reindex スクリプト整備~~ | **Issue #229 (2026-04-16 完了)** | P2 | ✅ `scripts/force-reindex.js` + `docs/context/search-index-recovery.md` + `run-ops-script.yml` 組込 |
| dead letter pattern 実装 | 将来新規 Issue で起票 (drift 月次 1件以上で昇格) | P3 | 恒久的な retry 受け皿 |

### 再評価トリガー

本 ADR は以下のいずれかが発生した場合に再評価する:

1. #220 metric で `severity=ERROR` ログが 7日間に 1件以上発生
2. PERMISSION_DENIED / UNAVAILABLE / DEADLINE_EXCEEDED / RESOURCE_EXHAUSTED のいずれかが検出された
3. 手動での force reindex が必要になった
4. 検索機能にユーザー報告 (削除済み書類がヒット) があった

### dead letter pattern 移行時のメトリクス置換条件

将来 dead letter pattern (failed_index_operations collection + 復旧 batch) が実装された場合、本 ADR Follow-up の `search_index_silent_failure` metric は **意味を失う** (失敗が dead letter queue に記録されるため ERROR ログは発生しなくなる)。

dead letter pattern 昇格時の移行手順:

1. `search_index_silent_failure` metric + alert policy を `teardown-log-based-metrics.sh` で削除
2. 代わりに以下を新設:
   - `dead_letter_queue_depth`: `failed_index_operations` collection のドキュメント数 (Firestore export or custom metric)
   - `dead_letter_queue_age`: 最古エントリの経過時間
3. dead letter pattern 実装 Issue の Follow-up セクションに本置換条件を記載
4. 本 ADR を **Superseded** ステータスに変更し、新規 ADR で dead letter 方針を記述

dead letter pattern 移行後は **原則 ERROR ログは発生しなくなる想定** (失敗が dead letter queue に記録されるため) だが、catch 前の例外経路や dead letter 書込み失敗で ERROR が残存する可能性はある。完全移行時には log-based metric ベースの監視と DLQ ベースの監視を一時的に並行稼働させ、差分を観測してから旧 metric を撤去する運用を推奨。

この置換条件を明示しないと、二重検知 (ERROR ログ alert + dead letter queue alert 両方から通知) が発生する。

## 2026-09-20 追記 (Issue #984): 高頻度トークン飽和のフォールバック

**段階の定義**: 段階1 = 本追記のフォールバック(影響範囲の限定)・検知・復旧。段階2 = 根本対応(`postings` のシャーディング、または高頻度トークンの索引除外とクエリ側の `fileDate` 範囲代替。別途 plan mode で決める)。

`search_index/{tokenId}` の1トークン=1ドキュメント設計により、高頻度トークン(kanameone の `"2026"` = `00177502`)が
Firestore の 1MiB 上限に達し、`addDocumentToIndex` の原子的 batch が失敗して、その書類の全トークンが未登録になった。

- **フォールバック**: サイズ超過(`isFirestoreDocumentSizeExceededError`)の場合だけ、トークンごとの個別書込みへ切り替え、超過したトークンだけをスキップする。通常経路は単一 batch のまま。サイズ超過以外のエラーは従来どおり throw し、throw 前に固定ログ `[searchIndexer] index write failed` を出す。
- **`documents.search` の意味**: `tokens` = 登録できたトークンのみ / `skippedTokens` = スキップ分 / `tokenHash` = 期待する全トークンのハッシュ。**`drift: 0` は「全トークン登録済み」ではなく「ハッシュ保存済み」**。段階2では `search.skippedTokens` を持つ書類を列挙して再索引する(列挙方法は段階2の計画で確定)。
- **`df`**: index 文書の存在ではなく `postings[docId]` の有無で増分を決める(`force-reindex.js` の `hadPosting` と同じ)。初回索引の直後に `search` メタ書込みが同じトリガーを再発火し再索引される既存挙動と、フォールバック後の再試行で `df` が二重加算されるのを防ぐ。**既存の膨張済み `df`(実件数の約3.6倍)は是正しない**。書き手は3種(トリガー、`force-reindex.js`、`migrate-search-index.js`)で意味がばらつき、削除側(`removeTokensFromIndex`)は posting の存在確認なしに `df` を減算する(非対称)。`searchDocuments.ts` は `df` の最大値を総書類数の代用にするため、既存の膨張済み `df` と混在して検索ランキングがわずかに変わりうる。
- **旧書式**: 旧 `addDocumentToIndex` は `set(..., {[`postings.${docId}`]: ...}, {merge:true})` を使っており、ルート直下に文字どおり `postings.<docId>` というフィールドが作られた可能性がある(`searchDocuments.ts` の互換処理はこのため)。`hadPosting` の判定は、トリガー(`searchIndexer.hasPostingFor`)と `force-reindex.js` の両方で、ネスト形とルート直下の旧書式の両方を見る。掃除は段階2。
- **既知の限界**: フォールバック中にサイズ超過以外のエラーが起きると、一部トークンだけ書込み済みの状態で throw する(`df` は再試行しても再加算されない。postings の部分登録は `force-reindex` で復旧)。
- **検知**: log-based metric を2本に分ける。`search_index_token_skipped`(スキップ。アラートなし: kanameone では段階2まで常時発生し、常時 open のアラートは新規の劣化を覆い隠すため)と、`search_index_write_failed`(サイズ超過以外の書込み失敗。**アラートあり**、0 が正常)。

## References

- Issue #223 (本 ADR)
- Issue #219 / PR #222 (silent failure 監視可能化)
- Issue #220 (log-based metric、ERROR severity 監視)
- Issue #229 (復旧 SOP + force reindex スクリプト、2026-04-16 完了)
- `scripts/force-reindex.js` (復旧スクリプト)
- `docs/context/search-index-recovery.md` (復旧 Runbook)
- dead letter pattern (将来新規 Issue、本 ADR 起草時点では未起票)
- Issue #178 / ADR-0008 (データ保護ポリシー、drift = データ喪失と同型リスク)
- Issue #217 / PR #218 (OOM 応急対処、12.7h 観察で 0 件維持)
- `functions/src/search/searchIndexer.ts:182-205` (対象コード、2026-04-16 確認)
- `scripts/migrate-search-index.js:293-297` (tokenHash スキップ仕様、2026-04-16 確認)

### 外部仕様 (2026-04-16 確認)

- Firebase Cloud Functions v2 retry policy: https://firebase.google.com/docs/functions/manage-functions?gen=2nd#set_retry_policy
- `firebase-functions` v6.6.0 型定義 (v2 trigger options の `retry` プロパティ): `retry?: boolean | Expression<boolean> | ResetValue` (デフォルト false)
- GCP Eventarc Standard 仕様 (retry: true 時): 初期 10秒 / 最大 600秒 指数バックオフ / 24時間以内 / retryConfig 非対応
