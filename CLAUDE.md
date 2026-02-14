# DocSplit - 書類管理ビューアーアプリ

## プロジェクト概要
Gmailの添付ファイルを自動取得し、AI OCRでメタ情報を抽出、検索・グルーピング・閲覧が可能な書類管理ビューアー。Phase 8完了 + 追加実装（CI/CD、PWA、テナント自動化等）。

## 環境情報

**マルチクライアント運用**: 複数環境対応。現在のGCP設定は `switch-client.sh` で切替可能

| 項目 | 値 |
|------|-----|
| GCPプロジェクト | `doc-split-dev` (開発環境の参照値) |
| リージョン | `asia-northeast1` |
| 本番URL | `https://doc-split-dev.web.app` |
| ドキュメント | `https://yasushi-honda.github.io/doc-split/` |

## ドキュメント参照

開発時は `docs/context/`（マスター）を参照。`docs/直下`はGitHub Pages用の簡略版。

必要に応じて読むべきドキュメント:
- [データモデル](docs/context/data-model.md)（Firestoreスキーマ）
- [納品・アップデート運用](docs/context/delivery-and-update-guide.md) ★運用時必読
- [エラーハンドリング](docs/context/error-handling-policy.md)
- [ビジネスロジック](docs/context/business-logic.md)
- [ADR](docs/adr/)

## 開発コマンド

### マルチクライアント環境切替
```bash
./scripts/switch-client.sh <client-name>  # 環境切替（dev/kanameone/cocoro）
./scripts/switch-client.sh --list         # 利用可能なクライアント一覧
```

### ビルド・テスト
```bash
cd frontend && npm run dev      # フロントエンド開発サーバー
cd frontend && npm test          # フロントエンドテスト
cd functions && npm test         # Functions単体テスト
cd functions && npm run test:rules  # Firestoreルールテスト
npm run build                    # 全体ビルド
```

### デプロイ

**IMPORTANT**: マルチ環境デプロイ時は必ずスクリプトを使用。手動`firebase deploy`は`.env.local`の設定で誤った環境にデプロイされる危険がある。

```bash
./scripts/deploy-to-project.sh <alias>          # Hostingのみ
./scripts/deploy-to-project.sh <alias> --rules   # Hosting + ルール（スキーマ変更時）
./scripts/deploy-to-project.sh <alias> --full    # 全コンポーネント
./scripts/deploy-all-clients.sh [--rules|--full] [--dry-run]  # 全クライアント一括デプロイ
firebase deploy --only functions -P <alias>      # Functionsのみ（直接実行OK）
```

| 変更内容 | コマンド |
|---------|---------|
| フロントエンドのみ | `deploy-to-project.sh <alias>` |
| Firestoreスキーマ変更 | `deploy-to-project.sh <alias> --rules` |
| Functions変更 | `deploy-to-project.sh <alias> --full` |
| 全クライアント一括 | `deploy-all-clients.sh [--rules\|--full]` |

### クライアント環境セットアップ

**推奨フロー**: クライアント側でGCPプロジェクト作成 → Claude Codeで自動納品

**Step 1 (クライアント側・約5分)**:
```bash
# Mac: client-setup-gcp.command をダブルクリック
# Linux: ./scripts/client-setup-gcp.sh
# Windows: client-setup-gcp.bat をダブルクリック
```

**Step 2 (開発者側・約10分)**:
1. GitHub Pages納品フォーム: https://yasushi-honda.github.io/doc-split/#/claude-code-delivery
2. プロジェクトID + 管理者メールを入力 → プロンプト生成
3. Claude Codeに貼り付け → 自動実行

**手動実行（スクリプト直接実行時）**:
```bash
./scripts/setup-tenant.sh <project-id> <admin-email> --with-gmail  # 推奨
./scripts/setup-tenant.sh <project-id> <admin-email> --with-gmail --client-id=X --client-secret=Y --auth-code=Z --yes  # CI用
```

詳細:
- [Claude Code自動納品](https://yasushi-honda.github.io/doc-split/#/claude-code-delivery)（GitHub Pages）
- [クライアント向けガイド](https://yasushi-honda.github.io/doc-split/client/)（GitHub Pages）
- [納品・アップデート運用](docs/context/delivery-and-update-guide.md)（リポジトリ内）

### マスターデータ
```bash
FIREBASE_PROJECT_ID=<project-id> node scripts/import-masters.js --all scripts/samples/
```

**IMPORTANT**: マスターデータのコレクションパス:
- `masters/customers/items`（顧客）
- `masters/documents/items`（書類種別。documentTypesではない）
- `masters/offices/items`（事業所）
- `masters/caremanagers/items`（ケアマネ。小文字）

## 危険な操作の禁止事項

### Firestoreデータ削除（ADR-0008）
**YOU MUST NEVER** 以下を実行してはいけない:
```bash
firebase firestore:delete --all-collections   # 絶対禁止
firebase firestore:delete / --recursive        # 絶対禁止
```
許可される削除: `firebase firestore:delete documents --recursive -P <alias>`（特定コレクションのみ）

**教訓**: 本番で`--all-collections`誤実行→全データ喪失、復元不可能（2026-01-30）

### .env.local の優先順位
Viteは`.env.local`を最優先で読み込む。デプロイスクリプトは自動で正しい設定に切り替えるが、手動デプロイ時は注意。

### 本番環境へのサンプルデータ投入禁止
本番セットアップ時はマスターデータなしで開始。クライアントから実CSVを受領してから投入。
