# Orphan Storage Cleanup Runbook

**対象事象**: DocSplit プロジェクトで Storage 実体は存在するが Firestore document からの参照がない孤児ファイル (reverse orphan) の発見・対応手順。

**関連**: Issue #432 (PR-A safety net / PR-B docId namespace / PR-D 検出強化)

---

## 検出方法

### 1. Cloud Logging で発生時に検知

**実行前**: `./scripts/switch-client.sh <env>` で対象環境を選択し、Cloud Logging Console の project 表示が一致することを確認 (マルチクライアント環境 = dev / kanameone / cocoro の取り違え防止)。

PR-B 補償処理の二段失敗 (Firestore set 失敗 → Storage delete も失敗) で発生する場合:

```
resource.type="cloud_function"
jsonPayload.operation="splitPdf"
jsonPayload.stage="orphanCleanup"
jsonPayload.cleanupResult="failed"
```

このログには以下が含まれる:
- `newDocId`: 該当する Firestore docId (未作成だが採番済)
- `newFilePath`: Storage 上の orphan path
- `bucket`: bucket 名
- `manualCleanupCommand`: 直接実行可能な `gsutil rm` コマンド

### 2. 定期 audit で検出 (推奨)

```bash
# GitHub Actions: Run Operations Script → audit-storage-mismatch.js → 環境選択
# または手動:
FIREBASE_PROJECT_ID=<project-id> STORAGE_BUCKET=<bucket> \
  node scripts/audit-storage-mismatch.js --no-orphans --no-collisions
```

`reverse orphans` セクションに `processed/{docId}/...` 形式の path が列挙される。
**docId namespace pattern** セクションは Firestore auto-ID 20 文字仕様に厳密一致 + 同 ID の doc 不在を確認した候補で、「PR-B 補償処理由来の可能性が高い」として hint 表示。

**fileUrl 解析失敗 / 別 bucket 参照件数の WARN** が出ている場合、reverse orphan に false positive が混入する可能性。`gsutil rm` 前に必ず原因調査すること。

---

## 対応手順

### Phase 1: 検証 (read-only)

孤児ファイルが本当に Firestore から参照されていないことを再確認:

```bash
# gsutil で対象 path の metadata 確認 (作成日時、サイズ)
gsutil stat gs://<bucket>/processed/<docId>/<fileName>

# Firestore で docId を inspect (read-only)
FIREBASE_PROJECT_ID=<project-id> node scripts/inspect-document.js <docId>
# → "Document not found" であれば真の orphan
```

### Phase 2: 復元可能性判定

孤児 PDF の内容を確認してから削除判断:

```bash
# 一時 download
gsutil cp gs://<bucket>/processed/<docId>/<fileName> /tmp/orphan.pdf

# 内容確認 (PDF を開く)
# macOS: open /tmp/orphan.pdf
# Linux: xdg-open /tmp/orphan.pdf   (環境により未インストールの場合あり)
# WSL/SSH: scp <host>:/tmp/orphan.pdf ./local.pdf で手元に転送して確認

# 重複確認 (任意): md5 hash で他 processed/* との同一性チェック
md5sum /tmp/orphan.pdf
# 同 hash のファイルが Firestore に紐づいているか inspect
FIREBASE_PROJECT_ID=<project-id> node scripts/inspect-document.js <parent-docId-candidate>
```

判定基準:
- **削除可**: 内容が他の processed/ doc と重複 (md5 hash 一致) / OCR 失敗時の不要 PDF
- **要復元**: 失われた業務データを含み、再分割の元 PDF も存在しない

### Phase 3: 削除実行 (個別パス認可必須 = per-path explicit authorization required)

ユーザーから削除対象の **gs:// path を文字列単位で含む承認文** を取得後にのみ実行可。

**Issue 番号や prefix 一括での認可は無効** (例: `Issue #432 全件削除してよい` / `processed/ 配下削除してよい` は不可)。各 path につき個別の認可文 (例: `gs://bucket/processed/XXX/YYY.pdf を削除してよい`) が必要。

