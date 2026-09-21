# Sarashina要約 Cloud Runサービス

ADR-0027(要約生成のGemini依存脱却)のPR1: 自前ホスティングSarashina2.2-3B-instruct-v0.1(Q8_0量子化)をCloud Run上でOpenAI互換APIとして提供する。詳細な意思決定の経緯は[`docs/adr/0027-sarashina-summary-migration.md`](../../docs/adr/0027-sarashina-summary-migration.md)、実装計画は`~/.claude/plans/logical-baking-lighthouse.md`を参照。

## PaddleOCR(`services/paddle-ocr/`)との意図的な相違点

本サービスはPaddleOCRのFastAPIラッパー方式を踏襲しない。llama.cpp server(OpenAI互換API)がHTTP契約・ヘルスチェック・並行制御をネイティブに提供するため、追加のアプリケーション層を作らず、`ghcr.io/ggml-org/llama.cpp`のdigest固定イメージへモデルを焼き込むだけの構成にしている。

- **モデル取得**: Python+huggingface_hubを使わず、alpine+curlで完全ファイル名を直接URL指定して取得する。取得元(`mmnga/sarashina2.2-3b-instruct-v0.1-gguf`)は24個の量子化ファイル(合計30GB超)を含むため、PaddleOCRの`snapshot_download`+`allow_patterns`パターンを機械的に複製すると全量子化を取得してビルドが破綻する事故が起きうる(PR1設計時に発見)。curl直接取得はこの事故が構造的に起きない。
- **実行時ハッシュ再検証はしない**: digest固定デプロイで内容は既に固定済みのため、3.4GB再ハッシュはコールドスタートの純損失になる(ビルド時の検証のみ、`Dockerfile`参照)。
- **パラメータ設定はENV方式を基本とする**: llama.cppは環境変数を先に処理し、CLI引数が後から上書きする実装になっている。もしCMD方式(コマンドライン引数)で設定すると、`gcloud run deploy --update-env-vars=LLAMA_ARG_*`による再デプロイなしチューニングが**静かに無視される**。本サービスは対応する`LLAMA_ARG_*`が存在するパラメータは全て環境変数で設定する。ただし`-tb`/`--threads-batch`(バッチ処理スレッド数)には対応する環境変数が存在しない(`common/arg.cpp`で確認済み、`.set_env()`が付与されているのは`-t`/`--threads`のみ)ため、このオプションのみCMDで明示している(`Dockerfile`参照)。個々のCLIオプションはそれに対応する`LLAMA_ARG_*`のみを上書きするため、この部分的な混在は安全。

## エンドポイント契約

llama.cpp serverのOpenAI互換APIをそのまま使う(本サービス独自のエンドポイントは追加しない)。

### `GET /health`

`{"status":"ok"}`のみを返す(PaddleOCRの`/health`と異なり`modelLoaded`/`imageDigest`等のフィールドは持たない)。**生成処理中も常に200を返す**(PR0実測確認済み)ため、PaddleOCRの`/health`が果たしていた「生成ハング検知」の役割はほぼ果たさない。Cloud Run liveness probeは異常終了・プロセスクラッシュの検知のみに用途を限定する。

### `GET /props`

サーバーの実行時設定を返す。デプロイ検証(`imageDigest`検証の代替)には以下のフィールドを使う:

- `build_info`: ベースイメージのビルド情報。本サービスは`b11065-ce8caa6e6`固定(`expected-model-hashes.json`の`baseImage.buildInfo`と一致することをCIで検証、`tests/test_expected_hashes.py`)
- `model_alias`: `LLAMA_ARG_ALIAS`で設定した`sarashina2.2-3b-instruct-v0.1-Q8_0`
- `default_generation_settings.params.n_predict`: **常に`-1`を返す**(下記「出力トークン上限の正確な仕様」参照。実際の設定を反映しない表示上の実装であり、`LLAMA_ARG_N_PREDICT`が無効という意味ではない)
- `default_generation_settings.n_ctx`: 実効コンテキスト長(下記「有効コンテキスト長」参照)

