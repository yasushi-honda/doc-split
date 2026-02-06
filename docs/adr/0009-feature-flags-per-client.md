# ADR-0009: クライアント別オプション機能の管理方式

## Status
Accepted

## Context

クライアントごとに業務ロジック系のオプション機能（帳票出力、承認フロー等）の要望が出始めている。
以下の要件を満たす仕組みが必要：

- 基本機能は全クライアントに同一展開
- オプション機能は課金に応じてクライアント単位でON/OFF
- コードベースは1本を維持（クライアント別ブランチは作らない）
- 中央管理画面（Super Admin）からオプションを制御

## Decision

### 1. Feature Flags by Firestore設定

各クライアントの Firestore `settings/features` ドキュメントで機能のON/OFFを管理する。

```
settings/features
{
  "pdfSplit": true,           // 基本機能（全クライアントON）
  "approvalWorkflow": false,  // オプション（課金で有効化）
  "reportExport": false       // オプション（課金で有効化）
}
```

### 2. コード側の制御パターン

**フロントエンド**: `useSettings` フックで features を取得し、コンポーネントの表示/非表示を制御。

```typescript
const { features } = useSettings();
{features.reportExport && <ReportExportTab />}
```

**バックエンド（Functions）**: Callable Functions の冒頭で機能ガードを入れる。

```typescript
const features = await getFeatureFlags();
if (!features.reportExport) {
  throw new HttpsError('permission-denied', 'この機能は有効化されていません');
}
```

### 3. Super Admin（中央管理）

dev プロジェクト上に管理画面を設置。各クライアントの Firestore に Firebase Admin SDK で直接書き込む（方式A）。

- `.firebaserc` に登録済みの全クライアントを一覧表示
- クライアントごとにオプション機能のトグルスイッチ
- 変更は即座に対象クライアントの `settings/features` に反映

### 4. オプション機能の開発ルール

- オプション機能はクライアント固有ではなく、**汎用的に設計**する
- 他のクライアントにも展開可能な形で実装する
- Feature Flag 名は `settings/features` のフィールドとして追加
- `setup-tenant.sh` にデフォルト値（通常 false）を追加

### 5. 段階的な成熟

| フェーズ | 内容 |
|---------|------|
| 今 | 方針をADRに記録（本ドキュメント） |
| 最初のオプション要望時 | `settings/features` + useSettings拡張 + 機能ガードユーティリティ |
| 3機能目以降 | Super Admin UI を実装 |
| 10機能超 or 複雑化時 | ストラテジーパターンへの移行を検討 |

## Consequences

### Pros
- コードベースが1本で済み、`deploy-all-clients.sh` がそのまま使える
- オプション開発が資産として積み上がる（全クライアントに展開可能）
- 課金 → ON/OFF のビジネスモデルと直結
- 既存の `settings` コレクション・`useSettings` フックを拡張するだけで実装可能
- クライアント別ブランチの地獄を完全に回避

### Cons
- 無効化された機能のコードも全クライアントにデプロイされる（バンドルサイズ微増）
- Feature Flags が15個を超えると管理が複雑化する可能性
- Super Admin は dev プロジェクトに各クライアントへの書込権限が必要

## Alternatives Considered

### クライアント別ブランチ
main の更新を各ブランチにマージし続ける必要があり、クライアント数に比例してメンテコストが爆発する。不採用。

### 中央DB同期方式
中央DBに設定を保持し、各クライアントが定期的に読み取る方式。クロスプロジェクト読取の複雑さに対して、メリットが薄い。不採用。

### プラグイン/モジュールアーキテクチャ
Feature Flags が10個を超え、既存関数内の分岐が散らばり始めた場合の移行先として保留。現時点では過剰。

## References
- 関連ADR: `docs/adr/0005-multi-client-deployment.md`（マルチクライアント展開方式）
- 設定管理: `frontend/src/hooks/useSettings.ts`
- テナントセットアップ: `scripts/setup-tenant.sh`
