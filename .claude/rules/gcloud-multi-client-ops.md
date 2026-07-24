# 環境別 gcloud 操作・本番状態確認プロトコル

dev / kanameone / cocoro のマルチクライアント環境でgcloud操作・本番状態確認を行う際のルール。

---

## 1. 環境別 gcloud 操作の必須プロトコル（YOU MUST）

環境別の gcloud 操作（SA 作成、IAM roles 付与、Secret 発行、setup/teardown スクリプト実行等）は、**必ず以下の順序で実施**:

1. **`./scripts/switch-client.sh <env>` で named config を切替** — 各環境には事前整備された Owner/管理者認証の named config が存在する（`kanameone` = `systemkaname@kanameone.com`, `doc-split-cocoro` = `docsplit-deployer@...` SA）
2. `gcloud config configurations list` で切替結果を確認してから gcloud コマンド実行
3. 操作完了後は `./scripts/switch-client.sh dev` で開発環境に戻す

**YOU MUST NOT**: `gcloud auth list` の結果 1 件だけを見て「権限不足」「ブロッカー」と即断しない。`scripts/clients/*.env` の `GCLOUD_CONFIG` / `EXPECTED_ACCOUNT` / `AUTH_TYPE` を先に確認すること。

**失敗パターン（#220 Follow-up B 2026-04-17 session6）**: `Policy update access denied` 直後に `hy.unimail.11@gmail.com` のみで判断し「本番 Owner 認証ブロッカー」と誤診して A2/A3 を次セッション持越しにした。実際は `kanameone` named config が Owner 認証済で即実行可能だった。

## 2. Cloud Functions環境変数の実態確認（YOU MUST NOT ローカルenv fileだけで断定）

`functions/.env.<project-id>`（`.env.docsplit-kanameone`等、gitignore対象）は **GitHub Actions (`deploy-functions.yml`) がデプロイの都度runner上で新規生成・上書きする一時ファイル**であり、ローカルリポジトリにある中身は本番の実態を表さない。特に`GEMINI_MODEL_ID`は`gemini_model_id_override`ワークフロー入力（既定値`code-default`）が優先され、ローカルファイルの値は無関係。

本番の実際の環境変数を確認する場合は必ず以下で直接確認する（ローカルenv fileのgrepだけで済ませない）:
```bash
gcloud functions describe <function名> --project=<project-id> --account=hy.unimail.11@gmail.com \
  --gen2 --region=asia-northeast1 --format="json(serviceConfig.environmentVariables, updateTime)"
```

**失敗パターン（2026-07-24）**: `functions/.env.docsplit-kanameone`の`GEMINI_MODEL_ID=gemini-2.5-flash`という記述だけを見て「kanameoneは3.5未移行」と断定しdecision-makerに誤報告した。実際に`gcloud functions describe`で確認すると`GEMINI_MODEL_ID`は未設定でコードのデフォルト値`gemini-3.5-flash`が稼働しており、Issue #548（2026-07-09クローズ）の記録通り移行は完了済みだった。
