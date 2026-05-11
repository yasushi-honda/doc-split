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

## 関連リソース

- Issue #432 (P0 設計バグ)
- ADR-0008 (本番データ保護)
- `scripts/audit-storage-mismatch.js` (検出 script)
- `scripts/inspect-document.js` (調査 script, read-only)
- `functions/src/storage/storageDeletionGuard.ts` (PR-A safety net)
- `functions/src/pdf/pdfOperations.ts` (PR-B docId namespace + 補償処理)
