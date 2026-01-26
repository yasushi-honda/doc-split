# ADR-0006: 検索機能の実装方式

## Status
Accepted

## Date
2026-01-26

## Context

DocSplitアプリケーションに検索機能を追加する必要がある。検索対象は主にメタデータ（顧客名、事業所名、書類種別、日付、ファイル名）。

### 検討した選択肢

| 方式 | 実装工数 | 月額コスト | 精度 |
|------|---------|----------|------|
| A. 自前n-gramインデックス | 5-7日 | ~500円 | 中 |
| B. Algolia/Meilisearch | 2-3日 | $35+/月 | 高 |
| C. クライアントサイドのみ | 1日 | 0円 | 低 |

### 制約条件
- 月額コスト上限: 3,000円
- 日本語（漢字・ひらがな）対応必須
- Firestoreとの統合

## Decision

**方式A: 自前n-gram反転インデックス**を採用。

### 設計
1. **トークナイザー**: bi-gram + スペース区切りキーワード + 日付形式
2. **インデックス構造**: 反転インデックス（トークン→docIdリスト）
3. **スコアリング**: IDF（Inverse Document Frequency）+ フィールド重み付け
4. **更新方式**: Firestoreトリガーで自動更新

### フィールド重み
| フィールド | 重み |
|-----------|------|
| customerName | 3 |
| officeName | 2 |
| documentType | 2 |
| fileDate | 2 |
| fileName | 1 |

### Firestoreスキーマ
```
/search_index/{tokenId}
  - token: string
  - documents: [{ docId, weight, fields }]
  - documentCount: number
```

## Consequences

### メリット
- コスト制約に適合（追加の外部サービス不要）
- 既存の`textNormalizer.ts`、`similarity.ts`を活用可能
- Firestoreトリガーで自動同期、一貫性保証

### デメリット
- 全文検索サービスより精度が劣る可能性
- インデックス肥大化のリスク（トークン数に応じて）
- 検索性能はトークン数に依存

### リスク対策
- トークンハッシュによる冪等性保証（重複更新防止）
- インメモリキャッシュ（10分TTL）でFirestore読み取り削減
- マイグレーションスクリプトでdry-run対応

## References
- Codexアーキテクトレビュー（2026-01-26）
- `functions/src/utils/tokenizer.ts`
- `functions/src/search/searchDocuments.ts`
