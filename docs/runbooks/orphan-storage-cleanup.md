# Orphan Storage Cleanup Runbook

**対象事象**: DocSplit プロジェクトで Storage 実体は存在するが Firestore document からの参照がない孤児ファイル (reverse orphan) の発見・対応手順。

**関連**: Issue #432 (PR-A safety net / PR-B docId namespace / PR-D 検出強化)

---

## 検出方法

### 1. Cloud Logging で発生時に検知

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
PR-B namespace pattern セクションは「PR-B 補償処理由来の可能性が高い候補」として hint 表示。

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
open /tmp/orphan.pdf
```

判定基準:
- **削除可**: 内容が他の processed/ doc と重複 / OCR 失敗時の不要 PDF
- **要復元**: 失われた業務データを含み、再分割の元 PDF も存在しない

### Phase 3: 削除実行 (number-authorized 必須)

ユーザーから **個別 path の番号認可** (`gs://bucket/processed/XXX/YYY を削除してよい`) 取得後:

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

元 PDF (`parentDocumentId` 起点) からの再分割を試行:

1. `parentDocumentId` を孤児 path 周辺から推測 (PR-B namespace pattern なら docId が path に含まれる)
2. Firestore で parent doc が存在し元 PDF (`original/...`) も実在することを確認
3. 分割 UI から手動で再分割実行 → 新 docId で `processed/{newDocId}/...` に新規 save される
4. 古い孤児 path は削除 (Phase 3)

---

## 予防

| 対策 | 状態 |
|---|---|
| PR-A safety net (rotate/delete 巻き添え破壊防止) | ✅ 全環境展開済 (#434) |
| PR-B docId namespace (新規衝突原理ゼロ化) | ✅ 全環境展開済 (#435) |
| PR-D reverse orphan 検出 (audit-storage-mismatch.js) | ✅ 本 PR |
| Cloud Monitoring alert policy (cleanupResult=failed) | 別 PR 候補 |
| audit-storage-mismatch.js の定期 (cron) 実行 | 別 PR 候補 |

---

## 関連リソース

- Issue #432 (P0 設計バグ)
- ADR-0008 (本番データ保護)
- `scripts/audit-storage-mismatch.js` (検出 script)
- `scripts/inspect-document.js` (調査 script, read-only)
- `functions/src/storage/storageDeletionGuard.ts` (PR-A safety net)
- `functions/src/pdf/pdfOperations.ts` (PR-B docId namespace + 補償処理)
