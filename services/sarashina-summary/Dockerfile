# ADR-0027 PR1a: Sarashina2.2-3B(Q8_0量子化)要約生成 Cloud Runサービス。
#
# PaddleOCR(services/paddle-ocr/)からの意図的な逸脱(詳細:
# docs/adr/0027-sarashina-summary-migration.md「PR1a実装知見」節):
# - FastAPIラッパーを作らない。llama.cpp server(OpenAI互換API)がHTTP契約・
#   ヘルスチェック・並行制御をネイティブに提供するため。
# - マルチステージ(モデル取得ステージ+実行はllama.cpp公式イメージのdigest固定)。
#   PaddleOCRの単一ステージとは逆の構成(理由: Python等の依存が実行時に不要なため)。
# - モデル取得はPython+huggingface_hubを使わずalpine+curlで直接取得する。
#   取得元(mmnga/sarashina2.2-3b-instruct-v0.1-gguf)は多数の量子化ファイルを含むため、
#   huggingface_hubのsnapshot_download+allow_patternsパターンを機械的に複製すると
#   全量子化を取得してビルドが破綻する事故が起きうる(PR1設計時に発見、確認時点の
#   ファイル数・容量はservices/sarashina-summary/README.md参照)。完全ファイル名を
#   直接URLで指定するcurl方式はこの事故が構造的に起きない。
FROM mirror.gcr.io/library/alpine:3.20 AS dl
RUN apk add --no-cache curl jq

COPY expected-model-hashes.json /tmp/expected-model-hashes.json
# 各jq抽出値の直後にnull/空チェックを入れる(pr-review-toolkit silent-failure-hunter
# 指摘反映)。jqはキー欠落時もexit 0のまま文字列"null"を返すため、set -eでは検知
# できない。無検証で進めると不正なURL(https://huggingface.co/null/resolve/null/null
# 等)でcurlが404失敗するか、最悪の場合EXPECTED_SHA256だけがnull化して後続の
# ハッシュ不一致分岐に入り、「上流commitが変わった」という誤った原因を名指しする
# (実際はローカルのJSON設定ミス)。ここで早期に検知し、原因を正確に切り分ける。
RUN set -eu; \
    REPO=$(jq -r '.textGeneration.hfRepoId' /tmp/expected-model-hashes.json); \
    REVISION=$(jq -r '.textGeneration.hfRevision' /tmp/expected-model-hashes.json); \
    FILENAME=$(jq -r '.textGeneration.fileName' /tmp/expected-model-hashes.json); \
    EXPECTED_SHA256=$(jq -r '.textGeneration.sha256' /tmp/expected-model-hashes.json); \
    for pair in "hfRepoId:$REPO" "hfRevision:$REVISION" "fileName:$FILENAME" "sha256:$EXPECTED_SHA256"; do \
      field="${pair%%:*}"; value="${pair#*:}"; \
      case "$value" in ""|null) \
        echo "ERROR: expected-model-hashes.jsonのtextGeneration.${field}が読めません(キー欠落/型不正)。" >&2; \
        exit 1;; \
      esac; \
    done; \
    mkdir -p /models; \
    echo "Downloading ${FILENAME} from ${REPO}@${REVISION} ..."; \
    curl -fL --retry 5 --retry-delay 5 \
      -o /models/model.gguf \
      "https://huggingface.co/${REPO}/resolve/${REVISION}/${FILENAME}"; \
    ACTUAL_SHA256=$(sha256sum /models/model.gguf | cut -d' ' -f1); \
    if [ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]; then \
      echo "ERROR: SHA-256 mismatch." >&2; \
      echo "  expected=$EXPECTED_SHA256" >&2; \
      echo "  actual=$ACTUAL_SHA256" >&2; \
      echo "  原因は複数考えられます(上流ファイルの変更/expected-model-hashes.jsonの" >&2; \
      echo "  設定ミス/ダウンロード破損)。まずexpected-model-hashes.jsonの値が正しいか" >&2; \
      echo "  確認してください。上流ファイルが実際に変わった場合は、D9/D10相当の固有名詞" >&2; \
      echo "  捏造テスト(scripts/fixtures/sarashina-summary-golden/)を再実行して品質を" >&2; \
      echo "  再検証したうえで、expected-model-hashes.jsonとREADME.mdを同時更新して" >&2; \
      echo "  ください。無検証での更新は禁止です。" >&2; \
      exit 1; \
    fi; \
    echo "OK: model hash verified ($ACTUAL_SHA256)"

# ベースイメージはdigest固定(expected-model-hashes.json baseImage.digestと同一値、
# tag/buildInfoの対応も含めtests/test_expected_hashes.pyでドリフトガードする)。
# ghcr.io/ggml-org/llama.cpp:server-b11065と同一(PR0検証時のbuild_info: b11065-ce8caa6e6)。
# ENTRYPOINT=["/app/llama-server"]・CMD=null・USER未指定(root)がベースイメージの実態
# (PR1設計時にGHCRのイメージconfigで確認済み)。ENV LLAMA_ARG_HOST=0.0.0.0はベース
# イメージで既に設定済みのため、本Dockerfileでは明示しない。
FROM ghcr.io/ggml-org/llama.cpp@sha256:9dc0a0f4080b7817c9592b19c03a4f4b0be92fd701076b9da259ff941dc5bf91

COPY --from=dl /models/model.gguf /models/model.gguf

# 非root実行(services/paddle-ocr/Dockerfileと同じ方針)。ベースイメージは
# GGML_BACKEND_DL=ONでビルドされ/app/*.soを実行時にdlopenする(PR1設計時にGHCRの
# イメージconfig・ビルドオプションで確認済み)ため、WORKDIRは/appのまま動かさず、
# /app配下の権限は壊さない(読み取り権限を保ったままuser切替)。モデルファイルのみ
# appuser読み取り専有にする。
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
#   ごとにmax_tokensを明示すること(ADR-0027「PR1a実装知見」4参照)。
# LLAMA_ARG_THREADS=8: PR0実測構成(-t 8)を再現し、Cloud Run 8vCPU環境での
#   物理コア自動検出のばらつき(cgroup制限下では不安定になりうる)に依存しない
#   ようにする(codex review指摘、上記「ENV方式を基本とする」ブロック参照)。
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
