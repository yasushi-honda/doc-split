# DocSplit - 書類管理ビューアーアプリ

## プロジェクト概要
Gmailの添付ファイルを自動取得し、AI OCRでメタ情報を抽出、検索・グルーピング・閲覧が可能な書類管理ビューアー。Phase 8完了 + 追加実装（CI/CD、PWA、テナント自動化等）。

## 環境情報

**マルチクライアント運用**: 複数環境対応。現在のGCP設定は `switch-client.sh` で切替可能

| 環境 | 用途 | 実運用データ |
|------|------|-------------|
| **dev** (`doc-split-dev`) | 開発・テスト専用。ビルド確認やテストデータでの動作検証に使用 | なし |
| **クライアント環境** (kanameone/cocoro等) | 顧客の本番運用環境。Gmail連携・OCR処理が稼働中 | あり |

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

**デプロイ手順は `/deploy` スキルを使用。** 環境別の認証差異・手順・後片付けが含まれる。
```bash
# 使用例: /deploy kanameone --rules
```

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

### 運用スクリプト

**推奨: GitHub Actions経由で実行**（ADC不要）。Actions → "Run Operations Script" → 環境とスクリプトを選択して実行。
SA: `docsplit-cloud-build@docsplit-cocoro.iam.gserviceaccount.com`（全3環境に`roles/datastore.user`付与済み）

```bash
# GitHub Actions (推奨): https://github.com/yasushi-honda/doc-split/actions/workflows/run-ops-script.yml

# ローカル実行（ADC認証が必要な場合）:
# gcloud auth application-default login → hy.unimail.11@gmail.com で全環境対応可
# 実行後: gcloud auth application-default revoke

# error状態ドキュメントをpendingにリセット（再処理）
FIREBASE_PROJECT_ID=<project-id> node scripts/fix-stuck-documents.js --include-errors --dry-run  # 確認
FIREBASE_PROJECT_ID=<project-id> node scripts/fix-stuck-documents.js --include-errors            # 実行

# processing状態でスタックしたドキュメントのみリセット（errorは除外）
FIREBASE_PROJECT_ID=<project-id> node scripts/fix-stuck-documents.js

# マスターデータ健全性チェック・修正
FIREBASE_PROJECT_ID=<project-id> node scripts/check-master-data.js            # dry-run
FIREBASE_PROJECT_ID=<project-id> node scripts/check-master-data.js --fix      # 修正実行

# displayFileName一括設定
FIREBASE_PROJECT_ID=<project-id> node scripts/backfill-display-filename.js --dry-run  # プレビュー
FIREBASE_PROJECT_ID=<project-id> node scripts/backfill-display-filename.js             # 実行
FIREBASE_PROJECT_ID=<project-id> node scripts/backfill-display-filename.js --force     # 既存値も上書き
```

### マスターデータ
```bash
FIREBASE_PROJECT_ID=<project-id> node scripts/import-masters.js --all scripts/samples/
```

**IMPORTANT**: マスターデータのコレクションパス:
- `masters/customers/items`（顧客）
- `masters/documents/items`（書類種別。documentTypesではない）
- `masters/offices/items`（事業所）
- `masters/caremanagers/items`（ケアマネ。小文字）

## 派生フィールド追加時の注意（#178教訓）

新しいフィールドを追加したら、以下を **すべて** 確認すること（3回連続で漏れが発生した実績あり）:

1. **`firestoreToDocument()`のマッピング**（`frontend/src/hooks/useDocuments.ts`）← 最優先。ここが抜けるとFEで読めない
2. 書き込みパス（生成・更新する箇所）
3. **`getReprocessClearFields()`に`deleteField()`追加**（同ファイル）← 再処理時に古い値が残存する
4. 型定義（`shared/types.ts`）との整合性

## 危険な操作の禁止事項

### Firestoreデータ削除（ADR-0008）
**YOU MUST NEVER** 以下を実行してはいけない:
```bash
firebase firestore:delete --all-collections   # 絶対禁止
firebase firestore:delete / --recursive        # 絶対禁止
```
許可される削除: `firebase firestore:delete documents --recursive -P <alias>`（特定コレクションのみ）

**教訓**: 本番で`--all-collections`誤実行→全データ喪失、復元不可能（2026-01-30）

### Storage バケット名（ADR-0008教訓の延長）
**YOU MUST NEVER** バケット名をプロジェクトIDから推測してはいけない。`.appspot.com`と`.firebasestorage.app`の2形式が混在しており、間違えると全ファイルアクセス不能になる。正解は `scripts/clients/<client>.env` の `STORAGE_BUCKET` を参照。

### .env.local の優先順位
Viteは`.env.local`を最優先で読み込む。デプロイスクリプトは自動で正しい設定に切り替えるが、手動デプロイ時は注意。

### 本番環境へのサンプルデータ投入禁止
本番セットアップ時はマスターデータなしで開始。クライアントから実CSVを受領してから投入。