### `POST /v1/chat/completions`

OpenAI Chat Completions互換。呼び出し元(Functionsクライアント、PR3で実装)は必ず`max_tokens`をリクエストボディへ明示すること(下記「出力トークン上限の正確な仕様」参照)。

## モデル同一性担保

`expected-model-hashes.json`にHugging Faceリポジトリのimmutable revisionとGGUFファイル本体のSHA-256を固定している。値はPR0実測(2026-09-21〜22)およびHugging Face API(`paths-info`)の独立確認と完全一致(2026-09-22確認)。

値を変更する場合は、PR0相当の固有名詞捏造テスト(D9/D10相当、[`scripts/fixtures/sarashina-summary-golden/`](../../scripts/fixtures/sarashina-summary-golden/))を再実行して品質を再検証し、`expected-model-hashes.json`と本ファイルの記載値を同時更新すること(無検証での更新は禁止)。`tests/test_expected_hashes.py`がDockerfile・README.md・expected-model-hashes.jsonの3者間の値の一致をCIでドリフトガードする。

- Hugging Faceリポジトリ: `mmnga/sarashina2.2-3b-instruct-v0.1-gguf`(コミュニティ配布Q8_0量子化、ベースモデル`sbintuitions/sarashina2.2-3b-instruct-v0.1`のMITライセンスを継承)
- pinned revision: `31d771319b04032f33e0d9d860f3984ea4812154`
- ファイル: `sarashina2.2-3b-instruct-v0.1-Q8_0.gguf`(3,568,393,312 bytes)
- SHA-256: `8784919a2f7bbe89594b2260d5d0a1d85eddfdb42f3735bdef892d8ca033a1dc`

## 実装上の重要な注意事項(PR1設計時にソースコード・実機で確認)

### 有効コンテキスト長は8192固定

`LLAMA_ARG_CTX_SIZE`をいくら大きく指定しても、モデルの`max_position_embeddings=8192`でハードクランプされる(PR0では`-c 16384`を指定していたが無意味だった)。**prompt tokens + max_tokens > 8192のリクエストは`ERROR_TYPE_EXCEED_CONTEXT_SIZE`→HTTP 400(permanent、リトライ無意味)になる**。入力長の事前切り詰め・事前拒否はクライアント(PR3/PR4)の責務。

### 出力トークン上限の正確な仕様(PR0記録の訂正)

PR0時点では「`LLAMA_ARG_N_PREDICT`/`-n`が出力トークン上限として全く機能しない」と記録したが、これは不正確だった。llama.cpp(`tools/server/server-context.cpp`)のソース確認により、正しい挙動は以下の通り:

- クライアントが`max_tokens`を**省略**した場合のみ、`LLAMA_ARG_N_PREDICT`がフォールバック上限として効く
- クライアントが`max_tokens`を**明示指定**した場合、その値は`LLAMA_ARG_N_PREDICT`でクランプされず**そのまま通る**
- `/props`が常に`default_generation_settings.params.n_predict: -1`を返すのは、`/props`が毎回既定構造体を再構築して返すだけの実装のため(実際の設定を反映しない表示上の実装であり、バグではないが誤解を招く)

**結論**: `LLAMA_ARG_N_PREDICT=1024`はクライアント実装漏れに対する保険として有効なため残すが、**唯一の安全機構ではない**。呼び出し元(Functions)は必ずリクエストごとに`max_tokens`を明示すること。このフラグを「効かないフラグ」として将来削除しないこと(削除すると、クライアントが`max_tokens`を付け忘れた際に無制限生成が発生し、PR0で観測した危険な挙動が安全機構なしで再現する)。

### Cloud Run 429の発生源はllama.cppではなくCloud Run自体

llama.cppが返しうるのは503(`Loading model`または`no slot available`)のみで、429は一切返さない。PR0が観測した「クライアント接続打ち切り後、新規リクエストが約2分40秒間ブロックされた」現象は、Cloud Runの`No available container instances`(`--concurrency=1`のインスタンスが塞がり、`--max-instances`で追加起動できない状態)によるもの。

