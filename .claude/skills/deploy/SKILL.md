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
| `deploy-to-project.sh` | ✅ | ✅（ただしFirebase CLIセッション失効に弱い） | ⚠️ SA認証チェックで弾かれる場合あり |
| Hosting GitHub Actions | — | ✅ `Deploy Firebase Hosting`（推奨） | ✅ `Deploy Firebase Hosting`（推奨、2026-08-26対応） |

### dev（自動 or 手動）

mainへのpush時にCI（`.github/workflows/deploy.yml`）が自動デプロイ。手動実行も可能：
```bash
./scripts/deploy-to-project.sh dev
```

### kanameone（GitHub Actions経由が推奨、`deploy-to-project.sh`はフォールバック）

**推奨**: Hostingデプロイは`gh workflow run "Deploy Firebase Hosting" -f environment=kanameone`（下記「GitHub Actions経由のHostingデプロイ」節参照）。kanameoneのFirebase CLIローカルログイン（`systemkaname@kanameone.com`）はセッション失効時にブラウザ再認証が必要でAI実行環境から対応不能なため、GitHub Actions経由が安定する。

以下はGitHub Actionsが使えない場合のフォールバック手順。**MUST**: `deploy-to-project.sh` は冒頭で gcloud 構成チェックを行うため、`switch-client.sh kanameone` を先に実行しないと「gcloud構成が不一致です」エラーで一発失敗する（session48 教訓）。

```bash
firebase login:use systemkaname@kanameone.com
./scripts/switch-client.sh kanameone               # MUST: gcloud構成切替（認証チェック通過に必須）
./scripts/deploy-to-project.sh kanameone          # Hostingのみ
./scripts/deploy-to-project.sh kanameone --rules   # + ルール
./scripts/deploy-to-project.sh kanameone --full    # + Functions
firebase login:use hy.unimail.11@gmail.com         # dev用に戻す
./scripts/switch-client.sh dev                     # MUST: gcloud構成をdevに戻す
```

### cocoro（GitHub Actions経由が推奨、手動手順はフォールバック）

**推奨**: Hostingデプロイは`gh workflow run "Deploy Firebase Hosting" -f environment=cocoro`（下記「GitHub Actions経由のHostingデプロイ」節参照）。cocoro用SA（`docsplit-cloud-build@docsplit-cocoro`）は`roles/firebase.admin`を保有しており（2026-08-26 IAM実測確認済み）、ローカルFirebase CLIセッションの状態に依存せず反映できる。

以下はGitHub Actionsが使えない場合のフォールバック手順。cocoro環境は`deploy-to-project.sh`の認証チェックがSA（`docsplit-deployer@...`）を期待するため、
editorアカウントでは認証チェックで弾かれる場合がある。その場合は手動で実施：

**MUST**: 各コマンドは doc-split ルート CWD で実行する。`cd frontend` を Bash で直接実行すると CWD が永続化し、後続の `rm frontend/.env.local` が失敗する（session48 教訓。`npm run build` はルートの package.json が内部で `cd frontend` するので Bash 側で `cd` しない）。

**MUST**: cocoro 作業前に Firebase CLI アカウントを `hy.unimail.11@gmail.com` に切替える。kanameone デプロイ直後は `systemkaname@kanameone.com` が active になっているため、明示切替なしで `firebase deploy -P cocoro` を実行すると Workspace 組織制約により失敗する（session49 教訓）。

```bash
# 0. Firebase CLI アカウント切替（MUST: cocoro デプロイ前に必ず実行。冪等なので副作用なし）
firebase login:use hy.unimail.11@gmail.com

# 1. 環境変数を設定してビルド（CWD: doc-splitルート維持、`cd frontend`しない）
cp frontend/.env.cocoro frontend/.env.local
npm run build  # ルート package.json が内部で `cd frontend && vite build` を実行

# 2. Firebase CLIでデプロイ（editorアカウントで実行可能）
firebase deploy --only hosting -P cocoro

# 3. 後片付け（MUST）
rm frontend/.env.local
```

Functionsデプロイ：
```bash
# ローカル手動実行
firebase deploy --only functions -P cocoro

# GitHub Actions経由（推奨、SA鍵はGitHub Secretsから自動取得されるためローカルSA activate不要）
gh workflow run "Deploy Cloud Functions" -f environment=cocoro
```

Firestore/Storageルール + インデックスデプロイ（**MUST**: schema変更時。Firebase CLIログインアカウント`hy.unimail.11@gmail.com`のまま実行可能なはず、`deploy-to-project.sh`のgcloud認証チェック(SA前提)を経由しない単純な`firebase`コマンドのため。**未検証**、実行時に要確認）：
```bash
firebase deploy --only firestore:rules,firestore:indexes,storage -P cocoro
```

### 全クライアント一括

```bash
./scripts/deploy-all-clients.sh [--rules|--full] [--dry-run]
```

**既知の制約**: 内部で`deploy-to-project.sh`を各クライアントに対して呼ぶだけのため、kanameone/cocoroどちらのローカル認証ギャップ（上記参照）も解消しない。Hostingを複数環境へ一括反映したい場合は、下記「複数環境への一括デプロイ」の通り、`/deploy --all --hosting`等の明示指定でGitHub Actionsのdispatchを環境ごとに（順次）実行する（1回のGHA workflow実行で複数環境を同時デプロイするmatrix戦略はスコープ外。あくまで/deploy側が複数回dispatchを順に呼ぶ）。

