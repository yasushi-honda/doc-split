---
name: deploy
description: |
  Deploy DocSplit to target environment (dev/kanameone/cocoro).
  Each client has different auth and deploy procedures.
  Use when deploying frontend, functions, or rules to any environment.
disable-model-invocation: true
argument-hint: "<alias> [--rules|--full|--all]"
allowed-tools: Bash(./scripts/*), Bash(firebase *), Bash(gcloud *), Bash(npm *), Bash(cp *), Bash(rm *), Bash(cat *), Read, Glob, Grep
---

# DocSplit デプロイ手順

Deploy to: $ARGUMENTS

## デプロイ順序（MUST）

**dev → クライアント環境（kanameone/cocoro等）** の順で実施。
- dev: 実運用データなし → 「デプロイが通ること＋基本動作」の確認で十分
- クライアント環境: 実運用データあり → 実動作確認はここで行う

## 環境別デプロイ方法

### 環境差異テーブル

| | dev | kanameone | cocoro |
|---|---|---|---|
| プロジェクトID | `doc-split-dev` | `docsplit-kanameone` | `docsplit-cocoro` |
| 認証方式 | Firebase CLI（個人） | Firebase CLI（Workspace） | editor権限（個人）|
| Firebase CLIアカウント | `hy.unimail.11@gmail.com` | `systemkaname@kanameone.com` | `hy.unimail.11@gmail.com` |
| ADC（運用スクリプト用） | `hy.unimail.11@gmail.com` | `hy.unimail.11@gmail.com` | `hy.unimail.11@gmail.com` |
| gcloud構成 | `doc-split` | `kanameone` | `doc-split-cocoro` |
| AUTH_TYPE | personal | personal | **service_account** |
| 組織制約 | なし | なし | Google Workspace（`cocoro-mgnt.com`）|
| CI自動デプロイ | ✅ mainへのpush時 | ❌ | ❌ |
| `deploy-to-project.sh` | ✅ | ✅ | ⚠️ SA認証チェックで弾かれる場合あり |

### dev（自動 or 手動）

mainへのpush時にCI（`.github/workflows/deploy.yml`）が自動デプロイ。手動実行も可能：
```bash
./scripts/deploy-to-project.sh dev
```

### kanameone（`deploy-to-project.sh`）

```bash
firebase login:use systemkaname@kanameone.com
./scripts/deploy-to-project.sh kanameone          # Hostingのみ
./scripts/deploy-to-project.sh kanameone --rules   # + ルール
./scripts/deploy-to-project.sh kanameone --full    # + Functions
firebase login:use hy.unimail.11@gmail.com         # dev用に戻す
```

### cocoro（手動手順）

cocoro環境は`deploy-to-project.sh`の認証チェックがSA（`docsplit-deployer@...`）を期待するため、
editorアカウントでは認証チェックで弾かれる場合がある。その場合は手動で実施：

```bash
# 1. 環境変数を設定してビルド
cp frontend/.env.cocoro frontend/.env.local
npm run build

# 2. Firebase CLIでデプロイ（editorアカウントで実行可能）
firebase deploy --only hosting -P cocoro

# 3. 後片付け（MUST）
rm frontend/.env.local
```

Functionsデプロイ：
```bash
firebase deploy --only functions -P cocoro
```

### 全クライアント一括

```bash
./scripts/deploy-all-clients.sh [--rules|--full] [--dry-run]
```

## 変更内容別コマンド早見表

| 変更内容 | ローカル | GitHub Actions |
|---------|---------|----------------|
| フロントエンドのみ | `deploy-to-project.sh <alias>` | — |
| Firestoreルール | `deploy-to-project.sh <alias> --rules` | — |
| Functions変更 | `deploy-to-project.sh <alias> --full` | **Deploy Cloud Functions**（推奨） |
| Functionsのみ | `firebase deploy --only functions -P <alias>` | **Deploy Cloud Functions**（推奨） |
| 全クライアント一括 | `deploy-all-clients.sh [--rules|--full]` | — |

## GitHub Actions経由のFunctionsデプロイ（推奨）

組織ポリシー制約下ではローカルデプロイが失敗しやすいため、**Functionsデプロイは原則GitHub Actions経由**で実施する。

### 実行方法
```bash
gh workflow run "Deploy Cloud Functions" -f environment=<dev|kanameone|cocoro>
gh run list --workflow="Deploy Cloud Functions" --limit=3   # 結果確認
gh run view <run-id> --log-failed                            # 失敗時のログ
```

### SA構成（環境別）

| 環境 | GitHub Secret | SA |
|------|--------------|-----|
| dev | `GCP_SA_KEY_DEV` | `docsplit-cloud-build@doc-split-dev` |
| kanameone | `GCP_SA_KEY_KANAMEONE` | `docsplit-cloud-build@docsplit-kanameone` |
| cocoro | `GCP_SA_KEY` | `docsplit-cloud-build@docsplit-cocoro` |

各SAは自環境のみに権限を持つ（最小権限の原則）。

## 認証体系（3層構造）

Firebase/GCP操作には3つの独立した認証があり、混同しないこと。

| 認証 | 用途 | 切替方法 | Claude Codeで実行 |
|------|------|---------|-------------------|
| **Firebase CLI** | `firebase deploy` | `firebase login:use <email>` | ❌ `login:add`はブラウザ必要 |
| **gcloud構成** | `gcloud`コマンド | `switch-client.sh` / `.envrc.client` | ✅ |
| **ADC** | firebase-admin SDK（運用スクリプト） | `gcloud auth application-default login` | ❌ ブラウザ必要 |

**IMPORTANT**: 運用スクリプト（`fix-stuck-documents.js`等）はADCを使用。ADCアカウントとFirebase CLIアカウントは別物。`hy.unimail.11@gmail.com` は全環境（dev/kanameone/cocoro）のFirestoreにIAM権限を持つため、ADC1回の発行で全環境の運用スクリプトを実行可能。Firebase CLIが `systemkaname@kanameone.com` を使うkanameoneでも、ADCは `hy.unimail.11@gmail.com` で動作する。

## 後片付けチェックリスト（MUST）

デプロイ完了後、必ず以下を確認：
1. `frontend/.env.local` が削除されていること（手動デプロイ時）
2. Firebase CLIが `hy.unimail.11@gmail.com`（dev用）に戻っていること
3. gcloud構成が作業前の状態に戻っていること

## STORAGE_BUCKET（絶対に間違えてはいけない）

**各環境の正解値は `scripts/clients/<client>.env` の `STORAGE_BUCKET` を参照すること。推測・ハードコード禁止。**

| 環境 | STORAGE_BUCKET | 形式 |
|------|---------------|------|
| dev | `doc-split-dev.firebasestorage.app` | `.firebasestorage.app` |
| kanameone | `docsplit-kanameone.firebasestorage.app` | `.firebasestorage.app` |
| cocoro | `docsplit-cocoro.appspot.com` | `.appspot.com`（旧形式） |

**WARNING**: `.appspot.com` と `.firebasestorage.app` はプロジェクト作成時期で異なる。**プロジェクトIDから推測してはならない。** 間違えると全ファイルアクセス不能になる。

## 注意事項

- **IMPORTANT**: マルチ環境デプロイ時は可能な限りスクリプトを使用。手動`firebase deploy`は`.env.local`の設定で誤った環境にデプロイされる危険がある
- cocoro環境の`deploy-to-project.sh`対応は今後の改善候補（SA認証チェックの柔軟化）