**`--max-instances=1`は「コスト上限」であって「逐次実行の保証」ではない**(Cloud Run公式: max-instancesはtraffic spike等で一時的に超過しうる、新リビジョン切替中は旧+新で一時的に2インスタンスになりうる、設定はrevision単位)。逐次実行の担保はクライアント側(`generateSummaryBatch`の逐次ループ+Firestoreのclaim/所有権トークン、PR4)の責務であり、Cloud Runの設定には依存しない。

クライアント側のエラー分類(`~/.claude/rules/error-handling.md`のtransient/permanent表)には以下を追加する: **429(Cloud Run infra起因)= transient**、**503(llama.cppの`Loading model`/`no slot available`)= transient**、**400(`ERROR_TYPE_EXCEED_CONTEXT_SIZE`)= permanent**。

### メモリ32GiBはPR0実測条件の保存であり実需要ではない

実測値ベースの試算では、モデル(mmap、3.32GiB)+ KV cache(n_ctx=8192・f16で約1.28GiB)+ compute buffer等(約1GiB)の合計は**約5〜6GiB**。Cloud Runの32GiBは8vCPUにおける設定上の最大値であって必要量ではない。**PR1では32GiBを据え置く**(PR0実測条件の再現性を保つため)。削減はPR2以降で実peak RSSを計測してから判断すること。無検証での削減/「32GiBのままでよい」という固定化のどちらも避けること。

## Cloud Run設定(PR1c確定値)

| 項目 | 値 | 根拠 |
|---|---|---|
| cpu/memory | 8vCPU / 32GiB | PR0実測条件の保存(上記「メモリ32GiB」参照) |
| concurrency | 1 | PR0実測条件と一致 |
| min-instances | 0 | 非同期処理、コールドスタート許容 |
| max-instances | 1 | コスト上限(逐次性の保証ではない、上記「Cloud Run 429」参照) |
| timeout | 600秒 | `LLAMA_ARG_TIMEOUT=600`と揃える |
| startup probe | `periodSeconds=5, timeoutSeconds=3, failureThreshold=48`(=240秒窓) | Cloud Run公式制約(`failureThreshold×periodSeconds`は240秒が上限)いっぱいまでマージンを取る。PR0実測ready_wait最大65.9秒の約3.6倍 |
| liveness probe | `periodSeconds=30, timeoutSeconds=5, failureThreshold=10`(=300秒窓) | 異常終了・プロセスクラッシュの検知のみ(上記`/health`の注記参照。生成ハング検知はできない) |

## PR0実測結果(参考、詳細はADR-0027・実装計画参照)

品質基準実験(D9/D10相当)で捏造0/8回、カバー率95〜100%、処理時間はウォームで短文34秒〜長文204秒、コールドスタート(`ready_wait_s`)20.5〜65.9秒。詳細は[`scripts/fixtures/sarashina-summary-golden/README.md`](../../scripts/fixtures/sarashina-summary-golden/README.md)を参照。

## ローカル開発

```bash
# ビルド(Cloud Run想定のlinux/amd64を明示。ローカルMac(arm64)でのdocker buildは
# ベースイメージのOCI indexからarm64が解決されるため、本番のamd64ビルドとは
# 別バイナリになる点に注意。ローカル検証結果を本番と同一視しないこと)
docker buildx build --platform linux/amd64 -t sarashina-summary-local --load .

# 起動(3.5GBのモデルダウンロードのため初回ビルドは相応の時間がかかる)
docker run -p 8080:8080 sarashina-summary-local

# 動作確認
curl http://127.0.0.1:8080/health
curl http://127.0.0.1:8080/props
curl -X POST http://127.0.0.1:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"こんにちは"}],"max_tokens":16,"cache_prompt":false}'

# テスト(pytest、expected-model-hashes.jsonの形式検証+ドリフトガードのみ、軽量)
pip install -r requirements-test.txt
pytest tests/
```