実行:

```bash
# 単一ファイル削除
gsutil rm gs://<bucket>/processed/<docId>/<fileName>

# 確認
gsutil ls gs://<bucket>/processed/<docId>/
```

**禁止事項**:
- `gsutil rm -r gs://<bucket>/processed/` のような prefix 一括削除は絶対禁止 (ADR-0008 教訓)
- 認可なしの自動削除スクリプトは禁止

### Phase 4: 復元 (要復元と判定された場合)

**重要**: PR-B namespace pattern `processed/{docId}/{fileName}` の `{docId}` は **未生成の子 doc ID** (splitPdf 補償処理失敗で Firestore set されなかった child)。parent ではないため path からは parent を特定できない。

parent (= splitPdf に渡された元 doc ID) を特定する手段:

```bash
# Cloud Logging で当該 newDocId を含む splitPdf invocation を検索
# query 例:
#   resource.type="cloud_function"
#   jsonPayload.operation="splitPdf"
#   jsonPayload.newDocId="<orphan-path から抽出した docId>"
# → invocation の入力 documentId が parentDocumentId
```

その後の手順:

1. Cloud Logging で orphan path 中の docId に対する `splitPdf` invocation を検索 → 入力 `documentId` を取得 (これが parentDocumentId)
2. Firestore で parent doc が存在し元 PDF (`original/...` または親 fileUrl) も実在することを確認 (`inspect-document.js <parentDocumentId>`)
3. 分割 UI から手動で再分割実行 → 新 docId で `processed/{newDocId}/...` に新規 save される (旧 path の docId とは別になる)
4. 古い孤児 path は削除 (Phase 3、個別パス認可必須)

**Cloud Logging で parent を特定できない場合** (ログ保持期間超過等): Storage `original/` prefix の手動 inspection または Gmail message id 逆引きが必要。復元不能の場合は孤児 path 単純削除を選択 (Phase 3)。

---

## 予防