## 複数環境への一括デプロイ

複数環境（kanameone・cocoro等）へ同時に反映したい場合は、対象を**明示的に指定**する。会話の承認履歴から対象を暗黙に拡大解釈することはしない：

- **単一コマンドでの明示的な複数指定**: `$ARGUMENTS`がカンマ区切り（例: `/deploy kanameone,cocoro --hosting`）または`--all`（例: `/deploy --all --hosting`、`.firebaserc`のdev/default以外の全クライアントが対象）を含む場合、対象一覧を先にユーザーへ確認表示してから、各環境についてHosting GHA dispatch（`gh workflow run "Deploy Firebase Hosting" -f environment=<env>`）を順に実行し、環境ごとにrun IDを特定して`gh run watch <run-id> --exit-status`で成功を確認する
- 単一環境ずつ確認しながら進めたい場合は、`/deploy`を環境ごとに複数回実行してもよい（例: `/deploy kanameone --hosting` → `/deploy cocoro --hosting`）

単一環境向けの`/deploy <1環境>`（カンマ区切り・`--all`を含まない）は、会話内で複数環境の話題が出ていたとしても当該1環境のみを対象とする。複数環境への反映は、コマンド自体にその対象を明示した場合にのみ行う。

## 変更内容別コマンド早見表

| 変更内容 | ローカル | GitHub Actions |
|---------|---------|----------------|
| フロントエンドのみ（Hosting） | `deploy-to-project.sh <alias>`（フォールバック） | **Deploy Firebase Hosting**（推奨、kanameone/cocoro対応） |
| Firestoreルール | `deploy-to-project.sh <alias> --rules` | — |
| Functions変更 | `deploy-to-project.sh <alias> --full` | **Deploy Cloud Functions**（推奨） |
| Functionsのみ | `firebase deploy --only functions -P <alias>` | **Deploy Cloud Functions**（推奨） |
| 全クライアント一括 | `deploy-all-clients.sh [--rules|--full]` | 環境ごとに個別dispatch（上記「複数環境への一括デプロイ」参照） |

## GitHub Actions経由のHostingデプロイ（推奨、kanameone/cocoro対応）

kanameoneはFirebase CLIローカルログインのセッション失効、cocoroは元々SA認証チェックで`deploy-to-project.sh`が弾かれる場合があるため、**Hostingデプロイは原則GitHub Actions経由**で実施する。

### 実行方法
```bash
gh workflow run "Deploy Firebase Hosting" -f environment=<kanameone|cocoro>
gh run list --workflow="Deploy Firebase Hosting" --limit=3 --json databaseId,status,conclusion   # run ID確認
gh run watch <run-id> --exit-status                                                                # 完了待ち（`gh run list --limit 1`より確実）
gh run view <run-id> --log-failed                                                                   # 失敗時のログ
```

### SA構成（環境別、Functionsと同じSAをHosting認証にも再利用）

| 環境 | GitHub Secret | SA |
|------|--------------|-----|
| kanameone | `GCP_SA_KEY_KANAMEONE` | `docsplit-cloud-build@docsplit-kanameone`（`roles/firebase.admin`） |
| cocoro | `GCP_SA_KEY` | `docsplit-cloud-build@docsplit-cocoro`（`roles/firebase.admin`、2026-08-26 IAM実測確認済み） |

devはmainへのpush時にCIが自動デプロイするため対象外。

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
2. Firebase CLIが `hy.unimail.11@gmail.com`（dev用）に戻っていること（`firebase login:list` で確認）
3. gcloud構成が `doc-split` (dev) に戻っていること（`./scripts/switch-client.sh dev` 実行 + `gcloud config configurations list | grep True` で確認）
4. 作業ディレクトリ(CWD)が doc-split ルートに戻っていること（Bash で `cd frontend` 等を直接実行すると CWD が永続化するため `pwd` で確認）

## STORAGE_BUCKET（絶対に間違えてはいけない）

**各環境の正解値は `scripts/clients/<client>.env` の `STORAGE_BUCKET` を参照すること。推測・ハードコード禁止。**

| 環境 | STORAGE_BUCKET | 形式 |
|------|---------------|------|
| dev | `doc-split-dev.firebasestorage.app` | `.firebasestorage.app` |
| kanameone | `docsplit-kanameone.firebasestorage.app` | `.firebasestorage.app` |
| cocoro | `docsplit-cocoro.appspot.com` | `.appspot.com`（旧形式） |

**WARNING**: `.appspot.com` と `.firebasestorage.app` はプロジェクト作成時期で異なる。**プロジェクトIDから推測してはならない。** 間違えると全ファイルアクセス不能になる。

## 注意事項

- **IMPORTANT**: マルチ環境デプロイ時は可能な限りスクリプトまたはGitHub Actionsを使用。手動`firebase deploy`は`.env.local`の設定で誤った環境にデプロイされる危険がある
- `deploy-to-project.sh`/`deploy-all-clients.sh`のアカウントチェック改修（kanameoneのセッション失効・cocoroのSA前提を緩和）自体は未着手のまま残っている。Hostingは本節のGitHub Actions経由に一本化することで実害を回避しているが、ローカルスクリプト自体の改善は引き続き今後の改善候補
