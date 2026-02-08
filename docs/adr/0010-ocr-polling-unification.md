# ADR-0010: OCR処理のポーリング一本化とリトライ耐性強化

## ステータス
Accepted

## 日付
2026-02-08

## コンテキスト
モバイルからのPDFアップロード時、VertexAI Gemini APIの429（RESOURCE_EXHAUSTED）エラーが発生し、ドキュメントが`status: error`のまま永久にスタックする障害が発生した。

### 根本原因
1. **processOCROnCreate（Firestoreトリガー）**: ドキュメント作成時に即座にOCR処理を開始。Cloud Functionsインスタンスごとに独立したインメモリ・レートリミッターを持つため、複数インスタンス起動時にレート制限が効かない。
2. **handleProcessingError**: すべてのエラーで`status: error`に設定。transientエラー（429、timeout等）と致命的エラーを区別せず、リトライの仕組みがなかった。
3. **processOCR（ポーリング）**: `status: pending`のみをクエリするため、`status: error`になったドキュメントは二度と処理されない。
4. **processing状態のスタック**: Functionタイムアウト等で`status: processing`のまま放置されるドキュメントの救済機構がなかった。

## 決定事項

### 1. processOCROnCreate の廃止
- `index.ts`からのエクスポートを削除（`firebase deploy --only functions`で自動削除）
- ファイル自体はロールバック用に保持（`processOCROnCreate.ts`）
- OCR処理のエントリーポイントをprocessOCR（Cloud Scheduler、1分間隔）に一本化

### 2. transientエラーの自動リトライ
`handleProcessingError`を改修:
- transientエラー（429, timeout, RESOURCE_EXHAUSTED等）かつ`retryCount < 3` → `status: pending`に戻す
- transientエラーかつ`retryCount >= 3` → `status: error`（上限到達）
- 非transientエラー → 即座に`status: error`
- `retryCount`はFirestore transactionで排他的に管理

### 3. processing状態のスタック救済
`processOCR`にスタック救済ロジックを追加:
- `updatedAt`が10分以上前の`status: processing`ドキュメントを検出
- `status: pending`に戻し、`retryCount`をインクリメント
- ポーリング実行のたびに（pending処理前に）チェック

### 4. fix-stuck-documents.js の拡張
- `--include-errors`オプションを追加（`status: error`のドキュメントも対象に）
- リセット時に`retryCount: 0`に初期化

## ステータス遷移図
```
pending → processing → processed         (正常フロー)
pending → processing → pending           (transientエラー、自動リトライ)
pending → processing → error             (致命的エラーまたはリトライ上限)
processing → pending                      (スタック救済: 10分超過時)
error → pending                           (管理者操作: fix-stuck-documents.js)
```

## Consequences

### Pros
- transientエラー時の自動復旧でユーザー影響を最小化
- ポーリング一本化でレートリミッターが確実に機能
- processing状態のスタックが自動で解消
- retryCount上限でAPI無限消費を防止

### Cons
- OCR処理開始まで最大1分の遅延（ポーリング間隔）
- processOCROnCreate廃止によりリアルタイム性が低下

## Alternatives Considered

### 案B: processOCROnCreate にリトライロジックを追加
- レートリミッターがインスタンスごとに独立する問題は解消されない
- 2つのエントリーポイントの並存による複雑性が残る
- 不採用

### 案C: processOCROnCreate のレートリミッターをFirestore/Redis等の共有ストレージに移行
- 実装コストが高い
- ポーリング一本化の方がシンプルで保守性が高い
- 不採用

## References
- 障害発生: 2026-02-08 dev環境モバイルPDFアップロード時
- 影響ドキュメント: `cNRewnHaYNgsBh7Qi1Fz`（R5【配布】引き渡し訓練について_2.pdf）
- 関連ユーティリティ: `functions/src/utils/retry.ts`（isTransientError）
- 運用スクリプト: `scripts/fix-stuck-documents.js`
