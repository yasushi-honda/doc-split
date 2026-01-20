# ADR 0005: マルチクライアントデプロイ方式

## Status

Accepted

## Context

DocSplitを複数のクライアントに納品・運用する必要がある。以下の要件を満たす方式を検討した：

- クライアント数: 2社（将来追加の可能性あり）
- 各クライアントのデータは完全に独立
- 課金は各クライアントが負担
- アップデートは開発者が一括管理
- 運用コストを最小化

## Decision

**セットアップスクリプト方式（雛形なし）** を採用する。

### 採用した構成

```
[doc-split-dev]          [client-a]          [client-b]
  開発・検証        →      本番A        →      本番B
  (SEEDあり)             (SEEDなし)          (SEEDなし)
```

### .firebaserc

```json
{
  "projects": {
    "dev": "doc-split-dev",
    "client-a": "<client-a-project-id>",
    "client-b": "<client-b-project-id>"
  }
}
```

### 運用フロー

1. **初期納品**: クライアントGCP作成 → `setup-tenant.sh` 実行 → マスターデータ投入
2. **アップデート**: dev で検証 → `firebase deploy -P client-a` → `-P client-b`
3. **新規追加**: `setup-tenant.sh` → `.firebaserc`に追加

## Alternatives Considered

### 1. 雛形プロジェクト方式

```
[doc-split-dev] → [doc-split-template] → [client-a] → [client-b]
```

**不採用理由**:
- 管理対象が増える
- 雛形にデプロイする必要がない（コードはGitHubで管理）
- セットアップスクリプトで代替可能

### 2. 単一プロジェクトマルチテナント

```
[doc-split-prod]
  ├── tenant-a/
  └── tenant-b/
```

**不採用理由**:
- クライアント間のデータ分離が複雑
- 課金の分離が困難
- クライアント独立性が損なわれる

### 3. Terraform/IaC方式

**不採用理由**:
- クライアント2社に対してオーバーエンジニアリング
- 学習・維持コストが高い
- Firebase/GCPのセットアップスクリプトで十分

### 4. CI/CD自動デプロイ（全環境）

**不採用理由**:
- 本番環境への自動デプロイはリスクが高い
- 2社なら手動デプロイで十分
- 開発環境のみCI/CD自動化で十分

## Consequences

### Positive

- **シンプル**: 最小構成で管理しやすい
- **コスト効率**: 余計なプロジェクト管理が不要
- **スケーラブル**: 新規クライアント追加が容易
- **独立性**: 各クライアントが自社GCPを所有
- **柔軟性**: クライアント固有のカスタマイズが可能

### Negative

- **手動デプロイの手間**: クライアント増加時はスクリプト化を検討
- **一貫性リスク**: 各クライアント環境の差異に注意が必要

### Mitigation

- デプロイ手順を明文化（`docs/context/delivery-and-update-guide.md`）
- クライアント増加時（5社以上）はデプロイスクリプトを導入

## References

- `docs/context/delivery-and-update-guide.md` - 納品・アップデート運用ガイド
- `scripts/setup-tenant.sh` - セットアップスクリプト
- `.firebaserc` - Firebaseプロジェクトエイリアス
