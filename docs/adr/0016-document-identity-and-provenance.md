# ADR-0016: 分割 PDF の Identity 設計と Provenance Fields 必須化

## Status

Accepted (2026-05-14、PR-D3 完遂時点で MUST 1/2/3/5 の実装完成 — splitPdf + rotatePdfPages 双方が provenance 10 fields + docId namespace identity を強制)。**2026-05-14 改訂 (session70)**: PR-D4 Codex MCP 1st review NO-GO 指摘 (Critical 8 + Important 7) 反映で **MUST 6/7 追加** (legacy backfill の `provenanceBackfill` metadata 必須化 + 既存 valid provenance 上書き禁止) + **SHOULD 1 を 5 段階 classify + 4 phase 構造に書換** + **MUST 3 に rotate gate 拡張 (backfilled `derived-bytes-verified` のみ rotate 許可)** を追記。PR-D4 実装は別 PR、本改訂は ADR 設計合意のみ。

- Proposed: 2026-05-13 (PR-D1、設計合意)
- Accepted: 2026-05-14 (PR-D3、rotatePdfPages 改修で MUST 3 実装完遂、PR-D4 backfill / PR-D5 lint 強化は別 PR で継続)
- Amended: 2026-05-14 session70 (PR-D4 Codex 1st review 反映、MUST 6/7 追加 + SHOULD 1 改訂 + MUST 3 拡張、PR-D4 impl-plan 詳細は `docs/specs/pr-d4-backfill-impl-plan.md`)

## Context

### 発端 (Issue #432, P0)

