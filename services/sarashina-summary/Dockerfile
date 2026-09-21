# ADR-0027 PR1a: Sarashina2.2-3B(Q8_0量子化)要約生成 Cloud Runサービス。
#
# PaddleOCR(services/paddle-ocr/)からの意図的な逸脱(詳細:
# ~/.claude/plans/logical-baking-lighthouse.md「主要な設計判断」1・1a):
# - FastAPIラッパーを作らない。llama.cpp server(OpenAI互換API)がHTTP契約・
#   ヘルスチェック・並行制御をネイティブに提供するため。
# - マルチステージ(モデル取得ステージ+実行はllama.cpp公式イメージのdigest固定)。
#   PaddleOCRの単一ステージとは逆の構成(理由: Python等の依存が実行時に不要なため)。
# - モデル取得はPython+huggingface_hubを使わずalpine+curlで直接取得する。
#   取得元(mmnga/sarashina2.2-3b-instruct-v0.1-gguf)は24個の量子化ファイル(30GB超)を
#   含むため、huggingface_hubのsnapshot_download+allow_patternsパターンを機械的に
#   複製すると全量子化を取得してビルドが破綻する事故が起きうる(PR1設計時に発見)。
#   完全ファイル名を直接URLで指定するcurl方式はこの事故が構造的に起きない。
FROM mirror.gcr.io/library/alpine:3.20 AS dl
RUN apk add --no-cache curl jq

COPY expected-model-hashes.json /tmp/expected-model-hashes.json
RUN set -eu; \
    REPO=$(jq -r '.textGeneration.hfRepoId' /tmp/expected-model-hashes.json); \
    REVISION=$(jq -r '.textGeneration.hfRevision' /tmp/expected-model-hashes.json); \
    FILENAME=$(jq -r '.textGeneration.fileName' /tmp/expected-model-hashes.json); \
    EXPECTED_SHA256=$(jq -r '.textGeneration.sha256' /tmp/expected-model-hashes.json); \
    mkdir -p /models; \
    echo "Downloading ${FILENAME} from ${REPO}@${REVISION} ..."; \
    curl -fL --retry 5 --retry-delay 5 \
      -o /models/model.gguf \
      "https://huggingface.co/${REPO}/resolve/${REVISION}/${FILENAME}"; \
    ACTUAL_SHA256=$(sha256sum /models/model.gguf | cut -d' ' -f1); \
    if [ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]; then \
      echo "ERROR: SHA-256 mismatch (上流のcommitが変わった可能性があります)." >&2; \
      echo "  expected=$EXPECTED_SHA256" >&2; \
      echo "  actual=$ACTUAL_SHA256" >&2; \
      echo "  D9/D10相当の固有名詞捏造テスト(scripts/fixtures/sarashina-summary-golden/)を" >&2; \
      echo "  再実行して品質を再検証したうえで、expected-model-hashes.jsonとREADME.mdを" >&2; \
      echo "  同時更新してください。無検証での更新は禁止です。" >&2; \
      exit 1; \
    fi; \
    echo "OK: model hash verified ($ACTUAL_SHA256)"

# ベースイメージはdigest固定(expected-model-hashes.json baseImage.digestと同一値)。
# ghcr.io/ggml-org/llama.cpp:server-b11065と同一(PR0検証時のbuild_info: b11065-ce8caa6e6)。
# ENTRYPOINT=["/app/llama-server"]・CMD=null・USER未指定(root)がベースイメージの実態
# (PR1設計時にGHCRのイメージconfigで確認済み)。ENV LLAMA_ARG_HOST=0.0.0.0はベース
# イメージで既に設定済みのため、本Dockerfileでは明示しない。
FROM ghcr.io/ggml-org/llama.cpp@sha256:9dc0a0f4080b7817c9592b19c03a4f4b0be92fd701076b9da259ff941dc5bf91

COPY --from=dl /models/model.gguf /models/model.gguf

# 非root実行(services/paddle-ocr/Dockerfileと同じ方針)。ベースイメージは
# GGML_BACKEND_DL=ONでビルドされ/app/*.soを実行時にdlopenするため、WORKDIRは
# /appのまま動かさず、/app配下の権限は壊さない(読み取り権限を保ったままuser切替)。
# モデルファイルのみappuser読み取り専有にする。
RUN useradd --create-home --uid 1001 --shell /usr/sbin/nologin appuser \
    && chown appuser:appuser /models/model.gguf \
    && chmod 0444 /models/model.gguf
USER appuser

# ENV方式を基本とする(パラメータ変更を--update-env-varsで再デプロイなしに行える
# ようにするため)。理由: llama.cppは環境変数を先に処理しCLI引数が後から上書きする
# 実装のため、CMD方式で書いたオプションはgcloud run deploy --update-env-vars=
# LLAMA_ARG_*が静かに無視される(PR1設計時にcommon/arg.cppのソースで確認)。
# PaddleOCRの--update-env-varsによる再デプロイなしチューニングという運用モデルと
# 揃えるため、対応するLLAMA_ARG_*が存在するパラメータは全てENV経由にする。
#
# LLAMA_ARG_CTX_SIZE=8192: モデルのmax_position_embeddings=8192でハードクランプ
#   されるため、それより大きい値を指定しても意味がない(PR0では16384を指定していたが
#   無意味だったと判明、実効値をそのまま指定する)。
# LLAMA_ARG_N_PREDICT=1024: クライアントがmax_tokensを省略した場合のみ効くフォール
#   バック上限(クランプではない)。唯一の安全機構ではなく、呼び出し元は必ずリクエスト
#   ごとにmax_tokensを明示すること(実装計画「主要な設計判断」1a-5参照)。
# LLAMA_ARG_THREADS=8: PR0実測構成(-t 8)を再現し、Cloud Run 8vCPU環境での
#   物理コア自動検出のばらつき(cgroup制限下では不安定になりうる)に依存しない
#   ようにする(codex review指摘、Dockerfile:59-63参照)。
# LLAMA_ARG_N_PARALLEL=1: Cloud Run --concurrency=1と対応させ8vCPU専有を維持。
# LLAMA_ARG_TIMEOUT=600: Cloud Run --timeout=600と揃える(既定3600秒のままだと
#   どちらが先に切るか不明瞭になるため明示する)。
ENV LLAMA_ARG_MODEL=/models/model.gguf \
    LLAMA_ARG_CTX_SIZE=8192 \
    LLAMA_ARG_N_PREDICT=1024 \
    LLAMA_ARG_THREADS=8 \
    LLAMA_ARG_N_PARALLEL=1 \
    LLAMA_ARG_JINJA=1 \
    LLAMA_ARG_ALIAS=sarashina2.2-3b-instruct-v0.1-Q8_0 \
    LLAMA_ARG_TIMEOUT=600 \
    LLAMA_ARG_PORT=8080

# `-tb`/`--threads-batch`(バッチ処理スレッド数、PR0実測構成の`-tb 8`に対応)には
# LLAMA_ARG_THREADS_BATCHのような環境変数が存在しない(common/arg.cppで確認済み、
# .set_env()が付与されているのは-t/--threadsのみ)。CLI引数でしか設定できないため
# CMDで明示する。個々のCLIオプションはそれに対応するLLAMA_ARG_*のみを上書きする
# (他のENV設定はそのまま有効なため、上記ENV方式との混在は意図的かつ安全)。
CMD ["-tb", "8"]

EXPOSE 8080
