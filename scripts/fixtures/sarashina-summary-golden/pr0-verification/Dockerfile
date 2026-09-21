# PR0 spike(使い捨て): llama.cpp CPU版サーバーにGGUFモデルを焼き込む。
# ADR-0025のPaddleOCRと同じ運用形態(モデル同梱イメージ)を再現する。
# 2026-09-21の前回検証と同一構成(モデルURL・ベースイメージタグ)で再現性を保つ。
FROM mirror.gcr.io/library/alpine:3.20 AS dl
ARG MODEL_URL
RUN apk add --no-cache curl && mkdir /models && curl -fL --retry 5 --retry-delay 5 -o /models/model.gguf "$MODEL_URL" && ls -l /models

FROM ghcr.io/ggml-org/llama.cpp:server
COPY --from=dl /models/model.gguf /models/model.gguf
# -t 8: Cloud Run 8 vCPU に合わせる / -np 1: 同時1リクエスト(concurrency=1と対応)
# -c 16384: プラン提案のctx-sizeに合わせる(前回12288から拡大) / -n 1024: 出力上限(プラン提案通り)
CMD ["-m", "/models/model.gguf", "--host", "0.0.0.0", "--port", "8080", "-t", "8", "-tb", "8", "-c", "16384", "-n", "1024", "-np", "1", "--jinja"]
