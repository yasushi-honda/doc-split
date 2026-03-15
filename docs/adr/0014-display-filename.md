# ADR-0014: メタ情報に基づく表示ファイル名の自動生成（displayFileName）

## ステータス

Accepted

## コンテキスト

現在、ドキュメントの `fileName` はアップロード時の元ファイル名がそのまま使われている。OCRや手動編集でメタ情報（書類種別、顧客名、事業所名、日付）が確定してもファイル名には反映されず、ユーザーにとって識別しづらい。

一方、`generateOptimalFileName()`（命名ルール: 書類名_事業所_日付_顧客名）は既に実装済みだが未活用。

## 決定

`fileName` は原本由来の安定値として維持し、新たに `displayFileName` をサーバー管理の派生値として追加する。

### フィールド責務の分離

| フィールド | 責務 | 更新者 | 変更頻度 |
|-----------|------|--------|---------|
| `fileName` | 原本由来の安定値。検索・OCR補助に継続使用 | アップロード時のみ | 不変 |
| `displayFileName` | 表示・DL名。メタ情報から自動生成 | Cloud Functions のみ | メタ情報変更時 |
| `storagePath` | Storageファイル参照（実質ID） | アップロード時のみ | 不変 |

### 重要な制約

- `fileName` は一切変更しない（検索・OCR補助への副作用を防止）
- `displayFileName` はユーザー直接編集不可（Firestoreルールで制御）
- 再生成はCloud Functions側に一本化（命名ルールの単一責任点）
- 未設定時は `fileName` にフォールバック（既存データ互換）

### 再生成の発火タイミング

| タイミング | トリガー | 利用可能な情報 |
|-----------|---------|---------------|
| OCR完了時 | processOCR内 | documentType, customerName, officeName, fileDate 全て揃う |
| PDF分割時 | splitPdf内 | セグメントのメタ情報から生成 |
| メタ編集時 | onDocumentWriteトリガー | 変更後のメタ情報 |

### 並行更新の優先順位

手動編集 > OCR再処理（手動確定後にOCRで上書きしない）

### 段階的導入

| Stage | 内容 | リスク | ロールバック |
|-------|------|--------|-------------|
| 0 | 型定義追加 + UIフォールバック表示 | ゼロ | ヘルパー関数を戻すだけ |
| 1 | OCR完了時に自動生成 | 低 | 設定行を削除 |
| 2 | PDF分割時に自動生成 | 低 | 設定行を削除 |
| 3 | メタ編集時の再生成 | 中 | 再生成ロジックを削除 |
| 4 | 既存データのバックフィル | 中 | FieldValue.delete()で一括削除 |

全Stage、fileNameは不変のため安全にロールバック可能。

### トリガー連鎖への影響

- `displayFileName` はグループキーではないため `onDocumentWrite`（集計）に影響なし
- `displayFileName` は現在の検索インデックス対象外のため `onDocumentWriteSearchIndex` に影響なし
- 再帰防止: displayFileName自体の変更は再生成をトリガーしない

## 根拠

- Storage側を一切変更しないため、参照整合性・並行処理のリスクがない
- fileNameの既存責務（検索・OCR補助）を維持しつつ、表示品質を向上できる
- 段階的導入により、各Stageで動作確認・ロールバックが可能

## 影響

- `shared/types.ts`: Document型に `displayFileName` 追加
- `firestore.rules`: displayFileName はユーザー編集不可
- Functions: processOCR, splitPdf, onDocumentWrite に生成ロジック追加
- Frontend: 表示箇所を `displayFileName ?? fileName` に切り替え