| 対策 | 状態 |
|---|---|
| PR-A safety net (rotate/delete 巻き添え破壊防止) | ✅ 全環境展開済 (#434) |
| PR-B docId namespace (新規衝突原理ゼロ化) | ✅ 全環境展開済 (#435) |
| PR-D reverse orphan 検出 (audit-storage-mismatch.js) | ✅ PR #436 |
| Cloud Monitoring alert policy (`cleanupResult=failed`) | 別 PR 候補 (Issue #432 follow-up) |
| audit-storage-mismatch.js の定期 (cron) 実行 | 別 PR 候補 (Issue #432 follow-up) |

> **NOTE**: 上記表は 2026-05-11 時点。Issue #432 PR-A/PR-B/PR-D 完了状態。状況更新は本 runbook を直接編集すること。

---

## PR-C 衝突 doc / orphan の信頼度付き 5 分類 migration (Issue #432 PR-C)

過去被害 (kanameone 39 衝突 group + 4 fileUrl 孤児 = silent breakage 90+ docs) の復旧手順。Codex セカンドオピニオン反映後の 5 分類アルゴリズム (`MatchedByHash` / `Ambiguous` / `RepairableMissingFile` / `LostOrUnrecoverable`、LikelyWinner は Ambiguous 内 suggestedWinner hint に降格)。

### 前提

- `audit-storage-mismatch.js` で被害が検出済 (衝突 group / fileUrl 孤児)
- runbook §Phase 1〜3 で個別対応する量を超え、bulk migration が妥当と判断済
- **freeze window (推奨)**: migration 実行中は対象環境の UI 操作 (分割 / 回転 / 削除) を停止する。進行中 splitPdf invocation との race を precondition gate で skip するが、freeze window で race 数を最小化
- **PR-C2 で fingerprint algorithm 切替**: PR-C1 (sha256 raw bytes 比較) は pdf-lib の cross-process non-determinism により MatchedByHash が成立しないことが dev fixture で発覚 (session59 教訓)。**PR-C2 以降は `pdf-page-visual-v1` fingerprint 比較を使用**。実装: `scripts/lib/pdfPageVisualFingerprint.ts`。

### fingerprint algorithm: pdf-page-visual-v1

各 PDF ページの「描画同一性」を以下の構成要素で sha256 化:
1. 各ページの **decoded Contents bytes** (正規化禁止 — whitespace / operator 順 / inline image data を保持)
2. 各ページの **geometry**: MediaBox / CropBox / Rotate
3. 各ページが参照する **Resources subtree**: Font / XObject / ExtGState / ColorSpace / Pattern / Shading / ProcSet を canonical digest (entries を name 文字列 sort)

> **cross-process deterministic**: 別 Node プロセスで生成した PDF と同プロセス生成 PDF が同 fingerprint を返す (functions/test/pdfPageVisualFingerprint.test.ts で cross-process spawn 検証)。pdf-lib `PDFDocument.save()` のプロセス間 random `/ID` を吸収する設計。

### 5 分類と自動 action 一覧

| 分類 | 判定条件 | recommendedAction | 自動実行可否 |
|---|---|---|---|
| **MatchedByHash** | fingerprint(Storage 実体, pdf-page-visual-v1) == fingerprint(parent + splitFromPages から再生成した期待 PDF) かつ group 内一意 | migrate-to-namespace | ✅ 自動 |
| **RepairableMissingFile** | parent + splitFromPages + 親 PDF 全て実在 | regenerate-from-parent | ✅ 自動 (敗者 doc / orphan 共通) |
| **Ambiguous** | fingerprint 不能 / 不一致 / 複数一致 / unsupported-pdf-feature (LikelyWinner suggestedWinner hint 含む) | manual-review | ❌ 自動禁止 |
| **LostOrUnrecoverable** | parent doc 不在 / splitFromPages 不在 / 親 PDF 不在 | mark-error | ✅ status:'error' のみ自動 (Storage 操作なし) |

> **重要 (Codex Critical 反映)**: `rotatedAt!=null 唯一` による LikelyWinner は「離脱可能性」の手がかりに過ぎず Storage 実体の正当性証明ではない。自動 destructive action は禁止。Ambiguous の suggestedWinner hint として operator に提示する。

### Ambiguous reason 細分化 (Codex Suggestion 反映)

operator が manual-review 時に対処方針を即特定できるよう、Ambiguous の `reason` フィールドは以下 5 サブカテゴリ prefix で返す:

| reason prefix | 意味 | operator 対処 |
|---|---|---|
| `content-mismatch` | fingerprint(actual storage) != fingerprint(regenerated) | parent から再生成した PDF と実体が描画的に異なる。operator が中身を比較し、勝者判定 → 手動 migrate or status='error' |
| `multiple-fingerprint-matches` | 複数 doc が同 fingerprint (希少) | どの docId に紐付けるべきか operator が業務文脈で判定 |
| `unsupported-pdf-feature` | encryption / acroform / optional-content / malformed / **annotations** (Codex Critical 反映) / **unsupported-resource-filter** (Codex Important 反映: DCTDecode/JPXDecode 等の画像 filter) | PDF 構造が自動 fingerprint 対象外。手動でファイル内容を確認し復旧可否判定。スキャン PDF (JPEG XObject 多用) は `unsupported-resource-filter` で大半が Ambiguous に倒れる可能性あり |
| `hash-unavailable-transient` | download 一時エラー (503/403) | 数分後に再 classify、解消すれば再分類 |
| `hash-unavailable-no-parent` | parent doc / 親 PDF / splitFromPages のいずれかが不在 | LostOrUnrecoverable 寄り。parent doc 復元できれば再分類 |

### Step 1: dev 環境で execute path を全分類検証 (本番前必須)

cocoro/kanameone は被害ゼロ or 本番のため、`execute` path は dev fixture で先行検証する。

```bash
# dev 環境に 5 分類 fixture を投入 (idempotent、安全策で projectId に "dev" 含むか確認)
./scripts/switch-client.sh dev
FIREBASE_PROJECT_ID=doc-split-dev STORAGE_BUCKET=doc-split-dev.firebasestorage.app \
  npx ts-node scripts/setup-collision-fixture.ts

# fixture cleanup (検証完了後)
FIREBASE_PROJECT_ID=doc-split-dev STORAGE_BUCKET=doc-split-dev.firebasestorage.app \
  npx ts-node scripts/setup-collision-fixture.ts --cleanup
```

### Step 2: classify (read-only) で migration plan JSON 出力

```bash
# 対象環境に切替
./scripts/switch-client.sh <env>

# classify 実行 (Firestore/Storage 書き込みゼロ、JSON レポート出力)
FIREBASE_PROJECT_ID=<project-id> STORAGE_BUCKET=<bucket> \
  npx ts-node scripts/classify-collision-docs.ts \
    --prefix processed/ --out plan-$(date +%Y%m%d-%H%M%S).json
```

出力 JSON 構造:

```json
{
  "planId": "plan-2026-05-11T...",
  "createdAt": "...",
  "environment": "...",
  "projectId": "docsplit-kanameone",
  "bucket": "docsplit-kanameone.firebasestorage.app",
  "prefix": "processed/",
  "hashAlgorithm": "pdf-page-visual-v1",
  "summary": {
    "totalGroups": 39,
    "totalCollisionDocs": 90,
    "totalOrphans": 4,
    "byClassification": { "MatchedByHash": ..., "Ambiguous": ..., ... },
    "byAction": { "migrate-to-namespace": ..., ... }
  },
  "operations": [
    {
      "operationId": "op-0001",
      "docId": "...",
      "classification": "MatchedByHash",
      "recommendedAction": "migrate-to-namespace",
      "expectedCurrentFileUrl": "gs://bucket/processed/old-name.pdf",
      "expectedStatus": "processed",
      "expectedUpdatedAt": "...",
      "sourcePath": "processed/old-name.pdf",
      "destPath": "processed/<docId>/old-name.pdf",
      ...
    }
  ]
}
```

### Step 3: ユーザーへ提示 → 番号認可 (per-operation + per-path)

Step 2 で出力された plan JSON 内容と各 operation の sourcePath/destPath を operator に提示し、**operationId と path を文字列単位で含む承認**を取得する。

承認は別 JSON ファイルとして保存:

```json
{
  "planId": "plan-2026-05-11T...",
  "approvedOperationIds": [
    "op-0001",
    "op-0002"
  ],
  "approvedPaths": [
    "gs://docsplit-kanameone.firebasestorage.app/processed/old-name-1.pdf",
    "gs://docsplit-kanameone.firebasestorage.app/processed/<docId>/old-name-1.pdf"
  ]
}
```

**6 重 gate (Codex セカンドオピニオン反映 + PR-C2 fingerprint version gate)**:

1. `approval.planId === plan.planId` (古い plan の流用防止)
2. `operation.operationId ∈ approvedOperationIds` (operation 単位の認可)
3. destructive action は `sourcePath / destPath ∈ approvedPaths` (per-path 文字列認可、ADR-0008 教訓)
4. runtime env (`FIREBASE_PROJECT_ID + STORAGE_BUCKET`) が plan の `projectId / bucket` と一致 (環境取り違え防止)
5. precondition snapshot (`expectedCurrentFileUrl + expectedStatus + expectedUpdatedAt`) が現状 doc と一致 (進行中 splitPdf invocation との race 検出 → skip)
6. **`plan.hashAlgorithm === HASH_ALGORITHM` (PR-C2 追加 AC13)**: plan 作成時の fingerprint algorithm version と execute 側コード固定値が一致 (pdf-lib upgrade 等で algorithm が変わった古い plan を新コードで実行することを防ぐ)。PR-C1 plan (`hashAlgorithm` フィールドなし) は新 execute で gate reject される。**対応**: 古い plan を捨てて `classify-collision-docs.ts` を再実行し、新しい plan を生成すること
7. **`plan.pdfLibVersion === expectedPdfLibVersion` (PR-C2 Codex Important 反映 AC13 拡張)**: plan 作成時の pdf-lib npm version と execute 側 runtime の pdf-lib version が一致。algorithm 名は同じでも pdf-lib internal API 挙動 (decodePDFRawStream/PDFPageLeaf 等) が変わるとfingerprint 計算結果が変わるため、依存更新ごとに再 classify を要求する

> **禁止**: `Issue #432 全件OK` / `processed/ 配下OK` 等の prefix / 包括認可は execute script 側で reject (ADR-0008 教訓)。

### Step 4: dry-run で執行計画確認

```bash
FIREBASE_PROJECT_ID=<project-id> STORAGE_BUCKET=<bucket> \
  npx ts-node scripts/execute-collision-migration.ts \
    --plan plan-XXX.json --approval approval-XXX.json
# (--execute なし = dry-run)
```

期待出力:
- 全 gate 通過 operation: `📋 op-XXXX` (would execute)
- gate 落ち: `🚫 op-XXXX` (gate-rejected)
- precondition mismatch: `⏭️ op-XXXX` (skipped)

### Step 5: 番号認可後 execute

```bash
FIREBASE_PROJECT_ID=<project-id> STORAGE_BUCKET=<bucket> \
  npx ts-node scripts/execute-collision-migration.ts \
    --plan plan-XXX.json --approval approval-XXX.json --execute

# 段階実行 (operation 単位):
FIREBASE_PROJECT_ID=<project-id> STORAGE_BUCKET=<bucket> \
  npx ts-node scripts/execute-collision-migration.ts \
    --plan plan-XXX.json --approval approval-XXX.json --execute \
    --operations op-0001,op-0002
```

### Step 6: 中断時の再実行 (idempotency)

migration 中断 (network error / kill / etc) 後の再実行は同じ plan + approval で安全:

- migrate / regenerate: 新 path 存在 + Firestore fileUrl 更新済 → skip (`already migrated (idempotent)`)
- mark-error: 既に status='error' でも再 update (副作用なし)

precondition mismatch (race condition の検出) は skip + warning。再 classify で plan を作り直すか、operator が個別判断。

### Step 7: post-audit で復旧確認

```bash
FIREBASE_PROJECT_ID=<project-id> STORAGE_BUCKET=<bucket> \
  node scripts/audit-storage-mismatch.js
```

期待: `fileName collisions: 0 groups` / `fileUrl orphans: 0` (migration 対象として処理されたもの全て)。Ambiguous 分類で manual-review 状態のものは継続して衝突 group に表示される (operator が個別対応)。

### PR-C migration スコープ外

以下は本 migration では扱わない (別 PR / 手動対応):

- 旧 `processed/{fileName}` 形式 → `processed/{docId}/{fileName}` の **被害なし docs** の一斉移行 (5640+ docs、本 migration は被害復旧限定)
- `generateFileName` の timestamp 引数完全削除 (handoff session57 別 PR)
- Cloud Monitoring alert (`cleanupResult=failed`) (handoff follow-up)
- audit-storage-mismatch.js の cron 自動化 (handoff follow-up)

---

## 関連リソース

- Issue #432 (P0 設計バグ)
- ADR-0008 (本番データ保護)
- `scripts/audit-storage-mismatch.js` (検出 script)
- `scripts/inspect-document.js` (調査 script, read-only)
- `scripts/classify-collision-docs.ts` (PR-C: 5 分類 plan 出力)
- `scripts/execute-collision-migration.ts` (PR-C: 4 重 gate + idempotent migration)
- `scripts/setup-collision-fixture.ts` (PR-C: dev 環境 fixture)
- `scripts/lib/collisionClassifier.ts` (PR-C: 5 分類 pure function)
- `scripts/lib/pdfRegenerator.ts` (PR-C: parent から PDF 再生成)
- `scripts/lib/storageGuard.ts` (PR-C: 削除安全性判定 helper)
- `functions/src/storage/storageDeletionGuard.ts` (PR-A safety net、Functions 用)
- `functions/src/pdf/pdfOperations.ts` (PR-B docId namespace + 補償処理)
