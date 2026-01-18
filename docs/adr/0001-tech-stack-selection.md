# ADR-0001: 技術スタック選定

## Status
**Proposed** - 一部確定、一部要相談

## Context
AppSheetで構築された書類管理アプリをGCPでリプレイス開発する。
クライアントへのGCPプロジェクト移譲を前提とし、AppSheet/Workspace依存を排除する必要がある。

### 要件
- コスト最適化（従量課金優先）
- セキュリティ強化（個人情報保護）
- プロジェクト単位で完結（移譲可能）
- 日本リージョンでのデータ保持

## Decision

### 確定事項

| レイヤー | 選定 | 理由 |
|---------|------|------|
| OCRエンジン | **Vertex AI Gemini 2.5 Flash** | 高精度AI OCR、日本語対応 |
| OCRリージョン | **asia-northeast1** | データ国内保持要件 |
| 認証方式 | **Workload Identity** | APIキー不使用、セキュア |
| コンピュート | **Cloud Functions (2nd gen)** | サーバーレス、従量課金 |
| メッセージング | **Pub/Sub** | Gmail連携、非同期処理 |
| ログ | **Cloud Logging** | GCPネイティブ |
| 監視 | **Cloud Monitoring** | ヘルスチェック、アラート |

### 要相談事項

| レイヤー | 候補 | 現時点の方向性 | 決定基準 |
|---------|------|---------------|----------|
| データベース | Firestore / Cloud SQL | Firestore | クエリ要件の詳細確認後 |
| ストレージ | Cloud Storage / Firebase Storage | Cloud Storage | コストと統合性のバランス |
| フロントエンド | Cloud Run + React / 別ソリューション | 未定 | 管理UI要件の明確化後 |

## Consequences

### Pros
- **コスト最適化**: 全てサーバーレス/従量課金で固定費なし
- **移譲容易**: GCPプロジェクト単位で完結
- **セキュア**: Workload Identity、日本リージョン
- **スケーラブル**: 自動スケーリング

### Cons
- **Firestore制約**: 複雑な集計クエリに制限（要確認）
- **コールドスタート**: Cloud Functions初回起動の遅延
- **学習コスト**: Vertex AI Geminiの調整

## Alternatives Considered

### Cloud Vision API（OCR）
- メリット: 実績あり、安定
- 不採用理由: Geminiの方がAI OCRとして高精度、書類分類も同時に可能

### App Engine
- メリット: 常時起動、安定
- 不採用理由: コスト増、Cloud Functionsで十分

### Cloud SQL
- メリット: RDBの柔軟性
- 保留理由: 固定費発生、Firestoreで要件満たせるか確認後に再検討

## References
- `context/gcp-migration-scope.md`
- `context/business-logic.md`