2026-05-11 の audit-storage-mismatch (PR #430/#431) で kanameone 環境に **39 fileName 衝突 group + 4 fileUrl 孤児 + 推定 90+ docs の silent breakage** を確認した。原因は `generateFileName` (`functions/src/pdf/pdfOperations.ts:697-713`) が衝突回避要素を持たず、複数の異なる元 PDF が同一 `processed/<fileName>` に上書き save され、`rotatePdfPages` / `deleteDocument` が同パス共有 docs の実体を破壊する設計バグである。

ヘルスレポートは「Storage 完全消失 (404)」しか検知できないため、「Firestore メタデータ vs 実体 PDF が別物」状態は完全に隠蔽されている。

### 一次対応 (PR #452, PR-C3c main merge `83921b2`、session66 完遂)

- `processed/{docId}/{fileName}` で **docId namespace 分離** を新規書込パスに導入
- 自動復旧 gate (provenance verified 必須) で legacy docs を 5 分類 (MatchedByHash / RepairableMissingFile / Ambiguous / LostOrUnrecoverable / NeedsManualReview) し、destructive migration を dev リハーサル 7 stages × 2 周で実証
- AC15-3 (現在 GCS 状態との再計算照合) を `scripts/lib/sourceManifestDrift.ts` で強化

### 残存課題 — Codex MCP セカンドオピニオンの根本指摘

PR #452 は **「過去破壊の修復アルゴリズム」**であって、**「将来の新規 split で fileName identity 設計が温存」**されている。Codex MCP thread `019e1c1e-0fc8-70d1-a633-051f7521c4ee` の根本指摘:

> 新規クライアント運用の根本保証には、Firestore で parent-child と Storage object identity を正規化する設計が必須。`pdf-page-visual-v2` (PR-C3c の hash + visual 二重照合) は過去破壊の修復経路であり、将来の collision 予防にはならない。

### 解決すべき設計上の問題

1. **Storage path が doc identity に従属していない**: 同一 `processed/<fileName>` を複数 doc が指す原理的可能性が残る
2. **Firestore document に Storage object の bit-perfect identity 記録がない**: split 時点の親 PDF metadata snapshot (generation / metageneration / sha256 / path) が欠落しており、後続検証で「この子 doc は本当にあの親の特定 generation から派生したか」を厳密照合できない
3. **`rotatePdfPages` の in-place 編集挙動が温存**: 同パス共有 docs を物理的に破壊しうる経路が残る
4. **fileName を identity として使う TypeScript 型表現がない**: 型レベルで旧設計コードパス追加を禁止できない

---

## Decision

### MUST (即時遵守、PR-D2 以降で実装)

1. **MUST**: 新規分割 PDF (PR-D2 以降の `splitPdf`) は `processed/{docId}/{fileName}` 形式の **`derivedObjectPath`** を canonical Storage identity として書き込む。`docId` namespace 分離により同一 docId は単一ファイルに 1:1 対応する。
2. **MUST**: 新規分割 PDF は Firestore document 作成時に **`provenance` field を必ず書き込む**。サブフィールドは **親 PDF identity (source*) + 子 object identity (derived*) + audit (createdAt)** の 10 個:

   **親 PDF identity (split に使用した parent PDF の bit-perfect 証拠)**
   - `sourceGeneration: string` — 親 Storage object generation (split 時点)
   - `sourceMetageneration: string` — 親 Storage object metageneration
   - `sourceSha256: string` — 親 PDF bytes の sha256 (hex)、**実際に split に使用した buffer から計算する** (後述 MUST 5)
   - `sourcePath: string` — 親 Storage **bucket 内 object name** (split 時点、`gs://` prefix は含まない)
   - `sourceBucket: string` — 親 Storage bucket 名

   **子 object identity (子 Storage object の bit-perfect 証拠、Codex High 2 指摘で追加)**
   - `derivedObjectPath: string` — 子 (本 doc) の canonical Storage path (`processed/{docId}/{fileName}`)
   - `derivedGeneration: string` — 子 Storage object 書込後の generation
   - `derivedMetageneration: string` — 子 Storage object 書込後の metageneration
   - `derivedSha256: string` — 子 PDF bytes の sha256 (hex)、子 object 書込後に compute / metadata 取得

   **audit field**
   - `createdAt: Timestamp` — provenance 書込時刻 (= split 完了時刻)。**bytes identity 照合対象ではなく audit / トレース用途のみ。** PR-C3c の自動復旧 gate (6-field provenance) と混同しない。

3. **MUST NOT**: `rotatePdfPages` は **既存 Storage object path への上書き** および **callable 内での旧 path 削除** を行わない。回転結果は必ず新しい canonical object path に書き込み、Firestore の `fileUrl` / `provenance` (`derivedObjectPath` / `derivedGeneration` / `derivedMetageneration` / `derivedSha256` の **derived 4 fields のみ**) を新 object に更新する。**source 5 fields + `createdAt` は base provenance から完全保持** する (rotation は親 PDF identity を再定義しない)。旧 object の削除は番号認可付き destructive migration / 明示 `deleteDocument` 経路でのみ実施する。

   **canonical path 規約 (PR-D3 で確定)**: `processed/{docId}/rotations/{rotationId}.pdf` (rotationId = UUID v4 / `crypto.randomUUID()`)。timestamp ベース命名 (`_r${timestamp}` 等) は禁止 (PR-D3 grep contract で構造的に阻止)。

   **rollback 例外**: callable 内で **新規生成し未 commit な orphan object** (Storage save 成功 → Firestore commit 失敗時等) の rollback delete は MUST 3 禁止対象外。理由: 自己生成 + 外部公開前 + 他 doc から参照不可能なため、ADR が予防対象とする「同 path 共有 docs の物理破壊」が原理的に発生しない。実装上は専用 helper (例: `rollbackOrphanRotation`) で `ifGenerationMatch: <derivedGeneration>` precondition 付きで delete を呼ぶ。

   **MUST 6 連動 (PR-D4 backfill 後の rotate gate 拡張)**: PR-D4 backfilled doc (`provenanceBackfill` 存在) は `confidence === 'derived-bytes-verified'` のみ rotate を許可する。`child-snapshot-only` / `metadata-only` は **`failed-precondition` で reject** する (壊れた legacy bytes を「正規 rotation 経路」で昇格させない、Codex Critical 6 反映)。実装は PR-D4 で `rotatePdfPages` の legacy guard (現在 `provenance` 不在のみ reject) を `provenanceBackfill` 検査拡張する。
4. **MUST**: `fileName` 文字列を **Storage identity / path construction / Firestore lookup key** として直接参照する旧コードパスの追加禁止。PR-D5 で TypeScript 型 (canonical `derivedObjectPath` を branded type 等で区別) と lint rule で構造的禁止を強制する。**禁止対象外**: frontend の表示・ソート・検索用途で `fileName` / `displayFileName` を読み取る既存パス (ADR-0014 「表示用 vs 識別子」分離方針)。
5. **MUST** (Codex High 3 指摘で追加): `splitPdf` は **`provenance.sourceSha256` を実際に split に使用した parent PDF bytes から計算** し、`sourceGeneration` / `sourceMetageneration` は同一 read snapshot 内で取得して整合を検証する。read 後に parent generation が変化した (concurrent write) ことが検出された場合、child doc を作成せず再試行する。整合不能のまま child doc を作成してはならない。
6. **MUST** (PR-D4 Codex 1st review Critical 1/2/8 反映、本 ADR 改訂で追加): 既存 docs の backfill (PR-D4) は **`provenance` を「split 時点正当 provenance」として書いてはならない**。**`provenance` (10 fields) と並列に新規 field `provenanceBackfill` を必須記録** し、legacy backfilled doc を verified provenance origin (PR-D2/D3 で生成された新規 split doc) と識別可能にする。

   **`provenanceBackfill` field 形状**:
   ```ts
   provenanceBackfill?: {
     method: 'legacy-observed';                       // 将来別 method を追加する余地を残すため enum
     confidence: 'derived-bytes-verified' | 'child-snapshot-only' | 'metadata-only';
     backfilledAt: Timestamp;                         // backfill 実行時刻 (≠ provenance.createdAt = split 完了時刻)
     evidence: {
       parentExists: boolean;
       parentSha256MatchedAtBackfill: boolean | null;  // 再 split で sha256 一致を検証した場合 true、未検証 null
       childSha256ComputedAtBackfill: boolean;          // child object から sha256 を実計算したか
       backfillScriptVersion: string;                  // 例: 'pr-d4-v1.0' (script 改修で再 backfill 区別)
       classifierCategory:                              // PR-C3c classifier 出力を記録 (Codex 2nd review I7 反映)
         | 'MatchedByHash'
         | 'RepairableMissingFile'
         | 'Ambiguous'
         | 'LostOrUnrecoverable'
         | 'NeedsManualReview';
     };
   };
   ```

   **意味論**:
   - `provenanceBackfill` **field absent** = PR-D2/D3 で生成された **verified provenance** (split 完了時刻に正当 bytes 証拠で書込)
   - `provenanceBackfill` **exists** = legacy backfilled doc (= 「split 時点正当 provenance ではない」)
   - `provenance.createdAt` は **常に split 完了時刻** で不変。backfill 実行時刻は **`provenanceBackfill.backfilledAt`** に分離記録 (Codex Critical 2 反映)
   - `confidence` 階層 (高 → 低):
     - `derived-bytes-verified`: parent + child 現存、parent から再 split で同 bytes 一致 (= 現 child は壊れていない、Issue #432 silent corruption 被害なし)
     - `child-snapshot-only`: 現 child object の sha256/generation を実計算記録、parent 不在 or 再 split で sha256 不一致 (壊れた legacy bytes の可能性あり)。**本番 backfill の Phase C では原則記録しない (dev/test fixture のみで作成し rotate gate behavior を検証する用途)** (Codex 2nd review C1 反映、§4 PR-D4 impl-plan)
     - `metadata-only`: child object の GCS metadata のみで sha256 実計算スキップ (大容量 PDF 等で cost cut した場合のみ採用)。**PR-D4 では原則使用禁止、明示 approval 必要** (Codex 2nd review L3 反映)

   **MUST 3 (rotatePdfPages) との連動 (Codex Critical 6 反映)**: rotatePdfPages は `provenanceBackfill` 存在 + `confidence !== 'derived-bytes-verified'` の doc を **`failed-precondition` で reject** する。壊れた legacy bytes を「正規 rotation 経路」で昇格させない。

   **Consumer contract (Codex 2nd review C4 反映)**: `provenance` 10 fields を read する全 consumer (rotate gate 以外: 自動復旧 gate / migration script / future PR 等) は **`provenanceBackfill` field の存在を必ず確認** し、存在する場合は **「legacy backfilled、split 時点正当 provenance ではない」** として扱う。`provenance` 単独で「verified split-time origin」と判定してはならない。本契約は contract test で構造的に検証する (PR-D4 BF20)。

7. **MUST** (PR-D4 Codex 1st review Critical 8 反映、本 ADR 改訂で追加): backfill script は **既存 `provenance` (10 fields) を持つ doc (`provenanceBackfill` field absent = verified) を上書きしてはならない**。Phase C atomic batch の precondition で **`provenance` field exists && `provenanceBackfill` field absent** を検出した doc は **immutable skip** とする (Codex 2nd review I1 反映、null vs absent の混同回避)。理由: PR-D2/D3 で生成された verified provenance を低信頼度 backfill で破壊する経路を構造的に閉鎖する。

### SHOULD (推奨遵守)

1. **SHOULD**: 既存 docs への backfill (PR-D4) は **5 段階 classify + 4 phase 構造** (Codex 1st review Phase 改訂指針反映、本 ADR 改訂):

   **5 分類** (PR-C3c classifier 流用、Phase A audit で全件分類):
   - `MatchedByHash` → backfill 候補 `derived-bytes-verified`
   - `RepairableMissingFile` → 物理 rewrite (PR-D5+) 必須、PR-D4 では metadata 記録のみで rotate gate 維持 reject
   - `Ambiguous` → backfill 候補 `child-snapshot-only` (現 child sha256 実計算記録) または skip
   - `LostOrUnrecoverable` → skip (deletion 候補は別 PR、rotate gate 維持 reject)
   - `NeedsManualReview` → skip

   **4 phase 構造** (Codex Critical 3/7 反映、Phase B/C 統合 + drift gate 追加):
   - **Phase A (audit + classify、read-only)**: 全 docs を現状 GCS state で再 audit + 5 分類、artifact JSON 出力 (PR-C artifact は使わず、現在 state から再分類 = Codex Critical 5 反映)
   - **Phase B (write-free preflight revalidation)**: Phase A artifact の各 doc について Firestore `updateTime` + GCS `generation`/`metageneration` を再照合し drift があれば skip。write は一切しない (Codex Critical 7 反映)
   - **Phase C (atomic backfill verified docs)**: Phase B で revalidated な docs に対し **atomic batch で `provenance` 10 fields + `provenanceBackfill` metadata を一括書込** (Codex Critical 3 反映、Phase B/C 分離不能 = atomic record 必須)。`lastUpdateTime` precondition + lockfile gate
   - **Phase D (verify + gate behavior)**: backfill 後の Firestore + GCS 整合確認 + rotate gate 動作確認 (`derived-bytes-verified` で rotate 成功 / `child-snapshot-only` で reject)
   - **物理 rewrite (PR-D5+ 別 PR)**: Storage object を `processed/{docId}/{fileName}` namespace に再配置する処理は PR-D4 scope 外
2. **SHOULD**: `parentDocumentId` (Firestore parent docId) と `provenance.sourcePath` (split 時点の親 Storage object name) は役割分担を保ち、重複・冗長化を避ける:
   - `parentDocumentId`: Firestore-level parent-child 関係 (Firestore tree 参照、UI で「分割元を開く」用)
   - `provenance.sourcePath`: Storage-level snapshot (split 時点の bucket 内 object name、親 doc が削除/移動されても保持され、PR-C3 の自動復旧 gate で参照される)
3. **SHOULD**: ADR-0014 (displayFileName) の「表示用 vs 識別子」分離方針を踏襲し、`fileName` / `displayFileName` は引き続き UI 表示・ソート・検索用、`derivedObjectPath` を Storage identity / path construction / Firestore lookup key として明確に区分する。

### MAY (任意採用、PR-D5 評価対象)

1. **MAY**: backfill 完了後 (PR-D4 後) に `provenance?: DocumentProvenance` の optional を required に格上げするか PR-D5 で評価する。型レベル必須化は legacy docs の存在を許容するか否かの運用判断に依存する。

---

## Consequences

### Pros

- **構造的衝突予防**: 新規クライアント環境でも `processed/{docId}/{fileName}` namespace で identity 一意化、新規 collision の発生が原理的に不可能になる (Issue #432 と同種のバグは再発しない)
- **PR-C3c provenance gate との整合**: PR #452 の自動復旧 gate (`MatchedByHash` 分類) が **新規 split で通過可能な証拠 (`sourceGeneration` / `sourceSha256` / `derivedSha256` 等) を保持** する。通過 100% は保証しない (親 PDF 削除・権限変更・metadata 欠損・concurrent write race 等のケースで通らないことがある) が、通過に必要な証拠は揃った状態になる。
- **`rotatePdfPages` / `deleteDocument` 副作用の原理的解消**: docId namespace 配下のみ操作するため、同パス共有 docs を物理破壊する経路が消える
- **監査性向上**: `sourceSha256` で親 PDF bit-perfect identity 保証、`sourceGeneration` で Storage object 変更検知 (concurrent write drift)、`sourceMetageneration` で metadata 変更検知
- **新規クライアント等価運用 (Issue #445 要件 4)**: 別業種・別 PDF 特性のクライアントを追加しても、同じ collision 予防機構が機能する

### Cons

- **backfill コスト**: kanameone ~5,725 docs / cocoro ~539 docs を全件 best-effort で再 sha256 計算 (時間コスト中、GitHub Actions workflow_dispatch + 分割実行で対応、PR-D4 の `/impl-plan` で具体化)
- **Firestore document size 増加**: 10 fields × 全 docs で MB 単位の追加ストレージ・read コスト (許容範囲、Firestore 単価で月数円〜数十円増)
- **既存 `fileUrl` backward 互換**: 旧形式 `processed/<fileName>` を依然参照する legacy `fileUrl` は backward-compat 維持必須。Frontend の path 解決方針 (Codex efficiency review High 1 指摘で明文化):
  - `provenance.derivedObjectPath` が存在する doc → **`derivedObjectPath` 由来の URL を primary とし、`fileUrl` fallback は呼ばない** (新規 split doc で余分な GCS 404/403 を発生させない)
  - `provenance.derivedObjectPath` が null/undefined の legacy doc → 従来通り `fileUrl` を使用 (旧形式 `processed/<fileName>` の経過措置)
  - **try 順序の禁止**: 「旧形式を先に try してから新形式を fallback」は実装してはならない。GCS read コストが全表示で倍増する
- **PR-D2/D3/D4 で実装変更必要**: 本 ADR は設計合意のみ、実装は別 PR で 4 段階移行 (PR-D2 forward-only / PR-D3 forward-only / PR-D4 destructive backfill / PR-D5 lint 強化)

---

## Alternatives Considered

### A 案: `generateFileName` に `docId` suffix 追加 (`{base}_{docId}.pdf`)

- 既存 5640+ docs はそのまま、新規 split のみ衝突回避
- ❌ **不採用**: `fileName` を identity として使い続ける構造は温存され、新規クライアントで別 collision を生む可能性が残る (`_p1.pdf` / `_p1_abc123.pdf` 等が混在し path 解決ロジックが複雑化)。型レベル禁止も実現困難 (suffix が文字列内に埋没)。

### B 案: `processed/{docId}/{fileName}` で docId namespace 分離 (採用)

- ✅ **採用**: Storage path を doc identity に従属させる設計、Codex MCP セカンドオピニオン推奨
- 同一 docId は必ず単一ファイル → 衝突原理的に発生しない
- PR-C3c (#452) で namespace 自体は導入済 (新規書込パスでのみ)、本 ADR は identity への正規化と provenance 必須化を明文化

### C 案: `rotatePdfPages` / `deleteDocument` で同パス共有 docs を検出して最後の参照のみ削除 (safety net)

- ❌ **補助も採用しない**: 構造修正 B 案で原理的に発生しないため不要。PR-C3c の自動復旧 gate で legacy docs 対応済。safety net を追加すると逆に「同パス共有を許容する設計」と誤読される懸念がある。

### D 案: provenance fields を Storage object metadata (Cloud Storage `metadata` map) に持たせる

- ❌ **不採用**: Firestore query で provenance 条件絞り込みができない (Cloud Storage metadata は LIST API でしか取得不能、コスト高)。`derivedObjectPath` で物理 path を Firestore に持つ方が query / index / Firestore rules で安全に扱える。

---

## Implementation Roadmap

本 ADR の Decision を実装する PR 段階:

| PR | スコープ | destructive | Codex MCP review |
|---|---|---|---|
| **PR-D1** (本 PR) | 本 ADR + `DocumentProvenance` 型定義 + Firestore schema 文書化 | read-only (設計フェーズ) | ADR 草案段階で実施 |
| **PR-D2** | `splitPdf` 改修 (新規 split で provenance 10 fields 書込 + `derivedObjectPath` canonical 化)。impl-plan 前提: ① `file.save()` + 後続 `file.getMetadata()` で子 object の `derivedGeneration` / `derivedMetageneration` を取得 (2 API call、許容範囲。Codex efficiency Low 1)、② `derivedSha256` は GCS metadata に含まれない (`md5Hash`/`crc32c` のみ提供) ため **書込時 buffer から compute** で正規化、③ `functions/src/pdf/provenance.ts` で `createSplitProvenance()` factory + sha256 hex 長さ・generation 数値文字列 runtime 検証 (Zod / valibot)、④ unit test で「provenance 10 fields 全て書込まれること」「同一 read snapshot 内で source\* 取得」「concurrent write 検出時の再試行」を網羅 (type-design Enforcement 補強) | forward-only (新規 split のみ影響) | impl-plan + 実装後の 2 段階で必須 |
| **PR-D3** ✅ **完遂 (2026-05-14)** | `rotatePdfPages` 改修: `processed/{docId}/rotations/{rotationId}.pdf` 新 path 書込 (UUID v4) + `createRotationProvenance()` で source 5 + createdAt 不変 + derived 4 更新 + Firestore transaction による optimistic locking (updateTime 比較で concurrent write 検出) + GCS `preconditionOpts: { ifGenerationMatch: 0 }` (UUID 衝突ダブルセーフティ) + callable 内 delete 経路完全撤廃 + legacy provenance 無し doc を `failed-precondition` で reject + 入力 validation (空配列 / 同ページ重複 / pageNumber 範囲外) + orphan rollback helper (自己生成 path のみ delete) | forward-only (新規 rotation のみ影響) | impl-plan (Codex MCP `019e2383-...` HIGH 4 + MEDIUM 3 + LOW 1 全件反映、案 X → 案 Y' 切替) + 実装後 2 段階で必須 |
| **PR-D4** | 既存 docs の provenance fields backfill (5 段階 classify + 4 phase 構造、SHOULD 1 参照)。詳細 impl-plan: [`docs/specs/pr-d4-backfill-impl-plan.md`](../specs/pr-d4-backfill-impl-plan.md)。Phase A=audit+classify (read-only) / Phase B=write-free preflight revalidation / Phase C=atomic backfill verified docs (`provenance` 10 fields + `provenanceBackfill` metadata) / Phase D=verify+gate behavior。物理 rewrite=PR-D5+ defer。実装ホスト=Cloud Run Job (Cloud Functions 540s timeout 制約回避、Codex Important 1)。AC=PR-D2/D3 の AC1-7 に加えて **AC BF8-15** (Phase 完遂判定 + rotate gate behavior 検証)。フェルミ試算: kanameone 5,725 docs + cocoro 539 docs、p95 parent サイズ × egress + sha256 計算 CPU 秒、修正トリガー 7 件 (impl-plan §フェルミ参照) | **destructive (既存 docs への書込)。MUST: 番号認可付き実行 + dry-run + dev リハーサル 7 stages × 2 周 (PR-C3c プロトコル準拠) + Codex MCP impl-plan/実装後 2 段階 review + lockfile gate (並行 backfill 排除)** | impl-plan + 実装後 + dev リハーサル 7 stages × 2 周 (PR-C3c プロトコル準拠) |
| **PR-D5** | TypeScript 型 + lint で `fileName` identity 旧コードパスを構造的禁止、`provenance?` → required 評価 | コード変更のみ | impl-plan |

各 PR は別途 `/impl-plan` + Codex MCP セカンドオピニオン経由で詳細計画化。本 ADR は **設計方針合意 + 段階提示のみ** であり、実装着手は別 Task / 別 PR / 別承認。

---

## References

- **Issue #432** (P0、PR-A〜C3c で過去破壊修復完遂): https://github.com/yasushi-honda/doc-split/issues/432
- **Issue #445** (本 ADR の親 Issue、PR-D 系列計画): https://github.com/yasushi-honda/doc-split/issues/445
- **PR #452** (PR-C3c main merge `83921b2`、AC15-3 強化版、session66 完遂): https://github.com/yasushi-honda/doc-split/pull/452
- **ADR-0008** (Firestore データ保護): `docs/adr/0008-firestore-data-protection.md` — backfill destructive 制約根拠
- **ADR-0014** (displayFileName 設計): `docs/adr/0014-display-filename.md` — 「表示用 vs 識別子」分離方針を踏襲
- **Codex MCP セカンドオピニオン thread `019e1c1e-0fc8-70d1-a633-051f7521c4ee`** (PR-C3 + PR-D 依存範囲評価、B 案推奨根拠)
- **Codex MCP セカンドオピニオン thread `019e1bc6-bbd9-7580-9442-08f8f534fd72`** (PR-C3 Critical 2 + Important 6、根本指摘 E)
- **Codex MCP セカンドオピニオン thread `019e1f5d-c93e-7d43-812b-b6d4c3fbef3d`** (本 ADR-0016 草案 review、GO with required amendments: High 3 件 + Medium 3 件 + Low 2 件を本草案に反映済み)
- **Codex MCP セカンドオピニオン thread `019e2558-f83f-7a13-aadd-0eab042fd949`** (PR-D4 backfill impl-plan 1st review、NO-GO with Critical 8 + Important 7 + AC BF8-15 + Phase A-D 改訂指針、本 ADR 改訂 session70 で MUST 6/7 + SHOULD 1 改訂 + MUST 3 拡張に反映)
- **PR-D4 impl-plan**: [`docs/specs/pr-d4-backfill-impl-plan.md`](../specs/pr-d4-backfill-impl-plan.md) (5 段階 classify + 4 phase 構造 + AC BF8-15 + フェルミ試算 + Cloud Run Job 採用)
- **memory: `feedback_destructive_migration_codex_review.md`** (destructive migration の impl-plan は Codex MCP セカンドオピニオン必須)
- **memory: `feedback_deterministic_cross_process.md`** (deterministic 主張のクロスプロセス検証、PR-D2 設計時の制約)
- **handoff session66** (2026-05-13、PR-C3c 完遂レポート): `docs/handoff/LATEST.md`
- **既存実装**: `functions/src/pdf/pdfOperations.ts:245-251` (`splitPdf`) / `:697-713` (`generateFileName`)
